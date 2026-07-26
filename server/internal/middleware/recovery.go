package middleware

import (
	"fmt"
	"net/http"
	"runtime/debug"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// Recovery panic 恢复中间件
func Recovery(logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if err := recover(); err != nil {
				stack := debug.Stack()

				fields := []zap.Field{
					zap.Any("error", err),
					zap.String("req_id", c.GetString(RequestIDKey)),
					zap.String("path", c.Request.URL.Path),
					zap.String("method", c.Request.Method),
					zap.String("stack", string(stack)),
				}
				if userID, ok := GetUserID(c); ok {
					fields = append(fields, zap.String("user_id", userID.String()))
				}
				logger.Error("panic recovered", fields...)

				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
					"code":    500,
					"message": fmt.Sprintf("internal server error: %v", err),
				})
			}
		}()

		c.Next()
	}
}
