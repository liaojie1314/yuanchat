package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	gojwt "github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/config"
	"github.com/yuanchat/server/internal/pkg/jwt"
)

// AuthRequired JWT 认证中间件
//
// 从 Authorization Header 提取 Bearer Token，解析 JWT 后将 user_id 和 device_id
// 注入到 Gin Context 中（通过 c.Set），后续 handler 可通过 GetUserID 获取。
// Token 无效、缺失或非 access 用途时返回 401。
//
// Claims 结构复用 pkg/jwt.Claims（uid/did/use JSON tag），
// 必须与 jwt.Generator 生成端一致，否则解析出的 UserID 恒为零值。
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

		claims := &jwt.Claims{}
		token, err := gojwt.ParseWithClaims(tokenString, claims, func(token *gojwt.Token) (any, error) {
			if _, ok := token.Method.(*gojwt.SigningMethodHMAC); !ok {
				return nil, gojwt.ErrSignatureInvalid
			}
			return []byte(cfg.Secret), nil
		})

		if err != nil || !token.Valid || claims.TokenUse != "access" {
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
