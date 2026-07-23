package model

import (
	"time"

	"github.com/google/uuid"
)

// Favorite 用户收藏的消息快照（消息撤回/删除后仍可查看）。
type Favorite struct {
	ID             uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID         uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_fav_user_msg,priority:1" json:"user_id"`
	MessageID      uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_fav_user_msg,priority:2" json:"message_id"`
	ConversationID uuid.UUID `gorm:"type:uuid;not null" json:"conversation_id"`
	ConvName       string    `gorm:"type:varchar(128);not null" json:"conv_name"`
	SenderNickname string    `gorm:"type:varchar(64);not null" json:"sender_nickname"`
	MessageType    int16     `gorm:"type:smallint;not null" json:"message_type"`
	Content        string    `gorm:"type:jsonb;not null" json:"content"`
	CreatedAt      time.Time `json:"created_at"`
}

// TableName 指定表名。
func (Favorite) TableName() string { return "favorites" }
