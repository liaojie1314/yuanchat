package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// User 用户模型
type User struct {
	ID           uuid.UUID      `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Phone        *string        `gorm:"type:varchar(20);uniqueIndex" json:"phone,omitempty"`
	Email        *string        `gorm:"type:varchar(255);uniqueIndex" json:"email,omitempty"`
	PasswordHash string         `gorm:"type:varchar(255);not null" json:"-"`
	Nickname     string         `gorm:"type:varchar(50);not null" json:"nickname"`
	AvatarURL    *string        `gorm:"type:varchar(500)" json:"avatar_url,omitempty"`
	Bio          *string        `gorm:"type:varchar(500)" json:"bio,omitempty"`
	Gender       int16          `gorm:"type:smallint;default:0" json:"gender"`
	Birthday     *time.Time     `json:"birthday,omitempty"`
	Status       int16          `gorm:"type:smallint;default:1" json:"status"`
	LastLoginAt  *time.Time     `json:"last_login_at,omitempty"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	DeletedAt    gorm.DeletedAt `gorm:"index" json:"-"`
}

// TableName 指定表名
func (User) TableName() string {
	return "users"
}

// UserStatus 用户状态枚举
const (
	UserStatusNormal   int16 = 1
	UserStatusDisabled int16 = 2
	UserStatusDeleted  int16 = 3
)

// Gender 性别枚举
const (
	GenderUnknown int16 = 0
	GenderMale    int16 = 1
	GenderFemale  int16 = 2
)
