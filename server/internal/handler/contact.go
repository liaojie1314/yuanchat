package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"github.com/yuanchat/server/internal/service"
	"github.com/yuanchat/server/internal/ws"
	"go.uber.org/zap"
)

// ContactHandler 联系人/好友 REST 端点。
//
// WS 推送（contact.request / contact.accepted / 打招呼 message.receive）
// 经 Dispatcher 直发，与聊天消息共用同一 Hub。
type ContactHandler struct {
	svc        *service.ContactService
	dispatcher ws.Dispatcher
	logger     *zap.Logger
}

func NewContactHandler(svc *service.ContactService, dispatcher ws.Dispatcher, logger *zap.Logger) *ContactHandler {
	return &ContactHandler{svc: svc, dispatcher: dispatcher, logger: logger}
}

// userBriefOf model.User → 帧内用户摘要。
func userBriefOf(u *model.User) ws.UserBrief {
	return ws.UserBrief{ID: u.ID, Nickname: u.Nickname, AvatarURL: u.AvatarURL, ShortID: u.ShortID}
}

// Search 精确搜索用户（手机号 / 元聊号 / 邮箱全匹配）。
//
//	@Summary	按手机号 / 元聊号 / 邮箱搜索用户
//	@Tags		contacts
//	@Security	BearerAuth
//	@Router		/api/v1/users/search [get]
func (h *ContactHandler) Search(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}

	result, err := h.svc.Search(c.Request.Context(), userID, c.Query("q"))
	if err != nil {
		if errors.Is(err, service.ErrUserNotFound) {
			NotFound(c, "user not found")
			return
		}
		h.logger.Error("search user failed", zap.Error(err))
		InternalError(c, "search failed")
		return
	}

	Success(c, gin.H{
		"user": gin.H{
			"id":         result.User.ID,
			"nickname":   result.User.Nickname,
			"avatar_url": result.User.AvatarURL,
			"short_id":   result.User.ShortID,
		},
		"relation": result.Relation,
	})
}

// SendRequest 发起好友申请，成功后实时推送给目标用户。
//
//	@Summary	发送好友申请
//	@Tags		contacts
//	@Security	BearerAuth
//	@Router		/api/v1/contacts/requests [post]
func (h *ContactHandler) SendRequest(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}

	var req SendFriendRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, err.Error())
		return
	}

	fr, requester, err := h.svc.SendRequest(c.Request.Context(), userID, req.TargetID, req.Message)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrSelfRequest):
			BadRequest(c, "cannot add yourself")
		case errors.Is(err, service.ErrUserNotFound):
			NotFound(c, "target user not found")
		case errors.Is(err, service.ErrAlreadyFriends):
			Error(c, http.StatusConflict, 409, "already friends")
		default:
			h.logger.Error("send friend request failed", zap.Error(err))
			InternalError(c, "send request failed")
		}
		return
	}

	// 实时推送给目标用户全部设备（离线由登录拉取兜底）
	msg := ""
	if fr.Message != nil {
		msg = *fr.Message
	}
	if frame, err := ws.Encode(ws.TypeContactRequest, ws.ContactRequestPayload{
		RequestID: fr.ID,
		Requester: userBriefOf(requester),
		Message:   msg,
		CreatedAt: fr.UpdatedAt.UnixMilli(),
	}); err == nil {
		h.dispatcher.SendToUsers([]uuid.UUID{fr.TargetID}, frame)
	}

	Created(c, gin.H{"request_id": fr.ID, "status": fr.Status})
}

// ListRequests 查申请列表（收到的 + 发出的）。
//
//	@Summary	好友申请列表
//	@Tags		contacts
//	@Security	BearerAuth
//	@Router		/api/v1/contacts/requests [get]
func (h *ContactHandler) ListRequests(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}

	items, err := h.svc.ListRequests(c.Request.Context(), userID)
	if err != nil {
		h.logger.Error("list friend requests failed", zap.Error(err))
		InternalError(c, "failed to list requests")
		return
	}

	out := make([]gin.H, 0, len(items))
	for _, it := range items {
		msg := ""
		if it.Message != nil {
			msg = *it.Message
		}
		out = append(out, gin.H{
			"id":        it.ID,
			"direction": directionOf(it, userID),
			"status":    it.Status,
			"message":   msg,
			"requester": gin.H{
				"id": it.RequesterID, "nickname": it.RequesterNickname,
				"avatar_url": it.RequesterAvatarURL, "short_id": it.RequesterShortID,
			},
			"target": gin.H{
				"id": it.TargetID, "nickname": it.TargetNickname,
				"avatar_url": it.TargetAvatarURL, "short_id": it.TargetShortID,
			},
			"created_at": it.CreatedAt,
			"updated_at": it.UpdatedAt,
		})
	}
	Success(c, gin.H{"requests": out})
}

func directionOf(it repository.RequestWithUsers, userID uuid.UUID) string {
	if it.TargetID == userID {
		return "in"
	}
	return "out"
}

