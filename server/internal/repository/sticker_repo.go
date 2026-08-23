package repository

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// StickerRepository 处理 stickers / sticker_packs 表。
type StickerRepository struct {
	db *gorm.DB
}

func NewStickerRepository(db *gorm.DB) *StickerRepository {
	return &StickerRepository{db: db}
}

// AddOwned 插入一条个人收藏贴纸，同 (owner_id, content_hash) 已存在时幂等返回原行。
//
// 用 ON CONFLICT DO NOTHING + 回查而非 FirstOrCreate：后者是 SELECT + INSERT 两步、
// 非原子，并发（双击菜单 / 多端同时 / 客户端重试）时两个请求都 SELECT 未命中、
// 都 INSERT，第二个撞唯一约束返回 PG duplicate key，被 handler 归入 default 分支回 500
// ——而实际状态是确定的成功（另一个请求已写入）。500 语义是"状态未知"，与事实不符。
func (r *StickerRepository) AddOwned(ctx context.Context, s *model.Sticker) (*model.Sticker, error) {
	res := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "owner_id"}, {Name: "content_hash"}},
			DoNothing: true,
		}).
		Create(s)
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected > 0 {
		return s, nil
	}
	// 冲突未插入：回查既有行，返回先前收藏的那条（幂等语义）
	var existing model.Sticker
	if err := r.db.WithContext(ctx).
		Where("owner_id = ? AND content_hash = ?", s.OwnerID, s.ContentHash).
		First(&existing).Error; err != nil {
		return nil, err
	}
	return &existing, nil
}

// CountByOwner 统计某用户已收藏的贴纸数（用于上限校验）。
func (r *StickerRepository) CountByOwner(ctx context.Context, ownerID uuid.UUID) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).
		Model(&model.Sticker{}).
		Where("owner_id = ?", ownerID).
		Count(&n).Error
	return n, err
}

// FindByOwnerHash 按 (owner_id, content_hash) 查既有收藏（去重键，最多一行）。
func (r *StickerRepository) FindByOwnerHash(ctx context.Context, ownerID uuid.UUID, contentHash string) (*model.Sticker, error) {
	var s model.Sticker
	if err := r.db.WithContext(ctx).
		Where("owner_id = ? AND content_hash = ?", ownerID, contentHash).
		First(&s).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

// FindByID 按 ID 查单条贴纸（不存在返回 gorm.ErrRecordNotFound）。
func (r *StickerRepository) FindByID(ctx context.Context, id uuid.UUID) (*model.Sticker, error) {
	var s model.Sticker
	if err := r.db.WithContext(ctx).First(&s, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

// FindOwned 查某用户名下的指定贴纸（官方包贴纸 owner_id 为 NULL，故查不到）。
// 供 WS 发送路径校验「这张贴纸确实属于发送者」并取回权威的对象元数据。
func (r *StickerRepository) FindOwned(ctx context.Context, ownerID, id uuid.UUID) (*model.Sticker, error) {
	var s model.Sticker
	if err := r.db.WithContext(ctx).
		Where("id = ? AND owner_id = ?", id, ownerID).
		First(&s).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

// FindInAnyPack 查任一表情包内的指定贴纸（官方包对全体用户可用，无需归属校验）。
func (r *StickerRepository) FindInAnyPack(ctx context.Context, id uuid.UUID) (*model.Sticker, error) {
	var s model.Sticker
	if err := r.db.WithContext(ctx).
		Where("id = ? AND pack_id IS NOT NULL", id).
		First(&s).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

// RemoveOwned 删除某用户名下的指定贴纸。
//
// owner_id 进 WHERE 而非仅靠调用方前置校验（纵深防御，消除 check-then-act 窗口）；
// RowsAffected == 0 返回 ErrRecordNotFound——并发双删时第二次影响 0 行，
// 若照旧返回 nil 会让 API 回 200 "removed"，是虚假成功。
func (r *StickerRepository) RemoveOwned(ctx context.Context, ownerID, id uuid.UUID) error {
	res := r.db.WithContext(ctx).
		Where("id = ? AND owner_id = ?", id, ownerID).
		Delete(&model.Sticker{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// ListMine 按创建时间倒序分页列出某用户的个人收藏贴纸。
// before 为游标（nil 表示从最新开始），limit 由调用方钳制上限。
//
// 必须分页：无 LIMIT 时 GORM 会把全部行读进内存切片再整体 JSON 序列化，
// 单请求内存占用 O(N)，并发即成倍放大（收藏无数量上限时可被单账号刷到十万级）。
func (r *StickerRepository) ListMine(ctx context.Context, ownerID uuid.UUID, before *time.Time, limit int) ([]model.Sticker, error) {
	q := r.db.WithContext(ctx).
		Where("owner_id = ?", ownerID).
		Order("created_at DESC").
		Limit(limit)
	if before != nil {
		q = q.Where("created_at < ?", *before)
	}
	var rows []model.Sticker
	return rows, q.Find(&rows).Error
}

// ListPacks 按 sort 升序列出全部表情包（当前仅官方包）。
func (r *StickerRepository) ListPacks(ctx context.Context) ([]model.StickerPack, error) {
	var rows []model.StickerPack
	err := r.db.WithContext(ctx).Order("sort ASC, created_at ASC").Find(&rows).Error
	return rows, err
}

// ListByPackIDs 一次查出多个表情包下的全部贴纸（按包 + 创建时间升序）。
// 替代「逐包一次查询」的 N+1 写法：包数由运维控制，H1b 表情商城上线后 N 会变大。
func (r *StickerRepository) ListByPackIDs(ctx context.Context, packIDs []uuid.UUID) ([]model.Sticker, error) {
	if len(packIDs) == 0 {
		return nil, nil
	}
	var rows []model.Sticker
	err := r.db.WithContext(ctx).
		Where("pack_id IN ?", packIDs).
		Order("pack_id ASC, created_at ASC").
		Find(&rows).Error
	return rows, err
}
