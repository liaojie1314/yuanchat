package service

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
)

// seedSvcPack 建一次性表情包（service 层用例），测试结束连同贴纸、添加关系清理。
func seedSvcPack(t *testing.T, db *gorm.DB, mutate func(*model.StickerPack)) *model.StickerPack {
	t.Helper()
	pack := &model.StickerPack{Name: fmt.Sprintf("svc包-%s", uuid.NewString()[:8])}
	if mutate != nil {
		mutate(pack)
	}
	if err := db.Create(pack).Error; err != nil {
		t.Fatalf("create pack: %v", err)
	}
	t.Cleanup(func() {
		db.Exec(`DELETE FROM user_sticker_packs WHERE pack_id = ?`, pack.ID)
		db.Exec(`DELETE FROM stickers WHERE pack_id = ?`, pack.ID)
		db.Unscoped().Delete(pack)
	})
	return pack
}

// migrateSvcStickerTables 建商城相关表（AutoMigrate 覆盖 015 的新列与新表）。
func migrateSvcStickerTables(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.AutoMigrate(&model.StickerPack{}, &model.Sticker{}, &model.UserStickerPack{}); err != nil {
		t.Fatalf("migrate sticker tables: %v", err)
	}
}

// TestStickerMarketCursorAndAdded 商城列表：过滤公开未下架、时间倒序、added 批量标记、
// 游标翻页与 next_cursor 终止。
func TestStickerMarketCursorAndAdded(t *testing.T) {
	db := testDB(t)
	migrateSvcStickerTables(t, db)
	svc := newStickerSvc(db)
	ctx := context.Background()

	alice := newTestUser(t, db, "market-svc")
	owner := newTestUser(t, db, "market-svc-owner")
	base := time.Now().Add(-time.Hour)

	p1 := seedSvcPack(t, db, func(p *model.StickerPack) {
		p.OwnerID = &owner.ID
		p.IsPublic = true
		p.CreatedAt = base
	})
	p2 := seedSvcPack(t, db, func(p *model.StickerPack) {
		p.OwnerID = &owner.ID
		p.IsPublic = true
		p.CreatedAt = base.Add(time.Minute)
	})
	seedSvcPack(t, db, func(p *model.StickerPack) { p.IsPublic = true; p.TakenDown = true })   // 隐藏
	seedSvcPack(t, db, func(p *model.StickerPack) { p.CreatedAt = base.Add(time.Minute) })    // 未公开，隐藏
	seedSvcPack(t, db, func(p *model.StickerPack) { p.IsPublic = true; p.Flagged = true })    // 打标不影响展示

	if err := svc.AddPack(ctx, alice.ID, p1.ID); err != nil {
		t.Fatalf("add pack: %v", err)
	}

	// 一次性拉全部：本用例的两个公开包都在，added 只标记 p1
	items, next, err := svc.Market(ctx, alice.ID, "", 50)
	if err != nil {
		t.Fatalf("market: %v", err)
	}
	byID := map[uuid.UUID]MarketPackDTO{}
	var all []uuid.UUID
	for _, it := range items {
		byID[it.ID] = it
		all = append(all, it.ID)
	}
	if !byID[p1.ID].Added || byID[p2.ID].Added {
		t.Fatalf("added flag wrong: p1=%v p2=%v", byID[p1.ID].Added, byID[p2.ID].Added)
	}
	if byID[p1.ID].OwnerName == nil || *byID[p1.ID].OwnerName != owner.Nickname {
		t.Fatalf("owner_name should be %q, got %v", owner.Nickname, byID[p1.ID].OwnerName)
	}
	// p2 比 p1 新：排序上应更靠前
	if idx(all, p2.ID) == -1 || idx(all, p1.ID) == -1 || idx(all, p2.ID) > idx(all, p1.ID) {
		t.Fatalf("market order should be created_at DESC, p2 before p1")
	}
	if next != "" {
		t.Fatalf("next_cursor should be empty on the last page, got %q", next)
	}

	// limit=1 逐页翻完（开发库里还有 seed 出的更早的公开包，游标必须能走到底）：
	// 断言 p2 先于 p1、游标严格单调、最终终止
	var walked []uuid.UUID
	cursor := ""
	for i := 0; i < 20; i++ {
		page, cur, err := svc.Market(ctx, alice.ID, cursor, 1)
		if err != nil {
			t.Fatalf("page %d: %v", i, err)
		}
		if len(page) == 0 {
			t.Fatal("page walk returned an empty page before cursor terminated")
		}
		walked = append(walked, page[0].ID)
		if cur == "" {
			break
		}
		cursor = cur
	}
	if idx(walked, p2.ID) == -1 || idx(walked, p1.ID) == -1 || idx(walked, p2.ID) > idx(walked, p1.ID) {
		t.Fatalf("paged walk should visit p2 before p1, got %v", walked)
	}
	// 游标遍历不允许重复访问同一个包（无 id tie-break 时的时间精度保证）
	seen := map[uuid.UUID]bool{}
	for _, id := range walked {
		if seen[id] {
			t.Fatalf("pack %s visited twice in cursor walk: %v", id, walked)
		}
		seen[id] = true
	}

	if _, _, err := svc.Market(ctx, alice.ID, "not-a-time", 10); !errors.Is(err, ErrInvalidCursor) {
		t.Fatalf("invalid cursor should return ErrInvalidCursor, got %v", err)
	}
}

