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

// StickerHandler 表情收藏（个人）+ 官方表情包（公共只读）端点。
type StickerHandler struct {
	svc    *service.StickerService
	logger *zap.Logger
}

func NewStickerHandler(svc *service.StickerService, logger *zap.Logger) *StickerHandler {
	return &StickerHandler{svc: svc, logger: logger}
}

// AddStickerBody 收藏请求体。
type AddStickerBody struct {
	ObjectKey   string `json:"object_key" binding:"required"`
	Width       int    `json:"width" binding:"required"`
	Height      int    `json:"height" binding:"required"`
	ContentHash string `json:"content_hash" binding:"required"`
}

// Add 收藏一张贴纸（POST /stickers）。
//
//	@Summary		收藏一张贴纸
//	@Tags			stickers
//	@Security		BearerAuth
//	@Success		200	{object}	Response
//	@Router			/api/v1/stickers [post]
func (h *StickerHandler) Add(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	var body AddStickerBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}
	st, err := h.svc.Add(c.Request.Context(), userID, body.ObjectKey, body.Width, body.Height, body.ContentHash)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrInvalidObjectKey):
			BadRequest(c, "invalid object key")
		case errors.Is(err, service.ErrInvalidContentHash):
			BadRequest(c, "invalid content hash")
		case errors.Is(err, service.ErrInvalidStickerSize):
			BadRequest(c, "invalid sticker dimensions")
		case errors.Is(err, service.ErrStickerObjectMissing):
			// 对象不在存储里：重试无意义，与网络/服务端故障区分开，前端据此提示"图片已失效"
			NotFound(c, "sticker object does not exist")
		case errors.Is(err, service.ErrTooManyStickers):
			Error(c, 409, 409, "too many favorited stickers")
		default:
			h.logger.Error("add sticker failed", zap.Error(err))
			InternalError(c, "add sticker failed")
		}
		return
	}
	Success(c, gin.H{
		"id": st.ID, "object_key": st.ObjectKey, "width": st.Width, "height": st.Height,
	})
}

// Remove 取消收藏（DELETE /stickers/:id）。
//
//	@Summary		取消收藏贴纸
//	@Tags			stickers
//	@Security		BearerAuth
//	@Param			id	path	string	true	"贴纸 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/stickers/{id} [delete]
func (h *StickerHandler) Remove(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid sticker id")
		return
	}
	if err := h.svc.Remove(c.Request.Context(), userID, id); err != nil {
		switch {
		case errors.Is(err, service.ErrStickerNotFound):
			NotFound(c, "sticker not found")
		case errors.Is(err, service.ErrNotStickerOwner):
			Error(c, 403, 403, "not the sticker owner")
		default:
			h.logger.Error("remove sticker failed", zap.Error(err))
			InternalError(c, "remove sticker failed")
		}
		return
	}
	Success(c, gin.H{"message": "removed"})
}

// ListMine 列出本人收藏（GET /stickers/mine）。
//
//	@Summary		本人收藏的贴纸列表
//	@Tags			stickers
//	@Security		BearerAuth
//	@Param			before	query	string	false	"游标（RFC3339）"
//	@Param			limit	query	int		false	"每页条数（默认 100，上限 200）"
//	@Success		200	{object}	Response
//	@Router			/api/v1/stickers/mine [get]
func (h *StickerHandler) ListMine(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "0"))
	rows, hasMore, err := h.svc.ListMine(c.Request.Context(), userID, c.Query("before"), limit)
	if err != nil {
		if errors.Is(err, service.ErrInvalidCursor) {
			BadRequest(c, "invalid before cursor")
			return
		}
		h.logger.Error("list my stickers failed", zap.Error(err))
		InternalError(c, "list stickers failed")
		return
	}
	Success(c, gin.H{"stickers": rows, "has_more": hasMore})
}

// ListPacks 列出表情包及各自贴纸（GET /sticker-packs）。
//
//	@Summary		表情包列表
//	@Tags			stickers
//	@Security		BearerAuth
//	@Success		200	{object}	Response
//	@Router			/api/v1/sticker-packs [get]
func (h *StickerHandler) ListPacks(c *gin.Context) {
	packs, err := h.svc.ListPacks(c.Request.Context())
	if err != nil {
		h.logger.Error("list sticker packs failed", zap.Error(err))
		InternalError(c, "list sticker packs failed")
		return
	}
	Success(c, gin.H{"packs": packs})
}
