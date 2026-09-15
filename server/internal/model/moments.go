package model

import (
	"time"

	"github.com/google/uuid"
)

// MomentMediaKind 帖子媒体类型判别：图与视频互斥，故用单列 media + 本判别位。
const (
	MomentMediaKindNone  int16 = 0
	MomentMediaKindImage int16 = 1
	MomentMediaKindVideo int16 = 2
)

// MomentVisibility 帖子可见性。当前只有两档，分组可见性（标签/部分好友）未做。
const (
	MomentVisibilityFriends int16 = 0 // 所有好友可见
	MomentVisibilityPrivate int16 = 1 // 仅自己可见
)

// MomentActivityKind 互动消息类型。
const (
	MomentActivityKindLike    int16 = 1
	MomentActivityKindComment int16 = 2
)

// 帖子内容与媒体的应用层上限。
const (
	MomentContentMaxLen = 1000
	MomentCommentMaxLen = 500
	MomentMaxImages     = 9
)

// MomentMediaItem 落库 media jsonb 数组里的单项。
//
// 字段名与消息 content 的媒体字段逐字一致（key / thumb_key），
// 使对象 ACL 与 GC 的按 key 反查能用同一套表达式（见 ObjectACLRepository）。
// 图片项只填 Key/W/H；视频项额外填 ThumbKey/Duration。
type MomentMediaItem struct {
	Key      string  `json:"key"`
	ThumbKey string  `json:"thumb_key,omitempty"`
	Duration float64 `json:"duration,omitempty"`
	W        int     `json:"w"`
	H        int     `json:"h"`
}

// MomentPost 一条朋友圈动态。
//
// Media 存 JSON 原文而非结构化切片，与 Message.Content 同一惯例：
// 落 jsonb 列，读写时由 service 层 Marshal/Unmarshal。
type MomentPost struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID     uuid.UUID  `gorm:"type:uuid;not null" json:"user_id"`
	Content    string     `gorm:"type:text;not null;default:''" json:"content"`
	Media      string     `gorm:"type:jsonb;not null;default:'[]'" json:"media"`
	MediaKind  int16      `gorm:"type:smallint;not null;default:0" json:"media_kind"`
	Visibility int16      `gorm:"type:smallint;not null;default:0" json:"visibility"`
	Flagged    bool       `gorm:"not null;default:false" json:"flagged"`
	CreatedAt  time.Time  `json:"created_at"`
	DeletedAt  *time.Time `gorm:"index" json:"-"`
}

// TableName 指定表名。
func (MomentPost) TableName() string { return "moments_posts" }

// MomentLike 点赞记录。复合主键 (post_id, user_id) 即幂等约束，不另建 id 列。
type MomentLike struct {
	PostID    uuid.UUID `gorm:"type:uuid;primaryKey" json:"post_id"`
	UserID    uuid.UUID `gorm:"type:uuid;primaryKey" json:"user_id"`
	CreatedAt time.Time `json:"created_at"`
}

// TableName 指定表名。
func (MomentLike) TableName() string { return "moments_likes" }

// MomentComment 评论。ReplyToUserID 非空表示回复某人（楼中楼只记被回复者，不建树）。
type MomentComment struct {
	ID            uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	PostID        uuid.UUID  `gorm:"type:uuid;not null" json:"post_id"`
	UserID        uuid.UUID  `gorm:"type:uuid;not null" json:"user_id"`
	ReplyToUserID *uuid.UUID `gorm:"type:uuid" json:"reply_to_user_id,omitempty"`
	Content       string     `gorm:"type:text;not null" json:"content"`
	Flagged       bool       `gorm:"not null;default:false" json:"flagged"`
	CreatedAt     time.Time  `json:"created_at"`
	DeletedAt     *time.Time `gorm:"index" json:"-"`
}

// TableName 指定表名。
func (MomentComment) TableName() string { return "moments_comments" }

// MomentActivity 一条互动消息（红点数据源）。UserID 为被通知人。
type MomentActivity struct {
	ID        uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID    uuid.UUID  `gorm:"type:uuid;not null" json:"user_id"`
	ActorID   uuid.UUID  `gorm:"type:uuid;not null" json:"actor_id"`
	PostID    uuid.UUID  `gorm:"type:uuid;not null" json:"post_id"`
	CommentID *uuid.UUID `gorm:"type:uuid" json:"comment_id,omitempty"`
	Kind      int16      `gorm:"type:smallint;not null" json:"kind"`
	CreatedAt time.Time  `json:"created_at"`
	ReadAt    *time.Time `json:"read_at,omitempty"`
}

// TableName 指定表名。
func (MomentActivity) TableName() string { return "moments_activities" }
