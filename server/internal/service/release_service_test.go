package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// ========================================
// 灰度判定
// ========================================

// TestInRollout_StableForSameDevice 同设备判定必须恒定。
//
// 不稳定的话用户会在新旧版之间来回跳 —— 今天提示升级、明天又说已是最新、
// 后天再提示一次。
func TestInRollout_StableForSameDevice(t *testing.T) {
	const dev = "device-abc-123"
	first := InRollout(dev, 50)
	for i := 0; i < 100; i++ {
		if got := InRollout(dev, 50); got != first {
			t.Fatalf("第 %d 次判定 = %v，首次 = %v：同一设备同一比例的判定必须恒定", i, got, first)
		}
	}
}

// TestInRollout_Boundaries 0% 与 100% 是运营的「暂停」与「全量」开关。
func TestInRollout_Boundaries(t *testing.T) {
	for _, dev := range []string{"a", "b", "zzz", ""} {
		if InRollout(dev, 0) {
			t.Errorf("rollout=0 必须谁都不中，device=%q 中了", dev)
		}
		if !InRollout(dev, 100) {
			t.Errorf("rollout=100 必须谁都中，device=%q 没中", dev)
		}
	}
}

// TestInRollout_RoughlyProportional 哈希分布坏掉的话灰度就是个假开关。
func TestInRollout_RoughlyProportional(t *testing.T) {
	hit := 0
	const n = 2000
	for i := 0; i < n; i++ {
		if InRollout(fmt.Sprintf("device-%d", i), 30) {
			hit++
		}
	}
	ratio := float64(hit) / float64(n)
	if ratio < 0.25 || ratio > 0.35 {
		t.Fatalf("rollout=30 的实际命中率 = %.3f，期望落在 0.30±0.05", ratio)
	}
}

// TestInRollout_MonotonicInRollout 比例调高时已中的设备必须仍然中。
//
// 否则「扩大灰度」会把一部分人踢回旧版。
func TestInRollout_MonotonicInRollout(t *testing.T) {
	const dev = "device-xyz"
	for r := 1; r <= 100; r++ {
		if !InRollout(dev, r) {
			continue
		}
		for bigger := r; bigger <= 100; bigger++ {
			if !InRollout(dev, bigger) {
				t.Fatalf("rollout 从 %d 调到 %d 时该设备被踢出了灰度", r, bigger)
			}
		}
		return
	}
	t.Fatal("rollout 到 100 都没中，InRollout 恒假")
}

