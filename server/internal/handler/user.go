package handler

import (
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// UserHandler 用户相关处理器
type UserHandler struct {
	logger *zap.Logger
}

// NewUserHandler 创建用户处理器
func NewUserHandler(logger *zap.Logger) *UserHandler {
	return &UserHandler{logger: logger}
}

// Register 用户注册
//
//	@Summary		用户注册
//	@Description	通过手机号或邮箱注册新用户
//	@Tags			user
//	@Accept			json
//	@Produce		json
//	@Param			body	body		RegisterRequest	true	"注册信息"
//	@Success		201		{object}	Response		"注册成功"
//	@Router			/api/v1/users/register [post]
func (h *UserHandler) Register(c *gin.Context) {
	// TODO: 实现注册逻辑
	Created(c, gin.H{"message": "register endpoint - to be implemented"})
}

// Login 用户登录
//
//	@Summary		用户登录
//	@Description	通过手机号/邮箱 + 密码登录
//	@Tags			user
//	@Accept			json
//	@Produce		json
//	@Param			body	body		LoginRequest	true	"登录信息"
//	@Success		200		{object}	Response		"登录成功，返回 token"
//	@Router			/api/v1/users/login [post]
func (h *UserHandler) Login(c *gin.Context) {
	// TODO: 实现登录逻辑
	Success(c, gin.H{"message": "login endpoint - to be implemented"})
}

// GetProfile 获取当前用户资料
//
//	@Summary		获取当前用户资料
//	@Tags			user
//	@Security		BearerAuth
//	@Produce		json
//	@Success		200	{object}	Response	"用户资料"
//	@Router			/api/v1/users/me [get]
func (h *UserHandler) GetProfile(c *gin.Context) {
	// TODO: 实现获取资料逻辑
	Success(c, gin.H{"message": "get profile endpoint - to be implemented"})
}

// UpdateProfile 更新用户资料
//
//	@Summary		更新用户资料
//	@Tags			user
//	@Security		BearerAuth
//	@Accept			json
//	@Produce		json
//	@Param			body	body		UpdateProfileRequest	true	"资料信息"
//	@Success		200		{object}	Response				"更新成功"
//	@Router			/api/v1/users/me [put]
func (h *UserHandler) UpdateProfile(c *gin.Context) {
	// TODO: 实现更新资料逻辑
	Success(c, gin.H{"message": "update profile endpoint - to be implemented"})
}

// --- 请求/响应结构体 ---

// RegisterRequest 注册请求
//
// Phone 和 Email 至少填写一个（由 omitempty 标记允许为空）。
// 验证码 Code 为 6 位数字字符串。
// 密码最小 8 位，最长 64 位（适应 Bcrypt 72 字节限制）。
type RegisterRequest struct {
	Phone    string `json:"phone" binding:"omitempty,len=11"`
	Email    string `json:"email" binding:"omitempty,email"`
	Password string `json:"password" binding:"required,min=8,max=64"`
	Code     string `json:"code" binding:"required,len=6"`
	Nickname string `json:"nickname" binding:"required,min=1,max=50"`
}

// LoginRequest 登录请求
//
// Account 可以是手机号或邮箱，由服务端自动识别。
type LoginRequest struct {
	Account  string `json:"account" binding:"required"` // 手机号或邮箱
	Password string `json:"password" binding:"required"`
}

// UpdateProfileRequest 更新资料请求
//
// 所有字段使用指针类型，nil 表示不修改该字段（PATCH 语义）。
type UpdateProfileRequest struct {
	Nickname  *string `json:"nickname" binding:"omitempty,min=1,max=50"`
	AvatarURL *string `json:"avatar_url" binding:"omitempty,url"`
	Bio       *string `json:"bio" binding:"omitempty,max=500"`
	Gender    *int16  `json:"gender" binding:"omitempty,oneof=0 1 2"`
}
