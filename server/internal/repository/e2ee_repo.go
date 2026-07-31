package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// E2EERepository 端到端加密的公钥材料与备份 blob 存取。
// 服务端只接触公钥与密文，永不持有任何可解密私钥。
type E2EERepository struct {
	db *gorm.DB
}

func NewE2EERepository(db *gorm.DB) *E2EERepository {
	return &E2EERepository{db: db}
}

// UpsertIdentity 保存/更新身份密钥与 signed prekey（换设备或轮换 SPK 时覆盖）。
func (r *E2EERepository) UpsertIdentity(ctx context.Context, identity *model.E2EEIdentity) error {
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"identity_dh_public_key", "identity_sign_public_key",
			"signed_prekey_id", "signed_prekey_public", "signed_prekey_signature",
			"updated_at",
		}),
	}).Create(identity).Error
}

// FindIdentity 查用户身份密钥；不存在返回 (nil, nil)。
func (r *E2EERepository) FindIdentity(ctx context.Context, userID uuid.UUID) (*model.E2EEIdentity, error) {
	var identity model.E2EEIdentity
	err := r.db.WithContext(ctx).First(&identity, "user_id = ?", userID).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &identity, nil
}

// ReplaceOneTimePreKeys 覆盖式补充一次性预密钥池。
// 同一 (user_id, key_id) 冲突时更新公钥，避免客户端重传导致失败。
func (r *E2EERepository) ReplaceOneTimePreKeys(ctx context.Context, keys []model.E2EEOneTimePreKey) error {
	if len(keys) == 0 {
		return nil
	}
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "key_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"public_key"}),
	}).Create(&keys).Error
}

// PopOneTimePreKey 原子取走一个一次性预密钥（取后即删）。
// 池空时返回 (nil, nil)，调用方据此降级为 3DH。
//
// 用 DELETE ... RETURNING 保证并发下同一把钥匙不会被分发两次
// （两个请求同时给同一用户建会话时，各自拿到不同的 key）。
func (r *E2EERepository) PopOneTimePreKey(ctx context.Context, userID uuid.UUID) (*model.E2EEOneTimePreKey, error) {
	var key model.E2EEOneTimePreKey
	err := r.db.WithContext(ctx).Raw(`
		DELETE FROM e2ee_one_time_prekeys
		WHERE id = (
			SELECT id FROM e2ee_one_time_prekeys
			WHERE user_id = ?
			ORDER BY key_id
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		RETURNING id, user_id, key_id, public_key, created_at
	`, userID).Scan(&key).Error
	if err != nil {
		return nil, err
	}
	if key.PublicKey == "" {
		return nil, nil
	}
	return &key, nil
}

// CountOneTimePreKeys 统计剩余数量（客户端据此决定何时补充）。
func (r *E2EERepository) CountOneTimePreKeys(ctx context.Context, userID uuid.UUID) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.E2EEOneTimePreKey{}).
		Where("user_id = ?", userID).Count(&count).Error
	return count, err
}

// UpsertBackup 保存密钥备份 blob（覆盖旧版本）。
func (r *E2EERepository) UpsertBackup(ctx context.Context, backup *model.E2EEKeyBackup) error {
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"cipher_blob", "salt", "version", "updated_at"}),
	}).Create(backup).Error
}

// FindBackup 取备份 blob；不存在返回 (nil, nil)。
func (r *E2EERepository) FindBackup(ctx context.Context, userID uuid.UUID) (*model.E2EEKeyBackup, error) {
	var backup model.E2EEKeyBackup
	err := r.db.WithContext(ctx).First(&backup, "user_id = ?", userID).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &backup, nil
}
