package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// CORS 跨域中间件
//
// Allow-Headers 必须逐个列出前端会发的自定义头：浏览器预检不接受通配，
// 漏一个头会让该请求在 preflight 阶段就被拦死，服务端日志里连请求都看不到
// （X-Qr-Poll-Secret 就是这么被漏掉过一次：Go 单测走 httptest 不做预检，
// MSW 也在网络层之前拦截，只有真浏览器打真后端才会暴露）。
func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Accept, Authorization, X-Request-ID, X-Qr-Poll-Secret")
		c.Header("Access-Control-Expose-Headers", "Content-Length, X-Request-ID")
		c.Header("Access-Control-Max-Age", "86400")

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}
