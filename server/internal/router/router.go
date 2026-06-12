package router

import (
	"github.com/gin-gonic/gin"
	"github.com/yuanchat/server/internal/config"
	"github.com/yuanchat/server/internal/handler"
	"github.com/yuanchat/server/internal/middleware"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// Setup 配置所有路由并返回 Gin Engine
func Setup(db *gorm.DB, cfg *config.Config, logger *zap.Logger) *gin.Engine {
	// 生产模式
	if cfg.Server.IsProduction() {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()

	// --- 全局中间件 ---
	r.Use(middleware.RequestID())
	r.Use(middleware.Logger(logger))
	r.Use(middleware.Recovery(logger))
	r.Use(middleware.CORS())

	// --- 处理器 ---
	healthH := handler.NewHealthHandler()
	userH := handler.NewUserHandler(logger)

	// --- 路由组 ---
	api := r.Group("/api/v1")

	// 健康检查（公开）
	api.GET("/health", healthH.Check)

	// 用户路由
	users := api.Group("/users")
	{
		// 公开接口
		users.POST("/register", middleware.LimitByIP(5, 10), userH.Register) // 注册限流
		users.POST("/login", middleware.LimitByIP(10, 20), userH.Login)      // 登录限流

		// 需要认证的接口
		authUsers := users.Group("", middleware.AuthRequired(cfg.JWT))
		{
			authUsers.GET("/me", userH.GetProfile)
			authUsers.PUT("/me", userH.UpdateProfile)
		}
	}

	// WebSocket 连接端点（需要认证）
	api.GET("/ws", middleware.AuthRequired(cfg.JWT), func(c *gin.Context) {
		// TODO: WebSocket 升级处理
		c.JSON(200, gin.H{"message": "WebSocket endpoint - to be implemented"})
	})

	return r
}
