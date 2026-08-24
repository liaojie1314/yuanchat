package repository

import (
	"context"

	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
)

// VerificationCodeRepository 负责 verification_codes 表的审计写入。
type VerificationCodeRepository struct {
	db *gorm.DB
}

func NewVerificationCodeRepository(db *gorm.DB) *VerificationCodeRepository {
	return &VerificationCodeRepository{db: db}
}

// Create 追加一条发码审计记录。
func (r *VerificationCodeRepository) Create(ctx context.Context, code *model.VerificationCode) error {
	return r.db.WithContext(ctx).Create(code).Error
}

// MarkUsed 把某目标下匹配且尚未使用的验证码标记为已使用。
//
// 以 target + code 定位而非主键：热路径在 Redis，调用方手里只有这两个值。
func (r *VerificationCodeRepository) MarkUsed(ctx context.Context, target, code string) error {
	return r.db.WithContext(ctx).Model(&model.VerificationCode{}).
		Where("target = ? AND code = ? AND used = ?", target, code, false).
		Update("used", true).Error
}
