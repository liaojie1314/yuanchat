// seed 在开发数据库中创建联调测试数据：
//
//	3 个用户（alice / bob / carol，密码均为 Test@1234）
//	1 个单聊（alice ↔ bob）+ 1 个群聊（产品研发群，三人）
//	好友关系：alice↔bob、bob↔carol（bob↔carol 补建单聊维持"好友必有会话"）
//	好友申请：carol → alice 一条 pending（演示"新的朋友"角标）
//	每个会话若干条历史消息（正确维护 seq / last_seq / last_read_seq）
//
// 幂等：按手机号查重，已存在的用户/会话/关系不会重复创建。
//
// 运行：go run ./cmd/seed
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/config"
	"github.com/yuanchat/server/internal/database"
	"github.com/yuanchat/server/internal/logger"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/pkg/password"
	"github.com/yuanchat/server/internal/pkg/shortid"
	"github.com/yuanchat/server/internal/storage"
	"gorm.io/gorm"
)

type seedUser struct {
	phone    string
	nickname string
	role     int16
}

var seedUsers = []seedUser{
	{"13800000001", "Alice", model.RoleUser},
	{"13800000002", "Bob", model.RoleUser},
	{"13800000003", "Carol", model.RoleUser},
	{"13800000009", "Admin", model.RoleAdmin},
}

const seedPassword = "Test@1234"

