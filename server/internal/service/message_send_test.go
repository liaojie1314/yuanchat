package service

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
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
	result, err := svc.SendContent(context.Background(), a.ID, convID, model.MessageTypeImage, imgJSON, "c-img", nil, nil)
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
		model.MessageTypeImage, `{"key":"images/2026/07/x.png","width":1,"height":1,"size":1}`, "c-x", nil, nil)
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

// newSendGroup 建群 + 若干成员，返回会话 ID。
func newSendGroup(t *testing.T, db *gorm.DB, members ...*model.User) uuid.UUID {
	t.Helper()
	conv := &model.Conversation{ID: uuid.New(), Type: model.ConversationTypeGroup}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("create group: %v", err)
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

// TestSendWithValidMentions @群成员：mentions 落库 + mention_unread=true。
func TestSendWithValidMentions(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	a := newTestUser(t, db, "mt-a")
	b := newTestUser(t, db, "mt-b")
	c := newTestUser(t, db, "mt-c")
	convID := newSendGroup(t, db, a, b, c)

	content, _ := json.Marshal(model.MessageContentText{Text: "@b @c hi"})
	res, err := svc.SendContent(context.Background(), a.ID, convID,
		model.MessageTypeText, string(content), "c-mt-1", nil, []uuid.UUID{b.ID, c.ID})
	if err != nil {
		t.Fatalf("send with mentions: %v", err)
	}
	if len(res.MentionedMembers) != 2 {
		t.Fatalf("mentioned members: %v", res.MentionedMembers)
	}
	if len(res.Message.Mentions) != 2 {
		t.Fatalf("stored mentions: %v", res.Message.Mentions)
	}
	// B 与 C 的 mention_unread 都应为 true
	for _, uid := range []uuid.UUID{b.ID, c.ID} {
		var m model.ConversationMember
		db.First(&m, "conversation_id = ? AND user_id = ?", convID, uid)
		if !m.MentionUnread {
			t.Fatalf("user %s mention_unread not set", uid)
		}
	}
	// A（发送者）不应被 mark
	var self model.ConversationMember
	db.First(&self, "conversation_id = ? AND user_id = ?", convID, a.ID)
	if self.MentionUnread {
		t.Fatalf("sender mention_unread must remain false")
	}
}

// TestSendMention_RejectsOutsider @ 非群成员：ErrInvalidMention。
func TestSendMention_RejectsOutsider(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	a := newTestUser(t, db, "mt-r-a")
	b := newTestUser(t, db, "mt-r-b")
	outsider := newTestUser(t, db, "mt-r-out")
	convID := newSendGroup(t, db, a, b)

	content, _ := json.Marshal(model.MessageContentText{Text: "@out"})
	_, err := svc.SendContent(context.Background(), a.ID, convID,
		model.MessageTypeText, string(content), "c-mt-r-1", nil, []uuid.UUID{outsider.ID})
	if !errors.Is(err, ErrInvalidMention) {
		t.Fatalf("want ErrInvalidMention, got %v", err)
	}
}

// TestSendMention_RejectsPrivate 单聊不允许 @：ErrInvalidMention。
func TestSendMention_RejectsPrivate(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	a := newTestUser(t, db, "mt-p-a")
	b := newTestUser(t, db, "mt-p-b")
	convID := newSendConv(t, db, a, b)

	content, _ := json.Marshal(model.MessageContentText{Text: "@b"})
	_, err := svc.SendContent(context.Background(), a.ID, convID,
		model.MessageTypeText, string(content), "c-mt-p-1", nil, []uuid.UUID{b.ID})
	if !errors.Is(err, ErrInvalidMention) {
		t.Fatalf("want ErrInvalidMention, got %v", err)
	}
}

// TestMarkRead_ClearsMentionUnread 已读推进顺带清 mention_unread。
func TestMarkRead_ClearsMentionUnread(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	a := newTestUser(t, db, "mr-a")
	b := newTestUser(t, db, "mr-b")
	convID := newSendGroup(t, db, a, b)

	// A 发一条 @ B 的消息
	content, _ := json.Marshal(model.MessageContentText{Text: "@b"})
	res, err := svc.SendContent(context.Background(), a.ID, convID,
		model.MessageTypeText, string(content), "c-mr-1", nil, []uuid.UUID{b.ID})
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	// B 端 mention_unread 应为 true
	var before model.ConversationMember
	db.First(&before, "conversation_id = ? AND user_id = ?", convID, b.ID)
	if !before.MentionUnread {
		t.Fatal("mention_unread not set after mention")
	}
	// B 侧标记已读
	if _, err := svc.MarkRead(context.Background(), b.ID, convID, res.Message.Seq); err != nil {
		t.Fatalf("mark read: %v", err)
	}
	var after model.ConversationMember
	db.First(&after, "conversation_id = ? AND user_id = ?", convID, b.ID)
	if after.MentionUnread {
		t.Fatal("mention_unread not cleared by MarkRead")
	}
}

// TestSendWithValidQuote 引用同会话消息：落库 ReplyToID 有值。
func TestSendWithValidQuote(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	a := newTestUser(t, db, "qt-a")
	b := newTestUser(t, db, "qt-b")
	convID := newSendConv(t, db, a, b)

	first, err := svc.SendText(context.Background(), a.ID, convID, "first", "c-qt-1", nil)
	if err != nil {
		t.Fatalf("first msg: %v", err)
	}

	second, err := svc.SendText(context.Background(), b.ID, convID, "reply", "c-qt-2", &first.Message.ID)
	if err != nil {
		t.Fatalf("reply: %v", err)
	}
	if second.Message.ReplyToID == nil || *second.Message.ReplyToID != first.Message.ID {
		t.Fatalf("reply_to_id: %v", second.Message.ReplyToID)
	}
}

// TestSendQuote_RejectsCrossConversation 跨会话引用：ErrInvalidQuote。
func TestSendQuote_RejectsCrossConversation(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	a := newTestUser(t, db, "qtx-a")
	b := newTestUser(t, db, "qtx-b")
	conv1 := newSendConv(t, db, a, b)
	conv2 := newSendConv(t, db, a, b)

	first, err := svc.SendText(context.Background(), a.ID, conv1, "in conv1", "c-qtx-1", nil)
	if err != nil {
		t.Fatalf("first msg: %v", err)
	}
	_, err = svc.SendText(context.Background(), a.ID, conv2, "reply", "c-qtx-2", &first.Message.ID)
	if !errors.Is(err, ErrInvalidQuote) {
		t.Fatalf("want ErrInvalidQuote, got %v", err)
	}
}

// TestForward_MultiTarget 转发到 2 个会话：source 与两个 target 都是 actor 参与的会话。
func TestForward_MultiTarget(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	a := newTestUser(t, db, "fw-a")
	b := newTestUser(t, db, "fw-b")
	c := newTestUser(t, db, "fw-c")
	src := newSendConv(t, db, a, b)
	t1 := newSendConv(t, db, a, c)
	t2 := newSendGroup(t, db, a, b, c)

	sent, err := svc.SendText(context.Background(), a.ID, src, "hello world", "c-fw-src", nil)
	if err != nil {
		t.Fatalf("seed source: %v", err)
	}

	results, err := svc.Forward(context.Background(), a.ID, sent.Message.ID, []uuid.UUID{t1, t2})
	if err != nil {
		t.Fatalf("forward: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("results len: %d", len(results))
	}
	for _, r := range results {
		if r.Message.MessageType != model.MessageTypeText {
			t.Fatalf("copied type: %d", r.Message.MessageType)
		}
	}
}

// TestForward_RejectsNonMemberTarget actor 不在某个 target 会话：ErrForwardTargetInvalid。
func TestForward_RejectsNonMemberTarget(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	a := newTestUser(t, db, "fwn-a")
	b := newTestUser(t, db, "fwn-b")
	c := newTestUser(t, db, "fwn-c")
	src := newSendConv(t, db, a, b)
	otherConv := newSendConv(t, db, b, c) // A 不在

	sent, err := svc.SendText(context.Background(), a.ID, src, "x", "c-fwn-1", nil)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	_, err = svc.Forward(context.Background(), a.ID, sent.Message.ID, []uuid.UUID{otherConv})
	if !errors.Is(err, ErrForwardTargetInvalid) {
		t.Fatalf("want ErrForwardTargetInvalid, got %v", err)
	}
}

// TestForward_TooMany 超过 9 个目标：ErrForwardTooMany。
func TestForward_TooMany(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	a := newTestUser(t, db, "fwm-a")
	b := newTestUser(t, db, "fwm-b")
	src := newSendConv(t, db, a, b)

	sent, err := svc.SendText(context.Background(), a.ID, src, "x", "c-fwm-1", nil)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	ids := make([]uuid.UUID, 10)
	for i := range ids {
		ids[i] = uuid.New()
	}
	_, err = svc.Forward(context.Background(), a.ID, sent.Message.ID, ids)
	if !errors.Is(err, ErrForwardTooMany) {
		t.Fatalf("want ErrForwardTooMany, got %v", err)
	}
}

// TestForward_Sticker 贴纸可转发，且 message_type 与 content 原样复制。
//
// 类型保持不变是前端正确渲染的前提：曾经 handler 侧重建 content 时漏了 sticker
// 分支，导致目标会话实时收到空文本气泡（落库的行其实是对的，刷新即恢复）。
func TestForward_Sticker(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	a := newTestUser(t, db, "fwst-a")
	b := newTestUser(t, db, "fwst-b")
	c := newTestUser(t, db, "fwst-c")
	src := newSendConv(t, db, a, b)
	dst := newSendConv(t, db, a, c)

	content := `{"sticker_id":"` + uuid.New().String() + `","key":"images/2026/08/s.png","width":96,"height":96}`
	sent, err := svc.SendContent(context.Background(), a.ID, src, model.MessageTypeSticker, content, "c-fwst-1", nil, nil)
	if err != nil {
		t.Fatalf("seed sticker: %v", err)
	}

	results, err := svc.Forward(context.Background(), a.ID, sent.Message.ID, []uuid.UUID{dst})
	if err != nil {
		t.Fatalf("forward sticker: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("results len: %d", len(results))
	}
	if results[0].Message.MessageType != model.MessageTypeSticker {
		t.Fatalf("forwarded type should stay sticker, got %d", results[0].Message.MessageType)
	}
	// jsonb 列会重排键序与空白，故按语义比对而非字符串相等
	var want, got map[string]any
	if err := json.Unmarshal([]byte(content), &want); err != nil {
		t.Fatalf("unmarshal want: %v", err)
	}
	if err := json.Unmarshal([]byte(results[0].Message.Content), &got); err != nil {
		t.Fatalf("unmarshal got: %v", err)
	}
	if !reflect.DeepEqual(want, got) {
		t.Fatalf("forwarded content should be copied verbatim, want %v got %v", want, got)
	}
}

// TestForward_RejectsE2EE 端到端加密消息拒绝转发：密文换会话后无人能解，
// 转发成功只会在目标会话留下一条永久"无法解密"。
func TestForward_RejectsE2EE(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	a := newTestUser(t, db, "fwe-a")
	b := newTestUser(t, db, "fwe-b")
	c := newTestUser(t, db, "fwe-c")
	src := newSendConv(t, db, a, b)
	dst := newSendConv(t, db, a, c)

	content := `{"ratchet_key":"rk","n":0,"pn":0,"nonce":"nn","ciphertext":"cc"}`
	sent, err := svc.SendContent(context.Background(), a.ID, src, model.MessageTypeE2EE, content, "c-fwe-1", nil, nil)
	if err != nil {
		t.Fatalf("seed e2ee: %v", err)
	}
	if _, err := svc.Forward(context.Background(), a.ID, sent.Message.ID, []uuid.UUID{dst}); !errors.Is(err, ErrForwardEncrypted) {
		t.Fatalf("want ErrForwardEncrypted, got %v", err)
	}
	// 未落任何行到目标会话
	var n int64
	db.Model(&model.Message{}).Where("conversation_id = ?", dst).Count(&n)
	if n != 0 {
		t.Fatalf("target conversation should stay empty, got %d rows", n)
	}
}