// Accept 同意好友申请：建双向好友 + get-or-create 单聊 + 打招呼消息，
// 事务提交后推送 contact.accepted（申请方）与打招呼 message.receive（双方）。
//
//	@Summary	同意好友申请
//	@Tags		contacts
//	@Security	BearerAuth
//	@Router		/api/v1/contacts/requests/{id}/accept [post]
func (h *ContactHandler) Accept(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	requestID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid request id")
		return
	}

	result, err := h.svc.Accept(c.Request.Context(), userID, requestID)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrRequestNotFound):
			NotFound(c, "request not found")
		case errors.Is(err, service.ErrNotRequestTarget):
			Error(c, http.StatusForbidden, 403, "not the target of this request")
		case errors.Is(err, service.ErrRequestNotPending):
			Error(c, http.StatusConflict, 409, "request is not pending")
		default:
			h.logger.Error("accept friend request failed", zap.Error(err))
			InternalError(c, "accept failed")
		}
		return
	}

	// Greeting 为 nil = 幂等命中（已同意过），跳过全部推送
	if result.Greeting != nil {
		// 1. 告知申请方：被同意了（带新会话 ID，前端好友列表加人 + 拉会话）
		if frame, err := ws.Encode(ws.TypeContactAccepted, ws.ContactAcceptedPayload{
			RequestID:      result.Request.ID,
			Friend:         userBriefOf(result.Accepter),
			ConversationID: result.ConversationID,
		}); err == nil {
			h.dispatcher.SendToUsers([]uuid.UUID{result.Request.RequesterID}, frame)
		}

		// 2. 打招呼消息走标准 message.receive（双方会话列表自动出现新会话）
		if frame, err := ws.Encode(ws.TypeMessageReceive, ws.ReceivePayload{
			MessageID:      result.Greeting.ID,
			ConversationID: result.ConversationID,
			SenderID:       result.Accepter.ID,
			SenderNickname: result.Accepter.Nickname,
			Content:        ws.ContentPayload{Type: "text", Text: greetingTextOf(result.Greeting)},
			Seq:            result.Greeting.Seq,
			Timestamp:      result.Greeting.CreatedAt.UnixMilli(),
		}); err == nil {
			h.dispatcher.SendToUsers(result.MemberIDs, frame)
		}
	}

	Success(c, gin.H{"conversation_id": result.ConversationID})
}

// greetingTextOf 从消息 content JSON 提取文本（解析失败返回空串，不阻塞推送）。
func greetingTextOf(m *model.Message) string {
	var c model.MessageContentText
	if err := json.Unmarshal([]byte(m.Content), &c); err != nil {
		return ""
	}
	return c.Text
}

// Reject 拒绝好友申请（申请方无感知）。
//
//	@Summary	拒绝好友申请
//	@Tags		contacts
//	@Security	BearerAuth
//	@Router		/api/v1/contacts/requests/{id}/reject [post]
func (h *ContactHandler) Reject(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	requestID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid request id")
		return
	}

	if err := h.svc.Reject(c.Request.Context(), userID, requestID); err != nil {
		switch {
		case errors.Is(err, service.ErrRequestNotFound):
			NotFound(c, "request not found")
		case errors.Is(err, service.ErrNotRequestTarget):
			Error(c, http.StatusForbidden, 403, "not the target of this request")
		case errors.Is(err, service.ErrRequestNotPending):
			Error(c, http.StatusConflict, 409, "request is not pending")
		default:
			h.logger.Error("reject friend request failed", zap.Error(err))
			InternalError(c, "reject failed")
		}
		return
	}
	Success(c, gin.H{"message": "rejected"})
}

// ListFriends 查好友列表（含单聊会话 ID）。
//
//	@Summary	好友列表
//	@Tags		contacts
//	@Security	BearerAuth
//	@Router		/api/v1/contacts [get]
func (h *ContactHandler) ListFriends(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}

	friends, err := h.svc.ListFriends(c.Request.Context(), userID)
	if err != nil {
		h.logger.Error("list friends failed", zap.Error(err))
		InternalError(c, "failed to list friends")
		return
	}
	Success(c, gin.H{"friends": friends})
}

// DeleteFriend 双向删除好友关系；成功后向双方在线设备下发 friend.removed。
//
//	@Summary	删除好友
//	@Tags		contacts
//	@Security	BearerAuth
//	@Router		/api/v1/contacts/{id} [delete]
func (h *ContactHandler) DeleteFriend(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	friendID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid friend id")
		return
	}
	if err := h.svc.DeleteFriend(c.Request.Context(), userID, friendID); err != nil {
		if errors.Is(err, service.ErrSelfRequest) {
			BadRequest(c, "cannot delete yourself")
			return
		}
		h.logger.Error("delete friend failed", zap.Error(err))
		InternalError(c, "delete failed")
		return
	}

	// 双向 WS 推送：给 actor 自己所有设备 + 给对方所有设备
	if frame, err := ws.Encode(ws.TypeFriendRemoved, ws.FriendRemovedPayload{FriendID: friendID}); err == nil {
		h.dispatcher.SendToUsers([]uuid.UUID{userID}, frame)
	}
	if frame, err := ws.Encode(ws.TypeFriendRemoved, ws.FriendRemovedPayload{FriendID: userID}); err == nil {
		h.dispatcher.SendToUsers([]uuid.UUID{friendID}, frame)
	}
	c.Status(http.StatusNoContent)
}

// --- 请求结构 ---

type SendFriendRequestBody struct {
	TargetID uuid.UUID `json:"target_id" binding:"required"`
	Message  string    `json:"message" binding:"omitempty,max=200"`
}
