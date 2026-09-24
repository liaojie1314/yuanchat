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
//	@Summary		转发消息到多个会话
//	@Tags			chat
//	@Security		BearerAuth
//	@Param			id	path	string	true	"源消息 id"
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
		case errors.Is(err, service.ErrForwardEncrypted):
			BadRequest(c, "encrypted messages cannot be forwarded")
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

		// 推 message.receive 给目标会话全员。
		// 无法重建 content 的类型（理论上到不了这里：service.Forward 已拒 system/e2ee）
		// 跳过推送并告警，而不是推一个空文本帧。
		content, ok := contentPayloadFromMessage(r.Message)
		if !ok {
			h.logger.Warn("forward: cannot rebuild content payload, skipping realtime push",
				zap.Int("message_type", int(r.Message.MessageType)),
				zap.String("message_id", r.Message.ID.String()))
			continue
		}
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
//
// 返回 ok=false 表示该类型无法重建为实时帧（system/e2ee/video/未知）。调用方应
// 跳过推送而不是退化成空文本：空文本会让目标会话全员看到空气泡、列表预览变空串，
// 而刷新后走 REST 历史又正确渲染，症状比"实时帧缺失、刷新即出现"更难排查。
func contentPayloadFromMessage(m *model.Message) (ws.ContentPayload, bool) {
	switch m.MessageType {
	case model.MessageTypeText:
		var c model.MessageContentText
		if err := json.Unmarshal([]byte(m.Content), &c); err != nil {
			return ws.ContentPayload{}, false
		}
		return ws.ContentPayload{Type: "text", Text: c.Text}, true
	case model.MessageTypeImage:
		var c struct {
			Key    string `json:"key"`
			Width  int    `json:"width"`
			Height int    `json:"height"`
			Size   int64  `json:"size"`
		}
		if err := json.Unmarshal([]byte(m.Content), &c); err != nil {
			return ws.ContentPayload{}, false
		}
		return ws.ContentPayload{Type: "image", Key: c.Key, Width: c.Width, Height: c.Height, Size: c.Size}, true
	case model.MessageTypeFile:
		var c struct {
			Key  string `json:"key"`
			Name string `json:"name"`
			Size int64  `json:"size"`
		}
		if err := json.Unmarshal([]byte(m.Content), &c); err != nil {
			return ws.ContentPayload{}, false
		}
		return ws.ContentPayload{Type: "file", Key: c.Key, Name: c.Name, Size: c.Size}, true
	case model.MessageTypeVoice:
		var c struct {
			Key      string `json:"key"`
			Duration int    `json:"duration"`
			Size     int64  `json:"size"`
		}
		if err := json.Unmarshal([]byte(m.Content), &c); err != nil {
			return ws.ContentPayload{}, false
		}
		return ws.ContentPayload{Type: "voice", Key: c.Key, Duration: c.Duration, Size: c.Size}, true
	case model.MessageTypeSticker:
		// 贴纸此前缺 case，落 default 变成 {Type:"text"} 空气泡。
		// 落库的 content 由 ws.buildContent 生成（sticker_id/key/width/height 四字段齐全），
		// 转发是原样复制 content，故这里直接回填即可，无需再查库。
		var c struct {
			StickerID string `json:"sticker_id"`
			Key       string `json:"key"`
			Width     int    `json:"width"`
			Height    int    `json:"height"`
		}
		if err := json.Unmarshal([]byte(m.Content), &c); err != nil {
			return ws.ContentPayload{}, false
		}
		return ws.ContentPayload{
			Type: "sticker", StickerID: c.StickerID, Key: c.Key, Width: c.Width, Height: c.Height,
		}, true
	default:
		// system（服务层禁转）、e2ee（服务层禁转，密文换会话后无人能解）、
		// video（已可发送，但"转发即重建实时帧"不在本批范围，见 spec M7：
		// 转发后的视频靠刷新走 REST 历史渲染）、以及将来新增而忘了补 case 的类型。
		return ws.ContentPayload{}, false
	}
}
