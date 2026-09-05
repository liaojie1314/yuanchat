package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
)

// editFixture 消息编辑用例的公共夹具：一个单聊会话 + 发送者 + 同会话另一成员 +
// 非成员，以及一条发送者刚发出的 normal 文本消息（seq=1，正文「原始文本」）。
type editFixture struct {
	db         *gorm.DB
	svc        *MessageService
	convID     uuid.UUID
	msgID      uuid.UUID
	msgSeq     int64
	senderID   uuid.UUID
	otherID    uuid.UUID
	strangerID uuid.UUID
}

// newEditFixture 播种编辑用例所需的会话/成员/消息，句柄为用例级事务（结束回滚）。
func newEditFixture(t *testing.T) *editFixture {
	t.Helper()
	db := testDB(t)
	sender := newTestUser(t, db, "edit-sender")
	other := newTestUser(t, db, "edit-other")
	stranger := newTestUser(t, db, "edit-stranger-x")

	conv := &model.Conversation{ID: uuid.New(), Type: model.ConversationTypePrivate, LastSeq: 1}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	// stranger 刻意不入会话，用于校验历史可见性闸门
	for _, u := range []*model.User{sender, other} {
		if err := db.Create(&model.ConversationMember{
			ID: uuid.New(), ConversationID: conv.ID, UserID: u.ID,
		}).Error; err != nil {
			t.Fatalf("create member: %v", err)
		}
	}
	msg := &model.Message{
		ID:             uuid.New(),
		ConversationID: conv.ID,
		SenderID:       sender.ID,
		Seq:            1,
		MessageType:    model.MessageTypeText,
		Content:        `{"text":"原始文本"}`,
		Status:         model.MessageStatusNormal,
	}
	if err := db.Create(msg).Error; err != nil {
		t.Fatalf("create message: %v", err)
	}

	return &editFixture{
		db:         db,
		svc:        newMessageSvc(db),
		convID:     conv.ID,
		msgID:      msg.ID,
		msgSeq:     msg.Seq,
		senderID:   sender.ID,
		otherID:    other.ID,
		strangerID: stranger.ID,
	}
}

// backdateMessage 把消息创建时间往前挪 d，用于跨越可编辑时间窗口。
func (f *editFixture) backdateMessage(t *testing.T, d time.Duration) {
	t.Helper()
	if err := f.db.Model(&model.Message{}).Where("id = ?", f.msgID).
		Update("created_at", time.Now().Add(-d)).Error; err != nil {
		t.Fatalf("backdate message: %v", err)
	}
}

// setEditCount 直接改累计编辑次数，用于逼近次数上限闸门。
func (f *editFixture) setEditCount(t *testing.T, n int16) {
	t.Helper()
	if err := f.db.Model(&model.Message{}).Where("id = ?", f.msgID).
		Update("edit_count", n).Error; err != nil {
		t.Fatalf("set edit_count: %v", err)
	}
}

// setMessageType 改消息类型，用于逐类型验证不可编辑闸门。
func (f *editFixture) setMessageType(t *testing.T, mt int16) {
	t.Helper()
	if err := f.db.Model(&model.Message{}).Where("id = ?", f.msgID).
		Update("message_type", mt).Error; err != nil {
		t.Fatalf("set message_type: %v", err)
	}
}

// clearHistoryFor 把指定成员的清空水位推到消息 seq 之上（等价于单侧清空聊天记录）。
func (f *editFixture) clearHistoryFor(t *testing.T, userID uuid.UUID) {
	t.Helper()
	if err := f.db.Model(&model.ConversationMember{}).
		Where("conversation_id = ? AND user_id = ?", f.convID, userID).
		Update("cleared_before_seq", f.msgSeq).Error; err != nil {
		t.Fatalf("clear history: %v", err)
	}
}

func TestEditUpdatesContentAndWritesHistory(t *testing.T) {
	f := newEditFixture(t)
	res, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, "改后文本")
	if err != nil {
		t.Fatalf("Edit: %v", err)
	}
	if res.Text != "改后文本" {
		t.Errorf("res.Text = %q, want 改后文本", res.Text)
	}
	if res.Message.EditCount != 1 {
		t.Errorf("EditCount = %d, want 1", res.Message.EditCount)
	}
	if res.Message.EditedAt == nil {
		t.Error("EditedAt = nil, want non-nil")
	}
	if len(res.MemberIDs) == 0 {
		t.Error("MemberIDs empty, want conversation members for broadcast")
	}

	versions, err := f.svc.EditHistory(context.Background(), f.senderID, f.msgID)
	if err != nil {
		t.Fatalf("EditHistory: %v", err)
	}
	if len(versions) != 2 {
		t.Fatalf("len(versions) = %d, want 2 (1 history + current)", len(versions))
	}
	if versions[0].Text != "原始文本" || versions[0].Version != 1 {
		t.Errorf("versions[0] = %+v, want v1 原始文本", versions[0])
	}
	if versions[1].Text != "改后文本" || !versions[1].Current {
		t.Errorf("versions[1] = %+v, want current 改后文本", versions[1])
	}
}

