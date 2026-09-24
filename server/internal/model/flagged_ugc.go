package model

import (
	"time"

	"github.com/google/uuid"
)

// FlaggedUGC 一条命中敏感词的 UGC 记录（昵称 / bio / 群名 / 群公告 / 朋友圈动态 / 朋友圈评论）。
// 命中内容本身照常写入业务表，本表只做审核队列的命中台账：
// 记录命中词、写入者与所属会话，供管理端检索与「强制重置」处置。
type FlaggedUGC struct {
	ID             uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UGCType        string     `gorm:"type:varchar(32);not null" json:"ugc_type"`
	Content        string     `gorm:"type:text;not null" json:"content"`
	HitWord        string     `gorm:"type:varchar(64);not null;default:''" json:"hit_word"`
	UserID         *uuid.UUID `gorm:"type:uuid" json:"user_id,omitempty"`
	ConversationID *uuid.UUID `gorm:"type:uuid" json:"conversation_id,omitempty"`
	// TargetID 命中内容所在那一行的主键。前四类改的是 users / conversations 上的
	// 一个字段，靠 UserID / ConversationID 就能定位；朋友圈动态与评论各自成行，
	// 同一个人可以有很多条，必须记下具体是哪条才处置得了。
	TargetID  *uuid.UUID `gorm:"type:uuid" json:"target_id,omitempty"`
	HandledAt *time.Time `json:"handled_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

// TableName 指定表名。
func (FlaggedUGC) TableName() string { return "flagged_ugc" }

// FlaggedUGC 类型常量
const (
	UGCTypeNickname     = "nickname"
	UGCTypeBio          = "bio"
	UGCTypeGroupName    = "group_name"
	UGCTypeAnnouncement = "announcement"
	// 朋友圈两类的处置是删除那一条，不是把字段清空，故都依赖 TargetID
	UGCTypeMomentPost    = "moment_post"
	UGCTypeMomentComment = "moment_comment"
)

// Admin 强制重置 UGC 的审计动作常量
const (
	AdminActionResetNickname     = "reset_nickname"
	AdminActionResetBio          = "reset_bio"
	AdminActionResetGroupName    = "reset_group_name"
	AdminActionResetAnnouncement = "reset_announcement"
	AdminActionClearUGCFlag      = "clear_ugc_flag"
)
