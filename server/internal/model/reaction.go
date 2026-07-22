package model

import (
	"time"

	"github.com/google/uuid"
)

// MessageReaction 消息表情回应：一人对一条消息的同一 emoji 至多一条（联合唯一）。
type MessageReaction struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	MessageID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_msg_user_emoji" json:"message_id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_msg_user_emoji" json:"user_id"`
	Emoji     string    `gorm:"type:varchar(16);not null;uniqueIndex:idx_msg_user_emoji" json:"emoji"`
	CreatedAt time.Time `json:"created_at"`
}

// TableName 指定表名
func (MessageReaction) TableName() string { return "message_reactions" }
