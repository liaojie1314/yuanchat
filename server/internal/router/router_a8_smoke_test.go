// auth 补全批次新增端点的接线冒烟：路由注册断言 + 逐端点的状态码与响应形状断言。
//
// 存在的意义是「一处看全」：忘记密码 3 条、扫码登录 4 条、登出 1 条共 8 条路由，
// 任何一条被误删、改名、漏挂中间件或换错响应壳，这个文件都会红。
// 各端点的完整业务分支仍由 router_auth_test.go / router_qr_test.go 覆盖，此处不重复。

package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/pkg/jwt"
	"github.com/yuanchat/server/internal/testutil"
	"go.uber.org/zap"
)

// a8Routes 是本批次新增的全部路由，键为「方法 + 路径」。
//
// 逐条写死而不是从代码里推导：推导出来的期望值会跟着实现一起漂，等于什么都没断言。
var a8Routes = []string{
	"POST /api/v1/auth/password/otp",
	"POST /api/v1/auth/password/verify",
	"POST /api/v1/auth/password/reset",
	"POST /api/v1/auth/qr/session",
	"GET /api/v1/auth/qr/:token",
	"POST /api/v1/auth/qr/:token/scan",
	"POST /api/v1/auth/qr/:token/confirm",
	"POST /api/v1/auth/logout",
}

// smokeEnv 是冒烟环境：真实 Setup + 进程内 redis，不接数据库。
//
// 不接库是刻意的 —— 冒烟只验证接线（路由、中间件链、错误壳），
// 因此每条断言都选在触达数据库之前就能判定的分支上；需要真库的链路由端到端用例覆盖。
type smokeEnv struct {
	r     *gin.Engine
	token string
}

// newSmokeEnv 装配引擎并签发一个可用的 access 令牌。
func newSmokeEnv(t *testing.T) *smokeEnv {
	t.Helper()
	rdb, _ := testutil.NewRedis(t)
	cfg := authTestConfig()
	r, _ := Setup(nil, rdb, nil, cfg, zap.NewNop(), &recordingSender{})

	gen := jwt.NewGenerator(cfg.JWT.Secret, cfg.JWT.AccessTokenTTL, cfg.JWT.RefreshTokenTTL)
	pair, err := gen.GeneratePair(uuid.New(), "web", 0)
	if err != nil {
		t.Fatalf("generate pair: %v", err)
	}
	return &smokeEnv{r: r, token: pair.AccessToken}
}

// do 发一次请求，可选 JSON 请求体、Bearer 令牌与额外请求头。
func (e *smokeEnv) do(method, target, body, bearer string, headers map[string]string) *httptest.ResponseRecorder {
	var reader *strings.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	var req *http.Request
	if reader != nil {
		req = httptest.NewRequest(method, target, reader)
		req.Header.Set("Content-Type", "application/json")
	} else {
		req = httptest.NewRequest(method, target, nil)
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	e.r.ServeHTTP(w, req)
	return w
}

// smokeEnvelope 是统一响应壳，用于断言响应形状而不只是状态码。
type smokeEnvelope struct {
	Code    int            `json:"code"`
	Message string         `json:"message"`
	Data    map[string]any `json:"data"`
}

// decode 解析响应体；空体（204）返回零值。
func decode(t *testing.T, w *httptest.ResponseRecorder) smokeEnvelope {
	t.Helper()
	var env smokeEnvelope
	if w.Body.Len() == 0 {
		return env
	}
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatalf("响应不是统一信封: %q, err=%v", w.Body.String(), err)
	}
	return env
}

// TestA8RoutesRegistered 八条新增路由必须以确切的方法与路径注册，且不重复注册。
//
// 走真实 Setup 而非复刻路由表，因此同时覆盖路由树冲突
// （/auth/qr/:token 与 /auth/qr/session 同层共存）与 handler 方法存在性。
func TestA8RoutesRegistered(t *testing.T) {
	cfg := authTestConfig()
	r, _ := Setup(nil, nil, nil, cfg, zap.NewNop(), &recordingSender{})

	seen := make(map[string]int, len(a8Routes))
	for _, ri := range r.Routes() {
		seen[ri.Method+" "+ri.Path]++
	}
	for _, route := range a8Routes {
		switch seen[route] {
		case 1:
			// 恰好一次
		case 0:
			t.Errorf("路由未注册: %s", route)
		default:
			t.Errorf("路由重复注册 %d 次: %s", seen[route], route)
		}
	}
}

