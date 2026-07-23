package database

import (
	"database/sql"
	"embed"
	"fmt"

	"github.com/pressly/goose/v3"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

// RunMigrations 使用 goose 执行所有待运行的 SQL 迁移。
// 迁移文件以 embed.FS 嵌入二进制，运行时无需访问文件系统。
func RunMigrations(db *sql.DB) error {
	goose.SetBaseFS(migrationFiles)
	if err := goose.SetDialect("postgres"); err != nil {
		return fmt.Errorf("goose set dialect: %w", err)
	}
	if err := goose.Up(db, "migrations"); err != nil {
		return fmt.Errorf("goose up: %w", err)
	}
	return nil
}

// MigrationFiles 返回嵌入的迁移文件 FS，供外部 CLI 调用（如 cmd/migrate）。
func MigrationFiles() embed.FS {
	return migrationFiles
}
