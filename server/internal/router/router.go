package router

import (
	"context"
	"encoding/json"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/yuanchat/server/internal/config"
	"github.com/yuanchat/server/internal/handler"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/model"
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
		// 封面对象键 → 公共 URL 映射：缺失时发布会静默丢封面（对象已传但无 URL 可落库）
		stickerSvc.SetPublicURL(st.PublicURL)
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

	// 通话：房间态在 Redis，服务端只转发不透明信令、不碰媒体字节
	callSvc := service.NewCallService(rdb, cfg.Turn, logger)
	callH := handler.NewCallHandler(callSvc, userRepo, logger)

	adminRepo := repository.NewAdminRepository(db)
	flaggedUGCRepo := repository.NewFlaggedUGCRepository(db)
	adminSvc := service.NewAdminService(adminRepo, convRepo, userRepo, flaggedUGCRepo, logger)
	adminH := handler.NewAdminHandler(adminSvc, hub, st, msgSvc, logger)
	reportH := handler.NewReportHandler(adminSvc, logger)

	pushRepo := repository.NewPushRepository(db)
	pushSvc := service.NewPushService(pushRepo, cfg.Push, logger)
	pushH := handler.NewPushHandler(pushSvc, logger)
	// 概览的推送订阅视图与用户侧订阅读写同一张表
	adminSvc.SetPushRepo(pushRepo)

	e2eeH := handler.NewE2EEHandler(repository.NewE2EERepository(db), logger)

	// 贴纸发送校验：WS 帧里的 sticker_id 必须属于发送者收藏，或属于一个可用表情包
	//（未下架、未被打标，且为官方包或发送者已添加的包），
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

	// 敏感词审核：共享单例同时服务消息正文与表情包包名——实例无状态，
	// 两处各自现场 New 会让热更新词库时只改到一处
	moderationSvc := service.NewModerationService(cfg.Moderation.Words)
	msgSvc.SetModeration(moderationSvc)
	stickerSvc.SetModeration(moderationSvc)
	// UGC 打标走同一词库：昵称 / bio / 群名 / 公告命中进 flagged_ugc 审核队列
	userSvc.SetUGCModeration(moderationSvc, flaggedUGCRepo)
	convSvc.SetUGCModeration(moderationSvc, flaggedUGCRepo)

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

	// 分布式限流：Redis 客户端由 main 启动时 Ping 校验（失败即 Fatal），
	// 注入后所有 LimitByIP 改走 Redis 原子令牌桶（多实例共享配额）；
	// 运行期 Redis 故障时 fail-open 放行（见 middleware.redisAllow 注释）。
	middleware.SetRateLimitRedis(rdb, logger)

	// 跨实例消息分发：redis 模式下本机投递完成后发布到 Redis channel，
	// 各实例订阅后投递给自己的本机连接（发布前只投本机 + 订阅端按实例 ID 过滤，不重复）。
	// 默认 inproc：不注入发布回调，Hub 行为与单实例完全一致。
	if cfg.Dispatcher.Backend == "redis" {
		rd := ws.NewRedisDispatcher(rdb, cfg.Dispatcher.Channel, hub, logger)
		hub.SetRemotePublisher(rd.Publish)
		logger.Info("dispatcher backend: redis", zap.String("channel", cfg.Dispatcher.Channel))
	}

	// 好友上下线广播：独立 goroutine 通知在线好友，不阻塞连接注册路径
	hub.SetPresenceNotifier(func(userID uuid.UUID, online bool) {
		go notifyFriends(userID, online)
	})

	// --- 通话信令接线 ---
	// 终结回调落一条通话记录系统消息（未接来电靠 seq 递增自然计入未读）
	wsH.SetCallService(callSvc, func(
		ctx context.Context, room *service.Room, reason service.EndReason, dur int,
	) {
		convSvc.AppendCallRecord(ctx, room.ConversationID, room.CallerID,
			string(room.Media), reason.Result(), dur)
	})
	wsH.SetConversationMembers(convSvc.MemberIDsFor)
	// 参与者列表要带昵称与头像；查不到时信令层会退化为空摘要而不是失败
	wsH.SetUserBriefs(func(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]ws.UserBrief, error) {
		users, err := userRepo.FindByIDs(ctx, ids)
		if err != nil {
			return nil, err
		}
		out := make(map[uuid.UUID]ws.UserBrief, len(users))
		for i := range users {
			out[users[i].ID] = ws.UserBrief{
				ID:        users[i].ID,
				Nickname:  users[i].Nickname,
				AvatarURL: users[i].AvatarURL,
				ShortID:   users[i].ShortID,
			}
		}
		return out, nil
	})
	// 通话记录的实时推送：content 带结构化 call 字段，走不了只发 text 的旧路径
	convSvc.SetCallRecordPusher(func(memberIDs []uuid.UUID, msg *model.Message, contentJSON string) {
		var content ws.ContentPayload
		if err := json.Unmarshal([]byte(contentJSON), &content); err != nil {
			return
		}
		content.Type = "system"
		frame, err := ws.Encode(ws.TypeMessageReceive, ws.ReceivePayload{
			MessageID:      msg.ID,
			ConversationID: msg.ConversationID,
			SenderID:       msg.SenderID,
			Content:        content,
			Seq:            msg.Seq,
			Timestamp:      msg.CreatedAt.UnixMilli(),
		})
		if err == nil {
			hub.SendToUsers(memberIDs, frame)
		}
	})
	// 连接断开即离开通话房间：关窗口、拔网线、杀进程、手机被回收都走这里。
	// 没有它，一方掉线后另一方永远停在「通话中」，只能等 Redis 的 2 小时 TTL。
	hub.SetDisconnectNotifier(wsH.HandleDisconnect)

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
		// 登录态改密：凭当前密码而非短信验证码，因此只需鉴权 + 与 reset 同档的限流
		password.POST("/change", middleware.AuthRequired(cfg.JWT), middleware.LimitByIP(5, 10), authH.ChangePassword)
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
		// 取消同样限扫码端本人：它是把已扫的会话推进到终态，与确认是同一类写操作
		qr.POST("/:token/cancel", middleware.AuthRequired(cfg.JWT), authH.CancelQRSession)
	}

	// 注册/登录统一收敛到 /auth 前缀，与 /auth/refresh、/auth/password、/auth/qr 对齐
	api.POST("/auth/register", middleware.LimitByIP(5, 10), userH.Register)
	api.POST("/auth/login", middleware.LimitByIP(10, 20), userH.Login)

	users := api.Group("/users")
	{
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
		chat.GET("/conversations/:id/media", msgH.Media)
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
		chat.PATCH("/messages/:id", msgH.Edit)
		chat.GET("/messages/:id/edits", msgH.EditHistory)
		chat.POST("/messages/:id/reactions", msgH.React)
		chat.POST("/messages/:id/forward", forwardH.Forward)
		chat.GET("/messages/search", middleware.LimitByIP(20, 40), msgH.Search)

		chat.POST("/files/upload-url", fileH.UploadURL)
		chat.GET("/files/download-url", fileH.DownloadURL)

		chat.GET("/presence", presenceH.Snapshot)

		// 通话：信令全走 WebSocket，这里只有两个读端点
		chat.GET("/calls/ice-servers", middleware.LimitByIP(20, 40), callH.GetICEServers)
		chat.GET("/calls/:call_id", middleware.LimitByIP(20, 40), callH.GetCall)

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
		registerStickerPackRoutes(chat, stickerH)

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
		admin.POST("/users/:id/reset-avatar", adminH.ResetAvatar)
		admin.GET("/conversations", adminH.ListConversations)
		admin.POST("/conversations/:id/dissolve", adminH.DissolveConversation)
		admin.GET("/messages", adminH.ListMessages)
		admin.DELETE("/messages/:id", adminH.DeleteMessage)
		admin.DELETE("/messages/:id/flag", adminH.ClearMessageFlag)
		admin.GET("/sticker-packs", adminH.ListStickerPacks)
		admin.POST("/sticker-packs/:id/takedown", adminH.TakeDownStickerPack)
		admin.POST("/sticker-packs/:id/untakedown", adminH.UntakeDownStickerPack)
		admin.POST("/sticker-packs/:id/official", adminH.SetStickerPackOfficial)
		admin.DELETE("/sticker-packs/:id/flag", adminH.ClearStickerPackFlag)
		admin.GET("/reports", adminH.ListReports)
		admin.POST("/reports/:id/handle", adminH.HandleReport)
		admin.GET("/messages/:id/media", adminH.MessageMedia)
		admin.GET("/messages/:id/edits", adminH.MessageEditHistory)
		admin.GET("/flagged-ugc", adminH.ListFlaggedUGC)
		admin.POST("/flagged-ugc/:id/reset", adminH.ResetFlaggedUGC)
		admin.DELETE("/flagged-ugc/:id", adminH.DismissFlaggedUGC)
		admin.GET("/audit-logs", adminH.ListAuditLogs)
		// 只读概览：聚合指标与推送订阅视图，不写审计日志
		admin.GET("/stats", adminH.Stats)
		admin.GET("/storage-stats", adminH.StorageStats)
		admin.GET("/push-subscriptions", adminH.ListPushSubscriptions)
	}

	return r, wsH
}