func TestEditRejectsNonSender(t *testing.T) {
	f := newEditFixture(t)
	_, err := f.svc.Edit(context.Background(), f.otherID, f.msgID, "别人改")
	if !errors.Is(err, ErrNotSender) {
		t.Errorf("err = %v, want ErrNotSender", err)
	}
}

func TestEditRejectsExpiredWindow(t *testing.T) {
	f := newEditFixture(t)
	// 把 created_at 推回窗口之外
	f.backdateMessage(t, EditWindow+time.Minute)
	_, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, "太晚了")
	if !errors.Is(err, ErrEditWindowExpired) {
		t.Errorf("err = %v, want ErrEditWindowExpired", err)
	}
}

func TestEditRejectsOverLimit(t *testing.T) {
	f := newEditFixture(t)
	f.setEditCount(t, MaxEditCount)
	_, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, "第 21 次")
	if !errors.Is(err, ErrEditLimitExceeded) {
		t.Errorf("err = %v, want ErrEditLimitExceeded", err)
	}
}

// TestEditRejectsNonTextTypes 逐类型验证不可编辑闸门。
// image/file/voice/video 无 caption 字段可改，sticker 无文字，
// system 非用户产出，E2EE 服务端无明文。
func TestEditRejectsNonTextTypes(t *testing.T) {
	types := map[string]int16{
		"image":   model.MessageTypeImage,
		"file":    model.MessageTypeFile,
		"voice":   model.MessageTypeVoice,
		"video":   model.MessageTypeVideo,
		"system":  model.MessageTypeSystem,
		"e2ee":    model.MessageTypeE2EE,
		"sticker": model.MessageTypeSticker,
	}
	for name, mt := range types {
		t.Run(name, func(t *testing.T) {
			f := newEditFixture(t)
			f.setMessageType(t, mt)
			_, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, "试图编辑")
			if !errors.Is(err, ErrNotEditable) {
				t.Errorf("%s: err = %v, want ErrNotEditable", name, err)
			}
		})
	}
}

func TestEditRejectsRecalledMessage(t *testing.T) {
	f := newEditFixture(t)
	if _, err := f.svc.Recall(context.Background(), f.senderID, f.msgID); err != nil {
		t.Fatalf("Recall: %v", err)
	}
	_, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, "撤回后改")
	if !errors.Is(err, ErrNotEditable) {
		t.Errorf("err = %v, want ErrNotEditable", err)
	}
}

// TestEditRejectsUnchangedText 相同文本直接拒绝，且不留历史、不改计数 ——
// 否则用户反复保存会刷出一串无意义版本。
func TestEditRejectsUnchangedText(t *testing.T) {
	f := newEditFixture(t)
	_, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, "原始文本")
	if !errors.Is(err, ErrEditNoChange) {
		t.Fatalf("err = %v, want ErrEditNoChange", err)
	}
	versions, err := f.svc.EditHistory(context.Background(), f.senderID, f.msgID)
	if err != nil {
		t.Fatalf("EditHistory: %v", err)
	}
	if len(versions) != 1 {
		t.Errorf("len(versions) = %d, want 1 (current only, no history row)", len(versions))
	}
}

func TestEditRejectsEmptyText(t *testing.T) {
	f := newEditFixture(t)
	for _, empty := range []string{"", "   ", "\n\t"} {
		if _, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, empty); err == nil {
			t.Errorf("Edit(%q) err = nil, want rejection", empty)
		}
	}
}

// TestEditFlagsModeratedText 是本批最关键的一条：
// 若编辑不走审核，「先发干净文本 → 编辑成敏感词」可完全绕过内容审核。
func TestEditFlagsModeratedText(t *testing.T) {
	f := newEditFixture(t)
	f.svc.SetModeration(NewModerationService([]string{"违规词"}))

	res, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, "这里有违规词出现")
	if err != nil {
		t.Fatalf("Edit: %v", err)
	}
	if !res.Message.Flagged {
		t.Error("Flagged = false, want true — 编辑成敏感词必须进审核队列")
	}
	// DB 真状态同样要落 flagged，否则 admin 审核队列查不到
	var row model.Message
	if err := f.db.First(&row, "id = ?", f.msgID).Error; err != nil {
		t.Fatalf("reload message: %v", err)
	}
	if !row.Flagged {
		t.Error("DB flagged = false, want true")
	}
}

// TestEditKeepsFlaggedWhenCleaned 编辑成干净文本不清除既有 flagged：
// 清标是 admin 的动作，用户不能自助洗白。
func TestEditKeepsFlaggedWhenCleaned(t *testing.T) {
	f := newEditFixture(t)
	f.svc.SetModeration(NewModerationService([]string{"违规词"}))

	if _, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, "含违规词的版本"); err != nil {
		t.Fatalf("first edit: %v", err)
	}
	res, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, "洗白成干净文本")
	if err != nil {
		t.Fatalf("second edit: %v", err)
	}
	if !res.Message.Flagged {
		t.Error("Flagged = false, want true — 用户不能通过再编辑自助清标")
	}
}

