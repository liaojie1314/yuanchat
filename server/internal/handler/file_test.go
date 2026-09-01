package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	miniocreds "github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/yuanchat/server/internal/config"
	"github.com/yuanchat/server/internal/storage"
	"go.uber.org/zap"
)

// TestMain 静默 gin 调试日志，保持测试输出干净。
func TestMain(m *testing.M) {
	gin.SetMode(gin.TestMode)
	os.Exit(m.Run())
}

// testUploadCfg 复刻 config.yaml 的 upload 段（白名单 + 100MB 上限）。
func testUploadCfg() config.UploadConfig {
	return config.UploadConfig{
		MaxFileSize: 104857600, // 100MB
		AllowedTypes: []string{
			"image/jpeg", "image/png", "image/gif", "image/webp",
			"application/pdf", "text/plain",
		},
	}
}

// stubACL 对象授权桩：allow 决定判定结果，err 非空则模拟查库失败。
type stubACL struct {
	allow bool
	err   error
	calls []string
}

func (s *stubACL) CanRead(_ context.Context, _ uuid.UUID, objectKey string) (bool, error) {
	s.calls = append(s.calls, objectKey)
	return s.allow, s.err
}

// testUserID 挂在 gin.Context 上的测试用户（真实链路由 AuthRequired 中间件写入）。
var testUserID = uuid.MustParse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")

// newFileEngine 挂载文件端点到独立 gin 引擎，st 传 nil 可验证降级 503。
//
// acl 为 nil 时不注入授权判定，用于验证 fail-closed（漏接线 → 私有对象一律拒绝）。
func newFileEngine(st *storage.Storage, acl ObjectACL) *gin.Engine {
	h := NewFileHandler(st, testUploadCfg(), zap.NewNop())
	if acl != nil {
		h.SetObjectACL(acl)
	}
	r := gin.New()
	// 模拟 AuthRequired：把 user_id 放进上下文，供 DownloadURL 取用
	r.Use(func(c *gin.Context) {
		c.Set("user_id", testUserID)
		c.Next()
	})
	r.POST("/files/upload-url", h.UploadURL)
	r.GET("/files/download-url", h.DownloadURL)
	return r
}

type apiResp struct {
	Code    int            `json:"code"`
	Message string         `json:"message"`
	Data    map[string]any `json:"data"`
}

func doJSON(t *testing.T, r *gin.Engine, method, target string, body any) (*httptest.ResponseRecorder, apiResp) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, target, reader)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var resp apiResp
	if w.Body.Len() > 0 {
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode response %q: %v", w.Body.String(), err)
		}
	}
	return w, resp
}

// --- 纯 handler 校验逻辑单测（无需 MinIO）---

