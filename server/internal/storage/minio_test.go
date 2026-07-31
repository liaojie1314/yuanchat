package storage

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/yuanchat/server/internal/config"
)

// testStorage 连接本地开发 MinIO（deploy/docker-compose.yml 的 minio :9002）。
// 服务不可达时跳过集成用例（CI 无对象存储环境仍绿），模式同 service 包的 testDB。
func testStorage(t *testing.T) *Storage {
	t.Helper()
	cfg := config.MinIOConfig{
		Endpoint:  "localhost:9002",
		AccessKey: "yuanchat_minio",
		SecretKey: "yuanchat_minio_dev",
		Bucket:    "yuanchat",
		UseSSL:    false,
	}
	// 可达性探测：MinIO 未运行时跳过（区分“基础设施缺失”与“代码有 bug”）。
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get("http://" + cfg.Endpoint + "/minio/health/live")
	if err != nil {
		t.Skipf("dev minio unavailable, skip integration test: %v", err)
	}
	resp.Body.Close()

	st, err := New(cfg)
	if err != nil {
		t.Fatalf("storage.New: %v", err)
	}
	return st
}

// TestNewEnsuresBucket 验证 New 后配置桶已存在（幂等：重复 New 不报错）。
func TestNewEnsuresBucket(t *testing.T) {
	st := testStorage(t)
	ctx := context.Background()

	exists, err := st.client.BucketExists(ctx, st.bucket)
	if err != nil {
		t.Fatalf("BucketExists: %v", err)
	}
	if !exists {
		t.Fatalf("bucket %q not created by New", st.bucket)
	}
}

// TestPresignRoundTrip 走完整链路：PresignPut → http.Put 直传 → PresignGet 拉回校验一致 → 清理。
func TestPresignRoundTrip(t *testing.T) {
	st := testStorage(t)
	ctx := context.Background()

	objectKey := fmt.Sprintf("test/roundtrip-%d.txt", time.Now().UnixNano())
	payload := []byte("hello yuanchat storage")
	const contentType = "text/plain"

	t.Cleanup(func() {
		_ = st.client.RemoveObject(ctx, st.bucket, objectKey, minio.RemoveObjectOptions{})
	})

	// 1. 预签名上传 URL 应含 X-Amz-Signature。
	putURL, err := st.PresignPut(ctx, objectKey, contentType, 5*time.Minute)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}
	if !strings.Contains(putURL, "X-Amz-Signature") {
		t.Fatalf("presigned put url missing X-Amz-Signature: %s", putURL)
	}

	// 2. 用 http.Put 直传，无需 MinIO 凭据。
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, putURL, bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("build put request: %v", err)
	}
	req.Header.Set("Content-Type", contentType)
	req.ContentLength = int64(len(payload))
	putResp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("put object: %v", err)
	}
	putResp.Body.Close()
	if putResp.StatusCode != http.StatusOK {
		t.Fatalf("put status = %d, want 200", putResp.StatusCode)
	}

	// 3. 预签名下载 URL 拉回，内容需一致。
	getURL, err := st.PresignGet(ctx, objectKey, 5*time.Minute)
	if err != nil {
		t.Fatalf("PresignGet: %v", err)
	}
	getResp, err := http.Get(getURL)
	if err != nil {
		t.Fatalf("get object: %v", err)
	}
	defer getResp.Body.Close()
	if getResp.StatusCode != http.StatusOK {
		t.Fatalf("get status = %d, want 200", getResp.StatusCode)
	}
	got, err := io.ReadAll(getResp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatalf("round-trip content mismatch: got %q want %q", got, payload)
	}
}

// TestPublicURLShape 验证公共 URL 形如 scheme://endpoint/bucket/key。
func TestPublicURLShape(t *testing.T) {
	st := testStorage(t)
	got := st.PublicURL("avatars/u1.png")
	want := "http://localhost:9002/yuanchat/avatars/u1.png"
	if got != want {
		t.Fatalf("PublicURL = %q, want %q", got, want)
	}
}
