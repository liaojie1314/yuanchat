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
	"github.com/yuanchat/server/internal/pkg/codesender"
	"github.com/yuanchat/server/internal/pkg/jwt"
	"github.com/yuanchat/server/internal/pkg/shortid"
	"github.com/yuanchat/server/internal/repository"
	"github.com/yuanchat/server/internal/service"
	"github.com/yuanchat/server/internal/storage"
	"github.com/yuanchat/server/internal/ws"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// Setup 接线全部依赖，返回 Gin 引擎与 WebSocket handler
// （后者在 main 里由独立监听器提供服务）。
// st 为对象存储句柄，可能为 nil（MinIO 不可达时），文件相关端点据此降级为 503。
// sender 为验证码下发通道，由 main 按配置构造后传入——通道选择错误必须在进程启动时
// 就失败，而不是等到有人点「发送验证码」才在 Setup 里 panic。
func Setup(
	db *gorm.DB,
	rdb *redis.Client,
	st *storage.Storage,
	cfg *config.Config,
	logger *zap.Logger,
	sender codesender.Sender,
) (*gin.Engine, *ws.Handler) {
	if cfg.Server.IsProduction() {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(middleware.RequestID())
	r.Use(middleware.Logger(logger))
	r.Use(middleware.Recovery(logger))
	r.Use(middleware.CORS())
	r.Use(middleware.Prometheus())

	// --- 依赖接线 ---
	jwtGen := jwt.NewGenerator(cfg.JWT.Secret, cfg.JWT.AccessTokenTTL, cfg.JWT.RefreshTokenTTL)
	userRepo := repository.NewUserRepository(db)
	convRepo := repository.NewConversationRepository(db)
	msgRepo := repository.NewMessageRepository(db)
	contactRepo := repository.NewContactRepository(db)
	reactionRepo := repository.NewReactionRepository(db)
	blocklistRepo := repository.NewBlocklistRepository(db)
	sidGen := shortid.NewGenerator(db)

	userSvc := service.NewUserService(userRepo, jwtGen, sidGen, rdb, logger)
	authSvc := service.NewAuthService(userRepo, repository.NewVerificationCodeRepository(db), rdb, sender, jwtGen, logger)
	msgSvc := service.NewMessageService(msgRepo, convRepo, userRepo, reactionRepo, blocklistRepo, logger)
	convSvc := service.NewConversationService(convRepo, msgRepo, contactRepo, userRepo, logger)
	contactSvc := service.NewContactService(contactRepo, userRepo, logger)
	blocklistSvc := service.NewBlocklistService(blocklistRepo, userRepo, logger)
	favRepo := repository.NewFavoriteRepository(db)
	favSvc := service.NewFavoriteService(favRepo, msgRepo, convRepo, userRepo, logger)
	favH := handler.NewFavoriteHandler(favSvc, logger)

	stickerRepo := repository.NewStickerRepository(db)
	stickerSvc := service.NewStickerService(stickerRepo, logger)
	// 收藏前校验对象真实存在（st 为 nil 时——MinIO 不可达——降级跳过该校验，
	// 与 fileH 的 503 降级策略一致，不因存储不可达而整条链路 500）
	if st != nil {
		stickerSvc.SetObjectChecker(st)
	}
	stickerH := handler.NewStickerHandler(stickerSvc, logger)

	healthH := handler.NewHealthHandler()
	captchaH := handler.NewCaptchaHandler(rdb)
	userH := handler.NewUserHandler(userSvc, captchaH, logger)
	authH := handler.NewAuthHandler(authSvc, logger)

	hub := ws.NewHub(cfg.WebSocket.MaxConnectionsPerUser, logger)
	wsH := ws.NewHandler(hub, msgSvc, jwtGen, cfg.WebSocket, cfg.Server.IsProduction(), logger, userRepo)
	msgH := handler.NewMessageHandler(msgSvc, hub, logger)
	contactH := handler.NewContactHandler(contactSvc, hub, logger)
	convH := handler.NewConversationHandler(convSvc, hub, logger)
	fileH := handler.NewFileHandler(st, cfg.Upload, logger)
	// 对象级读授权（download-url）：key 必须被请求者可见的消息或其可用贴纸引用。
	// 未注入时 handler 对私有对象一律拒绝（fail closed），故这里必须接上。
	fileH.SetObjectACL(repository.NewObjectACLRepository(db))
	presenceH := handler.NewPresenceHandler(contactRepo, hub, logger)
	blocklistH := handler.NewBlocklistHandler(blocklistSvc, logger)
	forwardH := handler.NewForwardHandler(msgSvc, hub, logger)

	adminRepo := repository.NewAdminRepository(db)
	adminSvc := service.NewAdminService(adminRepo, convRepo, logger)
	adminH := handler.NewAdminHandler(adminSvc, hub, logger)
	reportH := handler.NewReportHandler(adminSvc, logger)

	pushRepo := repository.NewPushRepository(db)
	pushSvc := service.NewPushService(pushRepo, cfg.Push, logger)
	pushH := handler.NewPushHandler(pushSvc, logger)

	e2eeH := handler.NewE2EEHandler(repository.NewE2EERepository(db), logger)

	// 贴纸发送校验：WS 帧里的 sticker_id 必须属于发送者（或属于某个官方包），
	// 且落库的 key/宽高一律取服务端权威值，不采信客户端传参。
	wsH.SetStickerResolver(func(ctx context.Context, senderID, stickerID uuid.UUID) (string, int, int, error) {
		st, err := stickerSvc.ResolveSendable(ctx, senderID, stickerID)
		if err != nil {
			return "", 0, 0, err
		}
		return st.ObjectKey, st.Width, st.Height, nil
	})

	// 离线成员补推浏览器通知：WS 在线者已实时收到，不重复打扰。
	// VAPID 未配置时 NotifyUsers 内部直接返回，等于功能关闭。
	wsH.SetOfflinePush(func(recipients []uuid.UUID, info ws.OfflineMsgInfo) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		// 免打扰成员不推离线通知；查询失败时放行全部（宁多推不漏推）
		if muted, err := convRepo.MutedMemberIDs(ctx, info.ConversationID); err != nil {
			logger.Warn("muted filter failed, push to all", zap.Error(err))
		} else if len(muted) > 0 {
			mutedSet := make(map[uuid.UUID]struct{}, len(muted))
			for _, id := range muted {
				mutedSet[id] = struct{}{}
			}
			filtered := make([]uuid.UUID, 0, len(recipients))
			for _, id := range recipients {
				if _, m := mutedSet[id]; !m {
					filtered = append(filtered, id)
				}
			}
			recipients = filtered
		}
		if len(recipients) == 0 {
			return
		}
		body := info.Text
		switch info.ContentType {
		case "image":
			body = "[图片]"
		case "file":
			body = "[文件]"
		case "voice":
			body = "[语音]"
		case "sticker":
			body = "[表情]"
		}
		pushSvc.NotifyUsers(ctx, recipients, service.PushPayload{
			Title:          info.SenderNickname,
			Body:           body,
			ConversationID: info.ConversationID.String(),
			MessageID:      info.MessageID.String(),
		})
	})

	// 敏感词审核：命中词库的文本消息标记 flagged 进审核队列
	msgSvc.SetModeration(service.NewModerationService(cfg.Moderation.Words))

	// 好友上下线帧广播（对本实例在线好友）
	notifyFriends := func(userID uuid.UUID, online bool) {
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
	}

	// Presence 后端：redis 模式下本实例事件广播到其他实例，
	// 远端实例的上下线事件也推给连在本实例的相关好友
	if cfg.Presence.Backend == "redis" {
		rp := ws.NewRedisPresence(rdb, cfg.Presence.Channel, logger)
		rp.SetRemoteHandler(func(userID uuid.UUID, online bool) {
			go notifyFriends(userID, online)
		})
		hub.SetPresenceBackend(rp)
		logger.Info("presence backend: redis", zap.String("channel", cfg.Presence.Channel))
	}

	// 好友上下线广播：独立 goroutine 通知在线好友，不阻塞连接注册路径
	hub.SetPresenceNotifier(func(userID uuid.UUID, online bool) {
		go notifyFriends(userID, online)
	})

	// --- 路由 ---
	api := r.Group("/api/v1")
	api.GET("/health", healthH.Check)
	api.GET("/captcha", captchaH.Generate)
	// VAPID 公钥：前端 pushManager.subscribe 前拉取，无需鉴权
	api.GET("/push/public-key", pushH.PublicKey)
	api.POST("/auth/refresh", middleware.LimitByIP(20, 40), userH.Refresh)
	// 登出只需鉴权（前端 authStore 一直在调，此前 404 被 try/catch 吞掉）
	api.POST("/auth/logout", middleware.AuthRequired(cfg.JWT), userH.Logout)

	// 忘记密码三段式：三个端点各有各的滥用面，限流额度分别给，不共用一条
	password := api.Group("/auth/password")
	{
		// 发码要过短信/网关成本，额度压到最低
		password.POST("/otp", middleware.LimitByIP(3, 5), authH.SendResetCode)
		// 校验是唯一的爆破入口，IP 限流之外还有手机号维度的失败计数兜底
		password.POST("/verify", middleware.LimitByIP(10, 20), authH.VerifyResetCode)
		password.POST("/reset", middleware.LimitByIP(5, 10), authH.ResetPassword)
	}

	// 扫码登录：被扫端建会话并轮询，扫码端（已登录）标记已扫并确认授权
	qr := api.Group("/auth/qr")
	{
		// 建会话额度不能太紧：前端「刷新二维码」连点即触发，用户会看到死循环的 429
		qr.POST("/session", middleware.LimitByIP(3, 5), authH.CreateQRSession)
		// 轮询频率高：前端 2 秒一次，120 秒的会话最多 60 次，额度留一倍余量
		qr.GET("/:token", middleware.LimitByIP(30, 60), authH.PollQRSession)
		// 扫码端必须已登录：它是用自己的身份为被扫端授权
		qr.POST("/:token/scan", middleware.AuthRequired(cfg.JWT), authH.ScanQRSession)
		qr.POST("/:token/confirm", middleware.AuthRequired(cfg.JWT), authH.ConfirmQRSession)
	}

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
		chat.PUT("/conversations/:id/settings", convH.UpdateSettings)
		chat.POST("/conversations/:id/members", convH.Invite)
		chat.DELETE("/conversations/:id/members/:userId", convH.Kick)
		chat.POST("/conversations/:id/leave", convH.Leave)
		chat.DELETE("/conversations/:id", convH.Dissolve)
		chat.POST("/conversations/:id/admins", convH.AppointAdmin)
		chat.DELETE("/conversations/:id/admins/:userId", convH.RevokeAdmin)
		chat.POST("/conversations/:id/owner-transfer", convH.TransferOwner)
		chat.DELETE("/conversations/:id/messages", convH.ClearHistory)
		chat.PATCH("/conversations/:id/announcement", convH.UpdateAnnouncement)
		chat.PUT("/conversations/:id/my-alias", convH.UpdateMyAlias)
		chat.POST("/messages/:id/recall", msgH.Recall)
		chat.POST("/messages/:id/reactions", msgH.React)
		chat.POST("/messages/:id/forward", forwardH.Forward)
		chat.GET("/messages/search", middleware.LimitByIP(20, 40), msgH.Search)

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

		chat.POST("/favorites", favH.Add)
		chat.DELETE("/favorites/:messageId", favH.Remove)
		chat.GET("/favorites", favH.List)

		// 写操作限流照 /reports 的既定档位；读操作也挂（收藏列表虽已分页，
		// 仍是可被高频拉取的鉴权端点）
		chat.GET("/stickers/mine", middleware.LimitByIP(20, 40), stickerH.ListMine)
		chat.POST("/stickers", middleware.LimitByIP(10, 20), stickerH.Add)
		chat.DELETE("/stickers/:id", middleware.LimitByIP(10, 20), stickerH.Remove)
		chat.GET("/sticker-packs", middleware.LimitByIP(20, 40), stickerH.ListPacks)

		chat.POST("/reports", middleware.LimitByIP(10, 20), reportH.Create)

		chat.POST("/push/subscribe", pushH.Subscribe)
		chat.DELETE("/push/subscribe", pushH.Unsubscribe)

		// 端到端加密：服务端只中转公钥与客户端加密的备份 blob
		chat.POST("/e2ee/keys", e2eeH.UploadKeys)
		chat.GET("/e2ee/prekey-bundle/:userId", e2eeH.PreKeyBundle)
		chat.GET("/e2ee/prekey-count", e2eeH.PreKeyCount)
		chat.POST("/e2ee/backup", e2eeH.SaveBackup)
		chat.GET("/e2ee/backup", e2eeH.GetBackup)
	}

	// 管理后台：JWT + role=admin 双重校验，所有写操作留审计日志
	admin := api.Group("/admin", middleware.AuthRequired(cfg.JWT), middleware.RequireAdmin(db))
	{
		admin.GET("/users", adminH.ListUsers)
		admin.POST("/users/:id/ban", adminH.BanUser)
		admin.DELETE("/users/:id/ban", adminH.UnbanUser)
		admin.GET("/conversations", adminH.ListConversations)
		admin.POST("/conversations/:id/dissolve", adminH.DissolveConversation)
		admin.GET("/messages", adminH.ListMessages)
		admin.DELETE("/messages/:id", adminH.DeleteMessage)
		admin.DELETE("/messages/:id/flag", adminH.ClearMessageFlag)
		admin.GET("/reports", adminH.ListReports)
		admin.POST("/reports/:id/handle", adminH.HandleReport)
		admin.GET("/audit-logs", adminH.ListAuditLogs)
	}

	return r, wsH
}
