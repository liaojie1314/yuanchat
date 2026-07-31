package repository

import (
	"context"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// PushRepository Web Push 订阅存取。
type PushRepository struct {
	db *gorm.DB
}

func NewPushRepository(db *gorm.DB) *PushRepository {
	return &PushRepository{db: db}
}

// Upsert 保存订阅：同一 endpoint 重复订阅时更新归属用户与密钥
// （用户换账号登录同一浏览器的场景）。
func (r *PushRepository) Upsert(ctx context.Context, sub *model.PushSubscription) error {
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "endpoint"}},
		DoUpdates: clause.AssignmentColumns([]string{"user_id", "p256dh", "auth", "user_agent"}),
	}).Create(sub).Error
}

// ListByUser 取某用户的全部订阅（多浏览器/多设备）。
func (r *PushRepository) ListByUser(ctx context.Context, userID uuid.UUID) ([]model.PushSubscription, error) {
	var subs []model.PushSubscription
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).Find(&subs).Error
	return subs, err
}

// ListByUsers 批量取多个用户的订阅（群消息推送）。
func (r *PushRepository) ListByUsers(ctx context.Context, userIDs []uuid.UUID) ([]model.PushSubscription, error) {
	if len(userIDs) == 0 {
		return nil, nil
	}
	var subs []model.PushSubscription
	err := r.db.WithContext(ctx).Where("user_id IN ?", userIDs).Find(&subs).Error
	return subs, err
}

// DeleteByEndpoint 删除订阅（客户端主动退订，或推送返回 404/410 时清理失效订阅）。
func (r *PushRepository) DeleteByEndpoint(ctx context.Context, endpoint string) error {
	return r.db.WithContext(ctx).
		Where("endpoint = ?", endpoint).
		Delete(&model.PushSubscription{}).Error
}
