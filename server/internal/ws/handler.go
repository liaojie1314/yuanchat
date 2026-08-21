package ws

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/yuanchat/server/internal/config"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/pkg/jwt"
	"github.com/yuanchat/server/internal/service"
	"go.uber.org/zap"
)

// opTimeout 单条业务帧处理（DB 写入等）的超时。
const opTimeout = 5 * time.Second

// maxTextLen 文本消息最大长度（字符数）。
const maxTextLen = 4000

// Handler 处理 /ws 升级请求与业务帧派发。
type Handler struct {
	hub      *Hub
	msgSvc   *service.MessageService
	tokens   *jwt.Generator
	cfg      config.WebSocketConfig
	isProd   bool
	upgrader websocket.Upgrader
	logger   *zap.Logger
	// offlinePush 消息落库后对「无任何 WS 连接」的成员补推浏览器通知
	//（router 注入；nil 表示未启用 Web Push）
	offlinePush func(recipients []uuid.UUID, info OfflineMsgInfo)
	// resolveSticker 校验发送者对该贴纸的可发送权限，并返回服务端权威的对象元数据
	//（router 注入）。nil 时贴纸帧退化为仅字段非空校验——生产装配必然非 nil，
	// 仅 buildContent 的纯单测会留空。
	resolveSticker func(ctx context.Context, senderID, stickerID uuid.UUID) (objectKey string, width, height int, err error)
}

// SetStickerResolver 注入贴纸可发送性校验（router 装配时调用）。
func (h *Handler) SetStickerResolver(
	fn func(ctx context.Context, senderID, stickerID uuid.UUID) (string, int, int, error),
) {
	h.resolveSticker = fn
}

// OfflineMsgInfo 离线推送所需的消息摘要（避免 ws 层依赖 push 层类型）。
type OfflineMsgInfo struct {
	SenderNickname string
	ContentType    string // text / image / file / voice
	Text           string // 仅 text 类型有值
	ConversationID uuid.UUID
	MessageID      uuid.UUID
}

// SetOfflinePush 注册离线推送回调（装配层调用）。
func (h *Handler) SetOfflinePush(fn func(recipients []uuid.UUID, info OfflineMsgInfo)) {
	h.offlinePush = fn
}

// NewHandler 创建 WebSocket Handler。
func NewHandler(
	hub *Hub,
	msgSvc *service.MessageService,
	tokens *jwt.Generator,
	cfg config.WebSocketConfig,
	isProd bool,
	logger *zap.Logger,
) *Handler {
	h := &Handler{
		hub:    hub,
		msgSvc: msgSvc,
		tokens: tokens,
		cfg:    cfg,
		isProd: isProd,
		logger: logger,
	}
	h.upgrader = websocket.Upgrader{
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
		// 浏览器 WS 无法自定义 Header，开发环境放行全部 Origin；
		// 生产环境要求 Origin 与 Host 同源。
		CheckOrigin: func(r *http.Request) bool {
			if !h.isProd {
				return true
			}
			return r.Header.Get("Origin") == "https://"+r.Host || r.Header.Get("Origin") == "http://"+r.Host
		},
	}
	return h
}

// ServeWS 鉴权并升级连接，随后阻塞在读循环直到连接关闭。
//
// 浏览器 WebSocket API 无法携带 Authorization Header，
// 因此 access token 通过 query 参数 ?token= 传递。
func (h *Handler) ServeWS(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "token required", http.StatusUnauthorized)
		return
	}

	claims, err := h.tokens.Validate(token)
	if err != nil || claims.TokenUse != "access" {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Warn("ws upgrade failed", zap.Error(err))
		return
	}

	client := &Client{
		userID:   claims.UserID,
		deviceID: claims.DeviceID,
		conn:     conn,
		send:     make(chan []byte, sendBufferSize),
		hub:      h.hub,
		handler:  h,
		logger:   h.logger,
	}

	if !h.hub.Register(client) {
		h.logger.Warn("ws connection limit reached", zap.String("user_id", claims.UserID.String()))
		_ = conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "too many connections"))
		_ = conn.Close()
		return
	}

	h.logger.Info("ws connected",
		zap.String("user_id", claims.UserID.String()),
		zap.String("device_id", claims.DeviceID))

	go client.writePump(h.cfg.PingInterval, h.cfg.WriteTimeout)
	client.readPump(h.cfg.MaxMessageSize, h.cfg.PongTimeout)

	h.logger.Info("ws disconnected", zap.String("user_id", claims.UserID.String()))
}

