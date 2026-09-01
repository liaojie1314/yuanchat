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
	// -race 下其他包的用例会并行写入同一开发库：仅当窗口未满时才断言没有下一页
	if len(items) < 50 && next != "" {
		t.Fatalf("next_cursor should be empty when fewer than one page, got %q", next)
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

// TestStickerPackDetailTakenDownVisibility 下架包的详情可见性：已添加者与发布者
// 保留入口，其余请求者按 ErrPackNotFound（HTTP 404）拒绝——被处置内容不能凭
// id 直链继续可看（对齐 CHAT_API「下架包仅对已添加者保留可见」的契约）。
func TestStickerPackDetailTakenDownVisibility(t *testing.T) {
	db := testDB(t)
	migrateSvcStickerTables(t, db)
	svc := newStickerSvc(db)
	ctx := context.Background()

	owner := newTestUser(t, db, "down-owner")
	fan := newTestUser(t, db, "down-fan")
	other := newTestUser(t, db, "down-other")
	pack := seedSvcPack(t, db, func(p *model.StickerPack) {
		p.OwnerID = &owner.ID
		p.IsPublic = true
		p.TakenDown = true
	})

	// 无关请求者：404
	if _, err := svc.PackDetail(ctx, other.ID, pack.ID); !errors.Is(err, ErrPackNotFound) {
		t.Fatalf("downed pack should be ErrPackNotFound for unrelated user, got %v", err)
	}
	// 发布者：保留（编辑入口仍可用）
	if _, err := svc.PackDetail(ctx, owner.ID, pack.ID); err != nil {
		t.Fatalf("owner should keep detail access to downed pack: %v", err)
	}
	// 下架前已添加的用户：保留。AddPack 此刻已不可用（不能新增），直接落关系行模拟
	if err := svc.AddPack(ctx, fan.ID, pack.ID); err == nil {
		t.Fatal("downed pack must not be addable")
	}
	if err := db.Create(&model.UserStickerPack{UserID: fan.ID, PackID: pack.ID}).Error; err != nil {
		t.Fatalf("seed pre-takedown relation: %v", err)
	}
	d, err := svc.PackDetail(ctx, fan.ID, pack.ID)
	if err != nil {
		t.Fatalf("pre-takedown adder should keep detail access: %v", err)
	}
	if !d.Added {
		t.Fatal("added flag should be true for the user who added before takedown")
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
		packs, _, err := svc.ListPacks(ctx, u.id, "", 0)
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

// ---------- 自主发布与编辑管理 ----------

// seedFavorite 建一条本人收藏贴纸（发布 collection 来源的前置数据）。
func seedFavorite(t *testing.T, db *gorm.DB, ownerID uuid.UUID, objectKey string, seq int64) *model.Sticker {
	t.Helper()
	owner := ownerID
	st := &model.Sticker{
		OwnerID:     &owner,
		ObjectKey:   objectKey,
		Width:       96,
		Height:      96,
		ContentHash: fmt.Sprintf("%064x", time.Now().UnixNano()+seq),
	}
	if err := db.Create(st).Error; err != nil {
		t.Fatalf("create favorite: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(st) })
	return st
}

// TestStickerPublishCollectionCopy 从收藏发布：复制出新行（新 id、pack_id 指向新包、
// owner_id 置 NULL、object_key 复用同一对象），原收藏不受影响。
func TestStickerPublishCollectionCopy(t *testing.T) {
	db := testDB(t)
	migrateSvcStickerTables(t, db)
	svc := newStickerSvc(db)
	ctx := context.Background()

	alice := newTestUser(t, db, "pub-copy")
	fav := seedFavorite(t, db, alice.ID, "images/2026/08/copy.png", 1)

	detail, err := svc.Publish(ctx, alice.ID, PublishInput{
		Name: "复制发布包",
		StickerSources: []StickerSource{
			{Source: "collection", StickerID: fav.ID},
		},
	})
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	if !detail.Pack.IsOwner || detail.Added {
		t.Fatalf("publish response should be is_owner=true added=false, got %+v", detail.Pack)
	}
	if detail.Pack.OwnerName == nil || *detail.Pack.OwnerName != alice.Nickname {
		t.Fatalf("owner_name should be publisher, got %v", detail.Pack.OwnerName)
	}
	if len(detail.Stickers) != 1 || detail.Stickers[0].ObjectKey != "images/2026/08/copy.png" {
		t.Fatalf("pack stickers wrong: %+v", detail.Stickers)
	}
	if detail.Stickers[0].ID == fav.ID {
		t.Fatal("publish must copy into a NEW sticker row, not reuse the favorite's id")
	}
	// 原收藏仍在（还是 alice 的、pack_id 为空）
	var original model.Sticker
	if err := db.First(&original, "id = ?", fav.ID).Error; err != nil {
		t.Fatalf("original favorite must survive: %v", err)
	}
	if original.PackID != nil {
		t.Fatal("original favorite must not be moved into the pack")
	}
	// 新行 owner_id 为 NULL、pack_id 指向新包
	var copied model.Sticker
	if err := db.First(&copied, "id = ?", detail.Stickers[0].ID).Error; err != nil {
		t.Fatalf("load copied row: %v", err)
	}
	if copied.OwnerID != nil || copied.PackID == nil || *copied.PackID != detail.Pack.ID {
		t.Fatalf("copied row should be pack-owned with NULL owner: %+v", copied)
	}
	// 发布即公开
	var pack model.StickerPack
	db.First(&pack, "id = ?", detail.Pack.ID)
	if !pack.IsPublic || pack.OwnerID == nil || *pack.OwnerID != alice.ID {
		t.Fatalf("published pack should be public and owned: %+v", pack)
	}
}

// TestStickerPublishUploadSource upload 来源：校验键形态/hash/尺寸，入库 owner_id 为 NULL。
func TestStickerPublishUploadSource(t *testing.T) {
	db := testDB(t)
	migrateSvcStickerTables(t, db)
	svc := newStickerSvc(db)
	alice := newTestUser(t, db, "pub-upload")
	ctx := context.Background()

	const hash = "5b6642cf4331eb911b475ea8fb19d09cbc073c73b55a10134928984daee7fc41"
	badCases := []struct {
		name    string
		src     StickerSource
		wantErr error
	}{
		{"非 images 前缀", StickerSource{Source: "upload", ObjectKey: "files/2026/08/a.pdf", Width: 96, Height: 96, ContentHash: hash}, ErrInvalidObjectKey},
		{"hash 非法", StickerSource{Source: "upload", ObjectKey: "images/2026/08/a.png", Width: 96, Height: 96, ContentHash: "short"}, ErrInvalidContentHash},
		{"尺寸非法", StickerSource{Source: "upload", ObjectKey: "images/2026/08/a.png", Width: -1, Height: 96, ContentHash: hash}, ErrInvalidStickerSize},
	}
	for _, tc := range badCases {
		if _, err := svc.Publish(ctx, alice.ID, PublishInput{Name: "上传包", StickerSources: []StickerSource{tc.src}}); !errors.Is(err, tc.wantErr) {
			t.Fatalf("%s: want %v, got %v", tc.name, tc.wantErr, err)
		}
	}
	// 未知来源类型
	if _, err := svc.Publish(ctx, alice.ID, PublishInput{
		Name:           "来源包",
		StickerSources: []StickerSource{{Source: "unknown"}},
	}); !errors.Is(err, ErrInvalidStickerSources) {
		t.Fatalf("unknown source should be ErrInvalidStickerSources, got %v", err)
	}
	// 空来源
	if _, err := svc.Publish(ctx, alice.ID, PublishInput{Name: "空包"}); !errors.Is(err, ErrInvalidStickerSources) {
		t.Fatalf("empty sources should be ErrInvalidStickerSources, got %v", err)
	}
	// 合法 upload：对象存在性校验默认跳过（checker 未注入），行入库且 owner_id 为空
	detail, err := svc.Publish(ctx, alice.ID, PublishInput{
		Name: "上传包",
		StickerSources: []StickerSource{
			{Source: "upload", ObjectKey: "images/2026/08/deadbeef.png", Width: 64, Height: 64, ContentHash: hash},
		},
	})
	if err != nil {
		t.Fatalf("publish upload: %v", err)
	}
	if len(detail.Stickers) != 1 {
		t.Fatalf("want 1 sticker, got %d", len(detail.Stickers))
	}
	var row model.Sticker
	db.First(&row, "id = ?", detail.Stickers[0].ID)
	if row.OwnerID != nil || row.PackID == nil {
		t.Fatalf("upload row should be pack-owned with NULL owner: %+v", row)
	}
}

// TestStickerPublishGuards 封面键必须属 sticker-covers/；发布数达上限拒绝；包名敏感词打标不阻塞。
func TestStickerPublishGuards(t *testing.T) {
	db := testDB(t)
	migrateSvcStickerTables(t, db)
	svc := newStickerSvc(db)
	alice := newTestUser(t, db, "pub-guard")
	ctx := context.Background()

	const hash = "5b6642cf4331eb911b475ea8fb19d09cbc073c73b55a10134928984daee7fc41"
	src := StickerSource{Source: "upload", ObjectKey: "images/2026/08/fe001d.png", Width: 96, Height: 96, ContentHash: hash}

	// 封面键非 sticker-covers 前缀
	if _, err := svc.Publish(ctx, alice.ID, PublishInput{
		Name: "封面校验包", CoverObjectKey: "images/2026/08/cover.png", StickerSources: []StickerSource{src},
	}); !errors.Is(err, ErrInvalidCoverKey) {
		t.Fatalf("images cover key should be ErrInvalidCoverKey, got %v", err)
	}

	// 达发布上限（直接插行构造 20 个包，避免逐次走 Publish 的校验开销）
	rows := make([]model.StickerPack, 0, maxPublishedPacksPerUser)
	for i := 0; i < maxPublishedPacksPerUser; i++ {
		owner := alice.ID
		rows = append(rows, model.StickerPack{Name: fmt.Sprintf("满仓包-%d-%s", i, uuid.NewString()[:8]), OwnerID: &owner, IsPublic: true})
	}
	if err := db.CreateInBatches(rows, 50).Error; err != nil {
		t.Fatalf("seed packs: %v", err)
	}
	t.Cleanup(func() { db.Exec(`DELETE FROM sticker_packs WHERE owner_id = ?`, alice.ID) })
	if _, err := svc.Publish(ctx, alice.ID, PublishInput{Name: "超限包", StickerSources: []StickerSource{src}}); !errors.Is(err, ErrPublishLimitExceeded) {
		t.Fatalf("over limit should be ErrPublishLimitExceeded, got %v", err)
	}

	// 敏感词命中：发布不阻塞，flagged 落库（用另一个未满仓的用户验证）
	svc.SetModeration(NewModerationService([]string{"违禁词"}))
	bob := newTestUser(t, db, "pub-flag")
	detail, err := svc.Publish(ctx, bob.ID, PublishInput{
		Name: "含违禁词的包", StickerSources: []StickerSource{src},
	})
	if err != nil {
		t.Fatalf("flagged publish should not be blocked: %v", err)
	}
	if !detail.Pack.Flagged {
		t.Fatal("pack name hit should be flagged")
	}
	t.Cleanup(func() { db.Exec(`DELETE FROM stickers WHERE pack_id = ?`, detail.Pack.ID); db.Unscoped().Delete(&model.StickerPack{}, "id = ?", detail.Pack.ID) })
}

// TestStickerPublishCoverURL 注入 publicURL 后封面转公共 URL 落库。
func TestStickerPublishCoverURL(t *testing.T) {
	db := testDB(t)
	migrateSvcStickerTables(t, db)
	svc := newStickerSvc(db)
	svc.SetPublicURL(func(k string) string { return "http://minio:9000/yuanchat/" + k })
	alice := newTestUser(t, db, "pub-cover")
	ctx := context.Background()
	const hash = "5b6642cf4331eb911b475ea8fb19d09cbc073c73b55a10134928984daee7fc41"

	detail, err := svc.Publish(ctx, alice.ID, PublishInput{
		Name:           "有封面包",
		CoverObjectKey: "sticker-covers/2026/08/abc.png",
		StickerSources: []StickerSource{
			{Source: "upload", ObjectKey: "images/2026/08/c.png", Width: 96, Height: 96, ContentHash: hash},
		},
	})
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	t.Cleanup(func() {
		db.Exec(`DELETE FROM stickers WHERE pack_id = ?`, detail.Pack.ID)
		db.Unscoped().Delete(&model.StickerPack{}, "id = ?", detail.Pack.ID)
	})
	if detail.Pack.CoverURL == nil || *detail.Pack.CoverURL != "http://minio:9000/yuanchat/sticker-covers/2026/08/abc.png" {
		t.Fatalf("cover_url should be the public URL, got %v", detail.Pack.CoverURL)
	}
}

// TestStickerUpdatePack 改名/换封面仅本人；改名过敏感词；空字段跳过。
func TestStickerUpdatePack(t *testing.T) {
	db := testDB(t)
	migrateSvcStickerTables(t, db)
	svc := newStickerSvc(db)
	owner := newTestUser(t, db, "upd-svc")
	stranger := newTestUser(t, db, "upd-svc-b")
	ctx := context.Background()

	pack := &model.StickerPack{Name: "原名", OwnerID: &owner.ID, IsPublic: true}
	if err := db.Create(pack).Error; err != nil {
		t.Fatalf("create pack: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(pack) })

	if _, err := svc.UpdatePack(ctx, stranger.ID, pack.ID, UpdatePackInput{Name: "抢改"}); !errors.Is(err, ErrNotPackOwner) {
		t.Fatalf("stranger update should be ErrNotPackOwner, got %v", err)
	}
	if _, err := svc.UpdatePack(ctx, owner.ID, uuid.New(), UpdatePackInput{Name: "不存在"}); !errors.Is(err, ErrPackNotFound) {
		t.Fatalf("missing pack should be ErrPackNotFound, got %v", err)
	}

	svc.SetModeration(NewModerationService([]string{"敏感词"}))
	detail, err := svc.UpdatePack(ctx, owner.ID, pack.ID, UpdatePackInput{
		Name:           "含敏感词的新名",
		CoverObjectKey: "sticker-covers/2026/08/beefcafe.png",
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if detail.Pack.Name != "含敏感词的新名" {
		t.Fatalf("name not updated: %q", detail.Pack.Name)
	}
	if !detail.Pack.Flagged {
		t.Fatal("sensitive rename should set flagged")
	}
	var row model.StickerPack
	db.First(&row, "id = ?", pack.ID)
	if row.Flagged != true {
		t.Fatal("flagged must be persisted")
	}
}

// TestStickerAddRemovePackSticker 追加/移除包内贴纸：仅本人、collection 复制、移除不影响原收藏。
func TestStickerAddRemovePackSticker(t *testing.T) {
	db := testDB(t)
	migrateSvcStickerTables(t, db)
	svc := newStickerSvc(db)
	owner := newTestUser(t, db, "pksticker主")
	stranger := newTestUser(t, db, "pksticker客")
	ctx := context.Background()

	pack := &model.StickerPack{Name: "贴纸编辑包", OwnerID: &owner.ID, IsPublic: true}
	if err := db.Create(pack).Error; err != nil {
		t.Fatalf("create pack: %v", err)
	}
	t.Cleanup(func() {
		db.Exec(`DELETE FROM stickers WHERE pack_id = ?`, pack.ID)
		db.Unscoped().Delete(pack)
	})
	fav := seedFavorite(t, db, owner.ID, "images/2026/08/fav.png", 1)

	// 非本人追加
	if err := svc.AddPackSticker(ctx, stranger.ID, pack.ID, StickerSource{Source: "collection", StickerID: fav.ID}); !errors.Is(err, ErrNotPackOwner) {
		t.Fatalf("stranger add should be ErrNotPackOwner, got %v", err)
	}
	// 本人从收藏追加：新行、原收藏不动
	if err := svc.AddPackSticker(ctx, owner.ID, pack.ID, StickerSource{Source: "collection", StickerID: fav.ID}); err != nil {
		t.Fatalf("owner add: %v", err)
	}
	var copied model.Sticker
	if err := db.First(&copied, "pack_id = ?", pack.ID).Error; err != nil {
		t.Fatalf("copied sticker should exist: %v", err)
	}
	if copied.ID == fav.ID || copied.OwnerID != nil {
		t.Fatalf("must be a new pack-owned row: %+v", copied)
	}
	// 移除不存在的贴纸
	if err := svc.RemovePackSticker(ctx, owner.ID, pack.ID, uuid.New()); !errors.Is(err, ErrStickerNotFound) {
		t.Fatalf("missing sticker should be ErrStickerNotFound, got %v", err)
	}
	// 本人移除成功；原收藏不受影响
	if err := svc.RemovePackSticker(ctx, owner.ID, pack.ID, copied.ID); err != nil {
		t.Fatalf("owner remove: %v", err)
	}
	var count int64
	db.Model(&model.Sticker{}).Where("id = ?", fav.ID).Count(&count)
	if count != 1 {
		t.Fatal("original favorite must survive pack sticker removal")
	}
	// 非本人移除（先撞 403）
	if err := svc.RemovePackSticker(ctx, stranger.ID, pack.ID, copied.ID); !errors.Is(err, ErrNotPackOwner) {
		t.Fatalf("stranger remove should be ErrNotPackOwner, got %v", err)
	}
}

// TestStickerDeleteMine 删除本人发布的包；非本人 403；删除后包消失。
func TestStickerDeleteMine(t *testing.T) {
	db := testDB(t)
	migrateSvcStickerTables(t, db)
	svc := newStickerSvc(db)
	owner := newTestUser(t, db, "del-svc主")
	stranger := newTestUser(t, db, "del-svc客")
	ctx := context.Background()

	pack := &model.StickerPack{Name: "待删包", OwnerID: &owner.ID, IsPublic: true}
	if err := db.Create(pack).Error; err != nil {
		t.Fatalf("create pack: %v", err)
	}
	if err := svc.DeleteMine(ctx, stranger.ID, pack.ID); !errors.Is(err, ErrNotPackOwner) {
		t.Fatalf("stranger delete should be ErrNotPackOwner, got %v", err)
	}
	if err := svc.DeleteMine(ctx, owner.ID, pack.ID); err != nil {
		t.Fatalf("owner delete: %v", err)
	}
	var count int64
	db.Model(&model.StickerPack{}).Where("id = ?", pack.ID).Count(&count)
	if count != 0 {
		t.Fatal("pack should be gone after DeleteMine")
	}
	if err := svc.DeleteMine(ctx, owner.ID, pack.ID); !errors.Is(err, ErrPackNotFound) {
		t.Fatalf("double delete should be ErrPackNotFound, got %v", err)
	}
}

// TestStickerListMinePacks 我发布的列表：仅本人包、is_owner 恒 true、计数正确。
func TestStickerListMinePacks(t *testing.T) {
	db := testDB(t)
	migrateSvcStickerTables(t, db)
	svc := newStickerSvc(db)
	owner := newTestUser(t, db, "mine-svc")
	stranger := newTestUser(t, db, "mine-svc客")
	ctx := context.Background()

	pack := &model.StickerPack{Name: "我的发布包", OwnerID: &owner.ID, IsPublic: true}
	if err := db.Create(pack).Error; err != nil {
		t.Fatalf("create pack: %v", err)
	}
	t.Cleanup(func() {
		db.Exec(`DELETE FROM stickers WHERE pack_id = ?`, pack.ID)
		db.Unscoped().Delete(pack)
	})
	newTestPackSticker := func(seq int64) {
		packID := pack.ID
		st := model.Sticker{
			PackID:      &packID,
			ObjectKey:   fmt.Sprintf("images/2026/08/%s.png", uuid.NewString()),
			Width:       96,
			Height:      96,
			ContentHash: fmt.Sprintf("%064x", time.Now().UnixNano()+seq),
		}
		if err := db.Create(&st).Error; err != nil {
			t.Fatalf("create sticker: %v", err)
		}
		t.Cleanup(func() { db.Unscoped().Delete(&st) })
	}
	newTestPackSticker(1)

	mine, err := svc.ListMinePacks(ctx, owner.ID)
	if err != nil {
		t.Fatalf("ListMinePacks: %v", err)
	}
	var found *MyPackDTO
	for i := range mine {
		if mine[i].ID == pack.ID {
			found = &mine[i]
		}
	}
	if found == nil {
		t.Fatalf("own pack missing from mine list, got %d packs", len(mine))
	}
	if !found.IsOwner || found.StickerCount != 1 {
		t.Fatalf("mine item wrong: %+v", found)
	}
	// 陌生人的列表不含该包
	others, err := svc.ListMinePacks(ctx, stranger.ID)
	if err != nil {
		t.Fatalf("ListMinePacks(stranger): %v", err)
	}
	for _, p := range others {
		if p.ID == pack.ID {
			t.Fatal("stranger must not see the pack in mine list")
		}
	}
}

// TestStickerListPacksPagination GET /sticker-packs 游标分页：
// 不传 limit 返回全量（向后兼容，next_cursor 为空串）；
// 传 limit 时按 created_at 升序取一页、next_cursor 为最后一条的 created_at，
// 用游标续页能取到剩余全部且不重不漏；非法游标报 ErrInvalidCursor。
func TestStickerListPacksPagination(t *testing.T) {
	db := testDB(t)
	migrateSvcStickerTables(t, db)
	svc := newStickerSvc(db)
	ctx := context.Background()

	alice := newTestUser(t, db, "listp-page")
	// 三个包：created_at 间隔 1 分钟，保证游标排序确定性
	base := time.Now().Add(-time.Hour)
	var ids []uuid.UUID
	for i := 0; i < 3; i++ {
		p := seedSvcPack(t, db, func(p *model.StickerPack) { p.IsOfficial = true })
		if err := db.Model(p).Update("created_at", base.Add(time.Duration(i)*time.Minute)).Error; err != nil {
			t.Fatalf("set created_at: %v", err)
		}
		ids = append(ids, p.ID)
	}

	// 全量模式：limit=0 返回三个包且 next_cursor 为空
	full, next, err := svc.ListPacks(ctx, alice.ID, "", 0)
	if err != nil || next != "" {
		t.Fatalf("full list: %v next=%q", err, next)
	}
	if len(full) != 3 {
		t.Fatalf("want 3 packs in full mode, got %d", len(full))
	}

	// 分页模式：limit=2 首页两包 + next_cursor
	page1, next1, err := svc.ListPacks(ctx, alice.ID, "", 2)
	if err != nil {
		t.Fatalf("page1: %v", err)
	}
	if len(page1) != 2 || next1 == "" {
		t.Fatalf("want 2 packs + next_cursor, got %d next=%q", len(page1), next1)
	}
	if _, err := time.Parse(time.RFC3339, next1); err != nil {
		t.Fatalf("next_cursor should be RFC3339: %v", err)
	}
	// 升序：首页应为最早创建的两个包
	if page1[0].Pack.CreatedAt.After(page1[1].Pack.CreatedAt) {
		t.Fatalf("page should be ascending by created_at, got %+v", page1)
	}

	// 续页：游标取到剩下的一个包，next_cursor 为空
	page2, next2, err := svc.ListPacks(ctx, alice.ID, next1, 2)
	if err != nil {
		t.Fatalf("page2: %v", err)
	}
	if len(page2) != 1 || next2 != "" {
		t.Fatalf("want 1 pack on last page + empty cursor, got %d next=%q", len(page2), next2)
	}
	// 不重不漏
	seen := map[uuid.UUID]bool{page2[0].Pack.ID: true}
	for _, pd := range page1 {
		if seen[pd.Pack.ID] {
			t.Fatalf("pack %s appeared on both pages", pd.Pack.ID)
		}
		seen[pd.Pack.ID] = true
	}
	for _, id := range ids {
		if !seen[id] {
			t.Fatalf("pack %s missing from pagination result", id)
		}
	}

	if _, _, err := svc.ListPacks(ctx, alice.ID, "not-a-time", 2); !errors.Is(err, ErrInvalidCursor) {
		t.Fatalf("want ErrInvalidCursor, got %v", err)
	}
}
