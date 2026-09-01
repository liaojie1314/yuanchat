package middleware

import (
	"context"
	"net/http"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"github.com/yuanchat/server/internal/metrics"
	"go.uber.org/zap"
)

// rateLimitRedis 保存全局分布式限流后端（Redis 客户端）。
//
// LimitByIP 的对外签名与限流档位不变，Redis 后端由装配层（router）在注册路由前
// 通过 SetRateLimitRedis 注入一次，全部 LimitByIP 实例共享；未注入时退回进程内
// 令牌桶（单实例默认行为零变化）。atomic.Pointer 保证并发读无锁。
var (
	rateLimitRedis  atomic.Pointer[redis.Client]
	rateLimitLogger atomic.Pointer[zap.Logger]
)

// SetRateLimitRedis 启用分布式限流：之后所有 LimitByIP 的判定走 Redis 原子令牌桶。
// rdb 为 nil 时本调用是空操作（保持进程内实现）。logger 用于记录 Redis 故障降级日志。
func SetRateLimitRedis(rdb *redis.Client, logger *zap.Logger) {
	if rdb != nil {
		rateLimitRedis.Store(rdb)
	}
	if logger != nil {
		rateLimitLogger.Store(logger)
	}
}

// rateLimitScript 是 Redis 端原子令牌桶的 Lua 实现。
//
// 桶状态以 hash 存储：tokens（当前令牌数，浮点）+ ts（上次结算时间，unix ms）。
// KEYS[1]=限流键，ARGV=[rate, capacity, nowMs, ttlSeconds]。
// 整个「结算增量 → 判定 → 回写 → 续 TTL」过程在脚本内原子完成，
// 多实例对同一 IP 的判定共享同一份状态。
var rateLimitScript = redis.NewScript(`
local tokens = tonumber(ARGV[2])
local ts = tonumber(ARGV[3])
local b = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
if b[1] then
	tokens = tonumber(b[1])
	ts = tonumber(b[2])
end
if tonumber(ARGV[3]) > ts then
	tokens = math.min(tonumber(ARGV[2]), tokens + (tonumber(ARGV[3]) - ts) / 1000.0 * tonumber(ARGV[1]))
end
local allowed = 0
if tokens >= 1 then
	tokens = tokens - 1
	allowed = 1
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return allowed
`)

// rateLimitScope 给每个 RateLimiter 实例分配一个序号，进 Redis 键：
// 进程内版每个 LimitByIP 各有独立 map（端点间互不挤占），分布式版必须
// 复刻这个隔离——否则同一 IP 打不同档位的端点会共耗同一个桶。
// 路由注册顺序在同一二进制的各实例间一致，因此序号在多实例下也一致。
var rateLimitScope atomic.Int64

// RateLimiter 简易令牌桶限流器（单机版）
//
// 使用内存 map 存储每个 IP 的令牌桶，适用于单机部署。
// 装配层注入 Redis 后端（SetRateLimitRedis）后，allow 判定改走
// Redis 原子令牌桶（多实例共享同一份限流状态），本结构仅作为
// 单实例默认路径与 Redis 未注入时的回退。
//
// 自动清理：每 10 分钟扫描一次，删除超过 10 分钟无活动的桶。
type RateLimiter struct {
	mu       sync.Mutex
	buckets  map[string]*tokenBucket
	rate     int           // 每秒生成的令牌数
	capacity int           // 桶容量
	cleanup  time.Duration // 清理过期桶的间隔
	scope    int64         // Redis 模式下的隔离序号（见 rateLimitScope）
}

type tokenBucket struct {
	tokens   float64
	lastTime time.Time
}

// NewRateLimiter 创建限流器
func NewRateLimiter(rate, capacity int) *RateLimiter {
	limiter := &RateLimiter{
		buckets:  make(map[string]*tokenBucket),
		rate:     rate,
		capacity: capacity,
		cleanup:  10 * time.Minute,
		scope:    rateLimitScope.Add(1),
	}

	go limiter.cleanupExpired()

	return limiter
}

