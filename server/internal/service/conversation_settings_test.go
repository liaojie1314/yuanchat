package service

import (
	"context"
	"testing"
	"time"

	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// settingsTestEnv 建一个双人单聊 + service（复用包内 testDB/newTestUser 助手）。
func settingsTestEnv(t *testing.T) (svcEnv struct {
	DB   *gorm.DB
	Svc  *ConversationService
	Conv *model.Conversation
	A, B *model.User
}) {
	t.Helper()
	db := testDB(t)
	// dev 库可能尚未跑 goose 009：AutoMigrate 兜底补列（与 contact_service_test.go:39 同范式）
	if err := db.AutoMigrate(&model.ConversationMember{}); err != nil {
		t.Fatalf("automigrate conversation_members: %v", err)
	}
	a := newTestUser(t, db, "甲settings")
	b := newTestUser(t, db, "乙settings")
	conv := &model.Conversation{Type: model.ConversationTypePrivate}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("create conv: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(conv) })
	for _, u := range []*model.User{a, b} {
		m := &model.ConversationMember{ConversationID: conv.ID, UserID: u.ID, JoinedAt: time.Now()}
		if err := db.Create(m).Error; err != nil {
			t.Fatalf("create member: %v", err)
		}
	}
	t.Cleanup(func() {
		db.Where("conversation_id = ?", conv.ID).Delete(&model.ConversationMember{})
	})
	svcEnv.DB = db
	svcEnv.Svc = NewConversationService(
		repository.NewConversationRepository(db), repository.NewMessageRepository(db),
		repository.NewContactRepository(db), repository.NewUserRepository(db), zap.NewNop())
	svcEnv.Conv = conv
	svcEnv.A, svcEnv.B = a, b
	return svcEnv
}

// TestListSurfacesPinnedFields 列表 DTO 透出 is_pinned / pinned_at。
func TestListSurfacesPinnedFields(t *testing.T) {
	env := settingsTestEnv(t)
	now := time.Now()
	if err := env.DB.Model(&model.ConversationMember{}).
		Where("conversation_id = ? AND user_id = ?", env.Conv.ID, env.A.ID).
		Updates(map[string]any{"is_pinned": true, "pinned_at": now}).Error; err != nil {
		t.Fatalf("seed pinned: %v", err)
	}

	dtos, err := env.Svc.List(context.Background(), env.A.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	var found bool
	for _, d := range dtos {
		if d.ID == env.Conv.ID {
			found = true
			if !d.IsPinned || d.PinnedAt == nil {
				t.Fatalf("want pinned dto, got %+v", d)
			}
		}
	}
	if !found {
		t.Fatal("conversation not in list")
	}
}
