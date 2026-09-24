package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
)

// ConversationListItem 会话列表查询的投影结果（含聚合字段）。
type ConversationListItem struct {
	model.Conversation
	Role          int16      `json:"role"`
	LastReadSeq   int64      `json:"last_read_seq"`
	IsMuted       bool       `json:"is_muted"`
	IsPinned      bool       `json:"is_pinned"`
	PinnedAt      *time.Time `json:"pinned_at"`
	MentionUnread bool       `json:"mention_unread"`
	// ClearedBeforeSeq 本人的清空水位（列表预览据此过滤已清空的旧消息）。
	ClearedBeforeSeq int64 `json:"cleared_before_seq"`
	MemberCount      int64 `json:"member_count"`
}

// ConversationRepository 处理 conversations / conversation_members 表。
type ConversationRepository struct {
	db *gorm.DB
}

func NewConversationRepository(db *gorm.DB) *ConversationRepository {
	return &ConversationRepository{db: db}
}

// DB 暴露底层连接供 service 层组织跨仓储事务。
func (r *ConversationRepository) DB() *gorm.DB {
	return r.db
}

// ListByUserID 查询用户参与的所有会话，按最近更新排序。
func (r *ConversationRepository) ListByUserID(ctx context.Context, userID uuid.UUID) ([]ConversationListItem, error) {
	var items []ConversationListItem
	err := r.db.WithContext(ctx).
		Table("conversations c").
		Select(`c.*, cm.role, cm.last_read_seq, cm.is_muted, cm.mention_unread,
			cm.is_pinned, cm.pinned_at, cm.cleared_before_seq,
			(SELECT count(*) FROM conversation_members m2 WHERE m2.conversation_id = c.id) AS member_count`).
		Joins("JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?", userID).
		Where("c.deleted_at IS NULL").
		Order("c.updated_at DESC").
		Scan(&items).Error
	return items, err
}

// GetMemberIDs 返回会话全部成员的用户 ID（消息分发目标）。
func (r *ConversationRepository) GetMemberIDs(ctx context.Context, convID uuid.UUID) ([]uuid.UUID, error) {
	var ids []uuid.UUID
	err := r.db.WithContext(ctx).
		Model(&model.ConversationMember{}).
		Where("conversation_id = ?", convID).
		Pluck("user_id", &ids).Error
	return ids, err
}

// IsMember 校验用户是否为会话成员。
func (r *ConversationRepository) IsMember(ctx context.Context, convID, userID uuid.UUID) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&model.ConversationMember{}).
		Where("conversation_id = ? AND user_id = ?", convID, userID).
		Count(&count).Error
	return count > 0, err
}

// GetMemberRole 返回成员角色；非成员返回 (0, false, nil)。
func (r *ConversationRepository) GetMemberRole(ctx context.Context, convID, userID uuid.UUID) (int16, bool, error) {
	var m model.ConversationMember
	err := r.db.WithContext(ctx).
		Where("conversation_id = ? AND user_id = ?", convID, userID).First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	return m.Role, true, nil
}

