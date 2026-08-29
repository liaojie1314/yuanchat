package service

import (
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/pkg/jwt"
	"github.com/yuanchat/server/internal/repository"
	"github.com/yuanchat/server/internal/testutil"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// qrFixture 聚合扫码链路所需的真实依赖：dev 库 + 进程内 redis + 真实签发器。
//
// 签发器用真实实现而非替身，才能把「令牌里的 uid / did / tv 是否正确」也一起断言掉。
type qrFixture struct {
	svc *AuthService
	rdb *redis.Client
	mr  *miniredis.Miniredis
	db  *gorm.DB
	gen *jwt.Generator
}

func newQRFixture(t *testing.T) *qrFixture {
	t.Helper()
	db := testDB(t)
	rdb, mr := testutil.NewRedis(t)
	gen := jwt.NewGenerator("qr-login-test-secret", 15*time.Minute, 7*24*time.Hour)
	svc := NewAuthService(
		repository.NewUserRepository(db),
		repository.NewVerificationCodeRepository(db),
		rdb, &fakeSender{}, gen, zap.NewNop(),
	)
	return &qrFixture{svc: svc, rdb: rdb, mr: mr, db: db, gen: gen}
}

// ban 把用户置为封禁态。
func (f *qrFixture) ban(t *testing.T, id uuid.UUID) {
	t.Helper()
	if err := f.db.Model(&model.User{}).Where("id = ?", id).
		Update("status", model.UserStatusDisabled).Error; err != nil {
		t.Fatalf("封禁用户失败: %v", err)
	}
}

// ttl 返回会话键的剩余存活时间。
func (f *qrFixture) ttl(t *testing.T, qrToken string) time.Duration {
	t.Helper()
	d, err := f.rdb.TTL(context.Background(), "auth:qr:"+qrToken).Result()
	if err != nil {
		t.Fatalf("读取 TTL 失败: %v", err)
	}
	return d
}

// TestQRSessionCreatesPendingSessionWithTTL 会话键必须带命名空间前缀且 TTL 为 120 秒。
func TestQRSessionCreatesPendingSessionWithTTL(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()

	sess, err := f.svc.CreateQRSession(ctx, "web")
	if err != nil {
		t.Fatalf("创建会话失败: %v", err)
	}
	if sess.ExpiresIn != 120 {
		t.Fatalf("expires_in = %d, want 120", sess.ExpiresIn)
	}
	if want := "yuanchat://login?t=" + sess.QRToken; sess.QRPayload != want {
		t.Fatalf("qr_payload = %q, want %q", sess.QRPayload, want)
	}
	if d := f.ttl(t, sess.QRToken); d <= 119*time.Second || d > 120*time.Second {
		t.Fatalf("会话 TTL = %v, want ≈120s", d)
	}

	got, err := f.svc.PollQRSession(ctx, sess.QRToken, sess.PollSecret)
	if err != nil {
		t.Fatalf("轮询失败: %v", err)
	}
	if got.Status != QRPending {
		t.Fatalf("status = %q, want pending", got.Status)
	}
	if got.ExpiresIn <= 0 {
		t.Fatalf("轮询必须回剩余秒数供前端倒计时，got %d", got.ExpiresIn)
	}
	if got.Tokens != nil {
		t.Fatal("pending 阶段不得下发令牌")
	}
}

// TestQRSessionTokenIsThirtyTwoRandomBytes 扫码码是唯一凭据，必须是 32 字节随机数且不重复。
//
// 二维码会被拍照、可能留在相册里，长度与熵不足即等于账号可被猜中。
func TestQRSessionTokenIsThirtyTwoRandomBytes(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()

	seen := make(map[string]struct{}, 16)
	for i := 0; i < 16; i++ {
		sess, err := f.svc.CreateQRSession(ctx, "web")
		if err != nil {
			t.Fatalf("创建会话失败: %v", err)
		}
		raw, err := base64.RawURLEncoding.DecodeString(sess.QRToken)
		if err != nil {
			t.Fatalf("qr_token 不是 base64url: %v", err)
		}
		if len(raw) != 32 {
			t.Fatalf("qr_token 解码后 = %d 字节, want 32", len(raw))
		}
		if _, dup := seen[sess.QRToken]; dup {
			t.Fatalf("qr_token 重复: %q", sess.QRToken)
		}
		seen[sess.QRToken] = struct{}{}
	}
}

// TestQRSessionRejectsUnknownDevice 平台标识只接受白名单内的值。
//
// 该值会被原样写进令牌的 did 声明，放任任意字符串等于给了写入点。
func TestQRSessionRejectsUnknownDevice(t *testing.T) {
	f := newQRFixture(t)

	if _, err := f.svc.CreateQRSession(context.Background(), "android"); !errors.Is(err, ErrQRBadDevice) {
		t.Fatalf("err = %v, want ErrQRBadDevice", err)
	}
}

// TestQRHappyPathIssuesTokensForScanner 令牌属于扫码端用户，did 取被扫端声明的平台标识。
func TestQRHappyPathIssuesTokensForScanner(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()
	user := newTestUser(t, f.db, "qr-happy")

	sess, err := f.svc.CreateQRSession(ctx, "desktop")
	if err != nil {
		t.Fatalf("创建会话失败: %v", err)
	}
	if _, err := f.svc.ScanQRSession(ctx, sess.QRToken, user.ID); err != nil {
		t.Fatalf("标记已扫失败: %v", err)
	}
	if err := f.svc.ConfirmQRSession(ctx, sess.QRToken, user.ID); err != nil {
		t.Fatalf("确认授权失败: %v", err)
	}

	got, err := f.svc.PollQRSession(ctx, sess.QRToken, sess.PollSecret)
	if err != nil {
		t.Fatalf("轮询失败: %v", err)
	}
	if got.Status != QRConfirmed {
		t.Fatalf("status = %q, want confirmed", got.Status)
	}
	if got.Tokens == nil || got.Tokens.AccessToken == "" || got.Tokens.RefreshToken == "" {
		t.Fatalf("confirmed 必须回令牌对: %+v", got)
	}

	claims, err := f.gen.Validate(got.Tokens.AccessToken)
	if err != nil {
		t.Fatalf("解析 access 令牌失败: %v", err)
	}
	if claims.UserID != user.ID {
		t.Fatalf("uid = %s, want %s（令牌必须属于扫码端用户）", claims.UserID, user.ID)
	}
	if claims.DeviceID != "desktop" {
		t.Fatalf("did = %q, want desktop（取被扫端声明的平台标识）", claims.DeviceID)
	}
	if claims.TokenVersion != user.TokenVersion {
		t.Fatalf("tv = %d, want %d", claims.TokenVersion, user.TokenVersion)
	}
}

// TestQRSessionDefaultsDeviceToWeb 未声明平台标识时按 web 处理。
func TestQRSessionDefaultsDeviceToWeb(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()
	user := newTestUser(t, f.db, "qr-default-dev")

	sess, err := f.svc.CreateQRSession(ctx, "")
	if err != nil {
		t.Fatalf("创建会话失败: %v", err)
	}
	if _, err := f.svc.ScanQRSession(ctx, sess.QRToken, user.ID); err != nil {
		t.Fatalf("标记已扫失败: %v", err)
	}
	if err := f.svc.ConfirmQRSession(ctx, sess.QRToken, user.ID); err != nil {
		t.Fatalf("确认授权失败: %v", err)
	}
	got, err := f.svc.PollQRSession(ctx, sess.QRToken, sess.PollSecret)
	if err != nil {
		t.Fatalf("轮询失败: %v", err)
	}
	claims, err := f.gen.Validate(got.Tokens.AccessToken)
	if err != nil {
		t.Fatalf("解析 access 令牌失败: %v", err)
	}
	if claims.DeviceID != "web" {
		t.Fatalf("did = %q, want web", claims.DeviceID)
	}
}

// TestQRScanReturnsScannerIdentity 扫码端要在确认页显示「我是谁」，因此 scan 必须回昵称与头像。
func TestQRScanReturnsScannerIdentity(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()
	user := newTestUser(t, f.db, "qr-identity")

	sess, err := f.svc.CreateQRSession(ctx, "web")
	if err != nil {
		t.Fatalf("创建会话失败: %v", err)
	}
	who, err := f.svc.ScanQRSession(ctx, sess.QRToken, user.ID)
	if err != nil {
		t.Fatalf("标记已扫失败: %v", err)
	}
	if who.Nickname != user.Nickname {
		t.Fatalf("nickname = %q, want %q", who.Nickname, user.Nickname)
	}
}

// TestQRScannedPollDoesNotLeakTokens 已扫未确认时不得下发令牌，否则确认这一步形同虚设。
func TestQRScannedPollDoesNotLeakTokens(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()
	user := newTestUser(t, f.db, "qr-scanned")

	sess, _ := f.svc.CreateQRSession(ctx, "web")
	if _, err := f.svc.ScanQRSession(ctx, sess.QRToken, user.ID); err != nil {
		t.Fatalf("标记已扫失败: %v", err)
	}

	got, err := f.svc.PollQRSession(ctx, sess.QRToken, sess.PollSecret)
	if err != nil {
		t.Fatalf("轮询失败: %v", err)
	}
	if got.Status != QRScanned {
		t.Fatalf("status = %q, want scanned", got.Status)
	}
	if got.Tokens != nil {
		t.Fatalf("scanned 阶段不得下发令牌: %+v", got.Tokens)
	}
}

// TestQRTokensCanBeClaimedOnlyOnce 同一个码绝不能换出两套令牌。
func TestQRTokensCanBeClaimedOnlyOnce(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()
	user := newTestUser(t, f.db, "qr-once")

	sess, _ := f.svc.CreateQRSession(ctx, "web")
	if _, err := f.svc.ScanQRSession(ctx, sess.QRToken, user.ID); err != nil {
		t.Fatalf("标记已扫失败: %v", err)
	}
	if err := f.svc.ConfirmQRSession(ctx, sess.QRToken, user.ID); err != nil {
		t.Fatalf("确认授权失败: %v", err)
	}

	if _, err := f.svc.PollQRSession(ctx, sess.QRToken, sess.PollSecret); err != nil {
		t.Fatalf("首次取走令牌失败: %v", err)
	}
	if _, err := f.svc.PollQRSession(ctx, sess.QRToken, sess.PollSecret); !errors.Is(err, ErrQRNotFound) {
		t.Fatalf("err = %v, want ErrQRNotFound（会话应已被消费）", err)
	}
	if n, err := f.rdb.Exists(ctx, "auth:qr:"+sess.QRToken).Result(); err != nil || n != 0 {
		t.Fatalf("取走令牌后会话键必须消失, exists=%d err=%v", n, err)
	}
}

// TestQRConfirmWithoutScanIsRejected 不得跳过 scanned 直接 confirm。
func TestQRConfirmWithoutScanIsRejected(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()
	user := newTestUser(t, f.db, "qr-skip-scan")

	sess, _ := f.svc.CreateQRSession(ctx, "web")
	if err := f.svc.ConfirmQRSession(ctx, sess.QRToken, user.ID); !errors.Is(err, ErrQRBadState) {
		t.Fatalf("err = %v, want ErrQRBadState", err)
	}
}

// TestQRConfirmTwiceIsRejected 状态只能单向前进，已确认的会话不能再确认。
func TestQRConfirmTwiceIsRejected(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()
	user := newTestUser(t, f.db, "qr-twice")

	sess, _ := f.svc.CreateQRSession(ctx, "web")
	if _, err := f.svc.ScanQRSession(ctx, sess.QRToken, user.ID); err != nil {
		t.Fatalf("标记已扫失败: %v", err)
	}
	if err := f.svc.ConfirmQRSession(ctx, sess.QRToken, user.ID); err != nil {
		t.Fatalf("确认授权失败: %v", err)
	}
	if err := f.svc.ConfirmQRSession(ctx, sess.QRToken, user.ID); !errors.Is(err, ErrQRBadState) {
		t.Fatalf("err = %v, want ErrQRBadState", err)
	}
}

// TestQRConfirmByAnotherUserIsRejected A 扫码、B 确认必须被拒，否则能把 A 的账号授权出去。
func TestQRConfirmByAnotherUserIsRejected(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()
	scanner := newTestUser(t, f.db, "qr-scanner")
	attacker := newTestUser(t, f.db, "qr-attacker")

	sess, _ := f.svc.CreateQRSession(ctx, "web")
	if _, err := f.svc.ScanQRSession(ctx, sess.QRToken, scanner.ID); err != nil {
		t.Fatalf("标记已扫失败: %v", err)
	}
	if err := f.svc.ConfirmQRSession(ctx, sess.QRToken, attacker.ID); !errors.Is(err, ErrQRWrongUser) {
		t.Fatalf("err = %v, want ErrQRWrongUser", err)
	}
}

// TestQRScanTwiceIsRejected 已扫会话不能再被扫，避免两台手机争抢同一个码。
func TestQRScanTwiceIsRejected(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()
	user := newTestUser(t, f.db, "qr-rescan")

	sess, _ := f.svc.CreateQRSession(ctx, "web")
	if _, err := f.svc.ScanQRSession(ctx, sess.QRToken, user.ID); err != nil {
		t.Fatalf("标记已扫失败: %v", err)
	}
	if _, err := f.svc.ScanQRSession(ctx, sess.QRToken, user.ID); !errors.Is(err, ErrQRBadState) {
		t.Fatalf("err = %v, want ErrQRBadState", err)
	}
}

// TestQRExpiredSessionIsNotFound 过期会话的轮询、扫码、确认三条路都必须被拒。
func TestQRExpiredSessionIsNotFound(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()
	user := newTestUser(t, f.db, "qr-expired")

	sess, _ := f.svc.CreateQRSession(ctx, "web")
	f.mr.FastForward(121 * time.Second)

	if _, err := f.svc.PollQRSession(ctx, sess.QRToken, sess.PollSecret); !errors.Is(err, ErrQRNotFound) {
		t.Fatalf("poll err = %v, want ErrQRNotFound", err)
	}
	if _, err := f.svc.ScanQRSession(ctx, sess.QRToken, user.ID); !errors.Is(err, ErrQRNotFound) {
		t.Fatalf("scan err = %v, want ErrQRNotFound", err)
	}
	if err := f.svc.ConfirmQRSession(ctx, sess.QRToken, user.ID); !errors.Is(err, ErrQRNotFound) {
		t.Fatalf("confirm err = %v, want ErrQRNotFound", err)
	}
}

// TestQRExpiredAfterScanIsNotFound 已扫会话过期后同样失效，扫过不等于延长有效期。
func TestQRExpiredAfterScanIsNotFound(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()
	user := newTestUser(t, f.db, "qr-expired-scanned")

	sess, _ := f.svc.CreateQRSession(ctx, "web")
	if _, err := f.svc.ScanQRSession(ctx, sess.QRToken, user.ID); err != nil {
		t.Fatalf("标记已扫失败: %v", err)
	}
	// 扫码不得重置 TTL：会话生命周期从创建那一刻算起
	if d := f.ttl(t, sess.QRToken); d > 120*time.Second {
		t.Fatalf("scan 后 TTL = %v, 不应被延长", d)
	}

	f.mr.FastForward(121 * time.Second)
	if err := f.svc.ConfirmQRSession(ctx, sess.QRToken, user.ID); !errors.Is(err, ErrQRNotFound) {
		t.Fatalf("confirm err = %v, want ErrQRNotFound", err)
	}
}

// TestQRUnknownTokenIsNotFound 伪造的码在三条路上都得到「不存在」，不区分伪造与已过期。
func TestQRUnknownTokenIsNotFound(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()
	user := newTestUser(t, f.db, "qr-forged")
	const forged = "not-a-real-qr-token"

	if _, err := f.svc.PollQRSession(ctx, forged, "irrelevant-secret"); !errors.Is(err, ErrQRNotFound) {
		t.Fatalf("poll err = %v, want ErrQRNotFound", err)
	}
	if _, err := f.svc.ScanQRSession(ctx, forged, user.ID); !errors.Is(err, ErrQRNotFound) {
		t.Fatalf("scan err = %v, want ErrQRNotFound", err)
	}
	if err := f.svc.ConfirmQRSession(ctx, forged, user.ID); !errors.Is(err, ErrQRNotFound) {
		t.Fatalf("confirm err = %v, want ErrQRNotFound", err)
	}
}

// TestQRBannedUserCannotScan 被封禁用户不能推进会话。
func TestQRBannedUserCannotScan(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()
	user := newTestUser(t, f.db, "qr-banned-scan")
	f.ban(t, user.ID)

	sess, _ := f.svc.CreateQRSession(ctx, "web")
	if _, err := f.svc.ScanQRSession(ctx, sess.QRToken, user.ID); !errors.Is(err, ErrUserBanned) {
		t.Fatalf("err = %v, want ErrUserBanned", err)
	}
	got, err := f.svc.PollQRSession(ctx, sess.QRToken, sess.PollSecret)
	if err != nil {
		t.Fatalf("轮询失败: %v", err)
	}
	if got.Status != QRPending {
		t.Fatalf("status = %q, 被封禁用户不得推进状态", got.Status)
	}
}

// TestQRBannedAfterScanCannotConfirm 扫码后才被封禁的用户不得换出令牌。
func TestQRBannedAfterScanCannotConfirm(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()
	user := newTestUser(t, f.db, "qr-banned-confirm")

	sess, _ := f.svc.CreateQRSession(ctx, "web")
	if _, err := f.svc.ScanQRSession(ctx, sess.QRToken, user.ID); err != nil {
		t.Fatalf("标记已扫失败: %v", err)
	}
	f.ban(t, user.ID)

	if err := f.svc.ConfirmQRSession(ctx, sess.QRToken, user.ID); !errors.Is(err, ErrUserBanned) {
		t.Fatalf("err = %v, want ErrUserBanned", err)
	}
	got, err := f.svc.PollQRSession(ctx, sess.QRToken, sess.PollSecret)
	if err != nil {
		t.Fatalf("轮询失败: %v", err)
	}
	if got.Tokens != nil {
		t.Fatalf("被封禁用户不得下发令牌: %+v", got.Tokens)
	}
}

// TestQRDeletedUserCannotScan 账号已注销时与封禁同一响应，不泄露账号状态。
func TestQRDeletedUserCannotScan(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()

	sess, _ := f.svc.CreateQRSession(ctx, "web")
	if _, err := f.svc.ScanQRSession(ctx, sess.QRToken, uuid.New()); !errors.Is(err, ErrUserBanned) {
		t.Fatalf("err = %v, want ErrUserBanned", err)
	}
}

// TestQRSessionKeyLayout 会话字段必须落在带命名空间的键里，供运维与后续排查定位。
func TestQRSessionKeyLayout(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()
	user := newTestUser(t, f.db, "qr-layout")

	sess, _ := f.svc.CreateQRSession(ctx, "web")
	if _, err := f.svc.ScanQRSession(ctx, sess.QRToken, user.ID); err != nil {
		t.Fatalf("标记已扫失败: %v", err)
	}

	vals, err := f.rdb.HGetAll(ctx, "auth:qr:"+sess.QRToken).Result()
	if err != nil {
		t.Fatalf("读取会话失败: %v", err)
	}
	if vals["status"] != string(QRScanned) {
		t.Fatalf("status = %q, want scanned", vals["status"])
	}
	if vals["user_id"] != user.ID.String() {
		t.Fatalf("user_id = %q, want %s", vals["user_id"], user.ID)
	}
	if vals["scanned_at"] == "" {
		t.Fatal("scanned_at 未写入")
	}
	if vals["poll_secret"] != sess.PollSecret {
		t.Fatalf("poll_secret = %q, want %q（轮询密钥必须存进会话才能比对）", vals["poll_secret"], sess.PollSecret)
	}
	if strings.Contains(vals["access_token"], ".") {
		t.Fatalf("未确认的会话不应存在令牌: %q", vals["access_token"])
	}
}

// TestQRSessionIssuesPollSecretOutsideThePayload 轮询密钥只回给发起端，绝不进二维码内容。
//
// 二维码里明文带着 qr_token，被拍照即泄露；密钥若也编进 qr_payload，
// 绑定发起方这件事就完全失效了。
func TestQRSessionIssuesPollSecretOutsideThePayload(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()

	seen := make(map[string]struct{}, 16)
	for i := 0; i < 16; i++ {
		sess, err := f.svc.CreateQRSession(ctx, "web")
		if err != nil {
			t.Fatalf("创建会话失败: %v", err)
		}
		raw, err := base64.RawURLEncoding.DecodeString(sess.PollSecret)
		if err != nil {
			t.Fatalf("poll_secret 不是 base64url(RawURL): %v", err)
		}
		if len(raw) != 32 {
			t.Fatalf("poll_secret 解码后 = %d 字节, want 32", len(raw))
		}
		if strings.Contains(sess.PollSecret, "=") {
			t.Fatalf("poll_secret 含填充字符: %q", sess.PollSecret)
		}
		if strings.Contains(sess.QRPayload, sess.PollSecret) {
			t.Fatalf("qr_payload 里出现了轮询密钥: payload=%q secret=%q", sess.QRPayload, sess.PollSecret)
		}
		if sess.QRPayload != qrPayloadPrefix+sess.QRToken {
			t.Fatalf("qr_payload = %q, want %q", sess.QRPayload, qrPayloadPrefix+sess.QRToken)
		}
		if _, dup := seen[sess.PollSecret]; dup {
			t.Fatalf("poll_secret 重复: %q", sess.PollSecret)
		}
		seen[sess.PollSecret] = struct{}{}
	}
}

// TestQRPollWithoutSecretCannotClaimTokens 缺密钥的轮询拿不到令牌，且不会把令牌毁掉。
//
// 这条正是「拍到二维码的人抢先取走令牌」那个攻击的直接反例：
// 攻击者只有 qr_token，既取不走令牌，也不能让发起端取不到。
func TestQRPollWithoutSecretCannotClaimTokens(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()
	user := newTestUser(t, f.db, "qr-nosecret")

	sess, err := f.svc.CreateQRSession(ctx, "web")
	if err != nil {
		t.Fatalf("创建会话失败: %v", err)
	}
	if _, err := f.svc.ScanQRSession(ctx, sess.QRToken, user.ID); err != nil {
		t.Fatalf("标记已扫失败: %v", err)
	}
	if err := f.svc.ConfirmQRSession(ctx, sess.QRToken, user.ID); err != nil {
		t.Fatalf("确认授权失败: %v", err)
	}

	got, err := f.svc.PollQRSession(ctx, sess.QRToken, "")
	if !errors.Is(err, ErrQRBadSecret) {
		t.Fatalf("err = %v, want ErrQRBadSecret", err)
	}
	if got != nil {
		t.Fatalf("缺密钥时不得返回任何结果: %+v", got)
	}

	// 会话必须还在：否则攻击者一次无密钥轮询就能把发起端的令牌销毁
	ok, err := f.svc.PollQRSession(ctx, sess.QRToken, sess.PollSecret)
	if err != nil {
		t.Fatalf("持正确密钥轮询失败: %v", err)
	}
	if ok.Tokens == nil || ok.Tokens.AccessToken == "" {
		t.Fatalf("持正确密钥必须取到令牌: %+v", ok)
	}
}

// TestQRPollWithWrongSecretCannotClaimTokens 密钥不匹配一律拒绝，正确密钥仍只能取一次。
func TestQRPollWithWrongSecretCannotClaimTokens(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()
	user := newTestUser(t, f.db, "qr-wrongsecret")

	sess, err := f.svc.CreateQRSession(ctx, "web")
	if err != nil {
		t.Fatalf("创建会话失败: %v", err)
	}
	// 另一个会话的密钥：长度与格式都合法，只是不属于这个会话
	other, err := f.svc.CreateQRSession(ctx, "web")
	if err != nil {
		t.Fatalf("创建对照会话失败: %v", err)
	}
	if _, err := f.svc.ScanQRSession(ctx, sess.QRToken, user.ID); err != nil {
		t.Fatalf("标记已扫失败: %v", err)
	}
	if err := f.svc.ConfirmQRSession(ctx, sess.QRToken, user.ID); err != nil {
		t.Fatalf("确认授权失败: %v", err)
	}

	if _, err := f.svc.PollQRSession(ctx, sess.QRToken, other.PollSecret); !errors.Is(err, ErrQRBadSecret) {
		t.Fatalf("err = %v, want ErrQRBadSecret", err)
	}

	if _, err := f.svc.PollQRSession(ctx, sess.QRToken, sess.PollSecret); err != nil {
		t.Fatalf("持正确密钥轮询失败: %v", err)
	}
	// 单次消费语义不能因为加了密钥校验而丢掉
	if _, err := f.svc.PollQRSession(ctx, sess.QRToken, sess.PollSecret); !errors.Is(err, ErrQRNotFound) {
		t.Fatalf("err = %v, want ErrQRNotFound（令牌只能取一次）", err)
	}
}

// TestQRPollWithWrongSecretHidesPendingStatus 密钥不匹配时连状态都不给，避免二维码持有者观察进度。
func TestQRPollWithWrongSecretHidesPendingStatus(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()

	sess, err := f.svc.CreateQRSession(ctx, "web")
	if err != nil {
		t.Fatalf("创建会话失败: %v", err)
	}
	got, err := f.svc.PollQRSession(ctx, sess.QRToken, "wrong-secret")
	if !errors.Is(err, ErrQRBadSecret) {
		t.Fatalf("err = %v, want ErrQRBadSecret", err)
	}
	if got != nil {
		t.Fatalf("密钥不匹配时不得回状态: %+v", got)
	}
}
