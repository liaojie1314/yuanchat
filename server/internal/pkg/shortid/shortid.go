// Package shortid generates unique short numeric IDs for users.
//
// IDs start from 10000 and increment. Uses PostgreSQL sequence for atomicity.
package shortid

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

// Generator creates unique short IDs using a PostgreSQL sequence.
type Generator struct {
	db *gorm.DB
}

// NewGenerator creates a short ID generator.
func NewGenerator(db *gorm.DB) *Generator {
	return &Generator{db: db}
}

// Next returns the next available short ID.
// Uses PostgreSQL SEQUENCE for atomic, lock-free generation.
func (g *Generator) Next(ctx context.Context) (int64, error) {
	// Ensure sequence exists
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
