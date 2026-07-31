package model

import (
	"time"

	"github.com/google/uuid"
)

// Report 用户举报（消息/用户），进入 admin 审核队列。
type Report struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	ReporterID uuid.UUID  `gorm:"type:uuid;not null" json:"reporter_id"`
	TargetType string     `gorm:"type:varchar(32);not null" json:"target_type"` // message | user
	TargetID   uuid.UUID  `gorm:"type:uuid;not null" json:"target_id"`
	Reason     string     `gorm:"type:varchar(500);not null" json:"reason"`
	Status     int16      `gorm:"type:smallint;not null;default:0" json:"status"`
	HandledBy  *uuid.UUID `gorm:"type:uuid" json:"handled_by,omitempty"`
	HandledAt  *time.Time `json:"handled_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

// TableName 指定表名。
func (Report) TableName() string { return "reports" }

// Report 状态枚举
const (
	ReportStatusPending int16 = 0 // 待处理
	ReportStatusKept    int16 = 1 // 已处理：保留内容
	ReportStatusDeleted int16 = 2 // 已处理：删除内容
)

// Report 目标类型
const (
	ReportTargetMessage = "message"
	ReportTargetUser    = "user"
)
