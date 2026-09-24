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
	ShortID      int64          `gorm:"type:bigint;uniqueIndex;not null" json:"short_id"` // QQ 号风格短号
	Nickname     string         `gorm:"type:varchar(50);not null" json:"nickname"`
	AvatarURL    *string        `gorm:"type:varchar(500)" json:"avatar_url,omitempty"`
	Bio          *string        `gorm:"type:varchar(500)" json:"bio,omitempty"`
	Gender       int16          `gorm:"type:smallint;default:0" json:"gender"`
	Birthday     *time.Time     `json:"birthday,omitempty"`
	// 个人状态：过期判定只在读时做（EffectiveStatus），不开定时清理任务。
	// json tag 统一为 "-"：直接序列化会把已过期的状态原样吐出去，
	// 所有出网路径必须经 EffectiveStatus 取值。
	StatusEmoji     string     `gorm:"type:varchar(16);not null;default:''" json:"-"`
	StatusText      string     `gorm:"type:varchar(64);not null;default:''" json:"-"`
	StatusExpiresAt *time.Time `json:"-"`
	Status          int16      `gorm:"type:smallint;default:1" json:"status"`
	Role         int16          `gorm:"type:smallint;default:0" json:"role"`
	TokenVersion int            `gorm:"type:int;not null;default:0" json:"-"` // 令牌吊销版本号，改密时递增使旧令牌失效
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

// UserRole 用户角色枚举
const (
	RoleUser  int16 = 0
	RoleAdmin int16 = 1
)

// EffectiveStatus 返回在 now 时刻仍有效的个人状态；已过期或未设置时返回两个空串。
//
// StatusExpiresAt 为 nil 表示「不自动清除」。调用方传入 now 而非内部取 time.Now()，
// 使过期边界可在测试里确定性地断言。
func (u *User) EffectiveStatus(now time.Time) (emoji, text string) {
	if u.StatusExpiresAt != nil && !now.Before(*u.StatusExpiresAt) {
		return "", ""
	}
	return u.StatusEmoji, u.StatusText
}
