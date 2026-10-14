package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"github.com/yuanchat/server/internal/service"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// stubPresigner 预签名桩：对外端点不该在单测里真连 MinIO。
type stubPresigner struct {
	url  string
	err  error
	keys []string
}

func (s *stubPresigner) PresignGet(_ context.Context, objectKey string, _ time.Duration) (string, error) {
	s.keys = append(s.keys, objectKey)
	if s.err != nil {
		return "", s.err
	}
	return s.url, nil
}

// newUpdateEngine 把两个对外端点挂到独立 gin 引擎上（免鉴权，不加中间件）。
func newUpdateEngine(db *gorm.DB, p ReleasePresigner) *gin.Engine {
	svc := service.NewReleaseService(repository.NewReleaseRepository(db), zap.NewNop())
	h := NewUpdateHandler(svc, p, zap.NewNop())
	r := gin.New()
	r.GET("/api/v1/updates/catalog", h.Catalog)
	r.GET("/api/v1/updates/:platform/:arch", h.Check)
	return r
}

func doGetNoAuth(t *testing.T, r *gin.Engine, target string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// seedRel 插一条版本记录，用后清理。
func seedRel(t *testing.T, db *gorm.DB, rel model.AppRelease) *model.AppRelease {
	t.Helper()
	rel.ID = uuid.New()
	if rel.Channel == "" {
		rel.Channel = model.ReleaseChannelStable
	}
	if rel.ObjectKey == "" {
		rel.ObjectKey = "releases/" + rel.Platform + "-" + rel.Arch + "-" + rel.Version
	}
	if rel.Status == model.ReleaseStatusPublished && rel.PublishedAt == nil {
		now := time.Now()
		rel.PublishedAt = &now
	}
	if err := db.Create(&rel).Error; err != nil {
		t.Fatalf("seed release: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(&rel) })
	return &rel
}

func seedPublished(t *testing.T, db *gorm.DB, platform, arch, version string) *model.AppRelease {
	t.Helper()
	return seedRel(t, db, model.AppRelease{
		Platform: platform, Arch: arch, Version: version,
		Status: model.ReleaseStatusPublished, Rollout: 100,
		Signature: "untrusted-comment:sig\nRWQ...", Notes: "本版修了若干问题",
	})
}

// TestUpdates_204WhenNoNewer 无更新返 204 空体。
//
// Tauri updater 的约定：返 200 带同版本号它会当成「有更新」然后下载同一个包
// 再装一遍，用户看到的是「更新完了还提示更新」。
func TestUpdates_204WhenNoNewer(t *testing.T) {
	db := packTestDB(t)
	seedPublished(t, db, "linux", "x86_64", "0.7.0")
	r := newUpdateEngine(db, &stubPresigner{url: "https://cdn.example/app"})

	w := doGetNoAuth(t, r, "/api/v1/updates/linux/x86_64?version=0.7.0")
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204, body=%s", w.Code, w.Body.String())
	}
	if w.Body.Len() != 0 {
		t.Fatalf("204 必须是空体，实际 %q", w.Body.String())
	}
}

// TestUpdates_200WithFlatBody 更新体是扁平的 dynamic 格式，不包 {data:...} 外层。
//
// tauri-plugin-updater 直接解析响应体根对象（RemoteRelease 的手写 Deserialize，
// 判别依据是 platforms 字段在不在），包一层它读不到 version。
func TestUpdates_200WithFlatBody(t *testing.T) {
	db := packTestDB(t)
	seedPublished(t, db, "linux", "x86_64", "0.8.0")
	r := newUpdateEngine(db, &stubPresigner{url: "https://cdn.example/app-0.8.0"})

	w := doGetNoAuth(t, r, "/api/v1/updates/linux/x86_64?version=0.7.0&device=d1")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", w.Code, w.Body.String())
	}

	var body struct {
		Version   string          `json:"version"`
		Notes     string          `json:"notes"`
		PubDate   string          `json:"pub_date"`
		URL       string          `json:"url"`
		Signature string          `json:"signature"`
		Platforms json.RawMessage `json:"platforms"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %q: %v", w.Body.String(), err)
	}
	if body.Version != "0.8.0" {
		t.Fatalf("version = %q, want 0.8.0", body.Version)
	}
	if body.URL == "" {
		t.Fatal("url 为空，updater 反序列化会直接失败")
	}
	if body.Signature == "" {
		t.Fatal("signature 为空，updater 反序列化会直接失败")
	}
	// platforms 一出现 updater 就切到 static 格式，动态端点绝不能带它
	if len(body.Platforms) != 0 {
		t.Fatalf("动态格式不得带 platforms，实际 %s", body.Platforms)
	}
	// pub_date 必须是 RFC3339：格式不对会让**整个响应**反序列化失败，
	// 不是忽略该字段
	if _, err := time.Parse(time.RFC3339, body.PubDate); err != nil {
		t.Fatalf("pub_date = %q 不是 RFC3339: %v", body.PubDate, err)
	}
}

// TestUpdates_204WhenNotInRollout rollout=0 是运营的暂停开关。
func TestUpdates_204WhenNotInRollout(t *testing.T) {
	db := packTestDB(t)
	seedRel(t, db, model.AppRelease{
		Platform: "linux", Arch: "x86_64", Version: "0.8.0",
		Status: model.ReleaseStatusPublished, Rollout: 0, Signature: "sig",
	})
	r := newUpdateEngine(db, &stubPresigner{url: "https://cdn.example/app"})

	w := doGetNoAuth(t, r, "/api/v1/updates/linux/x86_64?version=0.7.0&device=d1")
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204, body=%s", w.Code, w.Body.String())
	}
}

// TestUpdates_RolloutStableAcrossRequests 同一设备多次请求必须拿到同一结论。
func TestUpdates_RolloutStableAcrossRequests(t *testing.T) {
	db := packTestDB(t)
	seedRel(t, db, model.AppRelease{
		Platform: "linux", Arch: "x86_64", Version: "0.8.0",
		Status: model.ReleaseStatusPublished, Rollout: 50, Signature: "sig",
	})
	r := newUpdateEngine(db, &stubPresigner{url: "https://cdn.example/app"})

	const target = "/api/v1/updates/linux/x86_64?version=0.7.0&device=fixed"
	first := doGetNoAuth(t, r, target).Code
	for i := 0; i < 20; i++ {
		if got := doGetNoAuth(t, r, target).Code; got != first {
			t.Fatalf("第 %d 次 = %d，首次 = %d：同一设备多次请求拿到了不同结论", i, got, first)
		}
	}
}

// TestUpdates_AndroidCarriesSha256 APK 没有 minisign 签名，客户端只能靠 sha256 校验。
func TestUpdates_AndroidCarriesSha256(t *testing.T) {
	db := packTestDB(t)
	seedRel(t, db, model.AppRelease{
		Platform: "android", Arch: "aarch64", Version: "0.8.0",
		Status: model.ReleaseStatusPublished, Rollout: 100,
		Sha256: "abc123", Size: 42 << 20,
	})
	r := newUpdateEngine(db, &stubPresigner{url: "https://cdn.example/app.apk"})

	w := doGetNoAuth(t, r, "/api/v1/updates/android/aarch64?version=0.7.0&device=d1")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", w.Code, w.Body.String())
	}
	var body struct {
		Sha256 string `json:"sha256"`
		Size   int64  `json:"size"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %q: %v", w.Body.String(), err)
	}
	if body.Sha256 != "abc123" {
		t.Fatalf("sha256 = %q, want abc123", body.Sha256)
	}
	if body.Size == 0 {
		t.Fatal("size 为 0，安卓侧进度条没法走确定态")
	}
}

// TestUpdates_UnknownPlatformIs204 未知平台当成「没有更新」而非报错。
//
// 这条区分很要紧：updater 收到 204 直接 return Ok(None)，**不会**继续试
// 下一个 endpoint；只有 5xx 才会落到 GitHub 兜底。所以「查不到记录」返 204
// （我确定没有更新），只在自身故障时返 5xx。
func TestUpdates_UnknownPlatformIs204(t *testing.T) {
	db := packTestDB(t)
	r := newUpdateEngine(db, &stubPresigner{url: "https://cdn.example/app"})

	w := doGetNoAuth(t, r, "/api/v1/updates/solaris/sparc?version=0.1.0")
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204, body=%s", w.Code, w.Body.String())
	}
}

