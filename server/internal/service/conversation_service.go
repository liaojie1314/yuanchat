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

// ErrNotAllFriends 建群时存在非发起者好友的成员。
var ErrNotAllFriends = errors.New("some members are not friends")

// ErrNoValidMembers 建群成员去重、剔除发起者后为空或超上限（参数错误）。
var ErrNoValidMembers = errors.New("no valid members")

// ConversationDTO 会话列表条目（REST 响应结构）。
type ConversationDTO struct {
	ID            uuid.UUID       `json:"id"`
	Type          int16           `json:"type"`
	Name          string          `json:"name"`
	AvatarURL     *string         `json:"avatar_url,omitempty"`
	MemberCount   int64           `json:"member_count"`
	UnreadCount   int64           `json:"unread_count"`
	IsMuted       bool            `json:"is_muted"`
	IsPinned      bool            `json:"is_pinned"`
	PinnedAt      *time.Time      `json:"pinned_at,omitempty"`
	LastSeq       int64           `json:"last_seq"`
	MyLastReadSeq int64           `json:"my_last_read_seq"`
	MentionUnread bool            `json:"mention_unread"`
	LastMessage   *LastMessageDTO `json:"last_message,omitempty"`
	Peer          *PeerDTO        `json:"peer,omitempty"`
	UpdatedAt     time.Time       `json:"updated_at"`
}

// LastMessageDTO 会话预览用的最后一条消息摘要。
type LastMessageDTO struct {
	Preview        string    `json:"preview"`
	SenderNickname string    `json:"sender_nickname"`
	CreatedAt      time.Time `json:"created_at"`
}

// PeerDTO 单聊对端用户信息。
type PeerDTO struct {
	ID        uuid.UUID `json:"id"`
	Nickname  string    `json:"nickname"`
	AvatarURL *string   `json:"avatar_url,omitempty"`
}

// ConversationService 会话列表服务。
type ConversationService struct {
	convRepo    *repository.ConversationRepository
	msgRepo     *repository.MessageRepository
	contactRepo *repository.ContactRepository
	userRepo    *repository.UserRepository
	logger      *zap.Logger
}

func NewConversationService(
	convRepo *repository.ConversationRepository,
	msgRepo *repository.MessageRepository,
	contactRepo *repository.ContactRepository,
	userRepo *repository.UserRepository,
	logger *zap.Logger,
) *ConversationService {
	return &ConversationService{
		convRepo:    convRepo,
		msgRepo:     msgRepo,
		contactRepo: contactRepo,
		userRepo:    userRepo,
		logger:      logger,
	}
}

// List 返回用户的会话列表 DTO：
// 未读数 = last_seq - last_read_seq；单聊补对端信息作为显示名。
func (s *ConversationService) List(ctx context.Context, userID uuid.UUID) ([]ConversationDTO, error) {
	items, err := s.convRepo.ListByUserID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list conversations: %w", err)
	}

	dtos := make([]ConversationDTO, 0, len(items))
	for _, item := range items {
		dto := ConversationDTO{
			ID:            item.ID,
			Type:          item.Type,
			MemberCount:   item.MemberCount,
			IsMuted:       item.IsMuted,
			IsPinned:      item.IsPinned,
			PinnedAt:      item.PinnedAt,
			MentionUnread: item.MentionUnread,
			LastSeq:       item.LastSeq,
			MyLastReadSeq: item.LastReadSeq,
			UnreadCount:   max(item.LastSeq-item.LastReadSeq, 0),
			AvatarURL:     item.AvatarURL,
			UpdatedAt:     item.UpdatedAt,
		}
		if item.Name != nil {
			dto.Name = *item.Name
		}

		// 单聊：显示名/头像取对端用户
		if item.Type == model.ConversationTypePrivate {
			peer, err := s.convRepo.GetPeerUser(ctx, item.ID, userID)
			if err != nil {
				s.logger.Warn("load peer failed", zap.Error(err), zap.String("conv_id", item.ID.String()))
			} else if peer != nil {
				dto.Peer = &PeerDTO{ID: peer.ID, Nickname: peer.Nickname, AvatarURL: peer.AvatarURL}
				if dto.Name == "" {
					dto.Name = peer.Nickname
				}
				if dto.AvatarURL == nil {
					dto.AvatarURL = peer.AvatarURL
				}
			}
		}

		if last, err := s.msgRepo.GetLastMessage(ctx, item.ID, item.ClearedBeforeSeq); err == nil && last != nil {
			dto.LastMessage = &LastMessageDTO{
				Preview:        previewOf(last),
				SenderNickname: last.SenderNickname,
				CreatedAt:      last.CreatedAt,
			}
		}

		dtos = append(dtos, dto)
	}
	return dtos, nil
}

