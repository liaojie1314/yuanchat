package handler

import (
	"errors"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/service"
	"go.uber.org/zap"
)

// MessageHandler 历史消息 REST 端点。
type MessageHandler struct {
	svc    *service.MessageService
	logger *zap.Logger
}

func NewMessageHandler(svc *service.MessageService, logger *zap.Logger) *MessageHandler {
	return &MessageHandler{svc: svc, logger: logger}
}

// History returns paginated messages of a conversation (seq descending).
//
//	@Summary		Get message history
//	@Tags			chat
//	@Security		BearerAuth
//	@Param			id			path	string	true	"conversation id"
//	@Param			before_seq	query	int		false	"fetch messages with seq < before_seq; 0 = latest"
//	@Param			limit		query	int		false	"page size, default 30, max 100"
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