// TestUpdates_PresignFailureIs500 自身故障必须返 5xx 而不是 204 ——
// 返 204 会让 updater 以为「确定没有更新」从而不去试 GitHub 兜底。
func TestUpdates_PresignFailureIs500(t *testing.T) {
	db := packTestDB(t)
	seedPublished(t, db, "linux", "x86_64", "0.8.0")
	r := newUpdateEngine(db, &stubPresigner{err: errors.New("minio down")})

	w := doGetNoAuth(t, r, "/api/v1/updates/linux/x86_64?version=0.7.0&device=d1")
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body=%s", w.Code, w.Body.String())
	}
}

// TestCatalog_OnlyPublished draft 不得出现在下载页。
func TestCatalog_OnlyPublished(t *testing.T) {
	db := packTestDB(t)
	seedPublished(t, db, "windows", "x86_64", "0.8.0")
	seedRel(t, db, model.AppRelease{
		Platform: "darwin", Arch: "universal", Version: "0.9.0",
		Status: model.ReleaseStatusDraft, Rollout: 100,
	})
	r := newUpdateEngine(db, &stubPresigner{url: "https://cdn.example/app"})

	w := doGetNoAuth(t, r, "/api/v1/updates/catalog")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if !strings.Contains(body, "windows") {
		t.Fatalf("已发布的 windows 版本应出现在目录里: %s", body)
	}
	if strings.Contains(body, "darwin") {
		t.Fatalf("draft 不得出现在下载页: %s", body)
	}
}

// TestCatalog_EmptyIsEmptyArrayNotNull 返 null 的话前端 .map 会炸。
func TestCatalog_EmptyIsEmptyArrayNotNull(t *testing.T) {
	db := packTestDB(t)
	r := newUpdateEngine(db, &stubPresigner{url: "https://cdn.example/app"})

	w := doGetNoAuth(t, r, "/api/v1/updates/catalog?channel=beta")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			Items []any `json:"items"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode %q: %v", w.Body.String(), err)
	}
	if resp.Data.Items == nil {
		t.Fatalf("空结果必须是 [] 而不是 null: %s", w.Body.String())
	}
}

// TestUpdates_503WhenStorageUnavailable st 为 nil（MinIO 不可达）时降级 503。
//
// 刻意不降级成 204：204 会让 Tauri updater 直接认定「确定没有更新」从此不问
// 第二个 endpoint，而 5xx 才会让它落到 GitHub 兜底。
func TestUpdates_503WhenStorageUnavailable(t *testing.T) {
	db := packTestDB(t)
	seedPublished(t, db, "linux", "x86_64", "0.8.0")
	// presigner 传 nil，模拟 router 在 st == nil 时的接线
	r := newUpdateEngine(db, nil)

	for _, target := range []string{
		"/api/v1/updates/linux/x86_64?version=0.7.0&device=d1",
		"/api/v1/updates/catalog",
	} {
		w := doGetNoAuth(t, r, target)
		if w.Code != http.StatusServiceUnavailable {
			t.Errorf("%s status = %d, want 503, body=%s", target, w.Code, w.Body.String())
		}
	}
}
