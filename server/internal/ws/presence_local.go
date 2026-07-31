package ws

import "github.com/google/uuid"

// PresenceBackend 全局在线状态视图的可插拔后端。
//
// Hub 的 clients map 始终是"本实例连接"的唯一真源；backend 只负责：
//  1. 把本实例的上下线事件同步出去（多实例部署时发布到共享介质）
//  2. 维护其他实例的在线镜像，供全局在线判定合并
//
// 单实例部署用 LocalPresence（全 no-op，行为与历史版本完全一致）；
// 多实例部署用 RedisPresence（Pub/Sub 广播 + mirror）。
type PresenceBackend interface {
	// PublishOnline 本实例某用户首连上线时调用。
	PublishOnline(userID uuid.UUID)
	// PublishOffline 本实例某用户末连下线时调用。
	PublishOffline(userID uuid.UUID)
	// FilterRemoteOnline 返回 ids 中在其他实例在线（本实例不在线）的子集。
	FilterRemoteOnline(ids []uuid.UUID) []uuid.UUID
	// SetRemoteHandler 注册远端实例上下线回调（装配层用它把 presence
	// 帧推给连在本实例上的相关用户）。必须在事件流启动前注册。
	SetRemoteHandler(fn func(userID uuid.UUID, online bool))
	// Close 释放资源（订阅协程等）。
	Close() error
}

// LocalPresence 单实例后端：无其他实例，所有方法 no-op。
type LocalPresence struct{}

func NewLocalPresence() *LocalPresence { return &LocalPresence{} }

func (*LocalPresence) PublishOnline(uuid.UUID)                            {}
func (*LocalPresence) PublishOffline(uuid.UUID)                           {}
func (*LocalPresence) FilterRemoteOnline([]uuid.UUID) []uuid.UUID         { return nil }
func (*LocalPresence) SetRemoteHandler(func(userID uuid.UUID, online bool)) {}
func (*LocalPresence) Close() error                                       { return nil }