// previewOf 将消息内容压缩为列表预览文案。
func previewOf(m *repository.MessageWithSender) string {
	switch m.MessageType {
	case model.MessageTypeText:
		var c model.MessageContentText
		if err := json.Unmarshal([]byte(m.Content), &c); err == nil {
			return c.Text
		}
		return ""
	case model.MessageTypeImage:
		return "[图片]"
	case model.MessageTypeFile:
		return "[文件]"
	case model.MessageTypeVoice:
		return "[语音]"
	case model.MessageTypeVideo:
		return "[视频]"
	default:
		return ""
	}
}

// Members 校验成员身份后返回会话成员列表（owner 在前）。
func (s *ConversationService) Members(ctx context.Context, userID, convID uuid.UUID) ([]repository.MemberWithUser, error) {
	ok, err := s.convRepo.IsMember(ctx, convID, userID)
	if err != nil {
		return nil, fmt.Errorf("check membership: %w", err)
	}
	if !ok {
		return nil, ErrNotMember
	}
	return s.convRepo.ListMembers(ctx, convID)
}

// CreateGroup 创建群聊会话。事务内原子完成：
//
//  1. 建群会话（type=group）
//  2. 全员成员行（发起者 owner，其余 normal）
//  3. 系统消息「X 创建了群聊」（发起者身份，复用 CreateWithSeq，tx 内为 savepoint）
//     并推进发起者已读进度（自己触发的系统消息不计未读）
//
// 前置校验：发起者须与全部成员为好友，否则返回 ErrNotAllFriends。
// 返回值：会话 DTO（发起者视角）、全员 ID（供 handler 推送 conversation.created）。
func (s *ConversationService) CreateGroup(
	ctx context.Context,
	creatorID uuid.UUID,
	name *string,
	memberIDs []uuid.UUID,
) (*ConversationDTO, []uuid.UUID, error) {
	// 1. 去重 memberIDs 并剔除发起者自身
	seen := map[uuid.UUID]struct{}{creatorID: {}}
	members := make([]uuid.UUID, 0, len(memberIDs))
	for _, id := range memberIDs {
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		members = append(members, id)
	}
	if len(members) == 0 || len(members) > 100 {
		return nil, nil, ErrNoValidMembers
	}

	// 2. 全部成员须为发起者好友
	for _, id := range members {
		ok, err := s.contactRepo.IsFriend(ctx, creatorID, id)
		if err != nil {
			return nil, nil, fmt.Errorf("check friendship: %w", err)
		}
		if !ok {
			return nil, nil, ErrNotAllFriends
		}
	}

	creator, err := s.userRepo.FindByID(ctx, creatorID)
	if err != nil || creator == nil {
		return nil, nil, fmt.Errorf("load creator: %w", err)
	}

	// 3. 群名缺省：发起者 + 前 2 名成员昵称逗号拼接，超 100 字截断
	groupName := ""
	if name != nil {
		groupName = strings.TrimSpace(*name)
	}
	if groupName == "" {
		groupName = s.defaultGroupName(ctx, creator.Nickname, members)
	}

	allMembers := append([]uuid.UUID{creatorID}, members...)
	systemText := fmt.Sprintf("%s 创建了群聊", creator.Nickname)

	var conv model.Conversation
	var sysMsg model.Message

	err = s.convRepo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 3.1 建群会话
		conv = model.Conversation{Type: model.ConversationTypeGroup, Name: strPtr(groupName)}
		if err := tx.Create(&conv).Error; err != nil {
			return err
		}

		// 3.2 全员成员行（发起者 owner，其余 normal）
		for _, uid := range allMembers {
			role := model.MemberRoleNormal
			if uid == creatorID {
				role = model.MemberRoleOwner
			}
			member := &model.ConversationMember{
				ConversationID: conv.ID,
				UserID:         uid,
				Role:           role,
				JoinedAt:       time.Now(),
			}
			if err := tx.Create(member).Error; err != nil {
				return err
			}
		}

		// 3.3 系统消息（发起者身份；CreateWithSeq 在 tx 内成为 savepoint）
		content, err := json.Marshal(model.MessageContentText{Text: systemText})
		if err != nil {
			return err
		}
		sysMsg = model.Message{
			ConversationID: conv.ID,
			SenderID:       creatorID,
			MessageType:    model.MessageTypeSystem,
			Content:        string(content),
			Status:         model.MessageStatusNormal,
		}
		if err := repository.NewMessageRepository(tx).CreateWithSeq(ctx, &sysMsg); err != nil {
			return err
		}

		// 3.4 发起者已读进度推进到系统消息 seq（自己建群不计未读）
		return tx.Model(&model.ConversationMember{}).
			Where("conversation_id = ? AND user_id = ? AND last_read_seq < ?", conv.ID, creatorID, sysMsg.Seq).
			Update("last_read_seq", sysMsg.Seq).Error
	})
	if err != nil {
		return nil, nil, fmt.Errorf("create group: %w", err)
	}

	// 4. 事务外组装 DTO（发起者视角：已读到系统消息，未读为 0）
	dto := &ConversationDTO{
		ID:            conv.ID,
		Type:          conv.Type,
		Name:          groupName,
		MemberCount:   int64(len(allMembers)),
		UnreadCount:   0,
		LastSeq:       sysMsg.Seq,
		MyLastReadSeq: sysMsg.Seq,
		LastMessage: &LastMessageDTO{
			Preview:        systemText,
			SenderNickname: creator.Nickname,
			CreatedAt:      sysMsg.CreatedAt,
		},
		UpdatedAt: sysMsg.CreatedAt,
	}

	s.logger.Info("group conversation created",
		zap.String("conversation_id", conv.ID.String()),
		zap.String("creator_id", creatorID.String()),
		zap.Int("member_count", len(allMembers)))
	return dto, allMembers, nil
}

