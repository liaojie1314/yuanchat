package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Conversation 会话模型
type Conversation struct {
	ID            uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Type          int16      `gorm:"type:smallint;not null" json:"type"`
	Name          *string    `gorm:"type:varchar(100)" json:"name,omitempty"`
	AvatarURL     *string    `gorm:"type:varchar(500)" json:"avatar_url,omitempty"`
	LastMessageID *uuid.UUID `gorm:"type:uuid" json:"last_message_id,omitempty"`
	LastSeq       int64      `gorm:"default:0" json:"last_seq"`
	CreatedAt     time.Time  `json:"created_at"`
	// Announcement 群公告正文（nil / 空表示无公告，仅群会话有意义）。
	Announcement *string `gorm:"type:text" json:"announcement,omitempty"`
	// AnnouncementUpdatedAt 公告最近一次变更时间（前端据此判断「新公告」提示）。
	AnnouncementUpdatedAt *time.Time     `json:"announcement_updated_at,omitempty"`
	UpdatedAt             time.Time      `json:"updated_at"`
	DeletedAt             gorm.DeletedAt `gorm:"index" json:"-"`
}

// TableName 指定表名
func (Conversation) TableName() string {
	return "conversations"
}

// ConversationType 会话类型枚举
const (
	ConversationTypePrivate int16 = 1
	ConversationTypeGroup   int16 = 2
	ConversationTypeSystem  int16 = 3
)

// ConversationMember 会话成员模型
type ConversationMember struct {
	ID             uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	ConversationID uuid.UUID  `gorm:"type:uuid;not null;uniqueIndex:idx_conv_user" json:"conversation_id"`
	UserID         uuid.UUID  `gorm:"type:uuid;not null;uniqueIndex:idx_conv_user" json:"user_id"`
	Role           int16      `gorm:"type:smallint;default:0" json:"role"`
	JoinedAt       time.Time  `json:"joined_at"`
	LastReadSeq    int64      `gorm:"default:0" json:"last_read_seq"`
	IsMuted        bool       `gorm:"default:false" json:"is_muted"`
	IsPinned       bool       `gorm:"default:false" json:"is_pinned"`
	PinnedAt       *time.Time `json:"pinned_at,omitempty"`
	// MentionUnread 群消息 @ 我未读标记（进入会话调 read 端点时清零）。
	MentionUnread bool `gorm:"default:false" json:"mention_unread"`
	// ClearedBeforeSeq 单侧清空聊天记录的水位：seq <= 本值的消息对本成员不可见。
	// 软清空——不删消息行，其他成员不受影响。
	ClearedBeforeSeq int64 `gorm:"default:0" json:"cleared_before_seq"`
	// Alias 本人在群内的昵称（空串 / nil 表示未设置，署名回退用户本名）。
	Alias *string `gorm:"type:varchar(30)" json:"alias,omitempty"`
}

// TableName 指定表名
func (ConversationMember) TableName() string {
	return "conversation_members"
}

// MemberRole 成员角色枚举
const (
	MemberRoleNormal int16 = 0
	MemberRoleAdmin  int16 = 1
	MemberRoleOwner  int16 = 2
)
