package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/pkg/jwt"
	"github.com/yuanchat/server/internal/pkg/password"
	"github.com/yuanchat/server/internal/repository"
	"github.com/yuanchat/server/internal/testutil"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// fakeSender 记录下发调用，可按需模拟下发失败。
type fakeSender struct {
	mu     sync.Mutex
	calls  int
	target string
	code   string
	err    error
}

func (f *fakeSender) Send(_ context.Context, target, code string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return f.err
	}
	f.calls++
	f.target = target
	f.code = code
	return nil
}

func (f *fakeSender) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

// authFixture 聚合改密链路所需的真实依赖：dev 库 + 进程内 redis + 假下发通道。
type authFixture struct {
	svc    *AuthService
	rdb    *redis.Client
	mr     *miniredis.Miniredis
	db     *gorm.DB
	sender *fakeSender
}

func newAuthFixture(t *testing.T) *authFixture {
	t.Helper()
	db := testDB(t)
	rdb, mr := testutil.NewRedis(t)
	sender := &fakeSender{}
	svc := NewAuthService(
		repository.NewUserRepository(db),
		repository.NewVerificationCodeRepository(db),
		rdb, sender,
		jwt.NewGenerator("auth-fixture-secret", time.Hour, 24*time.Hour),
		zap.NewNop(),
	)
	return &authFixture{svc: svc, rdb: rdb, mr: mr, db: db, sender: sender}
}

// seedResetUser 建一个可用于改密的用户，并清理其审计行。
func (f *authFixture) seedResetUser(t *testing.T, nick string) (*model.User, string) {
	t.Helper()
	user := newTestUser(t, f.db, nick)
	phone := *user.Phone
	t.Cleanup(func() { f.db.Exec(`DELETE FROM verification_codes WHERE target = ?`, phone) })
	return user, phone
}

// currentOTP 直接从 redis 读出待校验的验证码，避免在测试里猜随机值。
func (f *authFixture) currentOTP(t *testing.T, phone string) string {
	t.Helper()
	code, err := f.rdb.Get(context.Background(), "auth:pwd:otp:"+phone).Result()
	if err != nil {
		t.Fatalf("读取 otp 失败: %v", err)
	}
	return code
}

func (f *authFixture) exists(t *testing.T, key string) bool {
	t.Helper()
	n, err := f.rdb.Exists(context.Background(), key).Result()
	if err != nil {
		t.Fatalf("exists %s: %v", key, err)
	}
	return n == 1
}

// TestSendResetCodeUnknownPhoneIsSilentSuccess 未注册手机号必须静默成功，
// 否则该端点退化为「这个号注册过没有」的枚举器。
func TestSendResetCodeUnknownPhoneIsSilentSuccess(t *testing.T) {
	f := newAuthFixture(t)
	ctx := context.Background()

	if err := f.svc.SendResetCode(ctx, "13900000000"); err != nil {
		t.Fatalf("未注册手机号必须静默成功: %v", err)
	}
	if f.sender.count() != 0 {
		t.Fatal("未注册手机号不应真的下发验证码")
	}
	if f.exists(t, "auth:pwd:otp:13900000000") {
		t.Fatal("未注册手机号不应写入 otp 键")
	}
}

// TestSendResetCodeRespectsCooldown 60 秒内重发被拒。
func TestSendResetCodeRespectsCooldown(t *testing.T) {
	f := newAuthFixture(t)
	_, phone := f.seedResetUser(t, "otp-cooldown")
	ctx := context.Background()

	if err := f.svc.SendResetCode(ctx, phone); err != nil {
		t.Fatalf("首次发码: %v", err)
	}
	if err := f.svc.SendResetCode(ctx, phone); !errors.Is(err, ErrCodeCooldown) {
		t.Fatalf("err = %v, want ErrCodeCooldown", err)
	}
	if f.sender.count() != 1 {
		t.Fatalf("下发次数 = %d, want 1（冷却期内不得重发）", f.sender.count())
	}

	// 冷却到期后可再次发码
	f.mr.FastForward(61 * time.Second)
	if err := f.svc.SendResetCode(ctx, phone); err != nil {
		t.Fatalf("冷却到期后应可重发: %v", err)
	}
}

