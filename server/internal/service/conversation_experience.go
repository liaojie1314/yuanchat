package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
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

// UpdateAnnouncement 更新群公告（role >= Admin）。空文案 = 清除公告。
// 事务内写 announcement + announcement_updated_at 并落系统消息，返回供 handler 推 WS。
func (s *ConversationService) UpdateAnnouncement(
	ctx context.Context, operatorID, convID uuid.UUID, text string,
) (*GroupOpResult, *string, *time.Time, error) {
	text = strings.TrimSpace(text)
	if len([]rune(text)) > 1000 {
		return nil, nil, nil, ErrInvalidName
	}
	_, role, err := s.loadGroupAndRole(ctx, convID, operatorID)
	if err != nil {
		return nil, nil, nil, err
	}
	if role < model.MemberRoleAdmin {
		return nil, nil, nil, ErrForbidden
	}

	// 截断到微秒与 Postgres timestamptz 精度对齐：返回值与后续读回的值严格相等
	now := time.Now().Truncate(time.Microsecond)
	var announcement *string
	if text != "" {
		announcement = &text
	}
	var sysText string
	if text == "" {
		sysText = fmt.Sprintf("%s 清空了群公告", s.nicknameOf(ctx, operatorID))
	} else {
		sysText = fmt.Sprintf("%s 更新了群公告", s.nicknameOf(ctx, operatorID))
	}

	var sysMsg *model.Message
	err = s.convRepo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.Conversation{}).Where("id = ?", convID).
			Updates(map[string]any{"announcement": announcement, "announcement_updated_at": now}).Error; err != nil {
			return err
		}
		var e error
		sysMsg, e = appendSystemMessage(ctx, tx, convID, operatorID, sysText)
		return e
	})
	if err != nil {
		return nil, nil, nil, fmt.Errorf("update announcement: %w", err)
	}
	memberIDs, err := s.convRepo.GetMemberIDs(ctx, convID)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("load members: %w", err)
	}
	return &GroupOpResult{SysMsg: sysMsg, SysText: sysText, MemberIDs: memberIDs}, announcement, &now, nil
}

// UpdateMyAlias 设置本人在群内的昵称（任意成员）。空串 = 清除（署名回退本名）。
// 上限 30 rune。非成员 ErrNotMember。
func (s *ConversationService) UpdateMyAlias(ctx context.Context, userID, convID uuid.UUID, alias string) error {
	alias = strings.TrimSpace(alias)
	if len([]rune(alias)) > 30 {
		return ErrInvalidAlias
	}
	ok, err := s.convRepo.IsMember(ctx, convID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotMember
	}
	return s.convRepo.UpdateMemberSettings(ctx, convID, userID, map[string]any{"alias": alias})
}
