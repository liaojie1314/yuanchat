package repository

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
)

// ensureForeignKey 补齐 AutoMigrate 建不出的外键：GORM 只为关联字段生成外键，
// 普通列上的 FK（生产由迁移 011/015 提供）在测试库需要手动补上，
// 否则依赖级联删除的用例验证的是"恰好没报错"而非真实级联。
func ensureForeignKey(t *testing.T, db *gorm.DB, table, constraint, column, refTable, onDelete string) {
	t.Helper()
	var n int64
	if err := db.Raw(`SELECT COUNT(*) FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass`,
		constraint, table).Scan(&n).Error; err != nil {
		t.Fatalf("check constraint %s: %v", constraint, err)
	}
	if n > 0 {
		return
	}
	stmt := fmt.Sprintf(
		`ALTER TABLE %s ADD CONSTRAINT %s FOREIGN KEY (%s) REFERENCES %s(id) ON DELETE %s`,
		table, constraint, column, refTable, onDelete)
	if err := db.Exec(stmt).Error; err != nil {
		t.Fatalf("add fk %s: %v", constraint, err)
	}
}

// migrateStickerTables 建 011/015 相关表并补外键（幂等，可重复进入）。
func migrateStickerTables(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.AutoMigrate(&model.StickerPack{}, &model.Sticker{}, &model.UserStickerPack{}); err != nil {
		t.Fatalf("migrate sticker tables: %v", err)
	}
	ensureForeignKey(t, db, "stickers", "fk_test_stickers_pack", "pack_id", "sticker_packs", "CASCADE")
	ensureForeignKey(t, db, "stickers", "fk_test_stickers_owner", "owner_id", "users", "CASCADE")
	ensureForeignKey(t, db, "user_sticker_packs", "fk_test_usp_user", "user_id", "users", "CASCADE")
	ensureForeignKey(t, db, "user_sticker_packs", "fk_test_usp_pack", "pack_id", "sticker_packs", "CASCADE")
	ensureForeignKey(t, db, "sticker_packs", "fk_test_packs_owner", "owner_id", "users", "SET NULL")
}