func main() {
	cfg, err := config.Load("config/config.yaml")
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	zapLogger, err := logger.New(cfg.Log, cfg.Server)
	if err != nil {
		log.Fatalf("init logger: %v", err)
	}
	db, err := database.New(cfg.Database, zapLogger)
	if err != nil {
		log.Fatalf("connect database: %v", err)
	}
	defer database.Close(db)

	// 定向迁移新表（seed 可能先于 server 首次运行）
	// seed 只补新表；Message/ConversationMember 的列变更由 server 启动时的 AutoMigrate 负责，
	// 这里再迁会与 messages.idx_conversation_seq（联合唯一）等已有约束打架。
	if err := db.AutoMigrate(&model.FriendRequest{}, &model.MessageReaction{}, &model.Blocklist{}); err != nil {
		log.Fatalf("migrate friend_requests: %v", err)
	}

	ctx := context.Background()

	users, err := ensureUsers(ctx, db)
	if err != nil {
		log.Fatalf("seed users: %v", err)
	}

	st, err := storage.New(cfg.MinIO)
	if err != nil {
		log.Printf("minio unavailable, skip sticker asset upload (rows still seeded without real objects): %v", err)
		st = nil
	}
	if err := ensureOfficialStickers(ctx, db, st); err != nil {
		log.Fatalf("seed official stickers: %v", err)
	}

	alice, bob, carol := users[0], users[1], users[2]

	privateConv, err := ensureConversation(ctx, db, model.ConversationTypePrivate, nil,
		[]memberSpec{{alice.ID, model.MemberRoleNormal}, {bob.ID, model.MemberRoleNormal}})
	if err != nil {
		log.Fatalf("seed private conversation: %v", err)
	}

	groupName := "产品研发群"
	groupConv, err := ensureConversation(ctx, db, model.ConversationTypeGroup, &groupName,
		[]memberSpec{{alice.ID, model.MemberRoleOwner}, {bob.ID, model.MemberRoleNormal}, {carol.ID, model.MemberRoleNormal}})
	if err != nil {
		log.Fatalf("seed group conversation: %v", err)
	}

	// bob↔carol 好友对应的单聊（维持"好友必有会话"不变式；alice↔bob 已有）
	bcConv, err := ensureConversation(ctx, db, model.ConversationTypePrivate, nil,
		[]memberSpec{{bob.ID, model.MemberRoleNormal}, {carol.ID, model.MemberRoleNormal}})
	if err != nil {
		log.Fatalf("seed bob-carol conversation: %v", err)
	}

	// 好友关系（双向行）：alice↔bob、bob↔carol
	if err := ensureFriendship(ctx, db, alice.ID, bob.ID); err != nil {
		log.Fatalf("seed friendship alice-bob: %v", err)
	}
	if err := ensureFriendship(ctx, db, bob.ID, carol.ID); err != nil {
		log.Fatalf("seed friendship bob-carol: %v", err)
	}

	// carol → alice pending 申请（演示"新的朋友"角标；已是好友/已有申请则跳过）
	if err := ensurePendingRequest(ctx, db, carol.ID, alice.ID, "我是 Carol，产品研发群里加个好友～"); err != nil {
		log.Fatalf("seed friend request: %v", err)
	}

	if err := ensureMessages(ctx, db, privateConv, []seedMsg{
		{bob.ID, "你好 Alice，明天的会议准备得怎么样了？"},
		{alice.ID, "已经准备差不多了，PPT 还在完善"},
		{bob.ID, "好的，需要我帮忙的地方随时说"},
		{alice.ID, "行，那我先把大纲发你看看"},
		{bob.ID, "收到，我晚上看一下"},
		{alice.ID, "辛苦啦"},
		{bob.ID, "客气客气 😄"},
		{alice.ID, "那就这么定了，明天见！"},
	}); err != nil {
		log.Fatalf("seed private messages: %v", err)
	}

	if err := ensureMessages(ctx, db, groupConv, []seedMsg{
		{alice.ID, "早上好各位，今天同步一下发布准备情况"},
		{bob.ID, "接口联调已完成 90%，剩余两个边界场景今天收尾"},
		{carol.ID, "设计稿第二版已上传，大家有空看看"},
		{alice.ID, "看起来不错！发布看板我已经更新到最新"},
		{bob.ID, "收到，我对照检查一下我的模块"},
		{carol.ID, "视觉走查我下午来做"},
		{alice.ID, "发布评审改到明早 9 点，大家注意时间"},
		{bob.ID, "没问题"},
		{carol.ID, "好的，明早见"},
	}); err != nil {
		log.Fatalf("seed group messages: %v", err)
	}

	if err := ensureMessages(ctx, db, bcConv, []seedMsg{
		{carol.ID, "Bob，设计稿第二版的反馈你看了吗？"},
		{bob.ID, "看了，交互那两处我今天改"},
	}); err != nil {
		log.Fatalf("seed bob-carol messages: %v", err)
	}

	fmt.Println("Seed 完成 ✔")
	fmt.Println("测试账号（密码均为 Test@1234）：")
	for i, u := range users {
		fmt.Printf("  %-6s phone=%s short_id=%d id=%s\n", seedUsers[i].nickname, seedUsers[i].phone, u.ShortID, u.ID)
	}
	fmt.Printf("单聊会话: %s\n群聊会话: %s\nBob-Carol 单聊: %s\n", privateConv.ID, groupConv.ID, bcConv.ID)
	fmt.Println("好友：Alice↔Bob、Bob↔Carol；待处理申请：Carol → Alice")
}

// ensureUsers 幂等创建测试用户。
func ensureUsers(ctx context.Context, db *gorm.DB) ([]*model.User, error) {
	sidGen := shortid.NewGenerator(db)
	result := make([]*model.User, 0, len(seedUsers))

	for _, su := range seedUsers {
		var existing model.User
		err := db.WithContext(ctx).First(&existing, "phone = ?", su.phone).Error
		if err == nil {
			result = append(result, &existing)
			continue
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}

		hash, err := password.Hash(seedPassword)
		if err != nil {
			return nil, err
		}
		sid, err := sidGen.Next(ctx)
		if err != nil {
			return nil, err
		}

		phone := su.phone
		user := &model.User{
			Phone:        &phone,
			PasswordHash: hash,
			ShortID:      sid,
			Nickname:     su.nickname,
			Status:       model.UserStatusNormal,
			Role:         su.role,
		}
		if err := db.WithContext(ctx).Create(user).Error; err != nil {
			return nil, err
		}
		result = append(result, user)
	}
	return result, nil
}