// TestSendResetCodeWritesAuditRow 每次发码在 verification_codes 留一行审计。
func TestSendResetCodeWritesAuditRow(t *testing.T) {
	f := newAuthFixture(t)
	_, phone := f.seedResetUser(t, "otp-audit")

	if err := f.svc.SendResetCode(context.Background(), phone); err != nil {
		t.Fatalf("发码: %v", err)
	}

	var row model.VerificationCode
	if err := f.db.Where("target = ?", phone).First(&row).Error; err != nil {
		t.Fatalf("审计行未写入: %v", err)
	}
	if row.Type != model.VerificationTypePasswordReset {
		t.Fatalf("type = %d, want %d", row.Type, model.VerificationTypePasswordReset)
	}
	if row.Used {
		t.Fatal("刚发出的码不应标记为已使用")
	}
	if row.Code != f.currentOTP(t, phone) {
		t.Fatal("审计行的码与 redis 中待校验的码不一致")
	}
}

// TestSendResetCodeRollsBackWhenSenderFails 下发失败必须回滚验证码与冷却键，
// 否则用户被冷却期锁住却永远收不到码。
func TestSendResetCodeRollsBackWhenSenderFails(t *testing.T) {
	f := newAuthFixture(t)
	_, phone := f.seedResetUser(t, "otp-rollback")
	f.sender.err = errors.New("下发通道故障")

	if err := f.svc.SendResetCode(context.Background(), phone); err == nil {
		t.Fatal("下发失败必须返回错误")
	}
	if f.exists(t, "auth:pwd:otp:"+phone) {
		t.Fatal("下发失败后 otp 键未回滚")
	}
	if f.exists(t, "auth:pwd:otp:cd:"+phone) {
		t.Fatal("下发失败后冷却键未回滚，用户会被锁在冷却里")
	}
}

// TestVerifyResetCodeWrongCodeKeepsCodeAlive 输错一次不得作废验证码。
//
// 与 handler/captcha.go 的「先删再比」相反：那种写法下用户手滑一次就得重新发码。
func TestVerifyResetCodeWrongCodeKeepsCodeAlive(t *testing.T) {
	f := newAuthFixture(t)
	_, phone := f.seedResetUser(t, "otp-keepalive")
	ctx := context.Background()
	if err := f.svc.SendResetCode(ctx, phone); err != nil {
		t.Fatalf("发码: %v", err)
	}
	want := f.currentOTP(t, phone)

	if _, _, err := f.svc.VerifyResetCode(ctx, phone, "000000"); !errors.Is(err, ErrCodeInvalid) {
		t.Fatalf("err = %v, want ErrCodeInvalid", err)
	}
	if got := f.currentOTP(t, phone); got != want {
		t.Fatalf("输错验证码后码被改动或删除: got %q want %q", got, want)
	}
	if n, _ := f.rdb.Get(ctx, "auth:pwd:otp:fail:"+phone).Int(); n != 1 {
		t.Fatalf("失败计数 = %d, want 1", n)
	}

	// 重输正确仍可通过（spec 验收项）
	if _, _, err := f.svc.VerifyResetCode(ctx, phone, want); err != nil {
		t.Fatalf("输错后重输正确应通过: %v", err)
	}
}

// TestVerifyResetCodeLocksAfterFiveFailures 连错 5 次后第 6 次锁定。
func TestVerifyResetCodeLocksAfterFiveFailures(t *testing.T) {
	f := newAuthFixture(t)
	_, phone := f.seedResetUser(t, "otp-lock")
	ctx := context.Background()
	if err := f.svc.SendResetCode(ctx, phone); err != nil {
		t.Fatalf("发码: %v", err)
	}
	want := f.currentOTP(t, phone)

	for i := 0; i < 5; i++ {
		if _, _, err := f.svc.VerifyResetCode(ctx, phone, "000000"); !errors.Is(err, ErrCodeInvalid) {
			t.Fatalf("第 %d 次 err = %v, want ErrCodeInvalid", i+1, err)
		}
	}
	// 锁定后即使输对也必须被拒
	if _, _, err := f.svc.VerifyResetCode(ctx, phone, want); !errors.Is(err, ErrTooManyTries) {
		t.Fatalf("err = %v, want ErrTooManyTries", err)
	}
}

