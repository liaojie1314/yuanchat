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

// FindSendableInPack 查指定贴纸是否位于一个「发送者当前可用」的表情包内，
// 并返回该贴纸。可用口径（WS 发送校验，2026-09 收紧）：
//   - 包未下架（taken_down=false）且未被敏感词打标（flagged=false）；
//   - 且包为官方包（is_official=true，全员无需添加即可用），
//     或发送者已添加该包（user_sticker_packs 有关联行）。
//
// 收藏贴纸（owner_id 非空）不走本方法——那部分归 FindOwned。
func (r *StickerRepository) FindSendableInPack(ctx context.Context, senderID, id uuid.UUID) (*model.Sticker, error) {
	var s model.Sticker
	err := r.db.WithContext(ctx).
		Model(&model.Sticker{}).
		Joins("JOIN sticker_packs ON sticker_packs.id = stickers.pack_id").
		Where("stickers.id = ? AND stickers.pack_id IS NOT NULL", id).
		Where("sticker_packs.taken_down = FALSE AND sticker_packs.flagged = FALSE").
		// 官方包全员可用；非官方包要求发送者已添加（EXISTS 防 join 出多行）
		Where("sticker_packs.is_official = TRUE OR EXISTS (?)",
			r.db.Model(&model.UserStickerPack{}).Select("1").
				Where("user_sticker_packs.user_id = ?", senderID).
				Where("user_sticker_packs.pack_id = sticker_packs.id")).
		First(&s).Error
	if err != nil {
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

// ListVisible 列出「我的表情包」= 官方包 + 当前用户已添加的包（EmojiPicker 数据源）。
//
// 有意不过滤 is_public / taken_down / flagged：下架（taken_down）与打标只从商城撤展示，
// 已添加者保留（避免影响无辜用户）；官方包始终可见。
//
// 分页为可选：limit <= 0 时返回全量（沿用既有 sort ASC, created_at ASC 排序，向后兼容）；
// limit > 0 时按 created_at 升序游标分页（after 为游标，nil 表示从最早开始），
// 取 limit 行——created_at 在分页模式下同时是排序键与游标键，keyset 语义正确。
func (r *StickerRepository) ListVisible(ctx context.Context, userID uuid.UUID, after *time.Time, limit int) ([]model.StickerPack, error) {
	q := r.db.WithContext(ctx).
		Where("is_official = TRUE OR id IN (?)",
			r.db.Model(&model.UserStickerPack{}).Select("pack_id").Where("user_id = ?", userID))
	if after != nil || limit > 0 {
		if after != nil {
			q = q.Where("created_at > ?", *after)
		}
		q = q.Order("created_at ASC")
	} else {
		q = q.Order("sort ASC, created_at ASC")
	}
	if limit > 0 {
		q = q.Limit(limit)
	}
	var rows []model.StickerPack
	return rows, q.Find(&rows).Error
}

// PackWithMeta 表情包及发布者昵称、贴纸数（商城/详情/我发布的共用投影）。
// OwnerName 为 nil 表示官方包或发布者已注销（owner_id IS NULL）。
type PackWithMeta struct {
	model.StickerPack
	OwnerName    *string `gorm:"column:owner_name"`
	StickerCount int64   `gorm:"column:sticker_count"`
	// FirstStickerKey 包内最早一张贴纸的对象键（无贴纸为 NULL）；
	// 商城卡片在包没有封面时回退展示它。
	FirstStickerKey *string `gorm:"column:first_sticker_key"`
}

// packMetaSelect 商城/详情共用的投影与聚合：发布者昵称 LEFT JOIN + 贴纸计数。
// GROUP BY p.id（主键）即可带出 sticker_packs 全列（PG 函数依赖）；u.nickname 须显式列出。
const packMetaSelect = "sticker_packs.*, users.nickname AS owner_name, COUNT(stickers.id) AS sticker_count, " +
		"(ARRAY_AGG(stickers.object_key ORDER BY stickers.created_at, stickers.id))[1] AS first_sticker_key"

// ListMarket 商城列表：公开 + 未下架 + 未被敏感词打标，按 created_at 倒序游标分页
// （before 为 nil 表示从最新开始；limit 由调用方钳制）。
//
// flagged 包对所有人（含发布者本人）从商城暂隐，管理员清标记后自动恢复——
// 与 taken_down 的商城口径一致（商城不区分 owner）；已添加用户不受影响（ListVisible）。
//
// 排序键 created_at 是全局唯一有序的时间戳（timestamptz 微秒精度），
// 不做 id tie-break——与 favorites 游标分页的精度承诺一致。
func (r *StickerRepository) ListMarket(ctx context.Context, before *time.Time, limit int) ([]PackWithMeta, error) {
	q := r.db.WithContext(ctx).
		Model(&model.StickerPack{}).
		Select(packMetaSelect).
		Joins("LEFT JOIN users ON users.id = sticker_packs.owner_id").
		Joins("LEFT JOIN stickers ON stickers.pack_id = sticker_packs.id").
		Where("sticker_packs.is_public = TRUE AND sticker_packs.taken_down = FALSE AND sticker_packs.flagged = FALSE").
		Group("sticker_packs.id, users.nickname").
		Order("sticker_packs.created_at DESC").
		Limit(limit)
	if before != nil {
		q = q.Where("sticker_packs.created_at < ?", *before)
	}
	var rows []PackWithMeta
	return rows, q.Scan(&rows).Error
}

// GetPackMeta 按 ID 取单个表情包（含发布者昵称与贴纸数），不存在返回 gorm.ErrRecordNotFound。
// 不过滤 is_public/taken_down：下架包对已添加者仍可见，详情入口照常可用。
func (r *StickerRepository) GetPackMeta(ctx context.Context, packID uuid.UUID) (*PackWithMeta, error) {
	var row PackWithMeta
	err := r.db.WithContext(ctx).
		Model(&model.StickerPack{}).
		Select(packMetaSelect).
		Joins("LEFT JOIN users ON users.id = sticker_packs.owner_id").
		Joins("LEFT JOIN stickers ON stickers.pack_id = sticker_packs.id").
		Where("sticker_packs.id = ?", packID).
		Group("sticker_packs.id, users.nickname").
		Take(&row).Error
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// ListPublishedBy 列出某用户发布的全部表情包（含贴纸数），按创建时间倒序。
func (r *StickerRepository) ListPublishedBy(ctx context.Context, ownerID uuid.UUID) ([]PackWithMeta, error) {
	var rows []PackWithMeta
	err := r.db.WithContext(ctx).
		Model(&model.StickerPack{}).
		Select(packMetaSelect).
		Joins("LEFT JOIN users ON users.id = sticker_packs.owner_id").
		Joins("LEFT JOIN stickers ON stickers.pack_id = sticker_packs.id").
		Where("sticker_packs.owner_id = ?", ownerID).
		Group("sticker_packs.id, users.nickname").
		Order("sticker_packs.created_at DESC").
		Scan(&rows).Error
	return rows, err
}

// CountPacksByOwner 统计某用户已发布的表情包数（发布上限校验用）。
func (r *StickerRepository) CountPacksByOwner(ctx context.Context, ownerID uuid.UUID) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).
		Model(&model.StickerPack{}).
		Where("owner_id = ?", ownerID).
		Count(&n).Error
	return n, err
}

// CountStickersByPack 统计某包内的贴纸数（单包规模上限校验用）。
func (r *StickerRepository) CountStickersByPack(ctx context.Context, packID uuid.UUID) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).
		Model(&model.Sticker{}).
		Where("pack_id = ?", packID).
		Count(&n).Error
	return n, err
}

