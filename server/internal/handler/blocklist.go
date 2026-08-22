package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/repository"
	"github.com/yuanchat/server/internal/service"
	"go.uber.org/zap"
)

// BlocklistHandler 黑名单 REST 端点。
type BlocklistHandler struct {
	svc    *service.BlocklistService
	logger *zap.Logger
}

func NewBlocklistHandler(svc *service.BlocklistService, logger *zap.Logger) *BlocklistHandler {
	return &BlocklistHandler{svc: svc, logger: logger}
}

// List 查当前用户的黑名单条目（含目标用户资料）。
//
//	@Summary	黑名单列表
//	@Tags		blocklist
//	@Security	BearerAuth
//	@Router		/api/v1/blocks [get]
func (h *BlocklistHandler) List(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	items, err := h.svc.List(c.Request.Context(), userID)
	if err != nil {
		h.logger.Error("list blocklist failed", zap.Error(err))
		InternalError(c, "failed to list blocklist")
		return
	}
	Success(c, gin.H{"items": items})
}

// Block 拉黑目标用户。幂等。
//
//	@Summary	拉黑用户
//	@Tags		blocklist
//	@Security	BearerAuth
//	@Router		/api/v1/blocks [post]
func (h *BlocklistHandler) Block(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	var body BlockRequestBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}
	if err := h.svc.Block(c.Request.Context(), userID, body.TargetID); err != nil {
		switch {
		case errors.Is(err, repository.ErrBlockSelf):
			BadRequest(c, "cannot block yourself")
		case errors.Is(err, service.ErrUserNotFound):
			NotFound(c, "target user not found")
		default:
			h.logger.Error("block user failed", zap.Error(err))
			InternalError(c, "block failed")
		}
		return
	}
	Success(c, gin.H{"target_id": body.TargetID})
}

// Unblock 解除拉黑（:targetId 为被拉黑用户 UUID）。幂等。
//
//	@Summary	取消拉黑
//	@Tags		blocklist
//	@Security	BearerAuth
//	@Router		/api/v1/blocks/{targetId} [delete]
func (h *BlocklistHandler) Unblock(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	targetID, err := uuid.Parse(c.Param("targetId"))
	if err != nil {
		BadRequest(c, "invalid target id")
		return
	}
	if err := h.svc.Unblock(c.Request.Context(), userID, targetID); err != nil {
		h.logger.Error("unblock user failed", zap.Error(err))
		InternalError(c, "unblock failed")
		return
	}
	c.Status(http.StatusNoContent)
}

// BlockRequestBody 拉黑请求体。
type BlockRequestBody struct {
	TargetID uuid.UUID `json:"target_id" binding:"required"`
}
