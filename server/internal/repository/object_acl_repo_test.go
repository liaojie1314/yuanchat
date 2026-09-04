package repository

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
)

// aclFixture 建一个群会话 + 一条带对象 key 的图片消息，返回会话与消息。
func aclFixture(t *testing.T, db *gorm.DB, key string, members ...uuid.UUID) (*model.Conversation, *model.Message) {
	t.Helper()
	conv := &model.Conversation{Type: model.ConversationTypeGroup, LastSeq: 1}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("create conv: %v", err)
	}
	t.Cleanup(func() {
		db.Exec(`DELETE FROM messages WHERE conversation_id = ?`, conv.ID)
		db.Exec(`DELETE FROM conversation_members WHERE conversation_id = ?`, conv.ID)
		db.Unscoped().Delete(conv)
	})
	for _, uid := range members {
		if err := db.Create(&model.ConversationMember{ConversationID: conv.ID, UserID: uid}).Error; err != nil {
			t.Fatalf("create member: %v", err)
		}
	}
	msg := &model.Message{
		ConversationID: conv.ID,
		SenderID:       members[0],
		Seq:            1,
		MessageType:    model.MessageTypeImage,
		Content:        fmt.Sprintf(`{"key":%q,"width":10,"height":10,"size":123}`, key),
		Status:         model.MessageStatusNormal,
	}
	if err := db.Create(msg).Error; err != nil {
		t.Fatalf("create msg: %v", err)
	}
	return conv, msg
}

// TestObjectACLCanRead_ViaMessage 会话成员可读、非成员不可读。
//
// 这是对象级授权的核心：此前任何登录用户都能为任意合法格式的 key 换到预签名 GET。
func TestObjectACLCanRead_ViaMessage(t *testing.T) {
	db := testDB(t)
	repo := NewObjectACLRepository(db)
	ctx := context.Background()

	member := newTestUser(t, db, "aclmember")
	outsider := newTestUser(t, db, "acloutsider")
	key := fmt.Sprintf("images/2026/08/%s.png", uuid.NewString())
	aclFixture(t, db, key, member.ID)

	ok, err := repo.CanRead(ctx, member.ID, key)
	if err != nil {
		t.Fatalf("member: %v", err)
	}
	if !ok {
		t.Fatal("会话成员应能读取该会话消息里的对象")
	}

	ok, err = repo.CanRead(ctx, outsider.ID, key)
	if err != nil {
		t.Fatalf("outsider: %v", err)
	}
	if ok {
		t.Fatal("非会话成员不应能读取该对象（越权签名）")
	}
}

// TestObjectACLCanRead_RevokedByRecall 撤回后不再可读。
//
// 撤回把 content 置 '{}'，key 从 (content->>'key') 索引消失——这就是"撤回即撤销访问"。
// 已签发的 URL 无法追回，故 TTL 从 24h 收到 2h（见 handler.downloadURLTTL）。
func TestObjectACLCanRead_RevokedByRecall(t *testing.T) {
	db := testDB(t)
	repo := NewObjectACLRepository(db)
	ctx := context.Background()

	member := newTestUser(t, db, "aclrecall")
	key := fmt.Sprintf("images/2026/08/%s.png", uuid.NewString())
	_, msg := aclFixture(t, db, key, member.ID)

	if ok, _ := repo.CanRead(ctx, member.ID, key); !ok {
		t.Fatal("撤回前应可读")
	}

	// 复刻 MessageRepository.Recall 的写法
	if err := db.Model(&model.Message{}).Where("id = ?", msg.ID).
		Updates(map[string]any{"status": model.MessageStatusRevoked, "content": "{}"}).Error; err != nil {
		t.Fatalf("recall: %v", err)
	}

	ok, err := repo.CanRead(ctx, member.ID, key)
	if err != nil {
		t.Fatalf("after recall: %v", err)
	}
	if ok {
		t.Fatal("撤回后不应再签得出下载 URL")
	}
}

// TestObjectACLCanRead_RevokedByClearHistory 本人清空聊天记录后对本人失效、对他人不影响。
func TestObjectACLCanRead_RevokedByClearHistory(t *testing.T) {
	db := testDB(t)
	repo := NewObjectACLRepository(db)
	ctx := context.Background()

	me := newTestUser(t, db, "aclclearme")
	peer := newTestUser(t, db, "aclclearpeer")
	key := fmt.Sprintf("images/2026/08/%s.png", uuid.NewString())
	conv, _ := aclFixture(t, db, key, me.ID, peer.ID)

	// 只推进 me 的水位（消息 seq = 1）
	if err := db.Model(&model.ConversationMember{}).
		Where("conversation_id = ? AND user_id = ?", conv.ID, me.ID).
		Update("cleared_before_seq", 1).Error; err != nil {
		t.Fatalf("clear history: %v", err)
	}

	if ok, _ := repo.CanRead(ctx, me.ID, key); ok {
		t.Fatal("本人清空后不应再可读")
	}
	if ok, _ := repo.CanRead(ctx, peer.ID, key); !ok {
		t.Fatal("他人不受本人清空影响，应仍可读")
	}
}