func (rl *RateLimiter) allow(key string) bool {
	if rdb := rateLimitRedis.Load(); rdb != nil {
		return redisAllow(rdb, strconv.FormatInt(rl.scope, 10)+":"+key, rl.rate, rl.capacity)
	}

	rl.mu.Lock()
	defer rl.mu.Unlock()

	bucket, exists := rl.buckets[key]
	now := time.Now()

	if !exists {
		bucket = &tokenBucket{
			tokens:   float64(rl.capacity) - 1,
			lastTime: now,
		}
		rl.buckets[key] = bucket
		return true
	}

	elapsed := now.Sub(bucket.lastTime).Seconds()
	bucket.tokens += elapsed * float64(rl.rate)
	if bucket.tokens > float64(rl.capacity) {
		bucket.tokens = float64(rl.capacity)
	}
	bucket.lastTime = now

	if bucket.tokens >= 1 {
		bucket.tokens--
		return true
	}

	return false
}

// redisAllow 执行 Redis 端原子令牌桶判定。
//
// 降级姿态：fail-open（放行）。理由——限流是可用性保护措施，Redis 抖动时
// 拒绝请求等于把存储故障放大为全站 429/503，与 presence 发布故障时
// 「记日志继续」的容错姿态一致（进程内客户端在 main 启动时 Ping 失败即 Fatal，
// 运行期 Redis 短暂不可达只影响新写入）。降级期间多实例各自为政，
// 但单实例行为仍正确；每次拒绝/降级都记 Prometheus 指标便于告警。
func redisAllow(rdb *redis.Client, key string, rate, capacity int) bool {
	logger := rateLimitLogger.Load()

	// 键 TTL：桶从空回满需要 capacity/rate 秒，翻倍再加 10s 下限，
	// 保证不活跃 IP 的桶状态自动过期，不长期占用 Redis 内存。
	ttl := capacity/rate*2 + 10
	now := time.Now().UnixMilli()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	allowed, err := rateLimitScript.Run(ctx, rdb,
		[]string{"yuanchat:rl:" + key},
		rate, capacity, now, ttl,
	).Int()
	if err != nil {
		if logger != nil {
			logger.Warn("rate limit redis unavailable, failing open",
				zap.String("key", key), zap.Error(err))
		}
		metrics.RateLimitRejectedTotal.WithLabelValues("redis_degraded").Inc()
		return true
	}

	if allowed == 0 {
		metrics.RateLimitRejectedTotal.WithLabelValues("redis").Inc()
	}
	return allowed == 1
}

func (rl *RateLimiter) cleanupExpired() {
	ticker := time.NewTicker(rl.cleanup)
	defer ticker.Stop()

	for range ticker.C {
		rl.mu.Lock()
		now := time.Now()
		for key, bucket := range rl.buckets {
			if now.Sub(bucket.lastTime) > rl.cleanup {
				delete(rl.buckets, key)
			}
		}
		rl.mu.Unlock()
	}
}

// LimitByIP 按 IP 限流的 Gin 中间件
//
// 未注入 Redis 后端时为进程内令牌桶（单实例语义）；
// 注入后为 Redis 原子令牌桶（多实例共享配额），限流档位不变。
func LimitByIP(rate, capacity int) gin.HandlerFunc {
	limiter := NewRateLimiter(rate, capacity)

	return func(c *gin.Context) {
		key := c.ClientIP()
		if !limiter.allow(key) {
			// 未注入 Redis 时（进程内路径）在此计数；Redis 路径的拒绝计数在 redisAllow 内
			if rateLimitRedis.Load() == nil {
				metrics.RateLimitRejectedTotal.WithLabelValues("inproc").Inc()
			}
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"code":    429,
				"message": "rate limit exceeded, please try again later",
			})
			return
		}
		c.Next()
	}
}
