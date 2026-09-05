// Package storage 封装 MinIO 对象存储：桶初始化、预签名上传/下载 URL、公共访问 URL。
package storage

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/yuanchat/server/internal/config"
)

// Storage 持有 MinIO 客户端与默认桶信息，供上层生成预签名 URL。
//
// endpoint / useSSL 是服务端建连用的地址；publicEndpoint / publicUseSSL 是下发给
// 客户端的对外地址。生产环境两者必然不同（前者是 compose 内网主机名），故分开保存。
type Storage struct {
	client         *minio.Client
	bucket         string
	endpoint       string
	useSSL         bool
	publicEndpoint string
	publicUseSSL   bool
}

// New 建立 MinIO 连接，确保默认桶存在，并为匿名公共读前缀开放访问。
// 头像与表情包封面通过 PublicURL 直接暴露，无需预签名；其余对象（图片消息等）走预签名。
func New(cfg config.MinIOConfig) (*Storage, error) {
	client, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to init minio client: %w", err)
	}

	s := &Storage{
		client:         client,
		bucket:         cfg.Bucket,
		endpoint:       cfg.Endpoint,
		useSSL:         cfg.UseSSL,
		publicEndpoint: cfg.PublicEndpoint,
		publicUseSSL:   cfg.PublicUseSSL,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := s.ensureBucket(ctx); err != nil {
		return nil, err
	}
	if err := s.applyPublicReadPolicy(ctx); err != nil {
		return nil, err
	}

	return s, nil
}

// ensureBucket 幂等地创建默认桶：已存在则跳过。
func (s *Storage) ensureBucket(ctx context.Context) error {
	exists, err := s.client.BucketExists(ctx, s.bucket)
	if err != nil {
		return fmt.Errorf("failed to check bucket %q: %w", s.bucket, err)
	}
	if exists {
		return nil
	}
	if err := s.client.MakeBucket(ctx, s.bucket, minio.MakeBucketOptions{}); err != nil {
		return fmt.Errorf("failed to create bucket %q: %w", s.bucket, err)
	}
	return nil
}

// applyPublicReadPolicy 为匿名公共读前缀开放 s3:GetObject：
// avatars/*（用户头像）与 sticker-covers/*（表情包封面）。两个前缀各占一条
// Statement 而非合并 Resource——未来单独收紧某一前缀的策略时互不牵连。
// SetBucketPolicy 是整桶覆盖，因此每次启动都以完整声明重写。
func (s *Storage) applyPublicReadPolicy(ctx context.Context) error {
	policy := fmt.Sprintf(`{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "AWS": ["*"] },
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::%s/avatars/*"]
    },
    {
      "Effect": "Allow",
      "Principal": { "AWS": ["*"] },
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::%s/sticker-covers/*"]
    }
  ]
}`, s.bucket, s.bucket)
	if err := s.client.SetBucketPolicy(ctx, s.bucket, policy); err != nil {
		return fmt.Errorf("failed to set public read policy: %w", err)
	}
	return nil
}

