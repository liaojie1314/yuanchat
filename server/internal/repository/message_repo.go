package repository

import (
	"context"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
)

// MessageWithSender 消息 + 发送者昵称/头像的投影结果。
type MessageWithSender struct {
	model.Message
	SenderNickname  string  `json:"sender_nickname"`
	SenderAvatarURL *string `json:"sender_avatar_url"`
}

// MessageRepository 处理 messages 表。
type MessageRepository struct {
	db *gorm.DB
}

func NewMessageRepository(db *gorm.DB) *MessageRepository {
	return &MessageRepository{db: db}
}

// CreateWithSeq 在单个事务内原子分配 seq、写入消息并更新会话的最后消息指针。
//
// seq 通过 UPDATE ... RETURNING 分配，天然防并发重复；
// conversations.updated_at 同步刷新，保证会话列表排序正确。
func (r *MessageRepository) CreateWithSeq(ctx context.Context, msg *model.Message) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var seq int64
		if err := tx.Raw(
			`UPDATE conversations SET last_seq = last_seq + 1, updated_at = now()
			 WHERE id = ? AND deleted_at IS NULL RETURNING last_seq`,
			msg.ConversationID,
		).Scan(&seq).Error; err != nil {
			return err
		}
		if seq == 0 {
			return gorm.ErrRecordNotFound
		}
		msg.Seq = seq

		if err := tx.Create(msg).Error; err != nil {
			return err
		}

		return tx.Model(&model.Conversation{}).
			Where("id = ?", msg.ConversationID).
			Update("last_message_id", msg.ID).Error
	})
}

// ListBefore 取会话中 seq < beforeSeq 的最新 limit 条消息（seq 降序）。
// beforeSeq ≤ 0 表示从最新一条开始取。
func (r *MessageRepository) ListBefore(ctx context.Context, convID uuid.UUID, beforeSeq int64, limit int) ([]MessageWithSender, error) {
	q := r.db.WithContext(ctx).
		Table("messages m").
		Select("m.*, u.nickname AS sender_nickname, u.avatar_url AS sender_avatar_url").
		Joins("JOIN users u ON u.id = m.sender_id").
		Where("m.conversation_id = ? AND m.deleted_at IS NULL", convID)
	if beforeSeq > 0 {
		q = q.Where("m.seq < ?", beforeSeq)
	}

	var rows []MessageWithSender
	err := q.Order("m.seq DESC").Limit(limit).Scan(&rows).Error
	return rows, err
}

// GetLastMessage 取会话最后一条消息（会话列表预览用）。
func (r *MessageRepository) GetLastMessage(ctx context.Context, convID uuid.UUID) (*MessageWithSender, error) {
	rows, err := r.ListBefore(ctx, convID, 0, 1)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return &rows[0], nil
}
