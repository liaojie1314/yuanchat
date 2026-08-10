package service

import (
	"testing"

	"github.com/yuanchat/server/internal/model"
)

// TestH1TablesExist 兜底确认 011 新表可用（AutoMigrate 补建）。
func TestH1TablesExist(t *testing.T) {
	db := testDB(t)
	if err := db.AutoMigrate(&model.StickerPack{}, &model.Sticker{}); err != nil {
		t.Fatalf("automigrate sticker tables: %v", err)
	}
}