// TestObjectACLCanRead_ViaSticker 收藏贴纸对本人可读、对他人不可读；表情包贴纸全员可读。
func TestObjectACLCanRead_ViaSticker(t *testing.T) {
	db := testDB(t)
	if err := db.AutoMigrate(&model.StickerPack{}, &model.Sticker{}); err != nil {
		t.Fatalf("migrate stickers: %v", err)
	}
	repo := NewObjectACLRepository(db)
	ctx := context.Background()

	owner := newTestUser(t, db, "aclstickerowner")
	other := newTestUser(t, db, "aclstickerother")

	ownKey := fmt.Sprintf("images/2026/08/%s.png", uuid.NewString())
	ownerID := owner.ID
	own := &model.Sticker{
		OwnerID:     &ownerID,
		ObjectKey:   ownKey,
		Width:       96,
		Height:      96,
		ContentHash: fmt.Sprintf("%064x", time.Now().UnixNano()),
	}
	if err := db.Create(own).Error; err != nil {
		t.Fatalf("create own sticker: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(own) })

	packKey := fmt.Sprintf("images/2026/08/%s.png", uuid.NewString())
	pack := &model.StickerPack{Name: "acl-test-pack", IsOfficial: true}
	if err := db.Create(pack).Error; err != nil {
		t.Fatalf("create pack: %v", err)
	}
	packSticker := &model.Sticker{
		PackID:      &pack.ID,
		ObjectKey:   packKey,
		Width:       96,
		Height:      96,
		ContentHash: fmt.Sprintf("%064x", time.Now().UnixNano()+1),
	}
	if err := db.Create(packSticker).Error; err != nil {
		t.Fatalf("create pack sticker: %v", err)
	}
	t.Cleanup(func() {
		db.Unscoped().Delete(packSticker)
		db.Unscoped().Delete(pack)
	})

	if ok, _ := repo.CanRead(ctx, owner.ID, ownKey); !ok {
		t.Fatal("本人收藏的贴纸应可读")
	}
	if ok, _ := repo.CanRead(ctx, other.ID, ownKey); ok {
		t.Fatal("他人的收藏贴纸不应可读")
	}
	if ok, _ := repo.CanRead(ctx, other.ID, packKey); !ok {
		t.Fatal("表情包贴纸对全员可读（官方包人人可发）")
	}
}

// TestObjectACLReferencedKeys_PackCover 表情包封面必须被 GC 判定为在用对象。
//
// cover_url 存的是完整 URL，走后缀匹配——此前引用收集漏掉 sticker_packs.cover_url，
// `cmd/gc -delete` 会把全部贴纸包封面判为孤儿删掉（官方包封面早已入库，风险现成存在）。
func TestObjectACLReferencedKeys_PackCover(t *testing.T) {
	db := testDB(t)
	if err := db.AutoMigrate(&model.StickerPack{}); err != nil {
		t.Fatalf("migrate sticker_packs: %v", err)
	}
	repo := NewObjectACLRepository(db)
	ctx := context.Background()

	coverKey := fmt.Sprintf("sticker-covers/2026/08/%s.png", uuid.NewString())
	coverURL := "http://minio:9000/yuanchat/" + coverKey
	pack := &model.StickerPack{Name: "gc-cover-pack", CoverURL: &coverURL, IsOfficial: true}
	if err := db.Create(pack).Error; err != nil {
		t.Fatalf("create pack: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(pack) })

	orphanKey := fmt.Sprintf("sticker-covers/2026/08/%s.png", uuid.NewString())

	got, err := repo.ReferencedKeys(ctx, []string{coverKey, orphanKey})
	if err != nil {
		t.Fatalf("ReferencedKeys: %v", err)
	}
	if _, ok := got[coverKey]; !ok {
		t.Fatalf("%s 是贴纸包封面，应被判定为仍被引用（GC 会误删）", coverKey)
	}
	if _, ok := got[orphanKey]; ok {
		t.Fatalf("%s 无任何引用，不应出现在结果里（GC 会漏删）", orphanKey)
	}
}

// TestObjectACLReferencedKeys GC 的引用判定：消息/贴纸/头像引用都算，其余为孤儿。
func TestObjectACLReferencedKeys(t *testing.T) {
	db := testDB(t)
	if err := db.AutoMigrate(&model.StickerPack{}, &model.Sticker{}); err != nil {
		t.Fatalf("migrate stickers: %v", err)
	}
	repo := NewObjectACLRepository(db)
	ctx := context.Background()

	member := newTestUser(t, db, "aclrefmsg")
	msgKey := fmt.Sprintf("images/2026/01/%s.png", uuid.NewString())
	aclFixture(t, db, msgKey, member.ID)

	stickerKey := fmt.Sprintf("images/2026/01/%s.png", uuid.NewString())
	ownerID := member.ID
	sticker := &model.Sticker{
		OwnerID:     &ownerID,
		ObjectKey:   stickerKey,
		Width:       96,
		Height:      96,
		ContentHash: fmt.Sprintf("%064x", time.Now().UnixNano()+2),
	}
	if err := db.Create(sticker).Error; err != nil {
		t.Fatalf("create sticker: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(sticker) })

	avatarKey := fmt.Sprintf("avatars/2026/01/%s.jpg", uuid.NewString())
	avatarURL := "http://minio:9000/yuanchat/" + avatarKey
	if err := db.Model(&model.User{}).Where("id = ?", member.ID).
		Update("avatar_url", avatarURL).Error; err != nil {
		t.Fatalf("set avatar: %v", err)
	}

	orphanKey := fmt.Sprintf("images/2026/01/%s.png", uuid.NewString())

	got, err := repo.ReferencedKeys(ctx, []string{msgKey, stickerKey, avatarKey, orphanKey})
	if err != nil {
		t.Fatalf("ReferencedKeys: %v", err)
	}
	for _, want := range []string{msgKey, stickerKey, avatarKey} {
		if _, ok := got[want]; !ok {
			t.Fatalf("%s 应被判定为仍被引用（GC 会误删）", want)
		}
	}
	if _, ok := got[orphanKey]; ok {
		t.Fatalf("%s 无任何引用，不应出现在结果里（GC 会漏删）", orphanKey)
	}

	// 空输入不查库、返回空集合
	empty, err := repo.ReferencedKeys(ctx, nil)
	if err != nil || len(empty) != 0 {
		t.Fatalf("空输入应返回空集合，got %v err %v", empty, err)
	}
}

// aclVideoFixture 建一个群会话 + 一条视频消息（content 同时带 key 与 thumb_key），
// 返回会话与消息，供 thumb_key 授权/引用用例复用。
func aclVideoFixture(t *testing.T, db *gorm.DB, key, thumbKey string, members ...uuid.UUID) (*model.Conversation, *model.Message) {
	t.Helper()
	conv := &model.Conversation{Type: model.ConversationTypeGroup, LastSeq: 1}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("create conv: %v", err)
	}
	t.Cleanup(func() {
		db.Exec(`DELETE FROM messages WHERE conversation_id = ?`, conv.ID)
		db.Exec(`DELETE FROM conversation_members WHERE conversation_id = ?`, conv.ID)
		db.Unscoped().Delete(conv)
	})
	for _, uid := range members {
		if err := db.Create(&model.ConversationMember{ConversationID: conv.ID, UserID: uid}).Error; err != nil {
			t.Fatalf("create member: %v", err)
		}
	}
	msg := &model.Message{
		ConversationID: conv.ID,
		SenderID:       members[0],
		Seq:            1,
		MessageType:    model.MessageTypeVideo,
		Content: fmt.Sprintf(
			`{"key":%q,"thumb_key":%q,"name":"demo.mp4","size":2048000,"duration":15,"width":1280,"height":720}`,
			key, thumbKey),
		Status: model.MessageStatusNormal,
	}
	if err := db.Create(msg).Error; err != nil {
		t.Fatalf("create video msg: %v", err)
	}
	return conv, msg
}

// TestCanReadVideoThumb 视频缩略图（content.thumb_key）与主视频（content.key）同权可读。
//
// 缩略图不在 content.key 上，若授权只匹配 key，相册与聊天气泡里的视频封面就换不到
// 预签名 URL（表现为整片空白封面）；反过来撤回必须同时收回两者的可读性，
// 否则"撤回即撤销访问"对缩略图这一半失效。
func TestCanReadVideoThumb(t *testing.T) {
	db := testDB(t)
	repo := NewObjectACLRepository(db)
	ctx := context.Background()

	member := newTestUser(t, db, "aclvideomember")
	outsider := newTestUser(t, db, "aclvideooutsider")
	key := fmt.Sprintf("files/2026/09/%s.mp4", uuid.NewString())
	thumbKey := fmt.Sprintf("images/2026/09/%s.jpg", uuid.NewString())
	_, msg := aclVideoFixture(t, db, key, thumbKey, member.ID)

	for name, k := range map[string]string{"主视频": key, "缩略图": thumbKey} {
		ok, err := repo.CanRead(ctx, member.ID, k)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if !ok {
			t.Fatalf("会话成员应能读取%s（%s）", name, k)
		}
		ok, err = repo.CanRead(ctx, outsider.ID, k)
		if err != nil {
			t.Fatalf("%s outsider: %v", name, err)
		}
		if ok {
			t.Fatalf("非会话成员不应能读取%s（越权签名）", name)
		}
	}

	// 撤回（content 置 '{}'）→ 主视频与缩略图同时失效
	if err := db.Model(&model.Message{}).Where("id = ?", msg.ID).
		Updates(map[string]any{"status": model.MessageStatusRevoked, "content": "{}"}).Error; err != nil {
		t.Fatalf("recall: %v", err)
	}
	for name, k := range map[string]string{"主视频": key, "缩略图": thumbKey} {
		ok, err := repo.CanRead(ctx, member.ID, k)
		if err != nil {
			t.Fatalf("%s after recall: %v", name, err)
		}
		if ok {
			t.Fatalf("撤回后不应再签得出%s的下载 URL", name)
		}
	}
}

// TestCanReadVideoThumbClearedByHistory 本人清空聊天记录后缩略图对本人失效、对他人不影响。
func TestCanReadVideoThumbClearedByHistory(t *testing.T) {
	db := testDB(t)
	repo := NewObjectACLRepository(db)
	ctx := context.Background()

	me := newTestUser(t, db, "aclvideoclearme")
	peer := newTestUser(t, db, "aclvideoclearpeer")
	key := fmt.Sprintf("files/2026/09/%s.mp4", uuid.NewString())
	thumbKey := fmt.Sprintf("images/2026/09/%s.jpg", uuid.NewString())
	conv, _ := aclVideoFixture(t, db, key, thumbKey, me.ID, peer.ID)

	// 只推进 me 的水位（消息 seq = 1）
	if err := db.Model(&model.ConversationMember{}).
		Where("conversation_id = ? AND user_id = ?", conv.ID, me.ID).
		Update("cleared_before_seq", 1).Error; err != nil {
		t.Fatalf("clear history: %v", err)
	}

	if ok, _ := repo.CanRead(ctx, me.ID, thumbKey); ok {
		t.Fatal("本人清空后缩略图不应再可读")
	}
	if ok, _ := repo.CanRead(ctx, peer.ID, thumbKey); !ok {
		t.Fatal("他人不受本人清空影响，缩略图应仍可读")
	}
}

// TestReferencedKeysIncludesThumb GC 引用判定必须覆盖 thumb_key。
//
// 漏掉即 `cmd/gc -delete` 会把所有在用的视频封面当孤儿删掉（消息还在、封面 404）。
func TestReferencedKeysIncludesThumb(t *testing.T) {
	db := testDB(t)
	repo := NewObjectACLRepository(db)
	ctx := context.Background()

	member := newTestUser(t, db, "aclrefthumb")
	key := fmt.Sprintf("files/2026/09/%s.mp4", uuid.NewString())
	thumbKey := fmt.Sprintf("images/2026/09/%s.jpg", uuid.NewString())
	orphanKey := fmt.Sprintf("images/2026/09/%s.jpg", uuid.NewString())
	_, msg := aclVideoFixture(t, db, key, thumbKey, member.ID)

	got, err := repo.ReferencedKeys(ctx, []string{key, thumbKey, orphanKey})
	if err != nil {
		t.Fatalf("ReferencedKeys: %v", err)
	}
	for _, want := range []string{key, thumbKey} {
		if _, ok := got[want]; !ok {
			t.Fatalf("%s 仍被视频消息引用，应判定为在用（GC 会误删）", want)
		}
	}
	if _, ok := got[orphanKey]; ok {
		t.Fatalf("%s 无任何引用，不应出现在结果里（GC 会漏删）", orphanKey)
	}

	// 撤回后两者都不再被引用（content 置 '{}'）→ GC 可回收
	if err := db.Model(&model.Message{}).Where("id = ?", msg.ID).
		Updates(map[string]any{"status": model.MessageStatusRevoked, "content": "{}"}).Error; err != nil {
		t.Fatalf("recall: %v", err)
	}
	got, err = repo.ReferencedKeys(ctx, []string{key, thumbKey})
	if err != nil {
		t.Fatalf("ReferencedKeys after recall: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("撤回后主视频与缩略图都应变成孤儿，got %v", got)
	}
}