// TestA8AuthEndpointsSmoke 逐端点断言状态码与响应形状。
//
// 每一行都落在触达数据库之前可判定的分支上：要么是 binding 拦下的 400，
// 要么是 AuthRequired 拦下的 401，要么是 Redis 里查不到会话的 404。
// 断言的是「确切状态码 + 确切 message」，不是「不是 404」—— 后者连 handler 挂错都发现不了。
func TestA8AuthEndpointsSmoke(t *testing.T) {
	env := newSmokeEnv(t)
	const unknownToken = "smoke-unknown-qr-token"

	cases := []struct {
		name        string
		method      string
		target      string
		body        string
		bearer      string
		headers     map[string]string
		wantStatus  int
		wantCode    int
		wantMessage string
	}{
		{
			name: "发码缺手机号是 400", method: http.MethodPost,
			target: "/api/v1/auth/password/otp", body: `{}`,
			wantStatus: http.StatusBadRequest, wantCode: 400, wantMessage: "auth.otpRequired",
		},
		{
			name: "校验码缺字段是 400", method: http.MethodPost,
			target: "/api/v1/auth/password/verify", body: `{"phone":"13800138000"}`,
			wantStatus: http.StatusBadRequest, wantCode: 400, wantMessage: "auth.otpRequired",
		},
		{
			name: "改密缺字段是 400", method: http.MethodPost,
			target: "/api/v1/auth/password/reset", body: `{}`,
			wantStatus: http.StatusBadRequest, wantCode: 400, wantMessage: "auth.resetFailed",
		},
		{
			name: "建会话平台标识非法是 400", method: http.MethodPost,
			target: "/api/v1/auth/qr/session", body: `{"device_id":"android"}`,
			wantStatus: http.StatusBadRequest, wantCode: 400, wantMessage: "auth.qrFailed",
		},
		{
			name: "轮询未知会话是 404", method: http.MethodGet,
			target:  "/api/v1/auth/qr/" + unknownToken,
			headers: map[string]string{"X-Qr-Poll-Secret": "smoke-secret"},
			// 会话不存在时先于密钥比对返回，因此这里是 404 而不是 403
			wantStatus: http.StatusNotFound, wantCode: 404, wantMessage: "auth.qrExpired",
		},
		{
			name: "匿名扫码是 401", method: http.MethodPost,
			target:     "/api/v1/auth/qr/" + unknownToken + "/scan",
			wantStatus: http.StatusUnauthorized, wantCode: 401, wantMessage: "authorization token required",
		},
		{
			name: "已登录扫未知会话是 404", method: http.MethodPost,
			target: "/api/v1/auth/qr/" + unknownToken + "/scan", bearer: env.token,
			wantStatus: http.StatusNotFound, wantCode: 404, wantMessage: "auth.qrExpired",
		},
		{
			name: "匿名确认是 401", method: http.MethodPost,
			target:     "/api/v1/auth/qr/" + unknownToken + "/confirm",
			wantStatus: http.StatusUnauthorized, wantCode: 401, wantMessage: "authorization token required",
		},
		{
			name: "已登录确认未知会话是 404", method: http.MethodPost,
			target: "/api/v1/auth/qr/" + unknownToken + "/confirm", bearer: env.token,
			wantStatus: http.StatusNotFound, wantCode: 404, wantMessage: "auth.qrExpired",
		},
		{
			name: "匿名登出是 401", method: http.MethodPost,
			target:     "/api/v1/auth/logout",
			wantStatus: http.StatusUnauthorized, wantCode: 401, wantMessage: "authorization token required",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := env.do(tc.method, tc.target, tc.body, tc.bearer, tc.headers)
			if w.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d, body=%s", w.Code, tc.wantStatus, w.Body.String())
			}
			got := decode(t, w)
			if got.Code != tc.wantCode {
				t.Errorf("code = %d, want %d, body=%s", got.Code, tc.wantCode, w.Body.String())
			}
			if got.Message != tc.wantMessage {
				t.Errorf("message = %q, want %q", got.Message, tc.wantMessage)
			}
			if got.Data != nil {
				t.Errorf("出错响应不应带 data: %s", w.Body.String())
			}
		})
	}
}

