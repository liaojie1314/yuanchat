package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"gorm.io/gorm"
)

// newSendConv 建单聊会话 + 两成员，返回会话 ID（seq 从 0 起，由 CreateWithSeq 递增）。
func newSendConv(t *testing.T, db *gorm.DB, members ...*model.User) uuid.UUID {
	t.Helper()
	conv := &model.Conversation{ID: uuid.New(), Type: model.ConversationTypePrivate}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	for _, u := range members {
		if err := db.Create(&model.ConversationMember{
			ID: uuid.New(), ConversationID: conv.ID, UserID: u.ID,
		}).Error; err != nil {
			t.Fatalf("create member: %v", err)
		}
	}
	return conv.ID
}

// TestSendTextPersistsAndBroadcasts 证明 text 路径在 SendText→SendContent 重构后行为不变。
func TestSendTextPersistsAndBroadcasts(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	a := newTestUser(t, db, "send-text-a")
	b := newTestUser(t, db, "send-text-b")
	convID := newSendConv(t, db, a, b)

	result, err := svc.SendText(context.Background(), a.ID, convID, "你好", "c-1", nil)
	if err != nil {
		t.Fatalf("send text: %v", err)
	}
	if result.Message.MessageType != model.MessageTypeText {
		t.Fatalf("message type = %d, want text(%d)", result.Message.MessageType, model.MessageTypeText)
	}
	if result.Message.Seq != 1 {
		t.Fatalf("seq = %d, want 1", result.Message.Seq)
	}
	if result.SenderNickname != a.Nickname {
		t.Fatalf("sender nickname = %q, want %q", result.SenderNickname, a.Nickname)
	}
	if len(result.MemberIDs) != 2 {
		t.Fatalf("member ids = %d, want 2", len(result.MemberIDs))
	}

	// DB 真状态：content 为 {"text":"你好"}
	var row model.Message
	if err := db.First(&row, "id = ?", result.Message.ID).Error; err != nil {
		t.Fatalf("reload message: %v", err)
	}
	var content model.MessageContentText
	if err := json.Unmarshal([]byte(row.Content), &content); err != nil {
		t.Fatalf("content not valid json: %v", err)
	}
	if content.Text != "你好" {
		t.Fatalf("persisted text = %q, want 你好", content.Text)
	}
}

// TestSendContentImagePersistsAndBroadcasts image 落库携带 key/width/height/size 且往返一致。
func TestSendContentImagePersistsAndBroadcasts(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	a := newTestUser(t, db, "send-img-a")
	b := newTestUser(t, db, "send-img-b")
	convID := newSendConv(t, db, a, b)

	imgJSON := `{"key":"images/2026/07/abc.png","width":800,"height":600,"size":123456}`
	result, err := svc.SendContent(context.Background(), a.ID, convID, model.MessageTypeImage, imgJSON, "c-img", nil)
	if err != nil {
		t.Fatalf("send image: %v", err)
	}
	if result.Message.MessageType != model.MessageTypeImage {
		t.Fatalf("message type = %d, want image(%d)", result.Message.MessageType, model.MessageTypeImage)
	}
	if result.Message.Seq != 1 {
		t.Fatalf("seq = %d, want 1", result.Message.Seq)
	}
	if len(result.MemberIDs) != 2 {
		t.Fatalf("member ids = %d, want 2", len(result.MemberIDs))
	}

	// DB 真状态：图片元数据完整往返，供前端渲染 + 取下载 URL。
	var row model.Message
	if err := db.First(&row, "id = ?", result.Message.ID).Error; err != nil {
		t.Fatalf("reload message: %v", err)
	}
	var got struct {
		Key    string `json:"key"`
		Width  int    `json:"width"`
		Height int    `json:"height"`
		Size   int64  `json:"size"`
	}
	if err := json.Unmarshal([]byte(row.Content), &got); err != nil {
		t.Fatalf("content not valid json: %v", err)
	}
	if got.Key != "images/2026/07/abc.png" || got.Width != 800 || got.Height != 600 || got.Size != 123456 {
		t.Fatalf("image metadata did not round-trip: %+v", got)
	}
}

