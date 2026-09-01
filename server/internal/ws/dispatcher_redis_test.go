package ws

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/yuanchat/server/internal/testutil"
	"go.uber.org/zap"
)

// newTestRedis 启动 miniredis 并返回连向它的客户端（测试结束自动清理）。
func newTestRedis(t *testing.T) *redis.Client {
	t.Helper()
	rdb, _ := testutil.NewRedis(t)
	return rdb
}

func TestRedisDispatcherCrossInstanceDelivery(t *testing.T) {
	rdb := newTestRedis(t)

	// 两个独立实例：各自有 Hub 与 Dispatcher，共享同一 Redis
	hubA := NewHub(0, zap.NewNop())
	hubB := NewHub(0, zap.NewNop())
	dispA := NewRedisDispatcher(rdb, "", hubA, zap.NewNop())
	dispB := NewRedisDispatcher(rdb, "", hubB, zap.NewNop())
	t.Cleanup(func() {
		_ = dispA.Close()
		_ = dispB.Close()
	})
	hubA.SetRemotePublisher(dispA.Publish)
	hubB.SetRemotePublisher(dispB.Publish)

	uid := uuid.New()
	cA := newTestClient(uid)
	cB := newTestClient(uid)
	hubA.Register(cA)
	hubB.Register(cB)

	// 等双方订阅就绪再发布，避免订阅尚未建立导致偶发丢帧
	waitSubscribers(t, rdb, "ws:dispatch", 2)

	// 实例 A 发消息：本机 cA 收到一次，跨实例后 cB 收到一次
	hubA.SendToUsers([]uuid.UUID{uid}, []byte("hello"))

	waitFor(t, func() bool {
		select {
		case <-cB.send:
			return true
		default:
			return false
		}
	}, "instance B should receive the frame via pub/sub")

	// 自环避免：cA 恰好一次——先消费本机投递的那帧，
	// 再断言订阅路径没有给自己重复投递
	select {
	case data := <-cA.send:
		if string(data) != "hello" {
			t.Fatalf("unexpected local payload %q", data)
		}
	default:
		t.Fatal("local client should receive the frame once")
	}
	select {
	case data := <-cA.send:
		t.Fatalf("local client must not receive duplicate, got %q", data)
	default:
	}
}

func TestRedisDispatcherNoDuplicateAcrossInstances(t *testing.T) {
	rdb := newTestRedis(t)

	// 三个实例，用户只连在 C：A 发布后仅 C 收到，A/B 不收到
	hubA := NewHub(0, zap.NewNop())
	hubB := NewHub(0, zap.NewNop())
	hubC := NewHub(0, zap.NewNop())
	for _, d := range []*RedisDispatcher{
		NewRedisDispatcher(rdb, "ws:dispatch:test", hubA, zap.NewNop()),
		NewRedisDispatcher(rdb, "ws:dispatch:test", hubB, zap.NewNop()),
		NewRedisDispatcher(rdb, "ws:dispatch:test", hubC, zap.NewNop()),
	} {
		hub := d.hub
		hub.SetRemotePublisher(d.Publish)
		t.Cleanup(func() { _ = d.Close() })
	}

	uid := uuid.New()
	cA := newTestClient(uid)
	cB := newTestClient(uid)
	cC := newTestClient(uid)
	hubA.Register(cA)
	hubB.Register(cB)
	hubC.Register(cC)

	// 订阅是异步建立的：等三个实例都出现在 channel 的订阅者列表里再发布，
	// 否则发布可能早于订阅生效造成偶发丢帧
	waitSubscribers(t, rdb, "ws:dispatch:test", 3)

	hubA.SendToUsers([]uuid.UUID{uid}, []byte("only-once"))

	waitFor(t, func() bool {
		select {
		case <-cC.send:
			return true
		default:
			return false
		}
	}, "instance C should receive the frame")

	// 先消费发布方本机投递的那帧，再断言订阅路径没有给它重复投递
	select {
	case <-cA.send:
	default:
		t.Fatal("publisher local client should receive the frame locally")
	}
	select {
	case data := <-cA.send:
		t.Fatalf("publisher instance must not receive via subscription, got %q", data)
	default:
	}
	// 用户在 B 也在线：B 恰好收到一次（订阅路径）
	waitFor(t, func() bool {
		select {
		case <-cB.send:
			return true
		default:
			return false
		}
	}, "instance B should receive the frame via pub/sub")
	select {
	case <-cB.send:
		t.Fatal("instance B must receive exactly once")
	default:
	}
}

func TestRedisDispatcherOfflineTargetNoDelivery(t *testing.T) {
	rdb := newTestRedis(t)

	hubA := NewHub(0, zap.NewNop())
	hubB := NewHub(0, zap.NewNop())
	dispA := NewRedisDispatcher(rdb, "", hubA, zap.NewNop())
	dispB := NewRedisDispatcher(rdb, "", hubB, zap.NewNop())
	hubA.SetRemotePublisher(dispA.Publish)
	hubB.SetRemotePublisher(dispB.Publish)
	t.Cleanup(func() {
		_ = dispA.Close()
		_ = dispB.Close()
	})

	// 用户在 A、B 都不在线：发布后谁都不应收到
	offline := uuid.New()
	ghost := newTestClient(offline) // 从未 Register
	hubA.SendToUsers([]uuid.UUID{offline}, []byte("nobody"))

	time.Sleep(100 * time.Millisecond)
	select {
	case data := <-ghost.send:
		t.Fatalf("unregistered client got %q", data)
	default:
	}
}

// waitSubscribers 轮询直到 channel 的订阅者数量达到 n（超时 fail）。
func waitSubscribers(t *testing.T, rdb *redis.Client, channel string, n int) {
	t.Helper()
	waitFor(t, func() bool {
		m, err := rdb.PubSubNumSub(t.Context(), channel).Result()
		if err != nil {
			return false
		}
		return m[channel] >= int64(n)
	}, "subscribers should be ready on the channel")
}

// waitFor 轮询条件成立，超时 fail（Pub/Sub 是异步的，测试用短轮询等待）。
func waitFor(t *testing.T, cond func() bool, msg string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal(msg)
}
