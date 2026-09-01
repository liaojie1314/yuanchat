package service

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
)

// 本文件覆盖 admin-hardening 三项：
//   - 重置头像（P0-3）：avatar_url 置空 + 审计 + 404
//   - 存储统计（P1-3）：DB 聚合口径的类别计数与字节数
//   - 删消息级联清收藏（P2-1）：admin 删除后收藏不再悬空

// TestAdminResetAvatar 重置头像：avatar_url 置空（前端回退默认头像渲染）、
// 写 reset_avatar 审计一条；目标不存在返回 ErrUserNotFound 且无审计。
func TestAdminResetAvatar(t *testing.T) {
	db := adminTestDB(t)
	ctx := context.Background()
	svc := newAdminService(db)

	admin := newAdminTestUser(t, db, "重置头像管理员", model.RoleAdmin)
	victim := newAdminTestUser(t, db, "重置头像用户", model.RoleUser)
	avatar := "http://minio:9002/media/avatars/old.png"
	if err := db.Model(victim).Update("avatar_url", avatar).Error; err != nil {
		t.Fatalf("set avatar: %v", err)
	}

	if err := svc.ResetAvatar(ctx, admin.ID, victim.ID); err != nil {
		t.Fatalf("ResetAvatar: %v", err)
	}
	var got model.User
	if err := db.First(&got, "id = ?", victim.ID).Error; err != nil {
		t.Fatalf("reload victim: %v", err)
	}
	if got.AvatarURL != nil {
		t.Fatalf("avatar_url = %q, want nil (default avatar fallback)", *got.AvatarURL)
	}
	var logs int64
	db.Model(&model.AdminActionLog{}).
		Where("actor_id = ? AND action = ? AND target_id = ?",
			admin.ID, model.AdminActionResetAvatar, victim.ID.String()).Count(&logs)
	if logs != 1 {
		t.Fatalf("reset_avatar audit log count = %d, want 1", logs)
	}

	// 目标不存在：404 语义（ErrUserNotFound），且不写审计
	if err := svc.ResetAvatar(ctx, admin.ID, uuid.New()); err != ErrUserNotFound {
		t.Fatalf("ResetAvatar(missing) = %v, want ErrUserNotFound", err)
	}
	var missing int64
	db.Model(&model.AdminActionLog{}).
		Where("actor_id = ? AND action = ?", admin.ID, model.AdminActionResetAvatar).Count(&missing)
	if missing != 1 {
		t.Fatalf("audit log count after 404 = %d, want still 1", missing)
	}
}

// TestAdminStorageStats 存储统计 DB 聚合口径：头像按 avatar_url 非空计数、
// 贴纸/封面按行计数（字节数未知为 nil）、图片/文件/语音消息按类型计数并
// 对 content JSONB 里的 size 求和。
func TestAdminStorageStats(t *testing.T) {
	db := adminTestDB(t)
	ctx := context.Background()
	svc := newAdminService(db)

	// 基线（隔离夹具库内其他用例遗留数据的偏移）
	base, err := svc.StorageStats(ctx)
	if err != nil {
		t.Fatalf("StorageStats baseline: %v", err)
	}
	byCat := func(stats *StorageStats, cat string) repository.StorageStat {
		for _, row := range stats.Categories {
			if row.Category == cat {
				return row
			}
		}
		t.Fatalf("category %q missing", cat)
		return repository.StorageStat{}
	}
	baseAvatar := byCat(base, "avatar").ObjectCount
	baseImage := byCat(base, "message_image")
	baseFile := byCat(base, "message_file")
	baseVoice := byCat(base, "message_voice")
	baseSticker := byCat(base, "sticker").ObjectCount
	baseCover := byCat(base, "sticker_cover").ObjectCount

	// 造数：2 个带头像用户、1 图（size=100）、1 文件（size=200）、1 语音（size=300，已删除不计）、
	// 1 张贴纸、1 个带封面表情包
	u1 := newAdminTestUser(t, db, "存储用户1", model.RoleUser)
	u2 := newAdminTestUser(t, db, "存储用户2", model.RoleUser)
	db.Model(u1).Update("avatar_url", "http://x/avatars/a.png")
	db.Model(u2).Update("avatar_url", "http://x/avatars/b.png")

	conv := &model.Conversation{ID: uuid.New(), Type: model.ConversationTypePrivate}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	seq := int64(0)
	mkMsg := func(mType int16, content string) *model.Message {
		seq++ // (conversation_id, seq) 联合唯一，逐条递增
		msg := &model.Message{
			ConversationID: conv.ID, SenderID: u1.ID, Seq: seq,
			MessageType: mType, Content: content, Status: model.MessageStatusNormal,
		}
		if err := db.Create(msg).Error; err != nil {
			t.Fatalf("create message: %v", err)
		}
		return msg
	}
	mkMsg(model.MessageTypeImage, `{"key":"images/x/a.png","width":1,"height":1,"size":100}`)
	mkMsg(model.MessageTypeFile, `{"key":"files/x/b.zip","name":"b.zip","size":200}`)
	deleted := mkMsg(model.MessageTypeVoice, `{"key":"files/x/c.webm","duration":3,"size":300}`)
	if err := db.Delete(deleted).Error; err != nil { // 软删：不计入统计
		t.Fatalf("delete voice message: %v", err)
	}
	sticker := &model.Sticker{OwnerID: &u1.ID, ObjectKey: "images/x/s.png", Width: 96, Height: 96, ContentHash: "hash-storage-1"}
	if err := db.Create(sticker).Error; err != nil {
		t.Fatalf("create sticker: %v", err)
	}
	pack := &model.StickerPack{Name: "存储统计包", CoverURL: &[]string{"http://x/sticker-covers/c.png"}[0], IsPublic: true}
	if err := db.Create(pack).Error; err != nil {
		t.Fatalf("create pack: %v", err)
	}

	stats, err := svc.StorageStats(ctx)
	if err != nil {
		t.Fatalf("StorageStats: %v", err)
	}

	if got, want := byCat(stats, "avatar").ObjectCount, baseAvatar+2; got != want {
		t.Fatalf("avatar count = %d, want %d", got, want)
	}
	img := byCat(stats, "message_image")
	if img.ObjectCount != baseImage.ObjectCount+1 {
		t.Fatalf("message_image count = %d, want %d", img.ObjectCount, baseImage.ObjectCount+1)
	}
	if img.TotalBytes == nil || *img.TotalBytes != *baseImage.TotalBytes+100 {
		t.Fatalf("message_image bytes = %v, want +%d", img.TotalBytes, 100)
	}
	file := byCat(stats, "message_file")
	if file.ObjectCount != baseFile.ObjectCount+1 || *file.TotalBytes != *baseFile.TotalBytes+200 {
		t.Fatalf("message_file = %d/%v, want +1/+200", file.ObjectCount, file.TotalBytes)
	}
	voice := byCat(stats, "message_voice")
	// 已软删的语音不计入
	if voice.ObjectCount != baseVoice.ObjectCount || *voice.TotalBytes != *baseVoice.TotalBytes {
		t.Fatalf("message_voice = %d/%v, want unchanged (deleted excluded)", voice.ObjectCount, voice.TotalBytes)
	}
	if got, want := byCat(stats, "sticker").ObjectCount, baseSticker+1; got != want {
		t.Fatalf("sticker count = %d, want %d", got, want)
	}
	if got, want := byCat(stats, "sticker_cover").ObjectCount, baseCover+1; got != want {
		t.Fatalf("sticker_cover count = %d, want %d", got, want)
	}
	// 未知字节数的类别 total_bytes 必须为 nil（前端显示「—」）
	for _, cat := range []string{"avatar", "sticker", "sticker_cover"} {
		if byCat(stats, cat).TotalBytes != nil {
			t.Fatalf("category %q bytes must be nil", cat)
		}
	}
}

