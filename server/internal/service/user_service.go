package service

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/pkg/jwt"
	"github.com/yuanchat/server/internal/pkg/password"
	"github.com/yuanchat/server/internal/pkg/shortid"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
)

// UserService 可能返回的错误。
var (
	ErrDuplicateUser   = errors.New("phone or email already registered")
	ErrInvalidPassword = errors.New("invalid password")
	ErrUserNotFound    = errors.New("user not found")
	ErrInvalidRefresh  = errors.New("invalid or expired refresh token")
	ErrUserBanned      = errors.New("user is banned")
	ErrWeakPassword    = errors.New("weak password")
	ErrAccountLocked   = errors.New("account locked by too many failed logins")
)

// 密码复杂度校验失败时回给前端的 i18n key（按 R7 约定放进响应 message 字段）。
//
// 六条规则与前端 validatePassword 一一对应，都能由用户在 UI 上触发，
// 四个 locale 均有对应文案。后端独立再校验一遍，是因为前端校验可被绕过。
const (
	msgPasswordMinLength    = "validation.passwordMinLength"
	msgPasswordMaxLength    = "validation.passwordMaxLength"
	msgPasswordLowercase    = "validation.passwordLowercase"
	msgPasswordUppercase    = "validation.passwordUppercase"
	msgPasswordDigit        = "validation.passwordDigit"
	msgPasswordNoWhitespace = "validation.passwordNoWhitespace"
)

// WeakPasswordError 表示密码不满足复杂度要求，并携带命中规则的 i18n key。
type WeakPasswordError struct {
	// MessageKey 命中的规则对应的 i18n key，如 validation.passwordDigit
	MessageKey string
}

func (e *WeakPasswordError) Error() string { return "weak password: " + e.MessageKey }

// Unwrap 让调用方可以只判哨兵：errors.Is(err, ErrWeakPassword)。
func (e *WeakPasswordError) Unwrap() error { return ErrWeakPassword }

// ValidatePasswordStrength 校验密码复杂度：长度 8-64、同时含小写 / 大写 / 数字、不含空白字符。
//
// 注册与改密两条路径共用，否则绕过前端直连接口即可把密码设成 12345678。
// 长度按字节计而非字符：bcrypt 只取前 72 字节，按字符放行会让多字节密码被静默截断。
//
// 规则以 spec / constraints 为准，与前端 validatePassword 并不完全等价——
// 前端另有「必须含特殊字符」且不限上限、不禁空白，两侧差异以前后端各自的
// 实现文档为准，此处只保证服务端下限。
func ValidatePasswordStrength(pw string) error {
	if len(pw) < 8 {
		return &WeakPasswordError{MessageKey: msgPasswordMinLength}
	}
	if len(pw) > 64 {
		return &WeakPasswordError{MessageKey: msgPasswordMaxLength}
	}

	var hasLower, hasUpper, hasDigit bool
	for _, r := range pw {
		switch {
		case unicode.IsSpace(r):
			return &WeakPasswordError{MessageKey: msgPasswordNoWhitespace}
		case unicode.IsLower(r):
			hasLower = true
		case unicode.IsUpper(r):
			hasUpper = true
		case unicode.IsDigit(r):
			hasDigit = true
		}
	}
	switch {
	case !hasLower:
		return &WeakPasswordError{MessageKey: msgPasswordLowercase}
	case !hasUpper:
		return &WeakPasswordError{MessageKey: msgPasswordUppercase}
	case !hasDigit:
		return &WeakPasswordError{MessageKey: msgPasswordDigit}
	}
	return nil
}

// UserService 负责注册、登录与个人资料相关的业务逻辑。
type UserService struct {
	repo   *repository.UserRepository
	jwtGen *jwt.Generator
	sidGen *shortid.Generator
	rdb    *redis.Client
	logger *zap.Logger

	// UGC 审核：昵称 / bio 命中敏感词时照常写入，但记入 flagged_ugc 审核队列。
	// 两者均可为 nil（未接线或未配置词库时跳过审核）。
	moderation *ModerationService
	ugcRepo    *repository.FlaggedUGCRepository
}

// SetUGCModeration 注入 UGC 敏感词审核依赖（router 接线用）。
func (s *UserService) SetUGCModeration(m *ModerationService, r *repository.FlaggedUGCRepository) {
	s.moderation = m
	s.ugcRepo = r
}

