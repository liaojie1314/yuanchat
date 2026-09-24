// Package testutil 提供测试专用的进程内依赖夹具。
//
// 本包的构造函数都接收 *testing.T 并自行登记清理钩子，因此只应在测试代码中调用。
// 夹具放在独立包内，是为了让 service 与 handler 等多个包共享同一份实现。
package testutil

import (
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

// NewRedis 启动进程内 miniredis，返回连向它的客户端与该实例的句柄。
//
// 客户端与实例都在测试结束时自动关闭，调用方无需手动释放。
// 同时返回实例句柄，是为了让用例能通过 miniredis 的 FastForward 推进时间，
// 从而在不真实等待的前提下断言键的 TTL 行为。
func NewRedis(t *testing.T) (*redis.Client, *miniredis.Miniredis) {
	t.Helper()

	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	return rdb, mr
}
