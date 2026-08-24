// Package handler 的 auth 部分承接忘记密码链路的三个端点。
package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/yuanchat/server/internal/service"
	"go.uber.org/zap"
)

// AuthHandler 负责忘记密码链路。
//
// 与 UserHandler 分开是因为这条链路依赖 AuthService（Redis + 发码通道），
// 而注册 / 登录 / 资料那条链路不需要它们。
type AuthHandler struct {
	svc    *service.AuthService
	logger *zap.Logger
}

// NewAuthHandler 构造忘记密码链路的 handler。
func NewAuthHandler(svc *service.AuthService, logger *zap.Logger) *AuthHandler {
	return &AuthHandler{svc: svc, logger: logger}
}

// SendResetCodeRequest 是发送改密验证码的请求体。
type SendResetCodeRequest struct {
	Phone string `json:"phone" binding:"required"`
}

// VerifyResetCodeRequest 是校验改密验证码的请求体。
type VerifyResetCodeRequest struct {
	Phone string `json:"phone" binding:"required"`
	Code  string `json:"code" binding:"required"`
}

// ResetPasswordRequest 是消费票据改密的请求体。
type ResetPasswordRequest struct {
	ResetTicket string `json:"reset_ticket" binding:"required"`
	NewPassword string `json:"new_password" binding:"required"`
}

// SendResetCode 向手机号下发 6 位改密验证码。
//
// 手机号未注册时同样返回 204：响应体、状态码都与已注册时一致，
// 否则接口会退化成账号枚举工具。
//
//	@Summary		发送改密验证码
//	@Tags			auth
//	@Accept			json
//	@Param			body	body	SendResetCodeRequest	true	"手机号"
//	@Success		204
//	@Failure		400	{object}	Response
//	@Failure		429	{object}	Response
//	@Router			/api/v1/auth/password/otp [post]
func (h *AuthHandler) SendResetCode(c *gin.Context) {
	var req SendResetCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "auth.otpRequired")
		return
	}

	if err := h.svc.SendResetCode(c.Request.Context(), req.Phone); err != nil {
		if errors.Is(err, service.ErrCodeCooldown) {
			Error(c, http.StatusTooManyRequests, 429, "auth.sendFailed")
			return
		}
		h.logger.Error("下发改密验证码失败", zap.Error(err))
		InternalError(c, "auth.sendFailed")
		return
	}

	c.Status(http.StatusNoContent)
}

// VerifyResetCode 校验验证码并换发一次性改密票据。
//
//	@Summary		校验改密验证码
//	@Tags			auth
//	@Accept			json
//	@Produce		json
//	@Param			body	body		VerifyResetCodeRequest	true	"手机号与验证码"
//	@Success		200		{object}	Response
//	@Failure		400		{object}	Response
//	@Failure		429		{object}	Response
//	@Router			/api/v1/auth/password/verify [post]
func (h *AuthHandler) VerifyResetCode(c *gin.Context) {
	var req VerifyResetCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "auth.otpRequired")
		return
	}

	ticket, expiresIn, err := h.svc.VerifyResetCode(c.Request.Context(), req.Phone, req.Code)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrTooManyTries):
			Error(c, http.StatusTooManyRequests, 429, "auth.accountLocked")
		case errors.Is(err, service.ErrCodeInvalid):
			BadRequest(c, "auth.otpWrong")
		default:
			h.logger.Error("校验改密验证码失败", zap.Error(err))
			InternalError(c, "auth.otpWrong")
		}
		return
	}

	Success(c, gin.H{"reset_ticket": ticket, "expires_in": expiresIn})
}

// ResetPassword 消费一次性票据写入新密码，成功后该用户全部旧令牌立即失效。
//
//	@Summary		重置密码
//	@Tags			auth
//	@Accept			json
//	@Param			body	body	ResetPasswordRequest	true	"票据与新密码"
//	@Success		204
//	@Failure		400	{object}	Response
//	@Router			/api/v1/auth/password/reset [post]
func (h *AuthHandler) ResetPassword(c *gin.Context) {
	var req ResetPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "auth.resetFailed")
		return
	}

	if err := h.svc.ResetPassword(c.Request.Context(), req.ResetTicket, req.NewPassword); err != nil {
		// 弱密码回命中规则的 i18n key，前端据此逐条提示
		var weak *service.WeakPasswordError
		if errors.As(err, &weak) {
			BadRequest(c, weak.MessageKey)
			return
		}
		if errors.Is(err, service.ErrTicketInvalid) {
			BadRequest(c, "auth.resetFailed")
			return
		}
		h.logger.Error("重置密码失败", zap.Error(err))
		InternalError(c, "auth.resetFailed")
		return
	}

	c.Status(http.StatusNoContent)
}
