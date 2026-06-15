package router

import (
	"github.com/gin-gonic/gin"
	"github.com/yuanchat/server/internal/config"
	"github.com/yuanchat/server/internal/handler"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/pkg/jwt"
	"github.com/yuanchat/server/internal/repository"
	"github.com/yuanchat/server/internal/service"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// Setup wires all dependencies and returns the Gin engine.
func Setup(db *gorm.DB, cfg *config.Config, logger *zap.Logger) *gin.Engine {
	if cfg.Server.IsProduction() {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(middleware.RequestID())
	r.Use(middleware.Logger(logger))
	r.Use(middleware.Recovery(logger))
	r.Use(middleware.CORS())

	// --- Dependency wiring ---
	jwtGen := jwt.NewGenerator(cfg.JWT.Secret, cfg.JWT.AccessTokenTTL, cfg.JWT.RefreshTokenTTL)
	userRepo := repository.NewUserRepository(db)
	userSvc := service.NewUserService(userRepo, jwtGen, logger)

	healthH := handler.NewHealthHandler()
	userH := handler.NewUserHandler(userSvc, logger)

	// --- Routes ---
	api := r.Group("/api/v1")
	api.GET("/health", healthH.Check)

	users := api.Group("/users")
	{
		users.POST("/register", middleware.LimitByIP(5, 10), userH.Register)
		users.POST("/login", middleware.LimitByIP(10, 20), userH.Login)

		authUsers := users.Group("", middleware.AuthRequired(cfg.JWT))
		{
			authUsers.GET("/me", userH.GetProfile)
			authUsers.PUT("/me", userH.UpdateProfile)
		}
	}

	api.GET("/ws", middleware.AuthRequired(cfg.JWT), func(c *gin.Context) {
		c.JSON(200, gin.H{"message": "WebSocket endpoint - to be implemented"})
	})

	return r
}
