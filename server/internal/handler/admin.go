package handler

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/service"
	"github.com/yuanchat/server/internal/storage"
	"github.com/yuanchat/server/internal/ws"
	"go.uber.org/zap"
)

// AdminHandler 管理后台端点（全部挂 RequireAdmin）。
type AdminHandler struct {
	svc        *service.AdminService
	hub        *ws.Hub
	dispatcher ws.Dispatcher
	// st 对象存储句柄：管理端媒体预览签发预签名 GET 用，可能为 nil（MinIO 不可达时降级 503）。
	st *storage.Storage
	// msgSvc 消息服务：编辑历史取证复用其 EditHistoryForAdmin，
	// 避免在 AdminService 里重写一份版本拼装（与 buildVersions 重复且易漂移）。
	msgSvc *service.MessageService
	logger *zap.Logger
}

// NewAdminHandler 装配管理端 handler。st / msgSvc 允许为 nil，
// 对应端点各自降级（媒体预览 503、编辑历史 503），不影响其余端点。
func NewAdminHandler(
	svc *service.AdminService,
	hub *ws.Hub,
	st *storage.Storage,
	msgSvc *service.MessageService,
	logger *zap.Logger,
) *AdminHandler {
	return &AdminHandler{svc: svc, hub: hub, dispatcher: hub, st: st, msgSvc: msgSvc, logger: logger}
}

// mediaURLTTL 管理端预签名下载 URL 有效期。
// 比用户侧 downloadURLTTL 短：审核员看完即弃，URL 落入日志或误转发的窗口越小越好。
const mediaURLTTL = 10 * time.Minute

// pageParams 解析 page/size 查询参数（1 起，size 上限 100）。
func pageParams(c *gin.Context) (int, int) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 20
	}
	return page, size
}

// ListUsers 分页检索用户。
//
//	@Summary		管理端：用户列表 / 搜索
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			q		query	string	false	"昵称 / 手机号 / 邮箱模糊匹配"
//	@Param			page	query	int		false	"页码（从 1 开始）"
//	@Param			size	query	int		false	"每页条数（上限 100）"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/users [get]
func (h *AdminHandler) ListUsers(c *gin.Context) {
	page, size := pageParams(c)
	users, total, err := h.svc.SearchUsers(c.Request.Context(), c.Query("q"), page, size)
	if err != nil {
		h.logger.Error("admin list users failed", zap.Error(err))
		InternalError(c, "list users failed")
		return
	}
	Paginated(c, users, total, page, size)
}

// BanUser 封禁用户并踢下线。
//
//	@Summary		管理端：封禁用户
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			id	path	string	true	"用户 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/users/{id}/ban [post]
func (h *AdminHandler) BanUser(c *gin.Context) {
	actorID, _ := middleware.GetUserID(c)
	targetID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid user id")
		return
	}
	if err := h.svc.BanUser(c.Request.Context(), actorID, targetID); err != nil {
		switch {
		case errors.Is(err, service.ErrAdminSelfBan):
			Error(c, http.StatusBadRequest, 400, "cannot ban yourself")
		case errors.Is(err, service.ErrUserNotFound):
			NotFound(c, "user not found")
		default:
			h.logger.Error("admin ban user failed", zap.Error(err))
			InternalError(c, "ban user failed")
		}
		return
	}
	kicked := h.hub.DisconnectUser(targetID)
	Success(c, gin.H{"banned": true, "kicked_connections": kicked})
}

// UnbanUser 解封用户。
//
//	@Summary		管理端：解封用户
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			id	path	string	true	"用户 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/users/{id}/ban [delete]
func (h *AdminHandler) UnbanUser(c *gin.Context) {
	actorID, _ := middleware.GetUserID(c)
	targetID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid user id")
		return
	}
	if err := h.svc.UnbanUser(c.Request.Context(), actorID, targetID); err != nil {
		if errors.Is(err, service.ErrUserNotFound) {
			NotFound(c, "user not found")
			return
		}
		h.logger.Error("admin unban user failed", zap.Error(err))
		InternalError(c, "unban user failed")
		return
	}
	Success(c, gin.H{"banned": false})
}