// flagUGC 记录一条 UGC 敏感词命中。记录失败只告警不回滚业务写入——
// 与 messages.flagged 一致，打标不阻塞；审核队列少一条记录的代价远小于
// 用户资料改不动的代价。
func (s *UserService) flagUGC(ctx context.Context, ugcType, content, hitWord string, userID uuid.UUID) {
	rec := &model.FlaggedUGC{
		UGCType: ugcType,
		Content: content,
		HitWord: hitWord,
		UserID:  &userID,
	}
	if err := s.ugcRepo.Create(ctx, rec); err != nil {
		s.logger.Warn("record flagged ugc failed",
			zap.String("ugc_type", ugcType), zap.String("user_id", userID.String()), zap.Error(err))
	}
}

// NewUserService 构造用户服务。
//
// rdb 承载账号级登录失败计数，Login 无条件依赖它：
// 不接 Redis 就没有撞库防护，因此这里不做「未注入即跳过」的降级。
func NewUserService(repo *repository.UserRepository, jwtGen *jwt.Generator, sidGen *shortid.Generator, rdb *redis.Client, logger *zap.Logger) *UserService {
	return &UserService{repo: repo, jwtGen: jwtGen, sidGen: sidGen, rdb: rdb, logger: logger}
}

// RegisterRequest 是注册新账号的入参。
type RegisterRequest struct {
	Phone    string `json:"phone"`
	Email    string `json:"email"`
	Password string `json:"password"`
	Nickname string `json:"nickname"`
}

// LoginRequest 是登录认证的入参。
type LoginRequest struct {
	Account  string `json:"account"` // phone or email
	Password string `json:"password"`
}

// AuthResult 是登录 / 注册成功后返回的令牌与用户信息。
type AuthResult struct {
	User         model.User    `json:"user"`
	TokenPair    jwt.TokenPair `json:"-"`
	AccessToken  string        `json:"access_token"`
	RefreshToken string        `json:"refresh_token"`
	ExpiresIn    int64         `json:"expires_in"`
}

// Register 创建新账号并返回 JWT 令牌。
func (s *UserService) Register(ctx context.Context, req RegisterRequest) (*AuthResult, error) {
	// 密码复杂度：handler 的 binding 只管 8-64 长度，弱密码要在此拦下
	if err := ValidatePasswordStrength(req.Password); err != nil {
		return nil, err
	}

	// 生成短号
	shortID, err := s.sidGen.Next(ctx)
	if err != nil {
		return nil, fmt.Errorf("generate short id: %w", err)
	}

	// 查重
	exists, err := s.repo.ExistsByPhoneOrEmail(ctx, req.Phone, req.Email)
	if err != nil {
		return nil, fmt.Errorf("check duplicate: %w", err)
	}
	if exists {
		return nil, ErrDuplicateUser
	}

	// 哈希密码
	hash, err := password.Hash(req.Password)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	user := &model.User{
		ID:           uuid.New(),
		ShortID:      shortID,
		Phone:        strPtr(req.Phone),
		Email:        strPtr(req.Email),
		PasswordHash: hash,
		Nickname:     req.Nickname,
	}

	if err := s.repo.Create(ctx, user); err != nil {
		return nil, fmt.Errorf("create user: %w", err)
	}

	// 注册昵称同样过敏感词审核（打标不阻塞）：与 UpdateProfile 同一语义，
	// 否则注册阶段就是审核队列绕过点——违规昵称只要注册后不再改资料就查无记录。
	if s.moderation != nil && s.ugcRepo != nil && req.Nickname != "" {
		if hit := s.moderation.Check(req.Nickname); hit != "" {
			s.flagUGC(ctx, model.UGCTypeNickname, req.Nickname, hit, user.ID)
		}
	}

	s.logger.Info("User registered", zap.String("user_id", user.ID.String()))

	return s.buildAuthResult(*user, "web")
}

// 账号级登录失败锁定的阈值与窗口，取自设计文档，改动直接影响安全边界。
const (
	loginFailMax = 5
	loginFailTTL = 15 * time.Minute
)

// loginFailKey 返回账号维度的登录失败计数键。
//
// 键一律带 auth: 命名空间，避免与既有 captcha 的裸键混在一起；
// 账号统一转小写，否则邮箱换个大小写就换到另一个计数器上，锁定形同虚设。
func loginFailKey(account string) string {
	return "auth:login:fail:" + strings.ToLower(account)
}

