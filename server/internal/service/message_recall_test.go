package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

func newMessageSvc(db *gorm.DB) *MessageService {
	return NewMessageService(
		repository.NewMessageRepository(db),
		repository.NewConversationRepository(db),
		repository.NewUserRepository(db),
		repository.NewReactionRepository(db),
		repository.NewBlocklistRepository(db),
		zap.NewNop(),
	)
}

// newRecallFixture 建单聊会话 + 两成员 + 一条 a 发的 normal 消息（seq=1）。
func newRecallFixture(t *testing.T, db *gorm.DB, a, b *model.User) *model.Message {
	t.Helper()
	conv := &model.Conversation{ID: uuid.New(), Type: model.ConversationTypePrivate}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	for _, u := range []*model.User{a, b} {
		if err := db.Create(&model.ConversationMember{
			ID: uuid.New(), ConversationID: conv.ID, UserID: u.ID,
		}).Error; err != nil {
			t.Fatalf("create member: %v", err)
		}
	}
	msg := &model.Message{
		ID:             uuid.New(),
		ConversationID: conv.ID,
		SenderID:       a.ID,
		Seq:            1,
		MessageType:    model.MessageTypeText,
		Content:        `{"text":"hello"}`,
		Status:         model.MessageStatusNormal,
	}
	if err := db.Create(msg).Error; err != nil {
		t.Fatalf("create message: %v", err)
	}
	return msg
}

func TestRecallBySenderSucceeds(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	a := newTestUser(t, db, "recall-a")
	b := newTestUser(t, db, "recall-b")
	msg := newRecallFixture(t, db, a, b)
	ctx := context.Background()

	result, err := svc.Recall(ctx, a.ID, msg.ID)
	if err != nil {
		t.Fatalf("recall by sender: %v", err)
	}
	if result.Idempotent {
		t.Fatal("first recall should not be idempotent")
	}
	if result.OperatorNickname != a.Nickname {
		t.Fatalf("expected operator nickname %q, got %q", a.Nickname, result.OperatorNickname)
	}
	// MemberIDs 应含全部成员
	if len(result.MemberIDs) != 2 {
		t.Fatalf("expected 2 member ids, got %d", len(result.MemberIDs))
	}

	// DB 真状态：status=revoked、content 清空
	var row model.Message
	if err := db.First(&row, "id = ?", msg.ID).Error; err != nil {
		t.Fatalf("reload message: %v", err)
	}
	if row.Status != model.MessageStatusRevoked {
		t.Fatalf("expected status revoked, got %d", row.Status)
	}
	if row.Content != "{}" {
		t.Fatalf("expected content cleared to {}, got %q", row.Content)
	}
}

func TestRecallByNonSenderRejected(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	a := newTestUser(t, db, "recall-ns-a")
	b := newTestUser(t, db, "recall-ns-b")
	msg := newRecallFixture(t, db, a, b)

	_, err := svc.Recall(context.Background(), b.ID, msg.ID)
	if !errors.Is(err, ErrNotSender) {
		t.Fatalf("expected ErrNotSender, got %v", err)
	}

	// 未改动 DB
	var row model.Message
	db.First(&row, "id = ?", msg.ID)
	if row.Status != model.MessageStatusNormal {
		t.Fatalf("non-sender recall must not change status, got %d", row.Status)
	}
}

func TestRecallWindowExpired(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	a := newTestUser(t, db, "recall-exp-a")
	b := newTestUser(t, db, "recall-exp-b")
	msg := newRecallFixture(t, db, a, b)

	// 把创建时间挪到 3 分钟前（超 2 分钟窗口）
	if err := db.Model(&model.Message{}).Where("id = ?", msg.ID).
		Update("created_at", time.Now().Add(-3*time.Minute)).Error; err != nil {
		t.Fatalf("backdate message: %v", err)
	}

	_, err := svc.Recall(context.Background(), a.ID, msg.ID)
	if !errors.Is(err, ErrRecallWindowExpired) {
		t.Fatalf("expected ErrRecallWindowExpired, got %v", err)
	}
}

func TestRecallNotFound(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	a := newTestUser(t, db, "recall-nf-a")

	_, err := svc.Recall(context.Background(), a.ID, uuid.New())
	if !errors.Is(err, ErrMessageNotFound) {
		t.Fatalf("expected ErrMessageNotFound, got %v", err)
	}
}

func TestRecallIdempotent(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	a := newTestUser(t, db, "recall-idem-a")
	b := newTestUser(t, db, "recall-idem-b")
	msg := newRecallFixture(t, db, a, b)
	ctx := context.Background()

	if _, err := svc.Recall(ctx, a.ID, msg.ID); err != nil {
		t.Fatalf("first recall: %v", err)
	}

	second, err := svc.Recall(ctx, a.ID, msg.ID)
	if err != nil {
		t.Fatalf("second recall should be idempotent, got %v", err)
	}
	if !second.Idempotent {
		t.Fatal("expected Idempotent=true on repeated recall")
	}
	if len(second.MemberIDs) != 0 {
		t.Fatalf("idempotent recall should carry no member ids, got %d", len(second.MemberIDs))
	}
}