// newTestPack 建一次性表情包，测试结束连同其贴纸、添加关系一起清理。
func newTestPack(t *testing.T, db *gorm.DB, mutate func(*model.StickerPack)) *model.StickerPack {
	t.Helper()
	pack := &model.StickerPack{Name: fmt.Sprintf("测试包-%s", uuid.NewString()[:8])}
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

func newTestPackSticker(t *testing.T, db *gorm.DB, packID uuid.UUID, seq int) *model.Sticker {
	t.Helper()
	st := &model.Sticker{
		PackID:      &packID,
		ObjectKey:   fmt.Sprintf("images/2026/08/%s.png", uuid.NewString()),
		Width:       96,
		Height:      96,
		ContentHash: fmt.Sprintf("%064x", time.Now().UnixNano()+int64(seq)),
	}
	if err := db.Create(st).Error; err != nil {
		t.Fatalf("create pack sticker: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(st) })
	return st
}

// TestUserPackAddIdempotent 重复添加同一包只落一行，且返回首次的关系行。
func TestUserPackAddIdempotent(t *testing.T) {
	db := testDB(t)
	migrateStickerTables(t, db)
	repo := NewStickerRepository(db)
	ctx := context.Background()

	alice := newTestUser(t, db, "usp-add")
	pack := newTestPack(t, db, func(p *model.StickerPack) { p.IsOfficial = true })

	first, err := repo.AddUserPack(ctx, alice.ID, pack.ID)
	if err != nil {
		t.Fatalf("first add: %v", err)
	}
	second, err := repo.AddUserPack(ctx, alice.ID, pack.ID)
	if err != nil {
		t.Fatalf("dup add: %v", err)
	}
	if first.ID != second.ID {
		t.Fatalf("idempotent add should return the same relation row, got %s vs %s", first.ID, second.ID)
	}
	var count int64
	db.Model(&model.UserStickerPack{}).Where("user_id = ? AND pack_id = ?", alice.ID, pack.ID).Count(&count)
	if count != 1 {
		t.Fatalf("want exactly 1 relation row, got %d", count)
	}
}

// TestUserPackRemove 只移除自己的添加关系；重复移除幂等成功；不影响他人关系。
func TestUserPackRemove(t *testing.T) {
	db := testDB(t)
	migrateStickerTables(t, db)
	repo := NewStickerRepository(db)
	ctx := context.Background()

	alice := newTestUser(t, db, "usp-rm-a")
	bob := newTestUser(t, db, "usp-rm-b")
	pack := newTestPack(t, db, func(p *model.StickerPack) { p.IsOfficial = true })

	for _, uid := range []uuid.UUID{alice.ID, bob.ID} {
		if _, err := repo.AddUserPack(ctx, uid, pack.ID); err != nil {
			t.Fatalf("add for %s: %v", uid, err)
		}
	}
	if err := repo.RemoveUserPack(ctx, alice.ID, pack.ID); err != nil {
		t.Fatalf("remove: %v", err)
	}
	// bob 的关系不受影响
	added, err := repo.IsAddedBatch(ctx, bob.ID, []uuid.UUID{pack.ID})
	if err != nil || !added[pack.ID] {
		t.Fatalf("bob's relation must survive alice's removal, got %v err=%v", added, err)
	}
	// 重复移除幂等成功
	if err := repo.RemoveUserPack(ctx, alice.ID, pack.ID); err != nil {
		t.Fatalf("second remove should stay idempotent: %v", err)
	}
}

// TestUserPackIsAddedBatch 批量存在性检查只返回已添加的包。
func TestUserPackIsAddedBatch(t *testing.T) {
	db := testDB(t)
	migrateStickerTables(t, db)
	repo := NewStickerRepository(db)
	ctx := context.Background()

	alice := newTestUser(t, db, "usp-batch")
	packA := newTestPack(t, db, nil)
	packB := newTestPack(t, db, nil)
	packC := newTestPack(t, db, nil)

	if _, err := repo.AddUserPack(ctx, alice.ID, packA.ID); err != nil {
		t.Fatalf("add A: %v", err)
	}
	got, err := repo.IsAddedBatch(ctx, alice.ID, []uuid.UUID{packA.ID, packB.ID, packC.ID})
	if err != nil {
		t.Fatalf("IsAddedBatch: %v", err)
	}
	if !got[packA.ID] || got[packB.ID] || got[packC.ID] {
		t.Fatalf("only packA should be added, got %v", got)
	}
	empty, err := repo.IsAddedBatch(ctx, alice.ID, nil)
	if err != nil || len(empty) != 0 {
		t.Fatalf("empty input should yield empty set, got %v err=%v", empty, err)
	}
}

// TestListMarket 商城列表：只出公开未下架包，created_at 倒序游标分页，
// 且带出发布者昵称与贴纸数。
func TestListMarket(t *testing.T) {
	db := testDB(t)
	migrateStickerTables(t, db)
	repo := NewStickerRepository(db)
	ctx := context.Background()

	owner := newTestUser(t, db, "market-owner")
	base := time.Now().Add(-time.Hour)

	old := newTestPack(t, db, func(p *model.StickerPack) {
		p.OwnerID = &owner.ID
		p.IsPublic = true
		p.CreatedAt = base
	})
	official := newTestPack(t, db, func(p *model.StickerPack) {
		p.IsOfficial = true
		p.IsPublic = true
		p.CreatedAt = base.Add(time.Minute)
	})
	notPublic := newTestPack(t, db, func(p *model.StickerPack) { // 未公开：不可见
		p.CreatedAt = base.Add(2 * time.Minute)
	})
	downed := newTestPack(t, db, func(p *model.StickerPack) { // 已下架：不可见
		p.IsPublic = true
		p.TakenDown = true
		p.CreatedAt = base.Add(3 * time.Minute)
	})
	// 每个可见包放 2 张贴纸，验证计数
	newTestPackSticker(t, db, old.ID, 1)
	newTestPackSticker(t, db, old.ID, 2)
	newTestPackSticker(t, db, official.ID, 3)
	newTestPackSticker(t, db, official.ID, 4)

	rows, err := repo.ListMarket(ctx, nil, 10)
	if err != nil {
		t.Fatalf("ListMarket: %v", err)
	}
	// 开发库可能残留其他用例/seed 的包：只断言本用例各包的可见性与相对顺序
	byID := make(map[uuid.UUID]PackWithMeta, len(rows))
	var visibleOrder []uuid.UUID
	for _, r := range rows {
		byID[r.ID] = r
		visibleOrder = append(visibleOrder, r.ID)
	}
	for _, hidden := range []uuid.UUID{notPublic.ID, downed.ID} {
		if byID[hidden].ID == hidden {
			t.Fatalf("pack %s must not appear in market", hidden)
		}
	}
	// 最新在前：official（晚 1 分钟）先于 old
	if indexOf(visibleOrder, official.ID) == -1 || indexOf(visibleOrder, old.ID) == -1 ||
		indexOf(visibleOrder, official.ID) > indexOf(visibleOrder, old.ID) {
		t.Fatalf("official should come before old (created_at DESC), order=%v", visibleOrder)
	}
	if byID[official.ID].OwnerName != nil || !byID[official.ID].IsOfficial {
		t.Fatalf("official pack should have nil owner_name, got %+v", byID[official.ID])
	}
	if byID[old.ID].OwnerName == nil || *byID[old.ID].OwnerName != owner.Nickname {
		t.Fatalf("published pack should carry owner nickname %q, got %v", owner.Nickname, byID[old.ID].OwnerName)
	}
	if byID[old.ID].StickerCount != 2 || byID[official.ID].StickerCount != 2 {
		t.Fatalf("sticker counts should be 2/2, got %d/%d",
			byID[old.ID].StickerCount, byID[official.ID].StickerCount)
	}

	// 游标：before=official.created_at → 只剩 old
	cursor := official.CreatedAt
	after, err := repo.ListMarket(ctx, &cursor, 10)
	if err != nil {
		t.Fatalf("ListMarket with cursor: %v", err)
	}
	found := false
	for _, r := range after {
		if r.ID == official.ID {
			t.Fatal("cursor page must not repeat the pack at the cursor")
		}
		if r.ID == old.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("cursor page should contain the older pack, got %+v", after)
	}
}

// indexOf 返回 id 在列表中的下标，不存在返回 -1。
func indexOf(ids []uuid.UUID, id uuid.UUID) int {
	for i, v := range ids {
		if v == id {
			return i
		}
	}
	return -1
}

// TestGetPackMeta 单包投影：官方包 owner_name 为空；不存在时报 ErrRecordNotFound。
func TestGetPackMeta(t *testing.T) {
	db := testDB(t)
	migrateStickerTables(t, db)
	repo := NewStickerRepository(db)
	ctx := context.Background()

	owner := newTestUser(t, db, "meta-owner")
	pack := newTestPack(t, db, func(p *model.StickerPack) {
		p.OwnerID = &owner.ID
		p.IsPublic = true
	})
	newTestPackSticker(t, db, pack.ID, 1)

	got, err := repo.GetPackMeta(ctx, pack.ID)
	if err != nil {
		t.Fatalf("GetPackMeta: %v", err)
	}
	if got.OwnerName == nil || *got.OwnerName != owner.Nickname {
		t.Fatalf("want owner nickname %q, got %v", owner.Nickname, got.OwnerName)
	}
	if got.StickerCount != 1 {
		t.Fatalf("want sticker_count 1, got %d", got.StickerCount)
	}
	if _, err := repo.GetPackMeta(ctx, uuid.New()); err == nil || err != gorm.ErrRecordNotFound {
		t.Fatalf("missing pack should return gorm.ErrRecordNotFound, got %v", err)
	}
}

// TestListVisible 我的表情包 = 官方包 + 已添加包；下架包对已添加者保留。
func TestListVisible(t *testing.T) {
	db := testDB(t)
	migrateStickerTables(t, db)
	repo := NewStickerRepository(db)
	ctx := context.Background()

	alice := newTestUser(t, db, "visible-a")
	bob := newTestUser(t, db, "visible-b")

	official := newTestPack(t, db, func(p *model.StickerPack) {
		p.IsOfficial = true
		p.IsPublic = true
	})
	added := newTestPack(t, db, func(p *model.StickerPack) { p.IsPublic = true })
	takenDown := newTestPack(t, db, func(p *model.StickerPack) { p.IsPublic = true; p.TakenDown = true })
	private := newTestPack(t, db, nil)

	for _, p := range []*model.StickerPack{added, takenDown} {
		if _, err := repo.AddUserPack(ctx, alice.ID, p.ID); err != nil {
			t.Fatalf("add %s: %v", p.ID, err)
		}
	}

	aliceRows, err := repo.ListVisible(ctx, alice.ID)
	if err != nil {
		t.Fatalf("ListVisible(alice): %v", err)
	}
	gotIDs := map[uuid.UUID]bool{}
	for _, p := range aliceRows {
		gotIDs[p.ID] = true
	}
	for _, want := range []uuid.UUID{official.ID, added.ID, takenDown.ID} {
		if !gotIDs[want] {
			t.Fatalf("alice should see pack %s (official/added/taken-down-added)", want)
		}
	}
	if gotIDs[private.ID] {
		t.Fatal("未添加的私有包不应出现在我的表情包里")
	}

	// bob 未添加任何包：只看官方包（开发库可能存在 seed 出的既有官方包，只断言本用例的包）
	bobRows, err := repo.ListVisible(ctx, bob.ID)
	if err != nil {
		t.Fatalf("ListVisible(bob): %v", err)
	}
	bobIDs := map[uuid.UUID]bool{}
	for _, p := range bobRows {
		bobIDs[p.ID] = true
	}
	if !bobIDs[official.ID] {
		t.Fatal("bob should see the official pack created in this test")
	}
	for _, hidden := range []uuid.UUID{added.ID, takenDown.ID, private.ID} {
		if bobIDs[hidden] {
			t.Fatalf("bob must not see pack %s (not added)", hidden)
		}
	}
}

// TestPublishPack 发布事务：包与贴纸一起落库，贴纸行 pack_id 指向新包、owner_id 为空。
func TestPublishPack(t *testing.T) {
	db := testDB(t)
	migrateStickerTables(t, db)
	repo := NewStickerRepository(db)
	ctx := context.Background()

	owner := newTestUser(t, db, "publish-owner")
	pack := &model.StickerPack{
		Name:      "发布测试包",
		OwnerID:   &owner.ID,
		IsPublic:  true,
		CoverURL:  strPtr("http://minio:9000/yuanchat/sticker-covers/2026/08/x.png"),
		Flagged:   true,
		TakenDown: false,
	}
	stickers := []model.Sticker{
		{ObjectKey: "images/2026/08/a.png", Width: 96, Height: 96, ContentHash: fmt.Sprintf("%064x", 1)},
		{ObjectKey: "images/2026/08/b.png", Width: 64, Height: 64, ContentHash: fmt.Sprintf("%064x", 2)},
	}
	// 清理闭包在执行时才读 pack.ID（发布成功后由 RETURNING 回填）；
	// 发布失败时包不存在，ID 为零值删除自然空转
	t.Cleanup(func() {
		db.Exec(`DELETE FROM stickers WHERE pack_id = ?`, pack.ID)
		db.Exec(`DELETE FROM user_sticker_packs WHERE pack_id = ?`, pack.ID)
		db.Unscoped().Delete(&model.StickerPack{}, "id = ?", pack.ID)
	})
	if err := repo.PublishPack(ctx, pack, stickers); err != nil {
		t.Fatalf("PublishPack: %v", err)
	}
	packID := pack.ID

	var count int64
	db.Model(&model.Sticker{}).Where("pack_id = ? AND owner_id IS NULL", packID).Count(&count)
	if count != 2 {
		t.Fatalf("want 2 pack stickers with NULL owner, got %d", count)
	}
	var got model.StickerPack
	if err := db.First(&got, "id = ?", packID).Error; err != nil {
		t.Fatalf("reload pack: %v", err)
	}
	if !got.IsPublic || got.OwnerID == nil || *got.OwnerID != owner.ID || !got.Flagged {
		t.Fatalf("pack fields not persisted as intended: %+v", got)
	}
}

// strPtr 返回字符串指针（测试构造可空列）。
func strPtr(s string) *string { return &s }

// TestDeletePackOfOwnerCascade 删除本人发布的包：stickers 与 user_sticker_packs 级联清理；
// 非本人删除报 ErrRecordNotFound 且原行保留。
func TestDeletePackOfOwnerCascade(t *testing.T) {
	db := testDB(t)
	migrateStickerTables(t, db)
	repo := NewStickerRepository(db)
	ctx := context.Background()

	owner := newTestUser(t, db, "del-owner")
	stranger := newTestUser(t, db, "del-stranger")
	pack := newTestPack(t, db, func(p *model.StickerPack) {
		p.OwnerID = &owner.ID
		p.IsPublic = true
	})
	newTestPackSticker(t, db, pack.ID, 1)
	if _, err := repo.AddUserPack(ctx, stranger.ID, pack.ID); err != nil {
		t.Fatalf("stranger add pack: %v", err)
	}

	// 非本人删除：不生效
	if err := repo.DeletePackOfOwner(ctx, stranger.ID, pack.ID); err != gorm.ErrRecordNotFound {
		t.Fatalf("stranger delete should return ErrRecordNotFound, got %v", err)
	}
	var still int64
	db.Model(&model.StickerPack{}).Where("id = ?", pack.ID).Count(&still)
	if still != 1 {
		t.Fatal("pack should survive an unauthorized delete attempt")
	}

	if err := repo.DeletePackOfOwner(ctx, owner.ID, pack.ID); err != nil {
		t.Fatalf("owner delete: %v", err)
	}
	var stickers, rels int64
	db.Model(&model.Sticker{}).Where("pack_id = ?", pack.ID).Count(&stickers)
	db.Model(&model.UserStickerPack{}).Where("pack_id = ?", pack.ID).Count(&rels)
	if stickers != 0 || rels != 0 {
		t.Fatalf("cascade should clear stickers and user_sticker_packs, got stickers=%d rels=%d", stickers, rels)
	}
}

// TestUpdatePackOfOwner 改名/换封面仅限本人；未命中（并发已删）报 ErrRecordNotFound。
func TestUpdatePackOfOwner(t *testing.T) {
	db := testDB(t)
	migrateStickerTables(t, db)
	repo := NewStickerRepository(db)
	ctx := context.Background()

	owner := newTestUser(t, db, "upd-owner")
	stranger := newTestUser(t, db, "upd-stranger")
	pack := newTestPack(t, db, func(p *model.StickerPack) { p.OwnerID = &owner.ID; p.IsPublic = true })

	newCover := "http://minio:9000/yuanchat/sticker-covers/2026/08/new.png"
	if err := repo.UpdatePackOfOwner(ctx, owner.ID, pack.ID, map[string]any{
		"name": "改名后的包", "cover_url": newCover,
	}); err != nil {
		t.Fatalf("owner update: %v", err)
	}
	var got model.StickerPack
	if err := db.First(&got, "id = ?", pack.ID).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got.Name != "改名后的包" || got.CoverURL == nil || *got.CoverURL != newCover {
		t.Fatalf("updates not persisted: %+v", got)
	}

	if err := repo.UpdatePackOfOwner(ctx, stranger.ID, pack.ID, map[string]any{"name": "抢改"}); err != gorm.ErrRecordNotFound {
		t.Fatalf("stranger update should return ErrRecordNotFound, got %v", err)
	}
	db.First(&got, "id = ?", pack.ID)
	if got.Name != "改名后的包" {
		t.Fatalf("stranger update must not touch the row, got %q", got.Name)
	}
}

// TestRemovePackSticker 从包内移除贴纸：包内命中、包外不命中。
func TestRemovePackSticker(t *testing.T) {
	db := testDB(t)
	migrateStickerTables(t, db)
	repo := NewStickerRepository(db)
	ctx := context.Background()

	pack := newTestPack(t, db, func(p *model.StickerPack) { p.IsPublic = true })
	inPack := newTestPackSticker(t, db, pack.ID, 1)
	foreign := newTestPack(t, db, func(p *model.StickerPack) { p.IsPublic = true })
	notInPack := newTestPackSticker(t, db, foreign.ID, 2)

	if err := repo.RemovePackSticker(ctx, pack.ID, notInPack.ID); err != gorm.ErrRecordNotFound {
		t.Fatalf("removing a sticker from another pack should return ErrRecordNotFound, got %v", err)
	}
	if err := repo.RemovePackSticker(ctx, pack.ID, inPack.ID); err != nil {
		t.Fatalf("remove in-pack sticker: %v", err)
	}
	var count int64
	db.Model(&model.Sticker{}).Where("id = ?", inPack.ID).Count(&count)
	if count != 0 {
		t.Fatal("sticker row should be gone")
	}
}

// TestListPublishedBy 我发布的列表：只含本人包，按创建时间倒序，带贴纸数。
func TestListPublishedBy(t *testing.T) {
	db := testDB(t)
	migrateStickerTables(t, db)
	repo := NewStickerRepository(db)
	ctx := context.Background()

	owner := newTestUser(t, db, "mine-owner")
	stranger := newTestUser(t, db, "mine-stranger")
	base := time.Now().Add(-time.Hour)

	older := newTestPack(t, db, func(p *model.StickerPack) { p.OwnerID = &owner.ID; p.IsPublic = true; p.CreatedAt = base })
	newer := newTestPack(t, db, func(p *model.StickerPack) { p.OwnerID = &owner.ID; p.IsPublic = true; p.CreatedAt = base.Add(time.Minute) })
	newTestPack(t, db, func(p *model.StickerPack) { p.OwnerID = &stranger.ID; p.IsPublic = true })
	newTestPackSticker(t, db, newer.ID, 1)

	rows, err := repo.ListPublishedBy(ctx, owner.ID)
	if err != nil {
		t.Fatalf("ListPublishedBy: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("want 2 own packs, got %d", len(rows))
	}
	if rows[0].ID != newer.ID || rows[1].ID != older.ID {
		t.Fatalf("order should be created_at DESC, got %s then %s", rows[0].ID, rows[1].ID)
	}
	if rows[0].StickerCount != 1 || rows[1].StickerCount != 0 {
		t.Fatalf("sticker counts should be 1/0, got %d/%d", rows[0].StickerCount, rows[1].StickerCount)
	}
	if rows[0].OwnerName == nil || *rows[0].OwnerName != owner.Nickname {
		t.Fatalf("own list should carry own nickname, got %v", rows[0].OwnerName)
	}
}

// TestCountPacksByOwnerAndStickers 发布上限与单包规模校验所依赖的计数。
func TestCountPacksByOwnerAndStickers(t *testing.T) {
	db := testDB(t)
	migrateStickerTables(t, db)
	repo := NewStickerRepository(db)
	ctx := context.Background()

	owner := newTestUser(t, db, "count-owner")
	pack := newTestPack(t, db, func(p *model.StickerPack) { p.OwnerID = &owner.ID })
	newTestPackSticker(t, db, pack.ID, 1)
	newTestPackSticker(t, db, pack.ID, 2)

	n, err := repo.CountPacksByOwner(ctx, owner.ID)
	if err != nil || n != 1 {
		t.Fatalf("CountPacksByOwner = %d err=%v, want 1", n, err)
	}
	m, err := repo.CountStickersByPack(ctx, pack.ID)
	if err != nil || m != 2 {
		t.Fatalf("CountStickersByPack = %d err=%v, want 2", m, err)
	}
}
