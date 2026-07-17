package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/service"
	"go.uber.org/zap"
)

// ConversationHandler 会话列表 REST 端点。
type ConversationHandler struct {
	svc    *service.ConversationService
	logger *zap.Logger
}

func NewConversationHandler(svc *service.ConversationService, logger *zap.Logger) *ConversationHandler {
	return &ConversationHandler{svc: svc, logger: logger}
}

// List returns all conversations the current user participates in.
//
//	@Summary		List conversations
//	@Tags			chat
//	@Security		BearerAuth
//	@Success		200	{object}	Response
//	@Router			/api/v1/conversations [get]
func (h *ConversationHandler) List(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}

	dtos, err := h.svc.List(c.Request.Context(), userID)
	if err != nil {
		h.logger.Error("list conversations failed", zap.Error(err))
		InternalError(c, "failed to list conversations")
		return
	}

	c.JSON(http.StatusOK, Response{Code: 0, Message: "ok", Data: gin.H{"conversations": dtos}})
}

// Members 群成员列表（仅会话成员可查）。
func (h *ConversationHandler) Members(c *gin.Context) {
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

	members, err := h.svc.Members(c.Request.Context(), userID, convID)
	if err != nil {
		if errors.Is(err, service.ErrNotMember) {
			Error(c, http.StatusForbidden, 403, "not a conversation member")
			return
		}
		h.logger.Error("list members failed", zap.Error(err))
		InternalError(c, "failed to list members")
		return
	}
	Success(c, gin.H{"members": members})
}
