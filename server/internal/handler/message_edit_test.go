package handler

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"github.com/yuanchat/server/internal/service"
	"github.com/yuanchat/server/internal/ws"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// captureDispatcher 记录 handler 推出的 WS 帧，用于断言 message.edited 的组帧内容。
type captureDispatcher struct {
	frames  [][]byte
	targets [][]uuid.UUID
}

// SendToUsers 只记账不投递，满足 ws.Dispatcher 接口。
func (d *captureDispatcher) SendToUsers(userIDs []uuid.UUID, data []byte) {
	d.frames = append(d.frames, data)
	d.targets = append(d.targets, userIDs)
}

// editEnv 编辑端点用例的夹具：真实库上的单聊会话 + 发送者 + 同会话另一成员 +
// 一条发送者刚发的 normal 文本消息（seq=1，正文「原始文本」）；
// 端点挂在独立 gin 引擎上，以中间件模拟 AuthRequired 注入 user_id。
//
// 「当前登录身份」用 actor 字段切换（同 packRouterState 的做法）——
// handler 包既有用例一律不签真 token，这里保持一致。
type editEnv struct {
	db     *gorm.DB
	engine *gin.Engine
	disp   *captureDispatcher
	// svc 被测消息服务，admin 取证用例复用同一实例（同一夹具事务）
	svc    *service.MessageService
	convID uuid.UUID
	msgID  uuid.UUID
	// actor 中间件注入的当前用户 id，用例内可改以切换身份
	actor    uuid.UUID
	senderID uuid.UUID
	otherID  uuid.UUID
}

// newEditEnv 播种夹具并挂载编辑相关路由（注册顺序与 router.go 一致）。
func newEditEnv(t *testing.T) *editEnv {
	t.Helper()
	db := packTestDB(t)
	sender := newPackTestUser(t, db, "编辑发送者")
	other := newPackTestUser(t, db, "编辑同会话")

	conv := &model.Conversation{ID: uuid.New(), Type: model.ConversationTypePrivate, LastSeq: 1}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
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

	env := &editEnv{
		db:       db,
		disp:     &captureDispatcher{},
		convID:   conv.ID,
		msgID:    msg.ID,
		actor:    sender.ID,
		senderID: sender.ID,
		otherID:  other.ID,
	}

	svc := service.NewMessageService(
		repository.NewMessageRepository(db),
		repository.NewConversationRepository(db),
		repository.NewUserRepository(db),
		repository.NewReactionRepository(db),
		repository.NewBlocklistRepository(db),
		zap.NewNop(),
	)
	env.svc = svc
	h := NewMessageHandler(svc, env.disp, zap.NewNop())
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", env.actor)
		c.Next()
	})
	g := r.Group("/api/v1")
	// 与 router.go 同顺序注册：静态段 /messages/search 与参数段 /messages/:id
	// 是同层兄弟，gin 树若不接受这种混排会在此 panic
	g.GET("/messages/search", h.Search)
	g.PATCH("/messages/:id", h.Edit)
	g.GET("/messages/:id/edits", h.EditHistory)
	env.engine = r
	return env
}

// patch 以当前身份发一次编辑请求。
func (e *editEnv) patch(t *testing.T, target string, body any) (apiResp, int) {
	t.Helper()
	w, resp := doJSON(t, e.engine, http.MethodPatch, target, body)
	return resp, w.Code
}

// get 以当前身份发一次只读请求。
func (e *editEnv) get(t *testing.T, target string) (apiResp, int) {
	t.Helper()
	w, resp := doJSON(t, e.engine, http.MethodGet, target, nil)
	return resp, w.Code
}

// editURL 编辑端点地址。
func (e *editEnv) editURL() string { return "/api/v1/messages/" + e.msgID.String() }

// historyURL 编辑历史端点地址。
func (e *editEnv) historyURL() string { return e.editURL() + "/edits" }

// backdateMessage 把消息创建时间推到可编辑窗口之外。
func (e *editEnv) backdateMessage(t *testing.T) {
	t.Helper()
	if err := e.db.Model(&model.Message{}).Where("id = ?", e.msgID).
		Update("created_at", time.Now().Add(-service.EditWindow-time.Minute)).Error; err != nil {
		t.Fatalf("backdate message: %v", err)
	}
}

// setEditCount 直接改累计编辑次数，用于逼近次数上限闸门。
func (e *editEnv) setEditCount(t *testing.T, n int16) {
	t.Helper()
	if err := e.db.Model(&model.Message{}).Where("id = ?", e.msgID).
		Update("edit_count", n).Error; err != nil {
		t.Fatalf("set edit_count: %v", err)
	}
}

