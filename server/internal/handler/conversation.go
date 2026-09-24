package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/service"
	"github.com/yuanchat/server/internal/ws"
	"go.uber.org/zap"
)

// ConversationHandler 会话列表 REST 端点。
type ConversationHandler struct {
	svc        *service.ConversationService
	dispatcher ws.Dispatcher
	logger     *zap.Logger
}

func NewConversationHandler(svc *service.ConversationService, dispatcher ws.Dispatcher, logger *zap.Logger) *ConversationHandler {
	return &ConversationHandler{svc: svc, dispatcher: dispatcher, logger: logger}
}

// CreateGroupBody 建群请求体：群名可选，成员 1-100 个。
type CreateGroupBody struct {
	Name      *string     `json:"name" binding:"omitempty,max=100"`
	MemberIDs []uuid.UUID `json:"member_ids" binding:"required,min=1,max=100"`
}

// Create 建群：校验全员为好友后创建群会话，推送 conversation.created 给全部成员。
//
//	@Summary		创建群聊
//	@Tags			chat
//	@Security		BearerAuth
//	@Success		201	{object}	Response
//	@Router			/api/v1/conversations [post]
func (h *ConversationHandler) Create(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}

	var body CreateGroupBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}

	dto, memberIDs, err := h.svc.CreateGroup(c.Request.Context(), userID, body.Name, body.MemberIDs)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrNotAllFriends):
			Error(c, http.StatusBadRequest, 400, "all members must be your friends")
		case errors.Is(err, service.ErrNoValidMembers):
			BadRequest(c, "member_ids must contain 1-100 users other than yourself")
		default:
			h.logger.Error("create group failed", zap.Error(err))
			InternalError(c, "failed to create group")
		}
		return
	}

	// 推送 conversation.created 给全部成员（含发起者，前端按会话 id 去重）。
	// 帧内 DTO 取「其他成员视角」（未读 1、未读到），发起者已由 POST 响应插入本地并忽略此帧。
	frameDTO := *dto
	frameDTO.UnreadCount = 1
	frameDTO.MyLastReadSeq = 0
	if frame, err := ws.Encode(ws.TypeConversationCreated, ws.ConversationCreatedPayload{Conversation: frameDTO}); err == nil {
		h.dispatcher.SendToUsers(memberIDs, frame)
	} else {
		h.logger.Error("encode conversation.created failed", zap.Error(err))
	}

	Created(c, dto)
}

// List 返回当前用户参与的全部会话。
//
//	@Summary		会话列表
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

// ConversationSettingsBody 会话个人设置请求体（至少携带一个字段）。
type ConversationSettingsBody struct {
	IsPinned *bool `json:"is_pinned"`
	IsMuted  *bool `json:"is_muted"`
}

// UpdateSettings 更新本人会话设置（PUT /conversations/:id/settings，member 维度）。
//
// 多端同步：变更成功后向本人全部设备推 conversation.updated
// （仅推本人，照 Leave 的 pushRemoved 模式；其他成员不感知）。
func (h *ConversationHandler) UpdateSettings(c *gin.Context) {
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
	var body ConversationSettingsBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}
	if body.IsPinned == nil && body.IsMuted == nil {
		BadRequest(c, "at least one of is_pinned / is_muted required")
		return
	}

	res, err := h.svc.UpdateSettings(c.Request.Context(), userID, convID,
		service.ConversationSettingsInput{IsPinned: body.IsPinned, IsMuted: body.IsMuted})
	if err != nil {
		h.groupErr(c, err)
		return
	}

	h.pushUpdated([]uuid.UUID{userID}, ws.ConversationUpdatedPayload{
		ConversationID: convID,
		IsPinned:       &res.IsPinned,
		PinnedAt:       res.PinnedAt,
		IsMuted:        &res.IsMuted,
	})
	Success(c, gin.H{"is_pinned": res.IsPinned, "pinned_at": res.PinnedAt, "is_muted": res.IsMuted})
}
