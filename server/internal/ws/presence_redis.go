package ws

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// presenceEvent Redis Pub/Sub 消息格式。
type presenceEvent struct {
	UserID uuid.UUID `json:"user_id"`
	Online bool      `json:"online"`
	At     int64     `json:"at"`      // unix ms
	HostID string    `json:"host_id"` // 发布实例标识，用于过滤自己的事件
}

// RedisPresence 多实例在线状态后端：
//   - 本实例上下线事件发布到 Redis channel
//   - 订阅同 channel，维护「其他实例在线用户」mirror
//   - 全局在线 = 本实例在线（Hub.clients）OR mirror 在线
//
// mirror 按 userID 计引用（多实例同用户在线时 count>1），
// 收到 offline 事件减一，归零移除。
type RedisPresence struct {
	rdb     *redis.Client
	channel string
	hostID  string
	logger  *zap.Logger

	mu     sync.RWMutex
	mirror map[uuid.UUID]int // 其他实例上的在线实例数

	remoteHandler func(userID uuid.UUID, online bool)

	cancel context.CancelFunc
	done   chan struct{}
}

// NewRedisPresence 创建并启动订阅协程。channel 为空时用默认 presence:events。
func NewRedisPresence(rdb *redis.Client, channel string, logger *zap.Logger) *RedisPresence {
	if channel == "" {
		channel = "presence:events"
	}
	ctx, cancel := context.WithCancel(context.Background())
	p := &RedisPresence{
		rdb:     rdb,
		channel: channel,
		hostID:  uuid.NewString(),
		logger:  logger,
		mirror:  make(map[uuid.UUID]int),
		cancel:  cancel,
		done:    make(chan struct{}),
	}
	go p.subscribe(ctx)
	return p
}

// SetRemoteHandler 注册远端上下线回调（必须在有事件流入前设置）。
func (p *RedisPresence) SetRemoteHandler(fn func(userID uuid.UUID, online bool)) {
	p.remoteHandler = fn
}

func (p *RedisPresence) publish(userID uuid.UUID, online bool) {
	ev := presenceEvent{UserID: userID, Online: online, At: time.Now().UnixMilli(), HostID: p.hostID}
	raw, err := json.Marshal(ev)
	if err != nil {
		return
	}
	// 独立超时上下文：调用方在连接注册路径上，不能被慢 Redis 拖住太久
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := p.rdb.Publish(ctx, p.channel, raw).Err(); err != nil {
		p.logger.Warn("presence publish failed", zap.Error(err))
	}
}

// PublishOnline 广播本实例用户上线。
func (p *RedisPresence) PublishOnline(userID uuid.UUID) { p.publish(userID, true) }

// PublishOffline 广播本实例用户下线。
func (p *RedisPresence) PublishOffline(userID uuid.UUID) { p.publish(userID, false) }

// FilterRemoteOnline 返回 ids 中在其他实例在线的子集。
func (p *RedisPresence) FilterRemoteOnline(ids []uuid.UUID) []uuid.UUID {
	p.mu.RLock()
	defer p.mu.RUnlock()
	online := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if p.mirror[id] > 0 {
			online = append(online, id)
		}
	}
	return online
}

// subscribe 订阅循环：收到其他实例的事件更新 mirror 并回调。
func (p *RedisPresence) subscribe(ctx context.Context) {
	defer close(p.done)
	sub := p.rdb.Subscribe(ctx, p.channel)
	defer func() { _ = sub.Close() }()

	ch := sub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			var ev presenceEvent
			if err := json.Unmarshal([]byte(msg.Payload), &ev); err != nil {
				continue
			}
			if ev.HostID == p.hostID {
				continue // 自己发布的事件
			}

			p.mu.Lock()
			if ev.Online {
				p.mirror[ev.UserID]++
			} else if p.mirror[ev.UserID] > 0 {
				p.mirror[ev.UserID]--
				if p.mirror[ev.UserID] == 0 {
					delete(p.mirror, ev.UserID)
				}
			}
			p.mu.Unlock()

			if p.remoteHandler != nil {
				p.remoteHandler(ev.UserID, ev.Online)
			}
		}
	}
}

// Close 停止订阅并等待协程退出。
func (p *RedisPresence) Close() error {
	p.cancel()
	<-p.done
	return nil
}
