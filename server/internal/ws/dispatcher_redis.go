package ws

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/yuanchat/server/internal/metrics"
	"go.uber.org/zap"
)

// dispatchEnvelope Redis Pub/Sub 上跨实例分发的消息封装（传输层格式，
// 不属于 WS 协议；Data 即 ws.Encode 产出的原始帧字节，json 编码时 base64）。
type dispatchEnvelope struct {
	HostID  string   `json:"host_id"` // 发布实例标识，订阅端据此丢弃自己发布的帧
	UserIDs []string `json:"user_ids"`
	Data    []byte   `json:"data"`
}

// RedisDispatcher 基于 Redis Pub/Sub 的跨实例消息分发：
//
//   - 发布：Hub.SendToUsers 完成本机投递后回调 Publish，把帧发到 Redis channel
//   - 订阅：本协程收到其他实例的帧后调 hub.DeliverLocal 投递给本机连接
//
// 自环避免采用「发布前只投本机连接 + 订阅端按来源实例 ID 过滤」：
// 发布方不再重复投递本机，订阅端丢弃 HostID == 自己 的帧，
// 因此一帧对本机连接只投递一次，对其他实例各投递一次。
type RedisDispatcher struct {
	rdb     *redis.Client
	channel string
	hostID  string
	hub     *Hub
	logger  *zap.Logger

	cancel context.CancelFunc
	done   chan struct{} // 订阅协程退出信号，Close 时等待其结束
}

// NewRedisDispatcher 创建并启动订阅协程。channel 为空时用默认 ws:dispatch。
// 同一进程对该函数只调用一次（装配层在 dispatcher.backend=redis 时调用）。
func NewRedisDispatcher(rdb *redis.Client, channel string, hub *Hub, logger *zap.Logger) *RedisDispatcher {
	if channel == "" {
		channel = "ws:dispatch"
	}
	ctx, cancel := context.WithCancel(context.Background())
	d := &RedisDispatcher{
		rdb:     rdb,
		channel: channel,
		hostID:  uuid.NewString(),
		hub:     hub,
		logger:  logger,
		cancel:  cancel,
		done:    make(chan struct{}),
	}
	go d.subscribe(ctx)
	return d
}

// Publish 把一帧发布到 Redis channel，供其他实例投递给自己的本机连接。
// 作为 Hub 的 remotePublisher 回调被调用（本机投递已完成，这里只管外发）。
func (d *RedisDispatcher) Publish(userIDs []uuid.UUID, data []byte) {
	ids := make([]string, 0, len(userIDs))
	for _, id := range userIDs {
		ids = append(ids, id.String())
	}
	raw, err := json.Marshal(dispatchEnvelope{HostID: d.hostID, UserIDs: ids, Data: data})
	if err != nil {
		d.logger.Warn("dispatch envelope marshal failed", zap.Error(err))
		return
	}

	// 独立超时上下文：调用方在消息发送路径上，不能被慢 Redis 拖住太久
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := d.rdb.Publish(ctx, d.channel, raw).Err(); err != nil {
		d.logger.Warn("dispatch publish failed", zap.Error(err))
		return
	}
	metrics.WSDispatchPublishedTotal.Inc()
}

// subscribe 订阅循环：收到其他实例的帧后投递给本机连接。
func (d *RedisDispatcher) subscribe(ctx context.Context) {
	defer close(d.done)
	sub := d.rdb.Subscribe(ctx, d.channel)
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
			var ev dispatchEnvelope
			if err := json.Unmarshal([]byte(msg.Payload), &ev); err != nil {
				continue
			}
			if ev.HostID == d.hostID {
				continue // 自己发布的帧，本机已在发布前投递过，跳过避免重复
			}

			ids := make([]uuid.UUID, 0, len(ev.UserIDs))
			for _, s := range ev.UserIDs {
				id, err := uuid.Parse(s)
				if err != nil {
					continue
				}
				ids = append(ids, id)
			}
			if len(ids) > 0 {
				d.hub.DeliverLocal(ids, ev.Data)
			}
		}
	}
}

// Close 停止订阅并等待协程退出（装配层目前与 RedisPresence 一样未在关闭钩子里
// 调用，进程退出时由 OS 回收；保留方法供后续优雅停机接入）。
func (d *RedisDispatcher) Close() error {
	d.cancel()
	<-d.done
	return nil
}