// ResetAvatar 管理端重置用户头像：avatar_url 置空，恢复默认头像。
//
//	@Summary		管理端：重置用户头像
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			id	path	string	true	"用户 id"
//	@Success		200	{object}	Response
//	@Failure		404	{object}	Response	"用户不存在"
//	@Router			/api/v1/admin/users/{id}/reset-avatar [post]
func (h *AdminHandler) ResetAvatar(c *gin.Context) {
	actorID, _ := middleware.GetUserID(c)
	targetID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid user id")
		return
	}
	if err := h.svc.ResetAvatar(c.Request.Context(), actorID, targetID); err != nil {
		if errors.Is(err, service.ErrUserNotFound) {
			NotFound(c, "user not found")
			return
		}
		h.logger.Error("admin reset avatar failed", zap.Error(err))
		InternalError(c, "reset avatar failed")
		return
	}
	Success(c, gin.H{"reset": true})
}

// ListConversations 分页检索会话。
//
//	@Summary		管理端：会话列表 / 搜索
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			q		query	string	false	"群名模糊匹配"
//	@Param			type	query	int		false	"1=单聊 2=群聊（0=全部）"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/conversations [get]
func (h *AdminHandler) ListConversations(c *gin.Context) {
	page, size := pageParams(c)
	convType, _ := strconv.ParseInt(c.DefaultQuery("type", "0"), 10, 16)
	convs, total, err := h.svc.SearchConversations(c.Request.Context(), c.Query("q"), int16(convType), page, size)
	if err != nil {
		h.logger.Error("admin list conversations failed", zap.Error(err))
		InternalError(c, "list conversations failed")
		return
	}
	Paginated(c, convs, total, page, size)
}

// DissolveConversation 管理员强制解散会话。
//
//	@Summary		管理端：解散会话
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			id	path	string	true	"会话 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/conversations/{id}/dissolve [post]
func (h *AdminHandler) DissolveConversation(c *gin.Context) {
	actorID, _ := middleware.GetUserID(c)
	convID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid conversation id")
		return
	}
	memberIDs, err := h.svc.DissolveConversation(c.Request.Context(), actorID, convID)
	if err != nil {
		if errors.Is(err, service.ErrConversationNotFound) {
			NotFound(c, "conversation not found")
			return
		}
		h.logger.Error("admin dissolve conversation failed", zap.Error(err))
		InternalError(c, "dissolve conversation failed")
		return
	}
	if frame, encErr := ws.Encode(ws.TypeConversationRemoved, ws.ConversationRemovedPayload{
		ConversationID: convID,
		Reason:         "dissolved",
	}); encErr == nil {
		h.dispatcher.SendToUsers(memberIDs, frame)
	}
	Success(c, gin.H{"dissolved": true, "notified_members": len(memberIDs)})
}

// ListMessages 分页检索消息（flagged=true 只看审核队列）。
//
//	@Summary		管理端：消息列表 / 搜索
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			q		query	string	false	"正文模糊匹配"
//	@Param			flagged	query	bool	false	"仅被标记的消息"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/messages [get]
func (h *AdminHandler) ListMessages(c *gin.Context) {
	page, size := pageParams(c)
	flagged := c.Query("flagged") == "true"
	msgs, total, err := h.svc.SearchMessages(c.Request.Context(), c.Query("q"), flagged, page, size)
	if err != nil {
		h.logger.Error("admin list messages failed", zap.Error(err))
		InternalError(c, "list messages failed")
		return
	}
	Paginated(c, msgs, total, page, size)
}

// DeleteMessage 管理员删除一条消息。
//
//	@Summary		管理端：删除消息
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			id	path	string	true	"消息 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/messages/{id} [delete]
func (h *AdminHandler) DeleteMessage(c *gin.Context) {
	actorID, _ := middleware.GetUserID(c)
	messageID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid message id")
		return
	}
	if err := h.svc.DeleteMessage(c.Request.Context(), actorID, messageID); err != nil {
		if errors.Is(err, service.ErrMessageNotFound) {
			NotFound(c, "message not found")
			return
		}
		h.logger.Error("admin delete message failed", zap.Error(err))
		InternalError(c, "delete message failed")
		return
	}
	Success(c, gin.H{"deleted": true})
}

// DeleteMomentPost 管理员删除一条朋友圈动态。
//
//	@Summary		管理端：删除朋友圈动态
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			id	path	string	true	"动态 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/moments/{id} [delete]
func (h *AdminHandler) DeleteMomentPost(c *gin.Context) {
	actorID, _ := middleware.GetUserID(c)
	postID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid post id")
		return
	}
	if err := h.svc.DeleteMomentPost(c.Request.Context(), actorID, postID); err != nil {
		if errors.Is(err, service.ErrMomentPostNotFound) {
			NotFound(c, "moment post not found")
			return
		}
		h.logger.Error("admin delete moment post failed", zap.Error(err))
		InternalError(c, "delete moment post failed")
		return
	}
	Success(c, gin.H{"deleted": true})
}