// TestAdminDeleteMessageCascadesFavorites 管理员删除被收藏的消息：
// 收藏行同事务级联删除，收藏列表不再返回该消息的收藏快照。
func TestAdminDeleteMessageCascadesFavorites(t *testing.T) {
	db := adminTestDB(t)
	ctx := context.Background()
	svc := newAdminService(db)

	admin := newAdminTestUser(t, db, "级联管理员", model.RoleAdmin)
	user := newAdminTestUser(t, db, "收藏者", model.RoleUser)
	conv := &model.Conversation{ID: uuid.New(), Type: model.ConversationTypePrivate}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	msg := &model.Message{
		ConversationID: conv.ID, SenderID: admin.ID, Seq: 1,
		MessageType: model.MessageTypeText, Content: `{"text":"违规内容"}`, Status: model.MessageStatusNormal,
	}
	if err := db.Create(msg).Error; err != nil {
		t.Fatalf("create message: %v", err)
	}
	favRepo := repository.NewFavoriteRepository(db)
	favSvc := NewFavoriteService(favRepo, repository.NewMessageRepository(db),
		repository.NewConversationRepository(db), repository.NewUserRepository(db), nil)
	fav := &model.Favorite{
		UserID: user.ID, MessageID: msg.ID, ConversationID: conv.ID,
		ConvName: "", SenderNickname: admin.Nickname,
		MessageType: msg.MessageType, Content: msg.Content,
	}
	if _, err := favRepo.Add(ctx, fav); err != nil {
		t.Fatalf("add favorite: %v", err)
	}

	// 删除前收藏可见
	favs, _, err := favSvc.List(ctx, user.ID, "", 20, 0)
	if err != nil || len(favs) != 1 {
		t.Fatalf("favorites before delete = %d items, err %v, want 1", len(favs), err)
	}

	if err := svc.DeleteMessage(ctx, admin.ID, msg.ID); err != nil {
		t.Fatalf("DeleteMessage: %v", err)
	}

	// 收藏列表不再返回该消息的收藏（无悬挂快照）
	favs, _, err = favSvc.List(ctx, user.ID, "", 20, 0)
	if err != nil {
		t.Fatalf("favorites after delete: %v", err)
	}
	for _, f := range favs {
		if f.MessageID == msg.ID {
			t.Fatalf("favorite snapshot for deleted message %s still listed", msg.ID)
		}
	}
	var count int64
	db.Model(&model.Favorite{}).Where("message_id = ?", msg.ID).Count(&count)
	if count != 0 {
		t.Fatalf("favorites rows for deleted message = %d, want 0", count)
	}

	// 删除不存在的消息：不报错也不误删收藏（RowsAffected=0 短路）
	if err := svc.DeleteMessage(ctx, admin.ID, uuid.New()); err != ErrMessageNotFound {
		t.Fatalf("DeleteMessage(missing) = %v, want ErrMessageNotFound", err)
	}
}
