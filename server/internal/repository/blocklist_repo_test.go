package repository

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
	"gorm.io/gorm/schema"
)

// testDB 连接本地开发库（deploy/docker-compose.yml 的 postgres :5433）。
// 数据库不可达时跳过集成用例（CI 无 DB 环境仍绿）。
func testDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := "host=localhost port=5433 user=yuanchat password=yuanchat_dev dbname=yuanchat sslmode=disable"
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
		NamingStrategy: schema.NamingStrategy{
			SingularTable: true,
		},
		SkipDefaultTransaction: true,
	})
	if err != nil {
		t.Skipf("dev postgres unavailable, skip integration test: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil || sqlDB.Ping() != nil {
		t.Skip("dev postgres unavailable, skip integration test")
	}
	if err := db.AutoMigrate(&model.Blocklist{}); err != nil {
		t.Fatalf("migrate blocklists: %v", err)
	}
	return db
}

// newTestUser 建一次性用户，测试结束清理拉黑记录 + 用户本身。
func newTestUser(t *testing.T, db *gorm.DB, tag string) *model.User {
	t.Helper()
	// 用纳秒 + tag 长度做种子，避免同一测试内多用户短号/手机号冲突
	seed := time.Now().UnixNano()
	phone := fmt.Sprintf("199%08d", seed%100000000)
	user := &model.User{
		ID:           uuid.New(),
		Phone:        &phone,
		PasswordHash: "x",
		ShortID:      seed%1_000_000_000 + int64(len(tag)),
		Nickname:     tag,
		Status:       model.UserStatusNormal,
	}
	if err := db.Create(user).Error; err != nil {
		t.Fatalf("create test user: %v", err)
	}
	t.Cleanup(func() {
		db.Exec(`DELETE FROM blocklists WHERE user_id = ? OR target_id = ?`, user.ID, user.ID)
		db.Unscoped().Delete(user)
	})
	// 避免同批用户 seed 一致
	time.Sleep(time.Nanosecond)
	return user
}

func TestBlocklistRepo_BlockAndIsBlocked(t *testing.T) {
	db := testDB(t)
	repo := NewBlocklistRepository(db)
	ctx := context.Background()
	a := newTestUser(t, db, "alice")
	b := newTestUser(t, db, "bob")

	// 初始双向 false
	yes, err := repo.IsBlocked(ctx, a.ID, b.ID)
	if err != nil || yes {
		t.Fatalf("initial IsBlocked(a→b)=%v err=%v, want false", yes, err)
	}

	// A 拉黑 B
	if err := repo.Block(ctx, a.ID, b.ID); err != nil {
		t.Fatalf("first Block: %v", err)
	}

	// A 发给 B 应被拒（B 拉黑了 A？—— NO，语义：actor=B, target=A 时，
	// 检查是否 A 曾拉黑 B。此处 A→B send，actor=A, target=B，
	// IsBlocked(actor=A, target=B) 应返回 true（B 收不到 A 的消息，因为 A 拉黑了 B 也拒收 B 的消息，
	// 但从 A 发给 B 的角度，B 不希望收到 A 是 B→A 的反向。这里 IsBlocked 语义是：
	// "A 想发给 B" 时检查 target(B) 是否拉黑 actor(A)")
	yes, err = repo.IsBlocked(ctx, b.ID, a.ID) // 换向：B→A 检查 A 是否拉黑 B
	if err != nil || !yes {
		t.Fatalf("after A blocks B: IsBlocked(actor=B,target=A)=%v err=%v, want true (A blocks B)", yes, err)
	}

	// 二次 Block 幂等
	if err := repo.Block(ctx, a.ID, b.ID); err != nil {
		t.Fatalf("second Block should be idempotent: %v", err)
	}

	// 反向 IsBlocked(A→B) 仍为 false（B 没拉黑 A）
	yes, err = repo.IsBlocked(ctx, a.ID, b.ID)
	if err != nil || yes {
		t.Fatalf("A→B not blocked but got %v", yes)
	}
}

func TestBlocklistRepo_Unblock(t *testing.T) {
	db := testDB(t)
	repo := NewBlocklistRepository(db)
	ctx := context.Background()
	a := newTestUser(t, db, "alice")
	b := newTestUser(t, db, "bob")

	if err := repo.Block(ctx, a.ID, b.ID); err != nil {
		t.Fatalf("block: %v", err)
	}
	if err := repo.Unblock(ctx, a.ID, b.ID); err != nil {
		t.Fatalf("unblock: %v", err)
	}
	yes, err := repo.IsBlocked(ctx, b.ID, a.ID)
	if err != nil || yes {
		t.Fatalf("after Unblock: IsBlocked should be false, got %v", yes)
	}

	// 再 Unblock 幂等
	if err := repo.Unblock(ctx, a.ID, b.ID); err != nil {
		t.Fatalf("second unblock should be idempotent: %v", err)
	}
}

func TestBlocklistRepo_IsBlockedEitherDirection(t *testing.T) {
	db := testDB(t)
	repo := NewBlocklistRepository(db)
	ctx := context.Background()
	a := newTestUser(t, db, "alice")
	b := newTestUser(t, db, "bob")
	c := newTestUser(t, db, "carol")

	// A 拉黑 B
	if err := repo.Block(ctx, a.ID, b.ID); err != nil {
		t.Fatalf("a block b: %v", err)
	}

	// A-B 命中
	yes, err := repo.IsBlockedEitherDirection(ctx, a.ID, b.ID)
	if err != nil || !yes {
		t.Fatalf("A-B either-dir want true, got %v", yes)
	}

	// B-A 命中（对称查询）
	yes, err = repo.IsBlockedEitherDirection(ctx, b.ID, a.ID)
	if err != nil || !yes {
		t.Fatalf("B-A either-dir want true, got %v", yes)
	}

	// A-C 无关系
	yes, err = repo.IsBlockedEitherDirection(ctx, a.ID, c.ID)
	if err != nil || yes {
		t.Fatalf("A-C either-dir want false, got %v", yes)
	}
}

func TestBlocklistRepo_ListByUser(t *testing.T) {
	db := testDB(t)
	repo := NewBlocklistRepository(db)
	ctx := context.Background()
	a := newTestUser(t, db, "alice")
	b := newTestUser(t, db, "bob")
	c := newTestUser(t, db, "carol")

	if err := repo.Block(ctx, a.ID, b.ID); err != nil {
		t.Fatalf("block b: %v", err)
	}
	if err := repo.Block(ctx, a.ID, c.ID); err != nil {
		t.Fatalf("block c: %v", err)
	}

	ids, err := repo.ListByUser(ctx, a.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(ids) != 2 {
		t.Fatalf("expect 2 blocked ids, got %d: %v", len(ids), ids)
	}
	// 目标应含 b、c
	have := map[uuid.UUID]bool{ids[0]: true, ids[1]: true}
	if !have[b.ID] || !have[c.ID] {
		t.Fatalf("blocked ids missing b/c, got %v", ids)
	}
}

func TestBlocklistRepo_CannotBlockSelf(t *testing.T) {
	db := testDB(t)
	repo := NewBlocklistRepository(db)
	ctx := context.Background()
	a := newTestUser(t, db, "alice")

	if err := repo.Block(ctx, a.ID, a.ID); err == nil {
		t.Fatalf("expect error on self-block, got nil")
	}
}
