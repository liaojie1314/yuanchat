package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
)

func TestConversationMembers(t *testing.T) {
	db := testDB(t)
	a := newTestUser(t, db, "甲owner")
	b := newTestUser(t, db, "乙member")
	c := newTestUser(t, db, "丙outsider")

	conv := &model.Conversation{Type: model.ConversationTypeGroup}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("create conv: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(conv) })
	members := []model.ConversationMember{
		{ConversationID: conv.ID, UserID: a.ID, Role: model.MemberRoleOwner, JoinedAt: time.Now()},
		{ConversationID: conv.ID, UserID: b.ID, Role: model.MemberRoleNormal, JoinedAt: time.Now()},
	}
	for i := range members {
		if err := db.Create(&members[i]).Error; err != nil {
			t.Fatalf("create member: %v", err)
		}
	}
	t.Cleanup(func() { db.Where("conversation_id = ?", conv.ID).Delete(&model.ConversationMember{}) })

	svc := NewConversationService(repository.NewConversationRepository(db), repository.NewMessageRepository(db),
		repository.NewContactRepository(db), repository.NewUserRepository(db), zap.NewNop())

	got, err := svc.Members(context.Background(), b.ID, conv.ID)
	if err != nil || len(got) != 2 {
		t.Fatalf("members: %v len=%d", err, len(got))
	}
	if got[0].Role != model.MemberRoleOwner {
		t.Fatalf("owner should be first, got %+v", got[0])
	}

	if _, err := svc.Members(context.Background(), c.ID, conv.ID); !errors.Is(err, ErrNotMember) {
		t.Fatalf("outsider should get ErrNotMember, got %v", err)
	}
}
