package model

import (
	"time"

	"github.com/google/uuid"
)

// MessageEdit 消息编辑历史的一个旧版本。
//
// 只存被替换掉的版本，当前版本始终在 messages.content —— 因此一条编辑过
// N 次的消息有 N 条历史行（version 1..N）与 messages 里的第 N+1 版。
type MessageEdit struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	MessageID  uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_message_edits_msg_ver,priority:1" json:"message_id"`
	OldContent string    `gorm:"type:jsonb;not null" json:"old_content"`
	Version    int16     `gorm:"not null;uniqueIndex:idx_message_edits_msg_ver,priority:2" json:"version"`
	EditedAt   time.Time `json:"edited_at"`
	CreatedAt  time.Time `json:"created_at"`
}

// TableName 指定表名。
func (MessageEdit) TableName() string {
	return "message_edits"
}
