package ws

import (
	"sync"

	"github.com/google/uuid"
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
}

// NewHub 创建 Hub。maxConnPerUser ≤ 0 表示不限制。
func NewHub(maxConnPerUser int, logger *zap.Logger) *Hub {
	return &Hub{
		clients:        make(map[uuid.UUID]map[*Client]struct{}),
		maxConnPerUser: maxConnPerUser,
		logger:         logger,
	}
}

// Register 登记一条新连接。返回 false 表示该用户连接数已达上限，调用方应拒绝。
func (h *Hub) Register(c *Client) bool {
	h.mu.Lock()
	defer h.mu.Unlock()

	conns := h.clients[c.userID]
	if h.maxConnPerUser > 0 && len(conns) >= h.maxConnPerUser {
		return false
	}
	if conns == nil {
		conns = make(map[*Client]struct{})
		h.clients[c.userID] = conns
	}
	conns[c] = struct{}{}
	return true
}

// Unregister 摘除连接；用户最后一条连接断开时清理映射项。
func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	conns, ok := h.clients[c.userID]
	if !ok {
		return
	}
	delete(conns, c)
	if len(conns) == 0 {
		delete(h.clients, c.userID)
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
			default:
				h.logger.Warn("ws send buffer full, frame dropped",
					zap.String("user_id", uid.String()))
			}
		}
	}
}

// OnlineCount 返回某用户当前在线连接数（测试与调试用）。
func (h *Hub) OnlineCount(userID uuid.UUID) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients[userID])
}