// ========================================
// 版本比较
// ========================================

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"0.7.0", "0.7.0", 0},
		{"0.7.0", "0.8.0", -1},
		{"0.8.0", "0.7.0", 1},
		{"0.7.1", "0.7.0", 1},
		{"1.0.0", "0.9.9", 1},
		// 段数不等按缺位补 0：0.7 等价 0.7.0
		{"0.7", "0.7.0", 0},
		{"0.7", "0.7.1", -1},
		// 两位数段不能按字典序比：10 > 9
		{"0.10.0", "0.9.0", 1},
		// 预发布后缀只影响后缀所在段的数字部分之后，整体按主段比
		{"0.8.0-beta.1", "0.8.0", 0},
		{"0.8.0-beta.1", "0.7.0", 1},
		// 垃圾输入当 0 处理，不 panic
		{"", "0.0.0", 0},
		{"abc", "0.0.1", -1},
	}
	for _, c := range cases {
		if got := compareVersions(c.a, c.b); got != c.want {
			t.Errorf("compareVersions(%q, %q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

// ========================================
// Resolve
// ========================================

func newTestReleaseService(t *testing.T, db *gorm.DB) *ReleaseService {
	t.Helper()
	return NewReleaseService(repository.NewReleaseRepository(db), zap.NewNop())
}

// seedRelease 插一条版本记录并在用例结束时清掉。
func seedRelease(
	t *testing.T, db *gorm.DB,
	platform, arch, version, channel string, rollout int16, status string,
) *model.AppRelease {
	t.Helper()
	r := &model.AppRelease{
		ID:        uuid.New(),
		Platform:  platform,
		Arch:      arch,
		Version:   version,
		Channel:   channel,
		ObjectKey: "releases/" + platform + "-" + arch + "-" + version,
		Signature: "sig",
		Rollout:   rollout,
		Status:    status,
	}
	if status == model.ReleaseStatusPublished {
		now := time.Now()
		r.PublishedAt = &now
	}
	if err := db.Create(r).Error; err != nil {
		t.Fatalf("seed release: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(r) })
	return r
}

func setMinVersion(t *testing.T, db *gorm.DB, id uuid.UUID, minVersion string) {
	t.Helper()
	if err := db.Model(&model.AppRelease{}).Where("id = ?", id).
		Update("min_version", minVersion).Error; err != nil {
		t.Fatalf("set min_version: %v", err)
	}
}

func TestResolve_NoUpdateWhenAlreadyLatest(t *testing.T) {
	db := testDB(t)
	svc := newTestReleaseService(t, db)
	seedRelease(t, db, "linux", "x86_64", "0.7.0", "stable", 100, model.ReleaseStatusPublished)

	res, err := svc.Resolve(context.Background(), "linux", "x86_64", "stable", "0.7.0", "dev-1")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if res != nil {
		t.Fatalf("当前已是最新，必须返回无更新，实际 %+v", res)
	}
}

func TestResolve_SkipsDraftAndRolledBack(t *testing.T) {
	db := testDB(t)
	svc := newTestReleaseService(t, db)
	seedRelease(t, db, "linux", "x86_64", "0.8.0", "stable", 100, model.ReleaseStatusDraft)
	seedRelease(t, db, "linux", "x86_64", "0.9.0", "stable", 100, model.ReleaseStatusRolledBack)
	seedRelease(t, db, "linux", "x86_64", "0.7.0", "stable", 100, model.ReleaseStatusPublished)

	res, err := svc.Resolve(context.Background(), "linux", "x86_64", "stable", "0.6.0", "dev-1")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if res == nil {
		t.Fatal("有一条 published 版本，不该返回无更新")
	}
	if res.Release.Version != "0.7.0" {
		t.Fatalf("下发了 %s，draft 与 rolled_back 不得下发", res.Release.Version)
	}
}

func TestResolve_MandatoryWhenBelowMinVersion(t *testing.T) {
	db := testDB(t)
	svc := newTestReleaseService(t, db)
	r := seedRelease(t, db, "linux", "x86_64", "0.8.0", "stable", 100, model.ReleaseStatusPublished)
	setMinVersion(t, db, r.ID, "0.7.0")
	ctx := context.Background()

	res, err := svc.Resolve(ctx, "linux", "x86_64", "stable", "0.6.0", "dev-1")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if !res.Mandatory {
		t.Fatal("低于 min_version 必须判强制更新")
	}

	res, err = svc.Resolve(ctx, "linux", "x86_64", "stable", "0.7.5", "dev-1")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if res.Mandatory {
		t.Fatal("高于 min_version 不该判强制更新")
	}
}

// TestResolve_RolloutZeroMeansPaused rollout=0 是运营的暂停开关，
// 已 published 也不下发。
func TestResolve_RolloutZeroMeansPaused(t *testing.T) {
	db := testDB(t)
	svc := newTestReleaseService(t, db)
	seedRelease(t, db, "linux", "x86_64", "0.8.0", "stable", 0, model.ReleaseStatusPublished)

	res, err := svc.Resolve(context.Background(), "linux", "x86_64", "stable", "0.7.0", "dev-1")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if res != nil {
		t.Fatalf("rollout=0 必须不下发，实际 %+v", res)
	}
}

// TestResolve_ChannelIsolated beta 的版本不得泄进 stable 渠道。
func TestResolve_ChannelIsolated(t *testing.T) {
	db := testDB(t)
	svc := newTestReleaseService(t, db)
	seedRelease(t, db, "linux", "x86_64", "0.9.0", "beta", 100, model.ReleaseStatusPublished)

	res, err := svc.Resolve(context.Background(), "linux", "x86_64", "stable", "0.7.0", "dev-1")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if res != nil {
		t.Fatalf("beta 版本泄进了 stable 渠道：%+v", res)
	}
}

// TestResolve_UnknownPlatformIsNoUpdate 未知平台当「没有更新」而非报错。
func TestResolve_UnknownPlatformIsNoUpdate(t *testing.T) {
	db := testDB(t)
	svc := newTestReleaseService(t, db)

	res, err := svc.Resolve(context.Background(), "solaris", "sparc", "stable", "0.1.0", "dev-1")
	if err != nil {
		t.Fatalf("未知平台不该报错: %v", err)
	}
	if res != nil {
		t.Fatalf("未知平台应无更新，实际 %+v", res)
	}
}

// TestCatalogLatest_OnlyPublished 下载页目录只收 published。
func TestCatalogLatest_OnlyPublished(t *testing.T) {
	db := testDB(t)
	repo := repository.NewReleaseRepository(db)
	seedRelease(t, db, "windows", "x86_64", "0.8.0", "stable", 100, model.ReleaseStatusPublished)
	seedRelease(t, db, "darwin", "universal", "0.9.0", "stable", 100, model.ReleaseStatusDraft)

	rows, err := repo.CatalogLatest(context.Background(), "stable")
	if err != nil {
		t.Fatalf("CatalogLatest: %v", err)
	}
	for _, r := range rows {
		if r.Platform == "darwin" {
			t.Fatal("draft 不得出现在下载页目录")
		}
	}
	var found bool
	for _, r := range rows {
		if r.Platform == "windows" && r.Version == "0.8.0" {
			found = true
		}
	}
	if !found {
		t.Fatalf("已发布的 windows 版本未出现在目录里: %+v", rows)
	}
}
