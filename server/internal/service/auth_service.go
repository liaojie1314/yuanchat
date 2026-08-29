// Package service 的 auth 部分负责忘记密码链路、账号级登录防护与扫码登录。
package service

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/pkg/codesender"
	"github.com/yuanchat/server/internal/pkg/jwt"
	"github.com/yuanchat/server/internal/pkg/password"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
)

// 忘记密码链路的时限与阈值。数值取自设计文档，改动会直接影响安全边界。
const (
	otpTTL         = 5 * time.Minute
	otpCooldownTTL = time.Minute
	otpFailTTL     = 15 * time.Minute
	otpMaxFails    = 5
	resetTicketTTL = 5 * time.Minute
)

// AuthService 可能返回的错误。
var (
	ErrCodeCooldown  = errors.New("verification code cooldown")
	ErrCodeInvalid   = errors.New("invalid verification code")
	ErrTooManyTries  = errors.New("too many verification attempts")
	ErrTicketInvalid = errors.New("invalid reset ticket")
)

// AuthService 编排忘记密码的三段式流程、账号级登录防护与扫码登录状态机。
//
// 与 UserService 分开是因为本服务依赖 Redis 与验证码下发通道，
// 而注册 / 登录 / 资料那条链路不需要它们。
type AuthService struct {
	repo   *repository.UserRepository
	codes  *repository.VerificationCodeRepository
	rdb    *redis.Client
	sender codesender.Sender
	jwtGen *jwt.Generator
	logger *zap.Logger
}

// NewAuthService 构造忘记密码、登录防护与扫码登录服务。
//
// jwtGen 是扫码确认时签发令牌用的签发器，与登录链路共用同一个实例，
// 否则扫码换出的令牌会用另一把密钥签名，其他端一律验不过。
func NewAuthService(
	repo *repository.UserRepository,
	codes *repository.VerificationCodeRepository,
	rdb *redis.Client,
	sender codesender.Sender,
	jwtGen *jwt.Generator,
	logger *zap.Logger,
) *AuthService {
	return &AuthService{repo: repo, codes: codes, rdb: rdb, sender: sender, jwtGen: jwtGen, logger: logger}
}

// Redis 键一律带 auth:pwd: 命名空间，避免与既有 captcha 的裸键混在一起。
func otpKey(phone string) string          { return "auth:pwd:otp:" + phone }
func otpCooldownKey(phone string) string  { return "auth:pwd:otp:cd:" + phone }
func otpFailKey(phone string) string      { return "auth:pwd:otp:fail:" + phone }
func resetTicketKey(ticket string) string { return "auth:pwd:ticket:" + ticket }

// SendResetCode 生成 6 位验证码并通过下发通道送出。
//
// 手机号未注册时直接返回 nil 且不下发：端点对「已注册」与「未注册」给出完全一样的结果，
// 否则接口会退化成账号枚举工具。
// 下发通道报错时把验证码与冷却键一并回滚，否则用户被冷却期锁住却收不到码。
func (s *AuthService) SendResetCode(ctx context.Context, phone string) error {
	cooling, err := s.rdb.Exists(ctx, otpCooldownKey(phone)).Result()
	if err != nil {
		return fmt.Errorf("check cooldown: %w", err)
	}
	if cooling > 0 {
		return ErrCodeCooldown
	}

	user, err := s.repo.FindByPhone(ctx, phone)
	if err != nil {
		return fmt.Errorf("find user: %w", err)
	}
	// FindByPhone 对未命中返回 (nil, nil)，不是 ErrRecordNotFound
	if user == nil {
		s.logger.Info("忘记密码：手机号未注册，静默返回")
		return nil
	}

	code, err := randomDigits(6)
	if err != nil {
		return fmt.Errorf("generate code: %w", err)
	}

	pipe := s.rdb.TxPipeline()
	pipe.Set(ctx, otpKey(phone), code, otpTTL)
	pipe.Set(ctx, otpCooldownKey(phone), "1", otpCooldownTTL)
	// 重新发码即重置失败计数，否则上一轮的失败会把新码直接判死
	pipe.Del(ctx, otpFailKey(phone))
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("store code: %w", err)
	}

	// 审计只写不读，写失败不阻断发码
	if err := s.codes.Create(ctx, &model.VerificationCode{
		ID:        uuid.New(),
		Target:    phone,
		Code:      code,
		Type:      model.VerificationTypePasswordReset,
		ExpiresAt: time.Now().Add(otpTTL),
	}); err != nil {
		s.logger.Warn("写入验证码审计行失败", zap.Error(err))
	}

	if err := s.sender.Send(ctx, phone, code); err != nil {
		if delErr := s.rdb.Del(ctx, otpKey(phone), otpCooldownKey(phone)).Err(); delErr != nil {
			s.logger.Error("下发失败后回滚验证码失败", zap.Error(delErr))
		}
		return fmt.Errorf("send code: %w", err)
	}
	return nil
}