// dispatch 按帧类型处理客户端消息（在该连接的读协程中串行执行）。
func (h *Handler) dispatch(c *Client, env *Envelope) {
	switch env.Type {
	case TypeMessageSend:
		h.handleSend(c, env)
	case TypeMessageRead:
		h.handleRead(c, env)
	case TypeTyping:
		h.handleTyping(c, env)
	case TypePing:
		// 应用层心跳：读侧任意帧都会顺延 read deadline（readPump 逻辑），
		// 回 pong 让客户端确认链路活性（半开连接探测）
		if frame, err := Encode(TypePong, struct{}{}); err == nil {
			select {
			case c.send <- frame:
			default:
			}
		}
	default:
		c.sendError(400, "unknown frame type: "+env.Type, "")
	}
}

func (h *Handler) handleSend(c *Client, env *Envelope) {
	var p SendPayload
	if err := unmarshalPayload(env, &p); err != nil {
		c.sendError(400, "invalid message.send payload", "")
		return
	}
	messageType, contentJSON, ok := h.buildContent(c, &p)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()

	result, err := h.msgSvc.SendContent(ctx, c.userID, p.ConversationID, messageType, contentJSON, p.ClientMsgID, p.ReplyToID, p.Mentions)
	if err != nil {
		if errors.Is(err, service.ErrBlocked) {
			c.sendError(403, "BLOCKED", p.ClientMsgID)
			return
		}
		if errors.Is(err, service.ErrInvalidMention) {
			c.sendError(400, "invalid mention target", p.ClientMsgID)
			return
		}
		if errors.Is(err, service.ErrInvalidQuote) {
			c.sendError(400, "invalid quote target", p.ClientMsgID)
			return
		}
		h.logger.Error("send message failed", zap.Error(err), zap.String("user_id", c.userID.String()))
		c.sendError(500, "send failed", p.ClientMsgID)
		return
	}

	ts := result.Message.CreatedAt.UnixMilli()

	ack, err := Encode(TypeMessageAck, AckPayload{
		ClientMsgID:    p.ClientMsgID,
		MessageID:      result.Message.ID,
		ConversationID: p.ConversationID,
		Seq:            result.Message.Seq,
		Timestamp:      ts,
	})
	if err == nil {
		h.hub.SendToUsers([]uuid.UUID{c.userID}, ack)
	}

	receive, err := Encode(TypeMessageReceive, ReceivePayload{
		MessageID:      result.Message.ID,
		ConversationID: p.ConversationID,
		SenderID:       c.userID,
		SenderNickname: result.SenderNickname,
		Content:        p.Content,
		Seq:            result.Message.Seq,
		Timestamp:      ts,
		ReplyToID:      p.ReplyToID,
		Mentions:       result.MentionedMembers,
		ClientMsgID:    p.ClientMsgID,
	})
	if err == nil {
		h.hub.SendToUsers(result.MemberIDs, receive)
	}

	// 离线成员补推浏览器通知：WS 在线者已实时收到，无需重复打扰。
	// OnlineFilter 含跨实例 mirror，多实例部署下判定同样准确。
	if h.offlinePush != nil {
		recipients := make([]uuid.UUID, 0, len(result.MemberIDs))
		for _, id := range result.MemberIDs {
			if id != c.userID {
				recipients = append(recipients, id)
			}
		}
		online := make(map[uuid.UUID]struct{})
		for _, id := range h.hub.OnlineFilter(recipients) {
			online[id] = struct{}{}
		}
		offline := make([]uuid.UUID, 0, len(recipients))
		for _, id := range recipients {
			if _, up := online[id]; !up {
				offline = append(offline, id)
			}
		}
		if len(offline) > 0 {
			go h.offlinePush(offline, OfflineMsgInfo{
				SenderNickname: result.SenderNickname,
				ContentType:    p.Content.Type,
				Text:           p.Content.Text,
				ConversationID: p.ConversationID,
				MessageID:      result.Message.ID,
			})
		}
	}
}

