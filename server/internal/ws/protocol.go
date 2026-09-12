// Package ws 实现 WebSocket 网关：连接生命周期、消息信封协议，
// 以及进程内向在线设备的扇出投递。
package ws

import (
	"encoding/json"
	"time"

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
	TypePing        = "ping" // 应用层心跳（客户端探测半开连接；间隔由客户端自适应）

	// ---- 通话信令 ----
	TypeCallInvite = "call.invite"
	TypeCallAnswer = "call.answer"
	TypeCallLeave  = "call.leave"
	// TypeCallSignal 双向同名帧：客户端发出时填 to_conn，服务端转发时改填
	// from_conn / from_user。与既有的 message.read、typing 是同一惯例。
	TypeCallSignal = "call.signal"
)

// 服务端 → 客户端 帧类型
const (
	TypeMessageAck          = "message.ack"
	TypeMessageReceive      = "message.receive"
	TypeError               = "error"
	TypeContactRequest      = "contact.request"
	TypeContactAccepted     = "contact.accepted"
	TypeConversationCreated = "conversation.created"
	TypeMessageRecalled     = "message.recalled"
	TypeMessageEdited       = "message.edited"
	TypeConversationUpdated = "conversation.updated"
	TypeConversationRemoved = "conversation.removed"
	TypeMessageReaction     = "message.reaction"
	TypePresence            = "presence"
	TypeFriendRemoved       = "friend.removed"
	TypeRoleChanged         = "conversation.role_changed"
	TypePong                = "pong" // 应用层心跳响应

	// ---- 通话信令 ----
	TypeCallIncoming = "call.incoming"
	TypeCallState    = "call.state"
	TypeCallEnded    = "call.ended"
)

// FriendRemovedPayload 好友关系解除推送（删好友双向下发）。
// FriendID 为被删好友的用户 ID；接收端据此清理本地联系人 + 隐藏相关单聊会话。
type FriendRemovedPayload struct {
	FriendID uuid.UUID `json:"friend_id"`
}

// PresencePayload 好友上下线推送（推给其在线好友）。
type PresencePayload struct {
	UserID uuid.UUID `json:"user_id"`
	Online bool      `json:"online"`
}

// RoleChangedPayload 群成员角色变更推送（任命/免除/转让，推群内全员）。
// 转让群主会连发两帧：新群主 role=2、原群主 role=1。
type RoleChangedPayload struct {
	ConversationID uuid.UUID `json:"conversation_id"`
	UserID         uuid.UUID `json:"user_id"`
	NewRole        int16     `json:"new_role"`
	ChangedBy      uuid.UUID `json:"changed_by"`
}

// MessageReactionPayload 表情回应变更推送（推会话全员，含操作者多端）。
type MessageReactionPayload struct {
	MessageID      uuid.UUID `json:"message_id"`
	ConversationID uuid.UUID `json:"conversation_id"`
	UserID         uuid.UUID `json:"user_id"`
	Emoji          string    `json:"emoji"`
	Count          int64     `json:"count"`
	Reacted        bool      `json:"reacted"`
}

// ConversationUpdatedPayload 群资料/成员数变更推送（改名/邀请/踢人/退群后刷新列表态）。
// 置顶/免打扰设置变更复用本帧（is_pinned/pinned_at/is_muted 指针字段，仅推本人全部设备）；
// 群公告变更同样复用本帧（announcement/announcement_updated_at，推群内全员）。
type ConversationUpdatedPayload struct {
	ConversationID uuid.UUID  `json:"conversation_id"`
	Name           string     `json:"name,omitempty"`
	MemberCount    int64      `json:"member_count,omitempty"`
	IsPinned       *bool      `json:"is_pinned,omitempty"`
	PinnedAt       *time.Time `json:"pinned_at,omitempty"`
	IsMuted        *bool      `json:"is_muted,omitempty"`
	// Announcement 新公告正文。公告变更帧里恒非 nil（清除公告时为空串），
	// 使接收端能区分「本帧不涉及公告」（字段省略）与「公告被清空」（空串）。
	Announcement *string `json:"announcement,omitempty"`
	// AnnouncementUpdatedAt 公告变更时间。
	AnnouncementUpdatedAt *time.Time `json:"announcement_updated_at,omitempty"`
}

