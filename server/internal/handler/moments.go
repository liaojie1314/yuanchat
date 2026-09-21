package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/service"
	"go.uber.org/zap"
)

// MomentsHandler 朋友圈 REST 端点。
type MomentsHandler struct {
	svc    *service.MomentsService
	logger *zap.Logger
}

// NewMomentsHandler 创建朋友圈端点处理器。
func NewMomentsHandler(svc *service.MomentsService, logger *zap.Logger) *MomentsHandler {
	return &MomentsHandler{svc: svc, logger: logger}
}

// CreateMomentRequest 发布动态请求体。
//
// binding 的 max 按字节/元素数计，中文会比预期更早触顶，故它只当粗筛挡超大 body；
// 真正的长度语义校验在 service 层按 rune 做。
type CreateMomentRequest struct {
	Content    string                  `json:"content" binding:"max=1000"`
	Media      []model.MomentMediaItem `json:"media" binding:"max=9,dive"`
	MediaKind  int16                   `json:"media_kind" binding:"oneof=0 1 2"`
	Visibility int16                   `json:"visibility" binding:"oneof=0 1"`
}

// AddMomentCommentRequest 评论请求体。
type AddMomentCommentRequest struct {
	Content       string     `json:"content" binding:"required,max=500"`
	ReplyToUserID *uuid.UUID `json:"reply_to_user_id"`
}

// MarkActivitiesReadRequest 标已读；ids 为空表示全部标已读。
type MarkActivitiesReadRequest struct {
	IDs []uuid.UUID `json:"ids"`
}

// feedLimit 解析 limit 参数，钳到 [1, 20]，缺省 20。
//
// 上限 20 是与媒体签名成本绑的：一页 20 帖 × 9 图 = 180 个对象，
// 客户端逐个换签已是极限，再放大会把首屏拖垮。
func feedLimit(c *gin.Context) int {
	n, err := strconv.Atoi(c.Query("limit"))
	if err != nil || n <= 0 || n > 20 {
		return 20
	}
	return n
}

// fail 把 service 的错误哨兵映射成 HTTP 状态。
//
// ErrMomentNotFound 同时覆盖「不存在」与「对我不可见」，统一回 404：
// 若不可见回 403 而不存在回 404，攻击者能靠状态码差异探测帖子是否存在。
func (h *MomentsHandler) fail(c *gin.Context, err error, msg string) {
	switch {
	case errors.Is(err, service.ErrMomentNotFound):
		NotFound(c, "moment not found")
	case errors.Is(err, service.ErrMomentForbidden):
		Error(c, http.StatusForbidden, 403, "forbidden")
	case errors.Is(err, service.ErrMomentInvalidMedia):
		BadRequest(c, err.Error())
	default:
		h.logger.Error(msg, zap.Error(err))
		InternalError(c, msg)
	}
}

// userID 取当前登录用户；取不到时已写好 401 响应。
func (h *MomentsHandler) userID(c *gin.Context) (uuid.UUID, bool) {
	id, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return uuid.Nil, false
	}
	return id, true
}

// pathID 解析路径里的 UUID；失败时已写好 400 响应。
func (h *MomentsHandler) pathID(c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid id")
		return uuid.Nil, false
	}
	return id, true
}

// Create 发布动态。
//
//	@Summary	发布动态
//	@Tags		moments
//	@Security	BearerAuth
//	@Router		/api/v1/moments [post]
func (h *MomentsHandler) Create(c *gin.Context) {
	userID, ok := h.userID(c)
	if !ok {
		return
	}
	var body CreateMomentRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}
	dto, err := h.svc.CreatePost(c.Request.Context(), userID, service.CreatePostInput{
		Content:    body.Content,
		Media:      body.Media,
		MediaKind:  body.MediaKind,
		Visibility: body.Visibility,
	})
	if err != nil {
		h.fail(c, err, "create moment failed")
		return
	}
	Created(c, dto)
}

// Feed 信息流。
//
//	@Summary	信息流
//	@Tags		moments
//	@Security	BearerAuth
//	@Router		/api/v1/moments/feed [get]
func (h *MomentsHandler) Feed(c *gin.Context) {
	userID, ok := h.userID(c)
	if !ok {
		return
	}
	page, err := h.svc.Feed(c.Request.Context(), userID, c.Query("cursor"), feedLimit(c))
	if err != nil {
		h.fail(c, err, "feed failed")
		return
	}
	Success(c, page)
}

// UserPosts 某人的主页帖子。
//
//	@Summary	用户动态
//	@Tags		moments
//	@Security	BearerAuth
//	@Router		/api/v1/moments/user/{id} [get]
func (h *MomentsHandler) UserPosts(c *gin.Context) {
	userID, ok := h.userID(c)
	if !ok {
		return
	}
	authorID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid user id")
		return
	}
	page, err := h.svc.UserPosts(c.Request.Context(), userID, authorID, c.Query("cursor"), feedLimit(c))
	if err != nil {
		h.fail(c, err, "user posts failed")
		return
	}
	Success(c, page)
}

