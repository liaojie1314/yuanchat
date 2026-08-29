// 扫码登录的四个端点：被扫端建会话与轮询，扫码端标记已扫与确认授权。

package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/service"
	"go.uber.org/zap"
)

// qrTokenMaxLen 是会话凭据的长度上限。
//
// 32 字节 base64url 固定 43 字符，超长输入一律按不存在处理，
// 免得把任意长度的字符串拼进 Redis 键。
const qrTokenMaxLen = 64

// CreateQRSessionRequest 是创建扫码会话的请求体。
//
// DeviceID 是被扫端自报的平台标识，换出的令牌用它当 device_id；
// 只接受枚举内的值，缺省按 web 处理。
type CreateQRSessionRequest struct {
	DeviceID string `json:"device_id" binding:"omitempty,oneof=web desktop"`
}

// CreateQRSession 创建扫码会话，返回二维码内容与有效期。
//
//	@Summary		创建扫码登录会话
//	@Tags			auth
//	@Accept			json
//	@Produce		json
//	@Param			body	body		CreateQRSessionRequest	true	"被扫端平台标识"
//	@Success		200		{object}	Response
//	@Failure		400		{object}	Response
//	@Failure		429		{object}	Response
//	@Router			/api/v1/auth/qr/session [post]
func (h *AuthHandler) CreateQRSession(c *gin.Context) {
	var req CreateQRSessionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, "auth.qrFailed")
		return
	}

	sess, err := h.svc.CreateQRSession(c.Request.Context(), req.DeviceID)
	if err != nil {
		h.qrError(c, err)
		return
	}

	Success(c, sess)
}

// PollQRSession 查询会话状态，状态为 confirmed 时返回令牌对并销毁会话。
//
//	@Summary		轮询扫码会话状态
//	@Tags			auth
//	@Produce		json
//	@Param			token	path		string	true	"会话凭据"
//	@Success		200		{object}	Response
//	@Failure		404		{object}	Response
//	@Router			/api/v1/auth/qr/{token} [get]
func (h *AuthHandler) PollQRSession(c *gin.Context) {
	qrToken := c.Param("token")
	if len(qrToken) > qrTokenMaxLen {
		Error(c, http.StatusNotFound, 404, "auth.qrExpired")
		return
	}

	res, err := h.svc.PollQRSession(c.Request.Context(), qrToken)
	if err != nil {
		h.qrError(c, err)
		return
	}

	Success(c, res)
}

// ScanQRSession 由已登录的扫码端把会话标记为已扫描，并回传自身身份。
//
//	@Summary		标记扫码会话已扫描
//	@Tags			auth
//	@Produce		json
//	@Security		BearerAuth
//	@Param			token	path		string	true	"会话凭据"
//	@Success		200		{object}	Response
//	@Failure		403		{object}	Response
//	@Failure		404		{object}	Response
//	@Failure		409		{object}	Response
//	@Router			/api/v1/auth/qr/{token}/scan [post]
func (h *AuthHandler) ScanQRSession(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "authorization token required")
		return
	}
	qrToken := c.Param("token")
	if len(qrToken) > qrTokenMaxLen {
		Error(c, http.StatusNotFound, 404, "auth.qrExpired")
		return
	}

	who, err := h.svc.ScanQRSession(c.Request.Context(), qrToken, userID)
	if err != nil {
		h.qrError(c, err)
		return
	}

	Success(c, who)
}

// ConfirmQRSession 由扫码端确认授权，成功后被扫端下一次轮询即可取走令牌。
//
//	@Summary		确认扫码登录授权
//	@Security		BearerAuth
//	@Tags			auth
//	@Param			token	path	string	true	"会话凭据"
//	@Success		204
//	@Failure		403	{object}	Response
//	@Failure		404	{object}	Response
//	@Failure		409	{object}	Response
//	@Router			/api/v1/auth/qr/{token}/confirm [post]
func (h *AuthHandler) ConfirmQRSession(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "authorization token required")
		return
	}
	qrToken := c.Param("token")
	if len(qrToken) > qrTokenMaxLen {
		Error(c, http.StatusNotFound, 404, "auth.qrExpired")
		return
	}

	if err := h.svc.ConfirmQRSession(c.Request.Context(), qrToken, userID); err != nil {
		h.qrError(c, err)
		return
	}

	c.Status(http.StatusNoContent)
}

// qrError 把扫码链路的哨兵错误映射成状态码与 i18n key。
//
// 会话不存在与已过期共用 404 + auth.qrExpired：区分二者等于给出「这个码曾经存在」的探针。
// 封禁沿用登录与续期既有的 403 + 40301 + "account banned"，不另造一套。
func (h *AuthHandler) qrError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrQRNotFound):
		Error(c, http.StatusNotFound, 404, "auth.qrExpired")
	case errors.Is(err, service.ErrQRBadState):
		Error(c, http.StatusConflict, 409, "auth.qrBadState")
	case errors.Is(err, service.ErrQRWrongUser):
		Error(c, http.StatusForbidden, 403, "auth.qrWrongUser")
	case errors.Is(err, service.ErrUserBanned):
		Error(c, http.StatusForbidden, 40301, "account banned")
	case errors.Is(err, service.ErrQRBadDevice):
		BadRequest(c, "auth.qrFailed")
	default:
		h.logger.Error("扫码登录处理失败", zap.Error(err))
		InternalError(c, "auth.qrFailed")
	}
}