// FindByID 按 ID 查会话（软删过滤），不存在返回 nil。
func (r *ConversationRepository) FindByID(ctx context.Context, id uuid.UUID) (*model.Conversation, error) {
	var conv model.Conversation
	err := r.db.WithContext(ctx).First(&conv, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &conv, nil
}

// UpdateLastReadSeq 推进成员的已读进度（只前进不后退）；顺带清除 mention_unread。
func (r *ConversationRepository) UpdateLastReadSeq(ctx context.Context, convID, userID uuid.UUID, seq int64) error {
	return r.db.WithContext(ctx).
		Model(&model.ConversationMember{}).
		Where("conversation_id = ? AND user_id = ? AND last_read_seq < ?", convID, userID, seq).
		Updates(map[string]any{"last_read_seq": seq, "mention_unread": false}).Error
}

// SetMentionUnread 将指定成员的 mention_unread 置为 true（仅当当前为 false 时更新，
// 避免因群消息重复触发写热点）。
func (r *ConversationRepository) SetMentionUnread(ctx context.Context, convID uuid.UUID, userIDs []uuid.UUID) error {
	if len(userIDs) == 0 {
		return nil
	}
	return r.db.WithContext(ctx).
		Model(&model.ConversationMember{}).
		Where("conversation_id = ? AND user_id IN ? AND mention_unread = false", convID, userIDs).
		Update("mention_unread", true).Error
}

// GetPeerUser 查询单聊会话中除 userID 外的另一名成员。
func (r *ConversationRepository) GetPeerUser(ctx context.Context, convID, userID uuid.UUID) (*model.User, error) {
	var user model.User
	// 不用表别名：First 会自动追加 ORDER BY users.id，别名会导致 SQL 引用失效
	err := r.db.WithContext(ctx).
		Joins("JOIN conversation_members cm ON cm.user_id = users.id").
		Where("cm.conversation_id = ? AND cm.user_id <> ?", convID, userID).
		First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &user, err
}

// MemberWithUser 群成员投影：成员行 + 用户资料。
// Nickname 为展示名（群内 alias 覆盖用户本名）；Alias 为原始群昵称值，供编辑时回填。
type MemberWithUser struct {
	UserID    uuid.UUID `json:"user_id"`
	Nickname  string    `json:"nickname"`
	AvatarURL *string   `json:"avatar_url"`
	Role      int16     `json:"role"`
	Alias     *string   `json:"alias,omitempty"`
}

// ListMembers 查会话全部成员（owner 在前，其余按昵称升序）。
func (r *ConversationRepository) ListMembers(ctx context.Context, convID uuid.UUID) ([]MemberWithUser, error) {
	var items []MemberWithUser
	err := r.db.WithContext(ctx).
		Table("conversation_members cm").
		Select("cm.user_id, COALESCE(NULLIF(cm.alias, ''), u.nickname) AS nickname, u.avatar_url, cm.role, cm.alias").
		Joins("JOIN users u ON u.id = cm.user_id").
		Where("cm.conversation_id = ?", convID).
		Order("cm.role DESC, u.nickname ASC").
		Scan(&items).Error
	return items, err
}

// GroupAvatarMemberLimit 拼合群头像取用的成员数上限（九宫格）。
const GroupAvatarMemberLimit = 9

// GroupMemberBrief 拼合群头像所需的单个成员信息。
//
// 头像与昵称成对取回：没设头像的成员要靠昵称首字兜底那一格，
// 分两次查会让两个数组的成员次序对不上。
type GroupMemberBrief struct {
	AvatarURL string
	Nickname  string
}

// MemberBriefsByConversation 批量取每个会话的前 GroupAvatarMemberLimit 名成员头像与昵称，
// 顺序与 ListMembers 一致（owner 在前，其余按昵称升序），供会话列表拼合群头像。
//
// 不论传入多少个会话都只发一条查询：窗口函数在库内按会话分区截断，
// 既避免了逐会话查询的 N+1，也避免把大群的全部成员捞回内存再丢掉。
// 未设置头像的成员返回空串占位，保证返回下标与成员次序一一对应。
func (r *ConversationRepository) MemberBriefsByConversation(
	ctx context.Context, convIDs []uuid.UUID,
) (map[uuid.UUID][]GroupMemberBrief, error) {
	out := make(map[uuid.UUID][]GroupMemberBrief, len(convIDs))
	if len(convIDs) == 0 {
		return out, nil
	}
	var rows []struct {
		ConversationID uuid.UUID
		AvatarURL      string
		Nickname       string
	}
	err := r.db.WithContext(ctx).Raw(`
		SELECT conversation_id, avatar_url, nickname FROM (
			SELECT cm.conversation_id,
			       COALESCE(u.avatar_url, '') AS avatar_url,
			       u.nickname AS nickname,
			       row_number() OVER (PARTITION BY cm.conversation_id
			                          ORDER BY cm.role DESC, u.nickname ASC) AS rn
			FROM conversation_members cm
			JOIN users u ON u.id = cm.user_id
			WHERE cm.conversation_id IN ?
		) ranked
		WHERE rn <= ?
		ORDER BY conversation_id, rn`, convIDs, GroupAvatarMemberLimit).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		out[row.ConversationID] = append(out[row.ConversationID],
			GroupMemberBrief{AvatarURL: row.AvatarURL, Nickname: row.Nickname})
	}
	return out, nil
}

// GetMember 返回成员行；非成员返回 (nil, false, nil)。
func (r *ConversationRepository) GetMember(ctx context.Context, convID, userID uuid.UUID) (*model.ConversationMember, bool, error) {
	var m model.ConversationMember
	err := r.db.WithContext(ctx).
		Where("conversation_id = ? AND user_id = ?", convID, userID).First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return &m, true, nil
}

// UpdateMemberSettings 更新成员行的个人设置字段（is_pinned/pinned_at/is_muted）。
func (r *ConversationRepository) UpdateMemberSettings(ctx context.Context, convID, userID uuid.UUID, updates map[string]any) error {
	return r.db.WithContext(ctx).
		Model(&model.ConversationMember{}).
		Where("conversation_id = ? AND user_id = ?", convID, userID).
		Updates(updates).Error
}

// MutedMemberIDs 返回会话中开启免打扰的成员 ID（离线推送过滤用）。
func (r *ConversationRepository) MutedMemberIDs(ctx context.Context, convID uuid.UUID) ([]uuid.UUID, error) {
	var ids []uuid.UUID
	err := r.db.WithContext(ctx).
		Model(&model.ConversationMember{}).
		Where("conversation_id = ? AND is_muted = TRUE", convID).
		Pluck("user_id", &ids).Error
	return ids, err
}