// ConversationRemovedPayload 会话移出列表推送（被踢 / 本人退群多端同步 / 群解散）。
type ConversationRemovedPayload struct {
	ConversationID uuid.UUID `json:"conversation_id"`
	Reason         string    `json:"reason"` // kicked | left | dissolved
}

// ConversationCreatedPayload 新会话创建推送（建群），推给全部成员。
// Conversation 字段为 service.ConversationDTO 的 JSON（避免 ws→service 循环导入，用 any）。
type ConversationCreatedPayload struct {
	Conversation any `json:"conversation"`
}

// MessageRecalledPayload 消息撤回推送，推给会话全部成员。
type MessageRecalledPayload struct {
	MessageID        uuid.UUID `json:"message_id"`
	ConversationID   uuid.UUID `json:"conversation_id"`
	Seq              int64     `json:"seq"`
	OperatorID       uuid.UUID `json:"operator_id"`
	OperatorNickname string    `json:"operator_nickname"`
}

// MessageEditedPayload 消息编辑推送，推给会话全部成员（含操作者自己，实现多端同步）。
//
// 带上编辑后正文而非只给 message_id：省掉收件人一次回查往返，与 message.receive
// 直接下发内容的既有做法一致。E2EE 消息永不进这条路径（Edit 入口已拒）。
type MessageEditedPayload struct {
	MessageID      uuid.UUID `json:"message_id"`
	ConversationID uuid.UUID `json:"conversation_id"`
	Seq            int64     `json:"seq"`
	Text           string    `json:"text"`
	EditedAt       time.Time `json:"edited_at"`
	EditCount      int16     `json:"edit_count"`
}

// UserBrief 联系人相关帧中携带的用户摘要。
type UserBrief struct {
	ID        uuid.UUID `json:"id"`
	Nickname  string    `json:"nickname"`
	AvatarURL *string   `json:"avatar_url,omitempty"`
	ShortID   int64     `json:"short_id"`
}

// CallParticipant 通话房间里的一名参与者。
//
// ConnID 在 state=invited（尚未接听）时为空串：定址依据是连接而不是用户，
// 而被邀请者要到接听的那一刻才确定是哪台设备接的。
type CallParticipant struct {
	UserID    uuid.UUID `json:"user_id"`
	ConnID    string    `json:"conn_id"`
	Nickname  string    `json:"nickname"`
	AvatarURL *string   `json:"avatar_url,omitempty"`
	State     string    `json:"state"` // invited | joined
}

// CallInvitePayload 客户端发起通话。
// 单聊时 InviteeIDs 可省略（服务端取会话另一方）；群聊最多 3 人（房间上限 4）。
type CallInvitePayload struct {
	ConversationID uuid.UUID   `json:"conversation_id"`
	Media          string      `json:"media"` // audio | video
	InviteeIDs     []uuid.UUID `json:"invitee_ids,omitempty"`
}

// CallAnswerPayload 接听或拒绝。群通话的「主动加入」复用 Accept=true。
type CallAnswerPayload struct {
	CallID uuid.UUID `json:"call_id"`
	Accept bool      `json:"accept"`
}

// CallLeavePayload 离开房间（挂断 / 取消 / 退出同一语义）。
type CallLeavePayload struct {
	CallID uuid.UUID `json:"call_id"`
}

// CallSignalPayload SDP / ICE 转发。
//
// Data 保持 json.RawMessage：服务端不理解也不需要理解 WebRTC 协商内容，
// 解析它只会在协议演进时逼服务端跟着改版本。
// 客户端上行填 ToConn，服务端下行填 FromConn / FromUser。
type CallSignalPayload struct {
	CallID   uuid.UUID       `json:"call_id"`
	ToConn   string          `json:"to_conn"`
	FromConn string          `json:"from_conn"`
	FromUser *uuid.UUID      `json:"from_user,omitempty"`
	Data     json.RawMessage `json:"data"`
}

// CallIncomingPayload 来电推送，推给被邀请者的全部设备（全设备振铃）。
type CallIncomingPayload struct {
	CallID         uuid.UUID         `json:"call_id"`
	ConversationID uuid.UUID         `json:"conversation_id"`
	Media          string            `json:"media"`
	Caller         UserBrief         `json:"caller"`
	Participants   []CallParticipant `json:"participants"`
}