// TestVerifyResetCodeSuccessConsumesOTP 校验通过后换发票据，并消费掉验证码。
func TestVerifyResetCodeSuccessConsumesOTP(t *testing.T) {
	f := newAuthFixture(t)
	user, phone := f.seedResetUser(t, "otp-consume")
	ctx := context.Background()
	if err := f.svc.SendResetCode(ctx, phone); err != nil {
		t.Fatalf("发码: %v", err)
	}
	_, _, _ = f.svc.VerifyResetCode(ctx, phone, "000000") // 先留一个失败计数

	ticket, expiresIn, err := f.svc.VerifyResetCode(ctx, phone, f.currentOTP(t, phone))
	if err != nil {
		t.Fatalf("校验正确的码: %v", err)
	}
	if ticket == "" {
		t.Fatal("未换发 reset_ticket")
	}
	if expiresIn != 300 {
		t.Fatalf("expires_in = %d, want 300", expiresIn)
	}
	if f.exists(t, "auth:pwd:otp:"+phone) {
		t.Fatal("校验通过后 otp 键必须被删除")
	}
	if f.exists(t, "auth:pwd:otp:fail:"+phone) {
		t.Fatal("校验通过后失败计数必须清零")
	}
	// 票据里存的是 user_id
	if got, _ := f.rdb.Get(ctx, "auth:pwd:ticket:"+ticket).Result(); got != user.ID.String() {
		t.Fatalf("ticket 值 = %q, want user_id %q", got, user.ID.String())
	}
	// 审计行标记为已使用
	var row model.VerificationCode
	if err := f.db.Where("target = ?", phone).First(&row).Error; err != nil {
		t.Fatalf("查审计行: %v", err)
	}
	if !row.Used {
		t.Fatal("校验通过后审计行应置 used = true")
	}
}

// TestVerifyResetCodeRejectsExpiredOTP 验证码超过 5 分钟后失效。
func TestVerifyResetCodeRejectsExpiredOTP(t *testing.T) {
	f := newAuthFixture(t)
	_, phone := f.seedResetUser(t, "otp-expire")
	ctx := context.Background()
	if err := f.svc.SendResetCode(ctx, phone); err != nil {
		t.Fatalf("发码: %v", err)
	}
	code := f.currentOTP(t, phone)

	f.mr.FastForward(5*time.Minute + time.Second)

	if _, _, err := f.svc.VerifyResetCode(ctx, phone, code); !errors.Is(err, ErrCodeInvalid) {
		t.Fatalf("err = %v, want ErrCodeInvalid（码已过期）", err)
	}
}

// newTicket 走完发码 + 校验，返回可用于改密的一次性票据。
func (f *authFixture) newTicket(t *testing.T, phone string) string {
	t.Helper()
	ctx := context.Background()
	if err := f.svc.SendResetCode(ctx, phone); err != nil {
		t.Fatalf("发码: %v", err)
	}
	ticket, _, err := f.svc.VerifyResetCode(ctx, phone, f.currentOTP(t, phone))
	if err != nil {
		t.Fatalf("校验: %v", err)
	}
	return ticket
}

