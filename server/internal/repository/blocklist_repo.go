package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ErrBlockSelf 自拉黑（业务侧应在 service 层截住，仓储侧兜底防御）。
var ErrBlockSelf = errors.New("blocklist: cannot block self")

// BlocklistRepository 处理 blocklists 表。
type BlocklistRepository struct {
	db *gorm.DB
}

func NewBlocklistRepository(db *gorm.DB) *BlocklistRepository {
	return &BlocklistRepository{db: db}
}

// DB 暴露底层连接给 service 层做跨仓储事务。
func (r *BlocklistRepository) DB() *gorm.DB {
	return r.db
}

// Block 记录 userID 拉黑 targetID；已存在则幂等（DoNothing）。
func (r *BlocklistRepository) Block(ctx context.Context, userID, targetID uuid.UUID) error {
	if userID == targetID {
		return ErrBlockSelf
	}
	row := &model.Blocklist{UserID: userID, TargetID: targetID}
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "user_id"}, {Name: "target_id"}},
			DoNothing: true,
		}).
		Create(row).Error
}

// Unblock 解除拉黑；目标不存在返回 nil（幂等）。
func (r *BlocklistRepository) Unblock(ctx context.Context, userID, targetID uuid.UUID) error {
	return r.db.WithContext(ctx).
		Where("user_id = ? AND target_id = ?", userID, targetID).
		Delete(&model.Blocklist{}).Error
}

// IsBlocked 语义：actorID 想发消息给 targetID 时，检查 targetID 是否拉黑了 actorID。
// 返回 true 表示 actor→target 应被拒绝。
// 参数命名反映消息流向（actor=发送方, target=接收方）。
func (r *BlocklistRepository) IsBlocked(ctx context.Context, actorID, targetID uuid.UUID) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&model.Blocklist{}).
		Where("user_id = ? AND target_id = ?", targetID, actorID).
		Count(&count).Error
	return count > 0, err
}

// IsBlockedEitherDirection 判断双方任意一方拉黑另一方（消息双向拦截用）。
func (r *BlocklistRepository) IsBlockedEitherDirection(ctx context.Context, a, b uuid.UUID) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&model.Blocklist{}).
		Where("(user_id = ? AND target_id = ?) OR (user_id = ? AND target_id = ?)", a, b, b, a).
		Count(&count).Error
	return count > 0, err
}

// ListByUser 返回 userID 拉黑的所有 target 用户 ID（黑名单页数据源）。
// 按拉黑时间倒序。
func (r *BlocklistRepository) ListByUser(ctx context.Context, userID uuid.UUID) ([]uuid.UUID, error) {
	var ids []uuid.UUID
	err := r.db.WithContext(ctx).
		Model(&model.Blocklist{}).
		Where("user_id = ?", userID).
		Order("created_at DESC").
		Pluck("target_id", &ids).Error
	return ids, err
}
