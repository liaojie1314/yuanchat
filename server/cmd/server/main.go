package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/yuanchat/server/internal/config"
	"github.com/yuanchat/server/internal/database"
	"github.com/yuanchat/server/internal/logger"
	"github.com/yuanchat/server/internal/redis"
	"github.com/yuanchat/server/internal/router"
	"go.uber.org/zap"
)

// @title           元聊 YuanChat API
// @version         1.0.0
// @description     元聊即时通讯软件后端 API 文档
// @contact.name    YuanChat Dev Team
// @contact.email   dev@yuanyuan.blog
// @license.name    Proprietary
// @host            localhost:8080
// @BasePath        /api/v1
// @schemes         http https

func main() {
	// 1. 加载配置
	cfg, err := config.Load("config/config.yaml")
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// 2. 初始化日志
	zapLogger, err := logger.New(cfg.Log, cfg.Server)
	if err != nil {
		log.Fatalf("Failed to initialize logger: %v", err)
	}
	defer zapLogger.Sync()

	zapLogger.Info("Starting YuanChat Server...",
		zap.String("env", cfg.Server.Env),
		zap.String("version", "1.0.0"),
	)

	// 3. 连接数据库
	zapLogger.Info("Connecting to PostgreSQL...")
	db, err := database.New(cfg.Database, zapLogger)
	if err != nil {
		zapLogger.Fatal("Failed to connect database", zap.Error(err))
	}
	defer database.Close(db)
	zapLogger.Info("PostgreSQL connected")

	// 4. 连接 Redis
	zapLogger.Info("Connecting to Redis...")
	rdb, err := redis.New(cfg.Redis, zapLogger)
	if err != nil {
		zapLogger.Fatal("Failed to connect redis", zap.Error(err))
	}
	defer redis.Close(rdb)
	_ = rdb // 后续传递给 repository/service 层

	// 5. 设置路由 + WebSocket 网关
	r, wsHandler := router.Setup(db, rdb, cfg, zapLogger)

	// 6. 启动 HTTP 服务器
	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
	srv := &http.Server{
		Addr:         addr,
		Handler:      r,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
	}

	// WebSocket 独立监听 :8081（与架构文档 ws-gateway 一致）。
	// 长连接不能设 Read/WriteTimeout，超时由 ws 包的 ping/pong 机制管理。
	wsMux := http.NewServeMux()
	wsMux.HandleFunc("/ws", wsHandler.ServeWS)
	wsAddr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.WebSocket.Port)
	wsSrv := &http.Server{
		Addr:    wsAddr,
		Handler: wsMux,
	}

	// 7. 优雅启停
	go func() {
		zapLogger.Info("HTTP server listening", zap.String("addr", addr))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			zapLogger.Fatal("HTTP server failed", zap.Error(err))
		}
	}()

	go func() {
		zapLogger.Info("WebSocket server listening", zap.String("addr", wsAddr))
		if err := wsSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			zapLogger.Fatal("WebSocket server failed", zap.Error(err))
		}
	}()

	// 8. 等待中断信号
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit

	zapLogger.Info("Received shutdown signal", zap.String("signal", sig.String()))

	// 9. 优雅关闭
	ctx, cancel := context.WithTimeout(context.Background(), cfg.Server.ShutdownTimeout)
	defer cancel()

	if err := wsSrv.Shutdown(ctx); err != nil {
		zapLogger.Error("WebSocket server forced to shutdown", zap.Error(err))
	}
	if err := srv.Shutdown(ctx); err != nil {
		zapLogger.Error("Server forced to shutdown", zap.Error(err))
	}

	zapLogger.Info("Server exited gracefully")
}
