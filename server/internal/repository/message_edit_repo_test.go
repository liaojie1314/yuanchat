package repository

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/testutil"
	"gorm.io/gorm"
)

// jsonText 解出 jsonb 内容里的 text 字段。
// 不能直接比字符串字面量：content/old_content 是 jsonb 列，Postgres 会规范化空白，
// 写入的 `{"text":"x"}` 读回来是 `{"text": "x"}`。
func jsonText(t *testing.T, raw string) string {
	t.Helper()
	var c model.MessageContentText
	if err := json.Unmarshal([]byte(raw), &c); err != nil {
		t.Fatalf("unmarshal content %q: %v", raw, err)
	}
	return c.Text
}

// seedConvAndUser 建一名用户 + 一个群会话并把该用户加为成员，
// 返回 (会话 ID, 用户 ID)。播种方式与 message_repo_test.go 的 mediaFixture 一致。
func seedConvAndUser(t *testing.T, db *gorm.DB) (uuid.UUID, uuid.UUID) {
	t.Helper()
	sender := newTestUser(t, db, "edit-sender")
	conv := &model.Conversation{Type: model.ConversationTypeGroup, LastSeq: 0}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("create conv: %v", err)
	}
	t.Cleanup(func() {
		db.Exec(`DELETE FROM message_edits WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)`, conv.ID)
		db.Exec(`DELETE FROM messages WHERE conversation_id = ?`, conv.ID)
		db.Exec(`DELETE FROM conversation_members WHERE conversation_id = ?`, conv.ID)
		db.Unscoped().Delete(conv)
	})
	if err := db.Create(&model.ConversationMember{ConversationID: conv.ID, UserID: sender.ID}).Error; err != nil {
		t.Fatalf("create member: %v", err)
	}
	return conv.ID, sender.ID
}

// seedEditableMessage 建一条可编辑的文本消息，返回其 id。
// 会话与用户走 testutil 的既有播种路径（见 message_repo_test.go 同名 helper 用法）。
func seedEditableMessage(t *testing.T, repo *MessageRepository, convID, senderID uuid.UUID) uuid.UUID {
	t.Helper()
	msg := &model.Message{
		ConversationID: convID,
		SenderID:       senderID,
		MessageType:    model.MessageTypeText,
		Content:        `{"text":"原始文本"}`,
		Status:         model.MessageStatusNormal,
	}
	if err := repo.CreateWithSeq(context.Background(), msg); err != nil {
		t.Fatalf("seed message: %v", err)
	}
	return msg.ID
}

func TestEditWithHistoryWritesVersionAndBumpsCount(t *testing.T) {
	db := testutil.NewDB(t)
	repo := NewMessageRepository(db)
	convID, senderID := seedConvAndUser(t, db)
	msgID := seedEditableMessage(t, repo, convID, senderID)

	editedAt := time.Now().UTC().Truncate(time.Second)
	ok, err := repo.EditWithHistory(context.Background(), msgID,
		`{"text":"原始文本"}`, `{"text":"改后文本"}`, 0, false, editedAt)
	if err != nil {
		t.Fatalf("EditWithHistory: %v", err)
	}
	if !ok {
		t.Fatal("EditWithHistory ok = false, want true")
	}

	got, err := repo.FindByID(context.Background(), msgID)
	if err != nil || got == nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got := jsonText(t, got.Content); got != "改后文本" {
		t.Errorf("content = %q, want 改后文本", got)
	}
	if got.EditCount != 1 {
		t.Errorf("EditCount = %d, want 1", got.EditCount)
	}
	if got.EditedAt == nil {
		t.Error("EditedAt = nil, want non-nil")
	}

	edits, err := repo.ListEdits(context.Background(), msgID)
	if err != nil {
		t.Fatalf("ListEdits: %v", err)
	}
	if len(edits) != 1 {
		t.Fatalf("len(edits) = %d, want 1", len(edits))
	}
	if edits[0].Version != 1 {
		t.Errorf("version = %d, want 1", edits[0].Version)
	}
	if got := jsonText(t, edits[0].OldContent); got != "原始文本" {
		t.Errorf("old_content = %q, want 原始文本", got)
	}
}

// TestEditWithHistoryCASRejectsStaleCount 证明 CAS 条件生效：
// 传入过期的 expectCount 时不写库、不留脏历史行。
func TestEditWithHistoryCASRejectsStaleCount(t *testing.T) {
	db := testutil.NewDB(t)
	repo := NewMessageRepository(db)
	convID, senderID := seedConvAndUser(t, db)
	msgID := seedEditableMessage(t, repo, convID, senderID)
	ctx := context.Background()

	// 第一次编辑成功，edit_count 变 1
	if _, err := repo.EditWithHistory(ctx, msgID,
		`{"text":"原始文本"}`, `{"text":"第二版"}`, 0, false, time.Now()); err != nil {
		t.Fatalf("first edit: %v", err)
	}

	// 再用 expectCount=0 提交（模拟并发下的过期读）→ 必须失败
	ok, err := repo.EditWithHistory(ctx, msgID,
		`{"text":"第二版"}`, `{"text":"第三版"}`, 0, false, time.Now())
	if err != nil {
		t.Fatalf("stale edit returned error: %v", err)
	}
	if ok {
		t.Fatal("stale expectCount ok = true, want false")
	}

	// 关键：整事务回滚，历史表不能留下 version=1 之外的行
	edits, err := repo.ListEdits(ctx, msgID)
	if err != nil {
		t.Fatalf("ListEdits: %v", err)
	}
	if len(edits) != 1 {
		t.Errorf("len(edits) = %d, want 1 (stale edit must not leave a row)", len(edits))
	}
}

func TestListEditsOrdersByVersionAsc(t *testing.T) {
	db := testutil.NewDB(t)
	repo := NewMessageRepository(db)
	convID, senderID := seedConvAndUser(t, db)
	msgID := seedEditableMessage(t, repo, convID, senderID)
	ctx := context.Background()

	texts := []string{`{"text":"v2"}`, `{"text":"v3"}`, `{"text":"v4"}`}
	prev := `{"text":"原始文本"}`
	for i, next := range texts {
		if _, err := repo.EditWithHistory(ctx, msgID, prev, next, int16(i), false, time.Now()); err != nil {
			t.Fatalf("edit %d: %v", i, err)
		}
		prev = next
	}

	edits, err := repo.ListEdits(ctx, msgID)
	if err != nil {
		t.Fatalf("ListEdits: %v", err)
	}
	if len(edits) != 3 {
		t.Fatalf("len(edits) = %d, want 3", len(edits))
	}
	for i, e := range edits {
		if e.Version != int16(i+1) {
			t.Errorf("edits[%d].Version = %d, want %d", i, e.Version, i+1)
		}
	}
}
