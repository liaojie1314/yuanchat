package model

import (
	"time"

	"github.com/google/uuid"
)

// VerificationCode 是验证码下发的审计记录。
//
// 校验热路径完全走 Redis，本表只写不读：用于事后追溯「什么时候向谁下发过哪个码」。
// 表结构见 001_baseline.sql，没有 user_id 列，目标方以 target 存手机号或邮箱。
type VerificationCode struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	Target    string    `gorm:"type:varchar(255);not null" json:"target"`
	Code      string    `gorm:"type:varchar(10);not null" json:"code"`
	Type      int16     `gorm:"type:smallint;not null" json:"type"`
	ExpiresAt time.Time `gorm:"not null" json:"expires_at"`
	Used      bool      `gorm:"default:false" json:"used"`
	CreatedAt time.Time `json:"created_at"`
}

// TableName 指定表名
func (VerificationCode) TableName() string { return "verification_codes" }

// VerificationType 验证码用途枚举
const (
	VerificationTypeRegister      int16 = 1
	VerificationTypePasswordReset int16 = 2
)