// setMessageTypeImage 把消息改成图片类型，用于验证不可编辑闸门。
func (e *editEnv) setMessageTypeImage(t *testing.T) {
	t.Helper()
	if err := e.db.Model(&model.Message{}).Where("id = ?", e.msgID).
		Update("message_type", model.MessageTypeImage).Error; err != nil {
		t.Fatalf("set message_type: %v", err)
	}
}

func TestEditEndpointSuccess(t *testing.T) {
	env := newEditEnv(t)
	resp, status := env.patch(t, env.editURL(), map[string]any{"text": "改后文本"})

	if status != http.StatusOK {
		t.Fatalf("status = %d resp = %+v, want 200", status, resp)
	}
	if resp.Code != 0 {
		t.Errorf("code = %d, want 0", resp.Code)
	}
	if resp.Data == nil {
		t.Fatal("data 缺失")
	}
	if cnt, _ := resp.Data["edit_count"].(float64); cnt != 1 {
		t.Errorf("edit_count = %v, want 1", resp.Data["edit_count"])
	}
	if _, ok := resp.Data["edited_at"].(string); !ok {
		t.Errorf("edited_at 缺失或非字符串: %v", resp.Data["edited_at"])
	}
}

// TestEditEndpointBroadcastsFrame 编辑成功必须向会话全员推 message.edited，
// 且帧内带新正文 —— 收件人据此就地更新气泡，无需回查。
func TestEditEndpointBroadcastsFrame(t *testing.T) {
	env := newEditEnv(t)
	if _, status := env.patch(t, env.editURL(),
		map[string]any{"text": "推送用文本"}); status != http.StatusOK {
		t.Fatalf("edit failed with %d", status)
	}
	if len(env.disp.frames) != 1 {
		t.Fatalf("推帧次数 = %d, want 1", len(env.disp.frames))
	}

	var frame struct {
		Type    string                  `json:"type"`
		Payload ws.MessageEditedPayload `json:"payload"`
	}
	if err := json.Unmarshal(env.disp.frames[0], &frame); err != nil {
		t.Fatalf("decode frame: %v", err)
	}
	if frame.Type != ws.TypeMessageEdited {
		t.Errorf("frame type = %q, want %q", frame.Type, ws.TypeMessageEdited)
	}
	if frame.Payload.Text != "推送用文本" {
		t.Errorf("payload.text = %q, want 推送用文本", frame.Payload.Text)
	}
	if frame.Payload.MessageID != env.msgID {
		t.Errorf("payload.message_id = %v, want %v", frame.Payload.MessageID, env.msgID)
	}
	if frame.Payload.ConversationID != env.convID {
		t.Errorf("payload.conversation_id = %v, want %v", frame.Payload.ConversationID, env.convID)
	}
	if frame.Payload.Seq != 1 {
		t.Errorf("payload.seq = %d, want 1", frame.Payload.Seq)
	}
	if frame.Payload.EditCount != 1 {
		t.Errorf("payload.edit_count = %d, want 1", frame.Payload.EditCount)
	}
	if frame.Payload.EditedAt.IsZero() {
		t.Error("payload.edited_at 为零值")
	}
	// 全员含操作者自己，实现多端同步
	if len(env.disp.targets[0]) != 2 {
		t.Errorf("推送目标数 = %d, want 2（会话全员含自己）", len(env.disp.targets[0]))
	}
}

// TestEditEndpointWindowExpired 超窗 → 403 + 业务码 4032
// （紧邻 recall 的 4031，前端按 code 而非 message 识别）。
func TestEditEndpointWindowExpired(t *testing.T) {
	env := newEditEnv(t)
	env.backdateMessage(t)
	resp, status := env.patch(t, env.editURL(), map[string]any{"text": "太晚了"})

	if status != http.StatusForbidden {
		t.Fatalf("status = %d resp = %+v, want 403", status, resp)
	}
	if resp.Code != 4032 {
		t.Errorf("code = %d, want 4032", resp.Code)
	}
}

// TestEditEndpointLimitExceeded 超次数 → 400 + 业务码 4033。
func TestEditEndpointLimitExceeded(t *testing.T) {
	env := newEditEnv(t)
	env.setEditCount(t, service.MaxEditCount)
	resp, status := env.patch(t, env.editURL(), map[string]any{"text": "第 21 次"})

	if status != http.StatusBadRequest {
		t.Fatalf("status = %d resp = %+v, want 400", status, resp)
	}
	if resp.Code != 4033 {
		t.Errorf("code = %d, want 4033", resp.Code)
	}
}

// TestEditEndpointNotEditable 非文本类型 → 400 + 业务码 4004。
func TestEditEndpointNotEditable(t *testing.T) {
	env := newEditEnv(t)
	env.setMessageTypeImage(t)
	resp, status := env.patch(t, env.editURL(), map[string]any{"text": "试图编辑图片"})

	if status != http.StatusBadRequest {
		t.Fatalf("status = %d resp = %+v, want 400", status, resp)
	}
	if resp.Code != 4004 {
		t.Errorf("code = %d, want 4004", resp.Code)
	}
}

