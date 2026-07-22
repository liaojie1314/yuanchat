package router

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/yuanchat/server/internal/config"
	"github.com/yuanchat/server/internal/handler"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/pkg/jwt"
	"github.com/yuanchat/server/internal/pkg/shortid"
	"github.com/yuanchat/server/internal/repository"
	"github.com/yuanchat/server/internal/service"
	"github.com/yuanchat/server/internal/storage"
	"github.com/yuanchat/server/internal/ws"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// Setup wires all dependencies and returns the Gin engine plus the
// WebSocket handler (served by a dedicated listener in main).
// st 为对象存储句柄，可能为 nil（MinIO 不可达时），文件相关端点据此降级为 503。
func Setup(db *gorm.DB, rdb *redis.Client, st *storage.Storage, cfg *config.Config, logger *zap.Logger) (*gin.Engine, *ws.Handler) {
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
	reactionRepo := repository.NewReactionRepository(db)
	blocklistRepo := repository.NewBlocklistRepository(db)
	sidGen := shortid.NewGenerator(db)

	userSvc := service.NewUserService(userRepo, jwtGen, sidGen, logger)
	msgSvc := service.NewMessageService(msgRepo, convRepo, userRepo, reactionRepo, blocklistRepo, logger)
	convSvc := service.NewConversationService(convRepo, msgRepo, contactRepo, userRepo, logger)
	contactSvc := service.NewContactService(contactRepo, userRepo, logger)
	blocklistSvc := service.NewBlocklistService(blocklistRepo, userRepo, logger)

	healthH := handler.NewHealthHandler()
	captchaH := handler.NewCaptchaHandler(rdb)
	userH := handler.NewUserHandler(userSvc, captchaH, logger)

	hub := ws.NewHub(cfg.WebSocket.MaxConnectionsPerUser, logger)
	wsH := ws.NewHandler(hub, msgSvc, jwtGen, cfg.WebSocket, cfg.Server.IsProduction(), logger)
	msgH := handler.NewMessageHandler(msgSvc, hub, logger)
	contactH := handler.NewContactHandler(contactSvc, hub, logger)
	convH := handler.NewConversationHandler(convSvc, hub, logger)
	fileH := handler.NewFileHandler(st, cfg.Upload, logger)
	presenceH := handler.NewPresenceHandler(contactRepo, hub, logger)
	blocklistH := handler.NewBlocklistHandler(blocklistSvc, logger)

	// 好友上下线广播：独立 goroutine 通知在线好友，不阻塞连接注册路径
	hub.SetPresenceNotifier(func(userID uuid.UUID, online bool) {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			friendIDs, err := contactRepo.FriendIDs(ctx, userID)
			if err != nil {
				logger.Warn("presence friend lookup failed", zap.Error(err))
				return
			}
			frame, err := ws.Encode(ws.TypePresence, ws.PresencePayload{UserID: userID, Online: online})
			if err != nil {
				return
			}
			hub.SendToUsers(friendIDs, frame)
		}()
	})

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
			authUsers.GET("/:id", userH.GetPublicProfile)
		}
	}

	chat := api.Group("", middleware.AuthRequired(cfg.JWT))
	{
		chat.GET("/conversations", convH.List)
		chat.POST("/conversations", convH.Create)
		chat.GET("/conversations/:id/messages", msgH.History)
		chat.GET("/conversations/:id/members", convH.Members)
		chat.PATCH("/conversations/:id", convH.Rename)
		chat.POST("/conversations/:id/members", convH.Invite)
		chat.DELETE("/conversations/:id/members/:userId", convH.Kick)
		chat.POST("/conversations/:id/leave", convH.Leave)
		chat.DELETE("/conversations/:id", convH.Dissolve)
		chat.POST("/messages/:id/recall", msgH.Recall)
		chat.POST("/messages/:id/reactions", msgH.React)

		chat.POST("/files/upload-url", fileH.UploadURL)
		chat.GET("/files/download-url", fileH.DownloadURL)

		chat.GET("/presence", presenceH.Snapshot)

		chat.GET("/contacts", contactH.ListFriends)
		chat.POST("/contacts/requests", contactH.SendRequest)
		chat.GET("/contacts/requests", contactH.ListRequests)
		chat.POST("/contacts/requests/:id/accept", contactH.Accept)
		chat.POST("/contacts/requests/:id/reject", contactH.Reject)
		chat.DELETE("/contacts/:id", contactH.DeleteFriend)

		chat.GET("/blocks", blocklistH.List)
		chat.POST("/blocks", blocklistH.Block)
		chat.DELETE("/blocks/:targetId", blocklistH.Unblock)
	}

	return r, wsH
}
