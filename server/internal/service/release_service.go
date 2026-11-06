package service

import (
	"context"
	"fmt"
	"hash/fnv"
	"strings"

	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
	"golang.org/x/mod/semver"
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

// compareVersions 按 SemVer 比较优先级，返回 -1 / 0 / 1。
//
// 保留 v 前缀与短版本兼容，预发布低于同号稳定版，构建元数据不影响排序。
// 非法输入按 0.0.0 处理，不能让客户端版本错字导致更新检查返回 500。
func compareVersions(a, b string) int {
	return semver.Compare(normalizeVersion(a), normalizeVersion(b))
}

// normalizeVersion 补齐 SemVer 包要求的 v 前缀；非法版本保守回落到零版本。
func normalizeVersion(v string) string {
	if !strings.HasPrefix(v, "v") {
		v = "v" + v
	}
	if !semver.IsValid(v) {
		return "v0.0.0"
	}
	return v
}

// Resolve 判断该给这台设备下发哪个版本；无更新时返回 (nil, nil)。
//
// 「无更新」覆盖四种情形，调用方一律按 204 处理：平台/架构/渠道查不到记录、
// 客户端版本不低于最新版、灰度未命中。它们对客户端是同一件事 ——
// 「我确定你现在没有可装的更新」。
//
// cohort 为 0..99 的匿名桶时直接按桶 < rollout 放量；nil 或非法值保留 deviceKey 哈希语义。
// deviceKey 必须由调用方保证稳定，handler 显式 device 查询优先于匿名桶，最后回落 ClientIP。
// 匿名桶可由客户端伪造，只作放量、不参与鉴权。
func (s *ReleaseService) Resolve(
	ctx context.Context,
	platform, arch, channel, currentVersion, deviceKey string,
	cohort *int,
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

	inRollout := InRollout(deviceKey, int(rel.Rollout))
	if cohort != nil && *cohort >= 0 && *cohort < 100 {
		inRollout = *cohort < int(rel.Rollout)
	}
	if !inRollout {
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