// TestResetPasswordConsumesTicketOnce 票据单次消费，且改密递增 token_version。
func TestResetPasswordConsumesTicketOnce(t *testing.T) {
	f := newAuthFixture(t)
	user, phone := f.seedResetUser(t, "reset-once")
	ticket := f.newTicket(t, phone)
	ctx := context.Background()

	if err := f.svc.ResetPassword(ctx, ticket, "Abcdef12"); err != nil {
		t.Fatalf("改密: %v", err)
	}
	if err := f.svc.ResetPassword(ctx, ticket, "Abcdef34"); !errors.Is(err, ErrTicketInvalid) {
		t.Fatalf("err = %v, want ErrTicketInvalid（同一张票不能用两次）", err)
	}

	var fresh model.User
	if err := f.db.First(&fresh, "id = ?", user.ID).Error; err != nil {
		t.Fatalf("重读用户: %v", err)
	}
	if fresh.TokenVersion != user.TokenVersion+1 {
		t.Fatalf("token_version = %d, want %d", fresh.TokenVersion, user.TokenVersion+1)
	}
	if !password.Verify(fresh.PasswordHash, "Abcdef12") {
		t.Fatal("新密码无法通过校验，密码未真正写入")
	}
	if password.Verify(fresh.PasswordHash, "Abcdef34") {
		t.Fatal("第二次改密被拒后却改动了密码")
	}
}

// TestResetPasswordRejectsWeakPasswordWithoutConsumingTicket 弱密码被拒且不消费票据。
//
// 校验顺序必须是「先查复杂度、后 GETDEL」，否则用户第一次填了弱密码就得重新走发码。
func TestResetPasswordRejectsWeakPasswordWithoutConsumingTicket(t *testing.T) {
	f := newAuthFixture(t)
	_, phone := f.seedResetUser(t, "reset-weak")
	ticket := f.newTicket(t, phone)
	ctx := context.Background()

	if err := f.svc.ResetPassword(ctx, ticket, "12345678"); !errors.Is(err, ErrWeakPassword) {
		t.Fatalf("err = %v, want ErrWeakPassword", err)
	}
	if !f.exists(t, "auth:pwd:ticket:"+ticket) {
		t.Fatal("弱密码被拒时不得消费票据")
	}
	if err := f.svc.ResetPassword(ctx, ticket, "Abcdef12"); err != nil {
		t.Fatalf("改用合规密码应成功: %v", err)
	}
}

// TestResetPasswordRejectsExpiredTicket 票据超过 5 分钟后失效。
func TestResetPasswordRejectsExpiredTicket(t *testing.T) {
	f := newAuthFixture(t)
	_, phone := f.seedResetUser(t, "reset-expire")
	ticket := f.newTicket(t, phone)

	f.mr.FastForward(5*time.Minute + time.Second)

	if err := f.svc.ResetPassword(context.Background(), ticket, "Abcdef12"); !errors.Is(err, ErrTicketInvalid) {
		t.Fatalf("err = %v, want ErrTicketInvalid（票据已过期）", err)
	}
}

// TestResetPasswordRevokesExistingRefreshToken 改密后旧 refresh 令牌立即失效。
//
// 这是 token_version 吊销机制的端到端证明：只断言列值 +1 不足以说明续期真的被拦。
func TestResetPasswordRevokesExistingRefreshToken(t *testing.T) {
	f := newAuthFixture(t)
	user, phone := f.seedResetUser(t, "reset-revoke")
	userSvc, gen := authSvc(t, f.db)
	ctx := context.Background()

	pair, err := gen.GeneratePair(user.ID, "web", user.TokenVersion)
	if err != nil {
		t.Fatalf("签发令牌: %v", err)
	}
	if _, err := userSvc.Refresh(ctx, pair.RefreshToken); err != nil {
		t.Fatalf("改密前旧令牌应可续期: %v", err)
	}

	if err := f.svc.ResetPassword(ctx, f.newTicket(t, phone), "Abcdef12"); err != nil {
		t.Fatalf("改密: %v", err)
	}

	if _, err := userSvc.Refresh(ctx, pair.RefreshToken); !errors.Is(err, ErrInvalidRefresh) {
		t.Fatalf("err = %v, want ErrInvalidRefresh（改密后旧 refresh 必须失效）", err)
	}
}

// knownPassword 是改密用例里「当前密码」的明文。
//
// newTestUser 写的 password_hash 是占位字符串 "x"，不是 bcrypt 哈希，
// 因此凡是要验旧密码的用例都得先落一个真实哈希。
const knownPassword = "Zxcvbn99"