// CallStatePayload 房间成员变更推送。
//
// SelfConn 让收帧方认出自己那条连接：mesh 里谁先发 offer，靠 self_conn 与对端
// conn_id 的字典序比较来定 —— 双方结论必然相反，既不会同时 offer 也不会双方都等。
// 推给会话内非参与成员时 SelfConn 为空串（他们只用它渲染「通话中」横幅）。
type CallStatePayload struct {
	CallID         uuid.UUID         `json:"call_id"`
	ConversationID uuid.UUID         `json:"conversation_id"`
	Media          string            `json:"media"`
	State          string            `json:"state"` // ringing | active
	SelfConn       string            `json:"self_conn"`
	Participants   []CallParticipant `json:"participants"`
}

// CallEndedPayload 通话终结推送。Duration 单位秒，未接通时为 0。
type CallEndedPayload struct {
	CallID   uuid.UUID `json:"call_id"`
	Reason   string    `json:"reason"` // completed|rejected|canceled|timeout|busy|failed
	Duration int       `json:"duration"`
}

// CallInfo 通话记录的结构化内容，落进系统消息的 content.call。
//
// 带结构化字段而非只给一句中文：客户端才能按自己的语言渲染
// 「未接来电」/「通话时长 03:24」，否则英/日/韩界面会看到中文。
type CallInfo struct {
	Media    string `json:"media"`  // audio | video
	Result   string `json:"result"` // answered|missed|rejected|canceled|busy
	Duration int    `json:"duration"`
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

// ContentPayload 是消息体的传输结构（text / image / file / voice / video）。
//
// 向后兼容：text 帧只用 Type/Text，其余字段带 omitempty，不会污染文本消息。
type ContentPayload struct {
	Type      string `json:"type"`
	Text      string `json:"text,omitempty"`
	Key       string `json:"key,omitempty"`        // image/file/voice/video: MinIO object key
	Width     int    `json:"width,omitempty"`      // image/video: 像素宽
	Height    int    `json:"height,omitempty"`     // image/video: 像素高
	Size      int64  `json:"size,omitempty"`       // image/file/voice/video: 字节大小
	Name      string `json:"name,omitempty"`       // file/video: 原始文件名（展示用）
	Duration  int    `json:"duration,omitempty"`   // voice/video: 时长（秒）
	StickerID string `json:"sticker_id,omitempty"` // sticker: 贴纸 ID（关联 stickers 表）
	ThumbKey  string `json:"thumb_key,omitempty"`  // video: 缩略图对象键（客户端生成的 JPEG）

	// Call 通话记录（仅 system 消息用）。见 CallInfo 的注释。
	Call *CallInfo `json:"call,omitempty"`

	// ---- e2ee：端到端加密密文（服务端不解析语义，仅原样透传落库）----
	RatchetKey   string `json:"ratchet_key,omitempty"`   // 发送方当前棘轮公钥
	N            *int   `json:"n,omitempty"`             // 链内序号（0 有意义，故用指针区分未传）
	PN           *int   `json:"pn,omitempty"`            // 上一条链长度
	Nonce        string `json:"nonce,omitempty"`         // AES-GCM nonce
	Ciphertext   string `json:"ciphertext,omitempty"`    // 密文
	IdentityKey  string `json:"identity_key,omitempty"`  // 首条消息：发送方身份公钥
	EphemeralKey string `json:"ephemeral_key,omitempty"` // 首条消息：X3DH 临时公钥
	OtkID        *int   `json:"otk_id,omitempty"`        // 首条消息：用掉的一次性预密钥 id
}

// SendPayload 客户端发送消息请求。
type SendPayload struct {
	ConversationID uuid.UUID      `json:"conversation_id"`
	Content        ContentPayload `json:"content"`
	ClientMsgID    string         `json:"client_msg_id"`
	ReplyToID      *uuid.UUID     `json:"reply_to_id,omitempty"`
	Mentions       []uuid.UUID    `json:"mentions,omitempty"`
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
	Mentions       []uuid.UUID    `json:"mentions,omitempty"`
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
