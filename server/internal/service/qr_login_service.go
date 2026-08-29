// 扫码登录承载 pending → scanned → confirmed 状态机。
//
// 状态全程只活在 Redis：会话是 120 秒即焚的临时凭据，落库只会留下一张需要清理的垃圾表。

package service

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/pkg/jwt"
	"go.uber.org/zap"
)

// QRStatus 是扫码会话的状态。
type QRStatus string

// 扫码会话的三个状态。状态只能单向前进，跳级或回退一律拒绝。
const (
	QRPending   QRStatus = "pending"
	QRScanned   QRStatus = "scanned"
	QRConfirmed QRStatus = "confirmed"
)

// 扫码会话的时限与格式约定，取自设计文档，改动直接影响安全边界。
const (
	qrTTL           = 120 * time.Second
	qrTokenBytes    = 32
	qrSecretBytes   = 32
	qrPayloadPrefix = "yuanchat://login?t="
)

// qrDevices 是被扫端可声明的平台标识白名单。
//
// 该值会被原样写进令牌的 did 声明，因此只接受枚举内的值，不接受任意字符串。
var qrDevices = map[string]struct{}{
	"web":     {},
	"desktop": {},
}

// 扫码登录可能返回的错误。
var (
	ErrQRNotFound  = errors.New("qr session not found")
	ErrQRBadState  = errors.New("qr session state mismatch")
	ErrQRWrongUser = errors.New("qr session belongs to another user")
	ErrQRBadDevice = errors.New("unsupported qr device id")
	ErrQRBadSecret = errors.New("qr poll secret mismatch")
)

// QRSession 是创建扫码会话后交给被扫端的内容。
type QRSession struct {
	// QRToken 一次性会话凭据，32 字节密码学随机数的 base64url 编码
	QRToken string `json:"qr_token"`
	// QRPayload 二维码里实际编码的串，带 scheme 前缀供扫码端校验
	QRPayload string `json:"qr_payload"`
	// ExpiresIn 会话剩余有效期秒数，前端倒计时以此初始化
	ExpiresIn int `json:"expires_in"`
	// PollSecret 轮询凭据，只交给发起端，绝不进 QRPayload
	//
	// 二维码里明文带着 QRToken，被拍照即泄露；没有这个密钥，
	// 拍到二维码的人就无法在受害者确认的那一刻抢先取走令牌。
	PollSecret string `json:"poll_secret"`
}

// QRPollResult 是被扫端轮询的结果。
type QRPollResult struct {
	// Status 会话当前状态
	Status QRStatus `json:"status"`
	// ExpiresIn 会话剩余有效期秒数；confirmed 时会话已销毁，固定为 0
	ExpiresIn int `json:"expires_in"`
	// Tokens 仅在 confirmed 的那一次返回，取走即销毁会话
	Tokens *jwt.TokenPair `json:"tokens,omitempty"`
}

// QRScanResult 是扫码端标记已扫后拿回的自身身份，用于确认页展示「我是谁」。
type QRScanResult struct {
	Nickname  string  `json:"nickname"`
	AvatarURL *string `json:"avatar_url"`
}

// qrKey 拼接带命名空间的会话键。
func qrKey(qrToken string) string { return "auth:qr:" + qrToken }

// qrFieldPollSecret 是会话 Hash 里存放轮询密钥的字段名。
const qrFieldPollSecret = "poll_secret"

// qrAdvance 原子地校验会话状态与归属再推进，附带写入任意字段。
//
// 必须走脚本而不是「先读、判断、再写」：两台手机同时扫同一个码时，
// 后者会在前者判断与写入之间挤进来，两边都拿到成功。
//
// KEYS[1]=会话键 ARGV[1]=期望的当前状态 ARGV[2]=目标状态 ARGV[3]=用户 ID
// ARGV[4..]=追加写入的字段名与值，成对出现
// 返回 0=成功 1=会话不存在 2=状态不匹配 3=用户不匹配
var qrAdvance = redis.NewScript(`
local st = redis.call('HGET', KEYS[1], 'status')
if not st then return 1 end
if st ~= ARGV[1] then return 2 end
local uid = redis.call('HGET', KEYS[1], 'user_id')
if uid and uid ~= '' and uid ~= ARGV[3] then return 3 end
redis.call('HSET', KEYS[1], 'status', ARGV[2])
redis.call('HSET', KEYS[1], 'user_id', ARGV[3])
for i = 4, #ARGV, 2 do
  redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1])
end
return 0
`)

