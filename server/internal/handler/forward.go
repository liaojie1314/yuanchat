package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/service"
	"github.com/yuanchat/server/internal/ws"
	"go.uber.org/zap"
)

// ForwardHandler 消息转发端点（一次转发到最多 9 个会话，来源与目标必须都是操作者所在会话）。
type ForwardHandler struct {
	svc        *service.MessageService
	dispatcher ws.Dispatcher
	logger     *zap.Logger
}

func NewForwardHandler(svc *service.MessageService, dispatcher ws.Dispatcher, logger *zap.Logger) *ForwardHandler {
	return &ForwardHandler{svc: svc, dispatcher: dispatcher, logger: logger}
}

// ForwardRequestBody 转发请求体。
type ForwardRequestBody struct {
	ConversationIDs []uuid.UUID `json:"conversation_ids" binding:"required,min=1,max=9"`
}

// ForwardResultItem 单个目标转发结果（新消息 ID + 序列号）。
type ForwardResultItem struct {
	ConversationID uuid.UUID `json:"conversation_id"`
	MessageID      uuid.UUID `json:"message_id"`
	Seq            int64     `json:"seq"`
}

// Forward 将消息转发到多个会话。
//
//	@Summary		Forward a message to multiple conversations
//	@Tags			chat
//	@Security		BearerAuth
//	@Param			id	path	string	true	"source message id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/messages/{id}/forward [post]
func (h *ForwardHandler) Forward(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	srcID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid message id")
		return
	}
	var body ForwardRequestBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}

	results, err := h.svc.Forward(c.Request.Context(), userID, srcID, body.ConversationIDs)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrMessageNotFound):
			NotFound(c, "message not found")
		case errors.Is(err, service.ErrNotMember):
			Error(c, http.StatusForbidden, 403, "not a source conversation member")
		case errors.Is(err, service.ErrForwardTargetInvalid):
			Error(c, http.StatusForbidden, 403, "one or more target conversations are inaccessible")
		case errors.Is(err, service.ErrForwardNoTarget), errors.Is(err, service.ErrForwardTooMany):
			BadRequest(c, err.Error())
		default:
			h.logger.Error("forward failed", zap.Error(err))
			InternalError(c, "forward failed")
		}
		return
	}

	items := make([]ForwardResultItem, 0, len(results))
	for _, r := range results {
		items = append(items, ForwardResultItem{
			ConversationID: r.Message.ConversationID,
			MessageID:      r.Message.ID,
			Seq:            r.Message.Seq,
		})

		// 推 message.receive 给目标会话全员
		content := contentPayloadFromMessage(r.Message)
		if frame, err := ws.Encode(ws.TypeMessageReceive, ws.ReceivePayload{
			MessageID:      r.Message.ID,
			ConversationID: r.Message.ConversationID,
			SenderID:       userID,
			SenderNickname: r.SenderNickname,
			Content:        content,
			Seq:            r.Message.Seq,
			Timestamp:      r.Message.CreatedAt.UnixMilli(),
		}); err == nil {
			h.dispatcher.SendToUsers(r.MemberIDs, frame)
		}
	}

	Success(c, gin.H{"results": items})
}

// contentPayloadFromMessage 反序列化 Message.Content 为 WS 层 ContentPayload
// （转发路径无需 client_msg_id / reply_to_id）。
func contentPayloadFromMessage(m *model.Message) ws.ContentPayload {
	switch m.MessageType {
	case model.MessageTypeText:
		var c model.MessageContentText
		_ = json.Unmarshal([]byte(m.Content), &c)
		return ws.ContentPayload{Type: "text", Text: c.Text}
	case model.MessageTypeImage:
		var c struct {
			Key    string `json:"key"`
			Width  int    `json:"width"`
			Height int    `json:"height"`
			Size   int64  `json:"size"`
		}
		_ = json.Unmarshal([]byte(m.Content), &c)
		return ws.ContentPayload{Type: "image", Key: c.Key, Width: c.Width, Height: c.Height, Size: c.Size}
	case model.MessageTypeFile:
		var c struct {
			Key  string `json:"key"`
			Name string `json:"name"`
			Size int64  `json:"size"`
		}
		_ = json.Unmarshal([]byte(m.Content), &c)
		return ws.ContentPayload{Type: "file", Key: c.Key, Name: c.Name, Size: c.Size}
	case model.MessageTypeVoice:
		var c struct {
			Key      string `json:"key"`
			Duration int    `json:"duration"`
			Size     int64  `json:"size"`
		}
		_ = json.Unmarshal([]byte(m.Content), &c)
		return ws.ContentPayload{Type: "voice", Key: c.Key, Duration: c.Duration, Size: c.Size}
	default:
		return ws.ContentPayload{Type: "text"}
	}
}