// VerifyResetCode 校验验证码并换发一次性改密票据，返回票据与其有效期秒数。
//
// 先比较、比对成功才删除——与 handler/captcha.go 的「先删再比」相反，
// 避免用户手滑输错一位就得重新发码。输错只递增失败计数。
func (s *AuthService) VerifyResetCode(ctx context.Context, phone, code string) (string, int, error) {
	// 锁定判断放在比较之前：达到上限后即使输对也不放行
	fails, err := s.rdb.Get(ctx, otpFailKey(phone)).Int()
	if err != nil && !errors.Is(err, redis.Nil) {
		return "", 0, fmt.Errorf("read fail counter: %w", err)
	}
	if fails >= otpMaxFails {
		return "", 0, ErrTooManyTries
	}

	want, err := s.rdb.Get(ctx, otpKey(phone)).Result()
	if errors.Is(err, redis.Nil) {
		// 不存在与已过期返回同一个错误，避免探测码是否曾下发
		return "", 0, ErrCodeInvalid
	}
	if err != nil {
		return "", 0, fmt.Errorf("read code: %w", err)
	}
	// 定长比较，避免按字节短路带来的时序差异
	if subtle.ConstantTimeCompare([]byte(want), []byte(code)) != 1 {
		if _, err := incrWithTTL(ctx, s.rdb, otpFailKey(phone), otpFailTTL); err != nil {
			s.logger.Warn("递增验证码失败计数失败", zap.Error(err))
		}
		return "", 0, ErrCodeInvalid
	}

	user, err := s.repo.FindByPhone(ctx, phone)
	if err != nil {
		return "", 0, fmt.Errorf("find user: %w", err)
	}
	// 发码之后账号被注销：按码无效处理，不泄露账号状态
	if user == nil {
		return "", 0, ErrCodeInvalid
	}

	ticket, err := randomToken(32)
	if err != nil {
		return "", 0, fmt.Errorf("generate ticket: %w", err)
	}
	pipe := s.rdb.TxPipeline()
	// 票据存 user_id：改密时无需再查手机号，也不会因期间改号而改错账号
	pipe.Set(ctx, resetTicketKey(ticket), user.ID.String(), resetTicketTTL)
	pipe.Del(ctx, otpKey(phone), otpFailKey(phone))
	if _, err := pipe.Exec(ctx); err != nil {
		return "", 0, fmt.Errorf("store ticket: %w", err)
	}

	if err := s.codes.MarkUsed(ctx, phone, want); err != nil {
		s.logger.Warn("标记验证码审计行已使用失败", zap.Error(err))
	}
	return ticket, int(resetTicketTTL.Seconds()), nil
}