// DeleteMomentComment 管理员删除一条朋友圈评论。
//
//	@Summary		管理端：删除朋友圈评论
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			id	path	string	true	"评论 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/moments/comments/{id} [delete]
func (h *AdminHandler) DeleteMomentComment(c *gin.Context) {
	actorID, _ := middleware.GetUserID(c)
	commentID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid comment id")
		return
	}
	if err := h.svc.DeleteMomentComment(c.Request.Context(), actorID, commentID); err != nil {
		if errors.Is(err, service.ErrMomentCommentNotFound) {
			NotFound(c, "moment comment not found")
			return
		}
		h.logger.Error("admin delete moment comment failed", zap.Error(err))
		InternalError(c, "delete moment comment failed")
		return
	}
	Success(c, gin.H{"deleted": true})
}

// ListAuditLogs 分页列出审计日志。
//
//	@Summary		管理端：审计日志列表
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			actor	query	string	false	"操作者用户 id"
//	@Param			action	query	string	false	"按动作过滤"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/audit-logs [get]
func (h *AdminHandler) ListAuditLogs(c *gin.Context) {
	page, size := pageParams(c)
	var actorID *uuid.UUID
	if raw := c.Query("actor"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			BadRequest(c, "invalid actor id")
			return
		}
		actorID = &id
	}
	logs, total, err := h.svc.ListLogs(c.Request.Context(), actorID, c.Query("action"), page, size)
	if err != nil {
		h.logger.Error("admin list audit logs failed", zap.Error(err))
		InternalError(c, "list audit logs failed")
		return
	}
	Paginated(c, logs, total, page, size)
}

// ClearMessageFlag 审核通过：清除消息 flagged 标记。
//
//	@Summary		管理端：清除消息标记（判定通过）
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			id	path	string	true	"消息 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/messages/{id}/flag [delete]
func (h *AdminHandler) ClearMessageFlag(c *gin.Context) {
	actorID, _ := middleware.GetUserID(c)
	messageID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid message id")
		return
	}
	if err := h.svc.ClearMessageFlag(c.Request.Context(), actorID, messageID); err != nil {
		if errors.Is(err, service.ErrMessageNotFound) {
			NotFound(c, "message not found")
			return
		}
		h.logger.Error("admin clear flag failed", zap.Error(err))
		InternalError(c, "clear flag failed")
		return
	}
	Success(c, gin.H{"flagged": false})
}

// ListStickerPacks 分页检索表情包（flagged=true 只看审核队列）。
//
//	@Summary		管理端：表情包列表 / 搜索
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			q			query	string	false	"包名模糊匹配"
//	@Param			flagged	query	bool	false	"仅敏感词命中的包"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/sticker-packs [get]
func (h *AdminHandler) ListStickerPacks(c *gin.Context) {
	page, size := pageParams(c)
	flagged := c.Query("flagged") == "true"
	packs, total, err := h.svc.SearchStickerPacks(c.Request.Context(), c.Query("q"), flagged, page, size)
	if err != nil {
		h.logger.Error("admin list sticker packs failed", zap.Error(err))
		InternalError(c, "list sticker packs failed")
		return
	}
	Paginated(c, packs, total, page, size)
}

// TakeDownStickerPack 管理员直接下架表情包（软下架：商城不再展示，已添加者保留）。
//
//	@Summary		管理端：下架表情包
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			id	path	string	true	"表情包 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/sticker-packs/{id}/takedown [post]
func (h *AdminHandler) TakeDownStickerPack(c *gin.Context) {
	actorID, _ := middleware.GetUserID(c)
	packID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid sticker pack id")
		return
	}
	if err := h.svc.TakeDownStickerPack(c.Request.Context(), actorID, packID); err != nil {
		if errors.Is(err, service.ErrPackNotFound) {
			NotFound(c, "sticker pack not found")
			return
		}
		h.logger.Error("admin take down sticker pack failed", zap.Error(err))
		InternalError(c, "take down sticker pack failed")
		return
	}
	Success(c, gin.H{"taken_down": true})
}

