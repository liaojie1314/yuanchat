package service

import (
	"context"
	"errors"
	"testing"

	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

func newBlocklistSvc(db *gorm.DB) *BlocklistService {
	return NewBlocklistService(
		repository.NewBlocklistRepository(db),
		repository.NewUserRepository(db),
		zap.NewNop(),
	)
}

func TestBlocklistService_BlockAndList(t *testing.T) {
	db := testDB(t)
	svc := newBlocklistSvc(db)
	ctx := context.Background()
	a := newTestUser(t, db, "alice")
	b := newTestUser(t, db, "bob")

	// 首次拉黑
	if err := svc.Block(ctx, a.ID, b.ID); err != nil {
		t.Fatalf("block: %v", err)
	}

	// 二次拉黑幂等
	if err := svc.Block(ctx, a.ID, b.ID); err != nil {
		t.Fatalf("second block should be idempotent: %v", err)
	}

	// List 返回带 Nickname
	items, err := svc.List(ctx, a.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expect 1 item, got %d", len(items))
	}
	if items[0].TargetID != b.ID || items[0].Nickname != b.Nickname {
		t.Fatalf("mismatched item: %+v", items[0])
	}
}

func TestBlocklistService_BlockSelfRejected(t *testing.T) {
	db := testDB(t)
	svc := newBlocklistSvc(db)
	ctx := context.Background()
	a := newTestUser(t, db, "alice")

	err := svc.Block(ctx, a.ID, a.ID)
	if !errors.Is(err, repository.ErrBlockSelf) {
		t.Fatalf("expect ErrBlockSelf, got %v", err)
	}
}

func TestBlocklistService_BlockNonexistentTarget(t *testing.T) {
	db := testDB(t)
	svc := newBlocklistSvc(db)
	ctx := context.Background()
	a := newTestUser(t, db, "alice")

	// 随机不存在的 uuid
	nonExistent := a.ID
	nonExistent[0] ^= 0xFF
	err := svc.Block(ctx, a.ID, nonExistent)
	if !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("expect ErrUserNotFound, got %v", err)
	}
}

func TestBlocklistService_Unblock(t *testing.T) {
	db := testDB(t)
	svc := newBlocklistSvc(db)
	ctx := context.Background()
	a := newTestUser(t, db, "alice")
	b := newTestUser(t, db, "bob")

	if err := svc.Block(ctx, a.ID, b.ID); err != nil {
		t.Fatalf("block: %v", err)
	}
	if err := svc.Unblock(ctx, a.ID, b.ID); err != nil {
		t.Fatalf("unblock: %v", err)
	}
	items, err := svc.List(ctx, a.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("expect empty after unblock, got %d", len(items))
	}

	// 再 Unblock 幂等
	if err := svc.Unblock(ctx, a.ID, b.ID); err != nil {
		t.Fatalf("second unblock should be idempotent: %v", err)
	}
}

func TestBlocklistService_IsBlockedEitherDirection(t *testing.T) {
	db := testDB(t)
	svc := newBlocklistSvc(db)
	ctx := context.Background()
	a := newTestUser(t, db, "alice")
	b := newTestUser(t, db, "bob")

	if err := svc.Block(ctx, a.ID, b.ID); err != nil {
		t.Fatalf("a block b: %v", err)
	}
	yes, err := svc.IsBlockedEitherDirection(ctx, a.ID, b.ID)
	if err != nil || !yes {
		t.Fatalf("expect blocked, got yes=%v err=%v", yes, err)
	}
	// 换向查询仍命中（对称）
	yes, err = svc.IsBlockedEitherDirection(ctx, b.ID, a.ID)
	if err != nil || !yes {
		t.Fatalf("expect blocked either dir, got yes=%v err=%v", yes, err)
	}
}

func TestContactService_DeleteFriend(t *testing.T) {
	db := testDB(t)
	svc := newContactSvc(db)
	ctx := context.Background()
	a := newTestUser(t, db, "alice")
	b := newTestUser(t, db, "bob")

	// 先建立好友关系：走 Accept 流程或直接插 contacts
	// 直接插两行 accepted，模拟 Accept 后的状态
	if err := db.Exec(`INSERT INTO contacts (id, user_id, contact_user_id, status, created_at, updated_at)
		VALUES (gen_random_uuid(), ?, ?, 1, now(), now()),
		       (gen_random_uuid(), ?, ?, 1, now(), now())`,
		a.ID, b.ID, b.ID, a.ID).Error; err != nil {
		t.Fatalf("seed contacts: %v", err)
	}

	// 删除
	if err := svc.DeleteFriend(ctx, a.ID, b.ID); err != nil {
		t.Fatalf("delete friend: %v", err)
	}

	// 双方 IsFriend 都应为 false
	yes, err := svc.repo.IsFriend(ctx, a.ID, b.ID)
	if err != nil {
		t.Fatalf("IsFriend a-b: %v", err)
	}
	if yes {
		t.Fatalf("expect a-b not friends after delete")
	}
	yes, err = svc.repo.IsFriend(ctx, b.ID, a.ID)
	if err != nil {
		t.Fatalf("IsFriend b-a: %v", err)
	}
	if yes {
		t.Fatalf("expect b-a not friends after delete")
	}

	// 再删幂等
	if err := svc.DeleteFriend(ctx, a.ID, b.ID); err != nil {
		t.Fatalf("second delete should be idempotent: %v", err)
	}
}

func TestContactService_DeleteFriend_Self(t *testing.T) {
	db := testDB(t)
	svc := newContactSvc(db)
	ctx := context.Background()
	a := newTestUser(t, db, "alice")

	err := svc.DeleteFriend(ctx, a.ID, a.ID)
	if !errors.Is(err, ErrSelfRequest) {
		t.Fatalf("expect ErrSelfRequest, got %v", err)
	}
}
