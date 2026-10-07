// Package handler 的 auth 部分承接忘记密码链路的三个端点。
package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/yuanchat/server/internal/middleware"
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
//
// Account 为手机号或邮箱。保留 Phone 只为兼容已发布的旧客户端 ——
// 登录早就支持邮箱，找回密码却只认手机号，邮箱注册的用户会彻底锁死在门外。
type SendResetCodeRequest struct {
	Account string `json:"account"`
	Phone   string `json:"phone"`
}

// Target 返回本次要发码的账号，优先取 Account。
func (r SendResetCodeRequest) Target() string {
	if r.Account != "" {
		return r.Account
	}
	return r.Phone
}

// VerifyResetCodeRequest 是校验改密验证码的请求体。
type VerifyResetCodeRequest struct {
	Account string `json:"account"`
	Phone   string `json:"phone"`
	Code    string `json:"code" binding:"required"`
}

// Target 返回本次要校验的账号，优先取 Account。
func (r VerifyResetCodeRequest) Target() string {
	if r.Account != "" {
		return r.Account
	}
	return r.Phone
}

// SendRegisterCodeRequest 是发送注册验证码的请求体。
type SendRegisterCodeRequest struct {
	Email string `json:"email" binding:"required,email"`
}

// ResetPasswordRequest 是消费票据改密的请求体。
type ResetPasswordRequest struct {
	ResetTicket string `json:"reset_ticket" binding:"required"`
	NewPassword string `json:"new_password" binding:"required"`
}

// SendResetCode 向手机号或邮箱下发 6 位改密验证码。
//
// 账号未注册时同样返回 204：响应体、状态码都与已注册时一致，
// 否则接口会退化成账号枚举工具。
//
//	@Summary		发送改密验证码
//	@Tags			auth
//	@Accept			json
//	@Param			body	body	SendResetCodeRequest	true	"手机号或邮箱"
//	@Success		204
//	@Failure		400	{object}	Response
//	@Failure		429	{object}	Response
//	@Router			/api/v1/auth/password/otp [post]
func (h *AuthHandler) SendResetCode(c *gin.Context) {
	var req SendResetCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Target() == "" {
		BadRequest(c, "auth.otpRequired")
		return
	}

	if err := h.svc.SendResetCode(c.Request.Context(), req.Target()); err != nil {
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
//	@Param			body	body		VerifyResetCodeRequest	true	"账号与验证码"
//	@Success		200		{object}	Response
//	@Failure		400		{object}	Response
//	@Failure		429		{object}	Response
//	@Router			/api/v1/auth/password/verify [post]
func (h *AuthHandler) VerifyResetCode(c *gin.Context) {
	var req VerifyResetCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Target() == "" {
		BadRequest(c, "auth.otpRequired")
		return
	}

	ticket, expiresIn, err := h.svc.VerifyResetCode(c.Request.Context(), req.Target(), req.Code)
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

// ChangePasswordRequest 是登录态改密的入参。
type ChangePasswordRequest struct {
	OldPassword string `json:"old_password" binding:"required"`
	NewPassword string `json:"new_password" binding:"required"`
}

// ChangePassword 校验当前密码后改密。
//
// 与三段式重置共用同一套收尾（递增 token_version），因此响应成功后调用方的令牌
// 立即失效，前端必须清掉本地登录态并回登录页。
//
//	@Summary		修改密码（登录态）
//	@Tags			auth
//	@Security		BearerAuth
//	@Param			body	body		ChangePasswordRequest	true	"当前密码与新密码"
//	@Success		204
//	@Failure		400	{object}	Response	"当前密码错误或新密码不合复杂度"
//	@Router			/api/v1/auth/password/change [post]
func (h *AuthHandler) ChangePassword(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "not authenticated")
		return
	}

	var req ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "auth.changePasswordFailed")
		return
	}

	if err := h.svc.ChangePassword(c.Request.Context(), userID.String(), req.OldPassword, req.NewPassword); err != nil {
		// 弱密码回命中规则的 i18n key，前端据此逐条提示
		var weak *service.WeakPasswordError
		if errors.As(err, &weak) {
			BadRequest(c, weak.MessageKey)
			return
		}
		if errors.Is(err, service.ErrOldPasswordWrong) {
			BadRequest(c, "auth.oldPasswordWrong")
			return
		}
		if errors.Is(err, service.ErrUserBanned) {
			Error(c, http.StatusForbidden, 40301, "account banned")
			return
		}
		h.logger.Error("修改密码失败", zap.Error(err))
		InternalError(c, "auth.changePasswordFailed")
		return
	}

	c.Status(http.StatusNoContent)
}

// SendRegisterCode 向邮箱下发 6 位注册验证码。
//
// 邮箱是否已注册一律返回 204：响应与已注册时完全一致，
// 否则这个端点就是一台账号枚举机器。已注册的邮箱拿到码也走不下去，
// Register 会在查重时回 409。
//
//	@Summary		发送注册验证码
//	@Tags			auth
//	@Accept			json
//	@Param			body	body	SendRegisterCodeRequest	true	"邮箱"
//	@Success		204
//	@Failure		400	{object}	Response
//	@Failure		429	{object}	Response
//	@Router			/api/v1/auth/register/otp [post]
func (h *AuthHandler) SendRegisterCode(c *gin.Context) {
	var req SendRegisterCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "auth.emailInvalid")
		return
	}

	if err := h.svc.SendRegisterCode(c.Request.Context(), req.Email); err != nil {
		if errors.Is(err, service.ErrCodeCooldown) {
			Error(c, http.StatusTooManyRequests, 429, "auth.otpCooldown")
			return
		}
		h.logger.Error("下发注册验证码失败", zap.Error(err))
		InternalError(c, "auth.sendFailed")
		return
	}

	c.Status(http.StatusNoContent)
}
