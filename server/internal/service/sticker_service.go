package service

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

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

// packCoverObjectKeyPattern 表情包封面对象键：必须来自 sticker-covers/ 前缀
// （该前缀走桶级公共读，与贴纸本体的 images/ 私有通道语义不同——封面在商城
// 列表页高频重复渲染，不能逐包签发预签名 URL）。
var packCoverObjectKeyPattern = regexp.MustCompile(`^sticker-covers/[0-9]{4}/[0-9]{2}/[0-9a-f-]+\.[a-z0-9]+$`)

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
	// maxPublishedPacksPerUser 单用户可发布表情包数量上限（防滥用的运营护栏，
	// 常量非配置项）。达上限后拒绝发布新包，编辑既有包不受影响。
	maxPublishedPacksPerUser = 20
	// maxPackStickers 单包贴纸数量上限，量级沿用收藏上限（H1 既有口径），
	// 防止一个包被无限追加贴纸后在商城/详情端点刷出超载荷响应。
	maxPackStickers = maxStickerFavorites
	// maxPackNameLen 包名长度上限（列宽 varchar(64)，PG 按字符计）。
	maxPackNameLen = 64
	// defaultMarketPageSize / maxMarketPageSize 商城列表分页尺寸。
	defaultMarketPageSize = 20
	maxMarketPageSize     = 50
	// maxVisiblePageSize 「我的表情包」列表（GET /sticker-packs）分页上限。
	// 不传 limit 时仍返回全量（向后兼容），上限只约束显式分页调用。
	maxVisiblePageSize = 50
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

// ErrPackNotFound 表情包不存在（已被删除或 ID 错误）。
var ErrPackNotFound = errors.New("sticker pack not found")

// ErrPackNotAvailable 表情包不可添加（已下架或未公开进商城）。
var ErrPackNotAvailable = errors.New("sticker pack not available")

// ErrNotPackOwner 仅发布者本人可编辑/删除自己发布的表情包。
var ErrNotPackOwner = errors.New("not the pack owner")

// ErrInvalidPackName 包名非法（空白或超出 varchar(64) 容量）。
var ErrInvalidPackName = errors.New("invalid pack name")

// ErrInvalidCoverKey 封面对象键必须来自 sticker-covers/ 前缀的服务端签发键。
var ErrInvalidCoverKey = errors.New("cover must be an uploaded sticker cover")

// ErrPublishLimitExceeded 发布数已达每用户上限（发布新包被拒；编辑既有包不受影响）。
var ErrPublishLimitExceeded = errors.New("publish limit exceeded")

// ErrInvalidStickerSources 发布请求未携带任何贴纸来源（空包发布无意义）。
var ErrInvalidStickerSources = errors.New("sticker sources must not be empty")

// ErrTooManyPackStickers 单包含贴纸数已达上限。
var ErrTooManyPackStickers = errors.New("too many stickers in this pack")

// objectChecker 判断对象是否存在（由 storage.Storage 实现）。
// 取接口而非具体类型：MinIO 不可达时 router 注入 nil，服务降级为跳过存在性校验。
type objectChecker interface {
	ObjectExists(ctx context.Context, objectKey string) (bool, error)
}

// StickerService 表情收藏（个人）、表情包商城与自主发布。
type StickerService struct {
	repo   *repository.StickerRepository
	st     objectChecker
	logger *zap.Logger
	// moderation 包名敏感词审核（router 注入，nil 表示跳过审核）。
	// 与消息审核共享同一实例（无状态，可安全复用）。
	moderation *ModerationService
	// publicURL 把 sticker-covers/ 对象键转成公共访问 URL（由 storage.Storage.PublicURL
	// 注入）。nil 时（MinIO 不可达）发布仍可进行，只是不落封面 URL。
	publicURL func(objectKey string) string
}

func NewStickerService(repo *repository.StickerRepository, logger *zap.Logger) *StickerService {
	return &StickerService{repo: repo, logger: logger}
}

// SetObjectChecker 注入对象存在性检查（router 装配时调用；nil 表示跳过该校验）。
func (s *StickerService) SetObjectChecker(st objectChecker) { s.st = st }

