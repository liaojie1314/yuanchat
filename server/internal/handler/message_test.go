package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"github.com/yuanchat/server/internal/service"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// newMediaEngine 把媒体相册端点挂到独立 gin 引擎上，以中间件模拟 AuthRequired
// 注入 user_id（真实链路由 middleware.AuthRequired 写入）。
// dispatcher 传 nil：Media 是只读端点，不推任何 WS 帧。
func newMediaEngine(db *gorm.DB, userID uuid.UUID) *gin.Engine {
	svc := service.NewMessageService(
		repository.NewMessageRepository(db),
		repository.NewConversationRepository(db),
		repository.NewUserRepository(db),
		repository.NewReactionRepository(db),
		repository.NewBlocklistRepository(db),
		zap.NewNop(),
	)
	h := NewMessageHandler(svc, nil, zap.NewNop())
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Next()
	})
	r.GET("/api/v1/conversations/:id/media", h.Media)
	return r
}

// getMedia 发一次相册请求，返回状态码与解析后的响应体。
func getMedia(t *testing.T, r *gin.Engine, target string) (int, apiResp) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var resp apiResp
	if w.Body.Len() > 0 {
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode response %q: %v", w.Body.String(), err)
		}
	}
	return w.Code, resp
}

// seedMediaConv 建群会话 + 单成员 + 三条媒体消息（image/video/sticker，seq 1..3）。
func seedMediaConv(t *testing.T, db *gorm.DB, member *model.User) uuid.UUID {
	t.Helper()
	conv := &model.Conversation{ID: uuid.New(), Type: model.ConversationTypeGroup, LastSeq: 3}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	if err := db.Create(&model.ConversationMember{
		ID: uuid.New(), ConversationID: conv.ID, UserID: member.ID,
	}).Error; err != nil {
		t.Fatalf("create member: %v", err)
	}
	rows := []model.Message{
		{Seq: 1, MessageType: model.MessageTypeImage, Status: model.MessageStatusNormal,
			Content: `{"key":"images/2026/09/a.png","width":800,"height":600,"size":1234}`},
		{Seq: 2, MessageType: model.MessageTypeVideo, Status: model.MessageStatusNormal,
			Content: `{"key":"files/2026/09/v.mp4","thumb_key":"images/2026/09/t.jpg","name":"demo.mp4","size":2048000,"duration":15,"width":1280,"height":720}`},
		{Seq: 3, MessageType: model.MessageTypeSticker, Status: model.MessageStatusNormal,
			Content: `{"sticker_id":"44444444-4444-4444-8444-444444444444","key":"images/2026/09/s.png","width":96,"height":96}`},
	}
	for i := range rows {
		rows[i].ConversationID = conv.ID
		rows[i].SenderID = member.ID
		if err := db.Create(&rows[i]).Error; err != nil {
			t.Fatalf("create message seq=%d: %v", rows[i].Seq, err)
		}
	}
	return conv.ID
}

