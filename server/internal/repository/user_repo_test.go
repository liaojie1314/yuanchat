package repository

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
)

// TestUserRepo_ExistsByEmail 钉住注册查重的唯一入口。
//
// 签名从 ExistsByPhoneOrEmail(phone, email) 收窄而来：手机号已彻底移除，
// 留一个恒传空串的参数位就是留个坑 —— 下一个人会以为它还有用。
func TestUserRepo_ExistsByEmail(t *testing.T) {
	db := testDB(t)
	repo := NewUserRepository(db)
	ctx := context.Background()

	email := fmt.Sprintf("exists-%d@test.local", time.Now().UnixNano())
	user := &model.User{
		ID:           uuid.New(),
		Email:        &email,
		PasswordHash: "x",
		ShortID:      time.Now().UnixNano() % 1_000_000_000,
		Nickname:     "exists",
		Status:       model.UserStatusNormal,
	}
	if err := db.Create(user).Error; err != nil {
		t.Fatalf("create test user: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(user) })

	got, err := repo.ExistsByEmail(ctx, email)
	if err != nil {
		t.Fatalf("ExistsByEmail: %v", err)
	}
	if !got {
		t.Fatal("已注册邮箱应判为已存在")
	}

	got, err = repo.ExistsByEmail(ctx, "nobody-"+email)
	if err != nil {
		t.Fatalf("ExistsByEmail: %v", err)
	}
	if got {
		t.Fatal("未注册邮箱不应判为已存在")
	}
}
