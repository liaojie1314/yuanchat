package service

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

func newConvSvc(db *gorm.DB) *ConversationService {
	return NewConversationService(
		repository.NewConversationRepository(db), repository.NewMessageRepository(db),
		repository.NewContactRepository(db), repository.NewUserRepository(db), zap.NewNop())
}

func TestCreateGroup(t *testing.T) {
	db := testDB(t)
	a := newTestUser(t, db, "群主")
	b := newTestUser(t, db, "成员乙")
	c := newTestUser(t, db, "陌生丙")
	d := newTestUser(t, db, "成员丁")

	// a↔b、a↔d 建好友（直接插 contacts 双向行）
	for _, pair := range [][2]uuid.UUID{{a.ID, b.ID}, {b.ID, a.ID}, {a.ID, d.ID}, {d.ID, a.ID}} {
		ct := &model.Contact{UserID: pair[0], ContactUserID: pair[1], Status: model.ContactStatusAccepted}
		if err := db.Create(ct).Error; err != nil {
			t.Fatalf("create contact: %v", err)
		}
		t.Cleanup(func() { db.Unscoped().Delete(ct) })
	}

	svc := newConvSvc(db)

	// 含陌生人 → ErrNotAllFriends
	if _, _, err := svc.CreateGroup(context.Background(), a.ID, nil, []uuid.UUID{b.ID, c.ID}); !errors.Is(err, ErrNotAllFriends) {
		t.Fatalf("want ErrNotAllFriends, got %v", err)
	}

	dto, memberIDs, err := svc.CreateGroup(context.Background(), a.ID, nil, []uuid.UUID{b.ID, d.ID})
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}
	t.Cleanup(func() {
		db.Where("conversation_id = ?", dto.ID).Delete(&model.ConversationMember{})
		db.Where("conversation_id = ?", dto.ID).Unscoped().Delete(&model.Message{})
		db.Unscoped().Delete(&model.Conversation{}, "id = ?", dto.ID)
	})
	if dto.Type != model.ConversationTypeGroup || dto.MemberCount != 3 || len(memberIDs) != 3 {
		t.Fatalf("bad dto: %+v members=%v", dto, memberIDs)
	}
	if dto.Name == "" || dto.LastMessage == nil {
		t.Fatalf("default name & greeting system message required: %+v", dto)
	}

	// —— 落库断言（DTO 为内存组装，须证明事务真实持久化）——

	// 成员行：3 行，发起者 owner，其余 normal
	var members []model.ConversationMember
	if err := db.Find(&members, "conversation_id = ?", dto.ID).Error; err != nil {
		t.Fatalf("load members: %v", err)
	}
	if len(members) != 3 {
		t.Fatalf("want 3 member rows persisted, got %d", len(members))
	}
	for _, m := range members {
		wantRole := model.MemberRoleNormal
		if m.UserID == a.ID {
			wantRole = model.MemberRoleOwner
		}
		if m.Role != wantRole {
			t.Fatalf("member %s role=%d, want %d", m.UserID, m.Role, wantRole)
		}
	}

	// 系统消息行：seq=1、type=system、发送者=发起者
	var msg model.Message
	if err := db.First(&msg, "conversation_id = ?", dto.ID).Error; err != nil {
		t.Fatalf("load system message: %v", err)
	}
	if msg.Seq != 1 || msg.MessageType != model.MessageTypeSystem || msg.SenderID != a.ID {
		t.Fatalf("bad system message: seq=%d type=%d sender=%s", msg.Seq, msg.MessageType, msg.SenderID)
	}

	// 发起者 last_read_seq 已推进到系统消息 seq
	var creatorMember model.ConversationMember
	if err := db.First(&creatorMember, "conversation_id = ? AND user_id = ?", dto.ID, a.ID).Error; err != nil {
		t.Fatalf("load creator member: %v", err)
	}
	if creatorMember.LastReadSeq != msg.Seq {
		t.Fatalf("creator last_read_seq=%d, want %d", creatorMember.LastReadSeq, msg.Seq)
	}
}

func TestCreateGroupNoValidMembers(t *testing.T) {
	db := testDB(t)
	a := newTestUser(t, db, "独身群主")
	svc := newConvSvc(db)

	// 仅含自己（去重剔除后为空）→ ErrNoValidMembers（handler 据此回 400 而非 500）
	if _, _, err := svc.CreateGroup(context.Background(), a.ID, nil, []uuid.UUID{a.ID}); !errors.Is(err, ErrNoValidMembers) {
		t.Fatalf("self-only member_ids: want ErrNoValidMembers, got %v", err)
	}
	// 重复自己多次同样为空
	if _, _, err := svc.CreateGroup(context.Background(), a.ID, nil, []uuid.UUID{a.ID, a.ID}); !errors.Is(err, ErrNoValidMembers) {
		t.Fatalf("duplicated self member_ids: want ErrNoValidMembers, got %v", err)
	}
}
