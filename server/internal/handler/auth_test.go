package handler

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"github.com/yuanchat/server/internal/pkg/jwt"
	"github.com/yuanchat/server/internal/repository"
	"github.com/yuanchat/server/internal/service"
	"github.com/yuanchat/server/internal/testutil"
	"go.uber.org/zap"
)

// noopSender 只吞掉验证码，不做任何下发。
type noopSender struct{}

func (noopSender) Send(_ context.Context, _, _ string) error { return nil }

// newPasswordResetEngine 装配忘记密码三端点。
//
// 仓储层传 nil：本文件的用例只覆盖在触达数据库之前就能判定的分支
// （冷却、码不存在、票据不存在、弱密码），需要真库的链路在 internal/router 里覆盖。
func newPasswordResetEngine(t *testing.T) (*gin.Engine, *redis.Client) {
	t.Helper()
	rdb, _ := testutil.NewRedis(t)
	svc := service.NewAuthService(
		repository.NewUserRepository(nil),
		repository.NewVerificationCodeRepository(nil),
		rdb, noopSender{},
		jwt.NewGenerator("handler-auth-test-secret", time.Hour, 24*time.Hour),
		zap.NewNop(),
	)
	h := NewAuthHandler(svc, zap.NewNop())

	r := gin.New()
	pwd := r.Group("/api/v1/auth/password")
	pwd.POST("/otp", h.SendResetCode)
	pwd.POST("/verify", h.VerifyResetCode)
	pwd.POST("/reset", h.ResetPassword)
	return r, rdb
}

// TestPasswordOtpCooldownReturns429 冷却期内重发映射为 429。
func TestPasswordOtpCooldownReturns429(t *testing.T) {
	r, rdb := newPasswordResetEngine(t)
	if err := rdb.Set(t.Context(), "auth:pwd:otp:cd:13800138000", "1", 0).Err(); err != nil {
		t.Fatalf("预置冷却键: %v", err)
	}

	w, resp := doJSON(t, r, http.MethodPost, "/api/v1/auth/password/otp",
		map[string]string{"phone": "13800138000"})
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429, body=%s", w.Code, w.Body.String())
	}
	if resp.Message != "auth.sendFailed" {
		t.Fatalf("message = %q, want auth.sendFailed", resp.Message)
	}
}

// TestPasswordOtpRequiresPhone 缺手机号是 400，不能落到 500。
func TestPasswordOtpRequiresPhone(t *testing.T) {
	r, _ := newPasswordResetEngine(t)

	w, _ := doJSON(t, r, http.MethodPost, "/api/v1/auth/password/otp", map[string]string{})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", w.Code, w.Body.String())
	}
}

// TestPasswordVerifyWrongCodeReturns400 码不存在或不匹配映射为 400 + auth.otpWrong。
func TestPasswordVerifyWrongCodeReturns400(t *testing.T) {
	r, _ := newPasswordResetEngine(t)

	w, resp := doJSON(t, r, http.MethodPost, "/api/v1/auth/password/verify",
		map[string]string{"phone": "13800138000", "code": "000000"})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", w.Code, w.Body.String())
	}
	if resp.Message != "auth.otpWrong" {
		t.Fatalf("message = %q, want auth.otpWrong", resp.Message)
	}
}

// TestPasswordVerifyTooManyTriesReturns429 失败计数达上限映射为 429 + auth.accountLocked。
func TestPasswordVerifyTooManyTriesReturns429(t *testing.T) {
	r, rdb := newPasswordResetEngine(t)
	if err := rdb.Set(t.Context(), "auth:pwd:otp:fail:13800138000", "5", 0).Err(); err != nil {
		t.Fatalf("预置失败计数: %v", err)
	}

	w, resp := doJSON(t, r, http.MethodPost, "/api/v1/auth/password/verify",
		map[string]string{"phone": "13800138000", "code": "000000"})
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429, body=%s", w.Code, w.Body.String())
	}
	if resp.Message != "auth.accountLocked" {
		t.Fatalf("message = %q, want auth.accountLocked", resp.Message)
	}
}

// TestPasswordResetRejectsUnknownTicket 未知票据映射为 400 + auth.resetFailed。
func TestPasswordResetRejectsUnknownTicket(t *testing.T) {
	r, _ := newPasswordResetEngine(t)

	w, resp := doJSON(t, r, http.MethodPost, "/api/v1/auth/password/reset",
		map[string]string{"reset_ticket": "deadbeef", "new_password": "Abcdef12"})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", w.Code, w.Body.String())
	}
	if resp.Message != "auth.resetFailed" {
		t.Fatalf("message = %q, want auth.resetFailed", resp.Message)
	}
}

// TestPasswordResetWeakPasswordReturnsRuleKey 弱密码回具体规则的 i18n key，
// 而不是笼统的失败文案——前端要据此逐条提示。
func TestPasswordResetWeakPasswordReturnsRuleKey(t *testing.T) {
	r, _ := newPasswordResetEngine(t)

	w, resp := doJSON(t, r, http.MethodPost, "/api/v1/auth/password/reset",
		map[string]string{"reset_ticket": "deadbeef", "new_password": "12345678"})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", w.Code, w.Body.String())
	}
	if resp.Message != "validation.passwordLowercase" {
		t.Fatalf("message = %q, want validation.passwordLowercase", resp.Message)
	}
}