// SetModeration 注入敏感词审核服务（与消息审核共享同一实例）。
func (s *StickerService) SetModeration(m *ModerationService) { s.moderation = m }

// SetPublicURL 注入对象键到公共 URL 的映射（封面公共读通道）。
func (s *StickerService) SetPublicURL(fn func(objectKey string) string) { s.publicURL = fn }

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
// 允许两类：本人收藏的贴纸；或一个可用表情包内的贴纸——包未下架、未被敏感词打标，
// 且为官方包（无需添加即可用）或发送者已添加的包（见 FindSendableInPack）。
func (s *StickerService) ResolveSendable(ctx context.Context, senderID, stickerID uuid.UUID) (*model.Sticker, error) {
	if st, err := s.repo.FindOwned(ctx, senderID, stickerID); err == nil {
		return st, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("find owned sticker: %w", err)
	}
	st, err := s.repo.FindSendableInPack(ctx, senderID, stickerID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// 不区分「不存在」「包已下架/被打标」「包未添加」三种拒绝原因，
			// 统一按不存在处理，避免向发送者泄露下架内容的存在性
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
	// 无收藏时保证是空数组而非 nil：nil 会 marshal 成 `"stickers": null`，
	// 而客户端把「字段不是数组」视为响应损坏并报错重试（原先客户端静默兜底成
	// 空数组，于是"服务端返回了坏结构"和"我确实没有收藏"在 UI 上无法区分）。
	if rows == nil {
		rows = []model.Sticker{}
	}
	return rows, hasMore, nil
}

// PackDTO 一个表情包及其全部贴纸（列表页一次性下发，避免逐包再请求）。
type PackDTO struct {
	Pack     model.StickerPack `json:"pack"`
	Stickers []model.Sticker   `json:"stickers"`
}

// ListPacks 列出「我的表情包」= 官方包 + 当前用户已添加的包，含各自全部贴纸。
// H1 时仅返回官方包；商城上线后语义扩展为官方 + 已添加（返回结构不变，
// EmojiPicker 无需改动即可展示已添加的包）。两次查询（包 + 批量取贴纸）
// 后在内存分组，避免逐包查询的 N+1。
//
// 分页为可选（照抄 Market 的游标范式）：limit <= 0 时返回全量、nextCursor 为空串
// （向后兼容）；limit > 0 时钳制到 maxVisiblePageSize，按 created_at 升序取一页，
// 还有下一页时 nextCursor 为最后一条的 created_at（RFC3339Nano）。
// cursor 为非法 RFC3339 时报 ErrInvalidCursor。
func (s *StickerService) ListPacks(ctx context.Context, userID uuid.UUID, cursor string, limit int) ([]PackDTO, string, error) {
	var after *time.Time
	if cursor != "" {
		t, err := time.Parse(time.RFC3339, cursor)
		if err != nil {
			return nil, "", fmt.Errorf("%w: %v", ErrInvalidCursor, err)
		}
		after = &t
	}
	// limit <= 0：不分页，返回全量（向后兼容）。limit > 0：钳制到上限并多取一条
	// 判断 hasMore，避免为"还有没有下一页"单独发一次 COUNT。
	pageSize := 0
	if limit > 0 {
		pageSize = maxVisiblePageSize
		if limit < pageSize {
			pageSize = limit
		}
	}
	fetch := 0 // fetch=0 表示仓库层不加 LIMIT（全量）
	if pageSize > 0 {
		fetch = pageSize + 1
	}
	packs, err := s.repo.ListVisible(ctx, userID, after, fetch)
	if err != nil {
		return nil, "", fmt.Errorf("list packs: %w", err)
	}
	hasMore := len(packs) > pageSize && pageSize > 0
	if hasMore {
		packs = packs[:pageSize]
	}
	if len(packs) == 0 {
		return []PackDTO{}, "", nil
	}
	ids := make([]uuid.UUID, len(packs))
	for i, p := range packs {
		ids[i] = p.ID
	}
	all, err := s.repo.ListByPackIDs(ctx, ids)
	if err != nil {
		return nil, "", fmt.Errorf("list pack stickers: %w", err)
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
	var nextCursor string
	if hasMore && len(packs) > 0 {
		nextCursor = packs[len(packs)-1].CreatedAt.Format(time.RFC3339Nano)
	}
	return result, nextCursor, nil
}

// ---------- 表情商城（浏览 / 添加 / 移除） ----------

// PackSummary 商城列表与我发布的列表共用的包摘要字段（前后端契约的公共投影）。
// OwnerName 为 nil 表示官方包或发布者已注销。
type PackSummary struct {
	ID       uuid.UUID `json:"id"`
	Name     string    `json:"name"`
	CoverURL *string   `json:"cover_url"`
	// FirstStickerKey 包内最早一张贴纸的对象键；封面缺失时前端回退展示（可 null）。
	FirstStickerKey *string   `json:"first_sticker_key"`
	OwnerName       *string   `json:"owner_name"`
	IsOfficial      bool      `json:"is_official"`
	StickerCount    int64     `json:"sticker_count"`
	CreatedAt       time.Time `json:"created_at"`
}

// MarketPackDTO 商城列表项。
type MarketPackDTO struct {
	PackSummary
	Added bool `json:"added"`
}

// packSummaryOf 把仓库投影转成对外契约摘要。
func packSummaryOf(r repository.PackWithMeta) PackSummary {
	return PackSummary{
		ID:              r.ID,
		Name:            r.Name,
		CoverURL:        r.CoverURL,
		FirstStickerKey: r.FirstStickerKey,
		OwnerName:       r.OwnerName,
		IsOfficial:      r.IsOfficial,
		StickerCount:    r.StickerCount,
		CreatedAt:       r.CreatedAt,
	}
}

// Market 商城列表：公开未下架的包按发布时间倒序游标分页，附带当前用户是否已添加
// （批量查询，防 N+1）。
//
// cursor 为上一页响应的 next_cursor（RFC3339；取 created_at < cursor）。
// nextCursor 还有下一页时为最后一条的 created_at，否则为空串（handler 置 null）。
func (s *StickerService) Market(ctx context.Context, userID uuid.UUID, cursor string, limit int) ([]MarketPackDTO, string, error) {
	if limit <= 0 {
		limit = defaultMarketPageSize
	}
	if limit > maxMarketPageSize {
		limit = maxMarketPageSize
	}
	var before *time.Time
	if cursor != "" {
		t, err := time.Parse(time.RFC3339, cursor)
		if err != nil {
			return nil, "", fmt.Errorf("%w: %v", ErrInvalidCursor, err)
		}
		before = &t
	}
	// 多取一条判断 hasMore，避免为"还有没有下一页"单独发一次 COUNT
	rows, err := s.repo.ListMarket(ctx, before, limit+1)
	if err != nil {
		return nil, "", fmt.Errorf("list market: %w", err)
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	ids := make([]uuid.UUID, len(rows))
	for i, r := range rows {
		ids[i] = r.ID
	}
	added, err := s.repo.IsAddedBatch(ctx, userID, ids)
	if err != nil {
		return nil, "", fmt.Errorf("check added batch: %w", err)
	}
	items := make([]MarketPackDTO, 0, len(rows))
	for _, r := range rows {
		items = append(items, MarketPackDTO{PackSummary: packSummaryOf(r), Added: added[r.ID]})
	}
	var nextCursor string
	if hasMore && len(rows) > 0 {
		// RFC3339Nano 保证微秒精度往返无损（Parse(time.RFC3339) 接受小数秒）
		nextCursor = rows[len(rows)-1].CreatedAt.Format(time.RFC3339Nano)
	}
	return items, nextCursor, nil
}

// StickerItemDTO 包详情/发布响应里的贴纸条目。
type StickerItemDTO struct {
	ID        uuid.UUID `json:"id"`
	ObjectKey string    `json:"object_key"`
	Width     int       `json:"width"`
	Height    int       `json:"height"`
}

// PackDetailInfo 包详情的元信息。不返回 taken_down：下架包仅对已添加者保留展示，
// 普通用户无从进入详情，无需感知下架状态。
type PackDetailInfo struct {
	ID       uuid.UUID `json:"id"`
	Name     string    `json:"name"`
	CoverURL *string   `json:"cover_url"`
	// FirstStickerKey 包内最早一张贴纸对象键；封面缺失时前端回退展示（可 null）。
	FirstStickerKey *string   `json:"first_sticker_key"`
	IsOfficial      bool      `json:"is_official"`
	OwnerName       *string   `json:"owner_name"`
	IsOwner         bool      `json:"is_owner"`
	Flagged         bool      `json:"flagged"`
	StickerCount    int64     `json:"sticker_count"`
	CreatedAt       time.Time `json:"created_at"`
}

// PackDetailDTO 包详情：元信息 + 全部贴纸 + 当前用户是否已添加。
type PackDetailDTO struct {
	Pack     PackDetailInfo   `json:"pack"`
	Stickers []StickerItemDTO `json:"stickers"`
	Added    bool             `json:"added"`
}

// PackDetail 包详情。已下架的包仅对已添加者与发布者保留（下架只从商城撤展示，
// 已添加者的入口与 EmojiPicker 不受影响）；其余请求者按 ErrPackNotFound 返回。
func (s *StickerService) PackDetail(ctx context.Context, userID, packID uuid.UUID) (*PackDetailDTO, error) {
	meta, err := s.repo.GetPackMeta(ctx, packID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPackNotFound
		}
		return nil, fmt.Errorf("get pack meta: %w", err)
	}
	stickers, err := s.repo.ListByPackIDs(ctx, []uuid.UUID{packID})
	if err != nil {
		return nil, fmt.Errorf("list pack stickers: %w", err)
	}
	added, err := s.repo.IsAddedBatch(ctx, userID, []uuid.UUID{packID})
	if err != nil {
		return nil, fmt.Errorf("check added batch: %w", err)
	}
	isOwner := meta.OwnerID != nil && *meta.OwnerID == userID
	// 下架或被敏感词打标的包仅对已添加者与发布者保留可见（与 taken_down 同口径、
	// shared client 契约「已下架且未添加 → 404」一致）：其余请求者按不存在返回，
	// 不区分下架/打标/删除三种状态，避免被处置内容凭 id 直链继续可看。
	// 打标是暂隐而非下架：管理员清标记后包自动恢复商城展示。
	if (meta.TakenDown || meta.Flagged) && !added[packID] && !isOwner {
		return nil, ErrPackNotFound
	}
	items := make([]StickerItemDTO, 0, len(stickers))
	for _, st := range stickers {
		items = append(items, StickerItemDTO{
			ID: st.ID, ObjectKey: st.ObjectKey, Width: st.Width, Height: st.Height,
		})
	}
	return &PackDetailDTO{
		Pack: PackDetailInfo{
			ID:              meta.ID,
			Name:            meta.Name,
			CoverURL:        meta.CoverURL,
			FirstStickerKey: meta.FirstStickerKey,
			IsOfficial:      meta.IsOfficial,
			OwnerName:       meta.OwnerName,
			IsOwner:         isOwner,
			Flagged:         meta.Flagged,
			StickerCount:    meta.StickerCount,
			CreatedAt:       meta.CreatedAt,
		},
		Stickers: items,
		Added:    added[packID],
	}, nil
}

// AddPack 把一个表情包加入「我的表情包」列表，幂等：重复添加不报错也不重复落行。
// 已下架、被敏感词打标或未公开的包拒绝添加；已添加者不受其后下架影响（见 ListVisible）。
func (s *StickerService) AddPack(ctx context.Context, userID, packID uuid.UUID) error {
	meta, err := s.repo.GetPackMeta(ctx, packID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrPackNotFound
		}
		return fmt.Errorf("get pack meta: %w", err)
	}
	if meta.TakenDown || meta.Flagged || !(meta.IsPublic || meta.IsOfficial) {
		return ErrPackNotAvailable
	}
	if _, err := s.repo.AddUserPack(ctx, userID, packID); err != nil {
		return fmt.Errorf("add user pack: %w", err)
	}
	return nil
}

// RemovePack 把一个表情包移出「我的表情包」列表（幂等，不影响包本身与包内贴纸）。
func (s *StickerService) RemovePack(ctx context.Context, userID, packID uuid.UUID) error {
	if err := s.repo.RemoveUserPack(ctx, userID, packID); err != nil {
		return fmt.Errorf("remove user pack: %w", err)
	}
	return nil
}

// ---------- 自主发布与编辑管理 ----------

// StickerSource 发布/追加贴纸时的单张来源：
//   - collection：从本人收藏复制（sticker_id 必须属于本人收藏）；
//     新行指向同一 MinIO 对象（object_key 复用），原收藏不受影响。
//   - upload：直传的新贴纸（object_key 须为 images/ 前缀的服务端签发键）。
type StickerSource struct {
	Source      string    `json:"source"`
	StickerID   uuid.UUID `json:"sticker_id"`
	ObjectKey   string    `json:"object_key"`
	Width       int       `json:"width"`
	Height      int       `json:"height"`
	ContentHash string    `json:"content_hash"`
}

// PublishInput 发布新表情包的入参。
// cover_width/cover_height 供前端按需展示，服务端不落库（表无对应列）。
type PublishInput struct {
	Name           string
	CoverObjectKey string
	CoverWidth     int
	CoverHeight    int
	StickerSources []StickerSource
}

// UpdatePackInput 编辑已发布包的入参；空串字段表示不修改。
type UpdatePackInput struct {
	Name           string
	CoverObjectKey string
	CoverWidth     int
	CoverHeight    int
}

// MyPackDTO 「我发布的」列表项（added 字段省略，is_owner 恒为 true）。
type MyPackDTO struct {
	PackSummary
	IsOwner bool `json:"is_owner"`
}

// normalizePackName 包名去首尾空白；空白或超出 varchar(64) 容量（PG 按字符计）
// 报 ErrInvalidPackName。
func normalizePackName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > maxPackNameLen {
		return "", ErrInvalidPackName
	}
	return name, nil
}