// setKnownPassword 给测试用户写入 knownPassword 的真实哈希。
func (f *authFixture) setKnownPassword(t *testing.T, user *model.User) {
	t.Helper()
	hash, err := password.Hash(knownPassword)
	if err != nil {
		t.Fatalf("哈希密码: %v", err)
	}
	if err := f.db.Model(&model.User{}).Where("id = ?", user.ID).
		Update("password_hash", hash).Error; err != nil {
		t.Fatalf("写入密码哈希: %v", err)
	}
}

// TestChangePasswordRequiresCorrectOldPassword 旧密码错误时既不改密也不动 token_version。
//
// 这是登录态改密唯一的身份凭据，判错就等于把改密入口敞开给拿到 access 令牌的任何人。
func TestChangePasswordRequiresCorrectOldPassword(t *testing.T) {
	f := newAuthFixture(t)
	user, _ := f.seedResetUser(t, "chpwd-wrong")
	f.setKnownPassword(t, user)
	ctx := context.Background()

	err := f.svc.ChangePassword(ctx, user.ID.String(), "WrongOld9", "Abcdef12")
	if !errors.Is(err, ErrOldPasswordWrong) {
		t.Fatalf("err = %v, want ErrOldPasswordWrong", err)
	}

	var fresh model.User
	if err := f.db.First(&fresh, "id = ?", user.ID).Error; err != nil {
		t.Fatalf("重读用户: %v", err)
	}
	if fresh.TokenVersion != user.TokenVersion {
		t.Fatalf("token_version = %d, want %d（旧密码错误不该吊销任何令牌）",
			fresh.TokenVersion, user.TokenVersion)
	}
	if password.Verify(fresh.PasswordHash, "Abcdef12") {
		t.Fatal("旧密码错误却把新密码写进去了")
	}
}

// TestChangePasswordRejectsWeakNewPassword 新密码不合复杂度时被拒且不写库。
func TestChangePasswordRejectsWeakNewPassword(t *testing.T) {
	f := newAuthFixture(t)
	user, _ := f.seedResetUser(t, "chpwd-weak")
	f.setKnownPassword(t, user)
	ctx := context.Background()

	err := f.svc.ChangePassword(ctx, user.ID.String(), knownPassword, "12345678")
	if !errors.Is(err, ErrWeakPassword) {
		t.Fatalf("err = %v, want ErrWeakPassword", err)
	}

	var fresh model.User
	if err := f.db.First(&fresh, "id = ?", user.ID).Error; err != nil {
		t.Fatalf("重读用户: %v", err)
	}
	if fresh.TokenVersion != user.TokenVersion {
		t.Fatalf("token_version = %d, want %d", fresh.TokenVersion, user.TokenVersion)
	}
}

// TestChangePasswordSucceedsAndRevokesTokens 正确旧密码可改密，且递增 token_version。
func TestChangePasswordSucceedsAndRevokesTokens(t *testing.T) {
	f := newAuthFixture(t)
	user, _ := f.seedResetUser(t, "chpwd-ok")
	f.setKnownPassword(t, user)
	ctx := context.Background()

	if err := f.svc.ChangePassword(ctx, user.ID.String(), knownPassword, "Abcdef12"); err != nil {
		t.Fatalf("改密: %v", err)
	}

	var fresh model.User
	if err := f.db.First(&fresh, "id = ?", user.ID).Error; err != nil {
		t.Fatalf("重读用户: %v", err)
	}
	if fresh.TokenVersion != user.TokenVersion+1 {
		t.Fatalf("token_version = %d, want %d（改密必须吊销全部旧令牌）",
			fresh.TokenVersion, user.TokenVersion+1)
	}
	if !password.Verify(fresh.PasswordHash, "Abcdef12") {
		t.Fatal("新密码无法通过校验，密码未真正写入")
	}
	// 旧密码必须失效，否则改密等于没改
	if password.Verify(fresh.PasswordHash, knownPassword) {
		t.Fatal("旧密码改密后仍然有效")
	}
}
