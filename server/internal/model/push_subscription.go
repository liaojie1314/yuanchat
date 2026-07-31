package model

import (
	"time"

	"github.com/google/uuid"
)

// PushSubscription 浏览器 Web Push 订阅（W3C Push API 的 PushSubscription）。
// endpoint 由浏览器推送服务分配，p256dh/auth 是消息加密所需的客户端公钥与鉴权密钥。
type PushSubscription struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	Endpoint  string    `gorm:"type:text;not null;uniqueIndex:idx_push_endpoint" json:"endpoint"`
	P256dh    string    `gorm:"type:varchar(255);not null" json:"p256dh"`
	Auth      string    `gorm:"type:varchar(255);not null" json:"auth"`
	UserAgent string    `gorm:"type:varchar(255);not null" json:"user_agent"`
	CreatedAt time.Time `json:"created_at"`
}

// TableName 指定表名。
func (PushSubscription) TableName() string { return "push_subscriptions" }