// registerStickerPackRoutes 注册表情包商城 / 发布管理相关路由（均挂在已鉴权的分组下）。
//
// 单独成函数：gin 对「静态段与参数段同级」（/market、/mine 与 /:id）的支持
// 依赖注册期的基数树构造，冲突会在启动时 panic——把注册集中到这里，
// 测试可以直接构造空引擎验证路由表合法。
func registerStickerPackRoutes(rg gin.IRouter, h *handler.StickerHandler) {
	// 静态段（market / mine）注册在参数段（:id）之前，gin 按静态优先匹配
	rg.GET("/sticker-packs", middleware.LimitByIP(20, 40), h.ListPacks)
	rg.GET("/sticker-packs/market", middleware.LimitByIP(20, 40), h.Market)
	rg.GET("/sticker-packs/mine", middleware.LimitByIP(20, 40), h.ListMyPacks)

	rg.POST("/sticker-packs", middleware.LimitByIP(10, 20), h.Publish)
	rg.GET("/sticker-packs/:id", middleware.LimitByIP(20, 40), h.PackDetail)
	rg.PATCH("/sticker-packs/:id", middleware.LimitByIP(10, 20), h.UpdatePack)
	rg.DELETE("/sticker-packs/:id", middleware.LimitByIP(10, 20), h.DeleteMinePack)
	rg.POST("/sticker-packs/:id/add", middleware.LimitByIP(10, 20), h.AddPack)
	rg.DELETE("/sticker-packs/:id/add", middleware.LimitByIP(10, 20), h.RemovePack)
	rg.POST("/sticker-packs/:id/stickers", middleware.LimitByIP(10, 20), h.AddPackSticker)
	rg.DELETE("/sticker-packs/:id/stickers/:stickerId", middleware.LimitByIP(10, 20), h.RemovePackSticker)
}
