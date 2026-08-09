package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/service"
	"github.com/yuanchat/server/internal/ws"
	"go.uber.org/zap"
)

// groupErr 群管理操作统一错误映射。
func (h *ConversationHandler) groupErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrConversationNotFound):
		NotFound(c, "conversation not found")
	case errors.Is(err, service.ErrGroupMemberNotFound):
		NotFound(c, "member not found")
	case errors.Is(err, service.ErrNotGroup), errors.Is(err, service.ErrInvalidName),
		errors.Is(err, service.ErrOwnerCannotLeave), errors.Is(err, service.ErrNoValidMembers),
		errors.Is(err, service.ErrAlreadyAdmin), errors.Is(err, service.ErrNotAdmin),
		errors.Is(err, service.ErrCannotTransferToSelf), errors.Is(err, service.ErrInvalidAlias),
		errors.Is(err, service.ErrInvalidAnnouncement):
		BadRequest(c, err.Error())
	case errors.Is(err, service.ErrNotAllFriends):
		Error(c, http.StatusBadRequest, 400, "all members must be your friends")
	case errors.Is(err, service.ErrNotMember), errors.Is(err, service.ErrForbidden):
		Error(c, http.StatusForbidden, 403, err.Error())
	default:
		h.logger.Error("group operation failed", zap.Error(err))
		InternalError(c, "operation failed")
	}
}

// pushSystemReceive 把已落库的系统消息推给成员（content.type=system，前端渲染居中胶囊）。
func (h *ConversationHandler) pushSystemReceive(memberIDs []uuid.UUID, msg *model.Message, text string) {
	frame, err := ws.Encode(ws.TypeMessageReceive, ws.ReceivePayload{
		MessageID:      msg.ID,
		ConversationID: msg.ConversationID,
		SenderID:       msg.SenderID,
		Content:        ws.ContentPayload{Type: "system", Text: text},
		Seq:            msg.Seq,
		Timestamp:      msg.CreatedAt.UnixMilli(),
	})
	if err == nil {
		h.dispatcher.SendToUsers(memberIDs, frame)
	}
}

func (h *ConversationHandler) pushUpdated(memberIDs []uuid.UUID, p ws.ConversationUpdatedPayload) {
	if frame, err := ws.Encode(ws.TypeConversationUpdated, p); err == nil {
		h.dispatcher.SendToUsers(memberIDs, frame)
	}
}

func (h *ConversationHandler) pushRemoved(userIDs []uuid.UUID, convID uuid.UUID, reason string) {
	if frame, err := ws.Encode(ws.TypeConversationRemoved, ws.ConversationRemovedPayload{
		ConversationID: convID, Reason: reason,
	}); err == nil {
		h.dispatcher.SendToUsers(userIDs, frame)
	}
}

// RenameGroupBody 改名请求体。
type RenameGroupBody struct {
	Name string `json:"name" binding:"required,max=100"`
}

// Rename 修改群名（PATCH /conversations/:id，role ≥ Admin）。
func (h *ConversationHandler) Rename(c *gin.Context) {
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
	var body RenameGroupBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}

	res, err := h.svc.RenameGroup(c.Request.Context(), userID, convID, body.Name)
	if err != nil {
		h.groupErr(c, err)
		return
	}

	h.pushSystemReceive(res.MemberIDs, res.SysMsg, res.SysText)
	h.pushUpdated(res.MemberIDs, ws.ConversationUpdatedPayload{ConversationID: convID, Name: res.Name})
	Success(c, gin.H{"name": res.Name})
}

// InviteMembersBody 邀请请求体。
type InviteMembersBody struct {
	MemberIDs []uuid.UUID `json:"member_ids" binding:"required,min=1,max=100"`
}

// Invite 邀请好友入群（POST /conversations/:id/members，任意成员）。
func (h *ConversationHandler) Invite(c *gin.Context) {
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
	var body InviteMembersBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}

	res, err := h.svc.InviteMembers(c.Request.Context(), userID, convID, body.MemberIDs)
	if err != nil {
		h.groupErr(c, err)
		return
	}

	// 新成员推 conversation.created（新成员视角 DTO：unread=1），冒出新会话
	if frame, err := ws.Encode(ws.TypeConversationCreated, ws.ConversationCreatedPayload{Conversation: res.NewMemberDTO}); err == nil {
		h.dispatcher.SendToUsers(res.NewMemberIDs, frame)
	}
	h.pushSystemReceive(res.MemberIDs, res.SysMsg, res.SysText)
	h.pushUpdated(res.MemberIDs, ws.ConversationUpdatedPayload{ConversationID: convID, MemberCount: res.MemberCount})
	Success(c, gin.H{"member_count": res.MemberCount})
}

