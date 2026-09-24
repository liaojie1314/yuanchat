package middleware

import (
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// useRedisBackend 启动 miniredis 并把全局限流后端指向它，测试结束自动还原为进程内实现。
func useRedisBackend(t *testing.T) (*redis.Client, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		rateLimitRedis.Store(nil)
		_ = rdb.Close()
	})
	SetRateLimitRedis(rdb, zap.NewNop())
	return rdb, mr
}

func TestRedisTokenBucketAllowRejectBoundary(t *testing.T) {
	useRedisBackend(t)
	rl := NewRateLimiter(1, 3) // 1 token/s，容量 3

	// 容量内的前 3 次放行，第 4 次拒绝
	for i := 0; i < 3; i++ {
		if !rl.allow("1.2.3.4") {
			t.Fatalf("request %d within capacity should be allowed", i+1)
		}
	}
	if rl.allow("1.2.3.4") {
		t.Fatal("request beyond capacity should be rejected")
	}

	// 不同 IP 各自独立的桶
	if !rl.allow("5.6.7.8") {
		t.Fatal("different key should have its own bucket")
	}
}

func TestRedisTokenBucketRefill(t *testing.T) {
	rdb, _ := useRedisBackend(t)
	rl := NewRateLimiter(100, 1) // 100 token/s，容量 1

	if !rl.allow("a") || rl.allow("a") {
		t.Fatal("first allow, second reject expected")
	}

	// 真实等待 30ms，应回填约 3 个令牌（容量封顶 1），必然足够再放行一次
	time.Sleep(30 * time.Millisecond)
	if !rl.allow("a") {
		t.Fatal("token should refill over time")
	}
	_ = rdb
}

func TestRedisTokenBucketKeyTTL(t *testing.T) {
	rdb, _ := useRedisBackend(t)
	rl := NewRateLimiter(5, 10)

	rl.allow("ttl-ip")

	// 键带实例隔离序号（yuanchat:rl:{scope}:{ip}），用模式匹配找到它
	keys, err := rdb.Keys(t.Context(), "yuanchat:rl:*ttl-ip").Result()
	if err != nil || len(keys) != 1 {
		t.Fatalf("keys = %v, err = %v, want exactly 1", keys, err)
	}
	ttl, err := rdb.TTL(t.Context(), keys[0]).Result()
	if err != nil {
		t.Fatalf("TTL: %v", err)
	}
	// TTL = capacity/rate*2 + 10 = 14s；应落在 (0, 20s] 区间
	if ttl <= 0 || ttl > 20*time.Second {
		t.Fatalf("unexpected ttl: %v", ttl)
	}
}

func TestRedisTokenBucketConcurrent(t *testing.T) {
	useRedisBackend(t)
	rl := NewRateLimiter(1, 20)

	const n = 200
	var wg sync.WaitGroup
	allowed := make(chan struct{}, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if rl.allow("busy-ip") {
				allowed <- struct{}{}
			}
		}()
	}
	wg.Wait()
	close(allowed)

	got := len(allowed)
	// Lua 脚本原子判定：放行总数不得突破容量（允许 refill 期间 1 token/s 的少量回填）
	if got > 25 {
		t.Fatalf("allowed = %d, should be close to capacity 20", got)
	}
	if got < 20 {
		t.Fatalf("allowed = %d, should be at least capacity 20", got)
	}
}

func TestRedisUnavailableFailsOpen(t *testing.T) {
	mr := miniredis.RunT(t)
	// 短拨号超时 + 不重试：避免连接池对已关闭实例反复重拨拖慢测试
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr(), DialTimeout: 50 * time.Millisecond, MaxRetries: 0})
	t.Cleanup(func() {
		rateLimitRedis.Store(nil)
		_ = rdb.Close()
	})
	SetRateLimitRedis(rdb, zap.NewNop())
	mr.Close() // 模拟运行期 Redis 宕机

	rl := NewRateLimiter(1, 1)
	for i := 0; i < 10; i++ {
		if !rl.allow("down") {
			t.Fatal("redis unavailable should fail open (allow)")
		}
	}
}

func TestInprocFallbackWhenNoRedis(t *testing.T) {
	// 未注入 Redis（默认）：进程内令牌桶，行为与历史版本一致
	rl := NewRateLimiter(1, 2)
	if !rl.allow("x") || !rl.allow("x") {
		t.Fatal("inproc bucket should allow within capacity")
	}
	if rl.allow("x") {
		t.Fatal("inproc bucket should reject beyond capacity")
	}
}

func TestRedisBucketIsolationPerLimiter(t *testing.T) {
	useRedisBackend(t)
	// 两个同档位的限流器必须各用各的桶（对应不同端点互不挤占）
	a := NewRateLimiter(1, 2)
	b := NewRateLimiter(1, 2)

	for i := 0; i < 2; i++ {
		if !a.allow("same-ip") || !b.allow("same-ip") {
			t.Fatalf("limiter %d should have its own bucket", i)
		}
	}
	if a.allow("same-ip") || b.allow("same-ip") {
		t.Fatal("each limiter should reject beyond its own capacity")
	}
}