// defaultGroupName 缺省群名：发起者 + 前 2 名成员昵称逗号拼接，rune 数超 100 截断。
func (s *ConversationService) defaultGroupName(ctx context.Context, creatorNick string, members []uuid.UUID) string {
	names := []string{creatorNick}
	for _, id := range members {
		if len(names) >= 3 {
			break
		}
		u, err := s.userRepo.FindByID(ctx, id)
		if err != nil || u == nil {
			continue
		}
		names = append(names, u.Nickname)
	}
	name := strings.Join(names, "、")
	if r := []rune(name); len(r) > 100 {
		name = string(r[:100])
	}
	return name
}

// ConversationSettingsInput 会话个人设置变更（nil 字段表示不修改）。
type ConversationSettingsInput struct {
	IsPinned *bool
	IsMuted  *bool
}

// ConversationSettingsResult 变更后的最新设置值（含未变更字段的当前值）。
type ConversationSettingsResult struct {
	IsPinned bool
	PinnedAt *time.Time
	IsMuted  bool
}

// UpdateSettings 更新本人在会话中的置顶/免打扰设置（member 维度）。
//
// 置顶语义：false→true 时落 pinned_at=now；重复置顶不刷新（置顶顺序稳定）；
// 取消置顶清空 pinned_at。非成员返回 ErrNotMember（handler 映射 403）。
func (s *ConversationService) UpdateSettings(
	ctx context.Context, userID, convID uuid.UUID, in ConversationSettingsInput,
) (*ConversationSettingsResult, error) {
	member, found, err := s.convRepo.GetMember(ctx, convID, userID)
	if err != nil {
		return nil, fmt.Errorf("load member: %w", err)
	}
	if !found {
		return nil, ErrNotMember
	}

	res := &ConversationSettingsResult{
		IsPinned: member.IsPinned, PinnedAt: member.PinnedAt, IsMuted: member.IsMuted,
	}
	updates := map[string]any{}
	if in.IsPinned != nil && *in.IsPinned != member.IsPinned {
		updates["is_pinned"] = *in.IsPinned
		if *in.IsPinned {
			// 截断到微秒与 Postgres timestamptz 精度对齐：
			// 保证本次返回的 pinned_at 与后续读回的值严格相等（前端按其排序）
			now := time.Now().Truncate(time.Microsecond)
			updates["pinned_at"] = now
			res.PinnedAt = &now
		} else {
			updates["pinned_at"] = nil
			res.PinnedAt = nil
		}
		res.IsPinned = *in.IsPinned
	}
	if in.IsMuted != nil && *in.IsMuted != member.IsMuted {
		updates["is_muted"] = *in.IsMuted
		res.IsMuted = *in.IsMuted
	}
	if len(updates) == 0 {
		return res, nil // 幂等：无实际变化不写库
	}
	if err := s.convRepo.UpdateMemberSettings(ctx, convID, userID, updates); err != nil {
		return nil, fmt.Errorf("update settings: %w", err)
	}
	return res, nil
}