// flagPackName 包名敏感词打标：命中返回 true。与消息审核同范式——
// 只标记不拦截，包照常发布（进 admin 审核队列）。
func (s *StickerService) flagPackName(name string) bool {
	if s.moderation == nil {
		return false
	}
	if hit := s.moderation.Check(name); hit != "" {
		s.logger.Info("sticker pack name flagged by moderation",
			zap.String("word", hit))
		return true
	}
	return false
}

// coverPublicURL 校验封面对象键（sticker-covers/ 前缀 + 规范形态 + 对象真实存在）
// 并转成公共 URL。键非法报 ErrInvalidCoverKey；对象缺失报 ErrStickerObjectMissing。
func (s *StickerService) coverPublicURL(ctx context.Context, objectKey string) (*string, error) {
	if len(objectKey) > maxObjectKeyLen || !packCoverObjectKeyPattern.MatchString(objectKey) {
		return nil, ErrInvalidCoverKey
	}
	// 与收藏贴纸同口径：PresignPut/公共 URL 不校验存在性，
	// 缺了这一步会把指向空对象的封面写进库，渲染 404 且坏数据长期存活
	if s.st != nil {
		exists, err := s.st.ObjectExists(ctx, objectKey)
		if err != nil {
			return nil, fmt.Errorf("stat cover object: %w", err)
		}
		if !exists {
			return nil, ErrStickerObjectMissing
		}
	}
	if s.publicURL == nil {
		// MinIO 不可达（checker 也未注入）：发布不因封面降级失败，只是无封面
		s.logger.Warn("public URL fn not configured; publishing pack without cover",
			zap.String("object_key", objectKey))
		return nil, nil
	}
	url := s.publicURL(objectKey)
	return &url, nil
}

