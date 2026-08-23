package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/service"
	"github.com/yuanchat/server/internal/ws"
	"go.uber.org/zap"
)

// MessageHandler 历史消息 REST 端点。
type MessageHandler struct {
	svc        *service.MessageService
	dispatcher ws.Dispatcher
	logger     *zap.Logger
}

func NewMessageHandler(svc *service.MessageService, dispatcher ws.Dispatcher, logger *zap.Logger) *MessageHandler {
	return &MessageHandler{svc: svc, dispatcher: dispatcher, logger: logger}
}

// History 分页返回某会话的消息（按 seq 倒序）。
//
//	@Summary		拉取消息历史
//	@Tags			chat
//	@Security		BearerAuth
//	@Param			id			path	string	true	"会话 id"
//	@Param			before_seq	query	int		false	"拉取 seq < before_seq 的消息；0 表示最新"
//	@Param			limit		query	int		false	"每页条数，默认 30，上限 100"
//	@Success		200	{object}	Response
//	@Router			/api/v1/conversations/{id}/messages [get]
func (h *MessageHandler) History(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}

	convID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid conversation id")
		return
	}

	beforeSeq, _ := strconv.ParseInt(c.DefaultQuery("before_seq", "0"), 10, 64)
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "30"))
	if limit <= 0 || limit > 100 {
		limit = 30
	}

	msgs, err := h.svc.GetHistory(c.Request.Context(), userID, convID, beforeSeq, limit)
	if err != nil {
		if errors.Is(err, service.ErrNotMember) {
			Error(c, 403, 403, "not a conversation member")
			return
		}
		h.logger.Error("get history failed", zap.Error(err))
		InternalError(c, "failed to load messages")
		return
	}

	// 满页说明可能还有更早的消息
	Success(c, gin.H{
		"messages": msgs,
		"has_more": len(msgs) == limit,
	})
}

// Recall 撤回消息（发送者本人、2 分钟窗口内）。
//
//	@Summary		撤回消息
//	@Tags			chat
//	@Security		BearerAuth
//	@Param			id	path	string	true	"消息 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/messages/{id}/recall [post]
func (h *MessageHandler) Recall(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	msgID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid message id")
		return
	}

	result, err := h.svc.Recall(c.Request.Context(), userID, msgID)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrMessageNotFound):
			NotFound(c, "message not found")
		case errors.Is(err, service.ErrNotSender):
			Error(c, http.StatusForbidden, 403, "only the sender can recall")
		case errors.Is(err, service.ErrRecallWindowExpired):
			Error(c, http.StatusForbidden, 4031, "recall window expired")
		default:
			h.logger.Error("recall failed", zap.Error(err))
			InternalError(c, "recall failed")
		}
		return
	}

	if !result.Idempotent {
		if frame, err := ws.Encode(ws.TypeMessageRecalled, ws.MessageRecalledPayload{
			MessageID:        result.Message.ID,
			ConversationID:   result.Message.ConversationID,
			Seq:              result.Message.Seq,
			OperatorID:       userID,
			OperatorNickname: result.OperatorNickname,
		}); err == nil {
			h.dispatcher.SendToUsers(result.MemberIDs, frame)
		} else {
			h.logger.Error("encode message.recalled failed", zap.Error(err))
		}
	}
	Success(c, gin.H{"message": "recalled"})
}

// ReactBody 表情回应请求体。
type ReactBody struct {
	Emoji string `json:"emoji" binding:"required"`
}

// React 切换自己对消息的 emoji 回应（toggle 语义），推 message.reaction 帧给会话全员。
//
//	@Summary		切换消息表情回应
//	@Tags			chat
//	@Security		BearerAuth
//	@Param			id	path	string	true	"消息 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/messages/{id}/reactions [post]
func (h *MessageHandler) React(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	msgID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid message id")
		return
	}
	var body ReactBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}

	result, err := h.svc.ToggleReaction(c.Request.Context(), userID, msgID, body.Emoji)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrMessageNotFound):
			NotFound(c, "message not found")
		case errors.Is(err, service.ErrNotMember):
			Error(c, http.StatusForbidden, 403, "not a conversation member")
		case errors.Is(err, service.ErrInvalidEmoji):
			BadRequest(c, "invalid emoji")
		default:
			h.logger.Error("toggle reaction failed", zap.Error(err))
			InternalError(c, "toggle reaction failed")
		}
		return
	}

	if frame, err := ws.Encode(ws.TypeMessageReaction, ws.MessageReactionPayload{
		MessageID:      result.Message.ID,
		ConversationID: result.Message.ConversationID,
		UserID:         userID,
		Emoji:          result.Emoji,
		Count:          result.Count,
		Reacted:        result.Reacted,
	}); err == nil {
		h.dispatcher.SendToUsers(result.MemberIDs, frame)
	} else {
		h.logger.Error("encode message.reaction failed", zap.Error(err))
	}
	Success(c, gin.H{"emoji": result.Emoji, "count": result.Count, "reacted": result.Reacted})
}

// Search 全文搜索当前用户有权访问的消息。
//
//	@Summary		搜索消息
//	@Tags			chat
//	@Security		BearerAuth
//	@Param			q				query	string	true	"搜索关键词（至少 3 字）"
//	@Param			conversation_id	query	string	false	"限定在该会话内搜索"
//	@Param			before			query	string	false	"分页游标（RFC3339）"
//	@Param			limit			query	int		false	"每页条数（默认 20，上限 50）"
//	@Success		200	{object}	Response
//	@Router			/api/v1/messages/search [get]
func (h *MessageHandler) Search(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}

	q := strings.TrimSpace(c.Query("q"))
	if q == "" {
		BadRequest(c, "q is required")
		return
	}

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	results, hasMore, err := h.svc.Search(
		c.Request.Context(),
		userID,
		q,
		c.Query("conversation_id"),
		c.Query("before"),
		limit,
	)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrSearchQueryTooShort):
			BadRequest(c, "search query must be at least 3 characters")
		default:
			h.logger.Error("message search failed", zap.Error(err))
			InternalError(c, "search failed")
		}
		return
	}

	Success(c, gin.H{"results": results, "has_more": hasMore})
}
