package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
)

// UserRepository 负责 users 表的数据库读写。
type UserRepository struct {
	db *gorm.DB
}

func NewUserRepository(db *gorm.DB) *UserRepository {
	return &UserRepository{db: db}
}

// Create 插入一条用户记录。
func (r *UserRepository) Create(ctx context.Context, user *model.User) error {
	return r.db.WithContext(ctx).Create(user).Error
}

// FindByID 按 UUID 查用户。
func (r *UserRepository) FindByID(ctx context.Context, id uuid.UUID) (*model.User, error) {
	var user model.User
	err := r.db.WithContext(ctx).First(&user, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &user, err
}

// FindByIDs 批量查用户资料（黑名单页/群成员列表用）。
// 结果顺序与传入 ids 无关；调用方需按需重排。
func (r *UserRepository) FindByIDs(ctx context.Context, ids []uuid.UUID) ([]model.User, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	var users []model.User
	err := r.db.WithContext(ctx).Where("id IN ?", ids).Find(&users).Error
	return users, err
}

// FindByPhone 按手机号查用户。
func (r *UserRepository) FindByPhone(ctx context.Context, phone string) (*model.User, error) {
	var user model.User
	err := r.db.WithContext(ctx).First(&user, "phone = ?", phone).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &user, err
}

// FindByEmail 按邮箱查用户。
func (r *UserRepository) FindByEmail(ctx context.Context, email string) (*model.User, error) {
	var user model.User
	err := r.db.WithContext(ctx).First(&user, "email = ?", email).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &user, err
}

// FindByShortID looks up a user by their short id (元聊号).
func (r *UserRepository) FindByShortID(ctx context.Context, shortID int64) (*model.User, error) {
	var user model.User
	err := r.db.WithContext(ctx).First(&user, "short_id = ?", shortID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &user, err
}

// ExistsByPhoneOrEmail 判断手机号或邮箱是否已被注册。
func (r *UserRepository) ExistsByPhoneOrEmail(ctx context.Context, phone, email string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.User{}).
		Where("phone = ? OR email = ?", phone, email).
		Count(&count).Error
	return count > 0, err
}

// Update 更新已有用户的字段。
func (r *UserRepository) Update(ctx context.Context, user *model.User) error {
	return r.db.WithContext(ctx).Save(user).Error
}

// TokenVersion 只取该用户的 token_version 字段。
//
// WS 建连时校验令牌是否已被吊销，只需要这一个整数，故不走 FindByID 拉整行。
// 用户不存在时返回 ErrRecordNotFound，由调用方按「拒绝连接」处理。
func (r *UserRepository) TokenVersion(ctx context.Context, id uuid.UUID) (int, error) {
	var versions []int
	err := r.db.WithContext(ctx).Model(&model.User{}).
		Where("id = ?", id).
		Pluck("token_version", &versions).Error
	if err != nil {
		return 0, err
	}
	if len(versions) == 0 {
		return 0, gorm.ErrRecordNotFound
	}
	return versions[0], nil
}

// TouchLastLogin 把用户的 last_login_at 更新为当前时间。
func (r *UserRepository) TouchLastLogin(ctx context.Context, id uuid.UUID) error {
	return r.db.WithContext(ctx).Model(&model.User{}).
		Where("id = ?", id).
		Update("last_login_at", time.Now()).Error
}