// buildStickersFromSources 逐条按来源分流构造待插入的贴纸行
// （PackID 由调用方在插入时回填；发布产出的行 owner_id 恒为 NULL，
// 发布者注销时不会波及包内容）。
func (s *StickerService) buildStickersFromSources(ctx context.Context, userID uuid.UUID, sources []StickerSource) ([]model.Sticker, error) {
	out := make([]model.Sticker, 0, len(sources))
	for _, src := range sources {
		switch src.Source {
		case "collection":
			// 复制本人收藏：贴纸不存在与"不属于本人"一并按不存在处理，不泄漏他人收藏的存在性
			fav, err := s.repo.FindOwned(ctx, userID, src.StickerID)
			if err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return nil, ErrStickerNotFound
				}
				return nil, fmt.Errorf("find owned sticker: %w", err)
			}
			out = append(out, model.Sticker{
				ObjectKey:   fav.ObjectKey,
				Width:       fav.Width,
				Height:      fav.Height,
				ContentHash: fav.ContentHash,
			})
		case "upload":
			// 直传新贴纸：与个人收藏 Add 同一套校验口径（键形态、hash、尺寸、对象在库）
			if len(src.ObjectKey) > maxObjectKeyLen || !stickerObjectKeyPattern.MatchString(src.ObjectKey) {
				return nil, ErrInvalidObjectKey
			}
			if !stickerHashPattern.MatchString(src.ContentHash) {
				return nil, ErrInvalidContentHash
			}
			if src.Width <= 0 || src.Height <= 0 || src.Width > maxStickerEdge || src.Height > maxStickerEdge {
				return nil, ErrInvalidStickerSize
			}
			if s.st != nil {
				exists, err := s.st.ObjectExists(ctx, src.ObjectKey)
				if err != nil {
					return nil, fmt.Errorf("stat sticker object: %w", err)
				}
				if !exists {
					return nil, ErrStickerObjectMissing
				}
			}
			out = append(out, model.Sticker{
				ObjectKey:   src.ObjectKey,
				Width:       src.Width,
				Height:      src.Height,
				ContentHash: src.ContentHash,
			})
		default:
			return nil, ErrInvalidStickerSources
		}
	}
	return out, nil
}

