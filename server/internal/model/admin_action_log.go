package model

import (
	"time"

	"github.com/google/uuid"
)

// AdminActionLog 管理员操作审计日志。
// 所有 /admin/* 写操作必须留痕：谁（actor）对什么（target_type/target_id）
// 做了什么（action），细节进 detail JSON。
type AdminActionLog struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	ActorID    uuid.UUID `gorm:"type:uuid;not null;index:idx_admin_logs_actor,priority:1" json:"actor_id"`
	Action     string    `gorm:"type:varchar(64);not null" json:"action"`
	TargetType string    `gorm:"type:varchar(32);not null" json:"target_type"`
	TargetID   string    `gorm:"type:varchar(64);not null" json:"target_id"`
	Detail     string    `gorm:"type:jsonb;not null;default:'{}'" json:"detail"`
	CreatedAt  time.Time `json:"created_at"`
}

// TableName 指定表名。
func (AdminActionLog) TableName() string { return "admin_action_logs" }

// Admin 审计动作常量
const (
	AdminActionBanUser         = "ban_user"
	AdminActionUnbanUser       = "unban_user"
	AdminActionDissolveConv    = "dissolve_conversation"
	AdminActionDeleteMessage   = "delete_message"
	AdminActionClearFlag       = "clear_flag"
	AdminActionReportKeep      = "report_keep"
	AdminActionReportDelete    = "report_delete"
	AdminActionTakeDownPack    = "take_down_sticker_pack"
	AdminActionUntakeDownPack  = "untake_down_sticker_pack"
	AdminActionSetPackOfficial = "set_sticker_pack_official"
	AdminActionClearPackFlag   = "clear_sticker_pack_flag"
	// AdminActionResetAvatar 管理端重置用户头像（avatar_url 置空，恢复默认头像）。
	AdminActionResetAvatar = "reset_avatar"
	// AdminActionViewMessageEdits 管理员查看消息编辑历史（取证动作，须留痕）。
	AdminActionViewMessageEdits = "view_message_edits"
	// 朋友圈处置：删帖 / 删评论（内容本体软删，本表只记审计）
	AdminActionDeleteMomentPost    = "delete_moment_post"
	AdminActionDeleteMomentComment = "delete_moment_comment"
)
