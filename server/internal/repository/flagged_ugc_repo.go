package repository

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
)

// FlaggedUGCRepository UGC 敏感词命中记录的数据访问：
// 写入路径打标、管理端队列检索与处置落库。
type FlaggedUGCRepository struct {
	db *gorm.DB
}

func NewFlaggedUGCRepository(db *gorm.DB) *FlaggedUGCRepository {
	return &FlaggedUGCRepository{db: db}
}

// Create 写入一条命中记录（打标失败由调用方记日志降级，不阻塞业务写入）。
func (r *FlaggedUGCRepository) Create(ctx context.Context, rec *model.FlaggedUGC) error {
	return r.db.WithContext(ctx).Create(rec).Error
}

// Search 分页列出命中记录；ugcType 为空查全部类型。
// status 三态过滤："pending"=待处理、"handled"=已处置、""=全部。
func (r *FlaggedUGCRepository) Search(ctx context.Context, ugcType, status string, offset, limit int) ([]model.FlaggedUGC, int64, error) {
	tx := r.db.WithContext(ctx).Model(&model.FlaggedUGC{})
	if ugcType != "" {
		tx = tx.Where("ugc_type = ?", ugcType)
	}
	switch status {
	case "pending":
		tx = tx.Where("handled_at IS NULL")
	case "handled":
		tx = tx.Where("handled_at IS NOT NULL")
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var list []model.FlaggedUGC
	err := tx.Order("created_at DESC").Offset(offset).Limit(limit).Find(&list).Error
	return list, total, err
}

// Find 按 ID 查记录，未命中返回 (nil, nil)。
func (r *FlaggedUGCRepository) Find(ctx context.Context, id uuid.UUID) (*model.FlaggedUGC, error) {
	var rec model.FlaggedUGC
	err := r.db.WithContext(ctx).First(&rec, "id = ?", id).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &rec, nil
}

// MarkHandled 置 handled_at（幂等：已处置的记录不再改写）。返回是否命中未处置记录。
func (r *FlaggedUGCRepository) MarkHandled(ctx context.Context, id uuid.UUID, at time.Time) (bool, error) {
	res := r.db.WithContext(ctx).Model(&model.FlaggedUGC{}).
		Where("id = ? AND handled_at IS NULL", id).Update("handled_at", at)
	return res.RowsAffected > 0, res.Error
}