// idx 返回 id 在列表中的下标，不存在返回 -1。
func idx(ids []uuid.UUID, id uuid.UUID) int {
	for i, v := range ids {
		if v == id {
			return i
		}
	}
	return -1
}

// TestStickerPackDetail 详情：发布者昵称、is_owner、added 与贴纸列表。
func TestStickerPackDetail(t *testing.T) {
	db := testDB(t)
	migrateSvcStickerTables(t, db)
	svc := newStickerSvc(db)
	ctx := context.Background()

	owner := newTestUser(t, db, "detail-owner")
	bob := newTestUser(t, db, "detail-bob")
	pack := seedSvcPack(t, db, func(p *model.StickerPack) {
		p.OwnerID = &owner.ID
		p.IsPublic = true
	})
	for i := 0; i < 2; i++ {
		packID := pack.ID
		st := model.Sticker{
			PackID:      &packID,
			ObjectKey:   fmt.Sprintf("images/2026/08/%s.png", uuid.NewString()),
			Width:       96,
			Height:      96,
			ContentHash: fmt.Sprintf("%064x", time.Now().UnixNano()+int64(i)),
		}
		if err := db.Create(&st).Error; err != nil {
			t.Fatalf("create sticker: %v", err)
		}
		t.Cleanup(func() { db.Unscoped().Delete(&st) })
	}

	forOwner, err := svc.PackDetail(ctx, owner.ID, pack.ID)
	if err != nil {
		t.Fatalf("detail for owner: %v", err)
	}
	if !forOwner.Pack.IsOwner || forOwner.Added {
		t.Fatalf("owner detail: is_owner=%v added=%v, want true/false", forOwner.Pack.IsOwner, forOwner.Added)
	}
	if forOwner.Pack.OwnerName == nil || *forOwner.Pack.OwnerName != owner.Nickname {
		t.Fatalf("owner_name should be %q, got %v", owner.Nickname, forOwner.Pack.OwnerName)
	}
	if len(forOwner.Stickers) != 2 {
		t.Fatalf("want 2 stickers, got %d", len(forOwner.Stickers))
	}
	for _, st := range forOwner.Stickers {
		if st.ObjectKey == "" || st.Width == 0 || st.Height == 0 {
			t.Fatalf("sticker item incomplete: %+v", st)
		}
	}

	forBob, err := svc.PackDetail(ctx, bob.ID, pack.ID)
	if err != nil {
		t.Fatalf("detail for bob: %v", err)
	}
	if forBob.Pack.IsOwner || forBob.Added {
		t.Fatalf("bob detail: is_owner=%v added=%v, want false/false", forBob.Pack.IsOwner, forBob.Added)
	}
	if err := svc.AddPack(ctx, bob.ID, pack.ID); err != nil {
		t.Fatalf("bob add pack: %v", err)
	}
	forBob, err = svc.PackDetail(ctx, bob.ID, pack.ID)
	if err != nil {
		t.Fatalf("detail for bob after add: %v", err)
	}
	if !forBob.Added {
		t.Fatal("bob should see added=true after AddPack")
	}

	if _, err := svc.PackDetail(ctx, bob.ID, uuid.New()); !errors.Is(err, ErrPackNotFound) {
		t.Fatalf("missing pack should return ErrPackNotFound, got %v", err)
	}
}