// PublishPack 事务内创建表情包及其全部贴纸行（发布语义：要么整包可见，要么不存在）。
// 发布产出的贴纸行 owner_id 恒为 NULL：发布者注销时 stickers.owner_id 的 CASCADE
// 不会波及包内容，包随 owner_id 置 NULL 保留。
func (r *StickerRepository) PublishPack(ctx context.Context, pack *model.StickerPack, stickers []model.Sticker) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(pack).Error; err != nil {
			return err
		}
		if len(stickers) == 0 {
			return nil
		}
		for i := range stickers {
			packID := pack.ID
			stickers[i].PackID = &packID
		}
		return tx.Create(&stickers).Error
	})
}

// UpdatePackOfOwner 更新本人表情包的名称/封面（updates 为列名到新值的映射）。
// owner_id 进 WHERE 消除 check-then-act 窗口；未命中（并发已删）返回 gorm.ErrRecordNotFound。
func (r *StickerRepository) UpdatePackOfOwner(ctx context.Context, ownerID, packID uuid.UUID, updates map[string]any) error {
	res := r.db.WithContext(ctx).
		Model(&model.StickerPack{}).
		Where("id = ? AND owner_id = ?", packID, ownerID).
		Updates(updates)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// DeletePackOfOwner 删除本人发布的表情包。stickers 与 user_sticker_packs
// 靠外键 ON DELETE CASCADE 随之清理（发布者主动撤回的预期行为）。
// owner_id 进 WHERE；未命中返回 gorm.ErrRecordNotFound。
func (r *StickerRepository) DeletePackOfOwner(ctx context.Context, ownerID, packID uuid.UUID) error {
	res := r.db.WithContext(ctx).
		Where("id = ? AND owner_id = ?", packID, ownerID).
		Delete(&model.StickerPack{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// AddStickerToPack 插入一条包内贴纸行（owner_id 为 NULL，不占用 (owner_id, content_hash)
// 唯一键，同一内容可同时存在于多个包与多人的收藏）。
func (r *StickerRepository) AddStickerToPack(ctx context.Context, st *model.Sticker) error {
	return r.db.WithContext(ctx).Create(st).Error
}

// RemovePackSticker 从指定包中移除一张贴纸（仅包所有者可操作，不校验"至少保留一张"）。
// pack_id 进 WHERE；未命中（贴纸不在该包）返回 gorm.ErrRecordNotFound。
func (r *StickerRepository) RemovePackSticker(ctx context.Context, packID, stickerID uuid.UUID) error {
	res := r.db.WithContext(ctx).
		Where("id = ? AND pack_id = ?", stickerID, packID).
		Delete(&model.Sticker{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// AddUserPack 把一个表情包加入用户「已添加」列表，幂等：重复添加返回既有关系行。
//
// ON CONFLICT DO NOTHING + 回查而非 FirstOrCreate：后者是 SELECT + INSERT 两步、
// 非原子，并发双击/多端重试时第二个请求撞唯一约束会以 duplicate key 落到 500，
// 而实际状态是确定的成功（同 AddOwned 的取舍）。
func (r *StickerRepository) AddUserPack(ctx context.Context, userID, packID uuid.UUID) (*model.UserStickerPack, error) {
	rel := &model.UserStickerPack{UserID: userID, PackID: packID}
	res := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "user_id"}, {Name: "pack_id"}},
			DoNothing: true,
		}).
		Create(rel)
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected > 0 {
		return rel, nil
	}
	var existing model.UserStickerPack
	if err := r.db.WithContext(ctx).
		Where("user_id = ? AND pack_id = ?", userID, packID).
		First(&existing).Error; err != nil {
		return nil, err
	}
	return &existing, nil
}

// RemoveUserPack 把一个表情包移出用户「已添加」列表（不影响包本身）。
// 幂等：包本就不在列表里时同样返回 nil——删除的终态即"不在列表"，无须区分。
func (r *StickerRepository) RemoveUserPack(ctx context.Context, userID, packID uuid.UUID) error {
	return r.db.WithContext(ctx).
		Where("user_id = ? AND pack_id = ?", userID, packID).
		Delete(&model.UserStickerPack{}).Error
}

// IsAddedBatch 批量检查表情包是否已被当前用户添加，返回已添加的 pack_id Set（防 N+1）。
func (r *StickerRepository) IsAddedBatch(ctx context.Context, userID uuid.UUID, packIDs []uuid.UUID) (map[uuid.UUID]bool, error) {
	if len(packIDs) == 0 {
		return map[uuid.UUID]bool{}, nil
	}
	var ids []uuid.UUID
	err := r.db.WithContext(ctx).
		Model(&model.UserStickerPack{}).
		Select("pack_id").
		Where("user_id = ? AND pack_id IN ?", userID, packIDs).
		Scan(&ids).Error
	result := make(map[uuid.UUID]bool, len(ids))
	for _, id := range ids {
		result[id] = true
	}
	return result, err
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
