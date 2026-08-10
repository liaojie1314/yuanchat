package repository

import (
	"context"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
)

// StickerRepository 处理 stickers / sticker_packs 表。
type StickerRepository struct {
	db *gorm.DB
}

func NewStickerRepository(db *gorm.DB) *StickerRepository {
	return &StickerRepository{db: db}
}

// AddOwned 插入一条个人收藏贴纸（owner_id + content_hash 唯一，已存在则幂等返回原行）。
func (r *StickerRepository) AddOwned(ctx context.Context, s *model.Sticker) (*model.Sticker, error) {
	res := r.db.WithContext(ctx).
		Where(model.Sticker{OwnerID: s.OwnerID, ContentHash: s.ContentHash}).
		FirstOrCreate(s)
	return s, res.Error
}

// FindByID 按 ID 查单条贴纸（不存在返回 gorm.ErrRecordNotFound）。
func (r *StickerRepository) FindByID(ctx context.Context, id uuid.UUID) (*model.Sticker, error) {
	var s model.Sticker
	if err := r.db.WithContext(ctx).First(&s, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

// Remove 删除指定 ID 的个人收藏贴纸（不校验归属，调用方先行校验）。
func (r *StickerRepository) Remove(ctx context.Context, id uuid.UUID) error {
	return r.db.WithContext(ctx).Delete(&model.Sticker{}, "id = ?", id).Error
}

// ListMine 按创建时间倒序列出某用户的个人收藏贴纸。
func (r *StickerRepository) ListMine(ctx context.Context, ownerID uuid.UUID) ([]model.Sticker, error) {
	var rows []model.Sticker
	err := r.db.WithContext(ctx).
		Where("owner_id = ?", ownerID).
		Order("created_at DESC").
		Find(&rows).Error
	return rows, err
}

// ListPacks 按 sort 升序列出全部表情包（当前仅官方包）。
func (r *StickerRepository) ListPacks(ctx context.Context) ([]model.StickerPack, error) {
	var rows []model.StickerPack
	err := r.db.WithContext(ctx).Order("sort ASC, created_at ASC").Find(&rows).Error
	return rows, err
}

// ListByPack 按创建时间升序列出某表情包下的全部贴纸。
func (r *StickerRepository) ListByPack(ctx context.Context, packID uuid.UUID) ([]model.Sticker, error) {
	var rows []model.Sticker
	err := r.db.WithContext(ctx).
		Where("pack_id = ?", packID).
		Order("created_at ASC").
		Find(&rows).Error
	return rows, err
}