// qrClaim 原子地读状态，并在状态已确认时取走令牌并销毁会话。
//
// 删除与读取必须在同一个脚本里：分成两步的话，两次并发轮询会在删除之前都读到令牌，
// 同一个码就换出了两套令牌。
//
// KEYS[1]=会话键 ARGV[1]=confirmed 状态字面量
// 返回空表=会话不存在；{status, ttl}=尚未确认；{status, "0", access, refresh, expires_in}=已确认
var qrClaim = redis.NewScript(`
local st = redis.call('HGET', KEYS[1], 'status')
if not st then return {} end
if st ~= ARGV[1] then
  return {st, tostring(redis.call('TTL', KEYS[1]))}
end
local at = redis.call('HGET', KEYS[1], 'access_token') or ''
local rt = redis.call('HGET', KEYS[1], 'refresh_token') or ''
local ei = redis.call('HGET', KEYS[1], 'token_expires_in') or '0'
redis.call('DEL', KEYS[1])
return {st, '0', at, rt, ei}
`)

// CreateQRSession 创建扫码会话，返回二维码内容、有效期与只交给发起端的轮询密钥。
//
// deviceID 是被扫端声明的平台标识（web / desktop），空串按 web 处理；
// 换出的令牌用它当 did，因为扫码登录的设备是被扫端而不是扫码端。
// qrToken 是 32 字节密码学随机数：它是这条链路的公开凭据，猜中即等于窃取一次登录，
// 因此绝不能用可预测的自增或 math/rand。
// pollSecret 同规格随机数，但只出现在响应里、不进二维码：轮询取令牌必须同时持有它。
func (s *AuthService) CreateQRSession(ctx context.Context, deviceID string) (*QRSession, error) {
	if deviceID == "" {
		deviceID = "web"
	}
	if _, ok := qrDevices[deviceID]; !ok {
		return nil, ErrQRBadDevice
	}

	qrToken, err := randomToken(qrTokenBytes)
	if err != nil {
		return nil, fmt.Errorf("generate qr token: %w", err)
	}
	pollSecret, err := randomToken(qrSecretBytes)
	if err != nil {
		return nil, fmt.Errorf("generate qr poll secret: %w", err)
	}

	pipe := s.rdb.TxPipeline()
	pipe.HSet(ctx, qrKey(qrToken),
		"status", string(QRPending),
		"user_id", "",
		"device_id", deviceID,
		qrFieldPollSecret, pollSecret,
	)
	pipe.Expire(ctx, qrKey(qrToken), qrTTL)
	if _, err := pipe.Exec(ctx); err != nil {
		return nil, fmt.Errorf("store qr session: %w", err)
	}

	return &QRSession{
		QRToken:    qrToken,
		QRPayload:  qrPayloadPrefix + qrToken,
		ExpiresIn:  int(qrTTL.Seconds()),
		PollSecret: pollSecret,
	}, nil
}

// PollQRSession 查询会话状态；状态为 confirmed 时取走令牌并销毁会话。
//
// pollSecret 必须与建会话时下发给发起端的密钥一致，否则连状态都不返回：
// 二维码可以被拍照，密钥不会，所以它才是「轮询者就是发起方」的唯一证明。
// 会话不存在与已过期返回同一个错误：区分二者会让攻击者能探测某个码是否曾经存在。
func (s *AuthService) PollQRSession(ctx context.Context, qrToken, pollSecret string) (*QRPollResult, error) {
	want, err := s.rdb.HGet(ctx, qrKey(qrToken), qrFieldPollSecret).Result()
	if errors.Is(err, redis.Nil) {
		return nil, ErrQRNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read qr poll secret: %w", err)
	}
	// 定长比较，不用 == ：逐字节短路会把密钥的正确前缀长度泄露成响应时间
	if subtle.ConstantTimeCompare([]byte(want), []byte(pollSecret)) != 1 {
		return nil, ErrQRBadSecret
	}

	vals, err := qrClaim.Run(ctx, s.rdb, []string{qrKey(qrToken)}, string(QRConfirmed)).StringSlice()
	if errors.Is(err, redis.Nil) {
		return nil, ErrQRNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("poll qr session: %w", err)
	}
	switch len(vals) {
	case 0:
		return nil, ErrQRNotFound
	case 2:
		expiresIn := parseIntOrZero(vals[1])
		// TTL 返回负数意味着键已在读状态与读 TTL 之间过期，按不存在处理
		if expiresIn < 0 {
			return nil, ErrQRNotFound
		}
		return &QRPollResult{Status: QRStatus(vals[0]), ExpiresIn: expiresIn}, nil
	default:
		return &QRPollResult{
			Status:    QRStatus(vals[0]),
			ExpiresIn: 0,
			Tokens: &jwt.TokenPair{
				AccessToken:  vals[2],
				RefreshToken: vals[3],
				ExpiresIn:    int64(parseIntOrZero(vals[4])),
			},
		}, nil
	}
}

