package handler

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/service"
	"go.uber.org/zap"
)

// UserHandler 负责用户认证与个人资料相关端点。
type UserHandler struct {
	svc     *service.UserService
	captcha *CaptchaHandler
	logger  *zap.Logger
}

func NewUserHandler(svc *service.UserService, captcha *CaptchaHandler, logger *zap.Logger) *UserHandler {
	return &UserHandler{svc: svc, captcha: captcha, logger: logger}
}

// Register 校验图形验证码后创建新账号。
func (h *UserHandler) Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, err.Error())
		return
	}

	if !h.captcha.Validate(c.Request.Context(), req.CaptchaID, req.CaptchaAnswer) {
		BadRequest(c, "invalid captcha")
		return
	}

	result, err := h.svc.Register(c.Request.Context(), service.RegisterRequest{
		Phone:    req.Phone,
		Email:    req.Email,
		Password: req.Password,
		Nickname: req.Nickname,
	})
	if err != nil {
		// 弱密码：message 里回 i18n key，前端据此展示对应规则文案
		var weak *service.WeakPasswordError
		if errors.As(err, &weak) {
			BadRequest(c, weak.MessageKey)
			return
		}
		if errors.Is(err, service.ErrDuplicateUser) {
			Error(c, http.StatusConflict, 409, "phone or email already registered")
			return
		}
		h.logger.Error("register failed", zap.Error(err))
		InternalError(c, "registration failed")
		return
	}

	Created(c, gin.H{
		"user":          result.User,
		"access_token":  result.AccessToken,
		"refresh_token": result.RefreshToken,
		"expires_in":    result.ExpiresIn,
	})
}

// Login 认证用户并返回 JWT 令牌。
func (h *UserHandler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, err.Error())
		return
	}

	result, err := h.svc.Login(c.Request.Context(), service.LoginRequest{
		Account:  req.Account,
		Password: req.Password,
	})
	if err != nil {
		// 账号级锁定：错误码走 message 里的 i18n key，前端据此出「账号已锁定」文案
		if errors.Is(err, service.ErrAccountLocked) {
			Error(c, http.StatusTooManyRequests, 429, "auth.accountLocked")
			return
		}
		if errors.Is(err, service.ErrUserNotFound) || errors.Is(err, service.ErrInvalidPassword) {
			Unauthorized(c, "invalid account or password")
			return
		}
		if errors.Is(err, service.ErrUserBanned) {
			Error(c, http.StatusForbidden, 40301, "account banned")
			return
		}
		h.logger.Error("login failed", zap.Error(err))
		InternalError(c, "login failed")
		return
	}

	Success(c, gin.H{
		"user":          result.User,
		"access_token":  result.AccessToken,
		"refresh_token": result.RefreshToken,
		"expires_in":    result.ExpiresIn,
	})
}

// Refresh 用 refresh 令牌换取新的令牌对（滑动会话）。
func (h *UserHandler) Refresh(c *gin.Context) {
	var req RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, err.Error())
		return
	}

	pair, err := h.svc.Refresh(c.Request.Context(), req.RefreshToken)
	if err != nil {
		if errors.Is(err, service.ErrInvalidRefresh) {
			Unauthorized(c, "invalid or expired refresh token")
			return
		}
		if errors.Is(err, service.ErrUserBanned) {
			Error(c, http.StatusForbidden, 40301, "account banned")
			return
		}
		h.logger.Error("refresh failed", zap.Error(err))
		InternalError(c, "refresh failed")
		return
	}

	Success(c, gin.H{
		"access_token":  pair.AccessToken,
		"refresh_token": pair.RefreshToken,
		"expires_in":    pair.ExpiresIn,
	})
}

// Logout 结束当前会话。
//
// 服务端不保存会话状态，因此这里不吊销任何令牌：客户端删除本地令牌即为登出。
// 特别地，不递增 token_version——那会把该用户所有设备一并踢下线，属意外行为；
// 全量吊销只发生在改密。真正的单设备吊销要等有了 device/session 表再做。
//
// 端点本身仍挂在 AuthRequired 之后：匿名请求返回 401，前端据此区分「未登录」与「已登出」。
//
//	@Summary		退出登录
//	@Tags			auth
//	@Security		BearerAuth
//	@Success		204
//	@Router			/api/v1/auth/logout [post]
func (h *UserHandler) Logout(c *gin.Context) {
	c.Status(http.StatusNoContent)
}