type memberSpec struct {
	userID uuid.UUID
	role   int16
}

// ensureConversation 幂等创建会话：按成员集合精确匹配已有会话。
func ensureConversation(ctx context.Context, db *gorm.DB, convType int16, name *string, members []memberSpec) (*model.Conversation, error) {
	memberIDs := make([]uuid.UUID, len(members))
	for i, m := range members {
		memberIDs[i] = m.userID
	}

	// 查找同类型且成员集合完全一致的会话
	// 注意：gorm Raw().Scan 不能直接扫进 uuid.UUID（驱动返回 string），用 string 中转
	var convIDStr string
	err := db.WithContext(ctx).Raw(`
		SELECT c.id FROM conversations c
		WHERE c.type = ? AND c.deleted_at IS NULL
		  AND (SELECT count(*) FROM conversation_members m WHERE m.conversation_id = c.id) = ?
		  AND NOT EXISTS (
		    SELECT 1 FROM conversation_members m
		    WHERE m.conversation_id = c.id AND m.user_id NOT IN ?
		  )
		LIMIT 1`, convType, len(members), memberIDs).Scan(&convIDStr).Error
	if err != nil {
		return nil, err
	}
	if convIDStr != "" {
		var existing model.Conversation
		if err := db.WithContext(ctx).First(&existing, "id = ?", convIDStr).Error; err != nil {
			return nil, err
		}
		return &existing, nil
	}

	conv := &model.Conversation{Type: convType, Name: name}
	if err := db.WithContext(ctx).Create(conv).Error; err != nil {
		return nil, err
	}
	for _, m := range members {
		member := &model.ConversationMember{
			ConversationID: conv.ID,
			UserID:         m.userID,
			Role:           m.role,
			JoinedAt:       time.Now(),
		}
		if err := db.WithContext(ctx).Create(member).Error; err != nil {
			return nil, err
		}
	}
	return conv, nil
}

type seedMsg struct {
	senderID uuid.UUID
	text     string
}

// ensureFriendship 幂等写入双向好友行（已存在则置为 accepted；
// 软删行复活——deleted_at 占住唯一索引，直接 Create 会撞约束）。
// ensureOfficialStickers 幂等创建 1 套占位符官方表情包（8 张纯色圆形 PNG）。
// 已存在同名官方包时跳过——真实素材就绪后可替换本函数生成逻辑，无需改调用方。
func ensureOfficialStickers(ctx context.Context, db *gorm.DB, st *storage.Storage) error {
	const packName = "默认表情"
	var existing model.StickerPack
	err := db.Where("name = ? AND is_official = ?", packName, true).First(&existing).Error
	if err == nil {
		log.Printf("official sticker pack %q already exists, skip", packName)
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("check existing pack: %w", err)
	}

	// 官方包在商城公开可见（IsPublic）；015 之前的存量行由迁移回填
	pack := &model.StickerPack{Name: packName, IsOfficial: true, IsPublic: true, Sort: 0}
	if err := db.Create(pack).Error; err != nil {
		return fmt.Errorf("create pack: %w", err)
	}

	colors := []color.RGBA{
		{255, 205, 210, 255}, {248, 187, 208, 255}, {225, 190, 231, 255}, {197, 202, 233, 255},
		{187, 222, 251, 255}, {178, 235, 242, 255}, {200, 230, 201, 255}, {255, 224, 178, 255},
	}
	const size = 96
	for i, clr := range colors {
		png := placeholderStickerPNG(clr, size)
		key := "images/" + time.Now().Format("2006/01") + "/" + uuid.NewString() + ".png"
		if st != nil {
			if err := st.PutObject(ctx, key, "image/png", bytes.NewReader(png), int64(len(png))); err != nil {
				return fmt.Errorf("upload sticker %d: %w", i, err)
			}
		}
		hash := sha256.Sum256(png)
		sticker := &model.Sticker{
			PackID:      &pack.ID,
			ObjectKey:   key,
			Width:       size,
			Height:      size,
			ContentHash: hex.EncodeToString(hash[:]),
		}
		if err := db.Create(sticker).Error; err != nil {
			return fmt.Errorf("create sticker %d: %w", i, err)
		}
	}
	log.Printf("seeded official sticker pack %q with %d stickers", packName, len(colors))
	return nil
}