// ClearStickerPackFlag 审核通过：清除表情包敏感词标记。
//
//	@Summary		管理端：清除表情包标记
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			id	path	string	true	"表情包 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/sticker-packs/{id}/flag [delete]
func (h *AdminHandler) ClearStickerPackFlag(c *gin.Context) {
	actorID, _ := middleware.GetUserID(c)
	packID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid sticker pack id")
		return
	}
	if err := h.svc.ClearStickerPackFlag(c.Request.Context(), actorID, packID); err != nil {
		if errors.Is(err, service.ErrPackNotFound) {
			NotFound(c, "sticker pack not found")
			return
		}
		h.logger.Error("admin clear sticker pack flag failed", zap.Error(err))
		InternalError(c, "clear sticker pack flag failed")
		return
	}
	Success(c, gin.H{"flagged": false})
}

// UntakeDownStickerPack 恢复表情包上架（清 taken_down，商城重新展示）。
//
//	@Summary		管理端：恢复上架表情包
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			id	path	string	true	"表情包 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/sticker-packs/{id}/untakedown [post]
func (h *AdminHandler) UntakeDownStickerPack(c *gin.Context) {
	actorID, _ := middleware.GetUserID(c)
	packID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid sticker pack id")
		return
	}
	if err := h.svc.UntakeDownStickerPack(c.Request.Context(), actorID, packID); err != nil {
		if errors.Is(err, service.ErrPackNotFound) {
			NotFound(c, "sticker pack not found")
			return
		}
		h.logger.Error("admin untake down sticker pack failed", zap.Error(err))
		InternalError(c, "untake down sticker pack failed")
		return
	}
	Success(c, gin.H{"taken_down": false})
}

// SetPackOfficialBody 官方标识切换请求体（显式目标值，避免并发下 toggle 语义歧义）。
type SetPackOfficialBody struct {
	// IsOfficial 目标状态：true=标记官方，false=取消官方
	IsOfficial *bool `json:"is_official" binding:"required"`
}

// SetStickerPackOfficial 设置表情包的官方标识（is_official）。
//
//	@Summary		管理端：切换表情包官方标识
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			id		path	string	true	"表情包 id"
//	@Param			body	body	SetPackOfficialBody	true	"目标状态"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/sticker-packs/{id}/official [post]
func (h *AdminHandler) SetStickerPackOfficial(c *gin.Context) {
	actorID, _ := middleware.GetUserID(c)
	packID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid sticker pack id")
		return
	}
	var body SetPackOfficialBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, "invalid body: is_official is required")
		return
	}
	if err := h.svc.SetStickerPackOfficial(c.Request.Context(), actorID, packID, *body.IsOfficial); err != nil {
		if errors.Is(err, service.ErrPackNotFound) {
			NotFound(c, "sticker pack not found")
			return
		}
		h.logger.Error("admin set sticker pack official failed", zap.Error(err))
		InternalError(c, "set sticker pack official failed")
		return
	}
	Success(c, gin.H{"is_official": *body.IsOfficial})
}

// ListReports 分页列出举报。
//
//	@Summary		管理端：举报列表
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			status	query	int	false	"-1=全部 0=待处理 1=保留 2=已删除（默认 0）"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/reports [get]
func (h *AdminHandler) ListReports(c *gin.Context) {
	page, size := pageParams(c)
	status, err := strconv.ParseInt(c.DefaultQuery("status", "0"), 10, 16)
	if err != nil {
		BadRequest(c, "invalid status")
		return
	}
	reports, total, listErr := h.svc.ListReports(c.Request.Context(), int16(status), page, size)
	if listErr != nil {
		h.logger.Error("admin list reports failed", zap.Error(listErr))
		InternalError(c, "list reports failed")
		return
	}
	Paginated(c, reports, total, page, size)
}

// HandleReportBody 举报处理请求体。
type HandleReportBody struct {
	// Action: keep=保留内容, delete=删除目标消息
	Action string `json:"action" binding:"required,oneof=keep delete"`
}

