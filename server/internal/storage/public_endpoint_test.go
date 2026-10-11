package storage

import (
	"context"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/yuanchat/server/internal/config"
)

// newPresignOnlyStorage 只搭出签 URL 需要的部分，不碰网络。
//
// 不走 New()：那里会建桶、设策略，需要活的 MinIO。预签名本身是纯本地计算
// （region 已钉死，minio-go 不会再去问 GetBucketLocation），所以这里直接拼。
func newPresignOnlyStorage(t *testing.T, cfg config.MinIOConfig) *Storage {
	t.Helper()
	client, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
		Region: presignRegion,
	})
	if err != nil {
		t.Fatalf("建内网 client: %v", err)
	}
	presign := client
	if cfg.PublicEndpoint != "" {
		presign, err = minio.New(cfg.PublicEndpoint, &minio.Options{
			Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
			Secure: cfg.PublicUseSSL,
			Region: presignRegion,
		})
		if err != nil {
			t.Fatalf("建对外 client: %v", err)
		}
	}
	return &Storage{
		client:         client,
		presignClient:  presign,
		bucket:         cfg.Bucket,
		endpoint:       cfg.Endpoint,
		useSSL:         cfg.UseSSL,
		publicEndpoint: cfg.PublicEndpoint,
		publicUseSSL:   cfg.PublicUseSSL,
	}
}

func baseCfg() config.MinIOConfig {
	return config.MinIOConfig{
		Endpoint:       "minio:9000",
		AccessKey:      "testaccesskey",
		SecretKey:      "testsecretkey",
		Bucket:         "yuanchat",
		UseSSL:         false,
		PublicEndpoint: "storage.example.com",
		PublicUseSSL:   true,
	}
}

// sigOf 取出预签名 URL 里的签名值。
func sigOf(t *testing.T, raw string) string {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("解析 URL %q: %v", raw, err)
	}
	sig := u.Query().Get("X-Amz-Signature")
	if sig == "" {
		t.Fatalf("URL 里没有 X-Amz-Signature: %q", raw)
	}
	return sig
}

// TestPresignPutSignsOverPublicHost 这是本文件的核心不变量：
// 签名必须在**对外 host** 上计算，而不是先用内网 host 签完再替换 URL 里的 host。
//
// SigV4 把 host 头纳入签名，客户端请求的是对外域名、nginx 又透传 $host，
// 所以 MinIO 一定按对外域名重算。旧实现（内网 client 签 + rewriteHost 换字符串）
// 在生产上一律 403 SignatureDoesNotMatch —— 2026-10-09 实测：
// 按 minio:9000 签 403，按 storage.yuanyuan.blog 签 200。
//
// 判据：只改对外端点、其余全不动，签名就必须变。旧实现下签名恒定（只换 host 字符串），
// 本用例因此能挡住回退。
func TestPresignPutSignsOverPublicHost(t *testing.T) {
	ctx := context.Background()
	const key = "images/2026/10/x.png"

	cfg := baseCfg()
	a := newPresignOnlyStorage(t, cfg)
	urlA, err := a.PresignPut(ctx, key, "image/png", 15*time.Minute)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}
	if !strings.HasPrefix(urlA, "https://storage.example.com/yuanchat/"+key+"?") {
		t.Fatalf("预签名 URL = %q, 期望 https://storage.example.com 前缀", urlA)
	}

	cfg.PublicEndpoint = "cdn.other.example.com"
	b := newPresignOnlyStorage(t, cfg)
	urlB, err := b.PresignPut(ctx, key, "image/png", 15*time.Minute)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}

	if sigOf(t, urlA) == sigOf(t, urlB) {
		t.Error("换了对外端点签名却没变 —— 说明签名不是在对外 host 上算的，生产必然 SignatureDoesNotMatch")
	}
	if !strings.HasPrefix(urlB, "https://cdn.other.example.com/") {
		t.Errorf("预签名 URL = %q, 期望 https://cdn.other.example.com 前缀", urlB)
	}
}

// TestPresignGetSignsOverPublicHost 下载 URL 同理：私有对象（图片消息、文件、语音）
// 的读取全靠它，签错 host 就是整个媒体读路径 403。
func TestPresignGetSignsOverPublicHost(t *testing.T) {
	ctx := context.Background()
	const key = "files/2026/10/a.pdf"

	cfg := baseCfg()
	a := newPresignOnlyStorage(t, cfg)
	urlA, err := a.PresignGet(ctx, key, 15*time.Minute)
	if err != nil {
		t.Fatalf("PresignGet: %v", err)
	}

	cfg.PublicEndpoint = "cdn.other.example.com"
	b := newPresignOnlyStorage(t, cfg)
	urlB, err := b.PresignGet(ctx, key, 15*time.Minute)
	if err != nil {
		t.Fatalf("PresignGet: %v", err)
	}

	if sigOf(t, urlA) == sigOf(t, urlB) {
		t.Error("换了对外端点签名却没变 —— 下载 URL 同样会被 MinIO 拒掉")
	}
}

// TestPresignHonorsPublicSSLFlag 对外端点不启用 TLS 时须落到 http，
// 不能沿用内网建连的 scheme（两者互不相干）。
func TestPresignHonorsPublicSSLFlag(t *testing.T) {
	cfg := baseCfg()
	cfg.PublicEndpoint = "storage.local"
	cfg.PublicUseSSL = false
	s := newPresignOnlyStorage(t, cfg)

	got, err := s.PresignPut(context.Background(), "a.png", "image/png", time.Minute)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}
	if !strings.HasPrefix(got, "http://storage.local/") {
		t.Errorf("预签名 URL = %q, publicUseSSL=false 时应为 http://storage.local/", got)
	}
}

// TestPresignFallsBackToInternalWhenPublicUnset 未配对外端点时用内网地址签 —— dev 行为不变。
func TestPresignFallsBackToInternalWhenPublicUnset(t *testing.T) {
	cfg := baseCfg()
	cfg.Endpoint = "localhost:9002"
	cfg.PublicEndpoint = ""
	s := newPresignOnlyStorage(t, cfg)

	got, err := s.PresignPut(context.Background(), "a.png", "image/png", time.Minute)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}
	if !strings.HasPrefix(got, "http://localhost:9002/yuanchat/a.png?") {
		t.Errorf("预签名 URL = %q, 期望内网地址原样", got)
	}
}

// TestPublicURLUsesPublicEndpoint 头像直链同样要走对外端点。
func TestPublicURLUsesPublicEndpoint(t *testing.T) {
	s := &Storage{
		endpoint:       "minio:9000",
		publicEndpoint: "storage.example.com",
		publicUseSSL:   true,
		bucket:         "yuanchat",
	}
	got := s.PublicURL("avatars/u1.png")
	want := "https://storage.example.com/yuanchat/avatars/u1.png"
	if got != want {
		t.Errorf("PublicURL = %q, want %q", got, want)
	}
}

// TestPublicURLFallsBackToEndpoint 未配对外端点时用内网 endpoint 与 useSSL 拼接 —— dev 行为不变。
func TestPublicURLFallsBackToEndpoint(t *testing.T) {
	s := &Storage{endpoint: "localhost:9002", bucket: "yuanchat", useSSL: false}
	got := s.PublicURL("avatars/u1.png")
	want := "http://localhost:9002/yuanchat/avatars/u1.png"
	if got != want {
		t.Errorf("PublicURL = %q, want %q", got, want)
	}
}
