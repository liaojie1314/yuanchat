package service

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
)

// TestProfile_NotFoundForUnknownUser 不存在的用户必须返回 ErrUserNotFound，
// 而非 (nil, nil)——后者会让 GetPublicProfile 对 nil user 解引用 panic。
func TestProfile_NotFoundForUnknownUser(t *testing.T) {
	db := testDB(t)
	svc := NewUserService(repository.NewUserRepository(db), nil, nil, zap.NewNop())

	user, err := svc.Profile(context.Background(), uuid.New())
	if !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("expected ErrUserNotFound, got user=%+v err=%v", user, err)
	}
}

// TestProfile_ReturnsPublicFields 存在的用户返回完整资料字段。
func TestProfile_ReturnsPublicFields(t *testing.T) {
	db := testDB(t)
	u := newTestUser(t, db, "资料查询")
	svc := NewUserService(repository.NewUserRepository(db), nil, nil, zap.NewNop())

	got, err := svc.Profile(context.Background(), u.ID)
	if err != nil {
		t.Fatalf("Profile: %v", err)
	}
	if got.ID != u.ID || got.Nickname != "资料查询" || got.ShortID != u.ShortID {
		t.Fatalf("profile fields mismatch: %+v", got)
	}
}

func TestUpdateProfile_PersistsFields(t *testing.T) {
	db := testDB(t)
	user := newTestUser(t, db, "改名前")
	svc := NewUserService(repository.NewUserRepository(db), nil, nil, zap.NewNop())

	nick := "改名后"
	bio := "新签名"
	gender := int16(1)
	updated, err := svc.UpdateProfile(context.Background(), user.ID, &nick, nil, &bio, &gender)
	if err != nil {
		t.Fatalf("UpdateProfile: %v", err)
	}
	if updated.Nickname != "改名后" || updated.Bio == nil || *updated.Bio != "新签名" || updated.Gender != 1 {
		t.Fatalf("returned user not updated: %+v", updated)
	}

	// 重新查库验证持久化
	reloaded, err := svc.Profile(context.Background(), user.ID)
	if err != nil || reloaded.Nickname != "改名后" {
		t.Fatalf("not persisted: %+v err=%v", reloaded, err)
	}
}
