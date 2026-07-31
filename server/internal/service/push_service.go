package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/config"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
)

// ErrPushDisabled VAPID 密钥未配置，推送功能关闭。
var ErrPushDisabled = errors.New("web push is not configured")

// PushService Web Push 投递：离线用户的消息补推浏览器通知。
//
// 与 WS 的关系：WS 在线时消息已实时到达，无需推送；仅对
// 「不在线（无 WS 连接）」的目标用户走 Web Push，避免重复打扰。
type PushService struct {
	repo   *repository.PushRepository
	cfg    config.PushConfig
	logger *zap.Logger
}

func NewPushService(repo *repository.PushRepository, cfg config.PushConfig, logger *zap.Logger) *PushService {
	return &PushService{repo: repo, cfg: cfg, logger: logger}
}

// Enabled 是否已配置 VAPID 密钥。
func (s *PushService) Enabled() bool {
	return s.cfg.VAPIDPublicKey != "" && s.cfg.VAPIDPrivateKey != ""
}

// PublicKey 返回 VAPID 公钥（前端 subscribe 时需要）。
func (s *PushService) PublicKey() string { return s.cfg.VAPIDPublicKey }

// Subscribe 保存/更新一条浏览器推送订阅。
func (s *PushService) Subscribe(ctx context.Context, sub *model.PushSubscription) error {
	if !s.Enabled() {
		return ErrPushDisabled
	}
	if err := s.repo.Upsert(ctx, sub); err != nil {
		return fmt.Errorf("save subscription: %w", err)
	}
	return nil
}

// Unsubscribe 按 endpoint 退订。
func (s *PushService) Unsubscribe(ctx context.Context, endpoint string) error {
	return s.repo.DeleteByEndpoint(ctx, endpoint)
}

// PushPayload 发给 Service Worker 的通知内容。
type PushPayload struct {
	Title          string `json:"title"`
	Body           string `json:"body"`
	ConversationID string `json:"conversation_id"`
	MessageID      string `json:"message_id,omitempty"`
}

// NotifyUsers 向指定用户的全部订阅推送通知。
// 单条订阅失败不影响其他；410/404 表示订阅已失效，直接清理。
func (s *PushService) NotifyUsers(ctx context.Context, userIDs []uuid.UUID, payload PushPayload) {
	if !s.Enabled() || len(userIDs) == 0 {
		return
	}
	subs, err := s.repo.ListByUsers(ctx, userIDs)
	if err != nil {
		s.logger.Warn("load push subscriptions failed", zap.Error(err))
		return
	}
	if len(subs) == 0 {
		return
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return
	}

	for _, sub := range subs {
		s.send(ctx, sub, body)
	}
}

func (s *PushService) send(ctx context.Context, sub model.PushSubscription, body []byte) {
	ttl := s.cfg.TTL
	if ttl <= 0 {
		ttl = 86400
	}
	resp, err := webpush.SendNotificationWithContext(ctx, body, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}, &webpush.Options{
		Subscriber:      s.cfg.Subject,
		VAPIDPublicKey:  s.cfg.VAPIDPublicKey,
		VAPIDPrivateKey: s.cfg.VAPIDPrivateKey,
		TTL:             ttl,
	})
	if err != nil {
		s.logger.Warn("web push send failed",
			zap.String("user_id", sub.UserID.String()), zap.Error(err))
		return
	}
	defer func() { _ = resp.Body.Close() }()

	// 订阅已失效（用户清了站点数据 / 卸载 PWA）：清理避免持续失败
	if resp.StatusCode == http.StatusGone || resp.StatusCode == http.StatusNotFound {
		if err := s.repo.DeleteByEndpoint(ctx, sub.Endpoint); err != nil {
			s.logger.Warn("cleanup stale subscription failed", zap.Error(err))
		}
		return
	}
	if resp.StatusCode >= 400 {
		s.logger.Warn("web push rejected",
			zap.Int("status", resp.StatusCode), zap.String("user_id", sub.UserID.String()))
	}
}
