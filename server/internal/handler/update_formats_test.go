package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/yuanchat/server/internal/model"
)

// TestUpdates_DesktopFormats 返回安装器精确键，旧客户端无需新增查询参数也不会拿错包。
func TestUpdates_DesktopFormats(t *testing.T) {
	for _, tc := range []struct {
		platform string
		formats  []string
	}{
		{"linux", []string{"deb", "rpm", "appimage"}},
		{"windows", []string{"msi", "nsis"}},
	} {
		t.Run(tc.platform, func(t *testing.T) {
			db := packTestDB(t)
			base := seedPublished(t, db, tc.platform, "x86_64", "0.8.0")
			p := &stubPresigner{urls: map[string]string{base.ObjectKey: "https://cdn.example/base-installer"}}
			for _, format := range tc.formats {
				rel := seedRel(t, db, model.AppRelease{
					Platform: tc.platform, Arch: "x86_64-" + format, Version: "0.8.0",
					Status: model.ReleaseStatusPublished, Rollout: 100, Signature: format + "-sig",
				})
				p.urls[rel.ObjectKey] = "https://cdn.example/app-0.8.0." + format
			}
			r := newUpdateEngine(db, p)
			w := doGetNoAuth(t, r, "/api/v1/updates/"+tc.platform+"/x86_64?version=0.7.0")
			if w.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			var body struct {
				Version   string `json:"version"`
				PubDate   string `json:"pub_date"`
				Platforms map[string]struct {
					URL       string `json:"url"`
					Signature string `json:"signature"`
				} `json:"platforms"`
				URL       *string         `json:"url"`
				Signature *string         `json:"signature"`
				Data      json.RawMessage `json:"data"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body.Version != "0.8.0" || len(body.Platforms) != len(tc.formats) {
				t.Fatalf("须返回同一版本的完整格式清单：%s", w.Body.String())
			}
			for _, format := range tc.formats {
				item := body.Platforms[tc.platform+"-x86_64-"+format]
				if item.URL != "https://cdn.example/app-0.8.0."+format || item.Signature != format+"-sig" {
					t.Errorf("%s URL 或签名不匹配：%+v", format, item)
				}
			}
			if body.URL != nil || body.Signature != nil || len(body.Data) != 0 {
				t.Fatalf("桌面清单不得带 dynamic 包或 data 外层：%s", w.Body.String())
			}
			if _, err := time.Parse(time.RFC3339, body.PubDate); err != nil {
				t.Fatalf("无效发布日期：%v", err)
			}
		})
	}
}

// TestUpdates_MissingFormatNeverFallsBack 缺少 deb 时不能通过通用键把 AppImage 发给 deb 客户端。
func TestUpdates_MissingFormatNeverFallsBack(t *testing.T) {
	db := packTestDB(t)
	base := seedPublished(t, db, "linux", "x86_64", "0.8.0")
	appimage := seedPublished(t, db, "linux", "x86_64-appimage", "0.8.0")
	seedPublished(t, db, "linux", "x86_64-deb", "0.7.5")
	seedPublished(t, db, "linux", "x86_64-rpm", "0.9.0")
	r := newUpdateEngine(db, &stubPresigner{urls: map[string]string{
		base.ObjectKey:     "https://cdn.example/base-installer",
		appimage.ObjectKey: "https://cdn.example/app-0.8.0.AppImage",
	}})
	w := doGetNoAuth(t, r, "/api/v1/updates/linux/x86_64?version=0.7.0")
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var body struct {
		Version   string                     `json:"version"`
		Platforms map[string]json.RawMessage `json:"platforms"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Version != "0.8.0" || len(body.Platforms) != 1 || body.Platforms["linux-x86_64-appimage"] == nil {
		t.Fatalf("缺失格式不能补旧版、新版或通用 fallback：%s", w.Body.String())
	}
}

// TestUpdates_DesktopMissingObjects 已发布对象缺失或存储故障必须返回 5xx，不能伪装成没有更新。
func TestUpdates_DesktopMissingObjects(t *testing.T) {
	for _, tc := range []struct {
		name     string
		missing  bool
		statErr  error
		wantCode int
	}{
		{"missing", true, nil, http.StatusInternalServerError},
		{"storage failure", false, errors.New("storage unavailable"), http.StatusInternalServerError},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := packTestDB(t)
			seedPublished(t, db, "linux", "x86_64", "0.8.0")
			deb := seedPublished(t, db, "linux", "x86_64-deb", "0.8.0")
			p := &stubPresigner{url: "https://cdn.example/app.deb", statErr: tc.statErr,
				missingObjects: map[string]bool{deb.ObjectKey: tc.missing}}
			w := doGetNoAuth(t, newUpdateEngine(db, p), "/api/v1/updates/linux/x86_64?version=0.7.0")
			if w.Code != tc.wantCode {
				t.Fatalf("status=%d want=%d body=%s", w.Code, tc.wantCode, w.Body.String())
			}
			if len(p.keys) != 0 {
				t.Fatalf("缺失或无法确认的对象不能签发 URL：%v", p.keys)
			}
		})
	}
}

// TestUpdates_DesktopIncompleteRecords 仅对已放量的残缺记录报错，未放量记录不影响检查。
func TestUpdates_DesktopIncompleteRecords(t *testing.T) {
	for _, field := range []string{"signature", "object_key"} {
		t.Run(field, func(t *testing.T) {
			db := packTestDB(t)
			seedPublished(t, db, "linux", "x86_64", "0.8.0")
			rel := seedPublished(t, db, "linux", "x86_64-deb", "0.8.0")
			if err := db.Model(rel).Update(field, " ").Error; err != nil {
				t.Fatal(err)
			}
			r := newUpdateEngine(db, &stubPresigner{url: "https://cdn.example/app.deb"})
			w := doGetNoAuth(t, r, "/api/v1/updates/linux/x86_64?version=0.7.0")
			if w.Code != http.StatusInternalServerError {
				t.Fatalf("已发布且放量的残缺记录必须报错：status=%d body=%s", w.Code, w.Body.String())
			}
			if err := db.Model(rel).Update("rollout", 0).Error; err != nil {
				t.Fatal(err)
			}
			w = doGetNoAuth(t, r, "/api/v1/updates/linux/x86_64?version=0.7.0")
			if w.Code != http.StatusNoContent {
				t.Fatalf("暂停的变体不能触发备用源：status=%d body=%s", w.Code, w.Body.String())
			}
		})
	}
}

// TestUpdates_DarwinAppVariants 通用 app 归到请求架构，精确 app 未中灰度不能改拿通用包。
func TestUpdates_DarwinAppVariants(t *testing.T) {
	db := packTestDB(t)
	base := seedPublished(t, db, "darwin", "universal", "0.8.0")
	app := seedPublished(t, db, "darwin", "universal-app", "0.8.0")
	p := &stubPresigner{urls: map[string]string{
		base.ObjectKey: "https://cdn.example/app.dmg",
		app.ObjectKey:  "https://cdn.example/app-universal.app.tar.gz",
	}}
	r := newUpdateEngine(db, p)
	for _, arch := range []string{"x86_64", "aarch64"} {
		w := doGetNoAuth(t, r, "/api/v1/updates/darwin/"+arch+"?version=0.7.0")
		var body struct {
			Platforms map[string]struct {
				URL string `json:"url"`
			} `json:"platforms"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if w.Code != http.StatusOK || len(body.Platforms) != 1 ||
			body.Platforms["darwin-"+arch+"-app"].URL != "https://cdn.example/app-universal.app.tar.gz" {
			t.Fatalf("%s 未使用同版本通用 app：status=%d body=%s", arch, w.Code, w.Body.String())
		}
	}
	exact := seedRel(t, db, model.AppRelease{
		Platform: "darwin", Arch: "aarch64-app", Version: "0.8.0",
		Status: model.ReleaseStatusPublished, Rollout: 0, Signature: "sig",
	})
	w := doGetNoAuth(t, r, "/api/v1/updates/darwin/aarch64?version=0.7.0")
	if w.Code != http.StatusNoContent {
		t.Fatalf("精确 app 暂停时不得回落通用 app：status=%d body=%s", w.Code, w.Body.String())
	}
	p.urls[exact.ObjectKey] = "https://cdn.example/app-aarch64.app.tar.gz"
	if err := db.Model(exact).Update("rollout", 100).Error; err != nil {
		t.Fatal(err)
	}
	w = doGetNoAuth(t, r, "/api/v1/updates/darwin/aarch64?version=0.7.0")
	var body struct {
		Platforms map[string]struct {
			URL string `json:"url"`
		} `json:"platforms"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if w.Code != http.StatusOK || body.Platforms["darwin-aarch64-app"].URL != "https://cdn.example/app-aarch64.app.tar.gz" {
		t.Fatalf("精确 app 应优先：status=%d body=%s", w.Code, w.Body.String())
	}
}

// TestUpdates_VariantRollout 变体灰度未命中时省略对应格式，不得绕到基础包或别的版本。
func TestUpdates_VariantRollout(t *testing.T) {
	db := packTestDB(t)
	seedPublished(t, db, "windows", "x86_64", "0.8.0")
	seedPublished(t, db, "windows", "x86_64-nsis", "0.8.0")
	seedRel(t, db, model.AppRelease{
		Platform: "windows", Arch: "x86_64-msi", Version: "0.8.0",
		Status: model.ReleaseStatusPublished, Rollout: 50, Signature: "sig",
	})
	r := newUpdateEngine(db, &stubPresigner{url: "https://cdn.example/app"})
	for _, tc := range []struct {
		cohort string
		want   int
	}{{"49", 2}, {"50", 1}} {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/updates/windows/x86_64?version=0.7.0", nil)
		req.Header.Set("X-YuanChat-Update-Cohort", tc.cohort)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var body struct {
			Platforms map[string]json.RawMessage `json:"platforms"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if w.Code != http.StatusOK || len(body.Platforms) != tc.want ||
			(tc.want == 1 && body.Platforms["windows-x86_64-nsis"] == nil) {
			t.Errorf("cohort=%s 清单错误：status=%d body=%s", tc.cohort, w.Code, w.Body.String())
		}
	}
}

// TestUpdates_RequestedBundle 指定安装器时，其他格式的配置故障和灰度状态不能影响当前格式。
func TestUpdates_RequestedBundle(t *testing.T) {
	for _, tc := range []struct {
		name, bundle, status string
		rollout              int16
		want                 int
	}{
		{"missing", "deb", "", 100, http.StatusNoContent},
		{"draft", "deb", model.ReleaseStatusDraft, 100, http.StatusNoContent},
		{"outside rollout", "deb", model.ReleaseStatusPublished, 50, http.StatusNoContent},
		{"rolled back", "deb", model.ReleaseStatusRolledBack, 100, http.StatusNoContent},
		{"available", "deb", model.ReleaseStatusPublished, 100, http.StatusOK},
		{"unsupported", "msi", model.ReleaseStatusPublished, 100, http.StatusNoContent},
		{"legacy checks all", "", model.ReleaseStatusPublished, 100, http.StatusInternalServerError},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := packTestDB(t)
			seedPublished(t, db, "linux", "x86_64", "0.8.0")
			broken := seedRel(t, db, model.AppRelease{
				Platform: "linux", Arch: "x86_64-appimage", Version: "0.8.0",
				Status: model.ReleaseStatusPublished, Rollout: 100,
			})
			if tc.status != "" {
				seedRel(t, db, model.AppRelease{
					Platform: "linux", Arch: "x86_64-deb", Version: "0.8.0",
					Status: tc.status, Rollout: tc.rollout, Signature: "deb-sig",
				})
			}
			r := newUpdateEngine(db, &stubPresigner{
				url: "https://cdn.example/app.deb", missingObjects: map[string]bool{broken.ObjectKey: true},
			})
			req := httptest.NewRequest(http.MethodGet,
				"/api/v1/updates/linux/x86_64?version=0.7.0&bundle_type="+tc.bundle, nil)
			req.Header.Set("X-YuanChat-Update-Cohort", "50")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("status=%d want=%d body=%s", w.Code, tc.want, w.Body.String())
			}
			if tc.want == http.StatusOK {
				var body struct {
					Platforms map[string]struct {
						URL       string `json:"url"`
						Signature string `json:"signature"`
					} `json:"platforms"`
				}
				if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
					t.Fatal(err)
				}
				item := body.Platforms["linux-x86_64-deb"]
				if len(body.Platforms) != 1 || item.URL != "https://cdn.example/app.deb" || item.Signature != "deb-sig" {
					t.Fatalf("只能返回请求格式：%s", w.Body.String())
				}
			}
		})
	}
}