// bumpLoginFailure 递增账号的失败计数。
//
// 写失败只记日志不阻断：此时凭据本来就是错的，不该把 Redis 故障变成另一种响应。
func (s *UserService) bumpLoginFailure(ctx context.Context, key string) {
	if _, err := incrWithTTL(ctx, s.rdb, key, loginFailTTL); err != nil {
		s.logger.Warn("递增登录失败计数失败", zap.Error(err))
	}
}

// Login 用「手机号 / 邮箱 + 密码」认证用户并返回 JWT 令牌。
//
// 连续失败达 loginFailMax 次的账号在 loginFailTTL 内一律拒绝，登录成功则清零计数。
func (s *UserService) Login(ctx context.Context, req LoginRequest) (*AuthResult, error) {
	// 账号维度的失败锁定：middleware.LimitByIP 只按 IP 计数且限流器是进程内的，
	// 攻击者换 IP 即可对同一账号无限撞密码。判断排在查库与密码校验之前——
	// bcrypt 故意很慢，锁定期还去跑它等于替攻击者承担 CPU 开销。
	failKey := loginFailKey(req.Account)
	fails, err := s.rdb.Get(ctx, failKey).Int()
	if err != nil && !errors.Is(err, redis.Nil) {
		return nil, fmt.Errorf("read login fail counter: %w", err)
	}
	if fails >= loginFailMax {
		s.logger.Warn("账号连续登录失败已达上限，拒绝登录", zap.Int("fails", fails))
		return nil, ErrAccountLocked
	}

	// 按手机号、邮箱或元聊号查用户
	var user *model.User

	if strings.Contains(req.Account, "@") {
		user, err = s.repo.FindByEmail(ctx, req.Account)
	} else {
		user, err = s.repo.FindByPhone(ctx, req.Account)
		// 元聊号登录：登录框标的就是「元聊号」，设置页与名片页又把它做成可复制的身份，
		// 用户自然会拿它来登录。先手机号后短号，反过来会让手机号登录白查一次；
		// 两者也不会串：短号从 10000 起递增，要撞上 11 位手机号得有上百亿用户。
		if err == nil && user == nil {
			if shortID, convErr := strconv.ParseInt(req.Account, 10, 64); convErr == nil {
				user, err = s.repo.FindByShortID(ctx, shortID)
			}
		}
	}
	if err != nil {
		return nil, fmt.Errorf("find user: %w", err)
	}
	if user == nil {
		// 未注册账号同样计数：只对已注册账号计数的话，
		// 「第 6 次是锁定还是凭据错误」就成了账号是否存在的探针
		s.bumpLoginFailure(ctx, failKey)
		return nil, ErrUserNotFound
	}

	// 校验密码
	if !password.Verify(user.PasswordHash, req.Password) {
		s.bumpLoginFailure(ctx, failKey)
		return nil, ErrInvalidPassword
	}

	// 封禁用户拒绝登录
	if user.Status == model.UserStatusDisabled {
		return nil, ErrUserBanned
	}

	// 登录成功清零计数：不清零则历史失败会一直累积，
	// 攒够阈值后用户某天用正确密码登录也会开局即锁
	if err := s.rdb.Del(ctx, failKey).Err(); err != nil {
		s.logger.Warn("清零登录失败计数失败", zap.Error(err))
	}

	// 记录本次登录时间，写失败不阻塞登录
	if err := s.repo.TouchLastLogin(ctx, user.ID); err != nil {
		s.logger.Warn("更新 last_login_at 失败",
			zap.String("user_id", user.ID.String()), zap.Error(err))
	}

	s.logger.Info("User logged in", zap.String("user_id", user.ID.String()))

	return s.buildAuthResult(*user, "web")
}

// Profile 返回当前用户的个人资料。
func (s *UserService) Profile(ctx context.Context, userID uuid.UUID) (*model.User, error) {
	user, err := s.repo.FindByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("find user: %w", err)
	}
	// FindByID 对未命中返回 (nil, nil)，须转成领域错误，防止调用方解引用 nil
	if user == nil {
		return nil, ErrUserNotFound
	}
	return user, nil
}

// ProfilePatch 资料更新补丁：nil 字段表示本次不改。
type ProfilePatch struct {
	Nickname  *string
	AvatarURL *string
	Bio       *string
	Gender    *int16

	// StatusEmoji / StatusText 个人状态。传空串表示清除状态。
	StatusEmoji *string
	StatusText  *string
	// StatusDuration 状态有效秒数：0 或 nil 表示不自动清除。
	//
	// 收秒数而非绝对过期时刻：客户端时钟可能偏移，直接收 expires_at 会让
	// 快了几分钟的设备把状态写成「一设置就已过期」。「今天」这类语义由
	// 客户端按本地时区换算成秒数，服务端不猜时区。
	StatusDuration *int64
}