// Publish 发布一个公开的表情包（一步创建即公开，无草稿态）。
//
// 约束：
//   - 本人已发布包数达 maxPublishedPacksPerUser 时拒绝（ErrPublishLimitExceeded）；
//   - 包名过敏感词，命中置 flagged=true 但不阻塞发布（同 messages.flagged 范式）；
//   - 包与全部贴纸行在同一事务内创建（PublishPack），要么整包可见，要么不存在；
//   - 贴纸来源逐条分流：collection 复制本人收藏（新行、同一对象），upload 直传建行。
//
// 返回创建后的包详情（is_owner=true，added=false——发布不等于添加）。
func (s *StickerService) Publish(ctx context.Context, userID uuid.UUID, in PublishInput) (*PackDetailDTO, error) {
	name, err := normalizePackName(in.Name)
	if err != nil {
		return nil, err
	}
	if len(in.StickerSources) == 0 {
		return nil, ErrInvalidStickerSources
	}
	if len(in.StickerSources) > maxPackStickers {
		return nil, ErrTooManyPackStickers
	}
	var coverURL *string
	if in.CoverObjectKey != "" {
		if coverURL, err = s.coverPublicURL(ctx, in.CoverObjectKey); err != nil {
			return nil, err
		}
	}
	// 发布数量上限：达上限拒绝新包（编辑既有包不受影响）
	n, err := s.repo.CountPacksByOwner(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("count packs by owner: %w", err)
	}
	if n >= maxPublishedPacksPerUser {
		return nil, ErrPublishLimitExceeded
	}
	stickers, err := s.buildStickersFromSources(ctx, userID, in.StickerSources)
	if err != nil {
		return nil, err
	}
	pack := &model.StickerPack{
		Name:     name,
		CoverURL: coverURL,
		OwnerID:  &userID,
		IsPublic: true,
		Flagged:  s.flagPackName(name),
	}
	if err := s.repo.PublishPack(ctx, pack, stickers); err != nil {
		return nil, fmt.Errorf("publish pack: %w", err)
	}
	return s.PackDetail(ctx, userID, pack.ID)
}

