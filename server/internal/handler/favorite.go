package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/service"
	"go.uber.org/zap"
)

// FavoriteHandler 收藏相关端点。
type FavoriteHandler struct {
	svc    *service.FavoriteService
	logger *zap.Logger
}

func NewFavoriteHandler(svc *service.FavoriteService, logger *zap.Logger) *FavoriteHandler {
	return &FavoriteHandler{svc: svc, logger: logger}
}

// AddFavoriteBody 收藏请求体。
type AddFavoriteBody struct {
	MessageID uuid.UUID `json:"message_id" binding:"required"`
}

// Add 收藏一条消息。
//
//	@Summary		Add a favorite
//	@Tags			favorites
//	@Security		BearerAuth
//	@Success		200	{object}	Response
//	@Router			/api/v1/favorites [post]
func (h *FavoriteHandler) Add(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	var body AddFavoriteBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}
	fav, err := h.svc.Add(c.Request.Context(), userID, body.MessageID)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrMessageNotFound):
			NotFound(c, "message not found")
		case errors.Is(err, service.ErrNotMember):
			Error(c, http.StatusForbidden, 403, "not a member of this conversation")
		default:
			h.logger.Error("add favorite failed", zap.Error(err))
			InternalError(c, "add favorite failed")
		}
		return
	}
	Success(c, gin.H{"id": fav.ID, "message_id": fav.MessageID})
}

// Remove 取消收藏（按 message_id）。
//
//	@Summary		Remove a favorite
//	@Tags			favorites
//	@Security		BearerAuth
//	@Param			messageId	path	string	true	"message id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/favorites/{messageId} [delete]
func (h *FavoriteHandler) Remove(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	messageID, err := uuid.Parse(c.Param("messageId"))
	if err != nil {
		BadRequest(c, "invalid message id")
		return
	}
	if err := h.svc.Remove(c.Request.Context(), userID, messageID); err != nil {
		h.logger.Error("remove favorite failed", zap.Error(err))
		InternalError(c, "remove favorite failed")
		return
	}
	Success(c, gin.H{"message": "removed"})
}

// List 分页列出当前用户的收藏。
//
//	@Summary		List favorites
//	@Tags			favorites
//	@Security		BearerAuth
//	@Param			before	query	string	false	"cursor (RFC3339)"
//	@Param			limit	query	int		false	"page size (default 20)"
//	@Param			type	query	int		false	"message type filter (1=text 2=image 3=file)"
//	@Success		200	{object}	Response
//	@Router			/api/v1/favorites [get]
func (h *FavoriteHandler) List(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	msgType, _ := strconv.ParseInt(c.DefaultQuery("type", "0"), 10, 16)
	favs, hasMore, err := h.svc.List(c.Request.Context(), userID, c.Query("before"), limit, int16(msgType))
	if err != nil {
		h.logger.Error("list favorites failed", zap.Error(err))
		InternalError(c, "list favorites failed")
		return
	}
	Success(c, gin.H{"favorites": favs, "has_more": hasMore})
}