// UpdateProfile 更新用户资料字段（patch 中 nil 表示不改），持久化后返回最新 user。
func (s *UserService) UpdateProfile(
	ctx context.Context,
	userID uuid.UUID,
	patch ProfilePatch,
) (*model.User, error) {
	user, err := s.repo.FindByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("find user: %w", err)
	}
	if user == nil {
		return nil, ErrUserNotFound
	}

	if patch.Nickname != nil {
		user.Nickname = *patch.Nickname
	}
	if patch.AvatarURL != nil {
		user.AvatarURL = patch.AvatarURL
	}
	if patch.Bio != nil {
		user.Bio = patch.Bio
	}
	if patch.Gender != nil {
		user.Gender = *patch.Gender
	}
	if patch.StatusEmoji != nil {
		user.StatusEmoji = *patch.StatusEmoji
	}
	if patch.StatusText != nil {
		user.StatusText = *patch.StatusText
	}
	// 只要本次提交涉及状态，就重算过期时刻
	if patch.StatusEmoji != nil || patch.StatusText != nil {
		if patch.StatusDuration != nil && *patch.StatusDuration > 0 {
			exp := time.Now().Add(time.Duration(*patch.StatusDuration) * time.Second)
			user.StatusExpiresAt = &exp
		} else {
			user.StatusExpiresAt = nil
		}
	}

	if err := s.repo.Update(ctx, user); err != nil {
		return nil, fmt.Errorf("update user: %w", err)
	}

	// 敏感词审核（打标不阻塞）：只对本次实际提交的字段打标，命中照常写库
	if s.moderation != nil && s.ugcRepo != nil {
		if patch.Nickname != nil {
			if hit := s.moderation.Check(*patch.Nickname); hit != "" {
				s.flagUGC(ctx, model.UGCTypeNickname, *patch.Nickname, hit, userID)
			}
		}
		if patch.Bio != nil {
			if hit := s.moderation.Check(*patch.Bio); hit != "" {
				s.flagUGC(ctx, model.UGCTypeBio, *patch.Bio, hit, userID)
			}
		}
	}
	return user, nil
}

// Refresh 用有效的 refresh 令牌换取全新的令牌对。
//
// 滑动会话（轮换）策略：access 与 refresh 都重新签发、各自重置 TTL，
// 持续活跃的用户永不掉线。旧 refresh 在剩余有效期内仍可用（无服务端存储）。
//
// 这里是 token_version 的两个校验点之一（另一个是 WS 建连）：本方法本来就要
// FindByID，因此补上封禁与版本校验是零额外 I/O。
func (s *UserService) Refresh(ctx context.Context, refreshToken string) (*jwt.TokenPair, error) {
	claims, err := s.jwtGen.Validate(refreshToken)
	if err != nil || claims.TokenUse != "refresh" {
		return nil, ErrInvalidRefresh
	}

	user, err := s.repo.FindByID(ctx, claims.UserID)
	if err != nil {
		return nil, fmt.Errorf("find user: %w", err)
	}
	// 账号已注销
	if user == nil {
		return nil, ErrInvalidRefresh
	}
	// 封禁用户不得续期
	if user.Status == model.UserStatusDisabled {
		return nil, ErrUserBanned
	}
	// 改密后 token_version 递增，早先签发的 refresh 令牌随即失效
	if claims.TokenVersion != user.TokenVersion {
		return nil, ErrInvalidRefresh
	}

	pair, err := s.jwtGen.GeneratePair(claims.UserID, claims.DeviceID, user.TokenVersion)
	if err != nil {
		return nil, fmt.Errorf("generate tokens: %w", err)
	}
	return pair, nil
}

func (s *UserService) buildAuthResult(user model.User, deviceID string) (*AuthResult, error) {
	pair, err := s.jwtGen.GeneratePair(user.ID, deviceID, user.TokenVersion)
	if err != nil {
		return nil, fmt.Errorf("generate tokens: %w", err)
	}

	return &AuthResult{
		User:         user,
		TokenPair:    *pair,
		AccessToken:  pair.AccessToken,
		RefreshToken: pair.RefreshToken,
		ExpiresIn:    pair.ExpiresIn,
	}, nil
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
