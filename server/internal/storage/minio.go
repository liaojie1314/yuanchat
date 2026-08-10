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
type Storage struct {
	client   *minio.Client
	bucket   string
	endpoint string
	useSSL   bool
}

// New 建立 MinIO 连接，确保默认桶存在，并为 avatars/ 前缀开放匿名只读。
// 头像通过 PublicURL 直接暴露，无需预签名；其余对象（图片消息等）走预签名。
func New(cfg config.MinIOConfig) (*Storage, error) {
	client, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to init minio client: %w", err)
	}

	s := &Storage{
		client:   client,
		bucket:   cfg.Bucket,
		endpoint: cfg.Endpoint,
		useSSL:   cfg.UseSSL,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := s.ensureBucket(ctx); err != nil {
		return nil, err
	}
	if err := s.applyAvatarsPublicPolicy(ctx); err != nil {
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

// applyAvatarsPublicPolicy 为 <bucket>/avatars/* 前缀开放匿名 s3:GetObject。
func (s *Storage) applyAvatarsPublicPolicy(ctx context.Context) error {
	policy := fmt.Sprintf(`{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "AWS": ["*"] },
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::%s/avatars/*"]
    }
  ]
}`, s.bucket)
	if err := s.client.SetBucketPolicy(ctx, s.bucket, policy); err != nil {
		return fmt.Errorf("failed to set avatars public policy: %w", err)
	}
	return nil
}

// PresignPut 生成有时效的预签名上传 URL，客户端可用 HTTP PUT 直传，无需服务端中转。
// contentType 目前仅作调用方语义占位，MinIO PresignedPutObject 不绑定 Content-Type。
func (s *Storage) PresignPut(ctx context.Context, objectKey, contentType string, expires time.Duration) (string, error) {
	u, err := s.client.PresignedPutObject(ctx, s.bucket, objectKey, expires)
	if err != nil {
		return "", fmt.Errorf("failed to presign put %q: %w", objectKey, err)
	}
	return u.String(), nil
}

// PresignGet 生成有时效的预签名下载 URL，用于私有对象（如图片消息）的受控读取。
func (s *Storage) PresignGet(ctx context.Context, objectKey string, expires time.Duration) (string, error) {
	u, err := s.client.PresignedGetObject(ctx, s.bucket, objectKey, expires, url.Values{})
	if err != nil {
		return "", fmt.Errorf("failed to presign get %q: %w", objectKey, err)
	}
	return u.String(), nil
}

// PutObject 服务端直接写入对象（供内部工具如 seed 使用；
// 业务上传路径统一走 PresignPut 预签名直传，不经服务端中转字节）。
func (s *Storage) PutObject(ctx context.Context, objectKey, contentType string, reader io.Reader, size int64) error {
	_, err := s.client.PutObject(ctx, s.bucket, objectKey, reader, size, minio.PutObjectOptions{ContentType: contentType})
	return err
}

// PublicURL 拼出对象的公共访问 URL，形如 scheme://endpoint/bucket/key。
// 仅对已开放匿名读的前缀（avatars/）有效。
func (s *Storage) PublicURL(objectKey string) string {
	scheme := "http"
	if s.useSSL {
		scheme = "https"
	}
	return fmt.Sprintf("%s://%s/%s/%s", scheme, s.endpoint, s.bucket, objectKey)
}