// ScanQRSession 把会话从 pending 推进到 scanned，并返回扫码端自身的身份。
//
// 封禁与注销账号在推进状态之前就被拦下：它们连「已扫描」都不该让被扫端看到。
func (s *AuthService) ScanQRSession(ctx context.Context, qrToken string, userID uuid.UUID) (*QRScanResult, error) {
	user, err := s.qrScanner(ctx, qrToken, userID)
	if err != nil {
		return nil, err
	}

	if err := s.qrAdvanceState(ctx, qrToken, QRPending, QRScanned, userID,
		"scanned_at", time.Now().UTC().Format(time.RFC3339)); err != nil {
		return nil, err
	}

	s.logger.Info("扫码会话已标记为已扫描", zap.String("user_id", userID.String()))
	return &QRScanResult{Nickname: user.Nickname, AvatarURL: user.AvatarURL}, nil
}

// ConfirmQRSession 把会话从 scanned 推进到 confirmed，并写入待被扫端取走的令牌。
//
// 令牌先签发再原子推进：推进失败时令牌根本不会落进会话，
// 因此状态或归属不匹配的请求拿不到任何东西。
func (s *AuthService) ConfirmQRSession(ctx context.Context, qrToken string, userID uuid.UUID) error {
	user, err := s.qrScanner(ctx, qrToken, userID)
	if err != nil {
		return err
	}

	deviceID, err := s.rdb.HGet(ctx, qrKey(qrToken), "device_id").Result()
	if errors.Is(err, redis.Nil) {
		return ErrQRNotFound
	}
	if err != nil {
		return fmt.Errorf("read qr device: %w", err)
	}
	if _, ok := qrDevices[deviceID]; !ok {
		deviceID = "web"
	}

	// tv 用库中当前值：改密后的旧令牌应当失效，与 Refresh 的校验保持同源
	pair, err := s.jwtGen.GeneratePair(user.ID, deviceID, user.TokenVersion)
	if err != nil {
		return fmt.Errorf("generate tokens: %w", err)
	}

	if err := s.qrAdvanceState(ctx, qrToken, QRScanned, QRConfirmed, userID,
		"access_token", pair.AccessToken,
		"refresh_token", pair.RefreshToken,
		"token_expires_in", fmt.Sprint(pair.ExpiresIn),
	); err != nil {
		return err
	}

	s.logger.Info("扫码会话已确认授权",
		zap.String("user_id", userID.String()), zap.String("device_id", deviceID))
	return nil
}

// qrScanner 校验会话仍然存在、扫码端账号可用，并返回该账号。
//
// 先探一次会话存在与否，是为了让伪造的码在触达数据库之前就被挡掉；
// 真正的状态与归属判定仍在 qrAdvanceState 的原子脚本里，这里只是提前返回。
func (s *AuthService) qrScanner(ctx context.Context, qrToken string, userID uuid.UUID) (*model.User, error) {
	exists, err := s.rdb.Exists(ctx, qrKey(qrToken)).Result()
	if err != nil {
		return nil, fmt.Errorf("check qr session: %w", err)
	}
	if exists == 0 {
		return nil, ErrQRNotFound
	}

	user, err := s.repo.FindByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("find user: %w", err)
	}
	// 账号已注销与已封禁回同一个错误：都不该授权登录，也不该借此探出账号状态
	if user == nil || user.Status == model.UserStatusDisabled {
		return nil, ErrUserBanned
	}
	return user, nil
}

// qrAdvanceState 按状态机推进会话，并把脚本返回码翻译成哨兵错误。
func (s *AuthService) qrAdvanceState(
	ctx context.Context,
	qrToken string,
	from, to QRStatus,
	userID uuid.UUID,
	fields ...string,
) error {
	args := make([]any, 0, 3+len(fields))
	args = append(args, string(from), string(to), userID.String())
	for _, f := range fields {
		args = append(args, f)
	}

	code, err := qrAdvance.Run(ctx, s.rdb, []string{qrKey(qrToken)}, args...).Int()
	if err != nil {
		return fmt.Errorf("advance qr session: %w", err)
	}
	switch code {
	case 0:
		return nil
	case 1:
		return ErrQRNotFound
	case 2:
		return ErrQRBadState
	default:
		return ErrQRWrongUser
	}
}

// parseIntOrZero 把脚本回传的十进制字符串转成整数，非法输入按 0 处理。
func parseIntOrZero(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0
	}
	return n
}
