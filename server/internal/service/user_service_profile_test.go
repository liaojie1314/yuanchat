package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
)

// TestProfile_NotFoundForUnknownUser 不存在的用户必须返回 ErrUserNotFound，
// 而非 (nil, nil)——后者会让 GetPublicProfile 对 nil user 解引用 panic。
func TestProfile_NotFoundForUnknownUser(t *testing.T) {
	db := testDB(t)
	svc := NewUserService(repository.NewUserRepository(db), nil, nil, nil, zap.NewNop())

	user, err := svc.Profile(context.Background(), uuid.New())
	if !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("expected ErrUserNotFound, got user=%+v err=%v", user, err)
	}
}

// TestProfile_ReturnsPublicFields 存在的用户返回完整资料字段。
func TestProfile_ReturnsPublicFields(t *testing.T) {
	db := testDB(t)
	u := newTestUser(t, db, "资料查询")
	svc := NewUserService(repository.NewUserRepository(db), nil, nil, nil, zap.NewNop())

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
	svc := NewUserService(repository.NewUserRepository(db), nil, nil, nil, zap.NewNop())

	nick := "改名后"
	bio := "新签名"
	gender := int16(1)
	updated, err := svc.UpdateProfile(context.Background(), user.ID, ProfilePatch{Nickname: &nick, Bio: &bio, Gender: &gender})
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

// TestUpdateProfile_Status 设置状态与到期清除。
func TestUpdateProfile_Status(t *testing.T) {
	db := testDB(t)
	svc := NewUserService(repository.NewUserRepository(db), nil, nil, nil, zap.NewNop())
	ctx := context.Background()
	u := newTestUser(t, db, "状态用户")

	emoji, text := "🌞", "在学习"
	dur := int64(3600)
	got, err := svc.UpdateProfile(ctx, u.ID, ProfilePatch{StatusEmoji: &emoji, StatusText: &text, StatusDuration: &dur})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if got.StatusExpiresAt == nil {
		t.Fatal("传了时长应写入过期时刻")
	}
	if e, tx := got.EffectiveStatus(time.Now()); e != emoji || tx != text {
		t.Fatalf("有效状态 = (%q,%q)", e, tx)
	}
	// 过期后视为无状态
	if e, tx := got.EffectiveStatus(got.StatusExpiresAt.Add(time.Second)); e != "" || tx != "" {
		t.Fatalf("过期后应为空，got (%q,%q)", e, tx)
	}

	// 不传时长 = 不自动清除
	zero := int64(0)
	got, err = svc.UpdateProfile(ctx, u.ID, ProfilePatch{StatusEmoji: &emoji, StatusText: &text, StatusDuration: &zero})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if got.StatusExpiresAt != nil {
		t.Fatal("时长为 0 应表示不自动清除")
	}

	// 持久化回查：状态必须真的落库，不能只改内存里的 user
	reloaded, err := svc.Profile(ctx, u.ID)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if reloaded.StatusEmoji != emoji || reloaded.StatusText != text {
		t.Fatalf("状态未持久化: (%q,%q)", reloaded.StatusEmoji, reloaded.StatusText)
	}
}
