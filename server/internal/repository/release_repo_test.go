package repository

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
)

// TestLatestPublished_DarwinUniversalFallback 仅 macOS 双架构可回落通用包，精确架构始终优先。
func TestLatestPublished_DarwinUniversalFallback(t *testing.T) {
	db := testDB(t)
	repo := NewReleaseRepository(db)
	ctx := context.Background()
	now := time.Now()
	seed := func(platform, arch, version, channel, status string, publishedAt time.Time) *model.AppRelease {
		t.Helper()
		rel := &model.AppRelease{
			Platform: platform, Arch: arch, Version: version, Channel: channel,
			ObjectKey: "releases/" + uuid.NewString(), Status: status, PublishedAt: &publishedAt,
		}
		if err := db.Create(rel).Error; err != nil {
			t.Fatalf("创建版本: %v", err)
		}
		return rel
	}
	universal := seed("darwin", "universal", "0.9.0", "stable", model.ReleaseStatusPublished, now)
	seed("darwin", "universal", "0.10.0", "beta", model.ReleaseStatusPublished, now.Add(time.Hour))
	seed("darwin", "x86_64", "0.10.0", "stable", model.ReleaseStatusDraft, now.Add(time.Hour))
	seed("darwin", "aarch64", "0.10.0", "stable", model.ReleaseStatusRolledBack, now.Add(time.Hour))
	for _, platform := range []string{"linux", "windows", "android"} {
		seed(platform, "universal", "0.9.0", "stable", model.ReleaseStatusPublished, now)
	}
	for _, tc := range []struct {
		platform, arch string
		want           *model.AppRelease
	}{
		{"darwin", "x86_64", universal},
		{"darwin", "aarch64", universal},
		{"darwin", "universal", universal},
		{"darwin", "sparc", nil},
		{"linux", "x86_64", nil},
		{"windows", "aarch64", nil},
		{"android", "aarch64", nil},
	} {
		t.Run(tc.platform+"/"+tc.arch, func(t *testing.T) {
			got, err := repo.LatestPublished(ctx, tc.platform, tc.arch, "stable")
			if err != nil {
				t.Fatalf("LatestPublished: %v", err)
			}
			if tc.want == nil {
				if got != nil {
					t.Fatalf("不支持的架构不应回落通用包，实际 %+v", got)
				}
			} else if got == nil || got.ID != tc.want.ID {
				t.Fatalf("期望 stable 已发布通用包 %s，实际 %+v", tc.want.ID, got)
			}
		})
	}

	// 精确包比通用包更早发布，也必须优先；缺的是架构适配而非全平台最新版本。
	for _, arch := range []string{"x86_64", "aarch64"} {
		exact := seed("darwin", arch, "0.8.0", "stable", model.ReleaseStatusPublished, now.Add(-time.Hour))
		got, err := repo.LatestPublished(ctx, "darwin", arch, "stable")
		if err != nil || got == nil || got.ID != exact.ID {
			t.Errorf("%s 精确包应优先，got=%+v err=%v", arch, got, err)
		}
	}
}

// TestPublishedVariants_IdentityAndStatus 变体查询必须同时限定平台、版本、渠道、格式与已发布状态。
func TestPublishedVariants_IdentityAndStatus(t *testing.T) {
	db := testDB(t)
	repo := NewReleaseRepository(db)
	for _, row := range []model.AppRelease{
		{Platform: "linux", Arch: "x86_64-deb", Version: "0.8.0", Channel: "stable", Status: model.ReleaseStatusPublished},
		{Platform: "linux", Arch: "x86_64-rpm", Version: "0.8.0", Channel: "stable", Status: model.ReleaseStatusDraft},
		{Platform: "linux", Arch: "x86_64-appimage", Version: "0.8.0", Channel: "stable", Status: model.ReleaseStatusRolledBack},
		{Platform: "linux", Arch: "x86_64-deb", Version: "0.9.0", Channel: "stable", Status: model.ReleaseStatusPublished},
		{Platform: "linux", Arch: "x86_64-deb", Version: "0.7.5", Channel: "stable", Status: model.ReleaseStatusPublished},
		{Platform: "linux", Arch: "x86_64-deb", Version: "0.8.0", Channel: "beta", Status: model.ReleaseStatusPublished},
		{Platform: "windows", Arch: "x86_64-deb", Version: "0.8.0", Channel: "stable", Status: model.ReleaseStatusPublished},
		{Platform: "linux", Arch: "x86_64-nsis", Version: "0.8.0", Channel: "stable", Status: model.ReleaseStatusPublished},
	} {
		row.ObjectKey = "releases/" + uuid.NewString()
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	rows, err := repo.PublishedVariants(context.Background(), "linux", "0.8.0", "stable",
		[]string{"x86_64-deb", "x86_64-rpm", "x86_64-appimage"})
	if err != nil || len(rows) != 1 || rows[0].Arch != "x86_64-deb" {
		t.Fatalf("变体身份或状态过滤失效：rows=%+v err=%v", rows, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := repo.PublishedVariants(ctx, "linux", "0.8.0", "stable", []string{"x86_64-deb"}); err == nil {
		t.Fatal("查询失败不能伪装成没有变体")
	}
}
