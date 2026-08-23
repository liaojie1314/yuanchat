// migrate 是 goose 数据库迁移的 CLI 包装。
//
// 迁移文件通过 database.MigrationFiles() 以 embed.FS 提供，因此编译后的二进制
// 自带全部 SQL，部署时无需附带 migrations 目录。
//
// 用法：
//
//	go run ./cmd/migrate up       # 应用全部未执行的迁移
//	go run ./cmd/migrate down     # 回滚最近一次迁移
//	go run ./cmd/migrate status   # 查看各迁移的执行状态
//	go run ./cmd/migrate reset    # 回滚全部迁移（仅开发环境）
//	go run ./cmd/migrate version  # 查看当前版本号
package main

import (
	"fmt"
	"log"
	"os"

	"github.com/pressly/goose/v3"
	"github.com/yuanchat/server/internal/config"
	"github.com/yuanchat/server/internal/database"
	"go.uber.org/zap"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: migrate <up|down|status|reset|version>")
		os.Exit(1)
	}
	command := os.Args[1]

	cfg, err := config.Load("config/config.yaml")
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	db, err := database.New(cfg.Database, zap.NewNop())
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatalf("sql.DB: %v", err)
	}

	mfs := database.MigrationFiles()
	goose.SetBaseFS(mfs)
	if err := goose.SetDialect("postgres"); err != nil {
		log.Fatalf("goose dialect: %v", err)
	}

	switch command {
	case "up":
		err = goose.Up(sqlDB, "migrations")
	case "down":
		err = goose.Down(sqlDB, "migrations")
	case "status":
		err = goose.Status(sqlDB, "migrations")
	case "reset":
		err = goose.Reset(sqlDB, "migrations")
	case "version":
		err = goose.Version(sqlDB, "migrations")
	default:
		log.Fatalf("unknown command: %s", command)
	}
	if err != nil {
		log.Fatalf("goose %s: %v", command, err)
	}
}
