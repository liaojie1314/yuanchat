package ws

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// testRedis 连接本地开发 Redis（deploy/docker-compose.yml 的 redis :6380）。
// 不可达时跳过集成用例（CI 无 Redis 环境仍绿）。
func testRedis(t *testing.T) *redis.Client {
	t.Helper()
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6380", DB: 2})
	if err := rdb.Ping(t.Context()).Err(); err != nil {
		t.Skipf("dev redis unavailable, skip integration test: %v", err)
	}
	t.Cleanup(func() { _ = rdb.Close() })
	return rdb
}

// waitUntil 轮询直到条件成立或超时。
func waitUntil(t *testing.T, timeout time.Duration, cond func() bool) bool {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return true
		}
		time.Sleep(20 * time.Millisecond)
	}
	return cond()
}

// TestRedisPresenceCrossInstance 双实例：A 发布上线，B 的 mirror 与回调都感知。
func TestRedisPresenceCrossInstance(t *testing.T) {
	rdb := testRedis(t)
	channel := "presence:test:" + uuid.NewString()

	instA := NewRedisPresence(rdb, channel, zap.NewNop())
	defer func() { _ = instA.Close() }()
	instB := NewRedisPresence(rdb, channel, zap.NewNop())
	defer func() { _ = instB.Close() }()

	var gotUser uuid.UUID
	var gotOnline bool
	notified := make(chan struct{}, 4)
	instB.SetRemoteHandler(func(userID uuid.UUID, online bool) {
		gotUser, gotOnline = userID, online
		notified <- struct{}{}
	})

	// 订阅生效需要一点时间
	time.Sleep(200 * time.Millisecond)

	alice := uuid.New()
	instA.PublishOnline(alice)

	select {
	case <-notified:
	case <-time.After(3 * time.Second):
		t.Fatal("instance B did not receive online event")
	}
	if gotUser != alice || !gotOnline {
		t.Fatalf("got (%s, %v), want (%s, true)", gotUser, gotOnline, alice)
	}

	// B 的 mirror 应认为 alice 远端在线
	if !waitUntil(t, time.Second, func() bool {
		return len(instB.FilterRemoteOnline([]uuid.UUID{alice})) == 1
	}) {
		t.Fatal("instance B mirror should mark alice online")
	}
	// A 自己发布的事件不进自己的 mirror
	if len(instA.FilterRemoteOnline([]uuid.UUID{alice})) != 0 {
		t.Fatal("instance A must ignore its own events")
	}

	// 下线后 mirror 清除
	instA.PublishOffline(alice)
	select {
	case <-notified:
	case <-time.After(3 * time.Second):
		t.Fatal("instance B did not receive offline event")
	}
	if !waitUntil(t, time.Second, func() bool {
		return len(instB.FilterRemoteOnline([]uuid.UUID{alice})) == 0
	}) {
		t.Fatal("instance B mirror should clear alice after offline")
	}
}

// TestRedisPresenceMultiInstanceRefcount 同一用户在两个远端实例在线：
// 一个下线后仍在线（引用计数），全部下线才移除。
func TestRedisPresenceMultiInstanceRefcount(t *testing.T) {
	rdb := testRedis(t)
	channel := "presence:test:" + uuid.NewString()

	observer := NewRedisPresence(rdb, channel, zap.NewNop())
	defer func() { _ = observer.Close() }()
	remote1 := NewRedisPresence(rdb, channel, zap.NewNop())
	defer func() { _ = remote1.Close() }()
	remote2 := NewRedisPresence(rdb, channel, zap.NewNop())
	defer func() { _ = remote2.Close() }()

	time.Sleep(200 * time.Millisecond)

	bob := uuid.New()
	remote1.PublishOnline(bob)
	remote2.PublishOnline(bob)

	if !waitUntil(t, 2*time.Second, func() bool {
		observer.mu.RLock()
		defer observer.mu.RUnlock()
		return observer.mirror[bob] == 2
	}) {
		t.Fatal("observer mirror refcount should reach 2")
	}

	remote1.PublishOffline(bob)
	if !waitUntil(t, 2*time.Second, func() bool {
		return len(observer.FilterRemoteOnline([]uuid.UUID{bob})) == 1
	}) {
		t.Fatal("bob should still be online (one instance left)")
	}

	remote2.PublishOffline(bob)
	if !waitUntil(t, 2*time.Second, func() bool {
		return len(observer.FilterRemoteOnline([]uuid.UUID{bob})) == 0
	}) {
		t.Fatal("bob should be offline after all instances left")
	}
}

// TestHubOnlineFilterMergesBackend Hub 全局在线判定 = 本地 OR 远端 mirror。
func TestHubOnlineFilterMergesBackend(t *testing.T) {
	rdb := testRedis(t)
	channel := "presence:test:" + uuid.NewString()

	hub := NewHub(0, zap.NewNop())
	backend := NewRedisPresence(rdb, channel, zap.NewNop())
	defer func() { _ = backend.Close() }()
	hub.SetPresenceBackend(backend)

	remote := NewRedisPresence(rdb, channel, zap.NewNop())
	defer func() { _ = remote.Close() }()

	time.Sleep(200 * time.Millisecond)

	carol := uuid.New()
	remote.PublishOnline(carol)

	if !waitUntil(t, 2*time.Second, func() bool {
		return len(hub.OnlineFilter([]uuid.UUID{carol})) == 1
	}) {
		t.Fatal("hub.OnlineFilter should see carol via remote mirror")
	}
}

// TestLocalPresenceNoop local 后端全 no-op（单实例回归）。
func TestLocalPresenceNoop(t *testing.T) {
	p := NewLocalPresence()
	u := uuid.New()
	p.PublishOnline(u)
	p.PublishOffline(u)
	if got := p.FilterRemoteOnline([]uuid.UUID{u}); len(got) != 0 {
		t.Fatalf("local backend must report no remote online, got %v", got)
	}
	if err := p.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
}
