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

// respondPackError 把表情包/发布相关的 service 错误映射为统一响应。
// op 仅用于 500 分支的日志定位。返回 true 表示已写出响应。
func respondPackError(c *gin.Context, logger *zap.Logger, op string, err error) bool {
	switch {
	case errors.Is(err, service.ErrPackNotFound):
		NotFound(c, "sticker pack not found")
	case errors.Is(err, service.ErrPackNotAvailable):
		// 下架/未公开的包按"不存在"返回：不向无权用户区分这两种状态
		NotFound(c, "sticker pack not available")
	case errors.Is(err, service.ErrNotPackOwner):
		Error(c, http.StatusForbidden, http.StatusForbidden, "not the pack owner")
	case errors.Is(err, service.ErrInvalidPackName):
		BadRequest(c, "invalid pack name")
	case errors.Is(err, service.ErrInvalidCoverKey):
		BadRequest(c, "cover must be an uploaded sticker cover")
	case errors.Is(err, service.ErrPublishLimitExceeded):
		Error(c, http.StatusBadRequest, http.StatusBadRequest, "publish limit exceeded")
	case errors.Is(err, service.ErrInvalidStickerSources):
		BadRequest(c, "sticker sources must not be empty")
	case errors.Is(err, service.ErrTooManyPackStickers):
		Error(c, http.StatusConflict, http.StatusConflict, "too many stickers in this pack")
	case errors.Is(err, service.ErrInvalidObjectKey):
		BadRequest(c, "invalid object key")
	case errors.Is(err, service.ErrInvalidContentHash):
		BadRequest(c, "invalid content hash")
	case errors.Is(err, service.ErrInvalidStickerSize):
		BadRequest(c, "invalid sticker dimensions")
	case errors.Is(err, service.ErrStickerObjectMissing):
		// 对象不在存储里：重试无意义，前端据此提示"图片已失效"
		NotFound(c, "sticker object does not exist")
	case errors.Is(err, service.ErrStickerNotFound):
		NotFound(c, "sticker not found")
	case errors.Is(err, service.ErrInvalidCursor):
		BadRequest(c, "invalid cursor")
	default:
		logger.Error(op+" failed", zap.Error(err))
		InternalError(c, op+" failed")
	}
	return true
}

// parsePathUUID 解析路径参数里的 UUID，非法时写出 400 并返回 false。
func parsePathUUID(c *gin.Context, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(name))
	if err != nil {
		BadRequest(c, "invalid "+name)
		return uuid.Nil, false
	}
	return id, true
}

// Market 商城列表（GET /sticker-packs/market）。
//
//	@Summary		表情商城列表（公开未下架的包）
//	@Tags			stickers
//	@Security		BearerAuth
//	@Param			cursor	query	string	false	"游标（上一页 next_cursor，RFC3339）"
//	@Param			limit	query	int		false	"每页条数（默认 20，上限 50）"
//	@Success		200	{object}	Response
//	@Router			/api/v1/sticker-packs/market [get]
func (h *StickerHandler) Market(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "0"))
	packs, nextCursor, err := h.svc.Market(c.Request.Context(), userID, c.Query("cursor"), limit)
	if err != nil {
		respondPackError(c, h.logger, "list market", err)
		return
	}
	// 契约：还有下一页时 next_cursor 为最后一条的 created_at，否则为 null
	var next any
	if nextCursor != "" {
		next = nextCursor
	}
	Success(c, gin.H{"packs": packs, "next_cursor": next})
}

// PackDetail 包详情（GET /sticker-packs/:id）。
//
//	@Summary		表情包详情（含贴纸与发布者）
//	@Tags			stickers
//	@Security		BearerAuth
//	@Param			id	path	string	true	"表情包 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/sticker-packs/{id} [get]
func (h *StickerHandler) PackDetail(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	packID, ok := parsePathUUID(c, "id")
	if !ok {
		return
	}
	detail, err := h.svc.PackDetail(c.Request.Context(), userID, packID)
	if err != nil {
		respondPackError(c, h.logger, "get pack detail", err)
		return
	}
	Success(c, detail)
}

// AddPack 把一个表情包加入「我的表情包」（POST /sticker-packs/:id/add，幂等）。
//
//	@Summary		添加表情包到我的列表（幂等）
//	@Tags			stickers
//	@Security		BearerAuth
//	@Param			id	path	string	true	"表情包 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/sticker-packs/{id}/add [post]
func (h *StickerHandler) AddPack(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	packID, ok := parsePathUUID(c, "id")
	if !ok {
		return
	}
	if err := h.svc.AddPack(c.Request.Context(), userID, packID); err != nil {
		respondPackError(c, h.logger, "add sticker pack", err)
		return
	}
	Success(c, gin.H{"message": "added"})
}

// RemovePack 把一个表情包移出「我的表情包」（DELETE /sticker-packs/:id/add）。
//
//	@Summary		从我的列表移除表情包（不影响包本身）
//	@Tags			stickers
//	@Security		BearerAuth
//	@Param			id	path	string	true	"表情包 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/sticker-packs/{id}/add [delete]
func (h *StickerHandler) RemovePack(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	packID, ok := parsePathUUID(c, "id")
	if !ok {
		return
	}
	if err := h.svc.RemovePack(c.Request.Context(), userID, packID); err != nil {
		respondPackError(c, h.logger, "remove sticker pack", err)
		return
	}
	Success(c, gin.H{"message": "removed"})
}
