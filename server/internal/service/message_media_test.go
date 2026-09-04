package service

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
)

// newMediaConv 建群会话 + 成员，并按给定行插入消息（seq 由调用方指定）。
func newMediaConv(t *testing.T, db *gorm.DB, sender *model.User, rows []model.Message) uuid.UUID {
	t.Helper()
	conv := &model.Conversation{ID: uuid.New(), Type: model.ConversationTypeGroup, LastSeq: int64(len(rows))}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	if err := db.Create(&model.ConversationMember{
		ID: uuid.New(), ConversationID: conv.ID, UserID: sender.ID,
	}).Error; err != nil {
		t.Fatalf("create member: %v", err)
	}
	for i := range rows {
		rows[i].ConversationID = conv.ID
		rows[i].SenderID = sender.ID
		if err := db.Create(&rows[i]).Error; err != nil {
			t.Fatalf("create message seq=%d: %v", rows[i].Seq, err)
		}
	}
	return conv.ID
}

// mediaSeedRows 一个会话内覆盖全部媒体类型 + 一条文本（不该进相册）。
func mediaSeedRows() []model.Message {
	return []model.Message{
		{Seq: 1, MessageType: model.MessageTypeText, Status: model.MessageStatusNormal,
			Content: `{"text":"文本不进相册"}`},
		{Seq: 2, MessageType: model.MessageTypeImage, Status: model.MessageStatusNormal,
			Content: `{"key":"images/2026/09/a.png","width":800,"height":600,"size":1234}`},
		{Seq: 3, MessageType: model.MessageTypeFile, Status: model.MessageStatusNormal,
			Content: `{"key":"files/2026/09/r.pdf","name":"报告.pdf","size":4096}`},
		{Seq: 4, MessageType: model.MessageTypeVoice, Status: model.MessageStatusNormal,
			Content: `{"key":"files/2026/09/v.webm","duration":7,"size":88}`},
		{Seq: 5, MessageType: model.MessageTypeVideo, Status: model.MessageStatusNormal,
			Content: `{"key":"files/2026/09/v.mp4","thumb_key":"images/2026/09/t.jpg","name":"demo.mp4","size":2048000,"duration":15,"width":1280,"height":720}`},
		{Seq: 6, MessageType: model.MessageTypeSticker, Status: model.MessageStatusNormal,
			Content: `{"sticker_id":"44444444-4444-4444-8444-444444444444","key":"images/2026/09/s.png","width":96,"height":96}`},
	}
}

// TestGetMediaTypeMapping type 参数 → 消息类型集合的映射：
// all 覆盖 image/file/voice/video/sticker 五类（不含 text），单类型只回该类，
// 非白名单值报 ErrInvalidMediaType。
func TestGetMediaTypeMapping(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	ctx := context.Background()
	sender := newTestUser(t, db, "media-map")
	convID := newMediaConv(t, db, sender, mediaSeedRows())

	items, err := svc.GetMedia(ctx, sender.ID, convID, "all", 0, 30)
	if err != nil {
		t.Fatalf("GetMedia(all): %v", err)
	}
	if len(items) != 5 {
		t.Fatalf("all 应回 5 条媒体（排除 text），got %d: %+v", len(items), items)
	}
	gotTypes := make(map[int16]bool, len(items))
	for _, it := range items {
		gotTypes[it.MessageType] = true
	}
	for _, want := range []int16{
		model.MessageTypeImage, model.MessageTypeFile, model.MessageTypeVoice,
		model.MessageTypeVideo, model.MessageTypeSticker,
	} {
		if !gotTypes[want] {
			t.Fatalf("all 缺少 message_type=%d", want)
		}
	}
	if gotTypes[model.MessageTypeText] {
		t.Fatal("all 不得包含 text(1)")
	}
	// seq 降序
	for i := 1; i < len(items); i++ {
		if items[i-1].Seq <= items[i].Seq {
			t.Fatalf("结果非 seq 降序: %v", items)
		}
	}

	// 单类型：video → 仅 seq=5，且视频专属字段完整回填
	videos, err := svc.GetMedia(ctx, sender.ID, convID, "video", 0, 30)
	if err != nil {
		t.Fatalf("GetMedia(video): %v", err)
	}
	if len(videos) != 1 || videos[0].MessageType != model.MessageTypeVideo {
		t.Fatalf("video 过滤 = %+v, want 1 条 video", videos)
	}
	v := videos[0]
	if v.Key != "files/2026/09/v.mp4" || v.ThumbKey != "images/2026/09/t.jpg" ||
		v.Name != "demo.mp4" || v.Size != 2048000 || v.Duration != 15 ||
		v.Width != 1280 || v.Height != 720 {
		t.Fatalf("video 字段回填不全: %+v", v)
	}
	if v.SenderNickname != sender.Nickname {
		t.Fatalf("sender_nickname = %q, want %q", v.SenderNickname, sender.Nickname)
	}

	// 其余单类型各回 1 条，且类型正确
	for filter, wantType := range map[string]int16{
		"image":   model.MessageTypeImage,
		"file":    model.MessageTypeFile,
		"voice":   model.MessageTypeVoice,
		"sticker": model.MessageTypeSticker,
	} {
		got, err := svc.GetMedia(ctx, sender.ID, convID, filter, 0, 30)
		if err != nil {
			t.Fatalf("GetMedia(%s): %v", filter, err)
		}
		if len(got) != 1 || got[0].MessageType != wantType {
			t.Fatalf("%s 过滤 = %+v, want 1 条 type=%d", filter, got, wantType)
		}
	}

	// sticker 条目必须带上 sticker_id（前端据此取贴纸元数据）
	stickers, err := svc.GetMedia(ctx, sender.ID, convID, "sticker", 0, 30)
	if err != nil {
		t.Fatalf("GetMedia(sticker): %v", err)
	}
	if stickers[0].StickerID != "44444444-4444-4444-8444-444444444444" {
		t.Fatalf("sticker_id 未回填: %+v", stickers[0])
	}

	// 非法 type → ErrInvalidMediaType（不是空结果，避免前端把拼错的参数当"没有媒体"）
	for _, bad := range []string{"nonsense", "text", "system", "e2ee", ""} {
		if _, err := svc.GetMedia(ctx, sender.ID, convID, bad, 0, 30); !errors.Is(err, ErrInvalidMediaType) {
			t.Fatalf("GetMedia(%q) err = %v, want ErrInvalidMediaType", bad, err)
		}
	}
}