// TestEditEndpointNoChange 文本未变 → 400 + 业务码 4004（与不可编辑同码，
// 前端一律提示「无需保存」），且失败路径绝不推帧。
func TestEditEndpointNoChange(t *testing.T) {
	env := newEditEnv(t)
	resp, status := env.patch(t, env.editURL(), map[string]any{"text": "原始文本"})

	if status != http.StatusBadRequest {
		t.Fatalf("status = %d resp = %+v, want 400", status, resp)
	}
	if resp.Code != 4004 {
		t.Errorf("code = %d, want 4004", resp.Code)
	}
	if len(env.disp.frames) != 0 {
		t.Errorf("失败路径推了 %d 帧, want 0", len(env.disp.frames))
	}
}

// TestEditEndpointTextTooLong 超长正文 → 400，且不得是 500。
//
// 服务层的 ErrEditTextTooLong 必须落在具体分支而不是 default：
// default 会返 500，前端把「文本太长」当服务器故障处理。
func TestEditEndpointTextTooLong(t *testing.T) {
	env := newEditEnv(t)
	long := make([]rune, service.MaxEditTextLen+1)
	for i := range long {
		long[i] = '长'
	}
	resp, status := env.patch(t, env.editURL(), map[string]any{"text": string(long)})

	if status != http.StatusBadRequest {
		t.Fatalf("status = %d resp = %+v, want 400", status, resp)
	}
	if resp.Code == 500 {
		t.Errorf("code = %d, 不应落到 default 分支", resp.Code)
	}
}

// TestEditEndpointEmptyText 空正文 → 400（binding required 前置拦截）。
func TestEditEndpointEmptyText(t *testing.T) {
	env := newEditEnv(t)
	_, status := env.patch(t, env.editURL(), map[string]any{"text": ""})
	if status != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", status)
	}
}

func TestEditEndpointNotSender(t *testing.T) {
	env := newEditEnv(t)
	env.actor = env.otherID
	_, status := env.patch(t, env.editURL(), map[string]any{"text": "别人改"})
	if status != http.StatusForbidden {
		t.Errorf("status = %d, want 403", status)
	}
}

func TestEditEndpointNotFound(t *testing.T) {
	env := newEditEnv(t)
	_, status := env.patch(t, "/api/v1/messages/11111111-1111-4111-8111-111111111111",
		map[string]any{"text": "不存在"})
	if status != http.StatusNotFound {
		t.Errorf("status = %d, want 404", status)
	}
}

// TestEditEndpointInvalidID 消息 id 不是 UUID → 400（不落到 service）。
func TestEditEndpointInvalidID(t *testing.T) {
	env := newEditEnv(t)
	_, status := env.patch(t, "/api/v1/messages/not-a-uuid", map[string]any{"text": "坏 id"})
	if status != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", status)
	}
}

func TestEditHistoryEndpointReturnsVersions(t *testing.T) {
	env := newEditEnv(t)
	if _, status := env.patch(t, env.editURL(),
		map[string]any{"text": "改后文本"}); status != http.StatusOK {
		t.Fatalf("edit failed with %d", status)
	}

	resp, status := env.get(t, env.historyURL())
	if status != http.StatusOK {
		t.Fatalf("status = %d resp = %+v, want 200", status, resp)
	}
	versions, _ := resp.Data["versions"].([]any)
	if len(versions) != 2 {
		t.Fatalf("len(versions) = %d, want 2", len(versions))
	}
	first, _ := versions[0].(map[string]any)
	if first["text"] != "原始文本" {
		t.Errorf("versions[0].text = %v, want 原始文本", first["text"])
	}
	last, _ := versions[1].(map[string]any)
	if cur, _ := last["current"].(bool); !cur {
		t.Error("末项 current != true")
	}
	if last["text"] != "改后文本" {
		t.Errorf("versions[1].text = %v, want 改后文本", last["text"])
	}
}

