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
	"gorm.io/gorm"
)

// 群管理操作错误（handler 据此映射 400/403/404）。
var (
	ErrConversationNotFound = errors.New("conversation not found")
	ErrNotGroup             = errors.New("not a group conversation")
	ErrForbidden            = errors.New("operation not allowed for this role")
	ErrOwnerCannotLeave     = errors.New("owner cannot leave the group")
	ErrGroupMemberNotFound  = errors.New("member not found")
	ErrInvalidName          = errors.New("invalid group name")
	ErrAlreadyAdmin         = errors.New("member is already an admin")
	ErrNotAdmin             = errors.New("member is not an admin")
	ErrCannotTransferToSelf = errors.New("cannot transfer ownership to yourself")
)

// RoleChange 单个成员的角色变更（handler 组 conversation.role_changed 帧用）。
type RoleChange struct {
	UserID  uuid.UUID
	NewRole int16
}

// GroupOpResult 群管理操作结果，供 handler 组帧推送。
type GroupOpResult struct {
	SysMsg       *model.Message   // 已落库的系统消息（解散时为 nil）
	SysText      string           // 系统消息文本（列表预览/receive 帧用）
	MemberIDs    []uuid.UUID      // 操作后仍在群内的全部成员
	RemovedID    uuid.UUID        // 被踢/退群者（其余操作为 uuid.Nil）
	NewMemberIDs []uuid.UUID      // 邀请新入群者
	NewMemberDTO *ConversationDTO // 新成员视角会话 DTO（仅邀请）
	RoleChanges  []RoleChange     // 任命/免除/转让引发的角色变更
	MemberCount  int64
	Name         string // 操作后群名
}

// loadGroupAndRole 校验会话存在且为群聊，返回会话与操作者角色。
func (s *ConversationService) loadGroupAndRole(ctx context.Context, convID, operatorID uuid.UUID) (*model.Conversation, int16, error) {
	conv, err := s.convRepo.FindByID(ctx, convID)
	if err != nil {
		return nil, 0, fmt.Errorf("find conversation: %w", err)
	}
	if conv == nil {
		return nil, 0, ErrConversationNotFound
	}
	if conv.Type != model.ConversationTypeGroup {
		return nil, 0, ErrNotGroup
	}
	role, ok, err := s.convRepo.GetMemberRole(ctx, convID, operatorID)
	if err != nil {
		return nil, 0, fmt.Errorf("get member role: %w", err)
	}
	if !ok {
		return nil, 0, ErrNotMember
	}
	return conv, role, nil
}

// appendSystemMessage 在事务内以 operator 身份落一条系统消息（CreateWithSeq 原子分配 seq）。
func appendSystemMessage(ctx context.Context, tx *gorm.DB, convID, operatorID uuid.UUID, text string) (*model.Message, error) {
	content, err := json.Marshal(model.MessageContentText{Text: text})
	if err != nil {
		return nil, err
	}
	msg := &model.Message{
		ConversationID: convID,
		SenderID:       operatorID,
		MessageType:    model.MessageTypeSystem,
		Content:        string(content),
		Status:         model.MessageStatusNormal,
	}
	return msg, repository.NewMessageRepository(tx).CreateWithSeq(ctx, msg)
}

// nicknameOf 查用户昵称（查询失败回退空串，仅用于系统消息文案）。
func (s *ConversationService) nicknameOf(ctx context.Context, userID uuid.UUID) string {
	u, err := s.userRepo.FindByID(ctx, userID)
	if err != nil || u == nil {
		return ""
	}
	return u.Nickname
}

// RenameGroup 修改群名（role ≥ Admin），落系统消息并返回全员 ID。
func (s *ConversationService) RenameGroup(ctx context.Context, operatorID, convID uuid.UUID, name string) (*GroupOpResult, error) {
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 100 {
		return nil, ErrInvalidName
	}
	_, role, err := s.loadGroupAndRole(ctx, convID, operatorID)
	if err != nil {
		return nil, err
	}
	if role < model.MemberRoleAdmin {
		return nil, ErrForbidden
	}

	sysText := fmt.Sprintf("%s 修改群名为「%s」", s.nicknameOf(ctx, operatorID), name)
	var sysMsg *model.Message
	err = s.convRepo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.Conversation{}).Where("id = ?", convID).Update("name", name).Error; err != nil {
			return err
		}
		sysMsg, err = appendSystemMessage(ctx, tx, convID, operatorID, sysText)
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("rename group: %w", err)
	}

	memberIDs, err := s.convRepo.GetMemberIDs(ctx, convID)
	if err != nil {
		return nil, fmt.Errorf("load members: %w", err)
	}
	// 群名敏感词打标：命中照常改名，仅记入审核队列
	if s.moderation != nil && s.ugcRepo != nil {
		if hit := s.moderation.Check(name); hit != "" {
			s.flagUGC(ctx, model.UGCTypeGroupName, name, hit, operatorID, convID)
		}
	}
	s.logger.Info("group renamed", zap.String("conversation_id", convID.String()), zap.String("name", name))
	return &GroupOpResult{
		SysMsg:      sysMsg,
		SysText:     sysText,
		MemberIDs:   memberIDs,
		MemberCount: int64(len(memberIDs)),
		Name:        name,
	}, nil
}

