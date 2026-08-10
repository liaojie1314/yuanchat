package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// ErrInvalidObjectKey 贴纸来源必须是已上传的图片对象（images/ 前缀），
// 防止把任意 key（如 files/ 私有文档）伪造成贴纸绕过下载权限模型。
var ErrInvalidObjectKey = errors.New("object key must be an uploaded image")

// ErrInvalidContentHash 内容哈希格式非法（须为 64 位十六进制 SHA-256）。
var ErrInvalidContentHash = errors.New("invalid content hash")

// ErrNotStickerOwner 只有收藏者本人可删除自己的个人贴纸。
var ErrNotStickerOwner = errors.New("not the sticker owner")

// StickerService 表情收藏（个人）+ 官方表情包（公共只读）。
type StickerService struct {
	repo   *repository.StickerRepository
	logger *zap.Logger
}

func NewStickerService(repo *repository.StickerRepository, logger *zap.Logger) *StickerService {
	return &StickerService{repo: repo, logger: logger}
}

// Add 把一张已上传的图片收藏为个人贴纸。幂等：同一用户对同一内容（contentHash）
// 重复收藏返回既有行，不新增（收藏列表不会因反复点击同张图而重复）。
func (s *StickerService) Add(ctx context.Context, userID uuid.UUID, objectKey string, width, height int, contentHash string) (*model.Sticker, error) {
	// object_key 必须来自图片上传类别（images/ 前缀），拒绝把文件/语音等对象伪造成贴纸。
	if !strings.HasPrefix(objectKey, "images/") {
		return nil, ErrInvalidObjectKey
	}
	// content_hash 由客户端算 SHA-256（64 位十六进制），服务端只做格式校验 + 唯一约束去重。
	if len(contentHash) != 64 {
		return nil, ErrInvalidContentHash
	}
	sticker := &model.Sticker{
		OwnerID:     &userID,
		ObjectKey:   objectKey,
		Width:       width,
		Height:      height,
		ContentHash: contentHash,
	}
	return s.repo.AddOwned(ctx, sticker)
}

// Remove 删除自己的个人收藏贴纸；非本人删除或不存在均报错。
func (s *StickerService) Remove(ctx context.Context, userID, stickerID uuid.UUID) error {
	existing, err := s.repo.FindByID(ctx, stickerID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrStickerNotFound
		}
		return fmt.Errorf("find sticker: %w", err)
	}
	if existing.OwnerID == nil || *existing.OwnerID != userID {
		return ErrNotStickerOwner
	}
	return s.repo.Remove(ctx, stickerID)
}

// ListMine 列出当前用户的个人收藏贴纸（最新在前）。
func (s *StickerService) ListMine(ctx context.Context, userID uuid.UUID) ([]model.Sticker, error) {
	return s.repo.ListMine(ctx, userID)
}

// PackDTO 一个表情包及其全部贴纸（列表页一次性下发，避免逐包再请求）。
type PackDTO struct {
	Pack     model.StickerPack `json:"pack"`
	Stickers []model.Sticker   `json:"stickers"`
}

// ListPacks 列出全部官方表情包及其贴纸（当前仅官方来源，公共只读）。
func (s *StickerService) ListPacks(ctx context.Context) ([]PackDTO, error) {
	packs, err := s.repo.ListPacks(ctx)
	if err != nil {
		return nil, fmt.Errorf("list packs: %w", err)
	}
	result := make([]PackDTO, 0, len(packs))
	for _, p := range packs {
		stickers, err := s.repo.ListByPack(ctx, p.ID)
		if err != nil {
			return nil, fmt.Errorf("list stickers for pack %s: %w", p.ID, err)
		}
		result = append(result, PackDTO{Pack: p, Stickers: stickers})
	}
	return result, nil
}

// ErrStickerNotFound 贴纸不存在（已被删除或 ID 错误）。
var ErrStickerNotFound = errors.New("sticker not found")
