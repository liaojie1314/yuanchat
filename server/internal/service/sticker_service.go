package service

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// stickerObjectKeyPattern 贴纸对象键必须是 images/ 前缀下、由服务端 buildObjectKey
// 生成的形态（年月分区 + uuid + 小写扩展名）。
//
// 注意：这不是"防止绕过下载权限模型"的那道防线——真正拦截路径穿越的是
// handler/file.go 的 objectKeyPattern（download-url 与上传两处都用它，且贴纸表
// 从来不是预签名的信任来源）。此处是数据卫生 + 长度约束：弱前缀检查会放过
// `images/` + 任意 300 字符，撞 varchar(255) 后变成可控 500。
var stickerObjectKeyPattern = regexp.MustCompile(`^images/[0-9]{4}/[0-9]{2}/[0-9a-f-]+\.[a-z0-9]+$`)

// stickerHashPattern content_hash 须为 64 位小写十六进制（SHA-256）。
// 原实现只比长度，64 个中文/控制字符也会入库。
var stickerHashPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

const (
	// maxObjectKeyLen object_key 列宽（varchar(255)）。正则的 [0-9a-f-]+ 是无界的，
	// 单靠形态校验仍能过来一个 300 字符的合法形态 key，撞列宽后变成可控 500。
	maxObjectKeyLen = 255
	// maxStickerFavorites 单用户收藏上限。去重键是 (owner_id, content_hash)，
	// 客户端每次换随机 hash 即绕过幂等无限插行，没有上限时可被单账号刷爆。
	maxStickerFavorites = 500
	// maxStickerEdge 贴纸单边像素上限（宽高须为正且不超过此值）。
	maxStickerEdge = 4096
	// defaultStickerPageSize / maxStickerPageSize 收藏列表分页尺寸。
	//
	// 不变量：默认页大小 == maxStickerFavorites，即**一页足以装下一个用户可能拥有的
	// 全部收藏**。这样表情面板一次请求就能拿全，不需要翻页也不会静默少几张；
	// 分页参数仍保留，供将来放宽收藏上限时使用。查询始终带 LIMIT，
	// 内存占用有上界（原实现无 LIMIT，配合"换随机 hash 绕过去重"可刷到十万级）。
	defaultStickerPageSize = maxStickerFavorites
	maxStickerPageSize     = maxStickerFavorites
	// packStickerSoftCap ListPacks 一次下发贴纸的软上限：超过只记日志不截断
	// （静默截断会让"少了几张"无从排查），供 H1b 上线前作为加分页的信号。
	packStickerSoftCap = 2000
)

// ErrInvalidObjectKey 贴纸来源必须是服务端签发的图片对象键（images/ 前缀 + 规范形态）。
var ErrInvalidObjectKey = errors.New("object key must be an uploaded image")

// ErrInvalidContentHash 内容哈希格式非法（须为 64 位小写十六进制 SHA-256）。
var ErrInvalidContentHash = errors.New("invalid content hash")

// ErrInvalidStickerSize 贴纸宽高非法（须为正且不超过 maxStickerEdge）。
var ErrInvalidStickerSize = errors.New("invalid sticker dimensions")

// ErrNotStickerOwner 只有收藏者本人可删除自己的个人贴纸。
var ErrNotStickerOwner = errors.New("not the sticker owner")

// ErrStickerNotFound 贴纸不存在（已被删除或 ID 错误）。
var ErrStickerNotFound = errors.New("sticker not found")

// ErrStickerObjectMissing object_key 指向的对象在存储里不存在。
var ErrStickerObjectMissing = errors.New("sticker object does not exist")

// ErrTooManyStickers 收藏数已达上限。
var ErrTooManyStickers = errors.New("too many favorited stickers")

// ErrInvalidCursor 分页游标格式非法（须为 RFC3339 时间串）。
var ErrInvalidCursor = errors.New("invalid cursor")

// objectChecker 判断对象是否存在（由 storage.Storage 实现）。
// 取接口而非具体类型：MinIO 不可达时 router 注入 nil，服务降级为跳过存在性校验。
type objectChecker interface {
	ObjectExists(ctx context.Context, objectKey string) (bool, error)
}

// StickerService 表情收藏（个人）+ 官方表情包（公共只读）。
type StickerService struct {
	repo   *repository.StickerRepository
	st     objectChecker
	logger *zap.Logger
}

func NewStickerService(repo *repository.StickerRepository, logger *zap.Logger) *StickerService {
	return &StickerService{repo: repo, logger: logger}
}

// SetObjectChecker 注入对象存在性检查（router 装配时调用；nil 表示跳过该校验）。
func (s *StickerService) SetObjectChecker(st objectChecker) { s.st = st }

