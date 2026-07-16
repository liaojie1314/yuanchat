package router

import (
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"github.com/yuanchat/server/internal/config"
	"github.com/yuanchat/server/internal/handler"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/pkg/jwt"
	"github.com/yuanchat/server/internal/pkg/shortid"
	"github.com/yuanchat/server/internal/repository"
	"github.com/yuanchat/server/internal/service"
	"github.com/yuanchat/server/internal/ws"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// Setup wires all dependencies and returns the Gin engine plus the
// WebSocket handler (served by a dedicated listener in main).
func Setup(db *gorm.DB, rdb *redis.Client, cfg *config.Config, logger *zap.Logger) (*gin.Engine, *ws.Handler) {
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
	convRepo := repository.NewConversationRepository(db)
	msgRepo := repository.NewMessageRepository(db)
	contactRepo := repository.NewContactRepository(db)
	sidGen := shortid.NewGenerator(db)

	userSvc := service.NewUserService(userRepo, jwtGen, sidGen, logger)
	msgSvc := service.NewMessageService(msgRepo, convRepo, userRepo, logger)
	convSvc := service.NewConversationService(convRepo, msgRepo, logger)
	contactSvc := service.NewContactService(contactRepo, userRepo, logger)

	healthH := handler.NewHealthHandler()
	captchaH := handler.NewCaptchaHandler(rdb)
	userH := handler.NewUserHandler(userSvc, captchaH, logger)
	convH := handler.NewConversationHandler(convSvc, logger)
	msgH := handler.NewMessageHandler(msgSvc, logger)

	hub := ws.NewHub(cfg.WebSocket.MaxConnectionsPerUser, logger)
	wsH := ws.NewHandler(hub, msgSvc, jwtGen, cfg.WebSocket, cfg.Server.IsProduction(), logger)
	contactH := handler.NewContactHandler(contactSvc, hub, logger)

	// --- Routes ---
	api := r.Group("/api/v1")
	api.GET("/health", healthH.Check)
	api.GET("/captcha", captchaH.Generate)
	api.POST("/auth/refresh", middleware.LimitByIP(20, 40), userH.Refresh)

	users := api.Group("/users")
	{
		users.POST("/register", middleware.LimitByIP(5, 10), userH.Register)
		users.POST("/login", middleware.LimitByIP(10, 20), userH.Login)

		authUsers := users.Group("", middleware.AuthRequired(cfg.JWT))
		{
			authUsers.GET("/me", userH.GetProfile)
			authUsers.PUT("/me", userH.UpdateProfile)
			authUsers.GET("/search", contactH.Search)
		}
	}

	chat := api.Group("", middleware.AuthRequired(cfg.JWT))
	{
		chat.GET("/conversations", convH.List)
		chat.GET("/conversations/:id/messages", msgH.History)

		chat.GET("/contacts", contactH.ListFriends)
		chat.POST("/contacts/requests", contactH.SendRequest)
		chat.GET("/contacts/requests", contactH.ListRequests)
		chat.POST("/contacts/requests/:id/accept", contactH.Accept)
		chat.POST("/contacts/requests/:id/reject", contactH.Reject)
	}

	return r, wsH
}
