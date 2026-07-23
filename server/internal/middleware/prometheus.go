package middleware

import (
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/yuanchat/server/internal/metrics"
)

// Prometheus 记录每条 HTTP 请求的数量与耗时。
// 使用 gin.FullPath() 而非原始 URL，确保路由模板（如 /messages/:id）
// 聚合在同一时间序列，不因路径参数产生高基数。
func Prometheus() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()

		path := c.FullPath()
		if path == "" {
			path = "unknown"
		}
		status := strconv.Itoa(c.Writer.Status())
		elapsed := time.Since(start).Seconds()

		metrics.HTTPRequestsTotal.WithLabelValues(c.Request.Method, path, status).Inc()
		metrics.HTTPRequestDuration.WithLabelValues(c.Request.Method, path).Observe(elapsed)
	}
}
