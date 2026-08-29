package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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

// doPoll 发一次轮询请求；pollSecret 为空表示完全不带 X-Qr-Poll-Secret 请求头。
//
// 密钥走请求头而不是 query，是为了不让它进 access log。
func doPoll(t *testing.T, r *gin.Engine, qrToken, pollSecret string) (*httptest.ResponseRecorder, apiResp) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/qr/"+qrToken, nil)
	if pollSecret != "" {
		req.Header.Set("X-Qr-Poll-Secret", pollSecret)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var resp apiResp
	if w.Body.Len() > 0 {
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode response %q: %v", w.Body.String(), err)
		}
	}
	return w, resp
}

// newConfirmedSession 预置一个已确认的会话，返回其凭据与轮询密钥。
func newConfirmedSession(t *testing.T, rdb *redis.Client) (string, string) {
	t.Helper()
	const qrToken = "confirmed-session-token"
	const pollSecret = "confirmed-session-poll-secret"
	if err := rdb.HSet(t.Context(), "auth:qr:"+qrToken,
		"status", "confirmed",
		"user_id", testUserID.String(),
		"device_id", "web",
		"poll_secret", pollSecret,
		"access_token", "header.access.sig",
		"refresh_token", "header.refresh.sig",
		"token_expires_in", "900",
	).Err(); err != nil {
		t.Fatalf("预置已确认会话: %v", err)
	}
	return qrToken, pollSecret
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
	pollSecret, _ := resp.Data["poll_secret"].(string)
	if pollSecret == "" {
		t.Fatalf("未返回 poll_secret: %s", w.Body.String())
	}
	// 密钥只回给发起端，绝不能出现在二维码内容里
	if payload, _ := resp.Data["qr_payload"].(string); strings.Contains(payload, pollSecret) {
		t.Fatalf("qr_payload 里出现了 poll_secret: %s", w.Body.String())
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

	w, resp := doPoll(t, r, "forged-token", "irrelevant-secret")
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

	w, _ := doPoll(t, r, long, "irrelevant-secret")
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body=%s", w.Code, w.Body.String())
	}
}

// TestQRPollPendingReturnsCountdown 未被扫时回 pending 与剩余秒数，且不带令牌。
func TestQRPollPendingReturnsCountdown(t *testing.T) {
	r, _ := newQRLoginEngine(t)

	_, created := doJSON(t, r, http.MethodPost, "/api/v1/auth/qr/session", map[string]string{})
	qrToken, _ := created.Data["qr_token"].(string)
	pollSecret, _ := created.Data["poll_secret"].(string)

	w, resp := doPoll(t, r, qrToken, pollSecret)
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
	qrToken, pollSecret := newConfirmedSession(t, rdb)

	w, resp := doPoll(t, r, qrToken, pollSecret)
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

	w2, resp2 := doPoll(t, r, qrToken, pollSecret)
	if w2.Code != http.StatusNotFound {
		t.Fatalf("第二次轮询 status = %d, want 404, body=%s", w2.Code, w2.Body.String())
	}
	if resp2.Message != "auth.qrExpired" {
		t.Fatalf("message = %q, want auth.qrExpired", resp2.Message)
	}
}

// TestQRPollWithoutSecretHeaderReturns403 缺 X-Qr-Poll-Secret 请求头一律 403，且不吐令牌。
//
// 拍到二维码的人只有 qr_token；这条断言的就是他既拿不到令牌，
// 也不能靠一次轮询把发起端的令牌销毁掉。
func TestQRPollWithoutSecretHeaderReturns403(t *testing.T) {
	r, rdb := newQRLoginEngine(t)
	qrToken, pollSecret := newConfirmedSession(t, rdb)

	w, resp := doPoll(t, r, qrToken, "")
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403, body=%s", w.Code, w.Body.String())
	}
	if resp.Message != "auth.qrFailed" {
		t.Fatalf("message = %q, want auth.qrFailed", resp.Message)
	}
	if strings.Contains(w.Body.String(), "access_token") {
		t.Fatalf("403 响应泄露了令牌: %s", w.Body.String())
	}

	// 令牌还在，发起端仍能取走
	ok, okResp := doPoll(t, r, qrToken, pollSecret)
	if ok.Code != http.StatusOK {
		t.Fatalf("持正确密钥 status = %d, want 200, body=%s", ok.Code, ok.Body.String())
	}
	if tokens, _ := okResp.Data["tokens"].(map[string]any); tokens == nil {
		t.Fatalf("持正确密钥必须取到令牌: %s", ok.Body.String())
	}
}

// TestQRPollWithWrongSecretHeaderReturns403 密钥不匹配同样 403 且不吐令牌。
func TestQRPollWithWrongSecretHeaderReturns403(t *testing.T) {
	r, rdb := newQRLoginEngine(t)
	qrToken, _ := newConfirmedSession(t, rdb)

	w, resp := doPoll(t, r, qrToken, "not-the-right-secret")
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403, body=%s", w.Code, w.Body.String())
	}
	if resp.Message != "auth.qrFailed" {
		t.Fatalf("message = %q, want auth.qrFailed", resp.Message)
	}
	if strings.Contains(w.Body.String(), "access_token") {
		t.Fatalf("403 响应泄露了令牌: %s", w.Body.String())
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
