package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
)

// RequireAdmin 管理员权限中间件。
//
// 必须挂在 AuthRequired 之后：从上下文取 user_id 查库校验 role，
// 非 admin 返回 403。每请求一次查询（管理端点低频，无需缓存），
// 同时保证封禁/降权立即生效。
func RequireAdmin(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := GetUserID(c)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    401,
				"message": "unauthorized",
			})
			return
		}

		var user model.User
		if err := db.WithContext(c.Request.Context()).
			Select("id", "role", "status").
			First(&user, "id = ?", userID).Error; err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    401,
				"message": "user not found",
			})
			return
		}
		if user.Role != model.RoleAdmin || user.Status != model.UserStatusNormal {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"code":    403,
				"message": "admin privilege required",
			})
			return
		}
		c.Next()
	}
}
