package repository

import (
	"context"
	"time"

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

// ClearUserAvatar 清空用户的 avatar_url（管理端重置头像）。返回是否命中记录。
// 对象存储里的旧头像文件不在此处删除：cmd/gc 以数据库引用（含 users.avatar_url）
// 判定对象是否可回收，引用清空后旧头像会经 GC 通道自然回收，无需强删。
func (r *AdminRepository) ClearUserAvatar(ctx context.Context, userID uuid.UUID) (bool, error) {
	res := r.db.WithContext(ctx).Model(&model.User{}).
		Where("id = ?", userID).Update("avatar_url", nil)
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

// DeleteMessage 软删除一条消息（管理员强制删除），并在同一事务里级联删除
// 引用该消息的收藏行：收藏虽是快照设计（用户侧撤回后仍可看），但管理员强制
// 删除代表内容违规，快照不应继续存活。返回是否命中消息。
// HandleReport 的 delete 处置复用本方法，两条 admin 删除路径口径一致。
func (r *AdminRepository) DeleteMessage(ctx context.Context, messageID uuid.UUID) (bool, error) {
	var hit bool
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		res := tx.Delete(&model.Message{}, "id = ?", messageID)
		if res.Error != nil {
			return res.Error
		}
		hit = res.RowsAffected > 0
		if !hit {
			return nil
		}
		// 级联清收藏：无悬挂收藏快照
		return tx.Where("message_id = ?", messageID).Delete(&model.Favorite{}).Error
	})
	return hit, err
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

// ---------- 运营概览统计 ----------

// dayStart 返回本地时区当天零点。统计的「今日」口径以此为准。
func dayStart() time.Time {
	now := time.Now()
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
}

// CountUserStats 统计用户总数、封禁中数量、今日新增与近 7 天新增
// （均按 created_at，COUNT 不取行）。
func (r *AdminRepository) CountUserStats(ctx context.Context) (total, banned, newToday, newWeek int64, err error) {
	today := dayStart()
	week := today.AddDate(0, 0, -6)
	if err = r.db.WithContext(ctx).Model(&model.User{}).Count(&total).Error; err != nil {
		return
	}
	if err = r.db.WithContext(ctx).Model(&model.User{}).Where("status = ?", model.UserStatusDisabled).Count(&banned).Error; err != nil {
		return
	}
	if err = r.db.WithContext(ctx).Model(&model.User{}).Where("created_at >= ?", today).Count(&newToday).Error; err != nil {
		return
	}
	err = r.db.WithContext(ctx).Model(&model.User{}).Where("created_at >= ?", week).Count(&newWeek).Error
	return
}

// CountConversationStats 统计会话总数（COUNT 不取行）。
func (r *AdminRepository) CountConversationStats(ctx context.Context) (total int64, err error) {
	err = r.db.WithContext(ctx).Model(&model.Conversation{}).Count(&total).Error
	return
}

// CountMessageStats 统计消息总数、今日消息数、各消息类型计数与
// 敏感词命中（flagged 未处置）数。消息表可能很大，全部走 COUNT /
// GROUP BY 聚合，不取任何行数据。
func (r *AdminRepository) CountMessageStats(ctx context.Context) (total, today int64, byType map[int16]int64, flagged int64, err error) {
	todayStart := dayStart()
	// 每次查询都从 r.db 重建条件链，避免多条 COUNT 复用同一 Statement 串味
	live := func() *gorm.DB {
		return r.db.WithContext(ctx).Model(&model.Message{}).Where("messages.deleted_at IS NULL")
	}
	if err = live().Count(&total).Error; err != nil {
		return
	}
	if err = live().Where("messages.created_at >= ?", todayStart).Count(&today).Error; err != nil {
		return
	}
	type typeRow struct {
		MessageType int16 `json:"message_type"`
		Count       int64
	}
	var rows []typeRow
	if err = live().
		Select("messages.message_type, COUNT(*) AS count").
		Group("messages.message_type").Scan(&rows).Error; err != nil {
		return
	}
	byType = make(map[int16]int64, len(rows))
	for _, row := range rows {
		byType[row.MessageType] = row.Count
	}
	err = live().Where("messages.flagged = TRUE").Count(&flagged).Error
	return
}

// CountModerationStats 统计治理队列积压：待处理举报（status=pending）、
// 待处理 UGC 命中（handled_at 为空）、已下架表情包数与敏感词打标表情包数。
func (r *AdminRepository) CountModerationStats(ctx context.Context) (pendingReports, pendingUGC, takenDownPacks, flaggedPacks int64, err error) {
	if err = r.db.WithContext(ctx).Model(&model.Report{}).
		Where("reports.status = ?", model.ReportStatusPending).Count(&pendingReports).Error; err != nil {
		return
	}
	if err = r.db.WithContext(ctx).Model(&model.FlaggedUGC{}).
		Where("flagged_ugc.handled_at IS NULL").Count(&pendingUGC).Error; err != nil {
		return
	}
	if err = r.db.WithContext(ctx).Model(&model.StickerPack{}).
		Where("sticker_packs.taken_down = TRUE").Count(&takenDownPacks).Error; err != nil {
		return
	}
	err = r.db.WithContext(ctx).Model(&model.StickerPack{}).
		Where("sticker_packs.flagged = TRUE").Count(&flaggedPacks).Error
	return
}

// CountFriendRequestStats 统计好友申请量：今日与近 7 天（按 created_at）。
func (r *AdminRepository) CountFriendRequestStats(ctx context.Context) (today, week int64, err error) {
	todayStart := dayStart()
	weekStart := todayStart.AddDate(0, 0, -6)
	if err = r.db.WithContext(ctx).Model(&model.FriendRequest{}).
		Where("created_at >= ?", todayStart).Count(&today).Error; err != nil {
		return
	}
	err = r.db.WithContext(ctx).Model(&model.FriendRequest{}).
		Where("created_at >= ?", weekStart).Count(&week).Error
	return
}

// CountVerificationCodeStats 统计验证码（OTP）下发量：今日与近 7 天。
// 发码热路径在 Redis 且键会过期，无法可靠回溯计数；verification_codes
// 表是每次下发的审计台账，这里按其行数口径统计。
func (r *AdminRepository) CountVerificationCodeStats(ctx context.Context) (today, week int64, err error) {
	todayStart := dayStart()
	weekStart := todayStart.AddDate(0, 0, -6)
	if err = r.db.WithContext(ctx).Model(&model.VerificationCode{}).
		Where("created_at >= ?", todayStart).Count(&today).Error; err != nil {
		return
	}
	err = r.db.WithContext(ctx).Model(&model.VerificationCode{}).
		Where("created_at >= ?", weekStart).Count(&week).Error
	return
}

// StorageStat 单一对象类别的存储占用口径行。
type StorageStat struct {
	// Category 类别名：avatar / sticker / sticker_cover /
	// message_image / message_file / message_voice
	Category string `json:"category"`
	// ObjectCount 该类别引用的对象数
	ObjectCount int64 `json:"object_count"`
	// TotalBytes 已知字节数合计；类别元数据不含大小时为 nil（前端显示「—」）
	TotalBytes *int64 `json:"total_bytes"`
}

// CountStorageStats 按对象类别做 DB 聚合的存储统计（只读，单条 SQL）。
//
// 口径说明：
//   - avatar：users.avatar_url 非空的行数（URL 不含对象键，字节数未知 → nil）；
//   - sticker：stickers 表行数（内容寻址去重后的唯一贴纸对象，无 size 字段 → nil）；
//   - sticker_cover：sticker_packs.cover_url 非空的行数（字节数未知 → nil）；
//   - message_image / message_file / message_voice：未删除消息按类型计数，
//     并对 content JSONB 里的 size 字段求和（WS 写入路径强制要求 size>0；
//     历史脏数据缺字段或非数字时按 0 计入，不让单条坏行炸掉整个聚合）。
//
// 不走 MinIO ListObjects 全桶遍历：桶随消息量线性增长，遍历成本不可控，
// 且 DB 口径天然只统计「仍被引用」的对象，与 GC 视角一致。
func (r *AdminRepository) CountStorageStats(ctx context.Context) ([]StorageStat, error) {
	rows := []StorageStat{}
	err := r.db.WithContext(ctx).Raw(`
		SELECT 'avatar' AS category, COUNT(*) AS object_count, NULL::bigint AS total_bytes
			FROM users WHERE avatar_url IS NOT NULL AND deleted_at IS NULL
		UNION ALL
		SELECT 'sticker', COUNT(*), NULL::bigint
			FROM stickers
		UNION ALL
		SELECT 'sticker_cover', COUNT(*), NULL::bigint
			FROM sticker_packs WHERE cover_url IS NOT NULL
		UNION ALL
		SELECT 'message_image', COUNT(*), COALESCE(SUM(CASE WHEN content->>'size' ~ '^[0-9]+$' THEN (content->>'size')::bigint ELSE 0 END), 0)
			FROM messages WHERE deleted_at IS NULL AND message_type = ?
		UNION ALL
		SELECT 'message_file', COUNT(*), COALESCE(SUM(CASE WHEN content->>'size' ~ '^[0-9]+$' THEN (content->>'size')::bigint ELSE 0 END), 0)
			FROM messages WHERE deleted_at IS NULL AND message_type = ?
		UNION ALL
		SELECT 'message_voice', COUNT(*), COALESCE(SUM(CASE WHEN content->>'size' ~ '^[0-9]+$' THEN (content->>'size')::bigint ELSE 0 END), 0)
			FROM messages WHERE deleted_at IS NULL AND message_type = ?`,
		model.MessageTypeImage, model.MessageTypeFile, model.MessageTypeVoice).
		Scan(&rows).Error
	return rows, err
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
