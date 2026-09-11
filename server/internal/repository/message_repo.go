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

// utcTime 把驱动按连接时区（`Asia/Shanghai`）还原出来的时间换算回 UTC。
//
// 时刻本身不变，变的是序列化出来的字面量：不换算的话，同一次编辑在
// message.edited 帧里是 `...Z`（内存值，本就是 UTC），拉历史却是 `...+08:00`，
// 客户端拿字符串比对/去重就会判成两个不同的时间。
func utcTime(t time.Time) time.Time { return t.UTC() }

// utcTimePtr 同 utcTime，针对可空列（edited_at 未编辑过时为 NULL）。
func utcTimePtr(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}

// ListBefore 取会话中 seq < beforeSeq 且 seq > minSeq 的最新 limit 条消息（seq 降序）。
// beforeSeq ≤ 0 表示从最新一条开始取。
// minSeq 为调用方的 cleared_before_seq 水位（0 表示不过滤）；群会话署名用成员 alias 覆盖 nickname。
func (r *MessageRepository) ListBefore(ctx context.Context, convID uuid.UUID, beforeSeq, minSeq int64, limit int) ([]MessageWithSender, error) {
	q := r.db.WithContext(ctx).
		Table("messages m").
		Select(`m.*, COALESCE(NULLIF(cm.alias, ''), u.nickname) AS sender_nickname, u.avatar_url AS sender_avatar_url`).
		Joins("JOIN users u ON u.id = m.sender_id").
		Joins("LEFT JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = m.sender_id").
		Where("m.conversation_id = ? AND m.deleted_at IS NULL", convID)
	if beforeSeq > 0 {
		q = q.Where("m.seq < ?", beforeSeq)
	}
	if minSeq > 0 {
		q = q.Where("m.seq > ?", minSeq)
	}

	var rows []MessageWithSender
	err := q.Order("m.seq DESC").Limit(limit).Scan(&rows).Error
	for i := range rows {
		rows[i].EditedAt = utcTimePtr(rows[i].EditedAt)
	}
	return rows, err
}

// MediaItemWithSender 媒体相册条目：完整消息 + 发送者昵称（群聊取群昵称，与 ListBefore 同口径）。
type MediaItemWithSender struct {
	model.Message
	SenderNickname string `gorm:"column:sender_nickname" json:"sender_nickname"`
}

// ListMedia 拉取会话内指定类型的媒体消息（seq 降序，游标 beforeSeq）。
//
// types 为空表示"无任何媒体类型"，直接返回空且不查库（否则 `IN ()` 是语法错误）。
// beforeSeq ≤ 0 表示从最新一条开始；minSeq 为调用方的 cleared_before_seq 水位（0 不过滤）。
// 与 ListBefore 共用成员署名投影（COALESCE 群昵称），且只回 status=1 的未撤回消息——
// 撤回会把 content 置 '{}'，相册若放行就会渲染出一堆空条目。
func (r *MessageRepository) ListMedia(
	ctx context.Context,
	convID uuid.UUID,
	types []int16,
	beforeSeq, minSeq int64,
	limit int,
) ([]MediaItemWithSender, error) {
	if len(types) == 0 {
		return nil, nil
	}
	q := r.db.WithContext(ctx).
		Table("messages m").
		Select(`m.*, COALESCE(NULLIF(cm.alias, ''), u.nickname) AS sender_nickname`).
		Joins("JOIN users u ON u.id = m.sender_id").
		Joins("LEFT JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = m.sender_id").
		Where("m.conversation_id = ? AND m.deleted_at IS NULL AND m.status = ? AND m.message_type IN ?",
			convID, model.MessageStatusNormal, types)
	if beforeSeq > 0 {
		q = q.Where("m.seq < ?", beforeSeq)
	}
	if minSeq > 0 {
		q = q.Where("m.seq > ?", minSeq)
	}

	var rows []MediaItemWithSender
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
	msg.EditedAt = utcTimePtr(msg.EditedAt)
	return &msg, err
}

// Recall 将消息置为已撤回并清空内容（仅 normal 状态可翻转，返回是否翻转成功）。
func (r *MessageRepository) Recall(ctx context.Context, id uuid.UUID) (bool, error) {
	res := r.db.WithContext(ctx).Model(&model.Message{}).
		Where("id = ? AND status = ?", id, model.MessageStatusNormal).
		Updates(map[string]any{"status": model.MessageStatusRevoked, "content": "{}"})
	return res.RowsAffected > 0, res.Error
}

// EditWithHistory 在单事务内更新正文并写入编辑历史。
//
// 两步一体：先 CAS 更新 messages，再把旧 content 插入 message_edits
// （version = expectCount+1）。CAS 条件带 edit_count —— 并发双写时只有一方成功，
// 另一方 RowsAffected=0 返回 false 且整事务回滚，历史表不留脏版本。
//
// 顺序上 CAS 必须在插入之前：过期的 expectCount 算出的 version 与已有历史行撞
// (message_id, version) 唯一索引，若先插入，过期编辑会以「唯一键冲突」报错收场，
// 而不是走 false 这条预期分支。唯一索引因此退居第二道防线。
// flagged 只在命中敏感词时置 true，不会把已有的 true 改回 false
// （清标是 admin 的动作，用户不能自助洗白）。
func (r *MessageRepository) EditWithHistory(
	ctx context.Context,
	id uuid.UUID,
	oldContent, newContent string,
	expectCount int16,
	flagged bool,
	editedAt time.Time,
) (bool, error) {
	var flipped bool
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		updates := map[string]any{
			"content":    newContent,
			"edited_at":  editedAt,
			"edit_count": expectCount + 1,
		}
		if flagged {
			updates["flagged"] = true
		}
		res := tx.Model(&model.Message{}).
			Where("id = ? AND status = ? AND edit_count = ?", id, model.MessageStatusNormal, expectCount).
			Updates(updates)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			// CAS 失败：回滚整个事务，历史行不会落库
			flipped = false
			return gorm.ErrRecordNotFound
		}

		// EditedAt 无 gorm default tag 也不属 GORM 自动维护的时间字段，
		// 不显式赋值会把 Go 零值写进 INSERT，库里的 DEFAULT now() 不生效。
		hist := &model.MessageEdit{
			MessageID:  id,
			OldContent: oldContent,
			Version:    expectCount + 1,
			EditedAt:   editedAt,
		}
		if err := tx.Create(hist).Error; err != nil {
			return err
		}
		flipped = true
		return nil
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// CAS 失败是预期分支，不是错误
		return false, nil
	}
	return flipped, err
}

// ListEdits 取一条消息的全部历史版本，按 version 升序。
func (r *MessageRepository) ListEdits(ctx context.Context, messageID uuid.UUID) ([]model.MessageEdit, error) {
	var edits []model.MessageEdit
	err := r.db.WithContext(ctx).
		Where("message_id = ?", messageID).
		Order("version ASC").
		Find(&edits).Error
	for i := range edits {
		edits[i].EditedAt = utcTime(edits[i].EditedAt)
	}
	return edits, err
}

// GetLastMessage 取会话最后一条消息（会话列表预览用）。
// minSeq 为调用方的 cleared_before_seq 水位：清空后列表预览同步失效（0 表示不过滤）。
func (r *MessageRepository) GetLastMessage(ctx context.Context, convID uuid.UUID, minSeq int64) (*MessageWithSender, error) {
	rows, err := r.ListBefore(ctx, convID, 0, minSeq, 1)
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
	for i := range rows {
		rows[i].EditedAt = utcTimePtr(rows[i].EditedAt)
	}
	return rows, err
}
