package service

import (
	"context"
	"fmt"
	"hash/fnv"
	"strconv"
	"strings"

	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
)

// ReleaseService 把版本表读写包成「该不该给这台设备下发更新」这一个判断。
type ReleaseService struct {
	repo   *repository.ReleaseRepository
	logger *zap.Logger
}

// NewReleaseService 构造版本服务。
func NewReleaseService(repo *repository.ReleaseRepository, logger *zap.Logger) *ReleaseService {
	return &ReleaseService{repo: repo, logger: logger}
}

// ResolveResult 一次更新检查的结论。
type ResolveResult struct {
	Release *model.AppRelease
	// Mandatory 是否强制更新：记录自身标了强制，或客户端版本低于 MinVersion。
	Mandatory bool
}

// InRollout 判断某设备是否落在灰度范围内。
//
// 按设备键的 FNV-1a 哈希取模 100。两条性质是必须的：
//
//   - **同设备稳定**：同一设备同一比例的判定恒定。不稳定的话用户会在新旧版之间
//     来回跳 —— 今天提示升级、明天说已是最新、后天再提示一次。
//   - **随比例单调**：把 rollout 从 10 调到 30，原先中的设备必须仍然中。
//     用「hash%100 < rollout」天然满足；若改成随机或带 rollout 参与哈希就会破坏它，
//     表现为扩大灰度反而把一部分人踢回旧版。
//
// rollout 为 0 时谁都不中、100 时谁都中 —— 这两个边界是运营的暂停与全量开关。
func InRollout(deviceKey string, rollout int) bool {
	if rollout <= 0 {
		return false
	}
	if rollout >= 100 {
		return true
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(deviceKey))
	return int(h.Sum32()%100) < rollout
}

// compareVersions 比较两个版本号，返回 -1 / 0 / 1。
//
// 自己写而不引 semver 库：本仓的 go.sum 里没有任何 semver 包，为三行比较
// 新增一个直接依赖不值当。规则刻意从简：
//
//   - 逐段按十进制整数比，段数不等按缺位补 0（故 "0.7" 等价 "0.7.0"）
//   - 预发布/构建后缀整段丢掉（"0.8.0-beta.1" 按 0.8.0 比）——
//     预发布版本只走 beta 渠道，渠道本身已经把它和 stable 隔开了，
//     不需要再在版本号层面区分 pre-release 的先后。
//     必须在分段**之前**截断：否则 "-beta.1" 里的点会多切出一段，
//     把 0.8.0-beta.1 比成「比 0.8.0 大」
//   - 解析不出数字的段当 0，不报错不 panic：版本号是运营手填的，
//     一个错字不该让整条更新检查 500
func compareVersions(a, b string) int {
	as, bs := strings.Split(trimVersionSuffix(a), "."), strings.Split(trimVersionSuffix(b), ".")
	n := len(as)
	if len(bs) > n {
		n = len(bs)
	}
	for i := 0; i < n; i++ {
		x, y := versionSegment(as, i), versionSegment(bs, i)
		if x != y {
			if x < y {
				return -1
			}
			return 1
		}
	}
	return 0
}

// trimVersionSuffix 砍掉 semver 的预发布（-）与构建元数据（+）后缀。
func trimVersionSuffix(v string) string {
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		return v[:i]
	}
	return v
}

// versionSegment 取第 i 段的数字值；越界或非数字前缀为空时返回 0。
func versionSegment(parts []string, i int) int {
	if i >= len(parts) {
		return 0
	}
	s := parts[i]
	end := 0
	for end < len(s) && s[end] >= '0' && s[end] <= '9' {
		end++
	}
	if end == 0 {
		return 0
	}
	v, err := strconv.Atoi(s[:end])
	if err != nil {
		return 0
	}
	return v
}

// Resolve 判断该给这台设备下发哪个版本；无更新时返回 (nil, nil)。
//
// 「无更新」覆盖四种情形，调用方一律按 204 处理：平台/架构/渠道查不到记录、
// 客户端版本不低于最新版、灰度未命中。它们对客户端是同一件事 ——
// 「我确定你现在没有可装的更新」。
//
// deviceKey 必须由调用方保证同一台机器稳定（handler 优先取 device 查询参数，
// 缺失时回落 ClientIP），否则灰度判定会在请求之间抖动。
func (s *ReleaseService) Resolve(
	ctx context.Context,
	platform, arch, channel, currentVersion, deviceKey string,
) (*ResolveResult, error) {
	if channel == "" {
		channel = model.ReleaseChannelStable
	}

	rel, err := s.repo.LatestPublished(ctx, platform, arch, channel)
	if err != nil {
		return nil, fmt.Errorf("latest published release: %w", err)
	}
	if rel == nil {
		return nil, nil
	}

	// 已是最新（或更新）就别下发：返同版本号会让 Tauri updater 当成有更新，
	// 把同一个包再装一遍。
	if compareVersions(currentVersion, rel.Version) >= 0 {
		return nil, nil
	}

	if !InRollout(deviceKey, int(rel.Rollout)) {
		return nil, nil
	}

	mandatory := rel.Mandatory
	if rel.MinVersion != nil && *rel.MinVersion != "" &&
		compareVersions(currentVersion, *rel.MinVersion) < 0 {
		mandatory = true
	}
	return &ResolveResult{Release: rel, Mandatory: mandatory}, nil
}

// CatalogLatest 取某渠道下每个平台/架构的最新已发布版本，供下载页列表用。
func (s *ReleaseService) CatalogLatest(ctx context.Context, channel string) ([]model.AppRelease, error) {
	if channel == "" {
		channel = model.ReleaseChannelStable
	}
	rows, err := s.repo.CatalogLatest(ctx, channel)
	if err != nil {
		return nil, fmt.Errorf("release catalog: %w", err)
	}
	return rows, nil
}
