package repository

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/yuanchat/server/internal/model"
)

// TestInsertWithMentions 验证 Mentions（uuid[]）列可写可读，兼容 v0.1 消息（Mentions=nil）。
func TestInsertWithMentions(t *testing.T) {
	db := testDB(t)

	sender := newTestUser(t, db, "sender")
	m1 := newTestUser(t, db, "m1")
	m2 := newTestUser(t, db, "m2")

	conv := &model.Conversation{Type: model.ConversationTypeGroup, LastSeq: 0}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("create conv: %v", err)
	}
	t.Cleanup(func() {
		db.Exec(`DELETE FROM messages WHERE conversation_id = ?`, conv.ID)
		db.Exec(`DELETE FROM conversation_members WHERE conversation_id = ?`, conv.ID)
		db.Unscoped().Delete(conv)
	})
	for _, uid := range []uuid.UUID{sender.ID, m1.ID, m2.ID} {
		if err := db.Create(&model.ConversationMember{ConversationID: conv.ID, UserID: uid}).Error; err != nil {
			t.Fatalf("create member: %v", err)
		}
	}

	msg := &model.Message{
		ConversationID: conv.ID,
		SenderID:       sender.ID,
		Seq:            1,
		MessageType:    model.MessageTypeText,
		Content:        `{"text":"@m1 @m2 你们好"}`,
		Status:         model.MessageStatusNormal,
		Mentions:       pq.StringArray{m1.ID.String(), m2.ID.String()},
	}
	if err := db.Create(msg).Error; err != nil {
		t.Fatalf("create msg with mentions: %v", err)
	}

	var loaded model.Message
	if err := db.First(&loaded, "id = ?", msg.ID).Error; err != nil {
		t.Fatalf("load msg: %v", err)
	}
	if len(loaded.Mentions) != 2 {
		t.Fatalf("mentions len: got %v, want 2", loaded.Mentions)
	}
	if loaded.Mentions[0] != m1.ID.String() || loaded.Mentions[1] != m2.ID.String() {
		t.Fatalf("mentions order/value: %v", loaded.Mentions)
	}

	// 兼容 nil：无 @ 消息读回 Mentions 长度为 0
	plain := &model.Message{
		ConversationID: conv.ID,
		SenderID:       sender.ID,
		Seq:            2,
		MessageType:    model.MessageTypeText,
		Content:        `{"text":"hi"}`,
		Status:         model.MessageStatusNormal,
	}
	if err := db.Create(plain).Error; err != nil {
		t.Fatalf("create plain msg: %v", err)
	}
	var loadedPlain model.Message
	if err := db.First(&loadedPlain, "id = ?", plain.ID).Error; err != nil {
		t.Fatalf("load plain: %v", err)
	}
	if len(loadedPlain.Mentions) != 0 {
		t.Fatalf("plain mentions len: got %v, want 0", loadedPlain.Mentions)
	}

	_ = context.Background()
}

// TestMentionUnreadFlag 验证 ConversationMember.MentionUnread 列可读写。
func TestMentionUnreadFlag(t *testing.T) {
	db := testDB(t)

	u := newTestUser(t, db, "mu")
	conv := &model.Conversation{Type: model.ConversationTypeGroup}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("create conv: %v", err)
	}
	t.Cleanup(func() {
		db.Exec(`DELETE FROM conversation_members WHERE conversation_id = ?`, conv.ID)
		db.Unscoped().Delete(conv)
	})

	m := &model.ConversationMember{ConversationID: conv.ID, UserID: u.ID}
	if err := db.Create(m).Error; err != nil {
		t.Fatalf("create member: %v", err)
	}
	if m.MentionUnread {
		t.Fatal("default should be false")
	}

	if err := db.Model(m).Update("mention_unread", true).Error; err != nil {
		t.Fatalf("set unread: %v", err)
	}
	var loaded model.ConversationMember
	if err := db.First(&loaded, "id = ?", m.ID).Error; err != nil {
		t.Fatalf("load: %v", err)
	}
	if !loaded.MentionUnread {
		t.Fatal("mention_unread not persisted")
	}
}
