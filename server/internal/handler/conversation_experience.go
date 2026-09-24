package handler

import (
	"strings"

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
	// 公告变更帧里 announcement 恒存在：清除场景下发空串而非 nil，
	// 否则 omitempty 会让字段整个消失，接收端无法区分「本帧不涉及公告」与「公告被清空」。
	// 其他 pushUpdated 调用点（改名/置顶等）该字段仍为 nil，帧字节不变。
	framePayload := ws.ConversationUpdatedPayload{
		ConversationID:        convID,
		Announcement:          announcement,
		AnnouncementUpdatedAt: updatedAt,
	}
	if framePayload.Announcement == nil {
		empty := ""
		framePayload.Announcement = &empty
	}
	h.pushUpdated(res.MemberIDs, framePayload)
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
	// 回显 trim 后的值：service 存的就是 TrimSpace 结果，回显原值会与库不一致
	Success(c, gin.H{"alias": strings.TrimSpace(body.Alias)})
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
