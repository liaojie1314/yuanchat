package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Message 消息模型
type Message struct {
	ID             uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	ConversationID uuid.UUID  `gorm:"type:uuid;not null;index:idx_messages_conversation" json:"conversation_id"`
	SenderID       uuid.UUID  `gorm:"type:uuid;not null;index:idx_messages_sender" json:"sender_id"`
	Seq            int64      `gorm:"not null;uniqueIndex:idx_conversation_seq" json:"seq"` // 联合唯一
	MessageType    int16      `gorm:"type:smallint;not null" json:"message_type"`
	Content        string     `gorm:"type:jsonb;not null" json:"content"` // JSONB 灵活存储
	Status         int16      `gorm:"type:smallint;default:1" json:"status"`
	ReplyToID      *uuid.UUID `gorm:"type:uuid" json:"reply_to_id,omitempty"`
	ClientMsgID    *string    `gorm:"type:varchar(64)" json:"client_msg_id,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}

// TableName 指定表名
func (Message) TableName() string {
	return "messages"
}

// MessageType 消息类型枚举
const (
	MessageTypeText  int16 = 1
	MessageTypeImage int16 = 2
	MessageTypeFile  int16 = 3
	MessageTypeVoice int16 = 4
	MessageTypeVideo int16 = 5
	MessageTypeSystem int16 = 6
)

// MessageStatus 消息状态枚举
const (
	MessageStatusNormal   int16 = 1
	MessageStatusRevoked  int16 = 2
	MessageStatusDeleted  int16 = 3
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
