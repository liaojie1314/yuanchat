package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/service"
	"go.uber.org/zap"
)

// PushHandler Web Push 订阅端点。
type PushHandler struct {
	svc    *service.PushService
	logger *zap.Logger
}

func NewPushHandler(svc *service.PushService, logger *zap.Logger) *PushHandler {
	return &PushHandler{svc: svc, logger: logger}
}

// PublicKey 返回 VAPID 公钥（前端 pushManager.subscribe 需要）。
//
//	@Summary		Web Push VAPID public key
//	@Tags			push
//	@Success		200	{object}	Response
//	@Router			/api/v1/push/public-key [get]
func (h *PushHandler) PublicKey(c *gin.Context) {
	if !h.svc.Enabled() {
		// 未配置不是错误：前端据此隐藏推送开关
		Success(c, gin.H{"enabled": false, "public_key": ""})
		return
	}
	Success(c, gin.H{"enabled": true, "public_key": h.svc.PublicKey()})
}

// SubscribeBody 浏览器 PushSubscription 的 JSON 形态。
type SubscribeBody struct {
	Endpoint string `json:"endpoint" binding:"required"`
	Keys     struct {
		P256dh string `json:"p256dh" binding:"required"`
		Auth   string `json:"auth" binding:"required"`
	} `json:"keys" binding:"required"`
}

// Subscribe 登记推送订阅。
//
//	@Summary		Subscribe to web push
//	@Tags			push
//	@Security		BearerAuth
//	@Success		200	{object}	Response
//	@Router			/api/v1/push/subscribe [post]
func (h *PushHandler) Subscribe(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	var body SubscribeBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}
	sub := &model.PushSubscription{
		UserID:    userID,
		Endpoint:  body.Endpoint,
		P256dh:    body.Keys.P256dh,
		Auth:      body.Keys.Auth,
		UserAgent: c.Request.UserAgent(),
	}
	if err := h.svc.Subscribe(c.Request.Context(), sub); err != nil {
		if errors.Is(err, service.ErrPushDisabled) {
			Error(c, http.StatusServiceUnavailable, 50301, "web push not configured")
			return
		}
		h.logger.Error("push subscribe failed", zap.Error(err))
		InternalError(c, "subscribe failed")
		return
	}
	Success(c, gin.H{"subscribed": true})
}

// UnsubscribeBody 退订请求体。
type UnsubscribeBody struct {
	Endpoint string `json:"endpoint" binding:"required"`
}

// Unsubscribe 取消推送订阅。
//
//	@Summary		Unsubscribe from web push
//	@Tags			push
//	@Security		BearerAuth
//	@Success		200	{object}	Response
//	@Router			/api/v1/push/subscribe [delete]
func (h *PushHandler) Unsubscribe(c *gin.Context) {
	if _, ok := middleware.GetUserID(c); !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	var body UnsubscribeBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}
	if err := h.svc.Unsubscribe(c.Request.Context(), body.Endpoint); err != nil {
		h.logger.Error("push unsubscribe failed", zap.Error(err))
		InternalError(c, "unsubscribe failed")
		return
	}
	Success(c, gin.H{"subscribed": false})
}
