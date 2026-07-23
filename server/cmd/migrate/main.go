// migrate は goose マイグレーション CLI ラッパー。
// Usage:
//
//	go run ./cmd/migrate up
//	go run ./cmd/migrate down
//	go run ./cmd/migrate status
//	go run ./cmd/migrate reset
//	go run ./cmd/migrate version
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
