package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
)

// ErrAdminSelfBan 管理员不能封禁自己。
var ErrAdminSelfBan = errors.New("cannot ban yourself")

// AdminService 管理后台业务：用户封禁、会话解散、消息删除、审计查询。
// 所有写操作自动写入 admin_action_logs（审计失败仅告警不阻断主操作）。
type AdminService struct {
	repo     *repository.AdminRepository
	convRepo *repository.ConversationRepository
	userRepo *repository.UserRepository
	ugcRepo  *repository.FlaggedUGCRepository
	// pushRepo 推送订阅仓库（SetPushRepo 注入，可为 nil）：概览订阅视图用
	pushRepo *repository.PushRepository
	logger   *zap.Logger
}

func NewAdminService(
	repo *repository.AdminRepository,
	convRepo *repository.ConversationRepository,
	userRepo *repository.UserRepository,
	ugcRepo *repository.FlaggedUGCRepository,
	logger *zap.Logger,
) *AdminService {
	return &AdminService{repo: repo, convRepo: convRepo, userRepo: userRepo, ugcRepo: ugcRepo, logger: logger}
}

// audit 写审计日志；失败不阻断主流程（主操作已提交，回滚代价更大）。
func (s *AdminService) audit(ctx context.Context, actorID uuid.UUID, action, targetType, targetID string, detail map[string]any) {
	raw, err := json.Marshal(detail)
	if err != nil {
		raw = []byte("{}")
	}
	log := &model.AdminActionLog{
		ActorID:    actorID,
		Action:     action,
		TargetType: targetType,
		TargetID:   targetID,
		Detail:     string(raw),
	}
	if err := s.repo.CreateLog(ctx, log); err != nil {
		s.logger.Error("admin audit log failed",
			zap.String("action", action), zap.String("target", targetID), zap.Error(err))
	}
}

// SearchUsers 分页检索用户。
func (s *AdminService) SearchUsers(ctx context.Context, q string, page, size int) ([]model.User, int64, error) {
	return s.repo.SearchUsers(ctx, q, (page-1)*size, size)
}

// BanUser 封禁用户（status=2）。被封用户无法登录，已登录的由 handler 层踢下线。
func (s *AdminService) BanUser(ctx context.Context, actorID, targetID uuid.UUID) error {
	if actorID == targetID {
		return ErrAdminSelfBan
	}
	ok, err := s.repo.SetUserStatus(ctx, targetID, model.UserStatusDisabled)
	if err != nil {
		return fmt.Errorf("ban user: %w", err)
	}
	if !ok {
		return ErrUserNotFound
	}
	s.audit(ctx, actorID, model.AdminActionBanUser, "user", targetID.String(), nil)
	return nil
}

// UnbanUser 解封用户（status=1）。
func (s *AdminService) UnbanUser(ctx context.Context, actorID, targetID uuid.UUID) error {
	ok, err := s.repo.SetUserStatus(ctx, targetID, model.UserStatusNormal)
	if err != nil {
		return fmt.Errorf("unban user: %w", err)
	}
	if !ok {
		return ErrUserNotFound
	}
	s.audit(ctx, actorID, model.AdminActionUnbanUser, "user", targetID.String(), nil)
	return nil
}

// SearchConversations 分页检索会话。
func (s *AdminService) SearchConversations(ctx context.Context, q string, convType int16, page, size int) ([]repository.ConvWithCount, int64, error) {
	return s.repo.SearchConversations(ctx, q, convType, (page-1)*size, size)
}

