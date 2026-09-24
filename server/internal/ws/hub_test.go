package ws

import (
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"
)

func newTestClient(userID uuid.UUID) *Client {
	return &Client{
		userID: userID,
		// connID 与生产一致地逐连接生成：Hub 的 conns 索引以它为键，
		// 全部留零值会让多条测试连接互相覆盖同一个索引项。
		connID: uuid.New(),
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

// TestSendToConn 只投递给指定连接，同用户的其它连接收不到。
// device_id 在本仓是平台标签（登录固定写 "web"），多设备同值，
// 因此点对点信令只能按连接定址 —— 本用例钉住这个语义。
func TestSendToConn(t *testing.T) {
	hub := NewHub(0, zap.NewNop())
	uid := uuid.New()
	c1 := &Client{userID: uid, connID: uuid.New(), send: make(chan []byte, 4), hub: hub}
	c2 := &Client{userID: uid, connID: uuid.New(), send: make(chan []byte, 4), hub: hub}
	hub.Register(c1)
	hub.Register(c2)

	if ok := hub.SendToConn(c1.connID, []byte("x")); !ok {
		t.Fatal("SendToConn 应命中 c1")
	}
	if len(c1.send) != 1 {
		t.Errorf("c1 收到 %d 帧，期望 1", len(c1.send))
	}
	if len(c2.send) != 0 {
		t.Errorf("c2 收到 %d 帧，期望 0", len(c2.send))
	}
	if ok := hub.SendToConn(uuid.New(), []byte("x")); ok {
		t.Error("未知 connID 应返回 false")
	}

	// 摘除后索引必须同步失效，否则断连的连接会一直被当作可达目标
	hub.Unregister(c1)
	if ok := hub.SendToConn(c1.connID, []byte("y")); ok {
		t.Error("已摘除的连接应返回 false")
	}
}

// TestSendToConnFullBuffer 发送缓冲已满时返回 false（调用方据此退回按用户扇出）。
func TestSendToConnFullBuffer(t *testing.T) {
	hub := NewHub(0, zap.NewNop())
	c := &Client{userID: uuid.New(), connID: uuid.New(), send: make(chan []byte, 1), hub: hub}
	hub.Register(c)

	if ok := hub.SendToConn(c.connID, []byte("first")); !ok {
		t.Fatal("首帧应入队成功")
	}
	if ok := hub.SendToConn(c.connID, []byte("second")); ok {
		t.Error("缓冲已满时应返回 false 而不是阻塞")
	}
}

// TestDisconnectNotifier 连接摘除时回调带上 userID 与 connID。
// 通话房间靠它在拔网线/关窗口/杀进程时把参与者摘掉，
// 否则另一端会永远停在「通话中」，只能等 Redis TTL 到期。
func TestDisconnectNotifier(t *testing.T) {
	hub := NewHub(0, zap.NewNop())
	uid, cid := uuid.New(), uuid.New()
	got := make(chan [2]uuid.UUID, 1)
	hub.SetDisconnectNotifier(func(u, c uuid.UUID) { got <- [2]uuid.UUID{u, c} })

	c := &Client{userID: uid, connID: cid, send: make(chan []byte, 1), hub: hub}
	hub.Register(c)
	hub.Unregister(c)

	select {
	case v := <-got:
		if v[0] != uid || v[1] != cid {
			t.Errorf("回调参数 = %v，期望 (%v, %v)", v, uid, cid)
		}
	case <-time.After(time.Second):
		t.Fatal("断连回调未触发")
	}
}

// TestDisconnectNotifierFiresForNonLastConn 同用户还有别的连接在线时也必须回调。
// presence 只在末连断开时触发，通话房间却是逐连接的：多设备在线时挂断一台，
// 若沿用 presence 的「末连才通知」，房间里那条死连接就永远摘不掉。
func TestDisconnectNotifierFiresForNonLastConn(t *testing.T) {
	hub := NewHub(0, zap.NewNop())
	uid := uuid.New()
	got := make(chan uuid.UUID, 2)
	hub.SetDisconnectNotifier(func(_, c uuid.UUID) { got <- c })

	c1 := newTestClient(uid)
	c2 := newTestClient(uid)
	hub.Register(c1)
	hub.Register(c2)
	hub.Unregister(c1) // 该用户仍有 c2 在线

	select {
	case cid := <-got:
		if cid != c1.connID {
			t.Errorf("回调 connID = %v，期望 %v", cid, c1.connID)
		}
	case <-time.After(time.Second):
		t.Fatal("非末连断开也必须触发回调")
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
