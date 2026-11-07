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

// TestCompareVersions 钉住更新检查使用的版本优先级。
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
		{"v1.0.0", "1.0.0", 0},
		// 段数不等按缺位补 0：0.7 等价 0.7.0
		{"0.7", "0.7.0", 0},
		{"0.7", "0.7.1", -1},
		// 两位数段不能按字典序比：10 > 9
		{"0.10.0", "0.9.0", 1},
		// 同号稳定版高于预发布，预发布编号必须按数值比较。
		{"0.8.0-beta.1", "0.8.0", -1},
		{"0.8.0-beta.1", "0.7.0", 1},
		{"0.8.0-beta.2", "0.8.0-beta.11", -1},
		{"0.8.0-beta.999999999999999999999", "0.8.0-beta.1000000000000000000000", -1},
		{"0.8.0-1", "0.8.0-alpha", -1},
		{"0.8.0+build.1", "0.8.0+build.2", 0},
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

// TestResolve_CohortIndependentOfDeviceKey 匿名灰度桶直接按比例放量，不受设备键或换网影响。
func TestResolve_CohortIndependentOfDeviceKey(t *testing.T) {
	db := testDB(t)
	svc := newTestReleaseService(t, db)
	rel := seedRelease(t, db, "linux", "x86_64", "0.8.0", "stable", 50, model.ReleaseStatusPublished)
	ctx := context.Background()
	for _, rollout := range []int16{0, 50, 100} {
		if err := db.Model(rel).Update("rollout", rollout).Error; err != nil {
			t.Fatalf("更新灰度比例: %v", err)
		}
		for _, cohort := range []int{0, 49, 50, 99} {
			for _, device := range []string{"203.0.113.1", "203.0.113.2"} {
				got, err := svc.Resolve(ctx, "linux", "x86_64", "stable", "0.7.0", device, &cohort)
				if err != nil {
					t.Fatalf("Resolve: %v", err)
				}
				if (got != nil) != (cohort < int(rollout)) {
					t.Errorf("cohort=%d rollout=%d device=%s，实际放量=%v", cohort, rollout, device, got != nil)
				}
			}
		}
	}
}

// TestResolve_InvalidCohortFallsBack 无效匿名桶保持既有设备键哈希语义。
func TestResolve_InvalidCohortFallsBack(t *testing.T) {
	db := testDB(t)
	svc := newTestReleaseService(t, db)
	seedRelease(t, db, "linux", "x86_64", "0.8.0", "stable", 50, model.ReleaseStatusPublished)
	for _, cohort := range []int{-1, 100} {
		for _, device := range []string{"203.0.113.1", "203.0.113.2"} {
			got, err := svc.Resolve(context.Background(), "linux", "x86_64", "stable", "0.7.0", device, &cohort)
			if err != nil {
				t.Fatalf("Resolve: %v", err)
			}
			if (got != nil) != InRollout(device, 50) {
				t.Errorf("cohort=%d device=%s，无效桶改变了原有灰度结果", cohort, device)
			}
		}
	}
}