// UpdatePack 编辑本人发布的包（改名/换封面）。
// 改名同样过敏感词：命中把 flagged 重新置位（包保持可见，进审核队列）。
func (s *StickerService) UpdatePack(ctx context.Context, userID, packID uuid.UUID, in UpdatePackInput) (*PackDetailDTO, error) {
	// 先区分 404（不存在）与 403（存在但非本人）；实际更新仍带 owner_id 条件
	meta, err := s.repo.GetPackMeta(ctx, packID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPackNotFound
		}
		return nil, fmt.Errorf("get pack meta: %w", err)
	}
	if meta.OwnerID == nil || *meta.OwnerID != userID {
		return nil, ErrNotPackOwner
	}
	updates := map[string]any{}
	if in.Name != "" {
		name, err := normalizePackName(in.Name)
		if err != nil {
			return nil, err
		}
		updates["name"] = name
		if s.flagPackName(name) {
			updates["flagged"] = true
		}
	}
	if in.CoverObjectKey != "" {
		coverURL, err := s.coverPublicURL(ctx, in.CoverObjectKey)
		if err != nil {
			return nil, err
		}
		// coverURL 为 nil（存储降级）时不覆盖既有封面
		if coverURL != nil {
			updates["cover_url"] = *coverURL
		}
	}
	if len(updates) > 0 {
		if err := s.repo.UpdatePackOfOwner(ctx, userID, packID, updates); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				// 前置校验与更新之间包被并发删除
				return nil, ErrPackNotFound
			}
			return nil, fmt.Errorf("update pack: %w", err)
		}
	}
	return s.PackDetail(ctx, userID, packID)
}

