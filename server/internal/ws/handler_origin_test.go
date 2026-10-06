package ws

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"go.uber.org/zap"

	"github.com/yuanchat/server/internal/config"
)

// newOriginFixture 构造一个只用于跑 CheckOrigin 的 Handler。
// CheckOrigin 只读 isProd 与 cfg.AllowedOrigins，其余依赖传 nil 不会被触碰。
func newOriginFixture(isProd bool, allowed []string) *Handler {
	return NewHandler(
		nil, nil, nil,
		config.WebSocketConfig{AllowedOrigins: allowed},
		isProd, zap.NewNop(), nil,
	)
}

// checkOrigin 用给定 Origin 与 Host 驱动一次 CheckOrigin。
func checkOrigin(h *Handler, origin, host string) bool {
	req := httptest.NewRequest(http.MethodGet, "/ws?token=x", nil)
	req.Host = host
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	return h.upgrader.CheckOrigin(req)
}

// 生产环境下 app 与 ws 分属不同子域是常态：Web 端在 chat.* 而 WS 在 ws.*，
// 桌面端 WebView 的 Origin 还是 tauri://localhost。只认同源会把全部真实客户端挡在门外。
func TestCheckOriginAllowsConfiguredCrossSubdomainOrigins(t *testing.T) {
	h := newOriginFixture(true, []string{
		"https://chat.yuanyuan.blog",
		"tauri://localhost",
	})

	cases := []struct {
		name   string
		origin string
		want   bool
	}{
		{"Web 端跨子域 Origin", "https://chat.yuanyuan.blog", true},
		{"桌面端 WebView Origin", "tauri://localhost", true},
		{"未登记的站点", "https://evil.example.com", false},
		{"缺失 Origin（非浏览器直连）", "", false},
		// 配了白名单就不再回落同源，否则「漏配一项」会被同源规则悄悄兜住，
		// 等到换域名时才集体 403。
		{"与 Host 同源但不在白名单", "https://ws.yuanyuan.blog", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := checkOrigin(h, tc.origin, "ws.yuanyuan.blog"); got != tc.want {
				t.Fatalf("CheckOrigin(%q) = %v, want %v", tc.origin, got, tc.want)
			}
		})
	}
}

// 没配白名单时保持旧的同源行为，单域部署不受影响。
func TestCheckOriginFallsBackToSameHostWhenUnset(t *testing.T) {
	h := newOriginFixture(true, nil)

	if !checkOrigin(h, "https://im.example.com", "im.example.com") {
		t.Fatal("同源 Origin 应放行")
	}
	if checkOrigin(h, "https://other.example.com", "im.example.com") {
		t.Fatal("非同源 Origin 应拒绝")
	}
}

// 开发环境放行全部 Origin，便于 vite dev server 与模拟器直连。
func TestCheckOriginAllowsAllInDevelopment(t *testing.T) {
	h := newOriginFixture(false, nil)

	if !checkOrigin(h, "http://localhost:1420", "127.0.0.1:8086") {
		t.Fatal("开发环境应放行任意 Origin")
	}
}
