package redis

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/yuanchat/server/internal/config"
	"go.uber.org/zap"
)

// New 创建 Redis 客户端
func New(cfg config.RedisConfig, zapLogger *zap.Logger) (*redis.Client, error) {
	rdb := redis.NewClient(&redis.Options{
		Addr:         cfg.Addr(),
		Password:     cfg.Password,
		DB:           cfg.DB,
		PoolSize:     cfg.PoolSize,
		MinIdleConns: cfg.MinIdleConns,
		DialTimeout:  cfg.DialTimeout,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to connect redis: %w", err)
	}

	zapLogger.Info("Redis connected successfully",
		zap.String("addr", cfg.Addr()),
		zap.Int("db", cfg.DB),
	)

	return rdb, nil
}

// Close 关闭 Redis 连接
func Close(rdb *redis.Client) error {
	return rdb.Close()
}