// Kick 移出成员（DELETE /conversations/:id/members/:userId，操作者 role > 目标 role）。
func (h *ConversationHandler) Kick(c *gin.Context) {
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
	targetID, err := uuid.Parse(c.Param("userId"))
	if err != nil {
		BadRequest(c, "invalid user id")
		return
	}

	res, err := h.svc.KickMember(c.Request.Context(), userID, convID, targetID)
	if err != nil {
		h.groupErr(c, err)
		return
	}

	h.pushRemoved([]uuid.UUID{res.RemovedID}, convID, "kicked")
	h.pushSystemReceive(res.MemberIDs, res.SysMsg, res.SysText)
	h.pushUpdated(res.MemberIDs, ws.ConversationUpdatedPayload{ConversationID: convID, MemberCount: res.MemberCount})
	Success(c, gin.H{"member_count": res.MemberCount})
}

// Leave 退群（POST /conversations/:id/leave，非群主成员）。
func (h *ConversationHandler) Leave(c *gin.Context) {
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

	res, err := h.svc.LeaveGroup(c.Request.Context(), userID, convID)
	if err != nil {
		h.groupErr(c, err)
		return
	}

	// 本人多端同步移除会话
	h.pushRemoved([]uuid.UUID{res.RemovedID}, convID, "left")
	h.pushSystemReceive(res.MemberIDs, res.SysMsg, res.SysText)
	h.pushUpdated(res.MemberIDs, ws.ConversationUpdatedPayload{ConversationID: convID, MemberCount: res.MemberCount})
	Success(c, gin.H{})
}

// Dissolve 解散群聊（DELETE /conversations/:id，仅群主）。
func (h *ConversationHandler) Dissolve(c *gin.Context) {
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

	memberIDs, err := h.svc.DissolveGroup(c.Request.Context(), userID, convID)
	if err != nil {
		h.groupErr(c, err)
		return
	}

	h.pushRemoved(memberIDs, convID, "dissolved")
	Success(c, gin.H{})
}

// pushRoleChanged 把角色变更帧逐条推给群内全员（转让时两条：升 owner + 降 admin）。
func (h *ConversationHandler) pushRoleChanged(memberIDs []uuid.UUID, convID, changedBy uuid.UUID, changes []service.RoleChange) {
	for _, ch := range changes {
		if frame, err := ws.Encode(ws.TypeRoleChanged, ws.RoleChangedPayload{
			ConversationID: convID,
			UserID:         ch.UserID,
			NewRole:        ch.NewRole,
			ChangedBy:      changedBy,
		}); err == nil {
			h.dispatcher.SendToUsers(memberIDs, frame)
		}
	}
}

// finishRoleOp 角色操作共用推送：系统消息 + role_changed 帧。
func (h *ConversationHandler) finishRoleOp(convID, actorID uuid.UUID, res *service.GroupOpResult) {
	h.pushSystemReceive(res.MemberIDs, res.SysMsg, res.SysText)
	h.pushRoleChanged(res.MemberIDs, convID, actorID, res.RoleChanges)
}

// AppointAdminBody 任命管理员请求体。
type AppointAdminBody struct {
	UserID uuid.UUID `json:"user_id" binding:"required"`
}

// AppointAdmin 任命管理员（POST /conversations/:id/admins，仅群主）。
func (h *ConversationHandler) AppointAdmin(c *gin.Context) {
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
	var body AppointAdminBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}

	res, err := h.svc.AppointAdmin(c.Request.Context(), userID, convID, body.UserID)
	if err != nil {
		h.groupErr(c, err)
		return
	}

	h.finishRoleOp(convID, userID, res)
	Success(c, gin.H{"user_id": body.UserID, "new_role": 1})
}

// RevokeAdmin 免除管理员（DELETE /conversations/:id/admins/:userId，仅群主）。
func (h *ConversationHandler) RevokeAdmin(c *gin.Context) {
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
	targetID, err := uuid.Parse(c.Param("userId"))
	if err != nil {
		BadRequest(c, "invalid user id")
		return
	}

	res, err := h.svc.RevokeAdmin(c.Request.Context(), userID, convID, targetID)
	if err != nil {
		h.groupErr(c, err)
		return
	}

	h.finishRoleOp(convID, userID, res)
	Success(c, gin.H{"user_id": targetID, "new_role": 0})
}

// TransferOwnerBody 转让群主请求体。
type TransferOwnerBody struct {
	NewOwnerID uuid.UUID `json:"new_owner_id" binding:"required"`
}

// TransferOwner 转让群主（POST /conversations/:id/owner-transfer，仅群主）。
func (h *ConversationHandler) TransferOwner(c *gin.Context) {
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
	var body TransferOwnerBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}

	res, err := h.svc.TransferOwner(c.Request.Context(), userID, convID, body.NewOwnerID)
	if err != nil {
		h.groupErr(c, err)
		return
	}

	h.finishRoleOp(convID, userID, res)
	Success(c, gin.H{"old_owner_id": userID, "new_owner_id": body.NewOwnerID})
}