// TestSendContentRejectsNonMember 非成员发送被拒，且不落库。
func TestSendContentRejectsNonMember(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	a := newTestUser(t, db, "send-nm-a")
	b := newTestUser(t, db, "send-nm-b")
	outsider := newTestUser(t, db, "send-nm-out")
	convID := newSendConv(t, db, a, b)

	_, err := svc.SendContent(context.Background(), outsider.ID, convID,
		model.MessageTypeImage, `{"key":"images/2026/07/x.png","width":1,"height":1,"size":1}`, "c-x", nil)
	if !errors.Is(err, ErrNotMember) {
		t.Fatalf("expected ErrNotMember, got %v", err)
	}

	var count int64
	db.Model(&model.Message{}).Where("conversation_id = ?", convID).Count(&count)
	if count != 0 {
		t.Fatalf("non-member send must not persist, got %d rows", count)
	}
}

// TestSendPrivate_BlockedByReceiver 接收方拉黑发送者：单聊发送被拒且不落库。
func TestSendPrivate_BlockedByReceiver(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	blocklistRepo := repository.NewBlocklistRepository(db)
	a := newTestUser(t, db, "send-blk-a")
	b := newTestUser(t, db, "send-blk-b")
	convID := newSendConv(t, db, a, b)

	// B 拉黑 A → A 发给 B 应被拒
	if err := blocklistRepo.Block(context.Background(), b.ID, a.ID); err != nil {
		t.Fatalf("seed block: %v", err)
	}

	_, err := svc.SendText(context.Background(), a.ID, convID, "hello?", "c-blk-1", nil)
	if !errors.Is(err, ErrBlocked) {
		t.Fatalf("expected ErrBlocked, got %v", err)
	}

	var count int64
	db.Model(&model.Message{}).Where("conversation_id = ?", convID).Count(&count)
	if count != 0 {
		t.Fatalf("blocked send must not persist, got %d rows", count)
	}
}

// TestSendPrivate_SenderBlockedReceiver 发送方自己拉黑了接收方：同样拒绝（双向拦截）。
func TestSendPrivate_SenderBlockedReceiver(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	blocklistRepo := repository.NewBlocklistRepository(db)
	a := newTestUser(t, db, "send-blk2-a")
	b := newTestUser(t, db, "send-blk2-b")
	convID := newSendConv(t, db, a, b)

	// A 拉黑 B → A 发给 B 也应被拒（先解除拉黑才能聊）
	if err := blocklistRepo.Block(context.Background(), a.ID, b.ID); err != nil {
		t.Fatalf("seed block: %v", err)
	}

	_, err := svc.SendText(context.Background(), a.ID, convID, "hey", "c-blk-2", nil)
	if !errors.Is(err, ErrBlocked) {
		t.Fatalf("expected ErrBlocked, got %v", err)
	}
}

// TestSendGroup_NotAffectedByBlocklist 群聊不受 blocklist 拦截（成员间拉黑不阻断群消息）。
func TestSendGroup_NotAffectedByBlocklist(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	blocklistRepo := repository.NewBlocklistRepository(db)
	a := newTestUser(t, db, "send-grp-a")
	b := newTestUser(t, db, "send-grp-b")
	c := newTestUser(t, db, "send-grp-c")

	// 建 3 人群
	conv := &model.Conversation{ID: uuid.New(), Type: model.ConversationTypeGroup}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("create group: %v", err)
	}
	for _, u := range []*model.User{a, b, c} {
		if err := db.Create(&model.ConversationMember{
			ID: uuid.New(), ConversationID: conv.ID, UserID: u.ID,
		}).Error; err != nil {
			t.Fatalf("create member: %v", err)
		}
	}

	// B 拉黑 A，但群消息不拦截
	if err := blocklistRepo.Block(context.Background(), b.ID, a.ID); err != nil {
		t.Fatalf("seed block: %v", err)
	}

	result, err := svc.SendText(context.Background(), a.ID, conv.ID, "group msg", "c-grp-1", nil)
	if err != nil {
		t.Fatalf("group send should not be blocked: %v", err)
	}
	if len(result.MemberIDs) != 3 {
		t.Fatalf("expect 3 member ids, got %d", len(result.MemberIDs))
	}
}