// TestStickerAddPackGuards 下架/未公开的包不可添加，官方包与公开包可添加且幂等，
// 移除后可再次添加。
func TestStickerAddPackGuards(t *testing.T) {
	db := testDB(t)
	migrateSvcStickerTables(t, db)
	svc := newStickerSvc(db)
	ctx := context.Background()

	alice := newTestUser(t, db, "guard-a")
	official := seedSvcPack(t, db, func(p *model.StickerPack) { p.IsOfficial = true; p.IsPublic = true })
	downed := seedSvcPack(t, db, func(p *model.StickerPack) { p.IsPublic = true; p.TakenDown = true })
	private := seedSvcPack(t, db, nil)

	if err := svc.AddPack(ctx, alice.ID, downed.ID); !errors.Is(err, ErrPackNotAvailable) {
		t.Fatalf("downed pack should be ErrPackNotAvailable, got %v", err)
	}
	if err := svc.AddPack(ctx, alice.ID, private.ID); !errors.Is(err, ErrPackNotAvailable) {
		t.Fatalf("private pack should be ErrPackNotAvailable, got %v", err)
	}
	if err := svc.AddPack(ctx, alice.ID, uuid.New()); !errors.Is(err, ErrPackNotFound) {
		t.Fatalf("unknown pack should be ErrPackNotFound, got %v", err)
	}
	for i := 0; i < 2; i++ {
		if err := svc.AddPack(ctx, alice.ID, official.ID); err != nil {
			t.Fatalf("add official pack (round %d): %v", i, err)
		}
	}
	// 落库幂等：只有一行关系
	var count int64
	db.Model(&model.UserStickerPack{}).Where("user_id = ? AND pack_id = ?", alice.ID, official.ID).Count(&count)
	if count != 1 {
		t.Fatalf("want 1 relation row after double add, got %d", count)
	}
	if err := svc.RemovePack(ctx, alice.ID, official.ID); err != nil {
		t.Fatalf("remove: %v", err)
	}
	// 再移除一次仍幂等成功
	if err := svc.RemovePack(ctx, alice.ID, official.ID); err != nil {
		t.Fatalf("idempotent remove: %v", err)
	}
	added, err := svc.repo.IsAddedBatch(ctx, alice.ID, []uuid.UUID{official.ID})
	if err != nil || added[official.ID] {
		t.Fatalf("pack should be gone from alice's list, got %v err=%v", added, err)
	}
}

// TestStickerListPacksExtended GET /sticker-packs 语义扩展：官方包 + 已添加包；
// 未添加的包不出现（开发库可能存在 seed 的官方包，按 ID 断言）。
func TestStickerListPacksExtended(t *testing.T) {
	db := testDB(t)
	migrateSvcStickerTables(t, db)
	svc := newStickerSvc(db)
	ctx := context.Background()

	alice := newTestUser(t, db, "listp-a")
	bob := newTestUser(t, db, "listp-b")
	official := seedSvcPack(t, db, func(p *model.StickerPack) { p.IsOfficial = true; p.IsPublic = true })
	mine := seedSvcPack(t, db, func(p *model.StickerPack) { p.IsPublic = true })

	if err := svc.AddPack(ctx, alice.ID, mine.ID); err != nil {
		t.Fatalf("add mine: %v", err)
	}
	for _, u := range []struct {
		id     uuid.UUID
		want   uuid.UUID
		unwant uuid.UUID
	}{
		{alice.ID, mine.ID, uuid.Nil},
		{alice.ID, official.ID, uuid.Nil},
		{bob.ID, official.ID, mine.ID},
	} {
		packs, err := svc.ListPacks(ctx, u.id)
		if err != nil {
			t.Fatalf("ListPacks(%s): %v", u.id, err)
		}
		found, unwanted := false, false
		for _, pd := range packs {
			if pd.Pack.ID == u.want {
				found = true
			}
			if u.unwant != uuid.Nil && pd.Pack.ID == u.unwant {
				unwanted = true
			}
		}
		if !found {
			t.Fatalf("user %s should see pack %s", u.id, u.want)
		}
		if unwanted {
			t.Fatalf("user %s must not see pack %s", u.id, u.unwant)
		}
	}
}
