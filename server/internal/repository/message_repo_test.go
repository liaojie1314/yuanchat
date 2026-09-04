package repository

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
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

// mediaFixture 建群会话 + 一名成员，并按给定 (seq, type, status, content) 批量插消息。
// 返回会话 ID；调用方自行推进 cleared_before_seq 水位。
func mediaFixture(t *testing.T, db *gorm.DB, sender *model.User, rows []model.Message) uuid.UUID {
	t.Helper()
	conv := &model.Conversation{Type: model.ConversationTypeGroup, LastSeq: int64(len(rows))}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("create conv: %v", err)
	}
	t.Cleanup(func() {
		db.Exec(`DELETE FROM messages WHERE conversation_id = ?`, conv.ID)
		db.Exec(`DELETE FROM conversation_members WHERE conversation_id = ?`, conv.ID)
		db.Unscoped().Delete(conv)
	})
	if err := db.Create(&model.ConversationMember{ConversationID: conv.ID, UserID: sender.ID}).Error; err != nil {
		t.Fatalf("create member: %v", err)
	}
	for i := range rows {
		rows[i].ConversationID = conv.ID
		rows[i].SenderID = sender.ID
		if err := db.Create(&rows[i]).Error; err != nil {
			t.Fatalf("create msg seq=%d: %v", rows[i].Seq, err)
		}
	}
	return conv.ID
}

// mediaSeqs 提取结果的 seq 序列，便于断言顺序与集合。
func mediaSeqs(rows []MediaItemWithSender) []int64 {
	out := make([]int64, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.Seq)
	}
	return out
}

