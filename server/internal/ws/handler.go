package ws

import (
	"context"
	"encoding/json"
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

	result, err := h.msgSvc.SendContent(ctx, c.userID, p.ConversationID, messageType, contentJSON, p.ClientMsgID, p.ReplyToID)
	if err != nil {
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
		ClientMsgID:    p.ClientMsgID,
	})
	if err == nil {
		h.hub.SendToUsers(result.MemberIDs, receive)
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