// ResetPassword 消费一次性票据并写入新密码，同时递增 token_version 吊销全部旧令牌。
//
// 复杂度校验刻意排在消费票据之前：密码不合规时票据仍然可用，
// 用户可以直接重填，不必从发码重来。
func (s *AuthService) ResetPassword(ctx context.Context, ticket, newPassword string) error {
	if err := ValidatePasswordStrength(newPassword); err != nil {
		return err
	}

	// GETDEL 取出即失效，保证同一张票只能改一次密码
	userID, err := s.rdb.GetDel(ctx, resetTicketKey(ticket)).Result()
	if errors.Is(err, redis.Nil) {
		return ErrTicketInvalid
	}
	if err != nil {
		return fmt.Errorf("consume ticket: %w", err)
	}

	hash, err := password.Hash(newPassword)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	if err := s.repo.UpdatePasswordAndBumpTokenVersion(ctx, userID, hash); err != nil {
		return fmt.Errorf("update password: %w", err)
	}

	s.logger.Info("密码已重置，该用户旧令牌全部失效", zap.String("user_id", userID))
	return nil
}

// incrWithTTL 递增计数器，并在计数首次创建时设置过期时间。
//
// 验证码失败计数与登录失败计数共用，避免同一段逻辑写两遍。
func incrWithTTL(ctx context.Context, rdb *redis.Client, key string, ttl time.Duration) (int64, error) {
	n, err := rdb.Incr(ctx, key).Result()
	if err != nil {
		return 0, err
	}
	if n == 1 {
		if err := rdb.Expire(ctx, key, ttl).Err(); err != nil {
			return n, err
		}
	}
	return n, nil
}

// randomDigits 返回 n 位十进制验证码，取自密码学安全随机源。
//
// 刻意不用 math/rand：验证码是安全凭据，可预测即可被枚举。
func randomDigits(n int) (string, error) {
	b := make([]byte, n)
	for i := range b {
		v, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			return "", err
		}
		b[i] = byte('0' + v.Int64())
	}
	return string(b), nil
}

// randomToken 返回 n 字节密码学随机数的 URL-safe base64 编码。
func randomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// ErrOldPasswordWrong 表示改密时提供的当前密码不正确。
var ErrOldPasswordWrong = errors.New("old password is incorrect")

// ChangePassword 校验当前密码后改密（登录态直接改，不走短信验证码）。
//
// 与三段式重置的区别只在凭据来源：那条链路用短信验证码证明手机号归属，
// 这条用当前密码证明本人在场。收尾完全一致 —— 同样递增 token_version，
// 因此改密后该用户所有设备（含当前设备）的既有令牌立即失效，调用方需要重新登录。
//
// 当前密码错误返回 ErrOldPasswordWrong；新密码不合复杂度返回 *WeakPasswordError；
// 账号被封禁返回 ErrUserBanned。三者都不会写库。
func (s *AuthService) ChangePassword(ctx context.Context, userID, oldPassword, newPassword string) error {
	uid, err := uuid.Parse(userID)
	if err != nil {
		return ErrUserNotFound
	}
	user, err := s.repo.FindByID(ctx, uid)
	if err != nil {
		return fmt.Errorf("find user: %w", err)
	}
	if user == nil {
		return ErrUserNotFound
	}
	if user.Status == model.UserStatusDisabled {
		return ErrUserBanned
	}
	// 先验旧密码再验新密码强度：否则「旧密码填错 + 新密码太弱」时会先暴露强度规则，
	// 等于给不知道旧密码的人提供了一个可用的探针
	if !password.Verify(user.PasswordHash, oldPassword) {
		return ErrOldPasswordWrong
	}
	if err := ValidatePasswordStrength(newPassword); err != nil {
		return err
	}

	hash, err := password.Hash(newPassword)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	if err := s.repo.UpdatePasswordAndBumpTokenVersion(ctx, userID, hash); err != nil {
		return fmt.Errorf("update password: %w", err)
	}

	s.logger.Info("密码已修改，该用户旧令牌全部失效", zap.String("user_id", userID))
	return nil
}