// InviteMembers 邀请好友入群（任意成员可操作，被邀请者须为操作者好友）。
// 新成员 last_read_seq = 邀请前 last_seq → 只有邀请系统消息 1 条未读。
func (s *ConversationService) InviteMembers(ctx context.Context, operatorID, convID uuid.UUID, memberIDs []uuid.UUID) (*GroupOpResult, error) {
	conv, _, err := s.loadGroupAndRole(ctx, convID, operatorID)
	if err != nil {
		return nil, err
	}

	existing, err := s.convRepo.GetMemberIDs(ctx, convID)
	if err != nil {
		return nil, fmt.Errorf("load members: %w", err)
	}
	inGroup := make(map[uuid.UUID]struct{}, len(existing))
	for _, id := range existing {
		inGroup[id] = struct{}{}
	}

	// 去重 + 剔除已在群成员
	seen := map[uuid.UUID]struct{}{}
	newbies := make([]uuid.UUID, 0, len(memberIDs))
	for _, id := range memberIDs {
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		if _, in := inGroup[id]; in {
			continue
		}
		newbies = append(newbies, id)
	}
	if len(newbies) == 0 || int64(len(newbies))+int64(len(existing)) > 100 {
		return nil, ErrNoValidMembers
	}

	for _, id := range newbies {
		ok, err := s.contactRepo.IsFriend(ctx, operatorID, id)
		if err != nil {
			return nil, fmt.Errorf("check friendship: %w", err)
		}
		if !ok {
			return nil, ErrNotAllFriends
		}
	}

	// 系统消息文案：新成员昵称「、」拼接
	names := make([]string, 0, len(newbies))
	for _, id := range newbies {
		if n := s.nicknameOf(ctx, id); n != "" {
			names = append(names, n)
		}
	}
	sysText := fmt.Sprintf("%s 邀请 %s 加入了群聊", s.nicknameOf(ctx, operatorID), strings.Join(names, "、"))

	seqBefore := conv.LastSeq
	var sysMsg *model.Message
	err = s.convRepo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, uid := range newbies {
			member := &model.ConversationMember{
				ConversationID: convID,
				UserID:         uid,
				Role:           model.MemberRoleNormal,
				JoinedAt:       time.Now(),
				LastReadSeq:    seqBefore,
			}
			if err := tx.Create(member).Error; err != nil {
				return err
			}
		}
		sysMsg, err = appendSystemMessage(ctx, tx, convID, operatorID, sysText)
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("invite members: %w", err)
	}

	total := int64(len(existing) + len(newbies))
	groupName := ""
	if conv.Name != nil {
		groupName = *conv.Name
	}
	newDTO := &ConversationDTO{
		ID:            convID,
		Type:          model.ConversationTypeGroup,
		Name:          groupName,
		AvatarURL:     conv.AvatarURL,
		MemberCount:   total,
		UnreadCount:   1,
		LastSeq:       sysMsg.Seq,
		MyLastReadSeq: sysMsg.Seq - 1,
		LastMessage: &LastMessageDTO{
			Preview:        sysText,
			SenderNickname: s.nicknameOf(ctx, operatorID),
			CreatedAt:      sysMsg.CreatedAt,
		},
		UpdatedAt: sysMsg.CreatedAt,
	}

	allNow := append(append([]uuid.UUID{}, existing...), newbies...)
	s.logger.Info("group members invited",
		zap.String("conversation_id", convID.String()),
		zap.Int("new_members", len(newbies)))
	return &GroupOpResult{
		SysMsg:       sysMsg,
		SysText:      sysText,
		MemberIDs:    allNow,
		NewMemberIDs: newbies,
		NewMemberDTO: newDTO,
		MemberCount:  total,
		Name:         groupName,
	}, nil
}

