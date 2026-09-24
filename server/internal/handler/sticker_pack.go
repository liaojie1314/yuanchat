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
		// 业务码 4003：HTTP 400 之下再给独立业务码，前端按 code 而非 message 识别
		// （沿用 file.go 4001/4002、message.go 4031 的「HTTP 状态 + 数字业务码」惯例）
		Error(c, http.StatusBadRequest, 4003, "publish limit exceeded")
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

// ---------- 自主发布与编辑管理 ----------

// StickerSourceBody 发布/追加贴纸的单张来源请求体。
type StickerSourceBody struct {
	Source      string    `json:"source" binding:"required,oneof=collection upload"`
	StickerID   uuid.UUID `json:"sticker_id"`
	ObjectKey   string    `json:"object_key"`
	Width       int       `json:"width"`
	Height      int       `json:"height"`
	ContentHash string    `json:"content_hash"`
}

// toService 转成 service 层入参。
func (b StickerSourceBody) toService() service.StickerSource {
	return service.StickerSource{
		Source:      b.Source,
		StickerID:   b.StickerID,
		ObjectKey:   b.ObjectKey,
		Width:       b.Width,
		Height:      b.Height,
		ContentHash: b.ContentHash,
	}
}

// PublishPackBody 发布请求体。cover_width/cover_height 供前端展示用，服务端不落库。
type PublishPackBody struct {
	Name           string              `json:"name" binding:"required,max=64"`
	CoverObjectKey string              `json:"cover_object_key"`
	CoverWidth     int                 `json:"cover_width"`
	CoverHeight    int                 `json:"cover_height"`
	StickerSources []StickerSourceBody `json:"sticker_sources" binding:"required,min=1,max=500"`
}

// Publish 发布一个公开的表情包（POST /sticker-packs）。
//
//	@Summary		发布表情包（一步创建即公开）
//	@Tags			stickers
//	@Security		BearerAuth
//	@Param			body	body	PublishPackBody	true	"包名、封面与贴纸来源"
//	@Success		200	{object}	Response
//	@Failure		400	{object}	Response	"包名非法 / 来源缺失 / 发布数达上限"
//	@Router			/api/v1/sticker-packs [post]
func (h *StickerHandler) Publish(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	var body PublishPackBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}
	in := service.PublishInput{
		Name:           body.Name,
		CoverObjectKey: body.CoverObjectKey,
		CoverWidth:     body.CoverWidth,
		CoverHeight:    body.CoverHeight,
	}
	for _, src := range body.StickerSources {
		in.StickerSources = append(in.StickerSources, src.toService())
	}
	detail, err := h.svc.Publish(c.Request.Context(), userID, in)
	if err != nil {
		respondPackError(c, h.logger, "publish sticker pack", err)
		return
	}
	Success(c, detail)
}

// UpdatePackBody 编辑请求体；空串字段表示不修改。
type UpdatePackBody struct {
	Name           string `json:"name"`
	CoverObjectKey string `json:"cover_object_key"`
	CoverWidth     int    `json:"cover_width"`
	CoverHeight    int    `json:"cover_height"`
}

// UpdatePack 编辑本人发布的包（PATCH /sticker-packs/:id，仅本人）。
//
//	@Summary		编辑已发布的表情包（改名/换封面）
//	@Tags			stickers
//	@Security		BearerAuth
//	@Param			id		path	string			true	"表情包 id"
//	@Param			body	body	UpdatePackBody	true	"要修改的字段（空串跳过）"
//	@Success		200	{object}	Response
//	@Router			/api/v1/sticker-packs/{id} [patch]
func (h *StickerHandler) UpdatePack(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	packID, ok := parsePathUUID(c, "id")
	if !ok {
		return
	}
	var body UpdatePackBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}
	detail, err := h.svc.UpdatePack(c.Request.Context(), userID, packID, service.UpdatePackInput{
		Name:           body.Name,
		CoverObjectKey: body.CoverObjectKey,
		CoverWidth:     body.CoverWidth,
		CoverHeight:    body.CoverHeight,
	})
	if err != nil {
		respondPackError(c, h.logger, "update sticker pack", err)
		return
	}
	Success(c, detail)
}

// AddPackSticker 给已发布的包追加一张贴纸（POST /sticker-packs/:id/stickers，仅本人）。
//
//	@Summary		给已发布的包追加贴纸
//	@Tags			stickers
//	@Security		BearerAuth
//	@Param			id		path	string				true	"表情包 id"
//	@Param			body	body	StickerSourceBody	true	"贴纸来源"
//	@Success		200	{object}	Response
//	@Router			/api/v1/sticker-packs/{id}/stickers [post]
func (h *StickerHandler) AddPackSticker(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	packID, ok := parsePathUUID(c, "id")
	if !ok {
		return
	}
	var body StickerSourceBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}
	if err := h.svc.AddPackSticker(c.Request.Context(), userID, packID, body.toService()); err != nil {
		respondPackError(c, h.logger, "add pack sticker", err)
		return
	}
	Success(c, gin.H{"message": "added"})
}

// RemovePackSticker 从包中移除一张贴纸（DELETE /sticker-packs/:id/stickers/:stickerId，仅本人；
// 不校验"至少保留一张"，空包允许存在）。
//
//	@Summary		从已发布的包移除贴纸
//	@Tags			stickers
//	@Security		BearerAuth
//	@Param			id			path	string	true	"表情包 id"
//	@Param			stickerId	path	string	true	"贴纸 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/sticker-packs/{id}/stickers/{stickerId} [delete]
func (h *StickerHandler) RemovePackSticker(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	packID, ok := parsePathUUID(c, "id")
	if !ok {
		return
	}
	stickerID, ok := parsePathUUID(c, "stickerId")
	if !ok {
		return
	}
	if err := h.svc.RemovePackSticker(c.Request.Context(), userID, packID, stickerID); err != nil {
		respondPackError(c, h.logger, "remove pack sticker", err)
		return
	}
	Success(c, gin.H{"message": "removed"})
}

// ListMyPacks 我发布的包（GET /sticker-packs/mine）。
//
//	@Summary		我发布的表情包列表
//	@Tags			stickers
//	@Security		BearerAuth
//	@Success		200	{object}	Response
//	@Router			/api/v1/sticker-packs/mine [get]
func (h *StickerHandler) ListMyPacks(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	packs, err := h.svc.ListMinePacks(c.Request.Context(), userID)
	if err != nil {
		respondPackError(c, h.logger, "list my packs", err)
		return
	}
	Success(c, gin.H{"packs": packs})
}

// DeleteMinePack 删除本人发布的包（DELETE /sticker-packs/:id，仅本人；级联清理包内贴纸
// 与所有用户的添加关系——发布者主动撤回的预期行为）。
//
//	@Summary		删除我发布的表情包
//	@Tags			stickers
//	@Security		BearerAuth
//	@Param			id	path	string	true	"表情包 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/sticker-packs/{id} [delete]
func (h *StickerHandler) DeleteMinePack(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	packID, ok := parsePathUUID(c, "id")
	if !ok {
		return
	}
	if err := h.svc.DeleteMine(c.Request.Context(), userID, packID); err != nil {
		respondPackError(c, h.logger, "delete sticker pack", err)
		return
	}
	Success(c, gin.H{"message": "deleted"})
}
