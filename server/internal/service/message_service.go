package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
)

// ErrNotMember 用户不是会话成员。
var ErrNotMember = errors.New("not a conversation member")

// 撤回相关错误。
var (
	// ErrMessageNotFound 目标消息不存在（或已软删）。
	ErrMessageNotFound = errors.New("message not found")
	// ErrNotSender 撤回者非消息发送者本人。
	ErrNotSender = errors.New("only the sender can recall the message")
	// ErrRecallWindowExpired 已超出可撤回时间窗口。
	ErrRecallWindowExpired = errors.New("recall window expired")
	// ErrInvalidEmoji 回应 emoji 为空或超长。
	ErrInvalidEmoji = errors.New("invalid emoji")
)

// RecallWindow 消息可撤回的时间窗口（自发送起 2 分钟）。
const RecallWindow = 2 * time.Minute

// SendResult 消息落库后的结果，供 WS 层构造 ack / receive 推送。
type SendResult struct {
	Message        *model.Message
	SenderNickname string
	MemberIDs      []uuid.UUID
}

// RecallResult 撤回结果，供 handler 构造 message.recalled 推送。
// Idempotent 为 true 时表示消息已处于撤回态，MemberIDs 为空，handler 跳过推送。
type RecallResult struct {
	Message          *model.Message
	OperatorNickname string
	MemberIDs        []uuid.UUID
	Idempotent       bool
}

// MessageService 消息核心服务：发送、历史、已读、撤回、表情回应。
type MessageService struct {
	msgRepo      *repository.MessageRepository
	convRepo     *repository.ConversationRepository
	userRepo     *repository.UserRepository
	reactionRepo *repository.ReactionRepository
	logger       *zap.Logger
}

func NewMessageService(
	msgRepo *repository.MessageRepository,
	convRepo *repository.ConversationRepository,
	userRepo *repository.UserRepository,
	reactionRepo *repository.ReactionRepository,
	logger *zap.Logger,
) *MessageService {
	return &MessageService{
		msgRepo:      msgRepo,
		convRepo:     convRepo,
		userRepo:     userRepo,
		reactionRepo: reactionRepo,
		logger:       logger,
	}
}

// SendText 校验成员身份后持久化文本消息（seq 事务内原子分配）。
//
// 文本内容序列化为 model.MessageContentText 后委托 SendContent，与图片等类型共用落库/推送骨架。
func (s *MessageService) SendText(
	ctx context.Context,
	senderID, convID uuid.UUID,
	text, clientMsgID string,
	replyTo *uuid.UUID,
) (*SendResult, error) {
	content, err := json.Marshal(model.MessageContentText{Text: text})
	if err != nil {
		return nil, fmt.Errorf("marshal content: %w", err)
	}
	return s.SendContent(ctx, senderID, convID, model.MessageTypeText, string(content), clientMsgID, replyTo)
}

// SendContent 校验成员身份后持久化任意类型消息（content 为已序列化的 JSON 串，seq 事务内原子分配）。
//
// 调用方负责按 messageType 组装并序列化 content（文本、图片等），本方法只保证落库与成员/发送者信息装配一致。
func (s *MessageService) SendContent(
	ctx context.Context,
	senderID, convID uuid.UUID,
	messageType int16,
	contentJSON string,
	clientMsgID string,
	replyTo *uuid.UUID,
) (*SendResult, error) {
	ok, err := s.convRepo.IsMember(ctx, convID, senderID)
	if err != nil {
		return nil, fmt.Errorf("check membership: %w", err)
	}
	if !ok {
		return nil, ErrNotMember
	}

	msg := &model.Message{
		ConversationID: convID,
		SenderID:       senderID,
		MessageType:    messageType,
		Content:        contentJSON,
		Status:         model.MessageStatusNormal,
		ReplyToID:      replyTo,
	}
	if clientMsgID != "" {
		msg.ClientMsgID = &clientMsgID
	}

	if err := s.msgRepo.CreateWithSeq(ctx, msg); err != nil {
		return nil, fmt.Errorf("persist message: %w", err)
	}

	sender, err := s.userRepo.FindByID(ctx, senderID)
	if err != nil || sender == nil {
		return nil, fmt.Errorf("load sender: %w", err)
	}

	memberIDs, err := s.convRepo.GetMemberIDs(ctx, convID)
	if err != nil {
		return nil, fmt.Errorf("load members: %w", err)
	}

	return &SendResult{Message: msg, SenderNickname: sender.Nickname, MemberIDs: memberIDs}, nil
}

// GetHistory 校验成员身份后按 seq 降序分页取历史消息。
// 返回的切片仍为降序，由 handler/前端决定展示顺序。
func (s *MessageService) GetHistory(
	ctx context.Context,
	userID, convID uuid.UUID,
	beforeSeq int64,
	limit int,
) ([]repository.MessageWithSender, error) {
	ok, err := s.convRepo.IsMember(ctx, convID, userID)
	if err != nil {
		return nil, fmt.Errorf("check membership: %w", err)
	}
	if !ok {
		return nil, ErrNotMember
	}

	if limit <= 0 || limit > 100 {
		limit = 30
	}
	messages, err := s.msgRepo.ListBefore(ctx, convID, beforeSeq, limit)
	if err != nil {
		return nil, err
	}

	// 回填表情回应聚合（Mine 相对当前用户）
	if len(messages) > 0 {
		ids := make([]uuid.UUID, 0, len(messages))
		for _, m := range messages {
			ids = append(ids, m.ID)
		}
		aggs, err := s.reactionRepo.AggregateFor(ctx, ids, userID)
		if err != nil {
			s.logger.Warn("load reactions failed", zap.Error(err))
			return messages, nil
		}
		for i := range messages {
			messages[i].Reactions = aggs[messages[i].ID]
		}
	}
	return messages, nil
}

