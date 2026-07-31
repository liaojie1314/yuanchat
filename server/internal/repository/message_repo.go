package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
)

// MessageWithSender 消息 + 发送者昵称/头像的投影结果。
type MessageWithSender struct {
	model.Message
	SenderNickname  string  `json:"sender_nickname"`
	SenderAvatarURL *string `json:"sender_avatar_url"`
	// Reactions 表情回应聚合（service 层 GetHistory 回填，非查询列）
	Reactions []ReactionAgg `json:"reactions,omitempty" gorm:"-"`
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

// FindByID 按 ID 查消息（含软删过滤），不存在返回 nil。
func (r *MessageRepository) FindByID(ctx context.Context, id uuid.UUID) (*model.Message, error) {
	var msg model.Message
	err := r.db.WithContext(ctx).First(&msg, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &msg, err
}

// Recall 将消息置为已撤回并清空内容（仅 normal 状态可翻转，返回是否翻转成功）。
func (r *MessageRepository) Recall(ctx context.Context, id uuid.UUID) (bool, error) {
	res := r.db.WithContext(ctx).Model(&model.Message{}).
		Where("id = ? AND status = ?", id, model.MessageStatusNormal).
		Updates(map[string]any{"status": model.MessageStatusRevoked, "content": "{}"})
	return res.RowsAffected > 0, res.Error
}

// GetLastMessage 取会话最后一条消息（会话列表预览用）。
func (r *MessageRepository) GetLastMessage(ctx context.Context, convID uuid.UUID) (*MessageWithSender, error) {
	rows, err := r.ListBefore(ctx, convID, 0, 1)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return &rows[0], nil
}

// SearchResult 全文搜索命中消息（含会话名）。
type SearchResult struct {
	MessageWithSender
	ConvName string `json:"conv_name" gorm:"column:conv_name"`
}

// Search 按关键词搜索当前用户有权访问的消息文本（pg_trgm GIN 加速）。
// convID 非 nil 时限定在单个会话内。
// beforeTime 为翻页游标（created_at < beforeTime），nil 表示从最新开始。
// 最少 3 个字符时才命中 GIN 索引；更短时后端拒绝（service 层校验）。
func (r *MessageRepository) Search(
	ctx context.Context,
	userID uuid.UUID,
	query string,
	convID *uuid.UUID,
	beforeTime *time.Time,
	limit int,
) ([]SearchResult, error) {
	q := r.db.WithContext(ctx).
		Table("messages m").
		Select("m.*, u.nickname AS sender_nickname, u.avatar_url AS sender_avatar_url, c.name AS conv_name").
		Joins("JOIN users u ON u.id = m.sender_id").
		Joins("JOIN conversations c ON c.id = m.conversation_id").
		Joins("JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?", userID).
		Where("m.deleted_at IS NULL AND m.status = ?", model.MessageStatusNormal).
		// 端到端加密消息服务端无法解读，显式排除（其 content 本就无 text 字段，
		// 此处是防御性声明：内容结构若变化也不会意外把密文纳入检索）
		Where("m.message_type != ?", model.MessageTypeE2EE).
		Where("(m.content->>'text') ILIKE ?", "%"+query+"%")

	if convID != nil {
		q = q.Where("m.conversation_id = ?", *convID)
	}
	if beforeTime != nil {
		q = q.Where("m.created_at < ?", *beforeTime)
	}

	var rows []SearchResult
	err := q.Order("m.created_at DESC").Limit(limit).Scan(&rows).Error
	return rows, err
}