// HandleReport 处理一条举报。
//
//	@Summary		管理端：处理举报
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			id	path	string	true	"举报 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/reports/{id}/handle [post]
func (h *AdminHandler) HandleReport(c *gin.Context) {
	actorID, _ := middleware.GetUserID(c)
	reportID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid report id")
		return
	}
	var body HandleReportBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}
	if err := h.svc.HandleReport(c.Request.Context(), actorID, reportID, body.Action == "delete"); err != nil {
		switch {
		case errors.Is(err, service.ErrReportNotFound):
			NotFound(c, "report not found")
		case errors.Is(err, service.ErrAdminSelfBan):
			// 举报目标 user 且目标是管理员本人：封禁被拒
			Error(c, http.StatusBadRequest, 400, "cannot ban yourself")
		case errors.Is(err, service.ErrUserNotFound):
			// 举报目标 user 但用户已注销：按目标不存在返回
			NotFound(c, "user not found")
		default:
			h.logger.Error("admin handle report failed", zap.Error(err))
			InternalError(c, "handle report failed")
		}
		return
	}
	Success(c, gin.H{"handled": true})
}

// MessageMedia 为消息引用的媒体对象签发短期预签名下载 URL（管理端专用读通道）。
//
// 授权模型：不走用户侧 ObjectACL（举报人可见性）——管理端授权由路由层的
// JWT + RequireAdmin 双重校验承担，审核员无需处于举报人上下文即可查看
// 图片 / 语音 / 文件 / 贴纸内容。URL 有效期短（mediaURLTTL），只够一次审核浏览。
//
//	@Summary		管理端：消息媒体预签名下载 URL
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			id	path	string	true	"消息 id"
//	@Success		200	{object}	Response
//	@Failure		404	{object}	Response	"消息不存在 / 该类型无媒体对象"
//	@Failure		503	{object}	Response	"对象存储不可用"
//	@Router			/api/v1/admin/messages/{id}/media [get]
func (h *AdminHandler) MessageMedia(c *gin.Context) {
	messageID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid message id")
		return
	}
	media, err := h.svc.MessageMedia(c.Request.Context(), messageID)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrMessageNotFound):
			NotFound(c, "message not found")
		case errors.Is(err, service.ErrMessageMediaNotSupported):
			NotFound(c, "message has no media object")
		default:
			h.logger.Error("admin message media failed", zap.Error(err))
			InternalError(c, "resolve message media failed")
		}
		return
	}
	if h.st == nil {
		Error(c, http.StatusServiceUnavailable, 503, "object storage unavailable")
		return
	}
	url, err := h.st.PresignGet(c.Request.Context(), media.ObjectKey, mediaURLTTL)
	if err != nil {
		h.logger.Error("admin presign media failed",
			zap.String("object_key", media.ObjectKey), zap.Error(err))
		InternalError(c, "failed to sign media url")
		return
	}
	Success(c, gin.H{
		"url":          url,
		"expires_in":   int(mediaURLTTL.Seconds()),
		"message_type": media.MessageType,
		"object_key":   media.ObjectKey,
		"file_name":    media.FileName,
		"width":        media.Width,
		"height":       media.Height,
		"duration":     media.Duration,
	})
}

// MessageEditHistory 取消息编辑历史（管理端取证，跳过成员与清空水位校验）。
//
// 查看动作本身写审计：编辑历史含用户已改掉的原文，属敏感取证数据，
// 谁看过必须留痕（与其余 /admin/* 写操作同口径）。
//
//	@Summary		管理端：消息编辑历史
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			id	path		string	true	"消息 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/messages/{id}/edits [get]
func (h *AdminHandler) MessageEditHistory(c *gin.Context) {
	actorID, _ := middleware.GetUserID(c)
	messageID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid message id")
		return
	}
	if h.msgSvc == nil {
		Error(c, http.StatusServiceUnavailable, 503, "message service unavailable")
		return
	}
	versions, err := h.msgSvc.EditHistoryForAdmin(c.Request.Context(), messageID)
	if err != nil {
		if errors.Is(err, service.ErrMessageNotFound) {
			NotFound(c, "message not found")
			return
		}
		h.logger.Error("admin load edit history failed", zap.Error(err))
		InternalError(c, "load edit history failed")
		return
	}
	h.svc.AuditMessageEditsView(c.Request.Context(), actorID, messageID)
	Success(c, gin.H{"versions": versions})
}