// TestUploadURL_UnsupportedType 非白名单 content_type → 400 code=4001。
func TestUploadURL_UnsupportedType(t *testing.T) {
	r := newFileEngine(nil, &stubACL{allow: true})
	w, resp := doJSON(t, r, http.MethodPost, "/files/upload-url", gin.H{
		"filename": "clip.mp4", "content_type": "video/mp4", "size": 1024,
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	if resp.Code != 4001 {
		t.Fatalf("code = %d, want 4001", resp.Code)
	}
}

// TestUploadURL_FileTooLarge 白名单类型但超上限 → 400 code=4002。
func TestUploadURL_FileTooLarge(t *testing.T) {
	r := newFileEngine(nil, &stubACL{allow: true})
	w, resp := doJSON(t, r, http.MethodPost, "/files/upload-url", gin.H{
		"filename": "big.png", "content_type": "image/png", "size": 104857601,
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	if resp.Code != 4002 {
		t.Fatalf("code = %d, want 4002", resp.Code)
	}
}

// TestUploadURL_NilStorage503 校验通过但 storage 为 nil → 503。
func TestUploadURL_NilStorage503(t *testing.T) {
	r := newFileEngine(nil, &stubACL{allow: true})
	w, _ := doJSON(t, r, http.MethodPost, "/files/upload-url", gin.H{
		"filename": "ok.png", "content_type": "image/png", "size": 2048,
	})
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", w.Code)
	}
}

// TestUploadURL_DirtyExtension 文件名扩展名脏 → 生成的键无法通过 download 正则 → 提前拦成 400 code=4001，
// 避免对象上传后永久取不回。覆盖无扩展名、尾随空格、尾随点、非字母数字扩展名。
func TestUploadURL_DirtyExtension(t *testing.T) {
	r := newFileEngine(nil, &stubACL{allow: true})
	for _, filename := range []string{
		"README",     // 无扩展名 → ext ""
		"photo.png ", // 尾随空格 → ext ".png "
		"x.",         // 尾随点 → ext "."
		"x.p+g",      // 非字母数字 → ext ".p+g"
	} {
		w, resp := doJSON(t, r, http.MethodPost, "/files/upload-url", gin.H{
			"filename": filename, "content_type": "image/png", "size": 1024,
		})
		if w.Code != http.StatusBadRequest {
			t.Fatalf("filename=%q status = %d, want 400", filename, w.Code)
		}
		if resp.Code != 4001 {
			t.Fatalf("filename=%q code = %d, want 4001", filename, resp.Code)
		}
	}
}

// TestDownloadURL_InvalidKey 非法 key（任意路径探测）→ 400。
func TestDownloadURL_InvalidKey(t *testing.T) {
	r := newFileEngine(nil, &stubACL{allow: true})
	for _, key := range []string{
		"",
		"../../etc/passwd",
		"images/2026/7/abc.png",   // 月份非两位
		"videos/2026/07/abc.mp4",  // 类别不在白名单
		"images/2026/07/abc.PNG",  // 扩展名大写
		"images/2026/07/",         // 缺文件名
		"images/2026/07/ab$c.png", // 非法字符
	} {
		w, _ := doJSON(t, r, http.MethodGet, "/files/download-url?key="+key, nil)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("key=%q status = %d, want 400", key, w.Code)
		}
	}
}

// TestDownloadURL_NilStorage503 合法 key 但 storage 为 nil → 503。
func TestDownloadURL_NilStorage503(t *testing.T) {
	r := newFileEngine(nil, &stubACL{allow: true})
	w, _ := doJSON(t, r, http.MethodGet,
		"/files/download-url?key=images/2026/07/550e8400-e29b-41d4-a716-446655440000.png", nil)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", w.Code)
	}
}

// TestResolveCategory 类别推断：显式 query 优先、image/* 落 images、其余落 files、非法回落 files。
func TestResolveCategory(t *testing.T) {
	cases := []struct {
		contentType string
		query       string
		want        string
	}{
		{"image/png", "", "images"},
		{"image/webp", "", "images"},
		{"application/pdf", "", "files"},
		{"text/plain", "", "files"},
		{"image/png", "avatars", "avatars"}, // 头像：图片但显式落 avatars
		{"image/png", "files", "files"},
		{"application/pdf", "images", "images"},
		{"image/png", "sticker-covers", "sticker-covers"}, // 封面：仅显式指定，不靠 content-type 推断
		{"image/png", "bogus", "files"},                   // 非法 query 回落 files
	}
	for _, tc := range cases {
		if got := resolveCategory(tc.contentType, tc.query); got != tc.want {
			t.Errorf("resolveCategory(%q,%q)=%q, want %q", tc.contentType, tc.query, got, tc.want)
		}
	}
}

// TestBuildObjectKey 生成的 key 必须匹配下载正则（上传/下载契约自洽），且携带正确类别与小写扩展名。
func TestBuildObjectKey(t *testing.T) {
	key := buildObjectKey("images", "Photo.PNG")
	if !objectKeyPattern.MatchString(key) {
		t.Fatalf("key %q does not match download pattern", key)
	}
	wantPrefix := "images/" + time.Now().Format("2006/01") + "/"
	if len(key) <= len(wantPrefix) || key[:len(wantPrefix)] != wantPrefix {
		t.Fatalf("key %q missing prefix %q", key, wantPrefix)
	}
	if key[len(key)-4:] != ".png" {
		t.Fatalf("key %q ext not lowercased to .png", key)
	}
}

// --- 集成测试：真实 MinIO 预签名（不可达时跳过，模式同 storage 包）---

func testStorageForHandler(t *testing.T) *storage.Storage {
	t.Helper()
	minioCfg := config.MinIOConfig{
		Endpoint:  "localhost:9002",
		AccessKey: "yuanchat_minio",
		SecretKey: "yuanchat_minio_dev",
		Bucket:    "yuanchat",
		UseSSL:    false,
	}
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get("http://" + minioCfg.Endpoint + "/minio/health/live")
	if err != nil {
		t.Skipf("dev minio unavailable, skip integration test: %v", err)
	}
	resp.Body.Close()

	st, err := storage.New(minioCfg)
	if err != nil {
		// :9000 有 MinIO 在跑但不是本项目的（如其他项目容器占用端口）：凭据/桶校验失败，
		// 等价于「本项目 MinIO 不可用」，跳过而非失败
		t.Skipf("minio on :9002 is not yuanchat's (credential/bucket mismatch), skip: %v", err)
	}
	return st
}

// removeObject 用独立 minio 客户端清理测试对象（handler 包无法触及 storage 内部 client）。
func removeObject(t *testing.T, key string) {
	t.Helper()
	client, err := minio.New("localhost:9002", &minio.Options{
		Creds:  miniocreds.NewStaticV4("yuanchat_minio", "yuanchat_minio_dev", ""),
		Secure: false,
	})
	if err != nil {
		t.Logf("cleanup client init failed: %v", err)
		return
	}
	_ = client.RemoveObject(context.Background(), "yuanchat", key, minio.RemoveObjectOptions{})
}

// TestUploadURL_RealPresignRoundTrip 走真实 MinIO：签发上传 URL → PUT 直传 → download-url → GET 拉回校验。
func TestUploadURL_RealPresignRoundTrip(t *testing.T) {
	st := testStorageForHandler(t)
	r := newFileEngine(st, &stubACL{allow: true})

	// 1. 普通图片：无 public_url，object_key 匹配下载正则，expires_in=900。
	w, resp := doJSON(t, r, http.MethodPost, "/files/upload-url", gin.H{
		"filename": "cat.png", "content_type": "image/png", "size": 4096,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("upload-url status = %d body=%s", w.Code, w.Body.String())
	}
	objectKey, _ := resp.Data["object_key"].(string)
	uploadURL, _ := resp.Data["upload_url"].(string)
	if !objectKeyPattern.MatchString(objectKey) {
		t.Fatalf("object_key %q invalid", objectKey)
	}
	if _, ok := resp.Data["public_url"]; ok {
		t.Fatalf("non-avatar response must not carry public_url: %v", resp.Data)
	}
	if got := int(resp.Data["expires_in"].(float64)); got != 900 {
		t.Fatalf("expires_in = %d, want 900", got)
	}
	t.Cleanup(func() { removeObject(t, objectKey) })

	// 2. 真实 PUT 上传，证明签名 URL 可用。
	payload := []byte("fake-png-bytes")
	putReq, _ := http.NewRequest(http.MethodPut, uploadURL, bytes.NewReader(payload))
	putReq.Header.Set("Content-Type", "image/png")
	putReq.ContentLength = int64(len(payload))
	putResp, err := http.DefaultClient.Do(putReq)
	if err != nil {
		t.Fatalf("put upload: %v", err)
	}
	putResp.Body.Close()
	if putResp.StatusCode != http.StatusOK {
		t.Fatalf("put status = %d, want 200", putResp.StatusCode)
	}

	// 3. download-url 校验并签发 GET，实际拉回内容需一致，expires_in=7200（TTL 2h）。
	wg, dresp := doJSON(t, r, http.MethodGet, "/files/download-url?key="+objectKey, nil)
	if wg.Code != http.StatusOK {
		t.Fatalf("download-url status = %d body=%s", wg.Code, wg.Body.String())
	}
	if got := int(dresp.Data["expires_in"].(float64)); got != 7200 {
		t.Fatalf("download expires_in = %d, want 7200", got)
	}
	getURL, _ := dresp.Data["url"].(string)
	getResp, err := http.Get(getURL)
	if err != nil {
		t.Fatalf("get object: %v", err)
	}
	defer getResp.Body.Close()
	got, _ := io.ReadAll(getResp.Body)
	if !bytes.Equal(got, payload) {
		t.Fatalf("round-trip mismatch: got %q want %q", got, payload)
	}
}

// TestUploadURL_AvatarPublicURL 头像类别（?category=avatars）响应须带 public_url 且形如公共 URL。
func TestUploadURL_AvatarPublicURL(t *testing.T) {
	st := testStorageForHandler(t)
	r := newFileEngine(st, &stubACL{allow: true})

	w, resp := doJSON(t, r, http.MethodPost, "/files/upload-url?category=avatars", gin.H{
		"filename": "me.png", "content_type": "image/png", "size": 2048,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	objectKey, _ := resp.Data["object_key"].(string)
	if objectKey[:8] != "avatars/" {
		t.Fatalf("object_key %q must start with avatars/", objectKey)
	}
	publicURL, ok := resp.Data["public_url"].(string)
	if !ok || publicURL == "" {
		t.Fatalf("avatar response missing public_url: %v", resp.Data)
	}
	want := fmt.Sprintf("http://localhost:9002/yuanchat/%s", objectKey)
	if publicURL != want {
		t.Fatalf("public_url = %q, want %q", publicURL, want)
	}
}

// TestDownloadURL_DeniesUnauthorizedObject 无权读取的 key → 403，且不签发任何 URL。
//
// 此前本端点只校验 key 格式，任何登录用户都能为任意合法格式的 key
// 换到预签名 GET（撤回/退群对已泄漏的 key 也毫无约束力）。
func TestDownloadURL_DeniesUnauthorizedObject(t *testing.T) {
	st := testStorageForHandler(t)
	acl := &stubACL{allow: false}
	r := newFileEngine(st, acl)

	key := "images/2026/07/550e8400-e29b-41d4-a716-446655440000.png"
	w, resp := doJSON(t, r, http.MethodGet, "/files/download-url?key="+key, nil)
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 body=%s", w.Code, w.Body.String())
	}
	if _, ok := resp.Data["url"]; ok {
		t.Fatalf("拒绝时不应返回任何 URL: %v", resp.Data)
	}
	if len(acl.calls) != 1 || acl.calls[0] != key {
		t.Fatalf("ACL 应按原始 key 判定一次，got %v", acl.calls)
	}
}

// TestDownloadURL_AvatarsBypassACL 头像前缀是桶级公共读，跳过对象授权。
func TestDownloadURL_AvatarsBypassACL(t *testing.T) {
	st := testStorageForHandler(t)
	// allow=false：若头像也走 ACL，这里会 403
	acl := &stubACL{allow: false}
	r := newFileEngine(st, acl)

	w, _ := doJSON(t, r, http.MethodGet,
		"/files/download-url?key=avatars/2026/07/550e8400-e29b-41d4-a716-446655440000.png", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 body=%s", w.Code, w.Body.String())
	}
	if len(acl.calls) != 0 {
		t.Fatalf("头像不应触发 ACL 查询，got %v", acl.calls)
	}
}

// TestDownloadURL_FailsClosedWithoutACL 未注入 ACL（漏接线）→ 500，绝不放行。
func TestDownloadURL_FailsClosedWithoutACL(t *testing.T) {
	st := testStorageForHandler(t)
	r := newFileEngine(st, nil)

	w, resp := doJSON(t, r, http.MethodGet,
		"/files/download-url?key=images/2026/07/550e8400-e29b-41d4-a716-446655440000.png", nil)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 body=%s", w.Code, w.Body.String())
	}
	if _, ok := resp.Data["url"]; ok {
		t.Fatalf("漏接线时不应签发 URL: %v", resp.Data)
	}
}

// TestDownloadURL_ACLErrorIs500 授权查库失败 → 500（不能静默放行也不能假装 403）。
func TestDownloadURL_ACLErrorIs500(t *testing.T) {
	st := testStorageForHandler(t)
	r := newFileEngine(st, &stubACL{err: errors.New("db down")})

	w, _ := doJSON(t, r, http.MethodGet,
		"/files/download-url?key=images/2026/07/550e8400-e29b-41d4-a716-446655440000.png", nil)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 body=%s", w.Code, w.Body.String())
	}
}

// TestUploadURL_StickerCoversPublicRead 表情包封面的公共读通道：
// category=sticker-covers 签发的上传 URL 直传后匿名可取（免下载授权），
// download-url 对该前缀不咨询 ACL（公共读前缀签与不签都能取）。
func TestUploadURL_StickerCoversPublicRead(t *testing.T) {
	st := testStorageForHandler(t)
	r := newFileEngine(st, &stubACL{allow: true})

	w, resp := doJSON(t, r, http.MethodPost, "/files/upload-url?category=sticker-covers", gin.H{
		"filename": "cover.png", "content_type": "image/png", "size": 4096,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("upload-url status = %d body=%s", w.Code, w.Body.String())
	}
	objectKey, _ := resp.Data["object_key"].(string)
	publicURL, hasPublic := resp.Data["public_url"].(string)
	if !hasPublic || publicURL == "" {
		t.Fatalf("sticker-covers upload must return public_url, got %v", resp.Data)
	}
	t.Cleanup(func() { removeObject(t, objectKey) })

	// 直传封面字节
	payload := []byte("fake-cover-bytes")
	putReq, _ := http.NewRequest(http.MethodPut, resp.Data["upload_url"].(string), bytes.NewReader(payload))
	putReq.Header.Set("Content-Type", "image/png")
	putReq.ContentLength = int64(len(payload))
	putResp, err := http.DefaultClient.Do(putReq)
	if err != nil {
		t.Fatalf("put cover: %v", err)
	}
	putResp.Body.Close()
	if putResp.StatusCode != http.StatusOK {
		t.Fatalf("put status = %d, want 200", putResp.StatusCode)
	}

	// 公共 URL 匿名 GET 直达（桶策略对该前缀开放匿名读）
	getResp, err := http.Get(publicURL)
	if err != nil {
		t.Fatalf("anonymous get: %v", err)
	}
	getResp.Body.Close()
	if getResp.StatusCode != http.StatusOK {
		t.Fatalf("anonymous get status = %d, want 200 (bucket policy missing sticker-covers statement?)", getResp.StatusCode)
	}

	// download-url 不咨询 ACL（stubACL.calls 为空），直接签发预签名
	acl := &stubACL{allow: true}
	rd := newFileEngine(st, acl)
	wg, dresp := doJSON(t, rd, http.MethodGet, "/files/download-url?key="+objectKey, nil)
	if wg.Code != http.StatusOK {
		t.Fatalf("download-url status = %d body=%s", wg.Code, wg.Body.String())
	}
	if len(acl.calls) != 0 {
		t.Fatalf("public-read prefix must bypass ACL, acl consulted %v", acl.calls)
	}
	if _, ok := dresp.Data["url"].(string); !ok {
		t.Fatalf("download-url should return url: %v", dresp.Data)
	}
}
