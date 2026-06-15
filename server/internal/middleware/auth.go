package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/config"
)

// Claims JWT 声明
//
// 嵌入 jwt.RegisteredClaims 提供标准的 exp/iat/nbf 等字段。
// UserID 和 DeviceID 是元聊扩展的自定义声明。
type Claims struct {
	UserID   uuid.UUID `json:"user_id"`
	DeviceID string    `json:"device_id"`
	jwt.RegisteredClaims
}

// AuthRequired JWT 认证中间件
//
// 从 Authorization Header 提取 Bearer Token，解析 JWT 后将 user_id 和 device_id
// 注入到 Gin Context 中（通过 c.Set），后续 handler 可通过 GetUserID 获取。
// Token 无效或缺失时返回 401。
func AuthRequired(cfg config.JWTConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenString := extractToken(c)
		if tokenString == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    401,
				"message": "authorization token required",
			})
			return
		}

		claims := &Claims{}
		token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (any, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return []byte(cfg.Secret), nil
		})

		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    401,
				"message": "invalid or expired token",
			})
			return
		}

		// 将用户信息注入上下文
		c.Set("user_id", claims.UserID)
		c.Set("device_id", claims.DeviceID)
		c.Next()
	}
}

// extractToken 从 Authorization Header 提取 Bearer Token
//
// 支持格式: "Bearer <token>"（大小写不敏感）。
// 返回空字符串表示未提供或格式错误。
func extractToken(c *gin.Context) string {
	authHeader := c.GetHeader("Authorization")
	if authHeader == "" {
		return ""
	}

	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
		return parts[1]
	}

	return ""
}

// GetUserID 从 Gin Context 中获取经过 AuthRequired 中间件注入的用户 ID
//
// 返回值第二个参数为 false 表示 Context 中不存在 user_id（中间件未执行或类型错误）。
func GetUserID(c *gin.Context) (uuid.UUID, bool) {
	userID, exists := c.Get("user_id")
	if !exists {
		return uuid.Nil, false
	}
	id, ok := userID.(uuid.UUID)
	return id, ok
}