// KickMember 移出成员（操作者 role 须大于目标 role；无人可踢群主）。
func (s *ConversationService) KickMember(ctx context.Context, operatorID, convID, targetID uuid.UUID) (*GroupOpResult, error) {
	_, operatorRole, err := s.loadGroupAndRole(ctx, convID, operatorID)
	if err != nil {
		return nil, err
	}
	targetRole, ok, err := s.convRepo.GetMemberRole(ctx, convID, targetID)
	if err != nil {
		return nil, fmt.Errorf("get target role: %w", err)
	}
	if !ok {
		return nil, ErrGroupMemberNotFound
	}
	if operatorRole <= targetRole {
		return nil, ErrForbidden
	}

	sysText := fmt.Sprintf("%s 将 %s 移出了群聊", s.nicknameOf(ctx, operatorID), s.nicknameOf(ctx, targetID))
	var sysMsg *model.Message
	err = s.convRepo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("conversation_id = ? AND user_id = ?", convID, targetID).
			Delete(&model.ConversationMember{}).Error; err != nil {
			return err
		}
		sysMsg, err = appendSystemMessage(ctx, tx, convID, operatorID, sysText)
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("kick member: %w", err)
	}

	memberIDs, err := s.convRepo.GetMemberIDs(ctx, convID)
	if err != nil {
		return nil, fmt.Errorf("load members: %w", err)
	}
	s.logger.Info("group member kicked",
		zap.String("conversation_id", convID.String()),
		zap.String("target_id", targetID.String()))
	return &GroupOpResult{
		SysMsg:      sysMsg,
		SysText:     sysText,
		MemberIDs:   memberIDs,
		RemovedID:   targetID,
		MemberCount: int64(len(memberIDs)),
	}, nil
}

// LeaveGroup 退群（群主不可退，需先转让或解散）。
func (s *ConversationService) LeaveGroup(ctx context.Context, operatorID, convID uuid.UUID) (*GroupOpResult, error) {
	_, role, err := s.loadGroupAndRole(ctx, convID, operatorID)
	if err != nil {
		return nil, err
	}
	if role == model.MemberRoleOwner {
		return nil, ErrOwnerCannotLeave
	}

	sysText := fmt.Sprintf("%s 退出了群聊", s.nicknameOf(ctx, operatorID))
	var sysMsg *model.Message
	err = s.convRepo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("conversation_id = ? AND user_id = ?", convID, operatorID).
			Delete(&model.ConversationMember{}).Error; err != nil {
			return err
		}
		sysMsg, err = appendSystemMessage(ctx, tx, convID, operatorID, sysText)
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("leave group: %w", err)
	}

	memberIDs, err := s.convRepo.GetMemberIDs(ctx, convID)
	if err != nil {
		return nil, fmt.Errorf("load members: %w", err)
	}
	s.logger.Info("group member left",
		zap.String("conversation_id", convID.String()),
		zap.String("user_id", operatorID.String()))
	return &GroupOpResult{
		SysMsg:      sysMsg,
		SysText:     sysText,
		MemberIDs:   memberIDs,
		RemovedID:   operatorID,
		MemberCount: int64(len(memberIDs)),
	}, nil
}

// DissolveGroup 解散群聊（仅群主）：软删会话，成员行保留（历史可审计）。
// 返回原全员 ID（handler 推 conversation.removed）。
func (s *ConversationService) DissolveGroup(ctx context.Context, operatorID, convID uuid.UUID) ([]uuid.UUID, error) {
	_, role, err := s.loadGroupAndRole(ctx, convID, operatorID)
	if err != nil {
		return nil, err
	}
	if role != model.MemberRoleOwner {
		return nil, ErrForbidden
	}

	memberIDs, err := s.convRepo.GetMemberIDs(ctx, convID)
	if err != nil {
		return nil, fmt.Errorf("load members: %w", err)
	}
	if err := s.convRepo.DB().WithContext(ctx).Delete(&model.Conversation{}, "id = ?", convID).Error; err != nil {
		return nil, fmt.Errorf("dissolve group: %w", err)
	}
	s.logger.Info("group dissolved",
		zap.String("conversation_id", convID.String()),
		zap.String("operator_id", operatorID.String()))
	return memberIDs, nil
}

// requireOwnerAndTarget 校验操作者为群主，返回目标成员当前角色。
func (s *ConversationService) requireOwnerAndTarget(ctx context.Context, operatorID, convID, targetID uuid.UUID) (int16, error) {
	_, role, err := s.loadGroupAndRole(ctx, convID, operatorID)
	if err != nil {
		return 0, err
	}
	if role != model.MemberRoleOwner {
		return 0, ErrForbidden
	}
	targetRole, ok, err := s.convRepo.GetMemberRole(ctx, convID, targetID)
	if err != nil {
		return 0, fmt.Errorf("get target role: %w", err)
	}
	if !ok {
		return 0, ErrGroupMemberNotFound
	}
	return targetRole, nil
}

