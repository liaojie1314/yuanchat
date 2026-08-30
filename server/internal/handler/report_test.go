package handler

import (
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/repository"
	"github.com/yuanchat/server/internal/service"
	"go.uber.org/zap"
)

// TestReportCreateAcceptsStickerPack 举报目标类型白名单扩展：
// sticker_pack 可提交（进 admin 审核队列），白名单外的类型被拒。
func TestReportCreateAcceptsStickerPack(t *testing.T) {
	db := packTestDB(t)
	adminSvc := service.NewAdminService(
		repository.NewAdminRepository(db),
		repository.NewConversationRepository(db),
		zap.NewNop(),
	)
	h := NewReportHandler(adminSvc, zap.NewNop())
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", packRouterState.current)
		c.Next()
	})
	r.POST("/api/v1/reports", h.Create)

	reporter := newPackTestUser(t, db, "举报人")
	target := uuid.New()
	packRouterState.current = reporter.ID

	// sticker_pack → 200
	w, resp := doPackJSON(t, r, "POST", "/api/v1/reports", gin.H{
		"target_type": "sticker_pack",
		"target_id":   target,
		"reason":      "包名违规",
	})
	if w.Code != 200 {
		t.Fatalf("sticker_pack report status = %d resp=%v", w.Code, resp)
	}
	t.Cleanup(func() {
		db.Exec(`DELETE FROM reports WHERE target_type = ? AND target_id = ?`, "sticker_pack", target)
	})

	// 白名单外 → 400
	w, _ = doPackJSON(t, r, "POST", "/api/v1/reports", gin.H{
		"target_type": "video",
		"target_id":   target,
	})
	if w.Code != 400 {
		t.Fatalf("unknown target_type status = %d, want 400", w.Code)
	}
}
