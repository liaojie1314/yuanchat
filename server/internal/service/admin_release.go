package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
)

// 管理端版本分发可能返回的错误。
var (
	// ErrReleaseNotFound 版本记录不存在；handler 映射 404。
	ErrReleaseNotFound = errors.New("release not found")
	// ErrReleaseRepoMissing 仓储未注入；handler 映射 503。
	//
	// 不做「未注入即跳过」的降级：那等于让一次漏接线静默地把版本分发关掉，
	// 运营会以为发布成功了而实际什么都没发生。
	ErrReleaseRepoMissing = errors.New("release repository not wired")
	// ErrReleaseDuplicate 同一平台/架构/渠道下该版本号已登记；handler 映射 409。
	ErrReleaseDuplicate = repository.ErrDuplicateRelease
)

// SetReleaseRepo 注入版本仓储（装配层在启动前调用一次）。
func (s *AdminService) SetReleaseRepo(repo *repository.ReleaseRepository) {
	s.releaseRepo = repo
}

// ListReleases 分页列出版本记录。
func (s *AdminService) ListReleases(
	ctx context.Context,
	f repository.ReleaseFilter,
	page, size int,
) ([]model.AppRelease, int64, error) {
	if s.releaseRepo == nil {
		return nil, 0, ErrReleaseRepoMissing
	}
	return s.releaseRepo.List(ctx, f, (page-1)*size, size)
}

// CreateReleaseInput 登记新版本的入参。
//
// 没有 status 字段：新登记一律是 draft，发布是独立的一步 ——
// 「登记」与「推给所有客户端」是两个决定，让它们共用一次请求就没有复核的机会。
type CreateReleaseInput struct {
	Platform   string
	Arch       string
	Version    string
	Channel    string
	Notes      string
	ObjectKey  string
	Signature  string
	Sha256     string
	Size       int64
	MinVersion string
	Mandatory  bool
	Rollout    int16
}

// CreateRelease 登记一条新版本（draft 态）并留审计日志。
//
// 服务端**不接收签名私钥、不算签名**：Signature 只存调用方粘进来的 .sig
// 文本内容（release 流水线产物），管理端只做登记。
func (s *AdminService) CreateRelease(
	ctx context.Context,
	actorID uuid.UUID,
	in CreateReleaseInput,
) (*model.AppRelease, error) {
	if s.releaseRepo == nil {
		return nil, ErrReleaseRepoMissing
	}
	if in.Channel == "" {
		in.Channel = model.ReleaseChannelStable
	}
	rel := &model.AppRelease{
		ID:        uuid.New(),
		Platform:  in.Platform,
		Arch:      in.Arch,
		Version:   in.Version,
		Channel:   in.Channel,
		Notes:     in.Notes,
		ObjectKey: in.ObjectKey,
		Signature: in.Signature,
		Sha256:    in.Sha256,
		Size:      in.Size,
		Mandatory: in.Mandatory,
		Rollout:   in.Rollout,
		Status:    model.ReleaseStatusDraft,
		CreatedBy: &actorID,
	}
	if in.MinVersion != "" {
		rel.MinVersion = &in.MinVersion
	}
	if err := s.releaseRepo.Create(ctx, rel); err != nil {
		return nil, err
	}
	s.audit(ctx, actorID, model.AdminActionCreateRelease, "app_release", rel.ID.String(),
		map[string]any{
			"platform": rel.Platform, "arch": rel.Arch,
			"version": rel.Version, "channel": rel.Channel, "rollout": rel.Rollout,
		})
	return rel, nil
}

// UpdateReleaseInput 可改字段；nil 表示本次不改该项。
//
// 刻意只有这三项：平台/架构/版本号/对象键是身份，改它们等于换一条记录，
// 该走「新建 + 回滚旧的」—— 原地改会让已拿到旧 URL 的客户端和新客户端
// 对同一个版本号拿到互相矛盾的字节。
type UpdateReleaseInput struct {
	Rollout   *int16
	Mandatory *bool
	Notes     *string
}

// UpdateRelease 改灰度 / 强制 / 更新说明并留审计日志。
func (s *AdminService) UpdateRelease(
	ctx context.Context,
	actorID, releaseID uuid.UUID,
	in UpdateReleaseInput,
) error {
	if s.releaseRepo == nil {
		return ErrReleaseRepoMissing
	}
	fields := map[string]any{}
	detail := map[string]any{}
	if in.Rollout != nil {
		fields["rollout"] = *in.Rollout
		detail["rollout"] = *in.Rollout
	}
	if in.Mandatory != nil {
		fields["mandatory"] = *in.Mandatory
		detail["mandatory"] = *in.Mandatory
	}
	if in.Notes != nil {
		fields["notes"] = *in.Notes
		detail["notes_changed"] = true
	}
	if len(fields) == 0 {
		// 空补丁不算错，但也别写一条什么都没改的审计日志
		return nil
	}
	// updated_at 交给 GORM 的自动时间戳（AppRelease 有 UpdatedAt 字段）
	ok, err := s.releaseRepo.Update(ctx, releaseID, fields)
	if err != nil {
		return fmt.Errorf("update release: %w", err)
	}
	if !ok {
		return ErrReleaseNotFound
	}
	s.audit(ctx, actorID, model.AdminActionUpdateRelease, "app_release", releaseID.String(), detail)
	return nil
}

// SetReleaseStatus 发布或回滚，并留审计日志。
//
// 回滚是改状态而不是删记录：坏版本要留着痕迹，且「回滚过」与「从未发过」
// 对运营是两回事。改完对外端点立刻停止下发 —— 这是坏版本唯一的收敛手段，
// 先前只能再发一版压过去。
func (s *AdminService) SetReleaseStatus(
	ctx context.Context,
	actorID, releaseID uuid.UUID,
	status string,
) error {
	if s.releaseRepo == nil {
		return ErrReleaseRepoMissing
	}
	action := model.AdminActionPublishRelease
	if status == model.ReleaseStatusRolledBack {
		action = model.AdminActionRollbackRelease
	}
	ok, err := s.releaseRepo.SetStatus(ctx, releaseID, status)
	if err != nil {
		return fmt.Errorf("set release status: %w", err)
	}
	if !ok {
		return ErrReleaseNotFound
	}
	s.audit(ctx, actorID, action, "app_release", releaseID.String(),
		map[string]any{"status": status})
	return nil
}