// buildContent 按 content.type 校验并序列化落库内容，返回 (messageType, contentJSON, ok)。
//
// 校验失败时已就地回错误帧并返回 ok=false，调用方直接 return 即可。
// text 与 image 共用 message.send 通道，故在此分流；ReceivePayload 仍原样回传 p.Content。
func (h *Handler) buildContent(c *Client, p *SendPayload) (int16, string, bool) {
	switch p.Content.Type {
	case "text":
		if p.Content.Text == "" || len([]rune(p.Content.Text)) > maxTextLen {
			c.sendError(400, "text content required (1-4000 chars)", p.ClientMsgID)
			return 0, "", false
		}
		raw, err := json.Marshal(model.MessageContentText{Text: p.Content.Text})
		if err != nil {
			c.sendError(400, "invalid text content", p.ClientMsgID)
			return 0, "", false
		}
		return model.MessageTypeText, string(raw), true
	case "image":
		if p.Content.Key == "" || p.Content.Width <= 0 || p.Content.Height <= 0 || p.Content.Size <= 0 {
			c.sendError(400, "image content requires key/width/height/size", p.ClientMsgID)
			return 0, "", false
		}
		raw, err := json.Marshal(struct {
			Key    string `json:"key"`
			Width  int    `json:"width"`
			Height int    `json:"height"`
			Size   int64  `json:"size"`
		}{p.Content.Key, p.Content.Width, p.Content.Height, p.Content.Size})
		if err != nil {
			c.sendError(400, "invalid image content", p.ClientMsgID)
			return 0, "", false
		}
		return model.MessageTypeImage, string(raw), true
	case "sticker":
		// sticker_id 必须是合法 UUID：原实现只判非空，可塞满帧上限（64KB）的垃圾
		// 落进 messages.content JSONB 并向全会话扇出，绕过文本路径的 4000 字限制。
		stickerID, err := uuid.Parse(p.Content.StickerID)
		if err != nil {
			c.sendError(400, "sticker content requires a valid sticker_id", p.ClientMsgID)
			return 0, "", false
		}
		// 查库校验归属并取回权威元数据：客户端传来的 key/width/height 一律不采信。
		// 原实现完全不查库，可以填别人的 sticker_id、不存在的 id，或把任意
		// files/ 下的 key 当贴纸发出去（Add 的 images/ 前缀检查在此路径上不生效）。
		objectKey, width, height := p.Content.Key, p.Content.Width, p.Content.Height
		if h.resolveSticker != nil {
			rctx, rcancel := context.WithTimeout(context.Background(), opTimeout)
			objectKey, width, height, err = h.resolveSticker(rctx, c.userID, stickerID)
			rcancel()
			if err != nil {
				c.sendError(403, "sticker not available to sender", p.ClientMsgID)
				return 0, "", false
			}
		} else if objectKey == "" || width <= 0 || height <= 0 {
			c.sendError(400, "sticker content requires sticker_id/key/width/height", p.ClientMsgID)
			return 0, "", false
		}
		raw, err := json.Marshal(struct {
			StickerID string `json:"sticker_id"`
			Key       string `json:"key"`
			Width     int    `json:"width"`
			Height    int    `json:"height"`
		}{stickerID.String(), objectKey, width, height})
		if err != nil {
			c.sendError(400, "invalid sticker content", p.ClientMsgID)
			return 0, "", false
		}
		return model.MessageTypeSticker, string(raw), true
	case "file":
		if p.Content.Key == "" || p.Content.Name == "" || p.Content.Size <= 0 {
			c.sendError(400, "file content requires key/name/size", p.ClientMsgID)
			return 0, "", false
		}
		if len([]rune(p.Content.Name)) > 255 {
			c.sendError(400, "file name too long", p.ClientMsgID)
			return 0, "", false
		}
		raw, err := json.Marshal(struct {
			Key  string `json:"key"`
			Name string `json:"name"`
			Size int64  `json:"size"`
		}{p.Content.Key, p.Content.Name, p.Content.Size})
		if err != nil {
			c.sendError(400, "invalid file content", p.ClientMsgID)
			return 0, "", false
		}
		return model.MessageTypeFile, string(raw), true
	case "voice":
		if p.Content.Key == "" || p.Content.Duration <= 0 || p.Content.Duration > 60 || p.Content.Size <= 0 {
			c.sendError(400, "voice content requires key/duration(1-60s)/size", p.ClientMsgID)
			return 0, "", false
		}
		raw, err := json.Marshal(struct {
			Key      string `json:"key"`
			Duration int    `json:"duration"`
			Size     int64  `json:"size"`
		}{p.Content.Key, p.Content.Duration, p.Content.Size})
		if err != nil {
			c.sendError(400, "invalid voice content", p.ClientMsgID)
			return 0, "", false
		}
		return model.MessageTypeVoice, string(raw), true
	case "e2ee":
		// 端到端加密：服务端不理解密文语义，只校验结构完整性后原样落库。
		// 任何字段都不参与索引/搜索/审核——这是 E2EE 的设计前提。
		if p.Content.RatchetKey == "" || p.Content.Nonce == "" || p.Content.Ciphertext == "" ||
			p.Content.N == nil || p.Content.PN == nil {
			c.sendError(400, "e2ee content requires ratchet_key/n/pn/nonce/ciphertext", p.ClientMsgID)
			return 0, "", false
		}
		raw, err := json.Marshal(struct {
			RatchetKey   string `json:"ratchet_key"`
			N            int    `json:"n"`
			PN           int    `json:"pn"`
			Nonce        string `json:"nonce"`
			Ciphertext   string `json:"ciphertext"`
			IdentityKey  string `json:"identity_key,omitempty"`
			EphemeralKey string `json:"ephemeral_key,omitempty"`
			OtkID        *int   `json:"otk_id,omitempty"`
		}{
			p.Content.RatchetKey, *p.Content.N, *p.Content.PN,
			p.Content.Nonce, p.Content.Ciphertext,
			p.Content.IdentityKey, p.Content.EphemeralKey, p.Content.OtkID,
		})
		if err != nil {
			c.sendError(400, "invalid e2ee content", p.ClientMsgID)
			return 0, "", false
		}
		return model.MessageTypeE2EE, string(raw), true
	default:
		c.sendError(400, "unsupported content type", p.ClientMsgID)
		return 0, "", false
	}
}

