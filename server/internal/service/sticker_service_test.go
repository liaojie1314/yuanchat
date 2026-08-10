package service

import (
	"context"
	"errors"
	"testing"

	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// TestH1TablesExist 兜底确认 011 新表可用（AutoMigrate 补建）。
func TestH1TablesExist(t *testing.T) {
	db := testDB(t)
	if err := db.AutoMigrate(&model.StickerPack{}, &model.Sticker{}); err != nil {
		t.Fatalf("automigrate sticker tables: %v", err)
	}
}

func newStickerSvc(db *gorm.DB) *StickerService {
	return NewStickerService(repository.NewStickerRepository(db), zap.NewNop())
}

// TestStickerAddDedup 重复收藏同一内容（同 owner 同 hash）不新增行；不同用户各自独立。
func TestStickerAddDedup(t *testing.T) {
	db := testDB(t)
	db.AutoMigrate(&model.StickerPack{}, &model.Sticker{})
	alice := newTestUser(t, db, "甲sticker")
	bob := newTestUser(t, db, "乙sticker")
	svc := newStickerSvc(db)
	ctx := context.Background()

	// SHA-256 十六进制须为 64 字符（服务端按此校验格式，不接受任意短字符串）
	const hashAbc = "5b6642cf4331eb911b475ea8fb19d09cbc073c73b55a10134928984daee7fc41"
	s1, err := svc.Add(ctx, alice.ID, "images/2026/08/a.png", 96, 96, hashAbc)
	if err != nil {
		t.Fatalf("first add: %v", err)
	}
	s2, err := svc.Add(ctx, alice.ID, "images/2026/08/a.png", 96, 96, hashAbc)
	if err != nil {
		t.Fatalf("dup add: %v", err)
	}
	if s1.ID != s2.ID {
		t.Fatalf("duplicate content should return same row, got %s vs %s", s1.ID, s2.ID)
	}

	// 落库真实性核验：直接查库确认只有一行，不仅凭返回值判断
	var count int64
	db.Model(&model.Sticker{}).Where("owner_id = ? AND content_hash = ?", alice.ID, hashAbc).Count(&count)
	if count != 1 {
		t.Fatalf("want exactly 1 row in DB after dedup, got %d", count)
	}

	mine, err := svc.ListMine(ctx, alice.ID)
	if err != nil || len(mine) != 1 {
		t.Fatalf("want 1 sticker after dedup, got %d err=%v", len(mine), err)
	}

	// bob 收藏同 hash 内容：与 alice 互不影响（unique 是 (owner_id, hash)）
	if _, err := svc.Add(ctx, bob.ID, "images/2026/08/a.png", 96, 96, hashAbc); err != nil {
		t.Fatalf("bob add same hash: %v", err)
	}
	bobMine, err := svc.ListMine(ctx, bob.ID)
	if err != nil || len(bobMine) != 1 {
		t.Fatalf("bob should have 1 sticker independent of alice, got %d err=%v", len(bobMine), err)
	}
}

// TestStickerAddInvalidObjectKey 非 images/ 前缀的 object_key 被拒绝。
func TestStickerAddInvalidObjectKey(t *testing.T) {
	db := testDB(t)
	db.AutoMigrate(&model.StickerPack{}, &model.Sticker{})
	alice := newTestUser(t, db, "甲invalid")
	svc := newStickerSvc(db)
	// object_key 前缀校验先于 hash 格式校验执行，短 hash "h" 不影响本用例断言目标
	if _, err := svc.Add(context.Background(), alice.ID, "files/2026/08/a.pdf", 10, 10, "h"); !errors.Is(err, ErrInvalidObjectKey) {
		t.Fatalf("want ErrInvalidObjectKey, got %v", err)
	}
}

// TestStickerAddInvalidContentHash 非 64 位十六进制的 content_hash 被拒绝。
func TestStickerAddInvalidContentHash(t *testing.T) {
	db := testDB(t)
	db.AutoMigrate(&model.StickerPack{}, &model.Sticker{})
	alice := newTestUser(t, db, "甲hash")
	svc := newStickerSvc(db)
	if _, err := svc.Add(context.Background(), alice.ID, "images/2026/08/a.png", 10, 10, "too-short"); !errors.Is(err, ErrInvalidContentHash) {
		t.Fatalf("want ErrInvalidContentHash, got %v", err)
	}
}

// TestStickerRemoveOnlyOwner 只能删除自己的贴纸，删他人的报错；落库真实删除而非仅返回值无误。
func TestStickerRemoveOnlyOwner(t *testing.T) {
	db := testDB(t)
	db.AutoMigrate(&model.StickerPack{}, &model.Sticker{})
	alice := newTestUser(t, db, "甲remove")
	bob := newTestUser(t, db, "乙remove")
	svc := newStickerSvc(db)
	ctx := context.Background()
	const hashB = "41e63399bacaae3dafdf677291f0a7621fc58a681fa89daba700a678d18e7e78"
	s, err := svc.Add(ctx, alice.ID, "images/2026/08/b.png", 96, 96, hashB)
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	if err := svc.Remove(ctx, bob.ID, s.ID); err == nil {
		t.Fatal("bob should not be able to remove alice's sticker")
	}
	// 越权删除尝试后，DB 行仍然存在
	var stillThere model.Sticker
	if err := db.First(&stillThere, "id = ?", s.ID).Error; err != nil {
		t.Fatalf("row should still exist after unauthorized remove attempt: %v", err)
	}

	if err := svc.Remove(ctx, alice.ID, s.ID); err != nil {
		t.Fatalf("alice remove own sticker: %v", err)
	}
	mine, _ := svc.ListMine(ctx, alice.ID)
	if len(mine) != 0 {
		t.Fatalf("want 0 after remove, got %d", len(mine))
	}
	// 落库真实性核验：直接查库确认行已消失
	var afterCount int64
	db.Model(&model.Sticker{}).Where("id = ?", s.ID).Count(&afterCount)
	if afterCount != 0 {
		t.Fatalf("row should be gone from DB after remove, got count=%d", afterCount)
	}
}

// TestStickerRemoveNotFound 删除不存在的贴纸报错。
func TestStickerRemoveNotFound(t *testing.T) {
	db := testDB(t)
	db.AutoMigrate(&model.StickerPack{}, &model.Sticker{})
	alice := newTestUser(t, db, "甲notfound")
	svc := newStickerSvc(db)
	if err := svc.Remove(context.Background(), alice.ID, alice.ID); !errors.Is(err, ErrStickerNotFound) {
		t.Fatalf("want ErrStickerNotFound, got %v", err)
	}
}

// TestStickerListPacks 官方包及其贴纸能正确列出（依赖 seed 数据，若未 seed 则期望空列表不报错）。
func TestStickerListPacks(t *testing.T) {
	db := testDB(t)
	db.AutoMigrate(&model.StickerPack{}, &model.Sticker{})
	svc := newStickerSvc(db)
	packs, err := svc.ListPacks(context.Background())
	if err != nil {
		t.Fatalf("list packs: %v", err)
	}
	for _, p := range packs {
		if !p.Pack.IsOfficial {
			t.Fatalf("all seeded packs should be official, got %+v", p.Pack)
		}
	}
}
