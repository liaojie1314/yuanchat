package service

import (
	"context"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
)

// ClearHistory 单侧清空聊天记录：把本人的 cleared_before_seq 推进到会话当前 last_seq。
// 软清空——不删消息行，对方不受影响；拉历史时 seq <= cleared_before_seq 被过滤。
// 非成员返回 ErrNotMember。水位只前进（防重复清空回退）。
func (s *ConversationService) ClearHistory(ctx context.Context, userID, convID uuid.UUID) error {
	conv, err := s.convRepo.FindByID(ctx, convID)
	if err != nil {
		return err
	}
	if conv == nil {
		return ErrConversationNotFound
	}
	ok, err := s.convRepo.IsMember(ctx, convID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotMember
	}
	return s.convRepo.DB().WithContext(ctx).
		Model(&model.ConversationMember{}).
		Where("conversation_id = ? AND user_id = ? AND cleared_before_seq < ?", convID, userID, conv.LastSeq).
		Update("cleared_before_seq", conv.LastSeq).Error
}