// TestEditedAtIsUTCEverywhere 同一次编辑的 edited_at 在 message.edited 帧与
// REST 编辑历史里必须是同一个字面量：都为 UTC、都截到微秒。
//
// 曾经不是：帧走内存里的 time.Now().UTC()（纳秒 Z），历史走库回读
// （微秒 +08:00）。两者 time.Equal 都不成立（纳秒尾数被库抹掉），
// 前端拿字符串做「这条是不是我刚收到的那次编辑」判重会一路判错。
func TestEditedAtIsUTCEverywhere(t *testing.T) {
	env := newEditEnv(t)
	if _, status := env.patch(t, env.editURL(),
		map[string]any{"text": "对时用文本"}); status != http.StatusOK {
		t.Fatalf("edit failed with %d", status)
	}

	var frame struct {
		Payload struct {
			EditedAt string `json:"edited_at"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(env.disp.frames[0], &frame); err != nil {
		t.Fatalf("decode frame: %v", err)
	}

	resp, status := env.get(t, env.historyURL())
	if status != http.StatusOK {
		t.Fatalf("history status = %d", status)
	}
	versions, _ := resp.Data["versions"].([]any)
	if len(versions) != 2 {
		t.Fatalf("len(versions) = %d, want 2", len(versions))
	}

	// versions[0] 走 ListEdits（message_edits 表），versions[1] 走 FindByID
	// （messages 表）—— 两条回读路径都要与帧对上
	got := map[string]string{"frame": frame.Payload.EditedAt}
	for i, label := range []string{"history[0]", "history[1].current"} {
		v, _ := versions[i].(map[string]any)
		s, _ := v["edited_at"].(string)
		got[label] = s
	}

	var ref time.Time
	for label, s := range got {
		ts, err := time.Parse(time.RFC3339Nano, s)
		if err != nil {
			t.Fatalf("%s 的 edited_at %q 不是 RFC3339: %v", label, s, err)
		}
		if _, off := ts.Zone(); off != 0 {
			t.Errorf("%s 的 edited_at = %q，时区偏移 %d 秒，期望 UTC", label, s, off)
		}
		if ts.Nanosecond()%1000 != 0 {
			t.Errorf("%s 的 edited_at = %q 带纳秒尾数，期望截到微秒", label, s)
		}
		if ref.IsZero() {
			ref = ts
		} else if !ts.Equal(ref) {
			t.Errorf("%s 的 edited_at = %q，与其它出口不等（ref=%s）", label, s, ref.Format(time.RFC3339Nano))
		}
	}
}

// TestEditHistoryEndpointRejectsNonMember 非成员查历史 → 403。
func TestEditHistoryEndpointRejectsNonMember(t *testing.T) {
	env := newEditEnv(t)
	outsider := newPackTestUser(t, env.db, "编辑非成员")
	env.actor = outsider.ID

	resp, status := env.get(t, env.historyURL())
	if status != http.StatusForbidden {
		t.Fatalf("status = %d resp = %+v, want 403", status, resp)
	}
}

// TestAdminEditHistoryEndpoint 管理端取证：非会话成员的管理员也能拿到全部版本，
// 且「查看」动作本身必须落一条 view_message_edits 审计 ——
// 编辑历史含用户已改掉的原文，谁看过必须留痕。
func TestAdminEditHistoryEndpoint(t *testing.T) {
	env := newEditEnv(t)
	if _, status := env.patch(t, env.editURL(),
		map[string]any{"text": "管理端取证文本"}); status != http.StatusOK {
		t.Fatalf("edit failed with %d", status)
	}

	adminSvc := service.NewAdminService(
		repository.NewAdminRepository(env.db),
		repository.NewConversationRepository(env.db),
		repository.NewUserRepository(env.db),
		repository.NewFlaggedUGCRepository(env.db),
		zap.NewNop(),
	)
	// actor 必须是真实用户：admin_action_logs.actor_id 有外键，
	// 假 uuid 会在夹具事务里触发违规并中止整个事务
	admin := newPackTestUser(t, env.db, "编辑历史审核员")
	h := NewAdminHandler(adminSvc, nil, nil, env.svc, zap.NewNop())
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", admin.ID)
		c.Next()
	})
	r.GET("/api/v1/admin/messages/:id/edits", h.MessageEditHistory)

	w, resp := doJSON(t, r, http.MethodGet,
		"/api/v1/admin/messages/"+env.msgID.String()+"/edits", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d resp = %+v, want 200", w.Code, resp)
	}
	versions, _ := resp.Data["versions"].([]any)
	if len(versions) != 2 {
		t.Fatalf("len(versions) = %d, want 2", len(versions))
	}

	var logs int64
	if err := env.db.Model(&model.AdminActionLog{}).
		Where("action = ? AND target_id = ? AND actor_id = ?",
			model.AdminActionViewMessageEdits, env.msgID.String(), admin.ID).
		Count(&logs).Error; err != nil {
		t.Fatalf("count audit logs: %v", err)
	}
	if logs != 1 {
		t.Errorf("view_message_edits 审计行数 = %d, want 1", logs)
	}

	// 消息不存在 → 404（不泄漏成 500）
	w, _ = doJSON(t, r, http.MethodGet,
		"/api/v1/admin/messages/11111111-1111-4111-8111-111111111111/edits", nil)
	if w.Code != http.StatusNotFound {
		t.Errorf("missing message status = %d, want 404", w.Code)
	}
}