// TestListMediaFiltersByType 相册查询的三重过滤：类型白名单、撤回态、清空水位。
//
// 文本不在媒体类型内、撤回消息 content 已被置 '{}'（放行会渲染成空条目）、
// 水位以下的消息对本人不可见——三者任一漏掉都会让相册出现"点不开的格子"。
func TestListMediaFiltersByType(t *testing.T) {
	db := testDB(t)
	repo := NewMessageRepository(db)
	ctx := context.Background()
	sender := newTestUser(t, db, "media-sender")

	convID := mediaFixture(t, db, sender, []model.Message{
		// seq=1 贴纸：在水位以下，应被排除
		{Seq: 1, MessageType: model.MessageTypeSticker, Status: model.MessageStatusNormal,
			Content: `{"sticker_id":"44444444-4444-4444-8444-444444444444","key":"images/2026/09/s1.png","width":96,"height":96}`},
		// seq=2 文本：类型不在白名单，应被排除
		{Seq: 2, MessageType: model.MessageTypeText, Status: model.MessageStatusNormal,
			Content: `{"text":"聊天记录里的文字不进相册"}`},
		// seq=3 图片：命中
		{Seq: 3, MessageType: model.MessageTypeImage, Status: model.MessageStatusNormal,
			Content: `{"key":"images/2026/09/a.png","width":800,"height":600,"size":1234}`},
		// seq=4 语音但已撤回：应被排除
		{Seq: 4, MessageType: model.MessageTypeVoice, Status: model.MessageStatusRevoked, Content: `{}`},
		// seq=5 视频：命中
		{Seq: 5, MessageType: model.MessageTypeVideo, Status: model.MessageStatusNormal,
			Content: `{"key":"files/2026/09/v.mp4","thumb_key":"images/2026/09/t.jpg","name":"demo.mp4","size":2048000,"duration":15,"width":1280,"height":720}`},
		// seq=6 贴纸（水位以上）：命中，证明 sticker 类型本身在白名单内
		{Seq: 6, MessageType: model.MessageTypeSticker, Status: model.MessageStatusNormal,
			Content: `{"sticker_id":"44444444-4444-4444-8444-444444444445","key":"images/2026/09/s2.png","width":96,"height":96}`},
	})

	allTypes := []int16{
		model.MessageTypeImage, model.MessageTypeFile, model.MessageTypeVoice,
		model.MessageTypeVideo, model.MessageTypeSticker,
	}

	// minSeq=1：seq=1 的贴纸被清空水位挡住
	rows, err := repo.ListMedia(ctx, convID, allTypes, 0, 1, 30)
	if err != nil {
		t.Fatalf("ListMedia: %v", err)
	}
	if got := mediaSeqs(rows); !reflect.DeepEqual(got, []int64{6, 5, 3}) {
		t.Fatalf("seq 序列 = %v, want [6 5 3]（seq 降序，排除文本/撤回/水位以下）", got)
	}
	// 署名与内容必须随行返回（相册要显示"谁发的"并据 content 渲染缩略图）
	if rows[0].SenderNickname != sender.Nickname {
		t.Fatalf("sender_nickname = %q, want %q", rows[0].SenderNickname, sender.Nickname)
	}
	if rows[1].MessageType != model.MessageTypeVideo {
		t.Fatalf("seq=5 应为 video(%d)，got %d", model.MessageTypeVideo, rows[1].MessageType)
	}
	if !strings.Contains(rows[1].Content, "thumb_key") {
		t.Fatalf("video content 未随行返回 thumb_key: %s", rows[1].Content)
	}

	// 单类型过滤：只要视频
	rows, err = repo.ListMedia(ctx, convID, []int16{model.MessageTypeVideo}, 0, 1, 30)
	if err != nil {
		t.Fatalf("ListMedia(video): %v", err)
	}
	if got := mediaSeqs(rows); !reflect.DeepEqual(got, []int64{5}) {
		t.Fatalf("video 过滤 = %v, want [5]", got)
	}

	// 游标：beforeSeq=5 只回更早的（seq<5），撤回与水位以下仍被排除
	rows, err = repo.ListMedia(ctx, convID, allTypes, 5, 1, 30)
	if err != nil {
		t.Fatalf("ListMedia(cursor): %v", err)
	}
	if got := mediaSeqs(rows); !reflect.DeepEqual(got, []int64{3}) {
		t.Fatalf("beforeSeq=5 → %v, want [3]", got)
	}

	// limit 生效：满页只回最新一条
	rows, err = repo.ListMedia(ctx, convID, allTypes, 0, 1, 1)
	if err != nil {
		t.Fatalf("ListMedia(limit): %v", err)
	}
	if got := mediaSeqs(rows); !reflect.DeepEqual(got, []int64{6}) {
		t.Fatalf("limit=1 → %v, want [6]", got)
	}

	// 水位=0（未清空）时 seq=1 的贴纸重新可见
	rows, err = repo.ListMedia(ctx, convID, allTypes, 0, 0, 30)
	if err != nil {
		t.Fatalf("ListMedia(minSeq=0): %v", err)
	}
	if got := mediaSeqs(rows); !reflect.DeepEqual(got, []int64{6, 5, 3, 1}) {
		t.Fatalf("minSeq=0 → %v, want [6 5 3 1]", got)
	}
}

// TestListMediaEmptyForNoMatch 无匹配时回空切片（不 panic、不报错）；
// types 为空时不查库直接空——`IN ()` 在 Postgres 上是语法错误。
func TestListMediaEmptyForNoMatch(t *testing.T) {
	db := testDB(t)
	repo := NewMessageRepository(db)
	ctx := context.Background()
	sender := newTestUser(t, db, "media-empty")

	convID := mediaFixture(t, db, sender, []model.Message{
		{Seq: 1, MessageType: model.MessageTypeText, Status: model.MessageStatusNormal,
			Content: `{"text":"只有文本"}`},
	})

	rows, err := repo.ListMedia(ctx, convID, []int16{model.MessageTypeImage}, 0, 0, 30)
	if err != nil {
		t.Fatalf("ListMedia: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("无匹配应返回 0 条，got %d", len(rows))
	}

	rows, err = repo.ListMedia(ctx, convID, nil, 0, 0, 30)
	if err != nil {
		t.Fatalf("ListMedia(nil types): %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("types 为空应返回 0 条，got %d", len(rows))
	}
}
