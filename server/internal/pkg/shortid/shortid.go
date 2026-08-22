// Package shortid 为用户生成唯一的短数字 ID（元聊号）。
//
// 从 10000 起递增；用 PostgreSQL 序列保证原子性。
package shortid

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

// Generator 基于 PostgreSQL 序列生成唯一短 ID。
type Generator struct {
	db *gorm.DB
}

// NewGenerator 构造短 ID 生成器。
func NewGenerator(db *gorm.DB) *Generator {
	return &Generator{db: db}
}

// Next 返回下一个可用短 ID。
// 走 PostgreSQL SEQUENCE，无锁且原子。
func (g *Generator) Next(ctx context.Context) (int64, error) {
	// 确保序列已存在
	if err := g.db.WithContext(ctx).Exec(
		"CREATE SEQUENCE IF NOT EXISTS user_short_id_seq START 10000 MINVALUE 10000",
	).Error; err != nil {
		return 0, fmt.Errorf("create sequence: %w", err)
	}

	var id int64
	if err := g.db.WithContext(ctx).Raw("SELECT nextval('user_short_id_seq')").Scan(&id).Error; err != nil {
		return 0, fmt.Errorf("nextval: %w", err)
	}

	return id, nil
}
