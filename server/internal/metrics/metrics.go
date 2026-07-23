// Package metrics 统一注册 Prometheus 指标（全局单例，进程内唯一注册）。
// 本包在首次 import 时通过 promauto 自动注册，无需显式调用 Init。
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// HTTPRequestsTotal HTTP 请求总量，按 method / path / status 分组。
	// path 使用 gin.FullPath()，避免高基数问题（如 /messages/:id 而非真实 UUID）。
	HTTPRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "yuanchat_http_requests_total",
		Help: "Total number of HTTP requests by method, path and status code",
	}, []string{"method", "path", "status"})

	// HTTPRequestDuration HTTP 请求耗时分布（秒）。
	HTTPRequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "yuanchat_http_request_duration_seconds",
		Help:    "HTTP request latency distribution in seconds",
		Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5},
	}, []string{"method", "path"})

	// WSConnectionsActive 当前活跃 WebSocket 连接数（Gauge）。
	WSConnectionsActive = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "yuanchat_ws_connections_active",
		Help: "Number of currently active WebSocket connections",
	})

	// WSMessagesTotal WebSocket 消息总量，按方向分组（send | receive | system）。
	WSMessagesTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "yuanchat_ws_messages_total",
		Help: "Total WebSocket messages processed by direction",
	}, []string{"type"})

	// ChatMessagesSentTotal 业务层消息发送总量，按消息类型分组。
	ChatMessagesSentTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "yuanchat_chat_messages_sent_total",
		Help: "Total chat messages sent by message type",
	}, []string{"message_type"})
)
