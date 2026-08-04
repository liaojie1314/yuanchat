package service

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
)

// TestA7ColumnsExist 兜底确认 010 新列可用（AutoMigrate 补列）。
func TestA7ColumnsExist(t *testing.T) {
	db := testDB(t)
	if err := db.AutoMigrate(&model.ConversationMember{}, &model.Conversation{}); err != nil {
		t.Fatalf("automigrate a7 columns: %v", err)
	}
}

// TestUpdateAnnouncementByAdmin 管理员可更新公告，普通成员 403，非成员 ErrNotMember。
func TestUpdateAnnouncementByAdmin(t *testing.T) {
	db := testDB(t)
	if err := db.AutoMigrate(&model.Conversation{}, &model.ConversationMember{}); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	owner := newTestUser(t, db, "群主")
	member := newTestUser(t, db, "普通")
	outsider := newTestUser(t, db, "外人")
	svc := newConvSvc(db)
	makeFriends(t, db, owner.ID, member.ID)
	convID := newManagedGroup(t, svc, owner.ID, []uuid.UUID{member.ID})
	ctx := context.Background()

	res, _, updatedAt, err := svc.UpdateAnnouncement(ctx, owner.ID, convID, "新公告内容")
	if err != nil {
		t.Fatalf("owner update announcement: %v", err)
	}
	if res.SysMsg == nil || res.SysMsg.MessageType != model.MessageTypeSystem {
		t.Fatal("should emit system message")
	}
	if updatedAt == nil {
		t.Fatal("announcement_updated_at should be set")
	}

	if _, _, _, err := svc.UpdateAnnouncement(ctx, member.ID, convID, "x"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("normal member should get ErrForbidden, got %v", err)
	}
	if _, _, _, err := svc.UpdateAnnouncement(ctx, outsider.ID, convID, "x"); !errors.Is(err, ErrNotMember) {
		t.Fatalf("outsider should get ErrNotMember, got %v", err)
	}
}

// TestUpdateMyAlias 任意成员可改自己的群昵称，超 30 字符 ErrInvalidAlias，成员列表署名生效。
func TestUpdateMyAlias(t *testing.T) {
	db := testDB(t)
	if err := db.AutoMigrate(&model.ConversationMember{}); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	owner := newTestUser(t, db, "群主")
	member := newTestUser(t, db, "普通成员本名")
	svc := newConvSvc(db)
	makeFriends(t, db, owner.ID, member.ID)
	convID := newManagedGroup(t, svc, owner.ID, []uuid.UUID{member.ID})
	ctx := context.Background()

	if err := svc.UpdateMyAlias(ctx, member.ID, convID, "群里的我"); err != nil {
		t.Fatalf("member set alias: %v", err)
	}
	members, err := svc.Members(ctx, owner.ID, convID)
	if err != nil {
		t.Fatalf("members: %v", err)
	}
	var found bool
	for _, m := range members {
		if m.UserID == member.ID {
			found = true
			if m.Nickname != "群里的我" {
				t.Fatalf("alias should override nickname in member list, got %q", m.Nickname)
			}
		}
	}
	if !found {
		t.Fatal("member not in list")
	}

	// 超长报 ErrInvalidAlias
	long := ""
	for i := 0; i < 31; i++ {
		long += "x"
	}
	if err := svc.UpdateMyAlias(ctx, member.ID, convID, long); !errors.Is(err, ErrInvalidAlias) {
		t.Fatalf("31 chars should be ErrInvalidAlias, got %v", err)
	}

	// 空串 = 清除，署名回退本名
	if err := svc.UpdateMyAlias(ctx, member.ID, convID, ""); err != nil {
		t.Fatalf("clear alias: %v", err)
	}
	members2, _ := svc.Members(ctx, owner.ID, convID)
	for _, m := range members2 {
		if m.UserID == member.ID && m.Nickname != "普通成员本名" {
			t.Fatalf("cleared alias should fall back to nickname, got %q", m.Nickname)
		}
	}
}
