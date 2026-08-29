package handler

import (
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

// newQRLoginEngine 装配扫码登录四端点，并用固定测试用户替代鉴权中间件。
//
// 仓储层传 nil：本文件只覆盖在触达数据库之前就能判定的分支（会话不存在、码超长、
// 请求体不合规、轮询取令牌），需要真库的链路在 internal/router 里覆盖。
func newQRLoginEngine(t *testing.T) (*gin.Engine, *redis.Client) {
	t.Helper()
	rdb, _ := testutil.NewRedis(t)
	svc := service.NewAuthService(
		repository.NewUserRepository(nil),
		repository.NewVerificationCodeRepository(nil),
		rdb, noopSender{},
		jwt.NewGenerator("handler-qr-test-secret", time.Hour, 24*time.Hour),
		zap.NewNop(),
	)
	h := NewAuthHandler(svc, zap.NewNop())

	r := gin.New()
	// 模拟 AuthRequired：把 user_id 放进上下文，供扫码端的两个端点取用
	r.Use(func(c *gin.Context) {
		c.Set("user_id", testUserID)
		c.Next()
	})
	qr := r.Group("/api/v1/auth/qr")
	qr.POST("/session", h.CreateQRSession)
	qr.GET("/:token", h.PollQRSession)
	qr.POST("/:token/scan", h.ScanQRSession)
	qr.POST("/:token/confirm", h.ConfirmQRSession)
	return r, rdb
}

// TestQRSessionReturnsPayloadAndExpiresIn 建会话必须回二维码内容与有效期。
//
// expires_in 是前端倒计时的唯一来源，缺了它页面只能继续写死 60 秒。
func TestQRSessionReturnsPayloadAndExpiresIn(t *testing.T) {
	r, _ := newQRLoginEngine(t)

	w, resp := doJSON(t, r, http.MethodPost, "/api/v1/auth/qr/session",
		map[string]string{"device_id": "desktop"})
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", w.Code, w.Body.String())
	}
	qrToken, _ := resp.Data["qr_token"].(string)
	if qrToken == "" {
		t.Fatalf("未返回 qr_token: %s", w.Body.String())
	}
	if payload, _ := resp.Data["qr_payload"].(string); payload != "yuanchat://login?t="+qrToken {
		t.Fatalf("qr_payload = %q, want yuanchat://login?t=<qr_token>", payload)
	}
	if expiresIn, _ := resp.Data["expires_in"].(float64); expiresIn != 120 {
		t.Fatalf("expires_in = %v, want 120", resp.Data["expires_in"])
	}
}

// TestQRSessionRejectsUnknownDevice 平台标识不在白名单内是 400，不能落到 500。
func TestQRSessionRejectsUnknownDevice(t *testing.T) {
	r, _ := newQRLoginEngine(t)

	w, resp := doJSON(t, r, http.MethodPost, "/api/v1/auth/qr/session",
		map[string]string{"device_id": "android"})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", w.Code, w.Body.String())
	}
	if resp.Message != "auth.qrFailed" {
		t.Fatalf("message = %q, want auth.qrFailed", resp.Message)
	}
}

// TestQRSessionRequiresJSONBody 空请求体是 400：该端点必须带 JSON 体调用。
func TestQRSessionRequiresJSONBody(t *testing.T) {
	r, _ := newQRLoginEngine(t)

	w, _ := doJSON(t, r, http.MethodPost, "/api/v1/auth/qr/session", nil)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body=%s", w.Code, w.Body.String())
	}
}

// TestQRPollUnknownTokenReturns404 伪造或已过期的码都是 404 + auth.qrExpired。
func TestQRPollUnknownTokenReturns404(t *testing.T) {
	r, _ := newQRLoginEngine(t)

	w, resp := doJSON(t, r, http.MethodGet, "/api/v1/auth/qr/forged-token", nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body=%s", w.Code, w.Body.String())
	}
	if resp.Message != "auth.qrExpired" {
		t.Fatalf("message = %q, want auth.qrExpired", resp.Message)
	}
}