// DissolveConversation 管理员强制解散会话（绕过群主校验）。
// 返回成员 ID 列表供 handler 层广播解散通知。
func (s *AdminService) DissolveConversation(ctx context.Context, actorID, convID uuid.UUID) ([]uuid.UUID, error) {
	memberIDs, err := s.convRepo.GetMemberIDs(ctx, convID)
	if err != nil {
		return nil, fmt.Errorf("load members: %w", err)
	}
	res := s.convRepo.DB().WithContext(ctx).Delete(&model.Conversation{}, "id = ?", convID)
	if res.Error != nil {
		return nil, fmt.Errorf("dissolve conversation: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		return nil, ErrConversationNotFound
	}
	s.audit(ctx, actorID, model.AdminActionDissolveConv, "conversation", convID.String(),
		map[string]any{"member_count": len(memberIDs)})
	return memberIDs, nil
}

// SearchMessages 分页检索消息；flaggedOnly=true 只看审核队列。
func (s *AdminService) SearchMessages(ctx context.Context, q string, flaggedOnly bool, page, size int) ([]repository.AdminMessage, int64, error) {
	return s.repo.SearchMessages(ctx, q, flaggedOnly, (page-1)*size, size)
}

// DeleteMessage 管理员删除一条消息（软删）。
func (s *AdminService) DeleteMessage(ctx context.Context, actorID, messageID uuid.UUID) error {
	ok, err := s.repo.DeleteMessage(ctx, messageID)
	if err != nil {
		return fmt.Errorf("delete message: %w", err)
	}
	if !ok {
		return ErrMessageNotFound
	}
	s.audit(ctx, actorID, model.AdminActionDeleteMessage, "message", messageID.String(), nil)
	return nil
}

// AuditMessageEditsView 记录「管理员查看消息编辑历史」这一取证动作。
//
// 历史内容本身由 MessageService.EditHistoryForAdmin 提供，本方法只负责留痕 ——
// 审计写入统一收在 AdminService，不散到 handler 里。
func (s *AdminService) AuditMessageEditsView(ctx context.Context, actorID, messageID uuid.UUID) {
	s.audit(ctx, actorID, model.AdminActionViewMessageEdits, "message", messageID.String(), nil)
}

// ListLogs 分页列出审计日志。
func (s *AdminService) ListLogs(ctx context.Context, actorID *uuid.UUID, action string, page, size int) ([]repository.LogWithActor, int64, error) {
	return s.repo.ListLogs(ctx, actorID, action, (page-1)*size, size)
}

// ErrReportNotFound 举报不存在。
var ErrReportNotFound = errors.New("report not found")

// CreateReport 用户提交举报（消息/用户）。
func (s *AdminService) CreateReport(ctx context.Context, reporterID uuid.UUID, targetType string, targetID uuid.UUID, reason string) (*model.Report, error) {
	report := &model.Report{
		ReporterID: reporterID,
		TargetType: targetType,
		TargetID:   targetID,
		Reason:     reason,
		Status:     model.ReportStatusPending,
	}
	if err := s.repo.CreateReport(ctx, report); err != nil {
		return nil, fmt.Errorf("create report: %w", err)
	}
	return report, nil
}

// ListReports 分页列出举报（status=-1 全部）。
func (s *AdminService) ListReports(ctx context.Context, status int16, page, size int) ([]repository.ReportWithNames, int64, error) {
	return s.repo.ListReports(ctx, status, (page-1)*size, size)
}

// HandleReport 处理举报：keep=保留（status=1），delete=处置目标（status=2）。
// 目标为消息且选择删除时软删该消息；目标为表情包且选择删除时下架
// （taken_down=true：商城不再展示，已添加者保留）；目标为用户且选择删除时
// 复用 BanUser 封禁（调用方负责踢下线）。处置动作写审计。
func (s *AdminService) HandleReport(ctx context.Context, actorID, reportID uuid.UUID, deleteTarget bool) error {
	report, err := s.repo.FindReport(ctx, reportID)
	if err != nil {
		return fmt.Errorf("find report: %w", err)
	}
	if report == nil {
		return ErrReportNotFound
	}

	if deleteTarget {
		switch report.TargetType {
		case model.ReportTargetMessage:
			if _, err := s.repo.DeleteMessage(ctx, report.TargetID); err != nil {
				return fmt.Errorf("delete reported message: %w", err)
			}
		case model.ReportTargetStickerPack:
			// 目标已被硬删（如发布者自行删包）时 RowsAffected 为 0，举报照常处置
			if _, err := s.repo.TakeDownStickerPack(ctx, report.TargetID); err != nil {
				return fmt.Errorf("take down sticker pack: %w", err)
			}
		case model.ReportTargetUser:
			// 封禁复用 BanUser：自封禁 / 目标不存在等错误原样上抛给 handler 映射；
			// BanUser 内部已写审计，此处不再重复记一条
			if err := s.BanUser(ctx, actorID, report.TargetID); err != nil {
				return fmt.Errorf("ban reported user: %w", err)
			}
		}
	}

	now := time.Now()
	report.Status = model.ReportStatusKept
	if deleteTarget {
		report.Status = model.ReportStatusDeleted
	}
	report.HandledBy = &actorID
	report.HandledAt = &now
	if err := s.repo.UpdateReport(ctx, report); err != nil {
		return fmt.Errorf("update report: %w", err)
	}

	action := model.AdminActionReportKeep
	if deleteTarget {
		action = model.AdminActionReportDelete
	}
	s.audit(ctx, actorID, action, report.TargetType, report.TargetID.String(),
		map[string]any{"report_id": reportID.String()})
	return nil
}

// ClearMessageFlag 审核通过：清除消息 flagged 标记并留审计。
func (s *AdminService) ClearMessageFlag(ctx context.Context, actorID, messageID uuid.UUID) error {
	ok, err := s.repo.ClearFlag(ctx, messageID)
	if err != nil {
		return fmt.Errorf("clear flag: %w", err)
	}
	if !ok {
		return ErrMessageNotFound
	}
	s.audit(ctx, actorID, model.AdminActionClearFlag, "message", messageID.String(), nil)
	return nil
}

// ResetAvatar 管理员重置用户头像：avatar_url 置空，前端回退默认头像渲染。
// 对象存储里的旧头像文件不强删——cmd/gc 按数据库引用回收，引用清空后自然过期。
// 写审计（action=reset_avatar）。
func (s *AdminService) ResetAvatar(ctx context.Context, actorID, targetID uuid.UUID) error {
	ok, err := s.repo.ClearUserAvatar(ctx, targetID)
	if err != nil {
		return fmt.Errorf("clear avatar: %w", err)
	}
	if !ok {
		return ErrUserNotFound
	}
	s.audit(ctx, actorID, model.AdminActionResetAvatar, "user", targetID.String(), nil)
	return nil
}

// StorageStats 存储统计响应（按对象类别的只读聚合，无分页）。
type StorageStats struct {
	// Categories 各对象类别的对象数与已知字节数合计
	Categories []repository.StorageStat `json:"categories"`
}

// StorageStats 按对象类别聚合对象存储占用（DB 口径，只读，不写审计日志）。
// 聚合细节与口径取舍见 repository.AdminRepository.CountStorageStats。
func (s *AdminService) StorageStats(ctx context.Context) (*StorageStats, error) {
	rows, err := s.repo.CountStorageStats(ctx)
	if err != nil {
		return nil, fmt.Errorf("storage stats: %w", err)
	}
	return &StorageStats{Categories: rows}, nil
}

// SearchStickerPacks 分页检索表情包；flaggedOnly=true 只看敏感词命中的（审核队列）。
func (s *AdminService) SearchStickerPacks(ctx context.Context, q string, flaggedOnly bool, page, size int) ([]repository.AdminStickerPack, int64, error) {
	return s.repo.SearchStickerPacks(ctx, q, flaggedOnly, (page-1)*size, size)
}

// TakeDownStickerPack 管理员直接下架表情包（不经举报流程）：
// 商城不再展示，已添加者保留。写审计。
func (s *AdminService) TakeDownStickerPack(ctx context.Context, actorID, packID uuid.UUID) error {
	ok, err := s.repo.TakeDownStickerPack(ctx, packID)
	if err != nil {
		return fmt.Errorf("take down sticker pack: %w", err)
	}
	if !ok {
		return ErrPackNotFound
	}
	s.audit(ctx, actorID, model.AdminActionTakeDownPack, "sticker_pack", packID.String(), nil)
	return nil
}

// ClearStickerPackFlag 审核通过：清除表情包敏感词标记（包保留展示）。写审计。
func (s *AdminService) ClearStickerPackFlag(ctx context.Context, actorID, packID uuid.UUID) error {
	ok, err := s.repo.ClearStickerPackFlag(ctx, packID)
	if err != nil {
		return fmt.Errorf("clear sticker pack flag: %w", err)
	}
	if !ok {
		return ErrPackNotFound
	}
	s.audit(ctx, actorID, model.AdminActionClearPackFlag, "sticker_pack", packID.String(), nil)
	return nil
}

// UntakeDownStickerPack 恢复表情包上架：清 taken_down 标记，商城重新展示。
// 写审计。
func (s *AdminService) UntakeDownStickerPack(ctx context.Context, actorID, packID uuid.UUID) error {
	ok, err := s.repo.UntakeDownStickerPack(ctx, packID)
	if err != nil {
		return fmt.Errorf("untake down sticker pack: %w", err)
	}
	if !ok {
		return ErrPackNotFound
	}
	s.audit(ctx, actorID, model.AdminActionUntakeDownPack, "sticker_pack", packID.String(), nil)
	return nil
}

// SetStickerPackOfficial 设置表情包的官方标识（is_official）。
// 官方包不受「公开」限制约束，且详情徽标随之变化。写审计。
func (s *AdminService) SetStickerPackOfficial(ctx context.Context, actorID, packID uuid.UUID, official bool) error {
	ok, err := s.repo.SetStickerPackOfficial(ctx, packID, official)
	if err != nil {
		return fmt.Errorf("set sticker pack official: %w", err)
	}
	if !ok {
		return ErrPackNotFound
	}
	s.audit(ctx, actorID, model.AdminActionSetPackOfficial, "sticker_pack", packID.String(),
		map[string]any{"is_official": official})
	return nil
}

// ErrFlaggedUGCNotFound UGC 命中记录不存在（或已被处置）。
var ErrFlaggedUGCNotFound = errors.New("flagged ugc not found")

// ErrMessageMediaNotSupported 该消息类型没有可预览的媒体对象（文本 / 系统 / 加密消息）。
var ErrMessageMediaNotSupported = errors.New("message has no media object")

// SearchFlaggedUGC 分页检索 UGC 敏感词命中记录。
// ugcType 为空查全部类型；status 三态："pending"=待处理、"handled"=已处置、""=全部。
func (s *AdminService) SearchFlaggedUGC(ctx context.Context, ugcType, status string, page, size int) ([]model.FlaggedUGC, int64, error) {
	return s.ugcRepo.Search(ctx, ugcType, status, (page-1)*size, size)
}

// DismissFlaggedUGC 审核通过：把命中记录置为已处置，内容维持原样。写审计。
func (s *AdminService) DismissFlaggedUGC(ctx context.Context, actorID, recordID uuid.UUID) error {
	rec, err := s.ugcRepo.Find(ctx, recordID)
	if err != nil {
		return fmt.Errorf("find flagged ugc: %w", err)
	}
	if rec == nil {
		return ErrFlaggedUGCNotFound
	}
	ok, err := s.ugcRepo.MarkHandled(ctx, recordID, time.Now())
	if err != nil {
		return fmt.Errorf("mark flagged ugc handled: %w", err)
	}
	if !ok {
		// 并发下已被处置：按幂等成功处理，但不再重复写审计
		return nil
	}
	s.audit(ctx, actorID, model.AdminActionClearUGCFlag, rec.UGCType, recordID.String(),
		map[string]any{"content": rec.Content, "hit_word": rec.HitWord})
	return nil
}

// ResetFlaggedUGC 强制重置命中的 UGC 内容并关闭记录：
//   - nickname → 重置为默认昵称「用户{短号}」
//   - bio → 清空
//   - group_name → 置空（前端回退默认群名）
//   - announcement → 清空公告
//
// 处置写审计（detail 里带原内容与命中词，便于追溯）。
func (s *AdminService) ResetFlaggedUGC(ctx context.Context, actorID, recordID uuid.UUID) error {
	rec, err := s.ugcRepo.Find(ctx, recordID)
	if err != nil {
		return fmt.Errorf("find flagged ugc: %w", err)
	}
	if rec == nil {
		return ErrFlaggedUGCNotFound
	}

	switch rec.UGCType {
	case model.UGCTypeNickname:
		if rec.UserID == nil {
			return ErrFlaggedUGCNotFound
		}
		user, err := s.userRepo.FindByID(ctx, *rec.UserID)
		if err != nil {
			return fmt.Errorf("load flagged ugc owner: %w", err)
		}
		if user == nil {
			return ErrFlaggedUGCNotFound
		}
		user.Nickname = fmt.Sprintf("用户%d", user.ShortID)
		if err := s.userRepo.Update(ctx, user); err != nil {
			return fmt.Errorf("reset nickname: %w", err)
		}
		s.audit(ctx, actorID, model.AdminActionResetNickname, "user", user.ID.String(),
			map[string]any{"record_id": recordID.String(), "content": rec.Content, "hit_word": rec.HitWord})
	case model.UGCTypeBio:
		if rec.UserID == nil {
			return ErrFlaggedUGCNotFound
		}
		if err := s.convRepo.DB().WithContext(ctx).Model(&model.User{}).
			Where("id = ?", *rec.UserID).Update("bio", nil).Error; err != nil {
			return fmt.Errorf("reset bio: %w", err)
		}
		s.audit(ctx, actorID, model.AdminActionResetBio, "user", rec.UserID.String(),
			map[string]any{"record_id": recordID.String(), "content": rec.Content, "hit_word": rec.HitWord})
	case model.UGCTypeGroupName:
		if rec.ConversationID == nil {
			return ErrFlaggedUGCNotFound
		}
		if err := s.convRepo.DB().WithContext(ctx).Model(&model.Conversation{}).
			Where("id = ?", *rec.ConversationID).Update("name", nil).Error; err != nil {
			return fmt.Errorf("reset group name: %w", err)
		}
		s.audit(ctx, actorID, model.AdminActionResetGroupName, "conversation", rec.ConversationID.String(),
			map[string]any{"record_id": recordID.String(), "content": rec.Content, "hit_word": rec.HitWord})
	case model.UGCTypeAnnouncement:
		if rec.ConversationID == nil {
			return ErrFlaggedUGCNotFound
		}
		if err := s.convRepo.DB().WithContext(ctx).Model(&model.Conversation{}).
			Where("id = ?", *rec.ConversationID).
			Updates(map[string]any{"announcement": nil, "announcement_updated_at": time.Now()}).Error; err != nil {
			return fmt.Errorf("reset announcement: %w", err)
		}
		s.audit(ctx, actorID, model.AdminActionResetAnnouncement, "conversation", rec.ConversationID.String(),
			map[string]any{"record_id": recordID.String(), "content": rec.Content, "hit_word": rec.HitWord})
	default:
		return ErrFlaggedUGCNotFound
	}

	if _, err := s.ugcRepo.MarkHandled(ctx, recordID, time.Now()); err != nil {
		// 重置已生效，关闭记录失败只告警：下一条重复处置会因幂等条件跳过
		s.logger.Warn("close flagged ugc record failed", zap.String("record_id", recordID.String()), zap.Error(err))
	}
	return nil
}

// MessageMedia 管理端媒体预览定位结果。
type MessageMedia struct {
	// MessageType 消息类型（image/file/voice/sticker 才有媒体对象）
	MessageType int16 `json:"message_type"`
	// ObjectKey 消息引用的对象存储键，handler 据此签发短期预签名 GET
	ObjectKey string `json:"object_key"`
	// FileName 文件消息的原始文件名（其余类型为空）
	FileName string `json:"file_name,omitempty"`
	// Width / Height 图片或贴纸的像素尺寸（缺失为 0）
	Width  int `json:"width,omitempty"`
	Height int `json:"height,omitempty"`
	// Duration 语音时长（秒）
	Duration int `json:"duration,omitempty"`
}

// MessageMedia 解析一条消息引用的媒体对象，供管理端签发预签名下载 URL。
// 只做键提取与存在性校验，不做用户侧 ObjectACL 判定——管理端授权由
// 路由层的 JWT + RequireAdmin 双重校验承担，且不得依赖举报人上下文。
func (s *AdminService) MessageMedia(ctx context.Context, messageID uuid.UUID) (*MessageMedia, error) {
	msg, err := s.repo.FindMessage(ctx, messageID)
	if err != nil {
		return nil, fmt.Errorf("find message: %w", err)
	}
	if msg == nil {
		return nil, ErrMessageNotFound
	}
	media, err := ExtractMessageMedia(msg.MessageType, msg.Content)
	if err != nil {
		return nil, err
	}
	media.MessageType = msg.MessageType
	return media, nil
}

// ExtractMessageMedia 从消息 content JSONB 提取媒体对象键。
// text / system / e2ee 消息没有可预览对象，返回 ErrMessageMediaNotSupported；
// JSON 解析失败同样归入该错误：管理端预览是读路径，坏数据不应变成 500。
func ExtractMessageMedia(messageType int16, content string) (*MessageMedia, error) {
	switch messageType {
	case model.MessageTypeImage, model.MessageTypeFile, model.MessageTypeVoice, model.MessageTypeSticker:
	default:
		return nil, ErrMessageMediaNotSupported
	}
	var parsed struct {
		Key      string `json:"key"`
		Name     string `json:"name"`
		Width    int    `json:"width"`
		Height   int    `json:"height"`
		Duration int    `json:"duration"`
	}
	if err := json.Unmarshal([]byte(content), &parsed); err != nil || parsed.Key == "" {
		return nil, ErrMessageMediaNotSupported
	}
	return &MessageMedia{
		ObjectKey: parsed.Key,
		FileName:  parsed.Name,
		Width:     parsed.Width,
		Height:    parsed.Height,
		Duration:  parsed.Duration,
	}, nil
}
