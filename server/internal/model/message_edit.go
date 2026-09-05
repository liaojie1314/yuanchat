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
	Version    int16     `gorm:"type:smallint;not null;uniqueIndex:idx_message_edits_msg_ver,priority:2" json:"version"`
	// EditedAt 该版本**被替换掉**的时刻（不是它被写下的时刻）——
	// 因此首个版本的这个值等于第二版的生效时间，展示逐版本时间轴时首版应取消息的发送时间。
	// 显式 not null + default:now() 与迁移 017 对齐：没有 default tag 时 GORM 会把
	// Go 侧零值一并写进 INSERT，库端默认值不生效，历史行会落成 0001-01-01。
	EditedAt time.Time `gorm:"not null;default:now()" json:"edited_at"`
	// CreatedAt 行插入时间（全仓每张表都有的审计时间戳）。与 EditedAt 今日取值相同但语义不同：
	// 前者是「这行记录何时被写入」，后者是「这个版本何时被顶掉」。
	CreatedAt time.Time `gorm:"not null;default:now()" json:"created_at"`
}

// TableName 指定表名。
func (MessageEdit) TableName() string {
	return "message_edits"
}