func TestResolve_NoUpdateWhenAlreadyLatest(t *testing.T) {
	db := testDB(t)
	svc := newTestReleaseService(t, db)
	seedRelease(t, db, "linux", "x86_64", "0.7.0", "stable", 100, model.ReleaseStatusPublished)

	res, err := svc.Resolve(context.Background(), "linux", "x86_64", "stable", "0.7.0", "dev-1", nil)
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

	res, err := svc.Resolve(context.Background(), "linux", "x86_64", "stable", "0.6.0", "dev-1", nil)
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

	res, err := svc.Resolve(ctx, "linux", "x86_64", "stable", "0.6.0", "dev-1", nil)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if !res.Mandatory {
		t.Fatal("低于 min_version 必须判强制更新")
	}

	res, err = svc.Resolve(ctx, "linux", "x86_64", "stable", "0.7.5", "dev-1", nil)
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

	res, err := svc.Resolve(context.Background(), "linux", "x86_64", "stable", "0.7.0", "dev-1", nil)
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

	res, err := svc.Resolve(context.Background(), "linux", "x86_64", "stable", "0.7.0", "dev-1", nil)
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

	res, err := svc.Resolve(context.Background(), "solaris", "sparc", "stable", "0.1.0", "dev-1", nil)
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

// TestSemVerPrecedence 标准预发布序列在升级与降级两个方向保持一致。
func TestSemVerPrecedence(t *testing.T) {
	versions := []string{"1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0"}
	for i := 1; i < len(versions); i++ {
		if compareVersions(versions[i-1], versions[i]) != -1 || compareVersions(versions[i], versions[i-1]) != 1 {
			t.Errorf("优先级错误: %s < %s", versions[i-1], versions[i])
		}
	}
}

// TestResolve_PreReleaseUpgrade 预发布客户端可收到同号稳定版，不能被误判为最新。
func TestResolve_PreReleaseUpgrade(t *testing.T) {
	db := testDB(t)
	svc := newTestReleaseService(t, db)
	seedRelease(t, db, "linux", "x86_64", "0.8.0", "stable", 100, model.ReleaseStatusPublished)
	got, err := svc.Resolve(context.Background(), "linux", "x86_64", "stable", "0.8.0-beta.2", "device", nil)
	if err != nil || got == nil {
		t.Fatalf("同号稳定版必须可升级: result=%v err=%v", got, err)
	}
}

// TestResolve_PreReleaseBelowMinimum 稳定版最低要求不能被同号预发布版本绕过。
func TestResolve_PreReleaseBelowMinimum(t *testing.T) {
	db := testDB(t)
	svc := newTestReleaseService(t, db)
	rel := seedRelease(t, db, "linux", "x86_64", "0.9.0", "stable", 100, model.ReleaseStatusPublished)
	setMinVersion(t, db, rel.ID, "0.8.0")
	got, err := svc.Resolve(context.Background(), "linux", "x86_64", "stable", "0.8.0-rc.1", "device", nil)
	if err != nil || got == nil || !got.Mandatory {
		t.Fatalf("预发布必须低于稳定最低版本: result=%v err=%v", got, err)
	}
}

// TestResolveDesktop_BaseAndVariantGates 基础记录控制版本与总灰度，变体不能独立越过暂停或回滚。
func TestResolveDesktop_BaseAndVariantGates(t *testing.T) {
	db := testDB(t)
	svc := newTestReleaseService(t, db)
	base := seedRelease(t, db, "linux", "x86_64", "0.8.0", "stable", 100, model.ReleaseStatusPublished)
	deb := seedRelease(t, db, "linux", "x86_64-deb", "0.8.0", "stable", 100, model.ReleaseStatusPublished)
	seedRelease(t, db, "linux", "x86_64-rpm", "0.7.5", "stable", 100, model.ReleaseStatusPublished)
	seedRelease(t, db, "linux", "x86_64-appimage", "0.9.0", "stable", 100, model.ReleaseStatusPublished)
	setMinVersion(t, db, base.ID, "0.7.5")
	got, err := svc.ResolveDesktop(context.Background(), "linux", "x86_64", "", "0.7.0", "device", nil)
	if err != nil || got == nil || got.Release.ID != base.ID || !got.Mandatory ||
		len(got.Platforms) != 1 || got.Platforms["linux-x86_64-deb"].ID != deb.ID {
		t.Fatalf("只能下发基础版本的 deb，并保留强制更新判定：result=%+v err=%v", got, err)
	}
	for _, tc := range []struct {
		name, version, status, variantStatus string
		rollout                              int16
	}{
		{"same version", "0.8.0", model.ReleaseStatusPublished, model.ReleaseStatusPublished, 100},
		{"newer client", "0.9.0", model.ReleaseStatusPublished, model.ReleaseStatusPublished, 100},
		{"base paused", "0.7.0", model.ReleaseStatusPublished, model.ReleaseStatusPublished, 0},
		{"base draft", "0.7.0", model.ReleaseStatusDraft, model.ReleaseStatusPublished, 100},
		{"base rollback", "0.7.0", model.ReleaseStatusRolledBack, model.ReleaseStatusPublished, 100},
		{"variant draft", "0.7.0", model.ReleaseStatusPublished, model.ReleaseStatusDraft, 100},
		{"variant rollback", "0.7.0", model.ReleaseStatusPublished, model.ReleaseStatusRolledBack, 100},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := db.Model(base).Updates(map[string]any{"status": tc.status, "rollout": tc.rollout}).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(deb).Update("status", tc.variantStatus).Error; err != nil {
				t.Fatal(err)
			}
			got, err := svc.ResolveDesktop(context.Background(), "linux", "x86_64", "stable", tc.version, "device", nil)
			if err != nil || got != nil {
				t.Fatalf("没有可装更新时必须返回空结果：result=%+v err=%v", got, err)
			}
		})
	}
}

// TestResolveDesktop_DarwinKeepsBaseVersion 精确架构基础记录优先，不能借通用 app 混入另一版本。
func TestResolveDesktop_DarwinKeepsBaseVersion(t *testing.T) {
	db := testDB(t)
	svc := newTestReleaseService(t, db)
	base := seedRelease(t, db, "darwin", "x86_64", "0.8.0", "stable", 100, model.ReleaseStatusPublished)
	app := seedRelease(t, db, "darwin", "x86_64-app", "0.8.0", "stable", 100, model.ReleaseStatusPublished)
	seedRelease(t, db, "darwin", "universal", "0.9.0", "stable", 100, model.ReleaseStatusPublished)
	seedRelease(t, db, "darwin", "universal-app", "0.9.0", "stable", 100, model.ReleaseStatusPublished)
	got, err := svc.ResolveDesktop(context.Background(), "darwin", "x86_64", "stable", "0.7.0", "device", nil)
	if err != nil || got == nil || got.Release.ID != base.ID || got.Platforms["darwin-x86_64-app"].ID != app.ID {
		t.Fatalf("精确架构基础版本必须优先：result=%+v err=%v", got, err)
	}
	if err := db.Model(app).Update("status", model.ReleaseStatusRolledBack).Error; err != nil {
		t.Fatal(err)
	}
	got, err = svc.ResolveDesktop(context.Background(), "darwin", "x86_64", "stable", "0.7.0", "device", nil)
	if err != nil || got != nil {
		t.Fatalf("缺少同版本 app 不能混入其他版本：result=%+v err=%v", got, err)
	}
}