// TestEditExtractionKeepsSendModeration 抽出 textHitsModeration 后，发送路径的
// 打标行为必须不变。仓内原本没有任何 MessageService 发送 + 审核的用例，
// 抽取的等价性无测试兜住，这条补上。
func TestEditExtractionKeepsSendModeration(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	svc.SetModeration(NewModerationService([]string{"违规词"}))
	a := newTestUser(t, db, "send-mod-a")
	b := newTestUser(t, db, "send-mod-b")
	convID := newSendConv(t, db, a, b)
	ctx := context.Background()

	hit, err := svc.SendText(ctx, a.ID, convID, "带违规词的消息", "c-mod-1", nil)
	if err != nil {
		t.Fatalf("send flagged text: %v", err)
	}
	if !hit.Message.Flagged {
		t.Error("命中敏感词的发送 Flagged = false, want true")
	}

	clean, err := svc.SendText(ctx, a.ID, convID, "干净的消息", "c-mod-2", nil)
	if err != nil {
		t.Fatalf("send clean text: %v", err)
	}
	if clean.Message.Flagged {
		t.Error("未命中的发送 Flagged = true, want false")
	}

	// 非文本类型不进审核（沿用既有口径）：content 里带敏感词也不打标
	img, err := svc.SendContent(ctx, a.ID, convID, model.MessageTypeImage,
		`{"key":"images/违规词.png","width":1,"height":1,"size":1}`, "c-mod-3", nil, nil)
	if err != nil {
		t.Fatalf("send image: %v", err)
	}
	if img.Message.Flagged {
		t.Error("图片消息 Flagged = true, want false（审核仅对文本生效）")
	}
}

func TestEditHistoryRejectsNonMember(t *testing.T) {
	f := newEditFixture(t)
	if _, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, "改一版"); err != nil {
		t.Fatalf("Edit: %v", err)
	}
	_, err := f.svc.EditHistory(context.Background(), f.strangerID, f.msgID)
	if !errors.Is(err, ErrNotMember) {
		t.Errorf("err = %v, want ErrNotMember", err)
	}
}

// TestEditHistoryRespectsClearedWatermark 清空聊天记录后水位以下的消息
// 历史同样不可见（与 GetHistory 完全一致的可见性口径）。
func TestEditHistoryRespectsClearedWatermark(t *testing.T) {
	f := newEditFixture(t)
	if _, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, "改一版"); err != nil {
		t.Fatalf("Edit: %v", err)
	}
	f.clearHistoryFor(t, f.senderID)
	_, err := f.svc.EditHistory(context.Background(), f.senderID, f.msgID)
	if err == nil {
		t.Error("err = nil, want rejection for message below cleared watermark")
	}
}

// TestEditHistoryForAdminSkipsMembership admin 取证不受成员身份限制。
func TestEditHistoryForAdminSkipsMembership(t *testing.T) {
	f := newEditFixture(t)
	if _, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, "改一版"); err != nil {
		t.Fatalf("Edit: %v", err)
	}
	versions, err := f.svc.EditHistoryForAdmin(context.Background(), f.msgID)
	if err != nil {
		t.Fatalf("EditHistoryForAdmin: %v", err)
	}
	if len(versions) != 2 {
		t.Errorf("len(versions) = %d, want 2", len(versions))
	}
}

// TestEditUpdatesSearchIndex 编辑后新文本可搜到、旧文本搜不到。
// idx_messages_text_trgm 是表达式 + partial 索引，UPDATE content 时
// Postgres 自动重算 GIN 条目 —— 本测试钉住这个前提，避免将来
// 有人误加「编辑后需 REINDEX」的多余逻辑。
func TestEditUpdatesSearchIndex(t *testing.T) {
	f := newEditFixture(t)
	ctx := context.Background()
	if _, err := f.svc.Edit(ctx, f.senderID, f.msgID, "编辑后的独特关键词"); err != nil {
		t.Fatalf("Edit: %v", err)
	}

	hits, _, err := f.svc.Search(ctx, f.senderID, "独特关键词", "", "", 10)
	if err != nil {
		t.Fatalf("Search new text: %v", err)
	}
	if len(hits) == 0 {
		t.Error("搜新文本命中 0 条，want ≥1")
	}

	stale, _, err := f.svc.Search(ctx, f.senderID, "原始文本", "", "", 10)
	if err != nil {
		t.Fatalf("Search old text: %v", err)
	}
	for _, h := range stale {
		if h.MessageID == f.msgID {
			t.Error("旧文本仍能搜到被编辑的消息，索引未跟随")
		}
	}
}