// Get 单帖。
//
//	@Summary	单条动态
//	@Tags		moments
//	@Security	BearerAuth
//	@Router		/api/v1/moments/{id} [get]
func (h *MomentsHandler) Get(c *gin.Context) {
	userID, ok := h.userID(c)
	if !ok {
		return
	}
	postID, ok := h.pathID(c)
	if !ok {
		return
	}
	dto, err := h.svc.Post(c.Request.Context(), userID, postID)
	if err != nil {
		h.fail(c, err, "get moment failed")
		return
	}
	Success(c, dto)
}

// Delete 删除自己的动态。
//
//	@Summary	删除动态
//	@Tags		moments
//	@Security	BearerAuth
//	@Router		/api/v1/moments/{id} [delete]
func (h *MomentsHandler) Delete(c *gin.Context) {
	userID, ok := h.userID(c)
	if !ok {
		return
	}
	postID, ok := h.pathID(c)
	if !ok {
		return
	}
	if err := h.svc.DeletePost(c.Request.Context(), userID, postID); err != nil {
		h.fail(c, err, "delete moment failed")
		return
	}
	Success(c, gin.H{"deleted": true})
}

// Like 点赞。
//
//	@Summary	点赞
//	@Tags		moments
//	@Security	BearerAuth
//	@Router		/api/v1/moments/{id}/like [post]
func (h *MomentsHandler) Like(c *gin.Context) {
	h.setLike(c, true)
}

// Unlike 取消点赞。
//
//	@Summary	取消点赞
//	@Tags		moments
//	@Security	BearerAuth
//	@Router		/api/v1/moments/{id}/like [delete]
func (h *MomentsHandler) Unlike(c *gin.Context) {
	h.setLike(c, false)
}

// setLike 点赞与取消点赞共用同一处理（差别只在目标状态）。
func (h *MomentsHandler) setLike(c *gin.Context, liked bool) {
	userID, ok := h.userID(c)
	if !ok {
		return
	}
	postID, ok := h.pathID(c)
	if !ok {
		return
	}
	if err := h.svc.SetLike(c.Request.Context(), userID, postID, liked); err != nil {
		h.fail(c, err, "set moment like failed")
		return
	}
	Success(c, gin.H{"liked": liked})
}

// AddComment 发表评论。
//
//	@Summary	发表评论
//	@Tags		moments
//	@Security	BearerAuth
//	@Router		/api/v1/moments/{id}/comments [post]
func (h *MomentsHandler) AddComment(c *gin.Context) {
	userID, ok := h.userID(c)
	if !ok {
		return
	}
	postID, ok := h.pathID(c)
	if !ok {
		return
	}
	var body AddMomentCommentRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}
	dto, err := h.svc.AddComment(c.Request.Context(), userID, postID, body.Content, body.ReplyToUserID)
	if err != nil {
		h.fail(c, err, "add moment comment failed")
		return
	}
	Created(c, dto)
}

// DeleteComment 删除评论（评论作者或帖子作者）。
//
//	@Summary	删除评论
//	@Tags		moments
//	@Security	BearerAuth
//	@Router		/api/v1/moments/comments/{id} [delete]
func (h *MomentsHandler) DeleteComment(c *gin.Context) {
	userID, ok := h.userID(c)
	if !ok {
		return
	}
	commentID, ok := h.pathID(c)
	if !ok {
		return
	}
	if err := h.svc.DeleteComment(c.Request.Context(), userID, commentID); err != nil {
		h.fail(c, err, "delete moment comment failed")
		return
	}
	Success(c, gin.H{"deleted": true})
}

// Activities 互动消息列表。
//
//	@Summary	互动消息
//	@Tags		moments
//	@Security	BearerAuth
//	@Router		/api/v1/moments/activities [get]
func (h *MomentsHandler) Activities(c *gin.Context) {
	userID, ok := h.userID(c)
	if !ok {
		return
	}
	page, err := h.svc.Activities(c.Request.Context(), userID, c.Query("cursor"), feedLimit(c))
	if err != nil {
		h.fail(c, err, "list moment activities failed")
		return
	}
	Success(c, page)
}

// MarkRead 标记互动消息已读。
//
//	@Summary	标记互动已读
//	@Tags		moments
//	@Security	BearerAuth
//	@Router		/api/v1/moments/activities/read [post]
func (h *MomentsHandler) MarkRead(c *gin.Context) {
	userID, ok := h.userID(c)
	if !ok {
		return
	}
	var body MarkActivitiesReadRequest
	if err := c.ShouldBindJSON(&body); err != nil && err.Error() != "EOF" {
		BadRequest(c, err.Error())
		return
	}
	if err := h.svc.MarkActivitiesRead(c.Request.Context(), userID, body.IDs); err != nil {
		h.fail(c, err, "mark moment activities read failed")
		return
	}
	Success(c, gin.H{"read": true})
}