// AddPackSticker 给本人发布的包追加一张贴纸（来源分流同 Publish）。
// 单包贴纸数达 maxPackStickers 时拒绝。
func (s *StickerService) AddPackSticker(ctx context.Context, userID, packID uuid.UUID, src StickerSource) error {
	meta, err := s.repo.GetPackMeta(ctx, packID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrPackNotFound
		}
		return fmt.Errorf("get pack meta: %w", err)
	}
	if meta.OwnerID == nil || *meta.OwnerID != userID {
		return ErrNotPackOwner
	}
	m, err := s.repo.CountStickersByPack(ctx, packID)
	if err != nil {
		return fmt.Errorf("count stickers: %w", err)
	}
	if m >= maxPackStickers {
		return ErrTooManyPackStickers
	}
	rows, err := s.buildStickersFromSources(ctx, userID, []StickerSource{src})
	if err != nil {
		return err
	}
	rows[0].PackID = &packID
	if err := s.repo.AddStickerToPack(ctx, &rows[0]); err != nil {
		return fmt.Errorf("add pack sticker: %w", err)
	}
	return nil
}

// RemovePackSticker 从本人发布的包中移除一张贴纸。
// 不校验"至少保留一张"——空包允许存在，由前端引导用户；不校验即不做伪校验。
func (s *StickerService) RemovePackSticker(ctx context.Context, userID, packID, stickerID uuid.UUID) error {
	meta, err := s.repo.GetPackMeta(ctx, packID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrPackNotFound
		}
		return fmt.Errorf("get pack meta: %w", err)
	}
	if meta.OwnerID == nil || *meta.OwnerID != userID {
		return ErrNotPackOwner
	}
	if err := s.repo.RemovePackSticker(ctx, packID, stickerID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrStickerNotFound
		}
		return fmt.Errorf("remove pack sticker: %w", err)
	}
	return nil
}

// DeleteMine 删除本人发布的包。stickers 与 user_sticker_packs 由外键级联清理——
// 发布者主动撤回内容，已添加者的表情面板中该包随之消失（与"注销保留"是两种场景）。
func (s *StickerService) DeleteMine(ctx context.Context, userID, packID uuid.UUID) error {
	meta, err := s.repo.GetPackMeta(ctx, packID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrPackNotFound
		}
		return fmt.Errorf("get pack meta: %w", err)
	}
	if meta.OwnerID == nil || *meta.OwnerID != userID {
		return ErrNotPackOwner
	}
	if err := s.repo.DeletePackOfOwner(ctx, userID, packID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// 前置校验与删除之间包被并发删除
			return ErrPackNotFound
		}
		return fmt.Errorf("delete pack: %w", err)
	}
	return nil
}

// ListMinePacks 列出当前用户发布的全部表情包（is_owner 恒 true）。
func (s *StickerService) ListMinePacks(ctx context.Context, userID uuid.UUID) ([]MyPackDTO, error) {
	rows, err := s.repo.ListPublishedBy(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list my packs: %w", err)
	}
	items := make([]MyPackDTO, 0, len(rows))
	for _, r := range rows {
		items = append(items, MyPackDTO{PackSummary: packSummaryOf(r), IsOwner: true})
	}
	return items, nil
}
