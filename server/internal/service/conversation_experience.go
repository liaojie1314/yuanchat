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
//
// last_read_seq 同步推进到同一水位：否则 unread_count（last_seq - last_read_seq）
// 仍会计入已被过滤掉、再也拉不回来的旧消息，导致列表显示未读却点进去空消息流。
// mention_unread 一并清除：与 UpdateLastReadSeq 保持同一不变量——推进已读进度必须清 @ 标记，
// 否则被 @ 的那条消息已被水位过滤掉，前端「[@我]」高亮将永久悬挂且无法自愈
// （清空后 my_last_read_seq == last_seq，前端不再上报 message.read）。
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
	// cleared_before_seq < ? 门闩天然幂等：重复清空不产生写入，也不会回退已有进度
	return s.convRepo.DB().WithContext(ctx).
		Model(&model.ConversationMember{}).
		Where("conversation_id = ? AND user_id = ? AND cleared_before_seq < ?", convID, userID, conv.LastSeq).
		Updates(map[string]any{
			"cleared_before_seq": conv.LastSeq,
			"last_read_seq":      conv.LastSeq,
			"mention_unread":     false,
		}).Error
}

// UpdateAnnouncement 更新群公告（role >= Admin）。空文案 = 清除公告。
// 事务内写 announcement + announcement_updated_at 并落系统消息，返回供 handler 推 WS。
func (s *ConversationService) UpdateAnnouncement(
	ctx context.Context, operatorID, convID uuid.UUID, text string,
) (*GroupOpResult, *string, *time.Time, error) {
	text = strings.TrimSpace(text)
	if len([]rune(text)) > 1000 {
		return nil, nil, nil, ErrInvalidAnnouncement
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
// 上限 30 rune。非群会话 ErrNotGroup，非成员 ErrNotMember。
//
// 群类型守卫不可省：历史署名的 COALESCE 投影不区分会话类型，单聊若能设 alias，
// 会出现历史显示 alias、实时显示本名的同条消息前后不一致。
func (s *ConversationService) UpdateMyAlias(ctx context.Context, userID, convID uuid.UUID, alias string) error {
	alias = strings.TrimSpace(alias)
	if len([]rune(alias)) > 30 {
		return ErrInvalidAlias
	}
	// loadGroupAndRole 一并完成：会话存在、是群聊、本人是成员（任意 role 均可改自己的）
	if _, _, err := s.loadGroupAndRole(ctx, convID, userID); err != nil {
		return err
	}
	// 清除写 SQL NULL 而非空串：与「从未设置」在库里和 JSON 上是同一种状态，
	// 避免成员列表出现 alias 缺省 / alias:"" 两种等价却不同的表示。
	// COALESCE(NULLIF(alias,'')) 对 NULL 与空串都回退本名，两者兼容。
	var value any
	if alias != "" {
		value = alias
	}
	return s.convRepo.UpdateMemberSettings(ctx, convID, userID, map[string]any{"alias": value})
}
