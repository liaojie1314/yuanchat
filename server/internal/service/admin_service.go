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
	logger   *zap.Logger
}

func NewAdminService(repo *repository.AdminRepository, convRepo *repository.ConversationRepository, logger *zap.Logger) *AdminService {
	return &AdminService{repo: repo, convRepo: convRepo, logger: logger}
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
// （taken_down=true：商城不再展示，已添加者保留）；user 类目标无删除语义（既有缺口）。
// 处理动作写审计。
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
