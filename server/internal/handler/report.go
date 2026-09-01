package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/service"
	"go.uber.org/zap"
)

// ReportHandler 用户端举报入口。
type ReportHandler struct {
	svc    *service.AdminService
	logger *zap.Logger
}

func NewReportHandler(svc *service.AdminService, logger *zap.Logger) *ReportHandler {
	return &ReportHandler{svc: svc, logger: logger}
}

// CreateReportBody 举报请求体。
type CreateReportBody struct {
	TargetType string    `json:"target_type" binding:"required,oneof=message user sticker_pack"`
	TargetID   uuid.UUID `json:"target_id" binding:"required"`
	Reason     string    `json:"reason" binding:"max=500"`
}

// Create 提交举报。
//
//	@Summary		举报消息 / 用户 / 表情包
//	@Tags			reports
//	@Security		BearerAuth
//	@Success		200	{object}	Response
//	@Router			/api/v1/reports [post]
func (h *ReportHandler) Create(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	var body CreateReportBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}
	report, err := h.svc.CreateReport(c.Request.Context(), userID, body.TargetType, body.TargetID, body.Reason)
	if err != nil {
		h.logger.Error("create report failed", zap.Error(err))
		InternalError(c, "create report failed")
		return
	}
	Success(c, gin.H{"id": report.ID, "status": report.Status})
}
