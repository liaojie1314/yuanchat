package ws

import (
	"sync"
	"testing"

	"github.com/google/uuid"
	"go.uber.org/zap"
)

func newTestClient(userID uuid.UUID) *Client {
	return &Client{
		userID: userID,
		send:   make(chan []byte, sendBufferSize),
	}
}

func TestHubRegisterUnregister(t *testing.T) {
	hub := NewHub(0, zap.NewNop())
	uid := uuid.New()
	c := newTestClient(uid)

	if !hub.Register(c) {
		t.Fatal("register should succeed")
	}
	if got := hub.OnlineCount(uid); got != 1 {
		t.Fatalf("online count = %d, want 1", got)
	}

	hub.Unregister(c)
	if got := hub.OnlineCount(uid); got != 0 {
		t.Fatalf("online count after unregister = %d, want 0", got)
	}
}

func TestHubMultiDeviceDelivery(t *testing.T) {
	hub := NewHub(0, zap.NewNop())
	uid := uuid.New()
	other := uuid.New()

	c1 := newTestClient(uid)
	c2 := newTestClient(uid)
	c3 := newTestClient(other)
	hub.Register(c1)
	hub.Register(c2)
	hub.Register(c3)

	hub.SendToUsers([]uuid.UUID{uid}, []byte("hello"))

	for i, c := range []*Client{c1, c2} {
		select {
		case data := <-c.send:
			if string(data) != "hello" {
				t.Fatalf("client %d got %q", i, data)
			}
		default:
			t.Fatalf("client %d received nothing", i)
		}
	}

	select {
	case <-c3.send:
		t.Fatal("other user should not receive the frame")
	default:
	}
}

func TestHubConnectionLimit(t *testing.T) {
	hub := NewHub(2, zap.NewNop())
	uid := uuid.New()

	if !hub.Register(newTestClient(uid)) || !hub.Register(newTestClient(uid)) {
		t.Fatal("first two registrations should succeed")
	}
	if hub.Register(newTestClient(uid)) {
		t.Fatal("third registration should be rejected by limit")
	}
}

func TestHubFullBufferDoesNotBlock(t *testing.T) {
	hub := NewHub(0, zap.NewNop())
	uid := uuid.New()
	c := &Client{userID: uid, send: make(chan []byte, 1)}
	hub.Register(c)

	hub.SendToUsers([]uuid.UUID{uid}, []byte("first"))
	// 缓冲已满：不应阻塞，帧被丢弃
	done := make(chan struct{})
	go func() {
		hub.SendToUsers([]uuid.UUID{uid}, []byte("second"))
		close(done)
	}()
	<-done

	if got := <-c.send; string(got) != "first" {
		t.Fatalf("expected first frame, got %q", got)
	}
	select {
	case extra := <-c.send:
		t.Fatalf("dropped frame should not arrive, got %q", extra)
	default:
	}
}

func TestHubConcurrentAccess(t *testing.T) {
	hub := NewHub(0, zap.NewNop())
	uids := []uuid.UUID{uuid.New(), uuid.New(), uuid.New()}

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			uid := uids[n%len(uids)]
			c := newTestClient(uid)
			if hub.Register(c) {
				hub.SendToUsers(uids, []byte("x"))
				hub.Unregister(c)
			}
		}(i)
	}
	wg.Wait()

	for _, uid := range uids {
		if got := hub.OnlineCount(uid); got != 0 {
			t.Fatalf("user %s still has %d connections", uid, got)
		}
	}
}

func TestHubPresenceNotifyOnFirstAndLast(t *testing.T) {
	hub := NewHub(0, zap.NewNop())
	var mu sync.Mutex
	var events []bool
	hub.SetPresenceNotifier(func(_ uuid.UUID, online bool) {
		mu.Lock()
		events = append(events, online)
		mu.Unlock()
	})
	uid := uuid.New()
	c1 := newTestClient(uid)
	c2 := newTestClient(uid)
	hub.Register(c1)   // 首连 → online
	hub.Register(c2)   // 第二设备 → 不触发
	hub.Unregister(c1) // 还剩一连 → 不触发
	hub.Unregister(c2) // 末连 → offline
	mu.Lock()
	defer mu.Unlock()
	if len(events) != 2 || !events[0] || events[1] {
		t.Fatalf("expected [online, offline], got %v", events)
	}
}

func TestHubOnlineFilter(t *testing.T) {
	hub := NewHub(0, zap.NewNop())
	on := uuid.New()
	off := uuid.New()
	hub.Register(newTestClient(on))
	got := hub.OnlineFilter([]uuid.UUID{on, off})
	if len(got) != 1 || got[0] != on {
		t.Fatalf("filter: %v", got)
	}
}

// TestHubTotalConnections 校验全实例连接计数：同用户多设备与多用户均按
// 连接条数累加，逐条 Unregister 后计数精确回落。
func TestHubTotalConnections(t *testing.T) {
	hub := NewHub(0, zap.NewNop())

	uid := uuid.New()
	other := uuid.New()
	c1 := newTestClient(uid)
	c2 := newTestClient(uid) // 同用户第二台设备
	c3 := newTestClient(other)
	for i, c := range []*Client{c1, c2, c3} {
		if !hub.Register(c) {
			t.Fatalf("register client %d should succeed", i)
		}
	}
	if got := hub.TotalConnections(); got != 3 {
		t.Fatalf("total = %d, want 3", got)
	}

	hub.Unregister(c2)
	hub.Unregister(c3)
	if got := hub.TotalConnections(); got != 1 {
		t.Fatalf("total after unregister = %d, want 1", got)
	}
}
