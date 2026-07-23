package repository

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
)

// FavoriteRepository 处理 favorites 表。
type FavoriteRepository struct {
	db *gorm.DB
}

func NewFavoriteRepository(db *gorm.DB) *FavoriteRepository {
	return &FavoriteRepository{db: db}
}

// Add 插入收藏记录（已存在时幂等返回）。
func (r *FavoriteRepository) Add(ctx context.Context, fav *model.Favorite) (*model.Favorite, error) {
	res := r.db.WithContext(ctx).
		Where(model.Favorite{UserID: fav.UserID, MessageID: fav.MessageID}).
		FirstOrCreate(fav)
	return fav, res.Error
}

// Remove 按消息 ID 删除（仅操作者自己的收藏）。
func (r *FavoriteRepository) Remove(ctx context.Context, userID, messageID uuid.UUID) error {
	return r.db.WithContext(ctx).
		Where("user_id = ? AND message_id = ?", userID, messageID).
		Delete(&model.Favorite{}).Error
}

// IsFavoritedBatch 批量检查消息是否已被当前用户收藏，返回已收藏的 message_id Set。
func (r *FavoriteRepository) IsFavoritedBatch(ctx context.Context, userID uuid.UUID, messageIDs []uuid.UUID) (map[uuid.UUID]bool, error) {
	if len(messageIDs) == 0 {
		return map[uuid.UUID]bool{}, nil
	}
	var ids []uuid.UUID
	err := r.db.WithContext(ctx).
		Model(&model.Favorite{}).
		Select("message_id").
		Where("user_id = ? AND message_id IN ?", userID, messageIDs).
		Scan(&ids).Error
	result := make(map[uuid.UUID]bool, len(ids))
	for _, id := range ids {
		result[id] = true
	}
	return result, err
}

// List 按时间倒序分页列出收藏，before 为游标（nil 表示最新），msgType 为消息类型过滤（0 不过滤）。
func (r *FavoriteRepository) List(ctx context.Context, userID uuid.UUID, before *time.Time, limit int, msgType int16) ([]model.Favorite, error) {
	q := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at DESC").
		Limit(limit)
	if before != nil {
		q = q.Where("created_at < ?", *before)
	}
	if msgType > 0 {
		q = q.Where("message_type = ?", msgType)
	}
	var rows []model.Favorite
	return rows, q.Find(&rows).Error
}