// TestQRPollOverlongTokenReturns404 超长路径参数直接按不存在处理。
func TestQRPollOverlongTokenReturns404(t *testing.T) {
	r, _ := newQRLoginEngine(t)
	long := ""
	for i := 0; i < 100; i++ {
		long += "a"
	}

	w, _ := doJSON(t, r, http.MethodGet, "/api/v1/auth/qr/"+long, nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body=%s", w.Code, w.Body.String())
	}
}

// TestQRPollPendingReturnsCountdown 未被扫时回 pending 与剩余秒数，且不带令牌。
func TestQRPollPendingReturnsCountdown(t *testing.T) {
	r, _ := newQRLoginEngine(t)

	_, created := doJSON(t, r, http.MethodPost, "/api/v1/auth/qr/session", map[string]string{})
	qrToken, _ := created.Data["qr_token"].(string)

	w, resp := doJSON(t, r, http.MethodGet, "/api/v1/auth/qr/"+qrToken, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", w.Code, w.Body.String())
	}
	if status, _ := resp.Data["status"].(string); status != "pending" {
		t.Fatalf("status = %v, want pending", resp.Data["status"])
	}
	if expiresIn, _ := resp.Data["expires_in"].(float64); expiresIn <= 0 {
		t.Fatalf("expires_in = %v, 前端倒计时需要正数", resp.Data["expires_in"])
	}
	if _, has := resp.Data["tokens"]; has {
		t.Fatalf("pending 不得带 tokens: %s", w.Body.String())
	}
}

// TestQRPollConfirmedReturnsTokensOnce 已确认的会话只能换出一套令牌，第二次是 404。
func TestQRPollConfirmedReturnsTokensOnce(t *testing.T) {
	r, rdb := newQRLoginEngine(t)
	const qrToken = "confirmed-session-token"
	ctx := t.Context()
	if err := rdb.HSet(ctx, "auth:qr:"+qrToken,
		"status", "confirmed",
		"user_id", testUserID.String(),
		"device_id", "web",
		"access_token", "header.access.sig",
		"refresh_token", "header.refresh.sig",
		"token_expires_in", "900",
	).Err(); err != nil {
		t.Fatalf("预置已确认会话: %v", err)
	}

	w, resp := doJSON(t, r, http.MethodGet, "/api/v1/auth/qr/"+qrToken, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", w.Code, w.Body.String())
	}
	tokens, _ := resp.Data["tokens"].(map[string]any)
	if tokens == nil || tokens["access_token"] != "header.access.sig" {
		t.Fatalf("未返回令牌对: %s", w.Body.String())
	}
	if tokens["refresh_token"] != "header.refresh.sig" {
		t.Fatalf("refresh_token = %v", tokens["refresh_token"])
	}
	if expiresIn, _ := tokens["expires_in"].(float64); expiresIn != 900 {
		t.Fatalf("tokens.expires_in = %v, want 900", tokens["expires_in"])
	}

	w2, resp2 := doJSON(t, r, http.MethodGet, "/api/v1/auth/qr/"+qrToken, nil)
	if w2.Code != http.StatusNotFound {
		t.Fatalf("第二次轮询 status = %d, want 404, body=%s", w2.Code, w2.Body.String())
	}
	if resp2.Message != "auth.qrExpired" {
		t.Fatalf("message = %q, want auth.qrExpired", resp2.Message)
	}
}

// TestQRScanUnknownTokenReturns404 扫到不存在的码是 404，而不是 500。
func TestQRScanUnknownTokenReturns404(t *testing.T) {
	r, _ := newQRLoginEngine(t)

	w, resp := doJSON(t, r, http.MethodPost, "/api/v1/auth/qr/forged-token/scan", nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body=%s", w.Code, w.Body.String())
	}
	if resp.Message != "auth.qrExpired" {
		t.Fatalf("message = %q, want auth.qrExpired", resp.Message)
	}
}

// TestQRConfirmUnknownTokenReturns404 确认不存在的码是 404。
func TestQRConfirmUnknownTokenReturns404(t *testing.T) {
	r, _ := newQRLoginEngine(t)

	w, resp := doJSON(t, r, http.MethodPost, "/api/v1/auth/qr/forged-token/confirm", nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body=%s", w.Code, w.Body.String())
	}
	if resp.Message != "auth.qrExpired" {
		t.Fatalf("message = %q, want auth.qrExpired", resp.Message)
	}
}
