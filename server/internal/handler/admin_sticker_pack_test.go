package handler

import (
	"fmt"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"github.com/yuanchat/server/internal/service"
	"go.uber.org/zap"
)

// newAdminTestPack 落一条表情包行并注册清理，返回包 id。
func newAdminTestPack(t *testing.T, db *gorm.DB, name string, flagged, takenDown bool) uuid.UUID {
	t.Helper()
	pack := &model.StickerPack{
		Name:      name,
		IsPublic:  true,
		Flagged:   flagged,
		TakenDown: takenDown,
	}
	if err := db.Create(pack).Error; err != nil {
		t.Fatalf("create pack: %v", err)
	}
	t.Cleanup(func() {
		db.Exec(`DELETE FROM user_sticker_packs WHERE pack_id = ?`, pack.ID)
		db.Exec(`DELETE FROM stickers WHERE pack_id = ?`, pack.ID)
		db.Exec(`DELETE FROM sticker_packs WHERE id = ?`, pack.ID)
	})
	return pack.ID
}

// newAdminPackTestRouter 构造挂好 fake 鉴权（user_id）的 admin 路由。
// actor 必须是真实存在的用户：下架/清除标记会写 admin_action_logs.actor_id 外键，
// 假 uuid 会在夹具事务里触发外键违规并中止整个事务。
func newAdminPackTestRouter(t *testing.T, db *gorm.DB, h *AdminHandler) *gin.Engine {
	actor := newPackTestUser(t, db, "admin审核员")
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", actor.ID)
		c.Next()
	})
	r.GET("/api/v1/admin/sticker-packs", h.ListStickerPacks)
	r.POST("/api/v1/admin/sticker-packs/:id/takedown", h.TakeDownStickerPack)
	r.DELETE("/api/v1/admin/sticker-packs/:id/flag", h.ClearStickerPackFlag)
	return r
}

// TestAdminListStickerPacksFlagged 审核队列检索：flagged=true 只返回敏感词命中的包，
// 行内带发布者昵称与贴纸数投影。
func TestAdminListStickerPacksFlagged(t *testing.T) {
	db := packTestDB(t)
	suffix := uuid.NewString()[:8]
	flaggedID := newAdminTestPack(t, db, fmt.Sprintf("审核包-%s", suffix), true, false)
	cleanName := fmt.Sprintf("干净包-%s", suffix)
	newAdminTestPack(t, db, cleanName, false, false)

	adminSvc := service.NewAdminService(
		repository.NewAdminRepository(db),
		repository.NewConversationRepository(db),
		zap.NewNop(),
	)
	r := newAdminPackTestRouter(t, db, NewAdminHandler(adminSvc, nil, zap.NewNop()))

	w, resp := doPackJSON(t, r, "GET", "/api/v1/admin/sticker-packs?flagged=true", nil)
	if w.Code != 200 {
		t.Fatalf("list status = %d resp=%v", w.Code, resp)
	}
	items, _ := resp["data"].([]any)
	if len(items) == 0 {
		t.Fatal("flagged list empty")
	}
	found := false
	for _, it := range items {
		row, _ := it.(map[string]any)
		if row["id"] == flaggedID.String() {
			found = true
			if row["flagged"] != true {
				t.Fatalf("flagged row flagged = %v", row["flagged"])
			}
			if _, ok := row["sticker_count"]; !ok {
				t.Fatal("sticker_count missing")
			}
		}
		if name, _ := row["name"].(string); name == cleanName {
			t.Fatal("clean pack leaked into flagged list")
		}
	}
	if !found {
		t.Fatal("flagged pack not in flagged list")
	}
}

// TestAdminTakeDownStickerPack 直接下架：置 taken_down，未知 id 返回 404。
func TestAdminTakeDownStickerPack(t *testing.T) {
	db := packTestDB(t)
	packID := newAdminTestPack(t, db, "待下架包", false, false)

	adminSvc := service.NewAdminService(
		repository.NewAdminRepository(db),
		repository.NewConversationRepository(db),
		zap.NewNop(),
	)
	r := newAdminPackTestRouter(t, db, NewAdminHandler(adminSvc, nil, zap.NewNop()))

	w, resp := doPackJSON(t, r, "POST", fmt.Sprintf("/api/v1/admin/sticker-packs/%s/takedown", packID), nil)
	if w.Code != 200 {
		t.Fatalf("takedown status = %d resp=%v", w.Code, resp)
	}
	var pack model.StickerPack
	if err := db.First(&pack, "id = ?", packID).Error; err != nil {
		t.Fatalf("reload pack: %v", err)
	}
	if !pack.TakenDown {
		t.Fatal("taken_down not persisted")
	}

	w2, _ := doPackJSON(t, r, "POST", fmt.Sprintf("/api/v1/admin/sticker-packs/%s/takedown", uuid.New()), nil)
	if w2.Code != 404 {
		t.Fatalf("unknown pack status = %d", w2.Code)
	}
}

// TestAdminClearStickerPackFlag 清除标记：flagged 归零，未知 id 返回 404。
func TestAdminClearStickerPackFlag(t *testing.T) {
	db := packTestDB(t)
	packID := newAdminTestPack(t, db, "误标包", true, false)

	adminSvc := service.NewAdminService(
		repository.NewAdminRepository(db),
		repository.NewConversationRepository(db),
		zap.NewNop(),
	)
	r := newAdminPackTestRouter(t, db, NewAdminHandler(adminSvc, nil, zap.NewNop()))

	w, resp := doPackJSON(t, r, "DELETE", fmt.Sprintf("/api/v1/admin/sticker-packs/%s/flag", packID), nil)
	if w.Code != 200 {
		t.Fatalf("clear flag status = %d resp=%v", w.Code, resp)
	}
	var pack model.StickerPack
	if err := db.First(&pack, "id = ?", packID).Error; err != nil {
		t.Fatalf("reload pack: %v", err)
	}
	if pack.Flagged {
		t.Fatal("flagged not cleared")
	}

	w2, _ := doPackJSON(t, r, "DELETE", fmt.Sprintf("/api/v1/admin/sticker-packs/%s/flag", uuid.New()), nil)
	if w2.Code != 404 {
		t.Fatalf("unknown pack status = %d", w2.Code)
	}
}