func (h *Handler) handleRead(c *Client, env *Envelope) {
	var p ReadPayload
	if err := unmarshalPayload(env, &p); err != nil {
		c.sendError(400, "invalid message.read payload", "")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()

	memberIDs, err := h.msgSvc.MarkRead(ctx, c.userID, p.ConversationID, p.Seq)
	if err != nil {
		h.logger.Warn("mark read failed", zap.Error(err), zap.String("user_id", c.userID.String()))
		return
	}

	// 推给全部成员（含读者自己的其他设备，用于多端未读数同步）
	receipt, err := Encode(TypeMessageRead, ReadReceiptPayload{
		ConversationID: p.ConversationID,
		UserID:         c.userID,
		Seq:            p.Seq,
	})
	if err == nil {
		h.hub.SendToUsers(memberIDs, receipt)
	}
}

func (h *Handler) handleTyping(c *Client, env *Envelope) {
	var p TypingPayload
	if err := unmarshalPayload(env, &p); err != nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()

	nickname, memberIDs, err := h.msgSvc.TypingTargets(ctx, c.userID, p.ConversationID)
	if err != nil {
		return
	}

	// 正在输入只推给其他成员，不推给自己的设备
	others := make([]uuid.UUID, 0, len(memberIDs))
	for _, id := range memberIDs {
		if id != c.userID {
			others = append(others, id)
		}
	}

	event, err := Encode(TypeTyping, TypingEventPayload{
		ConversationID: p.ConversationID,
		UserID:         c.userID,
		Nickname:       nickname,
	})
	if err == nil {
		h.hub.SendToUsers(others, event)
	}
}

func unmarshalPayload(env *Envelope, v any) error {
	return json.Unmarshal(env.Payload, v)
}