// rewriteHost 把 URL 的 scheme 与 host 换成对外端点，其余（路径、查询串）原样保留。
//
// 未配置对外端点时原样返回。注意：预签名 URL 的 SigV4 签名覆盖 Host 头，
// 因此对外域名必须由 nginx 反代到 MinIO 并透传 Host（proxy_set_header Host $host），
// 且 MINIO_SERVER_URL 要与对外域名一致 —— 否则签名校验失败（不是静默降级）。
func (s *Storage) rewriteHost(rawURL string) string {
	if s.publicEndpoint == "" {
		return rawURL
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	u.Host = s.publicEndpoint
	if s.publicUseSSL {
		u.Scheme = "https"
	} else {
		u.Scheme = "http"
	}
	return u.String()
}

// PresignPut 生成有时效的预签名上传 URL，客户端可用 HTTP PUT 直传，无需服务端中转。
// contentType 目前仅作调用方语义占位，MinIO PresignedPutObject 不绑定 Content-Type。
func (s *Storage) PresignPut(ctx context.Context, objectKey, contentType string, expires time.Duration) (string, error) {
	u, err := s.client.PresignedPutObject(ctx, s.bucket, objectKey, expires)
	if err != nil {
		return "", fmt.Errorf("failed to presign put %q: %w", objectKey, err)
	}
	return s.rewriteHost(u.String()), nil
}

// PresignGet 生成有时效的预签名下载 URL，用于私有对象（如图片消息）的受控读取。
func (s *Storage) PresignGet(ctx context.Context, objectKey string, expires time.Duration) (string, error) {
	u, err := s.client.PresignedGetObject(ctx, s.bucket, objectKey, expires, url.Values{})
	if err != nil {
		return "", fmt.Errorf("failed to presign get %q: %w", objectKey, err)
	}
	return s.rewriteHost(u.String()), nil
}

// PutObject 服务端直接写入对象（供内部工具如 seed 使用；
// 业务上传路径统一走 PresignPut 预签名直传，不经服务端中转字节）。
func (s *Storage) PutObject(ctx context.Context, objectKey, contentType string, reader io.Reader, size int64) error {
	_, err := s.client.PutObject(ctx, s.bucket, objectKey, reader, size, minio.PutObjectOptions{ContentType: contentType})
	return err
}

// ObjectExists 判断对象是否真实存在。
//
// 用于「登记引用前先确认对象在」的场景（如贴纸收藏）：PresignGet 只做 URL 签名、
// 不校验对象存在性，因此没有这一步就会把指向空对象的记录写进库，前端拿到合法 URL
// 但渲染 404，且该坏数据会长期存活。找不到对象返回 (false, nil)，其余错误照原样返回。
func (s *Storage) ObjectExists(ctx context.Context, objectKey string) (bool, error) {
	_, err := s.client.StatObject(ctx, s.bucket, objectKey, minio.StatObjectOptions{})
	if err == nil {
		return true, nil
	}
	if minio.ToErrorResponse(err).Code == "NoSuchKey" {
		return false, nil
	}
	return false, fmt.Errorf("failed to stat %q: %w", objectKey, err)
}

// PublicURL 拼出对象的公共访问 URL，形如 scheme://endpoint/bucket/key。
// 仅对已开放匿名读的前缀（avatars/、sticker-covers/）有效。
//
// 配了对外端点就用它，否则回落到内网建连地址（dev 环境即此路径）。
func (s *Storage) PublicURL(objectKey string) string {
	host := s.endpoint
	scheme := "http"
	if s.useSSL {
		scheme = "https"
	}
	if s.publicEndpoint != "" {
		host = s.publicEndpoint
		if s.publicUseSSL {
			scheme = "https"
		} else {
			scheme = "http"
		}
	}
	return fmt.Sprintf("%s://%s/%s/%s", scheme, host, s.bucket, objectKey)
}

// ObjectInfo 对象清单条目（GC 用：判定引用要 key，判定宽限期要 LastModified）。
type ObjectInfo struct {
	Key          string
	Size         int64
	LastModified time.Time
}

// ListObjects 递归遍历 prefix 下的全部对象，逐条回调。
//
// 回调式而非返回切片：桶内对象数随消息量线性增长，全量装载会把内存压成 O(N)
// ——同 ListMine 当初无 LIMIT 的问题形态。回调返回错误即中止遍历。
func (s *Storage) ListObjects(ctx context.Context, prefix string, fn func(ObjectInfo) error) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel() // 提前 return 时关闭 minio 内部的 goroutine 与 channel

	for obj := range s.client.ListObjects(ctx, s.bucket, minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: true,
	}) {
		if obj.Err != nil {
			return fmt.Errorf("list objects %q: %w", prefix, obj.Err)
		}
		if err := fn(ObjectInfo{Key: obj.Key, Size: obj.Size, LastModified: obj.LastModified}); err != nil {
			return err
		}
	}
	return nil
}

// RemoveObject 删除单个对象（供 cmd/gc 回收无人引用的对象；业务路径不删对象）。
func (s *Storage) RemoveObject(ctx context.Context, objectKey string) error {
	if err := s.client.RemoveObject(ctx, s.bucket, objectKey, minio.RemoveObjectOptions{}); err != nil {
		return fmt.Errorf("failed to remove %q: %w", objectKey, err)
	}
	return nil
}
