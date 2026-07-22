package service

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
)

// ErrBlocked 消息发送侧被 blocklist 拦截时返回；handler 映射为 403 BLOCKED。
var ErrBlocked = errors.New("blocked by receiver or receiver blocked")

// BlockedUser 黑名单条目投影（含目标用户资料，供前端直接渲染）。
type BlockedUser struct {
	TargetID  uuid.UUID `json:"target_id"`
	Nickname  string    `json:"nickname"`
	AvatarURL *string   `json:"avatar_url,omitempty"`
	ShortID   int64     `json:"short_id"`
	CreatedAt int64     `json:"created_at"` // 用户注册时间的 Unix 毫秒；无 blocklist 时间字段直接用
}

// BlocklistService 拉黑操作 + 列表查询。
type BlocklistService struct {
	repo     *repository.BlocklistRepository
	userRepo *repository.UserRepository
	logger   *zap.Logger
}

func NewBlocklistService(
	repo *repository.BlocklistRepository,
	userRepo *repository.UserRepository,
	logger *zap.Logger,
) *BlocklistService {
	return &BlocklistService{repo: repo, userRepo: userRepo, logger: logger}
}

// Block 拉黑目标用户，幂等。目标不存在返回 ErrUserNotFound。
func (s *BlocklistService) Block(ctx context.Context, userID, targetID uuid.UUID) error {
	if userID == targetID {
		return repository.ErrBlockSelf
	}
	target, err := s.userRepo.FindByID(ctx, targetID)
	if err != nil {
		return err
	}
	if target == nil {
		return ErrUserNotFound
	}
	return s.repo.Block(ctx, userID, targetID)
}

// Unblock 解除拉黑，幂等。
func (s *BlocklistService) Unblock(ctx context.Context, userID, targetID uuid.UUID) error {
	return s.repo.Unblock(ctx, userID, targetID)
}

// List 返回黑名单条目（含目标用户资料），按拉黑时间倒序。
// 目标用户已删除的条目自动跳过（前端页面不显示 404 条）。
func (s *BlocklistService) List(ctx context.Context, userID uuid.UUID) ([]BlockedUser, error) {
	ids, err := s.repo.ListByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return []BlockedUser{}, nil
	}
	users, err := s.userRepo.FindByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	byID := make(map[uuid.UUID]*model.User, len(users))
	for i := range users {
		byID[users[i].ID] = &users[i]
	}
	items := make([]BlockedUser, 0, len(ids))
	for _, id := range ids {
		u, ok := byID[id]
		if !ok {
			continue
		}
		items = append(items, BlockedUser{
			TargetID:  u.ID,
			Nickname:  u.Nickname,
			AvatarURL: u.AvatarURL,
			ShortID:   u.ShortID,
			CreatedAt: u.CreatedAt.UnixMilli(),
		})
	}
	return items, nil
}

// IsBlockedEitherDirection 双向拉黑检查（消息发送 gate 用）。
func (s *BlocklistService) IsBlockedEitherDirection(ctx context.Context, a, b uuid.UUID) (bool, error) {
	return s.repo.IsBlockedEitherDirection(ctx, a, b)
}
