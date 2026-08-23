package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

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

	mine, _, err := svc.ListMine(ctx, alice.ID, "", 0)
	if err != nil || len(mine) != 1 {
		t.Fatalf("want 1 sticker after dedup, got %d err=%v", len(mine), err)
	}

	// bob 收藏同 hash 内容：与 alice 互不影响（unique 是 (owner_id, hash)）
	if _, err := svc.Add(ctx, bob.ID, "images/2026/08/a.png", 96, 96, hashAbc); err != nil {
		t.Fatalf("bob add same hash: %v", err)
	}
	bobMine, _, err := svc.ListMine(ctx, bob.ID, "", 0)
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
		t.Fatalf("want ErrInvalidContentHash for short hash, got %v", err)
	}
	// 长度对但不是十六进制：原实现只比长度，64 个中文/大写字母也会入库
	notHex := strings.Repeat("Z", 64)
	if _, err := svc.Add(context.Background(), alice.ID, "images/2026/08/a.png", 10, 10, notHex); !errors.Is(err, ErrInvalidContentHash) {
		t.Fatalf("want ErrInvalidContentHash for non-hex hash, got %v", err)
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
	mine, _, _ := svc.ListMine(ctx, alice.ID, "", 0)
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

// fakeObjectChecker 可控的对象存在性检查桩。
type fakeObjectChecker struct {
	exists bool
	err    error
	seen   []string
}

func (f *fakeObjectChecker) ObjectExists(_ context.Context, key string) (bool, error) {
	f.seen = append(f.seen, key)
	return f.exists, f.err
}

// TestStickerAddObjectKeyMustBeCanonical object_key 必须是服务端签发的规范形态。
// 原实现只做 strings.HasPrefix(key, "images/")，会放过 images/ + 任意 300 字符，
// 撞 varchar(255) 后变成可控 500（叠加无限流可低成本刷错误日志）。
func TestStickerAddObjectKeyMustBeCanonical(t *testing.T) {
	db := testDB(t)
	db.AutoMigrate(&model.StickerPack{}, &model.Sticker{})
	alice := newTestUser(t, db, "甲keyfmt")
	svc := newStickerSvc(db)
	ctx := context.Background()
	const hash = "5b6642cf4331eb911b475ea8fb19d09cbc073c73b55a10134928984daee7fc41"

	bad := []string{
		"images/2026/08/" + strings.Repeat("a", 300) + ".png", // 形态合法但超 varchar(255)
		"images/2026/08/../../files/secret.pdf",               // 路径穿越形态
		"images/abc.png",                                      // 缺年月分区
		"images/2026/08/abc.PNG",                              // 扩展名大写
		"files/2026/08/abc.pdf",                               // 非 images 前缀
	}
	for _, key := range bad {
		if _, err := svc.Add(ctx, alice.ID, key, 96, 96, hash); !errors.Is(err, ErrInvalidObjectKey) {
			t.Fatalf("key %q should be rejected, got %v", key, err)
		}
	}
}

// TestStickerAddRejectsBadDimensions gin 的 binding:"required" 只拒零值，
// -1 会通过；而 WS 发送路径要求 > 0，负尺寸行入库后永远发不出去。
func TestStickerAddRejectsBadDimensions(t *testing.T) {
	db := testDB(t)
	db.AutoMigrate(&model.StickerPack{}, &model.Sticker{})
	alice := newTestUser(t, db, "甲size")
	svc := newStickerSvc(db)
	ctx := context.Background()
	const hash = "5b6642cf4331eb911b475ea8fb19d09cbc073c73b55a10134928984daee7fc41"

	for _, d := range [][2]int{{-1, 96}, {96, -1}, {0, 96}, {99999, 96}} {
		if _, err := svc.Add(ctx, alice.ID, "images/2026/08/a.png", d[0], d[1], hash); !errors.Is(err, ErrInvalidStickerSize) {
			t.Fatalf("dimensions %v should be rejected, got %v", d, err)
		}
	}
}

// TestStickerAddRequiresExistingObject 对象不存在时拒绝登记。
// PresignGet 只签名不校验存在性，少了这一步会把指向空对象的行写进库，
// 前端拿到合法 URL 但渲染 404，且坏数据长期存活。
func TestStickerAddRequiresExistingObject(t *testing.T) {
	db := testDB(t)
	db.AutoMigrate(&model.StickerPack{}, &model.Sticker{})
	alice := newTestUser(t, db, "甲stat")
	svc := newStickerSvc(db)
	const hash = "5b6642cf4331eb911b475ea8fb19d09cbc073c73b55a10134928984daee7fc41"

	missing := &fakeObjectChecker{exists: false}
	svc.SetObjectChecker(missing)
	if _, err := svc.Add(context.Background(), alice.ID, "images/2026/08/a.png", 96, 96, hash); !errors.Is(err, ErrStickerObjectMissing) {
		t.Fatalf("want ErrStickerObjectMissing, got %v", err)
	}
	if len(missing.seen) != 1 || missing.seen[0] != "images/2026/08/a.png" {
		t.Fatalf("checker should be called with the object key, got %v", missing.seen)
	}

	svc.SetObjectChecker(&fakeObjectChecker{exists: true})
	if _, err := svc.Add(context.Background(), alice.ID, "images/2026/08/a.png", 96, 96, hash); err != nil {
		t.Fatalf("existing object should be accepted: %v", err)
	}
}

// TestStickerAddEnforcesCapButStaysIdempotent 达上限后拒绝新增，
// 但「重复收藏已有内容」仍走幂等成功——那不新增行，拒掉会让满仓用户
// 连自己已收藏的图都提示失败。
func TestStickerAddEnforcesCapButStaysIdempotent(t *testing.T) {
	db := testDB(t)
	db.AutoMigrate(&model.StickerPack{}, &model.Sticker{})
	alice := newTestUser(t, db, "甲cap")
	svc := newStickerSvc(db)
	ctx := context.Background()

	// 直接写库造出 maxStickerFavorites 行，避开逐条走 Add 的开销
	rows := make([]model.Sticker, 0, maxStickerFavorites)
	for i := 0; i < maxStickerFavorites; i++ {
		owner := alice.ID
		rows = append(rows, model.Sticker{
			OwnerID:     &owner,
			ObjectKey:   "images/2026/08/a.png",
			Width:       96,
			Height:      96,
			ContentHash: fmt.Sprintf("%064x", i),
		})
	}
	if err := db.CreateInBatches(rows, 100).Error; err != nil {
		t.Fatalf("seed rows: %v", err)
	}

	newHash := fmt.Sprintf("%064x", maxStickerFavorites+1)
	if _, err := svc.Add(ctx, alice.ID, "images/2026/08/a.png", 96, 96, newHash); !errors.Is(err, ErrTooManyStickers) {
		t.Fatalf("want ErrTooManyStickers, got %v", err)
	}
	// 已存在的 hash 仍可"再收藏"（幂等返回既有行）
	existingHash := fmt.Sprintf("%064x", 0)
	got, err := svc.Add(ctx, alice.ID, "images/2026/08/a.png", 96, 96, existingHash)
	if err != nil {
		t.Fatalf("re-adding an existing sticker at cap should be idempotent, got %v", err)
	}
	if got.ContentHash != existingHash {
		t.Fatalf("want the existing row back, got %+v", got)
	}
}

// TestStickerResolveSendable 本人收藏可发；官方包贴纸全员可发；
// 他人的私人收藏不可发（此前 WS 路径完全不查库，可填别人的 sticker_id）。
func TestStickerResolveSendable(t *testing.T) {
	db := testDB(t)
	db.AutoMigrate(&model.StickerPack{}, &model.Sticker{})
	alice := newTestUser(t, db, "甲resolve")
	bob := newTestUser(t, db, "乙resolve")
	svc := newStickerSvc(db)
	ctx := context.Background()
	const hash = "41e63399bacaae3dafdf677291f0a7621fc58a681fa89daba700a678d18e7e78"

	own, err := svc.Add(ctx, alice.ID, "images/2026/08/0a1b2c3d.png", 96, 96, hash)
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	if got, err := svc.ResolveSendable(ctx, alice.ID, own.ID); err != nil || got.ObjectKey != "images/2026/08/0a1b2c3d.png" {
		t.Fatalf("owner should be able to send own sticker: %+v err=%v", got, err)
	}
	if _, err := svc.ResolveSendable(ctx, bob.ID, own.ID); !errors.Is(err, ErrStickerNotFound) {
		t.Fatalf("bob must not be able to send alice's private sticker, got %v", err)
	}

	// 官方包贴纸：pack_id 非空、owner_id 为空，任何人可发
	pack := model.StickerPack{Name: "官方测试包", IsOfficial: true}
	if err := db.Create(&pack).Error; err != nil {
		t.Fatalf("create pack: %v", err)
	}
	// 官方包及包内贴纸 owner_id 为空，不随测试用户级联删除，必须显式清理：
	// 否则每跑一次测试就往 dev 库多塞一个官方包，开发者表情面板的官方 tab
	// 会多出一格指向不存在对象的破图。
	t.Cleanup(func() {
		db.Exec(`DELETE FROM stickers WHERE pack_id = ?`, pack.ID)
		db.Exec(`DELETE FROM sticker_packs WHERE id = ?`, pack.ID)
	})
	packSticker := model.Sticker{
		PackID:      &pack.ID,
		ObjectKey:   "images/2026/08/0f1e2d3c4b5a.png",
		Width:       96,
		Height:      96,
		ContentHash: "aa63399bacaae3dafdf677291f0a7621fc58a681fa89daba700a678d18e7e778",
	}
	if err := db.Create(&packSticker).Error; err != nil {
		t.Fatalf("create pack sticker: %v", err)
	}
	for _, uid := range []uuid.UUID{alice.ID, bob.ID} {
		got, err := svc.ResolveSendable(ctx, uid, packSticker.ID)
		if err != nil || got.ObjectKey != "images/2026/08/0f1e2d3c4b5a.png" {
			t.Fatalf("official sticker should be sendable by %s: %+v err=%v", uid, got, err)
		}
	}
}

// TestStickerListMinePagination 游标分页：limit 生效、hasMore 正确、非法游标报错。
func TestStickerListMinePagination(t *testing.T) {
	db := testDB(t)
	db.AutoMigrate(&model.StickerPack{}, &model.Sticker{})
	alice := newTestUser(t, db, "甲page")
	svc := newStickerSvc(db)
	ctx := context.Background()

	base := time.Now().Add(-time.Hour)
	for i := 0; i < 5; i++ {
		owner := alice.ID
		row := model.Sticker{
			OwnerID:     &owner,
			ObjectKey:   "images/2026/08/a.png",
			Width:       96,
			Height:      96,
			ContentHash: fmt.Sprintf("%064x", i),
			CreatedAt:   base.Add(time.Duration(i) * time.Minute),
		}
		if err := db.Create(&row).Error; err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	first, hasMore, err := svc.ListMine(ctx, alice.ID, "", 2)
	if err != nil {
		t.Fatalf("page 1: %v", err)
	}
	if len(first) != 2 || !hasMore {
		t.Fatalf("want 2 rows + hasMore, got %d hasMore=%v", len(first), hasMore)
	}
	cursor := first[len(first)-1].CreatedAt.Format(time.RFC3339Nano)
	second, _, err := svc.ListMine(ctx, alice.ID, cursor, 2)
	if err != nil {
		t.Fatalf("page 2: %v", err)
	}
	if len(second) != 2 || second[0].CreatedAt.After(first[len(first)-1].CreatedAt) {
		t.Fatalf("cursor should move strictly backwards in time, got %+v", second)
	}

	if _, _, err := svc.ListMine(ctx, alice.ID, "not-a-time", 2); !errors.Is(err, ErrInvalidCursor) {
		t.Fatalf("want ErrInvalidCursor, got %v", err)
	}
}

// TestStickerListMineEmptyIsNonNilSlice 无收藏时必须返回空切片而非 nil。
//
// nil 会被 json 编成 `"stickers": null`，而客户端把「该字段不是数组」当成响应损坏
// 直接报错重试（见 api/stickers.ts）——真实的"我还没收藏过"绝不能撞进那条错误路径。
func TestStickerListMineEmptyIsNonNilSlice(t *testing.T) {
	db := testDB(t)
	db.AutoMigrate(&model.StickerPack{}, &model.Sticker{})
	alice := newTestUser(t, db, "甲empty")
	svc := newStickerSvc(db)

	rows, hasMore, err := svc.ListMine(context.Background(), alice.ID, "", 20)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if hasMore {
		t.Fatalf("empty list should not report hasMore")
	}
	if rows == nil {
		t.Fatalf("want non-nil empty slice (marshals to []), got nil (marshals to null)")
	}
	if len(rows) != 0 {
		t.Fatalf("want 0 rows, got %d", len(rows))
	}

	// 直接验 JSON 形态，避免有人日后把 nil 又放回来
	blob, err := json.Marshal(map[string]any{"stickers": rows})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(blob) != `{"stickers":[]}` {
		t.Fatalf("want {\"stickers\":[]}, got %s", blob)
	}
}
