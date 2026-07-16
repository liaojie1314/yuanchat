package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
)

// ErrNotMember 用户不是会话成员。
var ErrNotMember = errors.New("not a conversation member")

// SendResult 消息落库后的结果，供 WS 层构造 ack / receive 推送。
type SendResult struct {
	Message        *model.Message
	SenderNickname string
	MemberIDs      []uuid.UUID
}

// MessageService 消息核心服务：发送、历史、已读。
type MessageService struct {
	msgRepo  *repository.MessageRepository
	convRepo *repository.ConversationRepository
	userRepo *repository.UserRepository
	logger   *zap.Logger
}

func NewMessageService(
	msgRepo *repository.MessageRepository,
	convRepo *repository.ConversationRepository,
	userRepo *repository.UserRepository,
	logger *zap.Logger,
) *MessageService {
	return &MessageService{msgRepo: msgRepo, convRepo: convRepo, userRepo: userRepo, logger: logger}
}

// SendText 校验成员身份后持久化文本消息（seq 事务内原子分配）。
func (s *MessageService) SendText(
	ctx context.Context,
	senderID, convID uuid.UUID,
	text, clientMsgID string,
	replyTo *uuid.UUID,
) (*SendResult, error) {
	ok, err := s.convRepo.IsMember(ctx, convID, senderID)
	if err != nil {
		return nil, fmt.Errorf("check membership: %w", err)
	}
	if !ok {
		return nil, ErrNotMember
	}

	content, err := json.Marshal(model.MessageContentText{Text: text})
	if err != nil {
		return nil, fmt.Errorf("marshal content: %w", err)
	}

	msg := &model.Message{
		ConversationID: convID,
		SenderID:       senderID,
		MessageType:    model.MessageTypeText,
		Content:        string(content),
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
	return s.msgRepo.ListBefore(ctx, convID, beforeSeq, limit)
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