// userProfileResponse 组装本人资料响应。
//
// 内嵌 *model.User 而非逐字段重列：字段一旦重列，model 以后加列就得两处同步，
// 漏一处就是前端拿不到的新字段。状态三列在 model 上是 json:"-"，故在此显式补出——
// 必须经 EffectiveStatus 取，直接读字段会把已过期的状态吐给客户端。
type userProfileResponse struct {
	*model.User
	StatusEmoji string `json:"status_emoji"`
	StatusText  string `json:"status_text"`
}

// newUserProfileResponse 按 now 时刻的有效状态组装本人资料。
func newUserProfileResponse(u *model.User) userProfileResponse {
	emoji, text := u.EffectiveStatus(time.Now())
	return userProfileResponse{User: u, StatusEmoji: emoji, StatusText: text}
}

// GetProfile 返回当前用户的个人资料。
func (h *UserHandler) GetProfile(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "not authenticated")
		return
	}

	user, err := h.svc.Profile(c.Request.Context(), userID)
	if err != nil {
		if errors.Is(err, service.ErrUserNotFound) {
			NotFound(c, "user not found")
			return
		}
		h.logger.Error("get profile failed", zap.Error(err))
		InternalError(c, "failed to get profile")
		return
	}

	Success(c, newUserProfileResponse(user))
}

// UpdateProfile 更新当前用户的资料字段。
func (h *UserHandler) UpdateProfile(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "not authenticated")
		return
	}

	var req UpdateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, err.Error())
		return
	}

	user, err := h.svc.UpdateProfile(c.Request.Context(), userID, service.ProfilePatch{
		Nickname:       req.Nickname,
		AvatarURL:      req.AvatarURL,
		Bio:            req.Bio,
		Gender:         req.Gender,
		StatusEmoji:    req.StatusEmoji,
		StatusText:     req.StatusText,
		StatusDuration: req.StatusDuration,
	})
	if err != nil {
		if errors.Is(err, service.ErrUserNotFound) {
			NotFound(c, "user not found")
			return
		}
		h.logger.Error("update profile failed", zap.Error(err))
		InternalError(c, "failed to update profile")
		return
	}

	Success(c, newUserProfileResponse(user))
}

// GetPublicProfile 查任意用户的公开资料（好友资料页用，不含手机号/邮箱）。
func (h *UserHandler) GetPublicProfile(c *gin.Context) {
	targetID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid user id")
		return
	}

	user, err := h.svc.Profile(c.Request.Context(), targetID)
	if err != nil {
		if errors.Is(err, service.ErrUserNotFound) {
			NotFound(c, "user not found")
			return
		}
		h.logger.Error("get public profile failed", zap.Error(err))
		InternalError(c, "failed to get profile")
		return
	}

	// 公开资料不含 phone/email，故逐字段列出而非内嵌 model
	emoji, text := user.EffectiveStatus(time.Now())
	Success(c, gin.H{
		"id":           user.ID,
		"nickname":     user.Nickname,
		"avatar_url":   user.AvatarURL,
		"short_id":     user.ShortID,
		"bio":          user.Bio,
		"gender":       user.Gender,
		"status_emoji": emoji,
		"status_text":  text,
	})
}

// --- 请求 / 响应结构 ---

type RegisterRequest struct {
	Phone         string `json:"phone" binding:"omitempty,len=11"`
	Email         string `json:"email" binding:"omitempty,email"`
	Password      string `json:"password" binding:"required,min=8,max=64"`
	Nickname      string `json:"nickname" binding:"required,min=1,max=50"`
	CaptchaID     string `json:"captcha_id" binding:"required"`
	CaptchaAnswer int    `json:"captcha_answer" binding:"required"`
}

type LoginRequest struct {
	Account  string `json:"account" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

type UpdateProfileRequest struct {
	Nickname  *string `json:"nickname" binding:"omitempty,min=1,max=50"`
	AvatarURL *string `json:"avatar_url" binding:"omitempty,url"`
	Bio       *string `json:"bio" binding:"omitempty,max=500"`
	Gender    *int16  `json:"gender" binding:"omitempty,oneof=0 1 2"`

	StatusEmoji    *string `json:"status_emoji" binding:"omitempty,max=16"`
	StatusText     *string `json:"status_text" binding:"omitempty,max=64"`
	StatusDuration *int64  `json:"status_duration" binding:"omitempty,min=0,max=2592000"`
}
