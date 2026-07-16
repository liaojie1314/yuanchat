// Package ws implements the WebSocket gateway: connection lifecycle,
// message envelope protocol, and in-process fan-out to online devices.
package ws

import (
	"encoding/json"

	"github.com/google/uuid"
)

// Envelope 是所有 WebSocket 帧的统一信封结构。
//
// Payload 保持 json.RawMessage，由 type 决定二次解析的目标结构，
// 避免为每种帧定义顶层结构导致字段爆炸。
type Envelope struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// 客户端 → 服务端 帧类型
const (
	TypeMessageSend = "message.send"
	TypeMessageRead = "message.read"
	TypeTyping      = "typing"
)

// 服务端 → 客户端 帧类型
const (
	TypeMessageAck      = "message.ack"
	TypeMessageReceive  = "message.receive"
	TypeError           = "error"
	TypeContactRequest  = "contact.request"
	TypeContactAccepted = "contact.accepted"
)

// UserBrief 联系人相关帧中携带的用户摘要。
type UserBrief struct {
	ID        uuid.UUID `json:"id"`
	Nickname  string    `json:"nickname"`
	AvatarURL *string   `json:"avatar_url,omitempty"`
	ShortID   int64     `json:"short_id"`
}

// ContactRequestPayload 新好友申请推送，推给目标用户的所有设备。
type ContactRequestPayload struct {
	RequestID uuid.UUID `json:"request_id"`
	Requester UserBrief `json:"requester"`
	Message   string    `json:"message,omitempty"`
	CreatedAt int64     `json:"created_at"` // Unix 毫秒
}

// ContactAcceptedPayload 申请被同意推送，推给申请方的所有设备。
type ContactAcceptedPayload struct {
	RequestID      uuid.UUID `json:"request_id"`
	Friend         UserBrief `json:"friend"`
	ConversationID uuid.UUID `json:"conversation_id"`
}

// ContentPayload 是消息体的传输结构（当前仅支持 text）。
type ContentPayload struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// SendPayload 客户端发送消息请求。
type SendPayload struct {
	ConversationID uuid.UUID      `json:"conversation_id"`
	Content        ContentPayload `json:"content"`
	ClientMsgID    string         `json:"client_msg_id"`
	ReplyToID      *uuid.UUID     `json:"reply_to_id,omitempty"`
}

// ReadPayload 客户端上报已读进度（已读到的最大 seq）。
type ReadPayload struct {
	ConversationID uuid.UUID `json:"conversation_id"`
	Seq            int64     `json:"seq"`
}

// TypingPayload 客户端上报正在输入。
type TypingPayload struct {
	ConversationID uuid.UUID `json:"conversation_id"`
}

// AckPayload 发送回执，推给发送者的所有设备。
type AckPayload struct {
	ClientMsgID    string    `json:"client_msg_id"`
	MessageID      uuid.UUID `json:"message_id"`
	ConversationID uuid.UUID `json:"conversation_id"`
	Seq            int64     `json:"seq"`
	Timestamp      int64     `json:"timestamp"` // Unix 毫秒
}

// ReceivePayload 新消息推送，推给会话所有成员（含发送者其他设备）。
// ClientMsgID 供发送者自己的设备与乐观插入的本地消息去重。
type ReceivePayload struct {
	MessageID      uuid.UUID      `json:"message_id"`
	ConversationID uuid.UUID      `json:"conversation_id"`
	SenderID       uuid.UUID      `json:"sender_id"`
	SenderNickname string         `json:"sender_nickname"`
	Content        ContentPayload `json:"content"`
	Seq            int64          `json:"seq"`
	Timestamp      int64          `json:"timestamp"`
	ReplyToID      *uuid.UUID     `json:"reply_to_id,omitempty"`
	ClientMsgID    string         `json:"client_msg_id,omitempty"`
}

// ReadReceiptPayload 已读进度推送，推给会话其他成员。
type ReadReceiptPayload struct {
	ConversationID uuid.UUID `json:"conversation_id"`
	UserID         uuid.UUID `json:"user_id"`
	Seq            int64     `json:"seq"`
}

// TypingEventPayload 正在输入推送，推给会话其他成员。
type TypingEventPayload struct {
	ConversationID uuid.UUID `json:"conversation_id"`
	UserID         uuid.UUID `json:"user_id"`
	Nickname       string    `json:"nickname"`
}

// ErrorPayload 错误帧，ClientMsgID 非空时表示某次发送失败。
type ErrorPayload struct {
	Code        int    `json:"code"`
	Message     string `json:"message"`
	ClientMsgID string `json:"client_msg_id,omitempty"`
}

// Encode 将 type + payload 序列化为一帧完整的 JSON 数据。
func Encode(frameType string, payload any) ([]byte, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return json.Marshal(Envelope{Type: frameType, Payload: raw})
}
