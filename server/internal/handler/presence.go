package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/repository"
	"github.com/yuanchat/server/internal/ws"
	"go.uber.org/zap"
)

// PresenceHandler 在线状态快照端点。
type PresenceHandler struct {
	contactRepo *repository.ContactRepository
	hub         *ws.Hub
	logger      *zap.Logger
}

func NewPresenceHandler(contactRepo *repository.ContactRepository, hub *ws.Hub, logger *zap.Logger) *PresenceHandler {
	return &PresenceHandler{contactRepo: contactRepo, hub: hub, logger: logger}
}

// Snapshot 返回我的好友中当前在线的用户 ID（登录/重连时拉一次，此后靠 presence 帧增量）。
//
//	@Summary		在线好友快照
//	@Tags			chat
//	@Security		BearerAuth
//	@Success		200	{object}	Response
//	@Router			/api/v1/presence [get]
func (h *PresenceHandler) Snapshot(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	friendIDs, err := h.contactRepo.FriendIDs(c.Request.Context(), userID)
	if err != nil {
		h.logger.Error("presence snapshot failed", zap.Error(err))
		InternalError(c, "failed to load presence")
		return
	}
	Success(c, gin.H{"online_ids": h.hub.OnlineFilter(friendIDs)})
}