// TestA8LogoutSmokeReturnsEmpty204 带合法令牌登出是 204 且响应体完全为空。
//
// 空响应体这条必须钉住：前端 doFetch 在 204 分支直接短路，
// 一旦这里改成带信封的 200，前端拿到的就是 undefined 而不是数据。
func TestA8LogoutSmokeReturnsEmpty204(t *testing.T) {
	env := newSmokeEnv(t)

	w := env.do(http.MethodPost, "/api/v1/auth/logout", "", env.token, nil)
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204, body=%s", w.Code, w.Body.String())
	}
	if w.Body.Len() != 0 {
		t.Fatalf("204 不应带响应体，got %q", w.Body.String())
	}
}

// TestA8QRSessionAndPollSmoke 建会话与轮询的成功响应形状。
//
// 这两条是前端扫码页的全部输入：字段名或字段个数一变，页面就拿不到二维码或倒计时。
func TestA8QRSessionAndPollSmoke(t *testing.T) {
	env := newSmokeEnv(t)

	w := env.do(http.MethodPost, "/api/v1/auth/qr/session", `{"device_id":"web"}`, "", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("session status = %d, want 200, body=%s", w.Code, w.Body.String())
	}
	created := decode(t, w)
	if created.Code != 0 || created.Message != "ok" {
		t.Fatalf("session 信封 = %+v, want code 0 / message ok", created)
	}
	qrToken, _ := created.Data["qr_token"].(string)
	pollSecret, _ := created.Data["poll_secret"].(string)
	if qrToken == "" || pollSecret == "" {
		t.Fatalf("session 缺 qr_token 或 poll_secret: %s", w.Body.String())
	}
	if payload, _ := created.Data["qr_payload"].(string); payload != "yuanchat://login?t="+qrToken {
		t.Fatalf("qr_payload = %q, want yuanchat://login?t=<qr_token>", payload)
	}
	if expiresIn, _ := created.Data["expires_in"].(float64); expiresIn != 120 {
		t.Fatalf("expires_in = %v, want 120", created.Data["expires_in"])
	}

	// 持密钥轮询：pending + 正数倒计时 + 无令牌
	w = env.do(http.MethodGet, "/api/v1/auth/qr/"+qrToken, "", "",
		map[string]string{"X-Qr-Poll-Secret": pollSecret})
	if w.Code != http.StatusOK {
		t.Fatalf("poll status = %d, want 200, body=%s", w.Code, w.Body.String())
	}
	polled := decode(t, w)
	if status, _ := polled.Data["status"].(string); status != "pending" {
		t.Fatalf("status = %v, want pending", polled.Data["status"])
	}
	if expiresIn, _ := polled.Data["expires_in"].(float64); expiresIn <= 0 {
		t.Fatalf("expires_in = %v, 前端倒计时需要正数", polled.Data["expires_in"])
	}
	if _, has := polled.Data["tokens"]; has {
		t.Fatalf("pending 不得带 tokens: %s", w.Body.String())
	}

	// 缺密钥轮询：403 且不给状态
	w = env.do(http.MethodGet, "/api/v1/auth/qr/"+qrToken, "", "", nil)
	if w.Code != http.StatusForbidden {
		t.Fatalf("缺密钥 poll status = %d, want 403, body=%s", w.Code, w.Body.String())
	}
	if got := decode(t, w); got.Message != "auth.qrFailed" {
		t.Fatalf("message = %q, want auth.qrFailed", got.Message)
	}
}
