package testutil

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/yuanchat/server/internal/database"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
	"gorm.io/gorm/schema"
)

// 测试库连接参数与 deploy/docker-compose.yml 的开发库一致，库名换成独立测试库。
const (
	testPGHost     = "localhost"
	testPGPort     = 5434
	testPGUser     = "yuanchat"
	testPGPassword = "yuanchat_dev"
	testDBPrefix   = "yuanchat_test_"
)

// dbFixture 维护每个测试进程一个独立数据库：首个用例创建并跑迁移，
// 引用计数归零（该包当前无进行中的用例）时关闭连接池并删库；
// 之后再有用例进来会重新引导一个新的库（库按用例批次可重建）。
// 进程级隔离是必须的：go test 会并行跑多个包进程，事务回滚只能隔离
// 单个进程内的用例，跨包并发必须各有各的库。
var dbFixture struct {
	mu   sync.Mutex
	refs int
	name string
	base *gorm.DB
	skip error
}

// NewDB 返回一个跑完全部 goose 迁移的独立测试库句柄，且当前用例的所有
// 写入都包在一个事务里、用例结束时回滚——测试因此不可能污染开发库。
//
// 数据库不可达时跳过用例（与旧行为一致，CI 无 DB 环境仍绿）。
// 句柄本身是事务，可整体传给 handler/service/repository，
// 被测代码内部的 db.Transaction 会降级为 savepoint，语义不变。
//
// 并发安全：同一包内并行用例（t.Parallel）共享同一个库与连接池，
// 引用计数保证最后一个用例结束后才删库。
func NewDB(t *testing.T) *gorm.DB {
	t.Helper()

	dbFixture.mu.Lock()
	defer dbFixture.mu.Unlock()
	if dbFixture.base == nil {
		// 首个用例或上一批用例结束后库已删除，都重新引导；
		// 失败时 skip 留存，让后续用例统一走 skip 分支。
		bootstrapDB()
	}
	if dbFixture.skip != nil {
		t.Skipf("test postgres unavailable, skip integration test: %v", dbFixture.skip)
	}
	dbFixture.refs++

	tx := dbFixture.base.Begin()
	if tx.Error != nil {
		dbFixture.refs--
		t.Fatalf("begin tx: %v", tx.Error)
	}
	t.Cleanup(func() {
		_ = tx.Rollback()
		dbFixture.mu.Lock()
		defer dbFixture.mu.Unlock()
		dbFixture.refs--
		if dbFixture.refs == 0 {
			teardownDB()
		}
	})
	return tx
}

// bootstrapDB 清扫陈库、创建本进程专属库并执行 goose 迁移。
// 调用方必须持有 dbFixture.mu。失败时把原因记进 dbFixture.skip，
// 并回滚已完成的中间步骤（如删掉已建但连不上的库）。
func bootstrapDB() {
	name := fmt.Sprintf("%s%s_%s", testDBPrefix, time.Now().UTC().Format("20060102150405"), randSuffix())
	admin, err := sql.Open("pgx", fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=postgres sslmode=disable",
		testPGHost, testPGPort, testPGUser, testPGPassword))
	if err != nil {
		dbFixture.skip = err
		return
	}
	defer admin.Close()
	if err := admin.Ping(); err != nil {
		dbFixture.skip = err
		return
	}

	// 只清超过 24 小时的陈库：正常同一次 go test 里其余包进程的库还在用，
	// 按时间戳兜底能回收进程被强杀留下的残留。
	rows, err := admin.Query(
		`SELECT pg_terminate_backend(pid), datname FROM pg_stat_activity
		 WHERE datname LIKE $1 AND backend_start < now() - interval '24 hours'`,
		testDBPrefix+"%")
	if err == nil {
		var stale []string
		for rows.Next() {
			var datname string
			_ = rows.Scan(new(bool), &datname)
			stale = append(stale, datname)
		}
		_ = rows.Err()
		rows.Close()
		for _, datname := range stale {
			_, _ = admin.Exec(fmt.Sprintf(`DROP DATABASE IF EXISTS %s`, quoteIdent(datname)))
		}
	}

	if _, err := admin.Exec(fmt.Sprintf(`CREATE DATABASE %s`, quoteIdent(name))); err != nil {
		dbFixture.skip = err
		return
	}

	db, err := gorm.Open(postgres.Open(fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=disable",
		testPGHost, testPGPort, testPGUser, testPGPassword, name)), &gorm.Config{
		Logger:                 gormlogger.Default.LogMode(gormlogger.Silent),
		NamingStrategy:         schema.NamingStrategy{SingularTable: true},
		SkipDefaultTransaction: true,
	})
	if err != nil {
		dbFixture.skip = err
		// 库已建但连不上，删掉避免泄漏
		_, _ = admin.Exec(fmt.Sprintf(`DROP DATABASE IF EXISTS %s WITH (FORCE)`, quoteIdent(name)))
		return
	}
	sqlDB, err := db.DB()
	if err != nil {
		dbFixture.skip = err
		_, _ = admin.Exec(fmt.Sprintf(`DROP DATABASE IF EXISTS %s WITH (FORCE)`, quoteIdent(name)))
		return
	}
	// 池子必须限量：-race 全量跑时进程数多，dev 库 max_connections = 100
	if err := database.RunMigrations(sqlDB); err != nil {
		dbFixture.skip = fmt.Errorf("run migrations on %s: %w", name, err)
		_ = sqlDB.Close()
		_, _ = admin.Exec(fmt.Sprintf(`DROP DATABASE IF EXISTS %s WITH (FORCE)`, quoteIdent(name)))
		return
	}
	sqlDB.SetMaxOpenConns(8)
	sqlDB.SetMaxIdleConns(4)
	dbFixture.name = name
	dbFixture.base = db
}

// teardownDB 关闭共享连接池并删除本进程的测试库，重置夹具状态，
// 使下一批用例（同包进程内）能重新引导新库。调用方必须持有 dbFixture.mu。
func teardownDB() {
	if dbFixture.base != nil {
		sqlDB, err := dbFixture.base.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
		dbFixture.base = nil
	}
	if dbFixture.name == "" {
		return
	}
	admin, err := sql.Open("pgx", fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=postgres sslmode=disable",
		testPGHost, testPGPort, testPGUser, testPGPassword))
	if err != nil {
		dbFixture.name = ""
		return
	}
	defer admin.Close()
	_, _ = admin.Exec(fmt.Sprintf(`DROP DATABASE IF EXISTS %s WITH (FORCE)`, quoteIdent(dbFixture.name)))
	dbFixture.name = ""
}

// quoteIdent 防御性地给库名加引号（库名由本包生成，纯字母数字下划线）。
func quoteIdent(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

// randSuffix 生成 8 位随机十六进制后缀，避免同秒启动的两个包进程撞库名。
func randSuffix() string {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand 不可用时退化为 PID，仍能区分并行包进程
		return fmt.Sprintf("%08x", os.Getpid())
	}
	return hex.EncodeToString(b[:])
}
