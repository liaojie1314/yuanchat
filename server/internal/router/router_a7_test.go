package router

import (
	"testing"
	"time"

	"github.com/yuanchat/server/internal/config"
	"go.uber.org/zap"
)

// TestA7RoutesRegistered A7 三端点接线冒烟：路由真实注册且方法/路径正确。
//
// 走真实 router.Setup（而非复刻路由表），因此同时覆盖：
// 路由树冲突（如 DELETE /conversations/:id/messages 与既有 GET 同路径共存）、
// handler 方法存在性。Setup 内不做 DB/网络调用，故 db/rdb 传 nil 即可。
func TestA7RoutesRegistered(t *testing.T) {
	cfg := &config.Config{}
	cfg.Server.Env = "test"
	cfg.JWT.Secret = "test-secret-for-routing-only"
	cfg.JWT.AccessTokenTTL = time.Hour
	cfg.JWT.RefreshTokenTTL = time.Hour
	cfg.WebSocket.MaxConnectionsPerUser = 1
	cfg.Presence.Backend = "local"

	r, _ := Setup(nil, nil, nil, cfg, zap.NewNop())

	want := map[string]bool{
		"DELETE /api/v1/conversations/:id/messages":    false,
		"PATCH /api/v1/conversations/:id/announcement": false,
		"PUT /api/v1/conversations/:id/my-alias":       false,
	}
	for _, ri := range r.Routes() {
		if _, tracked := want[ri.Method+" "+ri.Path]; tracked {
			want[ri.Method+" "+ri.Path] = true
		}
	}
	for route, found := range want {
		if !found {
			t.Errorf("A7 route not registered: %s", route)
		}
	}
}
