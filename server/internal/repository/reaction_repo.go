package repository

import (
	"context"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
)

// ReactionRepository 处理 message_reactions 表。
type ReactionRepository struct {
	db *gorm.DB
}

func NewReactionRepository(db *gorm.DB) *ReactionRepository {
	return &ReactionRepository{db: db}
}

// Toggle 有则删无则加，返回 (操作后是否存在, 该 emoji 最新总数, error)。
func (r *ReactionRepository) Toggle(ctx context.Context, messageID, userID uuid.UUID, emoji string) (bool, int64, error) {
	var reacted bool
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		res := tx.Where("message_id = ? AND user_id = ? AND emoji = ?", messageID, userID, emoji).
			Delete(&model.MessageReaction{})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			if err := tx.Create(&model.MessageReaction{
				MessageID: messageID, UserID: userID, Emoji: emoji,
			}).Error; err != nil {
				return err
			}
			reacted = true
		}
		return nil
	})
	if err != nil {
		return false, 0, err
	}
	var count int64
	err = r.db.WithContext(ctx).Model(&model.MessageReaction{}).
		Where("message_id = ? AND emoji = ?", messageID, emoji).Count(&count).Error
	return reacted, count, err
}

// ReactionAgg 单条消息的 emoji 聚合。
type ReactionAgg struct {
	MessageID uuid.UUID `json:"-"`
	Emoji     string    `json:"emoji"`
	Count     int64     `json:"count"`
	Mine      bool      `json:"mine"`
}

// AggregateFor 批量取多条消息的回应聚合（Mine 相对 viewer）。
func (r *ReactionRepository) AggregateFor(ctx context.Context, messageIDs []uuid.UUID, viewerID uuid.UUID) (map[uuid.UUID][]ReactionAgg, error) {
	if len(messageIDs) == 0 {
		return map[uuid.UUID][]ReactionAgg{}, nil
	}
	var rows []ReactionAgg
	err := r.db.WithContext(ctx).
		Table("message_reactions").
		Select("message_id, emoji, count(*) AS count, bool_or(user_id = ?) AS mine", viewerID).
		Where("message_id IN ?", messageIDs).
		Group("message_id, emoji").
		Order("min(created_at)").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID][]ReactionAgg)
	for _, row := range rows {
		out[row.MessageID] = append(out[row.MessageID], row)
	}
	return out, nil
}
