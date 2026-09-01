package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/service"
	"github.com/yuanchat/server/internal/ws"
	"go.uber.org/zap"
)

// AdminHandler 管理后台端点（全部挂 RequireAdmin）。
type AdminHandler struct {
	svc        *service.AdminService
	hub        *ws.Hub
	dispatcher ws.Dispatcher
	logger     *zap.Logger
}

func NewAdminHandler(svc *service.AdminService, hub *ws.Hub, logger *zap.Logger) *AdminHandler {
	return &AdminHandler{svc: svc, hub: hub, dispatcher: hub, logger: logger}
}

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
		if errors.Is(err, service.ErrReportNotFound) {
			NotFound(c, "report not found")
			return
		}
		h.logger.Error("admin handle report failed", zap.Error(err))
		InternalError(c, "handle report failed")
		return
	}
	Success(c, gin.H{"handled": true})
}