// Add 把一张已上传的图片收藏为个人贴纸。幂等：同一用户对同一内容（contentHash）
// 重复收藏返回既有行，不新增（收藏列表不会因反复点击同张图而重复）。
func (s *StickerService) Add(ctx context.Context, userID uuid.UUID, objectKey string, width, height int, contentHash string) (*model.Sticker, error) {
	if len(objectKey) > maxObjectKeyLen || !stickerObjectKeyPattern.MatchString(objectKey) {
		return nil, ErrInvalidObjectKey
	}
	if !stickerHashPattern.MatchString(contentHash) {
		return nil, ErrInvalidContentHash
	}
	// gin 的 binding:"required" 只拒零值，-1 会通过；而 WS 发送路径要求 > 0，
	// 负尺寸行入库后将永远发不出去，故在此统一口径。
	if width <= 0 || height <= 0 || width > maxStickerEdge || height > maxStickerEdge {
		return nil, ErrInvalidStickerSize
	}

	// 对象必须真实存在：PresignGet 只签名不校验存在性，少了这一步就会把
	// 指向空对象的行写进库——前端拿到合法 URL 但渲染 404，且坏数据长期存活。
	// 同时兜住客户端未检查 HTTP 状态、把错误页正文当图片字节算出的假 hash。
	if s.st != nil {
		exists, err := s.st.ObjectExists(ctx, objectKey)
		if err != nil {
			return nil, fmt.Errorf("stat sticker object: %w", err)
		}
		if !exists {
			return nil, ErrStickerObjectMissing
		}
	}

	// 收藏数上限。达上限时仍允许"重复收藏已有内容"——那是幂等操作、不新增行，
	// 拒掉它会让用户在满仓后连自己已收藏的图都提示失败。仅在触及上限时才多查一次。
	n, err := s.repo.CountByOwner(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("count stickers: %w", err)
	}
	if n >= maxStickerFavorites {
		existing, findErr := s.repo.FindByOwnerHash(ctx, userID, contentHash)
		if findErr == nil {
			return existing, nil
		}
		if !errors.Is(findErr, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("find sticker by hash: %w", findErr)
		}
		return nil, ErrTooManyStickers
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
//
// 先 FindByID 是为了区分 404（不存在）与 403（存在但不属于你，含官方包贴纸），
// 实际删除仍带 owner_id 条件并检查影响行数（见 RemoveOwned）。
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
	if err := s.repo.RemoveOwned(ctx, userID, stickerID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrStickerNotFound
		}
		return fmt.Errorf("remove sticker: %w", err)
	}
	return nil
}

// ResolveSendable 校验发送者是否有权发送该贴纸，并返回**服务端权威**的对象元数据。
//
// WS 发送路径此前只判客户端传来的四个字段非空：不查库、不校验归属、不校验 key 与
// sticker_id 是否匹配、连 key 前缀都不管。攻击者可填别人的 sticker_id、不存在的 id、
// 或任意 files/ 下的 key 当贴纸发进群，且 sticker_id 无长度上限可塞满帧上限落进
// JSONB 向全群扇出（绕过文本路径的 4000 字限制）。
//
// 允许两类：本人收藏的贴纸，或任一表情包内的贴纸（官方包全员可用）。
func (s *StickerService) ResolveSendable(ctx context.Context, senderID, stickerID uuid.UUID) (*model.Sticker, error) {
	if st, err := s.repo.FindOwned(ctx, senderID, stickerID); err == nil {
		return st, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("find owned sticker: %w", err)
	}
	st, err := s.repo.FindInAnyPack(ctx, stickerID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrStickerNotFound
		}
		return nil, fmt.Errorf("find pack sticker: %w", err)
	}
	return st, nil
}

// ListMine 分页列出当前用户的个人收藏贴纸（最新在前）。
//
// beforeStr 为 RFC3339 游标（空串表示从最新开始），limit <= 0 或超上限时钳制。
// 返回 hasMore 供前端决定是否继续翻页（多取一条判断，照 FavoriteService.List 的形态）。
func (s *StickerService) ListMine(ctx context.Context, userID uuid.UUID, beforeStr string, limit int) ([]model.Sticker, bool, error) {
	if limit <= 0 || limit > maxStickerPageSize {
		limit = defaultStickerPageSize
	}
	var before *time.Time
	if beforeStr != "" {
		t, err := time.Parse(time.RFC3339, beforeStr)
		if err != nil {
			return nil, false, fmt.Errorf("%w: %v", ErrInvalidCursor, err)
		}
		before = &t
	}
	rows, err := s.repo.ListMine(ctx, userID, before, limit+1)
	if err != nil {
		return nil, false, err
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	return rows, hasMore, nil
}

// PackDTO 一个表情包及其全部贴纸（列表页一次性下发，避免逐包再请求）。
type PackDTO struct {
	Pack     model.StickerPack `json:"pack"`
	Stickers []model.Sticker   `json:"stickers"`
}

// ListPacks 列出全部官方表情包及其贴纸（当前仅官方来源，公共只读）。
// 两次查询（包 + 批量取贴纸）后在内存分组，避免逐包查询的 N+1。
func (s *StickerService) ListPacks(ctx context.Context) ([]PackDTO, error) {
	packs, err := s.repo.ListPacks(ctx)
	if err != nil {
		return nil, fmt.Errorf("list packs: %w", err)
	}
	if len(packs) == 0 {
		return []PackDTO{}, nil
	}
	ids := make([]uuid.UUID, len(packs))
	for i, p := range packs {
		ids[i] = p.ID
	}
	all, err := s.repo.ListByPackIDs(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("list pack stickers: %w", err)
	}
	if len(all) > packStickerSoftCap {
		// 不截断（静默少几张无从排查），只告警：这是该端点需要加分页的信号
		s.logger.Warn("sticker-packs payload exceeds soft cap; consider pagination",
			zap.Int("stickers", len(all)), zap.Int("cap", packStickerSoftCap))
	}
	byPack := make(map[uuid.UUID][]model.Sticker, len(packs))
	for _, st := range all {
		if st.PackID != nil {
			byPack[*st.PackID] = append(byPack[*st.PackID], st)
		}
	}
	result := make([]PackDTO, len(packs))
	for i, p := range packs {
		stickers := byPack[p.ID]
		if stickers == nil {
			stickers = []model.Sticker{}
		}
		result[i] = PackDTO{Pack: p, Stickers: stickers}
	}
	return result, nil
}
