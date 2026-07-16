package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
)

// ConversationListItem 会话列表查询的投影结果（含聚合字段）。
type ConversationListItem struct {
	model.Conversation
	Role        int16 `json:"role"`
	LastReadSeq int64 `json:"last_read_seq"`
	IsMuted     bool  `json:"is_muted"`
	MemberCount int64 `json:"member_count"`
}

// ConversationRepository 处理 conversations / conversation_members 表。
type ConversationRepository struct {
	db *gorm.DB
}

func NewConversationRepository(db *gorm.DB) *ConversationRepository {
	return &ConversationRepository{db: db}
}

// ListByUserID 查询用户参与的所有会话，按最近更新排序。
func (r *ConversationRepository) ListByUserID(ctx context.Context, userID uuid.UUID) ([]ConversationListItem, error) {
	var items []ConversationListItem
	err := r.db.WithContext(ctx).
		Table("conversations c").
		Select(`c.*, cm.role, cm.last_read_seq, cm.is_muted,
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

// UpdateLastReadSeq 推进成员的已读进度（只前进不后退）。
func (r *ConversationRepository) UpdateLastReadSeq(ctx context.Context, convID, userID uuid.UUID, seq int64) error {
	return r.db.WithContext(ctx).
		Model(&model.ConversationMember{}).
		Where("conversation_id = ? AND user_id = ? AND last_read_seq < ?", convID, userID, seq).
		Update("last_read_seq", seq).Error
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
