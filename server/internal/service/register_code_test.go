package service

import (
	"context"
	"errors"
	"testing"
)

// 注册发码**必须**对未注册邮箱也真的下发 —— 这正是它与 SendResetCode 相反的地方。
//
// 改密发码对未注册账号静默不发（账号本来就不存在，发了也没用），
// 而注册发码若照搬那套逻辑、只给「没注册过的」发，接口就反向变成枚举器：
// 收到码说明该邮箱未被注册，没收到说明已被注册。两种情况都得照发。
func TestSendRegisterCodeSendsToUnknownEmail(t *testing.T) {
	f := newAuthFixture(t)
	ctx := context.Background()
	email := "never-registered@example.com"
	t.Cleanup(func() { f.db.Exec(`DELETE FROM verification_codes WHERE target = ?`, email) })

	if err := f.svc.SendRegisterCode(ctx, email); err != nil {
		t.Fatalf("注册发码失败: %v", err)
	}
	if f.sender.count() != 1 {
		t.Fatalf("未注册邮箱也必须真的下发，实际下发 %d 次", f.sender.count())
	}
	if f.sender.target != email {
		t.Fatalf("下发目标 = %q，期望 %q", f.sender.target, email)
	}
	if !f.exists(t, "auth:reg:otp:"+email) {
		t.Fatal("验证码未落 redis")
	}
}

// 已注册邮箱同样照发，响应与未注册完全一致（真正的拦截点在 Register 的查重 409）。
func TestSendRegisterCodeSendsToExistingEmail(t *testing.T) {
	f := newAuthFixture(t)
	ctx := context.Background()
	user := newTestUser(t, f.db, "注册码已存在")
	email := "existing-" + user.ID.String() + "@example.com"
	user.Email = &email
	if err := f.db.Save(user).Error; err != nil {
		t.Fatalf("写入邮箱失败: %v", err)
	}
	t.Cleanup(func() { f.db.Exec(`DELETE FROM verification_codes WHERE target = ?`, email) })

	if err := f.svc.SendRegisterCode(ctx, email); err != nil {
		t.Fatalf("注册发码失败: %v", err)
	}
	if f.sender.count() != 1 {
		t.Fatalf("已注册邮箱也必须照发，实际下发 %d 次", f.sender.count())
	}
}

// 手机号走注册发码必须直接拒绝：码是发到邮箱里的，手机号无从验证。
func TestSendRegisterCodeRejectsNonEmail(t *testing.T) {
	f := newAuthFixture(t)
	if err := f.svc.SendRegisterCode(context.Background(), "13800138000"); !errors.Is(err, ErrCodeInvalid) {
		t.Fatalf("err = %v，期望 ErrCodeInvalid", err)
	}
	if f.sender.count() != 0 {
		t.Fatal("非邮箱不应触发下发")
	}
}

// 60 秒冷却内重复发码必须被挡，否则发信额度（免费档每日上限很低）会被连点刷空。
func TestSendRegisterCodeCooldown(t *testing.T) {
	f := newAuthFixture(t)
	ctx := context.Background()
	email := "cooldown@example.com"
	t.Cleanup(func() { f.db.Exec(`DELETE FROM verification_codes WHERE target = ?`, email) })

	if err := f.svc.SendRegisterCode(ctx, email); err != nil {
		t.Fatalf("首次发码失败: %v", err)
	}
	if err := f.svc.SendRegisterCode(ctx, email); !errors.Is(err, ErrCodeCooldown) {
		t.Fatalf("err = %v，期望 ErrCodeCooldown", err)
	}
	if f.sender.count() != 1 {
		t.Fatalf("冷却期内不应重复下发，实际 %d 次", f.sender.count())
	}
}

