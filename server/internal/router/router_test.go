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

// TestMomentsRoutesRegistered 朋友圈路由表合法且静态段优先于参数段：
// 与表情包同理，/moments/activities、/moments/comments/:id 等静态段若注册在
// :id 之后，客户端会被解析成 UUID 失败拿 400。这里以空引擎真实注册一遍并逐条断言。
func TestMomentsRoutesRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	registerMomentsRoutes(r.Group("/api/v1"), handler.NewMomentsHandler(nil, zap.NewNop()))

	type route struct{ method, path, handler string }
	want := []route{
		{"POST", "/api/v1/moments", "Create"},
		{"GET", "/api/v1/moments/feed", "Feed"},
		{"GET", "/api/v1/moments/activities", "Activities"},
		{"POST", "/api/v1/moments/activities/read", "MarkRead"},
		{"GET", "/api/v1/moments/user/:id", "UserPosts"},
		{"GET", "/api/v1/moments/:id", "Get"},
		{"DELETE", "/api/v1/moments/:id", "Delete"},
		{"POST", "/api/v1/moments/:id/like", "Like"},
		{"DELETE", "/api/v1/moments/:id/like", "Unlike"},
		{"POST", "/api/v1/moments/:id/comments", "AddComment"},
		{"DELETE", "/api/v1/moments/comments/:id", "DeleteComment"},
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
		if !strings.Contains(h, "(*MomentsHandler)."+w.handler) {
			t.Fatalf("route %s %s should hit MomentsHandler.%s, got %s", w.method, w.path, w.handler, h)
		}
	}
	// 参数段不得吞掉静态段
	if got["GET /api/v1/moments/:id"] == got["GET /api/v1/moments/activities"] {
		t.Fatal("activities and :id should be distinct handlers")
	}
}