// finishRoleOp 角色变更共用收尾：事务里更新角色 + 落系统消息，返回组好的结果。
func (s *ConversationService) finishRoleOp(ctx context.Context, convID, operatorID uuid.UUID, sysText string, changes []RoleChange) (*GroupOpResult, error) {
	var sysMsg *model.Message
	err := s.convRepo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, ch := range changes {
			if err := tx.Model(&model.ConversationMember{}).
				Where("conversation_id = ? AND user_id = ?", convID, ch.UserID).
				Update("role", ch.NewRole).Error; err != nil {
				return err
			}
		}
		var err error
		sysMsg, err = appendSystemMessage(ctx, tx, convID, operatorID, sysText)
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("apply role change: %w", err)
	}

	memberIDs, err := s.convRepo.GetMemberIDs(ctx, convID)
	if err != nil {
		return nil, fmt.Errorf("load members: %w", err)
	}
	return &GroupOpResult{
		SysMsg:      sysMsg,
		SysText:     sysText,
		MemberIDs:   memberIDs,
		RoleChanges: changes,
		MemberCount: int64(len(memberIDs)),
	}, nil
}

// AppointAdmin 任命管理员（仅群主；目标须为普通成员）。
func (s *ConversationService) AppointAdmin(ctx context.Context, operatorID, convID, targetID uuid.UUID) (*GroupOpResult, error) {
	targetRole, err := s.requireOwnerAndTarget(ctx, operatorID, convID, targetID)
	if err != nil {
		return nil, err
	}
	if targetRole == model.MemberRoleOwner {
		return nil, ErrForbidden
	}
	if targetRole == model.MemberRoleAdmin {
		return nil, ErrAlreadyAdmin
	}

	sysText := fmt.Sprintf("%s 被任命为管理员", s.nicknameOf(ctx, targetID))
	res, err := s.finishRoleOp(ctx, convID, operatorID, sysText,
		[]RoleChange{{UserID: targetID, NewRole: model.MemberRoleAdmin}})
	if err != nil {
		return nil, err
	}
	s.logger.Info("group admin appointed",
		zap.String("conversation_id", convID.String()),
		zap.String("target_id", targetID.String()))
	return res, nil
}

// RevokeAdmin 免除管理员（仅群主；目标须为管理员）。
func (s *ConversationService) RevokeAdmin(ctx context.Context, operatorID, convID, targetID uuid.UUID) (*GroupOpResult, error) {
	targetRole, err := s.requireOwnerAndTarget(ctx, operatorID, convID, targetID)
	if err != nil {
		return nil, err
	}
	if targetRole != model.MemberRoleAdmin {
		return nil, ErrNotAdmin
	}

	sysText := fmt.Sprintf("%s 被免除管理员", s.nicknameOf(ctx, targetID))
	res, err := s.finishRoleOp(ctx, convID, operatorID, sysText,
		[]RoleChange{{UserID: targetID, NewRole: model.MemberRoleNormal}})
	if err != nil {
		return nil, err
	}
	s.logger.Info("group admin revoked",
		zap.String("conversation_id", convID.String()),
		zap.String("target_id", targetID.String()))
	return res, nil
}

// TransferOwner 转让群主（仅群主）：一个事务里新群主升 owner、原群主降管理员（微信语义）。
func (s *ConversationService) TransferOwner(ctx context.Context, operatorID, convID, newOwnerID uuid.UUID) (*GroupOpResult, error) {
	if operatorID == newOwnerID {
		return nil, ErrCannotTransferToSelf
	}
	if _, err := s.requireOwnerAndTarget(ctx, operatorID, convID, newOwnerID); err != nil {
		return nil, err
	}

	sysText := fmt.Sprintf("群主已由 %s 转让至 %s", s.nicknameOf(ctx, operatorID), s.nicknameOf(ctx, newOwnerID))
	res, err := s.finishRoleOp(ctx, convID, operatorID, sysText, []RoleChange{
		{UserID: newOwnerID, NewRole: model.MemberRoleOwner},
		{UserID: operatorID, NewRole: model.MemberRoleAdmin},
	})
	if err != nil {
		return nil, err
	}
	s.logger.Info("group owner transferred",
		zap.String("conversation_id", convID.String()),
		zap.String("new_owner_id", newOwnerID.String()))
	return res, nil
}