// ListFlaggedUGC 分页列出 UGC 敏感词命中记录（昵称 / bio / 群名 / 群公告）。
//
//	@Summary		管理端：UGC 审核队列
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			type		query	string	false	"按类型过滤：nickname|bio|group_name|announcement"
//	@Param			handled		query	string	false	"true=已处置 false=待处理（默认）all=全部"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/flagged-ugc [get]
func (h *AdminHandler) ListFlaggedUGC(c *gin.Context) {
	page, size := pageParams(c)
	// status 三态：false/缺省=只看待处理（审核队列主视图）、true=只看已处置、all=全部
	status := "pending"
	switch c.Query("handled") {
	case "true":
		status = "handled"
	case "all":
		status = ""
	}
	list, total, err := h.svc.SearchFlaggedUGC(c.Request.Context(), c.Query("type"), status, page, size)
	if err != nil {
		h.logger.Error("admin list flagged ugc failed", zap.Error(err))
		InternalError(c, "list flagged ugc failed")
		return
	}
	Paginated(c, list, total, page, size)
}

// ResetFlaggedUGC 强制重置命中的 UGC：昵称重置为默认昵称、bio / 群名 / 公告清空，
// 记录关闭并写审计。
//
//	@Summary		管理端：强制重置命中的 UGC
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			id	path	string	true	"命中记录 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/flagged-ugc/{id}/reset [post]
func (h *AdminHandler) ResetFlaggedUGC(c *gin.Context) {
	actorID, _ := middleware.GetUserID(c)
	recordID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid record id")
		return
	}
	if err := h.svc.ResetFlaggedUGC(c.Request.Context(), actorID, recordID); err != nil {
		if errors.Is(err, service.ErrFlaggedUGCNotFound) {
			NotFound(c, "flagged ugc not found")
			return
		}
		h.logger.Error("admin reset flagged ugc failed", zap.Error(err))
		InternalError(c, "reset flagged ugc failed")
		return
	}
	Success(c, gin.H{"reset": true})
}

// DismissFlaggedUGC 审核通过：命中记录置为已处置，内容维持原样。
//
//	@Summary		管理端：放行命中的 UGC
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			id	path	string	true	"命中记录 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/flagged-ugc/{id} [delete]
func (h *AdminHandler) DismissFlaggedUGC(c *gin.Context) {
	actorID, _ := middleware.GetUserID(c)
	recordID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid record id")
		return
	}
	if err := h.svc.DismissFlaggedUGC(c.Request.Context(), actorID, recordID); err != nil {
		if errors.Is(err, service.ErrFlaggedUGCNotFound) {
			NotFound(c, "flagged ugc not found")
			return
		}
		h.logger.Error("admin dismiss flagged ugc failed", zap.Error(err))
		InternalError(c, "dismiss flagged ugc failed")
		return
	}
	Success(c, gin.H{"dismissed": true})
}

// Stats 管理端运营概览：用户 / 会话 / 消息 / 治理 / 增长 / 运行时聚合指标。
// 只读端点，不写审计日志；WS 在线连接数由 handler 从本实例 Hub 读取补齐。
//
//	@Summary		管理端：运营概览指标
//	@Tags			admin
//	@Security		BearerAuth
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/stats [get]
func (h *AdminHandler) Stats(c *gin.Context) {
	stats, err := h.svc.StatsOverview(c.Request.Context())
	if err != nil {
		h.logger.Error("admin stats failed", zap.Error(err))
		InternalError(c, "stats failed")
		return
	}
	stats.Runtime.OnlineConnections = int64(h.hub.TotalConnections())
	Success(c, stats)
}

// StorageStats 按对象类别的存储占用统计（只读 DB 聚合，不写审计日志）。
//
//	@Summary		管理端：存储统计
//	@Tags			admin
//	@Security		BearerAuth
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/storage-stats [get]
func (h *AdminHandler) StorageStats(c *gin.Context) {
	stats, err := h.svc.StorageStats(c.Request.Context())
	if err != nil {
		h.logger.Error("admin storage stats failed", zap.Error(err))
		InternalError(c, "storage stats failed")
		return
	}
	Success(c, stats)
}

// ListPushSubscriptions 分页列出 Web Push 订阅（endpoint / 创建时间 / 所属用户）。
//
//	@Summary		管理端：推送订阅列表
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			page	query	int	false	"页码（从 1 开始）"
//	@Param			size	query	int	false	"每页条数（上限 100）"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/push-subscriptions [get]
func (h *AdminHandler) ListPushSubscriptions(c *gin.Context) {
	page, size := pageParams(c)
	subs, total, err := h.svc.SearchPushSubscriptions(c.Request.Context(), page, size)
	if err != nil {
		h.logger.Error("admin list push subscriptions failed", zap.Error(err))
		InternalError(c, "list push subscriptions failed")
		return
	}
	Paginated(c, subs, total, page, size)
}