// MarkRead 推进用户已读进度并返回会话成员（供推送已读回执）。
func (s *MessageService) MarkRead(ctx context.Context, userID, convID uuid.UUID, seq int64) ([]uuid.UUID, error) {
	ok, err := s.convRepo.IsMember(ctx, convID, userID)
	if err != nil {
		return nil, fmt.Errorf("check membership: %w", err)
	}
	if !ok {
		return nil, ErrNotMember
	}

	if err := s.convRepo.UpdateLastReadSeq(ctx, convID, userID, seq); err != nil {
		return nil, fmt.Errorf("update read seq: %w", err)
	}
	return s.convRepo.GetMemberIDs(ctx, convID)
}

// TypingTargets 校验成员身份，返回发送者昵称与会话成员（供推送 typing 事件）。
func (s *MessageService) TypingTargets(ctx context.Context, userID, convID uuid.UUID) (string, []uuid.UUID, error) {
	ok, err := s.convRepo.IsMember(ctx, convID, userID)
	if err != nil || !ok {
		return "", nil, ErrNotMember
	}

	user, err := s.userRepo.FindByID(ctx, userID)
	if err != nil || user == nil {
		return "", nil, fmt.Errorf("load user: %w", err)
	}

	memberIDs, err := s.convRepo.GetMemberIDs(ctx, convID)
	if err != nil {
		return "", nil, err
	}
	return user.Nickname, memberIDs, nil
}

// Recall 撤回消息：仅发送者本人、且在 RecallWindow 内可撤回。
//
// 已撤回的消息重复调用视为幂等成功（Idempotent=true，不再推送）。
func (s *MessageService) Recall(ctx context.Context, userID, messageID uuid.UUID) (*RecallResult, error) {
	msg, err := s.msgRepo.FindByID(ctx, messageID)
	if err != nil {
		return nil, fmt.Errorf("find message: %w", err)
	}
	if msg == nil {
		return nil, ErrMessageNotFound
	}
	if msg.SenderID != userID {
		return nil, ErrNotSender
	}

	// 已撤回：幂等返回，不重复推送。
	if msg.Status == model.MessageStatusRevoked {
		return &RecallResult{Message: msg, Idempotent: true}, nil
	}

	if time.Since(msg.CreatedAt) > RecallWindow {
		return nil, ErrRecallWindowExpired
	}

	flipped, err := s.msgRepo.Recall(ctx, messageID)
	if err != nil {
		return nil, fmt.Errorf("recall message: %w", err)
	}
	// 并发下已被撤回（flipped=false）同样按幂等处理，不推送。
	if !flipped {
		return &RecallResult{Message: msg, Idempotent: true}, nil
	}
	msg.Status = model.MessageStatusRevoked
	msg.Content = "{}"

	operator, err := s.userRepo.FindByID(ctx, userID)
	if err != nil || operator == nil {
		return nil, fmt.Errorf("load operator: %w", err)
	}

	memberIDs, err := s.convRepo.GetMemberIDs(ctx, msg.ConversationID)
	if err != nil {
		return nil, fmt.Errorf("load members: %w", err)
	}

	return &RecallResult{
		Message:          msg,
		OperatorNickname: operator.Nickname,
		MemberIDs:        memberIDs,
	}, nil
}

// ReactionResult 表情回应 toggle 结果，供 handler 组帧推送。
type ReactionResult struct {
	Message   *model.Message
	Emoji     string
	Count     int64
	Reacted   bool
	MemberIDs []uuid.UUID
}

// ToggleReaction 切换用户对消息的某个 emoji 回应（有则删、无则加）。
// 已撤回消息视同不存在（不可回应）。
func (s *MessageService) ToggleReaction(ctx context.Context, userID, messageID uuid.UUID, emoji string) (*ReactionResult, error) {
	emoji = strings.TrimSpace(emoji)
	if emoji == "" || len([]rune(emoji)) > 8 {
		return nil, ErrInvalidEmoji
	}

	msg, err := s.msgRepo.FindByID(ctx, messageID)
	if err != nil {
		return nil, fmt.Errorf("find message: %w", err)
	}
	if msg == nil || msg.Status != model.MessageStatusNormal {
		return nil, ErrMessageNotFound
	}

	ok, err := s.convRepo.IsMember(ctx, msg.ConversationID, userID)
	if err != nil {
		return nil, fmt.Errorf("check membership: %w", err)
	}
	if !ok {
		return nil, ErrNotMember
	}

	reacted, count, err := s.reactionRepo.Toggle(ctx, messageID, userID, emoji)
	if err != nil {
		return nil, fmt.Errorf("toggle reaction: %w", err)
	}

	memberIDs, err := s.convRepo.GetMemberIDs(ctx, msg.ConversationID)
	if err != nil {
		return nil, fmt.Errorf("load members: %w", err)
	}

	return &ReactionResult{
		Message:   msg,
		Emoji:     emoji,
		Count:     count,
		Reacted:   reacted,
		MemberIDs: memberIDs,
	}, nil
}
