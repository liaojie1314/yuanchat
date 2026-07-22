package model

import (
	"time"

	"github.com/google/uuid"
)

// Blocklist 拉黑关系模型（单向）：UserID 拉黑 TargetID。
// 对称关系需两条行；(UserID, TargetID) 复合唯一避免重复。
// 无 UpdatedAt / DeletedAt：解除拉黑走物理删除，语义清晰。
type Blocklist struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_blocklist_user_target" json:"user_id"`
	TargetID  uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_blocklist_user_target" json:"target_id"`
	CreatedAt time.Time `json:"created_at"`
}

// TableName 指定表名。
func (Blocklist) TableName() string {
	return "blocklists"
}
