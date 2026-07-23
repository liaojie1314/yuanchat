package database_test

import (
	"io/fs"
	"testing"

	"github.com/yuanchat/server/internal/database"
)

// TestMigrationFilesEmbedded 验证 SQL 迁移文件已正确嵌入二进制。
// 本测试无需数据库连接，纯编译时验证。
func TestMigrationFilesEmbedded(t *testing.T) {
	mfs := database.MigrationFiles()
	entries, err := fs.ReadDir(mfs, "migrations")
	if err != nil {
		t.Fatalf("read migrations dir: %v", err)
	}
	if len(entries) < 2 {
		t.Fatalf("expected >= 2 migration files, got %d", len(entries))
	}
	for _, e := range entries {
		t.Logf("migration: %s", e.Name())
	}
}