// 下发失败必须把验证码与冷却键一起回滚。
// 不回滚的后果是用户既收不到码，又被 60 秒冷却锁住，只能干等。
func TestSendRegisterCodeRollsBackOnSendFailure(t *testing.T) {
	f := newAuthFixture(t)
	ctx := context.Background()
	email := "rollback@example.com"
	t.Cleanup(func() { f.db.Exec(`DELETE FROM verification_codes WHERE target = ?`, email) })
	f.sender.err = errors.New("smtp 认证失败")

	if err := f.svc.SendRegisterCode(ctx, email); err == nil {
		t.Fatal("下发失败时必须返回错误")
	}
	if f.exists(t, "auth:reg:otp:"+email) {
		t.Error("下发失败后验证码未回滚")
	}
	if f.exists(t, "auth:reg:otp:cd:"+email) {
		t.Error("下发失败后冷却键未回滚 —— 用户会被锁住却收不到码")
	}
}

// 校验通过**不**立即作废验证码：注册还可能因昵称、密码强度、邮箱已占用而失败，
// 取出即删会让用户每修一次表单就得重新收一封邮件。
// 真正的作废由 ClearRegisterCode 在建号成功后执行。
func TestConsumeRegisterCodeStaysValidUntilCleared(t *testing.T) {
	f := newAuthFixture(t)
	ctx := context.Background()
	email := "retry@example.com"
	t.Cleanup(func() { f.db.Exec(`DELETE FROM verification_codes WHERE target = ?`, email) })

	if err := f.svc.SendRegisterCode(ctx, email); err != nil {
		t.Fatalf("发码失败: %v", err)
	}
	code := f.sender.code

	if err := f.svc.ConsumeRegisterCode(ctx, email, code); err != nil {
		t.Fatalf("首次校验应通过: %v", err)
	}
	if err := f.svc.ConsumeRegisterCode(ctx, email, code); err != nil {
		t.Fatalf("注册失败后重试应仍可用: %v", err)
	}

	f.svc.ClearRegisterCode(ctx, email)
	if err := f.svc.ConsumeRegisterCode(ctx, email, code); !errors.Is(err, ErrCodeInvalid) {
		t.Fatalf("建号成功后码必须失效，err = %v", err)
	}
}

// 连续输错达到上限后锁定，此后即使输对也不放行 —— 否则 6 位码可被暴力枚举。
func TestConsumeRegisterCodeLocksAfterMaxFails(t *testing.T) {
	f := newAuthFixture(t)
	ctx := context.Background()
	email := "bruteforce@example.com"
	t.Cleanup(func() { f.db.Exec(`DELETE FROM verification_codes WHERE target = ?`, email) })

	if err := f.svc.SendRegisterCode(ctx, email); err != nil {
		t.Fatalf("发码失败: %v", err)
	}
	code := f.sender.code

	for i := 0; i < otpMaxFails; i++ {
		if err := f.svc.ConsumeRegisterCode(ctx, email, "000000"); !errors.Is(err, ErrCodeInvalid) {
			t.Fatalf("第 %d 次错码 err = %v，期望 ErrCodeInvalid", i+1, err)
		}
	}
	if err := f.svc.ConsumeRegisterCode(ctx, email, code); !errors.Is(err, ErrTooManyTries) {
		t.Fatalf("锁定后即使输对也不能放行，err = %v", err)
	}
}

// 改密发码必须同时支持邮箱：登录早就认邮箱，找回密码只认手机号的话，
// 邮箱注册的用户会彻底锁死在门外。
func TestSendResetCodeAcceptsEmail(t *testing.T) {
	f := newAuthFixture(t)
	ctx := context.Background()
	user := newTestUser(t, f.db, "邮箱改密")
	email := "reset-" + user.ID.String() + "@example.com"
	user.Email = &email
	if err := f.db.Save(user).Error; err != nil {
		t.Fatalf("写入邮箱失败: %v", err)
	}
	t.Cleanup(func() { f.db.Exec(`DELETE FROM verification_codes WHERE target = ?`, email) })

	if err := f.svc.SendResetCode(ctx, email); err != nil {
		t.Fatalf("邮箱改密发码失败: %v", err)
	}
	if f.sender.count() != 1 {
		t.Fatalf("邮箱已注册，必须下发，实际 %d 次", f.sender.count())
	}

	ticket, _, err := f.svc.VerifyResetCode(ctx, email, f.sender.code)
	if err != nil {
		t.Fatalf("邮箱校验改密码失败: %v", err)
	}
	if ticket == "" {
		t.Fatal("票据为空")
	}
}
