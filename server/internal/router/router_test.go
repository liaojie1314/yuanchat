package router

import (
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/yuanchat/server/internal/handler"
	"go.uber.org/zap"
)

// TestStickerPackRoutesRegistered 表情包路由表合法且静态段优先于参数段：
// gin 的基数树在「/sticker-packs/market 与 /sticker-packs/:id 同级」时若冲突会 panic，
// 这里以空引擎真实注册一遍（router.go 走的就是本函数），
// 并断言 market / :id 各自命中专属 handler 而非相互吞并。
func TestStickerPackRoutesRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	registerStickerPackRoutes(r.Group("/api/v1"), handler.NewStickerHandler(nil, zap.NewNop()))

	type route struct{ method, path, handler string }
	want := []route{
		{"GET", "/api/v1/sticker-packs", "ListPacks"},
		{"GET", "/api/v1/sticker-packs/market", "Market"},
		{"GET", "/api/v1/sticker-packs/mine", "ListMyPacks"},
		{"POST", "/api/v1/sticker-packs", "Publish"},
		{"GET", "/api/v1/sticker-packs/:id", "PackDetail"},
		{"PATCH", "/api/v1/sticker-packs/:id", "UpdatePack"},
		{"DELETE", "/api/v1/sticker-packs/:id", "DeleteMinePack"},
		{"POST", "/api/v1/sticker-packs/:id/add", "AddPack"},
		{"DELETE", "/api/v1/sticker-packs/:id/add", "RemovePack"},
		{"POST", "/api/v1/sticker-packs/:id/stickers", "AddPackSticker"},
		{"DELETE", "/api/v1/sticker-packs/:id/stickers/:stickerId", "RemovePackSticker"},
	}
	got := make(map[string]string, len(r.Routes()))
	for _, ri := range r.Routes() {
		got[ri.Method+" "+ri.Path] = ri.Handler
	}
	for _, w := range want {
		h, ok := got[w.method+" "+w.path]
		if !ok {
			t.Fatalf("route %s %s not registered; got %v", w.method, w.path, got)
		}
		// handler 名形如 ".../handler.(*StickerHandler).ListPacks-fm"，按方法名包含匹配
		if !strings.Contains(h, "(*StickerHandler)."+w.handler) {
			t.Fatalf("route %s %s should hit StickerHandler.%s, got %s", w.method, w.path, w.handler, h)
		}
	}
	// 参数段不得吞掉静态段：/market 不能被解析成 :id
	if got["GET /api/v1/sticker-packs/:id"] == got["GET /api/v1/sticker-packs/market"] {
		t.Fatal("market and :id should be distinct handlers")
	}
}
