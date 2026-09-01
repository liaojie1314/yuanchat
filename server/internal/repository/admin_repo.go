package repository

import (
	"context"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
)

// AdminRepository 管理后台数据访问：用户/会话/消息的分页检索、
// 封禁状态变更与审计日志读写。
type AdminRepository struct {
	db *gorm.DB
}

func NewAdminRepository(db *gorm.DB) *AdminRepository {
	return &AdminRepository{db: db}
}

// ---------- 用户 ----------

// SearchUsers 按昵称/手机号/邮箱模糊分页检索用户（含封禁用户）。
// q 为合法 UUID 时同时按用户 ID 精确匹配：管理端从举报等入口深链跳转
// 只带得出目标 ID， fuzzy 条件命中不了主键。
func (r *AdminRepository) SearchUsers(ctx context.Context, q string, offset, limit int) ([]model.User, int64, error) {
	tx := r.db.WithContext(ctx).Model(&model.User{})
	if q != "" {
		like := "%" + q + "%"
		tx = tx.Where("nickname ILIKE ? OR phone LIKE ? OR email ILIKE ?", like, like, like)
		if id, err := uuid.Parse(q); err == nil {
			tx = tx.Or("id = ?", id)
		}
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var users []model.User
	err := tx.Order("created_at DESC").Offset(offset).Limit(limit).Find(&users).Error
	return users, total, err
}

// SetUserStatus 更新用户状态（封禁=2 / 恢复=1）。返回是否命中记录。
func (r *AdminRepository) SetUserStatus(ctx context.Context, userID uuid.UUID, status int16) (bool, error) {
	res := r.db.WithContext(ctx).Model(&model.User{}).
		Where("id = ?", userID).Update("status", status)
	return res.RowsAffected > 0, res.Error
}

// ---------- 会话 ----------

// ConvWithCount 会话及成员数。
type ConvWithCount struct {
	model.Conversation
	MemberCount int64 `json:"member_count"`
}

// SearchConversations 按名称模糊分页检索会话，可按类型过滤（0=全部）。
func (r *AdminRepository) SearchConversations(ctx context.Context, q string, convType int16, offset, limit int) ([]ConvWithCount, int64, error) {
	tx := r.db.WithContext(ctx).Model(&model.Conversation{})
	if q != "" {
		tx = tx.Where("name ILIKE ?", "%"+q+"%")
	}
	if convType > 0 {
		tx = tx.Where("type = ?", convType)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var convs []model.Conversation
	if err := tx.Order("created_at DESC").Offset(offset).Limit(limit).Find(&convs).Error; err != nil {
		return nil, 0, err
	}

	result := make([]ConvWithCount, len(convs))
	for i, cv := range convs {
		result[i] = ConvWithCount{Conversation: cv}
		r.db.WithContext(ctx).Model(&model.ConversationMember{}).
			Where("conversation_id = ?", cv.ID).Count(&result[i].MemberCount)
	}
	return result, total, nil
}

// ---------- 消息 ----------

// AdminMessage 消息及发送者昵称（管理端视图）。
type AdminMessage struct {
	model.Message
	SenderNickname string `json:"sender_nickname"`
}

// SearchMessages 按内容模糊分页检索消息（仅文本类可命中关键词；空 q 列出最新）。
// flaggedOnly=true 时只返回敏感词命中的消息（审核队列）。
func (r *AdminRepository) SearchMessages(ctx context.Context, q string, flaggedOnly bool, offset, limit int) ([]AdminMessage, int64, error) {
	tx := r.db.WithContext(ctx).Model(&model.Message{}).
		Where("messages.deleted_at IS NULL")
	if flaggedOnly {
		tx = tx.Where("messages.flagged = TRUE")
	}
	if q != "" {
		tx = tx.Where("messages.content->>'text' ILIKE ?", "%"+q+"%")
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var msgs []AdminMessage
	err := tx.
		Select("messages.*, users.nickname AS sender_nickname").
		Joins("LEFT JOIN users ON users.id = messages.sender_id").
		Order("messages.created_at DESC").Offset(offset).Limit(limit).
		Scan(&msgs).Error
	return msgs, total, err
}

// FindMessage 按 ID 查一条未删除消息，未命中返回 (nil, nil)。
// 供管理端媒体预览端点定位消息引用的对象键。
func (r *AdminRepository) FindMessage(ctx context.Context, messageID uuid.UUID) (*model.Message, error) {
	var msg model.Message
	err := r.db.WithContext(ctx).First(&msg, "id = ?", messageID).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &msg, nil
}

// DeleteMessage 软删除一条消息（管理员强制删除）。返回是否命中。
func (r *AdminRepository) DeleteMessage(ctx context.Context, messageID uuid.UUID) (bool, error) {
	res := r.db.WithContext(ctx).Delete(&model.Message{}, "id = ?", messageID)
	return res.RowsAffected > 0, res.Error
}

// ClearFlag 清除消息的 flagged 标记（审核通过保留）。返回是否命中。
func (r *AdminRepository) ClearFlag(ctx context.Context, messageID uuid.UUID) (bool, error) {
	res := r.db.WithContext(ctx).Model(&model.Message{}).
		Where("id = ?", messageID).Update("flagged", false)
	return res.RowsAffected > 0, res.Error
}

// TakeDownStickerPack 下架表情包：商城不再展示，已添加者保留（软下架非硬删）。
// 返回是否命中。
func (r *AdminRepository) TakeDownStickerPack(ctx context.Context, packID uuid.UUID) (bool, error) {
	res := r.db.WithContext(ctx).Model(&model.StickerPack{}).
		Where("id = ?", packID).Update("taken_down", true)
	return res.RowsAffected > 0, res.Error
}

// ---------- 表情包 ----------

// UntakeDownStickerPack 恢复表情包上架：清 taken_down 标记，商城重新展示。
// 返回是否命中。
func (r *AdminRepository) UntakeDownStickerPack(ctx context.Context, packID uuid.UUID) (bool, error) {
	res := r.db.WithContext(ctx).Model(&model.StickerPack{}).
		Where("id = ?", packID).Update("taken_down", false)
	return res.RowsAffected > 0, res.Error
}

// SetStickerPackOfficial 设置表情包的官方标识（is_official）。
// 返回是否命中。
func (r *AdminRepository) SetStickerPackOfficial(ctx context.Context, packID uuid.UUID, official bool) (bool, error) {
	res := r.db.WithContext(ctx).Model(&model.StickerPack{}).
		Where("id = ?", packID).Update("is_official", official)
	return res.RowsAffected > 0, res.Error
}

// AdminStickerPack 表情包及发布者昵称、贴纸数（管理端视图）。
type AdminStickerPack struct {
	model.StickerPack
	OwnerName    *string `json:"owner_name"`
	StickerCount int64   `json:"sticker_count"`
}

// SearchStickerPacks 按包名模糊分页检索表情包（空 q 列出最新）。
// flaggedOnly=true 时只返回敏感词命中的包（审核队列）。
func (r *AdminRepository) SearchStickerPacks(ctx context.Context, q string, flaggedOnly bool, offset, limit int) ([]AdminStickerPack, int64, error) {
	tx := r.db.WithContext(ctx).Model(&model.StickerPack{})
	if flaggedOnly {
		tx = tx.Where("sticker_packs.flagged = TRUE")
	}
	if q != "" {
		tx = tx.Where("sticker_packs.name ILIKE ?", "%"+q+"%")
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var packs []AdminStickerPack
	err := tx.
		Select(`sticker_packs.*, users.nickname AS owner_name,
			(SELECT COUNT(*) FROM stickers WHERE stickers.pack_id = sticker_packs.id) AS sticker_count`).
		Joins("LEFT JOIN users ON users.id = sticker_packs.owner_id").
		Order("sticker_packs.created_at DESC").Offset(offset).Limit(limit).
		Scan(&packs).Error
	return packs, total, err
}

// ClearStickerPackFlag 清除表情包的 flagged 标记（审核通过保留）。返回是否命中。
func (r *AdminRepository) ClearStickerPackFlag(ctx context.Context, packID uuid.UUID) (bool, error) {
	res := r.db.WithContext(ctx).Model(&model.StickerPack{}).
		Where("id = ?", packID).Update("flagged", false)
	return res.RowsAffected > 0, res.Error
}

// ---------- 举报 ----------

// CreateReport 写入一条用户举报。
func (r *AdminRepository) CreateReport(ctx context.Context, report *model.Report) error {
	return r.db.WithContext(ctx).Create(report).Error
}

// ReportWithNames 举报及举报人昵称。
type ReportWithNames struct {
	model.Report
	ReporterNickname string `json:"reporter_nickname"`
}

// ListReports 分页列出举报，可按状态过滤（-1=全部）。
func (r *AdminRepository) ListReports(ctx context.Context, status int16, offset, limit int) ([]ReportWithNames, int64, error) {
	tx := r.db.WithContext(ctx).Model(&model.Report{})
	if status >= 0 {
		tx = tx.Where("reports.status = ?", status)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var reports []ReportWithNames
	err := tx.
		Select("reports.*, users.nickname AS reporter_nickname").
		Joins("LEFT JOIN users ON users.id = reports.reporter_id").
		Order("reports.created_at DESC").Offset(offset).Limit(limit).
		Scan(&reports).Error
	return reports, total, err
}

// FindReport 按 ID 查举报。
func (r *AdminRepository) FindReport(ctx context.Context, id uuid.UUID) (*model.Report, error) {
	var report model.Report
	err := r.db.WithContext(ctx).First(&report, "id = ?", id).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &report, nil
}

// UpdateReport 保存举报处理结果。
func (r *AdminRepository) UpdateReport(ctx context.Context, report *model.Report) error {
	return r.db.WithContext(ctx).Save(report).Error
}

// ---------- 审计日志 ----------

// CreateLog 写入一条审计日志。
func (r *AdminRepository) CreateLog(ctx context.Context, log *model.AdminActionLog) error {
	return r.db.WithContext(ctx).Create(log).Error
}

// LogWithActor 审计日志及操作者昵称。
type LogWithActor struct {
	model.AdminActionLog
	ActorNickname string `json:"actor_nickname"`
}

// ListLogs 分页列出审计日志，可按 actor / action 过滤。
func (r *AdminRepository) ListLogs(ctx context.Context, actorID *uuid.UUID, action string, offset, limit int) ([]LogWithActor, int64, error) {
	tx := r.db.WithContext(ctx).Model(&model.AdminActionLog{})
	if actorID != nil {
		tx = tx.Where("admin_action_logs.actor_id = ?", *actorID)
	}
	if action != "" {
		tx = tx.Where("admin_action_logs.action = ?", action)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var logs []LogWithActor
	err := tx.
		Select("admin_action_logs.*, users.nickname AS actor_nickname").
		Joins("LEFT JOIN users ON users.id = admin_action_logs.actor_id").
		Order("admin_action_logs.created_at DESC").Offset(offset).Limit(limit).
		Scan(&logs).Error
	return logs, total, err
}
