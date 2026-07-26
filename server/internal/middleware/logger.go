package middleware

import (
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// requestFields 每条请求日志的规范字段集：
// req_id / user_id（已鉴权时）/ method / path / status / latency_ms。
// 聚合查询（Loki）按这些字段过滤，命名保持 snake_case 稳定。
func requestFields(c *gin.Context, latency time.Duration) []zap.Field {
	fields := []zap.Field{
		zap.String("req_id", c.GetString(RequestIDKey)),
		zap.String("method", c.Request.Method),
		zap.String("path", c.Request.URL.Path),
		zap.Int("status", c.Writer.Status()),
		zap.Float64("latency_ms", float64(latency.Microseconds())/1000),
		zap.String("ip", c.ClientIP()),
		zap.Int("body_size", c.Writer.Size()),
	}
	if userID, ok := GetUserID(c); ok {
		fields = append(fields, zap.String("user_id", userID.String()))
	}
	if q := c.Request.URL.RawQuery; q != "" {
		fields = append(fields, zap.String("query", q))
	}
	return fields
}

// Logger 返回 Gin 日志中间件，使用 Zap 记录
func Logger(logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()

		c.Next()

		fields := requestFields(c, time.Since(start))

		if len(c.Errors) > 0 {
			for _, e := range c.Errors {
				logger.Error("request error", append(fields, zap.Error(e.Err))...)
			}
		} else if c.Writer.Status() >= 500 {
			logger.Error("server error", fields...)
		} else if c.Writer.Status() >= 400 {
			logger.Warn("client error", fields...)
		} else {
			logger.Info("request", fields...)
		}
	}
}
