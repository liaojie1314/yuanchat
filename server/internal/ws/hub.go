package ws

import (
	"sync"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/metrics"
	"go.uber.org/zap"
)

// Dispatcher 将一帧数据投递给目标用户的所有在线设备。
//
// 当前实现是进程内 Hub；未来横向扩展时可替换为 Redis Pub/Sub
// 实现而不改动业务代码。
type Dispatcher interface {
	SendToUsers(userIDs []uuid.UUID, data []byte)
}

// Hub 维护 userID → 在线连接集合 的映射（一个用户可多设备在线）。
type Hub struct {
	mu             sync.RWMutex
	clients        map[uuid.UUID]map[*Client]struct{}
	maxConnPerUser int
	logger         *zap.Logger
	// presenceNotifier 用户首连上线 / 末连下线时回调（多设备去重）；在锁外调用防死锁
	presenceNotifier func(userID uuid.UUID, online bool)
	// backend 全局在线视图后端：本地事件外发 + 远端实例在线镜像（多实例部署）
	backend PresenceBackend
}

// NewHub 创建 Hub。maxConnPerUser ≤ 0 表示不限制。
func NewHub(maxConnPerUser int, logger *zap.Logger) *Hub {
	return &Hub{
		clients:        make(map[uuid.UUID]map[*Client]struct{}),
		maxConnPerUser: maxConnPerUser,
		logger:         logger,
		backend:        NewLocalPresence(),
	}
}

// SetPresenceBackend 替换在线状态后端（装配层在启动前调用一次）。
func (h *Hub) SetPresenceBackend(b PresenceBackend) {
	if b != nil {
		h.backend = b
	}
}

// SetPresenceNotifier 注册上下线回调：用户首个连接建立时 online=true，
// 最后一个连接断开时 online=false（多设备期间不重复触发）。
func (h *Hub) SetPresenceNotifier(fn func(userID uuid.UUID, online bool)) {
	h.presenceNotifier = fn
}

// Register 登记一条新连接。返回 false 表示该用户连接数已达上限，调用方应拒绝。
func (h *Hub) Register(c *Client) bool {
	h.mu.Lock()

	conns := h.clients[c.userID]
	if h.maxConnPerUser > 0 && len(conns) >= h.maxConnPerUser {
		h.mu.Unlock()
		return false
	}
	first := len(conns) == 0
	if conns == nil {
		conns = make(map[*Client]struct{})
		h.clients[c.userID] = conns
	}
	conns[c] = struct{}{}
	h.mu.Unlock()

	// Prometheus: 连接数 +1
	metrics.WSConnectionsActive.Inc()

	// 锁外回调：notifier 内可能反查 Hub（OnlineFilter），锁内调用会死锁
	if first {
		h.backend.PublishOnline(c.userID)
		if h.presenceNotifier != nil {
			h.presenceNotifier(c.userID, true)
		}
	}
	return true
}

// Unregister 摘除连接；用户最后一条连接断开时清理映射项。
func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()

	conns, ok := h.clients[c.userID]
	if !ok {
		h.mu.Unlock()
		return
	}
	delete(conns, c)
	last := len(conns) == 0
	if last {
		delete(h.clients, c.userID)
	}
	h.mu.Unlock()

	// Prometheus: 连接数 -1
	metrics.WSConnectionsActive.Dec()

	if last {
		h.backend.PublishOffline(c.userID)
		if h.presenceNotifier != nil {
			h.presenceNotifier(c.userID, false)
		}
	}
}

// SendToUsers 向目标用户的所有在线连接投递数据。
// 发送通道已满时丢弃该帧（慢连接不应阻塞整个分发），仅记录日志。
func (h *Hub) SendToUsers(userIDs []uuid.UUID, data []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for _, uid := range userIDs {
		for c := range h.clients[uid] {
			select {
			case c.send <- data:
				metrics.WSMessagesTotal.WithLabelValues("send").Inc()
			default:
				h.logger.Warn("ws send buffer full, frame dropped",
					zap.String("user_id", uid.String()))
			}
		}
	}
}

// TotalConnections 返回本实例当前全部 WebSocket 在线连接总数
// （一个用户多设备在线按多条计）。管理端概览的运行时指标从这里取数，
// 读锁保护，O(用户数) 遍历。
func (h *Hub) TotalConnections() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	n := 0
	for _, conns := range h.clients {
		n += len(conns)
	}
	return n
}

// OnlineCount 返回某用户当前在线连接数（测试与调试用）。
func (h *Hub) OnlineCount(userID uuid.UUID) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients[userID])
}

// DisconnectUser 强制断开某用户的全部在线连接（管理员封禁时踢线）。
// 关闭底层 conn 触发 readPump 退出 → Unregister 自然摘除，无需在此改 map。
func (h *Hub) DisconnectUser(userID uuid.UUID) int {
	h.mu.RLock()
	conns := make([]*Client, 0, len(h.clients[userID]))
	for c := range h.clients[userID] {
		conns = append(conns, c)
	}
	h.mu.RUnlock()

	for _, c := range conns {
		_ = c.conn.Close()
	}
	if len(conns) > 0 {
		h.logger.Info("user force disconnected",
			zap.String("user_id", userID.String()), zap.Int("connections", len(conns)))
	}
	return len(conns)
}

// OnlineFilter 过滤出给定用户中当前在线的子集（presence 快照用）。
// 全局在线判定：本实例在线 OR 其他实例在线（backend mirror）。
func (h *Hub) OnlineFilter(ids []uuid.UUID) []uuid.UUID {
	h.mu.RLock()
	online := make([]uuid.UUID, 0, len(ids))
	localOffline := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if len(h.clients[id]) > 0 {
			online = append(online, id)
		} else {
			localOffline = append(localOffline, id)
		}
	}
	h.mu.RUnlock()

	// 锁外查远端 mirror（backend 内部有自己的锁）
	online = append(online, h.backend.FilterRemoteOnline(localOffline)...)
	return online
}
