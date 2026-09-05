package storage

import (
	"strings"
	"testing"
)

// TestRewriteHostReplacesInternalEndpoint 预签名 URL 的 host 必须换成对外端点，
// 否则客户端拿到 minio:9000 这种内网名根本解析不了（生产图片/语音/头像全废）。
func TestRewriteHostReplacesInternalEndpoint(t *testing.T) {
	s := &Storage{
		endpoint:       "minio:9000",
		publicEndpoint: "storage.example.com",
		publicUseSSL:   true,
		bucket:         "yuanchat",
	}
	in := "http://minio:9000/yuanchat/images/2026/09/x.png?X-Amz-Signature=abc&X-Amz-Expires=3600"
	got := s.rewriteHost(in)

	if !strings.HasPrefix(got, "https://storage.example.com/") {
		t.Errorf("rewriteHost = %q, want https://storage.example.com/ prefix", got)
	}
	// 签名参数必须原样保留，否则 MinIO 校验失败
	if !strings.Contains(got, "X-Amz-Signature=abc") {
		t.Error("签名参数丢失")
	}
	if !strings.Contains(got, "X-Amz-Expires=3600") {
		t.Error("过期参数丢失")
	}
	if !strings.Contains(got, "/yuanchat/images/2026/09/x.png") {
		t.Error("对象路径被破坏")
	}
}

// TestRewriteHostFallsBackWhenUnset 未配对外端点时原样返回 —— dev 环境行为零变化。
func TestRewriteHostFallsBackWhenUnset(t *testing.T) {
	s := &Storage{endpoint: "localhost:9002", bucket: "yuanchat"}
	in := "http://localhost:9002/yuanchat/a.png?sig=1"
	if got := s.rewriteHost(in); got != in {
		t.Errorf("rewriteHost = %q, want unchanged %q", got, in)
	}
}

// TestRewriteHostHonorsPublicSSLFlag 对外端点不启用 TLS 时须落到 http，
// 不能沿用内网建连的 scheme（两者互不相干）。
func TestRewriteHostHonorsPublicSSLFlag(t *testing.T) {
	s := &Storage{endpoint: "minio:9000", publicEndpoint: "storage.local", publicUseSSL: false}
	got := s.rewriteHost("http://minio:9000/yuanchat/a.png")
	if !strings.HasPrefix(got, "http://storage.local/") {
		t.Errorf("rewriteHost = %q, want http scheme when publicUseSSL=false", got)
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
