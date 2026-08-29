package testutil

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func TestNewRedisRoundTrip(t *testing.T) {
	rdb, _ := NewRedis(t)
	ctx := context.Background()

	if err := rdb.Set(ctx, "auth:probe", "1", 0).Err(); err != nil {
		t.Fatalf("set: %v", err)
	}
	got, err := rdb.Get(ctx, "auth:probe").Result()
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got != "1" {
		t.Fatalf("got %q, want %q", got, "1")
	}
}

// TestNewRedisFastForwardExpiresKey 证明夹具返回的 miniredis 句柄可推进时间，
// 使 TTL 相关用例无需真实等待。
func TestNewRedisFastForwardExpiresKey(t *testing.T) {
	rdb, mr := NewRedis(t)
	ctx := context.Background()

	if err := rdb.Set(ctx, "auth:probe:ttl", "1", time.Minute).Err(); err != nil {
		t.Fatalf("set: %v", err)
	}

	mr.FastForward(2 * time.Minute)

	if err := rdb.Get(ctx, "auth:probe:ttl").Err(); !errors.Is(err, redis.Nil) {
		t.Fatalf("FastForward 后 key 应已过期，err = %v", err)
	}
}