// TestMediaSuccessShape 成功响应形状：data.items 为 seq 降序数组，
// 视频条目带 thumb_key/duration；has_more 由"是否满页"决定。
func TestMediaSuccessShape(t *testing.T) {
	db := packTestDB(t)
	member := newPackTestUser(t, db, "相册成员")
	convID := seedMediaConv(t, db, member)
	r := newMediaEngine(db, member.ID)

	code, resp := getMedia(t, r, fmt.Sprintf("/api/v1/conversations/%s/media", convID))
	if code != http.StatusOK {
		t.Fatalf("status = %d resp = %+v, want 200", code, resp)
	}
	items, ok := resp.Data["items"].([]any)
	if !ok {
		t.Fatalf("data.items 不是数组: %+v", resp.Data)
	}
	if len(items) != 3 {
		t.Fatalf("items 长度 = %d, want 3", len(items))
	}
	if hasMore, _ := resp.Data["has_more"].(bool); hasMore {
		t.Fatalf("未满页时 has_more 应为 false: %+v", resp.Data)
	}
	first, _ := items[0].(map[string]any)
	if first == nil {
		t.Fatalf("首条不是对象: %+v", items[0])
	}
	// seq 降序：首条是 sticker(seq=3)
	if seq, _ := first["seq"].(float64); seq != 3 {
		t.Fatalf("首条 seq = %v, want 3（seq 降序）", first["seq"])
	}
	if first["sticker_id"] != "44444444-4444-4444-8444-444444444444" {
		t.Fatalf("sticker 条目缺 sticker_id: %+v", first)
	}
	// 视频条目（seq=2）必须带缩略图与时长
	video, _ := items[1].(map[string]any)
	if video["thumb_key"] != "images/2026/09/t.jpg" {
		t.Fatalf("video 条目缺 thumb_key: %+v", video)
	}
	if d, _ := video["duration"].(float64); d != 15 {
		t.Fatalf("video duration = %v, want 15", video["duration"])
	}
	if video["sender_nickname"] != member.Nickname {
		t.Fatalf("sender_nickname = %v, want %q", video["sender_nickname"], member.Nickname)
	}

	// type 过滤透传到 service：只要视频
	code, resp = getMedia(t, r, fmt.Sprintf("/api/v1/conversations/%s/media?type=video", convID))
	if code != http.StatusOK {
		t.Fatalf("type=video status = %d resp = %+v", code, resp)
	}
	if items, _ := resp.Data["items"].([]any); len(items) != 1 {
		t.Fatalf("type=video items = %v, want 1 条", items)
	}

	// 满页 → has_more=true（limit=1 时恰好取满）
	code, resp = getMedia(t, r, fmt.Sprintf("/api/v1/conversations/%s/media?limit=1", convID))
	if code != http.StatusOK {
		t.Fatalf("limit=1 status = %d resp = %+v", code, resp)
	}
	if hasMore, _ := resp.Data["has_more"].(bool); !hasMore {
		t.Fatalf("满页时 has_more 应为 true: %+v", resp.Data)
	}

	// before_seq 游标透传：seq < 2 只剩图片
	code, resp = getMedia(t, r, fmt.Sprintf("/api/v1/conversations/%s/media?before_seq=2", convID))
	if code != http.StatusOK {
		t.Fatalf("before_seq status = %d resp = %+v", code, resp)
	}
	items, _ = resp.Data["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("before_seq=2 items = %v, want 1 条", items)
	}
	if first, _ := items[0].(map[string]any); first["key"] != "images/2026/09/a.png" {
		t.Fatalf("before_seq=2 首条 = %+v, want 图片条目", items[0])
	}
}

// TestMediaInvalidType 非白名单 type → 400（不是空结果，避免前端把拼错的参数当"没媒体"）。
func TestMediaInvalidType(t *testing.T) {
	db := packTestDB(t)
	member := newPackTestUser(t, db, "相册非法type")
	convID := seedMediaConv(t, db, member)
	r := newMediaEngine(db, member.ID)

	code, resp := getMedia(t, r, fmt.Sprintf("/api/v1/conversations/%s/media?type=bogus", convID))
	if code != http.StatusBadRequest {
		t.Fatalf("status = %d resp = %+v, want 400", code, resp)
	}
	if resp.Code != 400 {
		t.Fatalf("body code = %d, want 400", resp.Code)
	}
}

// TestMediaNonMemberForbidden 非成员 → 403（与 History 同口径）。
func TestMediaNonMemberForbidden(t *testing.T) {
	db := packTestDB(t)
	member := newPackTestUser(t, db, "相册成员b")
	outsider := newPackTestUser(t, db, "相册外人")
	convID := seedMediaConv(t, db, member)
	r := newMediaEngine(db, outsider.ID)

	code, resp := getMedia(t, r, fmt.Sprintf("/api/v1/conversations/%s/media", convID))
	if code != http.StatusForbidden {
		t.Fatalf("status = %d resp = %+v, want 403", code, resp)
	}
	if resp.Message != "not a conversation member" {
		t.Fatalf("message = %q, want \"not a conversation member\"", resp.Message)
	}
}

// TestMediaInvalidConversationID 会话 id 不是 UUID → 400。
func TestMediaInvalidConversationID(t *testing.T) {
	db := packTestDB(t)
	member := newPackTestUser(t, db, "相册坏id")
	r := newMediaEngine(db, member.ID)

	code, _ := getMedia(t, r, "/api/v1/conversations/not-a-uuid/media")
	if code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", code)
	}
}
