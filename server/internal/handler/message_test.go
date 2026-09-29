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

// newHistoryEngine 把消息历史端点挂到独立 gin 引擎上，以中间件注入 user_id。
// dispatcher 传 nil：History 是只读端点，不推任何 WS 帧。
func newHistoryEngine(db *gorm.DB, userID uuid.UUID) *gin.Engine {
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
	r.GET("/api/v1/conversations/:id/messages", h.History)
	return r
}

// historyPage 历史响应的最小形状，只取断言需要的字段。
type historyPage struct {
	Data struct {
		Messages []struct {
			Seq int64 `json:"seq"`
		} `json:"messages"`
		HasMore bool `json:"has_more"`
	} `json:"data"`
}

// getHistory 发一次历史请求，返回状态码与解析后的分页体。
func getHistory(t *testing.T, r *gin.Engine, target string) (int, historyPage) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var page historyPage
	if w.Body.Len() > 0 {
		if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
			t.Fatalf("decode response %q: %v", w.Body.String(), err)
		}
	}
	return w.Code, page
}

// seedHistoryConv 建群会话 + 单成员 + 五条文本消息（seq 1..5）。
func seedHistoryConv(t *testing.T, db *gorm.DB, member *model.User) uuid.UUID {
	t.Helper()
	conv := &model.Conversation{ID: uuid.New(), Type: model.ConversationTypeGroup, LastSeq: 5}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	if err := db.Create(&model.ConversationMember{
		ID: uuid.New(), ConversationID: conv.ID, UserID: member.ID,
	}).Error; err != nil {
		t.Fatalf("create member: %v", err)
	}
	for seq := int64(1); seq <= 5; seq++ {
		msg := &model.Message{
			ConversationID: conv.ID,
			SenderID:       member.ID,
			Seq:            seq,
			MessageType:    model.MessageTypeText,
			Status:         model.MessageStatusNormal,
			Content:        fmt.Sprintf(`{"text":"m%d"}`, seq),
		}
		if err := db.Create(msg).Error; err != nil {
			t.Fatalf("create message seq=%d: %v", seq, err)
		}
	}
	return conv.ID
}

// TestHistoryAfterSeq 增量补齐端点：互斥校验、limit 夹取、空结果语义、越权拦截。
func TestHistoryAfterSeq(t *testing.T) {
	db := packTestDB(t)
	member := newPackTestUser(t, db, "历史成员")
	convID := seedHistoryConv(t, db, member)
	r := newHistoryEngine(db, member.ID)
	base := "/api/v1/conversations/" + convID.String() + "/messages"

	t.Run("after_seq 升序返回并带 has_more", func(t *testing.T) {
		code, page := getHistory(t, r, base+"?after_seq=2&limit=2")
		if code != http.StatusOK {
			t.Fatalf("want 200, got %d", code)
		}
		if len(page.Data.Messages) != 2 || page.Data.Messages[0].Seq != 3 || page.Data.Messages[1].Seq != 4 {
			t.Fatalf("want ascending [3 4], got %+v", page.Data.Messages)
		}
		if !page.Data.HasMore {
			t.Fatal("满页应报 has_more=true")
		}
	})

	// Review Focus 2：游标等于最新 seq 时必须回空数组 + has_more=false
	t.Run("after_seq 等于最新 seq 回空数组且 has_more=false", func(t *testing.T) {
		code, page := getHistory(t, r, base+"?after_seq=5")
		if code != http.StatusOK {
			t.Fatalf("want 200, got %d", code)
		}
		if len(page.Data.Messages) != 0 {
			t.Fatalf("want empty messages, got %d", len(page.Data.Messages))
		}
		if page.Data.HasMore {
			t.Fatal("空结果不能报 has_more=true")
		}
	})

	t.Run("after_seq=0 走升序分支从头补（不能落回 before_seq 降序）", func(t *testing.T) {
		code, page := getHistory(t, r, base+"?after_seq=0&limit=2")
		if code != http.StatusOK {
			t.Fatalf("want 200, got %d", code)
		}
		if len(page.Data.Messages) != 2 || page.Data.Messages[0].Seq != 1 {
			t.Fatalf("want ascending from seq 1, got %+v", page.Data.Messages)
		}
	})

	t.Run("两个游标同时给按 400 拒绝，不静默取其一", func(t *testing.T) {
		code, _ := getHistory(t, r, base+"?after_seq=1&before_seq=4")
		if code != http.StatusBadRequest {
			t.Fatalf("want 400, got %d", code)
		}
	})

	t.Run("limit 超上限回落到 30", func(t *testing.T) {
		code, page := getHistory(t, r, base+"?after_seq=0&limit=999")
		if code != http.StatusOK {
			t.Fatalf("want 200, got %d", code)
		}
		// 只有 5 条种子消息：回落到 30 后能全拿到，且不满页故 has_more=false
		if len(page.Data.Messages) != 5 || page.Data.HasMore {
			t.Fatalf("want 5 messages without has_more, got %d/%v", len(page.Data.Messages), page.Data.HasMore)
		}
	})

	t.Run("非成员 403", func(t *testing.T) {
		outsider := newPackTestUser(t, db, "局外人")
		code, _ := getHistory(t, newHistoryEngine(db, outsider.ID), base+"?after_seq=0")
		if code != http.StatusForbidden {
			t.Fatalf("want 403, got %d", code)
		}
	})
}