// TestGetMediaNonMember 非成员拉相册报 ErrNotMember（与 GetHistory 同口径）。
//
// 成员校验必须先于 type 校验之外的任何查询：相册会暴露对象 key，
// 而 key 是 download-url 授权的输入。
func TestGetMediaNonMember(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	ctx := context.Background()
	sender := newTestUser(t, db, "media-owner")
	outsider := newTestUser(t, db, "media-outsider")
	convID := newMediaConv(t, db, sender, mediaSeedRows())

	if _, err := svc.GetMedia(ctx, outsider.ID, convID, "all", 0, 30); !errors.Is(err, ErrNotMember) {
		t.Fatalf("非成员 err = %v, want ErrNotMember", err)
	}
	// 非成员即便传非法 type，也应先撞成员校验（不泄漏会话是否存在）
	if _, err := svc.GetMedia(ctx, outsider.ID, convID, "nonsense", 0, 30); !errors.Is(err, ErrNotMember) {
		t.Fatalf("非成员 + 非法 type err = %v, want ErrNotMember", err)
	}
}

// TestGetMediaClearedBeforeSeqAndCursor 清空水位与游标分页。
func TestGetMediaClearedBeforeSeqAndCursor(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	ctx := context.Background()
	sender := newTestUser(t, db, "media-clear")
	convID := newMediaConv(t, db, sender, mediaSeedRows())

	// 游标：只要 seq < 5 的媒体 → image(2)/file(3)/voice(4)
	page, err := svc.GetMedia(ctx, sender.ID, convID, "all", 5, 30)
	if err != nil {
		t.Fatalf("GetMedia(cursor): %v", err)
	}
	if len(page) != 3 || page[0].Seq != 4 {
		t.Fatalf("before_seq=5 → %d 条（首条 seq=%d），want 3 条且首条 seq=4", len(page), page[0].Seq)
	}

	// limit 生效：limit=2 只回两条最新
	page, err = svc.GetMedia(ctx, sender.ID, convID, "all", 0, 2)
	if err != nil {
		t.Fatalf("GetMedia(limit): %v", err)
	}
	if len(page) != 2 || page[0].Seq != 6 || page[1].Seq != 5 {
		t.Fatalf("limit=2 → %+v, want seq [6 5]", page)
	}

	// 清空水位推到 5：只剩 seq=6 的贴纸
	if err := db.Model(&model.ConversationMember{}).
		Where("conversation_id = ? AND user_id = ?", convID, sender.ID).
		Update("cleared_before_seq", 5).Error; err != nil {
		t.Fatalf("set cleared_before_seq: %v", err)
	}
	page, err = svc.GetMedia(ctx, sender.ID, convID, "all", 0, 30)
	if err != nil {
		t.Fatalf("GetMedia(cleared): %v", err)
	}
	if len(page) != 1 || page[0].Seq != 6 {
		t.Fatalf("cleared_before_seq=5 → %+v, want 仅 seq=6", page)
	}
}

// TestGetMediaSkipsRevokedAndDirtyContent 撤回消息不进相册；
// content 不是 JSON 对象的脏数据被跳过而非让整页失败。
func TestGetMediaSkipsRevokedAndDirtyContent(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	ctx := context.Background()
	sender := newTestUser(t, db, "media-dirty")

	convID := newMediaConv(t, db, sender, []model.Message{
		{Seq: 1, MessageType: model.MessageTypeImage, Status: model.MessageStatusNormal,
			Content: `{"key":"images/2026/09/keep.png","width":10,"height":10,"size":1}`},
		// 撤回：content 已被置 '{}'，放行会渲染成点不开的空格子
		{Seq: 2, MessageType: model.MessageTypeVideo, Status: model.MessageStatusRevoked, Content: `{}`},
		// 脏数据：合法 jsonb 但不是对象，反序列化进 map 会失败
		{Seq: 3, MessageType: model.MessageTypeImage, Status: model.MessageStatusNormal,
			Content: `[]`},
	})

	items, err := svc.GetMedia(ctx, sender.ID, convID, "all", 0, 30)
	if err != nil {
		t.Fatalf("GetMedia: %v", err)
	}
	if len(items) != 1 || items[0].Seq != 1 {
		t.Fatalf("撤回与脏数据都应被跳过，got %+v", items)
	}
	if items[0].Key != "images/2026/09/keep.png" {
		t.Fatalf("key 未回填: %+v", items[0])
	}
}
