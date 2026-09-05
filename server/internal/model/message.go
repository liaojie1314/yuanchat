package model

import (
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"gorm.io/gorm"
)

// Message 消息模型
type Message struct {
	ID             uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	ConversationID uuid.UUID  `gorm:"type:uuid;not null;index:idx_messages_conversation;uniqueIndex:idx_conversation_seq,priority:1" json:"conversation_id"`
	SenderID       uuid.UUID  `gorm:"type:uuid;not null;index:idx_messages_sender" json:"sender_id"`
	Seq            int64      `gorm:"not null;uniqueIndex:idx_conversation_seq,priority:2" json:"seq"` // (conversation_id, seq) 联合唯一
	MessageType    int16      `gorm:"type:smallint;not null" json:"message_type"`
	Content        string     `gorm:"type:jsonb;not null" json:"content"` // JSONB 灵活存储
	Status         int16      `gorm:"type:smallint;default:1" json:"status"`
	Flagged        bool       `gorm:"not null;default:false" json:"flagged"` // 敏感词命中，进审核队列
	ReplyToID      *uuid.UUID `gorm:"type:uuid" json:"reply_to_id,omitempty"`
	// Mentions 被 @ 的用户 UUID 列表（PostgreSQL uuid[]，为 nil 时不占列）。
	// 群消息设置这里的成员会触发 conversation_members.mention_unread=true。
	Mentions    pq.StringArray `gorm:"type:uuid[]" json:"mentions,omitempty"`
	ClientMsgID *string        `gorm:"type:varchar(64)" json:"client_msg_id,omitempty"`
	// EditedAt 最后一次编辑时间；非 nil 即「已编辑」，前端据此显示角标。
	EditedAt *time.Time `json:"edited_at,omitempty"`
	// EditCount 累计编辑次数，等于 message_edits 中该消息的历史行数。
	EditCount int16          `gorm:"not null;default:0" json:"edit_count"`
	CreatedAt time.Time      `json:"created_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

// TableName 指定表名
func (Message) TableName() string {
	return "messages"
}

// MessageType 消息类型枚举
const (
	MessageTypeText   int16 = 1
	MessageTypeImage  int16 = 2
	MessageTypeFile   int16 = 3
	MessageTypeVoice  int16 = 4
	MessageTypeVideo  int16 = 5
	MessageTypeSystem int16 = 6
	// MessageTypeE2EE 端到端加密密文。服务端只存密文，无法解读内容，
	// 因此全文搜索、内容审核、消息预览对此类消息天然失效。
	MessageTypeE2EE int16 = 7
	// MessageTypeSticker 贴纸消息（收藏表情/官方表情包），独立类型不复用 image：
	// 渲染无气泡裸图、不进搜索索引（与 image 现状一致，靠 content 无 text 字段自然过滤）、
	// 不进内容审核（同 image/file/voice，审核仅对 MessageTypeText 生效）。
	MessageTypeSticker int16 = 8
)

// MessageStatus 消息状态枚举
const (
	MessageStatusNormal  int16 = 1
	MessageStatusRevoked int16 = 2
	MessageStatusDeleted int16 = 3
)

// MessageContentText 文本消息内容 JSON 结构
type MessageContentText struct {
	Text string `json:"text"`
}

// MessageContentImage 图片消息内容 JSON 结构
type MessageContentImage struct {
	FileID   uuid.UUID `json:"file_id"`
	URL      string    `json:"url"`
	ThumbURL string    `json:"thumb_url"`
	Width    int       `json:"width"`
	Height   int       `json:"height"`
}

// MessageContentFile 文件消息内容 JSON 结构
type MessageContentFile struct {
	FileID   uuid.UUID `json:"file_id"`
	FileName string    `json:"file_name"`
	FileSize int64     `json:"file_size"`
	URL      string    `json:"url"`
}

// MessageContentVideo 视频消息内容 JSON 结构（落库 jsonb 的真实形状）。
//
// 与 MessageContentImage/File 那两个遗留结构（带 file_id/url）不同，本结构就是
// WS buildContent 写入的字段本身：Key 指向主视频对象，ThumbKey 指向客户端生成的
// JPEG 缩略图（images/ 前缀）。缩略图与消息共存亡——对象授权与 GC 都按 thumb_key
// 反查消息，故撤回消息即同时收回视频与缩略图的可读性。
type MessageContentVideo struct {
	Key      string `json:"key"`
	ThumbKey string `json:"thumb_key"`
	Name     string `json:"name"`
	Size     int64  `json:"size"`
	Duration int    `json:"duration"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
}
