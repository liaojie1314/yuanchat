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
