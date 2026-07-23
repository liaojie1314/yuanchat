package service

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
)

// FavoriteService 消息收藏服务。
type FavoriteService struct {
	favRepo  *repository.FavoriteRepository
	msgRepo  *repository.MessageRepository
	convRepo *repository.ConversationRepository
	userRepo *repository.UserRepository
	logger   *zap.Logger
}

func NewFavoriteService(
	favRepo *repository.FavoriteRepository,
	msgRepo *repository.MessageRepository,
	convRepo *repository.ConversationRepository,
	userRepo *repository.UserRepository,
	logger *zap.Logger,
) *FavoriteService {
	return &FavoriteService{favRepo: favRepo, msgRepo: msgRepo, convRepo: convRepo, userRepo: userRepo, logger: logger}
}

// Add 收藏一条消息，在服务层建立快照（消息撤回后仍可查看）。
func (s *FavoriteService) Add(ctx context.Context, userID, messageID uuid.UUID) (*model.Favorite, error) {
	msg, err := s.msgRepo.FindByID(ctx, messageID)
	if err != nil {
		return nil, fmt.Errorf("find message: %w", err)
	}
	if msg == nil {
		return nil, ErrMessageNotFound
	}

	ok, err := s.convRepo.IsMember(ctx, msg.ConversationID, userID)
	if err != nil {
		return nil, fmt.Errorf("check membership: %w", err)
	}
	if !ok {
		return nil, ErrNotMember
	}

	sender, err := s.userRepo.FindByID(ctx, msg.SenderID)
	if err != nil || sender == nil {
		return nil, fmt.Errorf("find sender: %w", err)
	}

	conv, err := s.convRepo.FindByID(ctx, msg.ConversationID)
	if err != nil || conv == nil {
		return nil, fmt.Errorf("find conversation: %w", err)
	}

	// conv.Name is *string; private chats may have nil name
	convName := ""
	if conv.Name != nil {
		convName = *conv.Name
	}

	fav := &model.Favorite{
		UserID:         userID,
		MessageID:      messageID,
		ConversationID: msg.ConversationID,
		ConvName:       convName,
		SenderNickname: sender.Nickname,
		MessageType:    msg.MessageType,
		Content:        msg.Content,
	}
	return s.favRepo.Add(ctx, fav)
}

// Remove 取消收藏。
func (s *FavoriteService) Remove(ctx context.Context, userID, messageID uuid.UUID) error {
	return s.favRepo.Remove(ctx, userID, messageID)
}

// List 分页列出收藏。before 为 RFC3339 游标，msgType 0 = 不过滤。
func (s *FavoriteService) List(ctx context.Context, userID uuid.UUID, beforeStr string, limit int, msgType int16) ([]model.Favorite, bool, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	var before *time.Time
	if beforeStr != "" {
		t, err := time.Parse(time.RFC3339, beforeStr)
		if err != nil {
			return nil, false, fmt.Errorf("invalid before: %w", err)
		}
		before = &t
	}
	rows, err := s.favRepo.List(ctx, userID, before, limit+1, msgType)
	if err != nil {
		return nil, false, err
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	return rows, hasMore, nil
}
