package router

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/config"
	"github.com/yuanchat/server/internal/pkg/jwt"
	"go.uber.org/zap"
)

// authTestConfig 仅够让 Setup 跑通接线的最小配置（不含 DB / Redis / MinIO）。
func authTestConfig() *config.Config {
	cfg := &config.Config{}
	cfg.Server.Env = "test"
	cfg.JWT.Secret = "test-secret-for-routing-only"
	cfg.JWT.AccessTokenTTL = time.Hour
	cfg.JWT.RefreshTokenTTL = time.Hour
	cfg.WebSocket.MaxConnectionsPerUser = 1
	cfg.Presence.Backend = "local"
	return cfg
}

// authTestEngine 走真实 Setup 装配引擎，并返回一个可用的 access 令牌。
//
// 与 TestA7RoutesRegistered 同因：Setup 内不做 DB/网络调用，db/rdb/storage 传 nil 即可；
// 用真实引擎而非复刻路由表，才能同时覆盖「路由已注册」与「中间件链正确」。
func authTestEngine(t *testing.T) (*gin.Engine, string) {
	t.Helper()
	cfg := authTestConfig()
	r, _ := Setup(nil, nil, nil, cfg, zap.NewNop())

	gen := jwt.NewGenerator(cfg.JWT.Secret, cfg.JWT.AccessTokenTTL, cfg.JWT.RefreshTokenTTL)
	pair, err := gen.GeneratePair(uuid.New(), "web", 0)
	if err != nil {
		t.Fatalf("generate pair: %v", err)
	}
	return r, pair.AccessToken
}

// doLogout 发一次 POST /api/v1/auth/logout；token 为空表示匿名请求。
func doLogout(r *gin.Engine, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// TestLogoutReturns204 带合法 access 令牌登出 → 204 且响应体为空。
func TestLogoutReturns204(t *testing.T) {
	r, token := authTestEngine(t)

	w := doLogout(r, token)
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204, body=%s", w.Code, w.Body.String())
	}
	if w.Body.Len() != 0 {
		t.Fatalf("204 不应带响应体，got %q", w.Body.String())
	}
}

// TestLogoutRequiresAuth 匿名请求 → 401（端点挂在 AuthRequired 之后）。
func TestLogoutRequiresAuth(t *testing.T) {
	r, _ := authTestEngine(t)

	w := doLogout(r, "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401, body=%s", w.Code, w.Body.String())
	}
}
