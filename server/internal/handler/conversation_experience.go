package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/ws"
)

// AnnouncementBody 群公告请求体（空串 = 清除公告）。
type AnnouncementBody struct {
	Announcement string `json:"announcement"`
}

// UpdateAnnouncement PATCH /conversations/:id/announcement（role >= Admin）。
func (h *ConversationHandler) UpdateAnnouncement(c *gin.Context) {
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
	var body AnnouncementBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}
	res, announcement, updatedAt, err := h.svc.UpdateAnnouncement(c.Request.Context(), userID, convID, body.Announcement)
	if err != nil {
		h.groupErr(c, err)
		return
	}
	h.pushSystemReceive(res.MemberIDs, res.SysMsg, res.SysText)
	h.pushUpdated(res.MemberIDs, ws.ConversationUpdatedPayload{
		ConversationID:        convID,
		Announcement:          announcement,
		AnnouncementUpdatedAt: updatedAt,
	})
	Success(c, gin.H{"announcement": announcement, "announcement_updated_at": updatedAt})
}

// AliasBody 群昵称请求体（空串 = 清除）。
type AliasBody struct {
	Alias string `json:"alias"`
}

// UpdateMyAlias PUT /conversations/:id/my-alias（任意成员）。
func (h *ConversationHandler) UpdateMyAlias(c *gin.Context) {
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
	var body AliasBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}
	if err := h.svc.UpdateMyAlias(c.Request.Context(), userID, convID, body.Alias); err != nil {
		h.groupErr(c, err)
		return
	}
	Success(c, gin.H{"alias": body.Alias})
}

// ClearHistory DELETE /conversations/:id/messages（单侧清空，member 维度）。
func (h *ConversationHandler) ClearHistory(c *gin.Context) {
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
	if err := h.svc.ClearHistory(c.Request.Context(), userID, convID); err != nil {
		h.groupErr(c, err)
		return
	}
	Success(c, gin.H{})
}
