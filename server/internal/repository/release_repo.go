package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
)

// ErrDuplicateRelease 同一 (platform, arch, version, channel) 已登记。
//
// 由唯一索引 idx_app_releases_unique（迁移 023）保证。重复登记同一版是运营误操作，
// 调用方应映射成 409 而不是产出两条互相覆盖的记录。
var ErrDuplicateRelease = errors.New("duplicate release")

// ReleaseRepository 负责 app_releases 表的读写。
type ReleaseRepository struct {
	db *gorm.DB
}

// NewReleaseRepository 构造版本仓储。
func NewReleaseRepository(db *gorm.DB) *ReleaseRepository {
	return &ReleaseRepository{db: db}
}

// LatestPublished 取某平台/架构/渠道下最新已发布的版本；没有则返回 (nil, nil)。
//
// 排序用 published_at DESC 而不是 version DESC：版本号是字符串，
// 字典序会把 0.9.0 排在 0.10.0 之后。发布时间才是单调的，
// 且「最后发布的那条就是当前在线版本」正是回滚后期望的语义 ——
// 回滚会把状态改掉，于是上一条 published 自然浮上来。
func (r *ReleaseRepository) LatestPublished(
	ctx context.Context,
	platform, arch, channel string,
) (*model.AppRelease, error) {
	var rel model.AppRelease
	err := r.db.WithContext(ctx).
		Where("platform = ? AND arch = ? AND channel = ? AND status = ?",
			platform, arch, channel, model.ReleaseStatusPublished).
		Order("published_at DESC").
		First(&rel).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &rel, nil
}

// CatalogLatest 取某渠道下每个 (platform, arch) 的最新已发布版本，供下载页列表用。
//
// 用 DISTINCT ON 而不是在应用层去重：平台/架构组合会随新端增加，
// 让数据库一次出结果比捞全表再筛稳。
func (r *ReleaseRepository) CatalogLatest(
	ctx context.Context,
	channel string,
) ([]model.AppRelease, error) {
	var rows []model.AppRelease
	err := r.db.WithContext(ctx).
		Raw(`SELECT DISTINCT ON (platform, arch) *
		     FROM app_releases
		     WHERE channel = ? AND status = ?
		     ORDER BY platform, arch, published_at DESC`,
			channel, model.ReleaseStatusPublished).
		Scan(&rows).Error
	return rows, err
}

// ReleaseFilter 管理端列表的筛选条件；空串表示不过滤。
type ReleaseFilter struct {
	Platform string
	Channel  string
	Status   string
}

// List 管理端分页列出版本记录，按创建时间倒序。
func (r *ReleaseRepository) List(
	ctx context.Context,
	f ReleaseFilter,
	offset, limit int,
) ([]model.AppRelease, int64, error) {
	tx := r.db.WithContext(ctx).Model(&model.AppRelease{})
	if f.Platform != "" {
		tx = tx.Where("platform = ?", f.Platform)
	}
	if f.Channel != "" {
		tx = tx.Where("channel = ?", f.Channel)
	}
	if f.Status != "" {
		tx = tx.Where("status = ?", f.Status)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []model.AppRelease
	err := tx.Order("created_at DESC").Offset(offset).Limit(limit).Find(&rows).Error
	return rows, total, err
}

// FindByID 按主键取一条；不存在返回 (nil, nil)。
func (r *ReleaseRepository) FindByID(ctx context.Context, id uuid.UUID) (*model.AppRelease, error) {
	var rel model.AppRelease
	err := r.db.WithContext(ctx).First(&rel, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &rel, nil
}

// Create 登记一条新版本（默认 draft）。
//
// 撞唯一索引时返回 ErrDuplicateRelease，由 handler 映射成 409。
func (r *ReleaseRepository) Create(ctx context.Context, rel *model.AppRelease) error {
	err := r.db.WithContext(ctx).Create(rel).Error
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return ErrDuplicateRelease
	}
	return err
}

// Update 更新可改字段（灰度 / 强制 / 更新说明）。返回是否命中记录。
//
// 刻意只放行这三项：平台/架构/版本号/对象键是身份，改它们等于换一条记录，
// 该走「新建 + 回滚旧的」而不是原地改。
func (r *ReleaseRepository) Update(
	ctx context.Context,
	id uuid.UUID,
	fields map[string]any,
) (bool, error) {
	if len(fields) == 0 {
		return false, nil
	}
	res := r.db.WithContext(ctx).Model(&model.AppRelease{}).
		Where("id = ?", id).
		Updates(fields)
	return res.RowsAffected > 0, res.Error
}

// SetStatus 改状态。published 时顺手写 published_at —— 对外查询按它排序，
// 不写就排不出「最后发布的那条」。返回是否命中记录。
func (r *ReleaseRepository) SetStatus(
	ctx context.Context,
	id uuid.UUID,
	status string,
) (bool, error) {
	fields := map[string]any{"status": status, "updated_at": gorm.Expr("now()")}
	if status == model.ReleaseStatusPublished {
		fields["published_at"] = gorm.Expr("now()")
	}
	res := r.db.WithContext(ctx).Model(&model.AppRelease{}).
		Where("id = ?", id).
		Updates(fields)
	return res.RowsAffected > 0, res.Error
}