// placeholderStickerPNG 生成一枚纯色圆形 PNG（占位符表情素材）。
func placeholderStickerPNG(clr color.RGBA, size int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	center, radius := size/2, size/2-8
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			dx, dy := x-center, y-center
			if dx*dx+dy*dy <= radius*radius {
				img.Set(x, y, clr)
			}
		}
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, img) // in-memory 编码不失败
	return buf.Bytes()
}

func ensureFriendship(ctx context.Context, db *gorm.DB, a, b uuid.UUID) error {
	src := "seed"
	for _, pair := range [][2]uuid.UUID{{a, b}, {b, a}} {
		var existing model.Contact
		err := db.WithContext(ctx).Unscoped().
			First(&existing, "user_id = ? AND contact_user_id = ?", pair[0], pair[1]).Error
		if err == nil {
			if err := db.WithContext(ctx).Unscoped().Model(&existing).
				Updates(map[string]any{
					"status":     model.ContactStatusAccepted,
					"deleted_at": nil,
				}).Error; err != nil {
				return err
			}
			continue
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		contact := &model.Contact{
			UserID:        pair[0],
			ContactUserID: pair[1],
			Status:        model.ContactStatusAccepted,
			Source:        &src,
		}
		if err := db.WithContext(ctx).Create(contact).Error; err != nil {
			return err
		}
	}
	return nil
}

// ensurePendingRequest 幂等创建 pending 好友申请（已有任意状态申请则不动，
// 避免覆盖联调中手动 accept/reject 的结果）。
func ensurePendingRequest(ctx context.Context, db *gorm.DB, requester, target uuid.UUID, message string) error {
	var existing model.FriendRequest
	err := db.WithContext(ctx).
		First(&existing, "requester_id = ? AND target_id = ?", requester, target).Error
	if err == nil {
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	req := &model.FriendRequest{
		RequesterID: requester,
		TargetID:    target,
		Message:     &message,
		Status:      model.FriendRequestStatusPending,
	}
	return db.WithContext(ctx).Create(req).Error
}

// ensureMessages 仅在会话还没有消息时插入历史消息。
// 消息时间从 2 小时前开始每条 +7 分钟；所有成员 last_read_seq 设为最新
// （历史消息视为已读，联调从新消息开始验证未读/回执）。
func ensureMessages(ctx context.Context, db *gorm.DB, conv *model.Conversation, msgs []seedMsg) error {
	var count int64
	if err := db.WithContext(ctx).Model(&model.Message{}).
		Where("conversation_id = ?", conv.ID).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	base := time.Now().Add(-2 * time.Hour)
	var lastMsgID uuid.UUID

	for i, sm := range msgs {
		content, err := json.Marshal(model.MessageContentText{Text: sm.text})
		if err != nil {
			return err
		}
		msg := &model.Message{
			ConversationID: conv.ID,
			SenderID:       sm.senderID,
			Seq:            int64(i + 1),
			MessageType:    model.MessageTypeText,
			Content:        string(content),
			Status:         model.MessageStatusNormal,
			CreatedAt:      base.Add(time.Duration(i) * 7 * time.Minute),
		}
		if err := db.WithContext(ctx).Create(msg).Error; err != nil {
			return err
		}
		lastMsgID = msg.ID
	}

	lastSeq := int64(len(msgs))
	if err := db.WithContext(ctx).Model(&model.Conversation{}).
		Where("id = ?", conv.ID).
		Updates(map[string]any{"last_seq": lastSeq, "last_message_id": lastMsgID}).Error; err != nil {
		return err
	}

	return db.WithContext(ctx).Model(&model.ConversationMember{}).
		Where("conversation_id = ?", conv.ID).
		Update("last_read_seq", lastSeq).Error
}
