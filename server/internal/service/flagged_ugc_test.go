package service

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/pkg/jwt"
	"github.com/yuanchat/server/internal/pkg/shortid"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// 敏感词命中测试词：一个词库单词，多个用例复用（词库内容不影响行为断言）。
const testBadWord = "违规词"

// newUGCModeration 返回带测试词库的审核服务。
func newUGCModeration() *ModerationService {
	return NewModerationService([]string{testBadWord})
}

// newUGCFlaggedSvc 构造注入了审核词库与命中记录仓库的用户服务。
func newUGCFlaggedSvc(db *gorm.DB) *UserService {
	svc := NewUserService(repository.NewUserRepository(db), nil, nil, nil, zap.NewNop())
	svc.SetUGCModeration(newUGCModeration(), repository.NewFlaggedUGCRepository(db))
	return svc
}

// countFlaggedUGC 统计当前事务内某类型的命中记录数。
func countFlaggedUGC(t *testing.T, db *gorm.DB, ugcType string) int64 {
	t.Helper()
	var n int64
	if err := db.Model(&model.FlaggedUGC{}).Where("ugc_type = ?", ugcType).Count(&n).Error; err != nil {
		t.Fatalf("count flagged ugc: %v", err)
	}
	return n
}

// TestUpdateProfileFlagsSensitiveNicknameAndBio 昵称 / bio 命中敏感词：
// 写入照常成功（打标不阻塞），同时各记一条命中记录；未命中的更新不产生记录。
// TestRegisterFlagsSensitiveNickname 注册昵称命中敏感词：注册照常成功
// （打标不阻塞），命中记入 flagged_ugc 台账并关联新用户；干净昵称不产生记录。
func TestRegisterFlagsSensitiveNickname(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	// 注册路径需要完整依赖：sidGen（短号）与 jwtGen（签发令牌）都不可为 nil。
	svc := NewUserService(
		repository.NewUserRepository(db),
		jwt.NewGenerator("test-secret", time.Minute, time.Hour),
		shortid.NewGenerator(db),
		nil,
		zap.NewNop(),
	)
	svc.SetUGCModeration(newUGCModeration(), repository.NewFlaggedUGCRepository(db))
	badReq := RegisterRequest{
		Phone:    "19800001111",
		Password: "Passw0rdX",
		Nickname: testBadWord + "昵称",
	}
	res, err := svc.Register(ctx, badReq)
	if err != nil {
		t.Fatalf("register with flagged nickname: %v", err)
	}
	if res.User.Nickname != badReq.Nickname {
		t.Fatalf("flagged nickname not persisted: %q", res.User.Nickname)
	}
	if n := countFlaggedUGC(t, db, model.UGCTypeNickname); n != 1 {
		t.Fatalf("nickname flag records = %d, want 1", n)
	}
	var rec model.FlaggedUGC
	if err := db.First(&rec, "ugc_type = ?", model.UGCTypeNickname).Error; err != nil {
		t.Fatalf("load flagged record: %v", err)
	}
	if rec.UserID == nil || *rec.UserID != res.User.ID {
		t.Fatalf("flagged record not linked to registered user: %v", rec.UserID)
	}

	cleanReq := badReq
	cleanReq.Phone = "19800002222"
	cleanReq.Nickname = "干净的昵称"
	if _, err := svc.Register(ctx, cleanReq); err != nil {
		t.Fatalf("register with clean nickname: %v", err)
	}
	if n := countFlaggedUGC(t, db, model.UGCTypeNickname); n != 1 {
		t.Fatalf("clean nickname flagged, records = %d, want 1", n)
	}
}

func TestUpdateProfileFlagsSensitiveNicknameAndBio(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	user := newTestUser(t, db, "ugc-用户")
	svc := newUGCFlaggedSvc(db)

	clean := "干净的昵称"
	if _, err := svc.UpdateProfile(ctx, user.ID, ProfilePatch{Nickname: &clean}); err != nil {
		t.Fatalf("update clean nickname: %v", err)
	}
	if n := countFlaggedUGC(t, db, model.UGCTypeNickname); n != 0 {
		t.Fatalf("clean nickname flagged, records = %d", n)
	}

	bad := "带" + testBadWord + "的昵称"
	if _, err := svc.UpdateProfile(ctx, user.ID, ProfilePatch{Nickname: &bad}); err != nil {
		t.Fatalf("update flagged nickname: %v", err)
	}
	// 命中仍写入成功
	var got model.User
	if err := db.First(&got, "id = ?", user.ID).Error; err != nil {
		t.Fatalf("reload user: %v", err)
	}
	if got.Nickname != bad {
		t.Fatalf("flagged nickname not persisted: %q", got.Nickname)
	}
	if n := countFlaggedUGC(t, db, model.UGCTypeNickname); n != 1 {
		t.Fatalf("nickname flag records = %d, want 1", n)
	}

	bio := "签名里有" + testBadWord
	if _, err := svc.UpdateProfile(ctx, user.ID, ProfilePatch{Bio: &bio}); err != nil {
		t.Fatalf("update flagged bio: %v", err)
	}
	if n := countFlaggedUGC(t, db, model.UGCTypeBio); n != 1 {
		t.Fatalf("bio flag records = %d, want 1", n)
	}
}

// TestRenameGroupAndAnnouncementFlagUGC 群名 / 群公告命中敏感词：
// 操作照常生效（系统消息、群名更新不变），命中记入 flagged_ugc 并关联会话。
func TestRenameGroupAndAnnouncementFlagUGC(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	svc := newConvSvc(db)
	svc.SetUGCModeration(newUGCModeration(), repository.NewFlaggedUGCRepository(db))

	owner := newTestUser(t, db, "ugc-群主")
	m1 := newTestUser(t, db, "ugc-成员")
	makeFriends(t, db, owner.ID, m1.ID)
	convID := newManagedGroup(t, svc, owner.ID, []uuid.UUID{m1.ID})

	badName := testBadWord + "群"
	if _, err := svc.RenameGroup(ctx, owner.ID, convID, badName); err != nil {
		t.Fatalf("rename with flagged name: %v", err)
	}
	var conv model.Conversation
	if err := db.First(&conv, "id = ?", convID).Error; err != nil {
		t.Fatalf("load conversation: %v", err)
	}
	if conv.Name == nil || *conv.Name != badName {
		t.Fatalf("flagged group name not persisted: %v", conv.Name)
	}
	if n := countFlaggedUGC(t, db, model.UGCTypeGroupName); n != 1 {
		t.Fatalf("group name flag records = %d, want 1", n)
	}

	badAnn := "公告" + testBadWord
	if _, _, _, err := svc.UpdateAnnouncement(ctx, owner.ID, convID, badAnn); err != nil {
		t.Fatalf("update flagged announcement: %v", err)
	}
	if n := countFlaggedUGC(t, db, model.UGCTypeAnnouncement); n != 1 {
		t.Fatalf("announcement flag records = %d, want 1", n)
	}
}

// TestAdminResetFlaggedUGC 强制重置：昵称重置为默认「用户{短号}」、bio 清空、
// 群名清空、公告清空，记录关闭，处置写审计日志。
func TestAdminResetFlaggedUGC(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	admin := newAdminTestUser(t, db, "重置管理员", model.RoleAdmin)
	victim := newAdminTestUser(t, db, "违规"+testBadWord, model.RoleUser)
	ugcRepo := repository.NewFlaggedUGCRepository(db)
	svc := newAdminService(db)

	// 昵称重置
	rec := &model.FlaggedUGC{UGCType: model.UGCTypeNickname, Content: victim.Nickname,
		HitWord: testBadWord, UserID: &victim.ID}
	if err := ugcRepo.Create(ctx, rec); err != nil {
		t.Fatalf("create record: %v", err)
	}
	if err := svc.ResetFlaggedUGC(ctx, admin.ID, rec.ID); err != nil {
		t.Fatalf("reset nickname: %v", err)
	}
	var got model.User
	if err := db.First(&got, "id = ?", victim.ID).Error; err != nil {
		t.Fatalf("reload victim: %v", err)
	}
	if want := fmt.Sprintf("用户%d", got.ShortID); got.Nickname != want {
		t.Fatalf("nickname = %q, want default %q", got.Nickname, want)
	}

	// bio 重置（清空）
	bioRec := &model.FlaggedUGC{UGCType: model.UGCTypeBio, Content: "违规签名",
		HitWord: testBadWord, UserID: &victim.ID}
	if err := ugcRepo.Create(ctx, bioRec); err != nil {
		t.Fatalf("create bio record: %v", err)
	}
	if err := svc.ResetFlaggedUGC(ctx, admin.ID, bioRec.ID); err != nil {
		t.Fatalf("reset bio: %v", err)
	}
	var got2 model.User
	if err := db.First(&got2, "id = ?", victim.ID).Error; err != nil {
		t.Fatalf("reload victim: %v", err)
	}
	if got2.Bio != nil {
		t.Fatalf("bio not cleared: %q", *got2.Bio)
	}

	// 群名与公告重置（清空）
	convSvc := newConvSvc(db)
	owner := newTestUser(t, db, "重置群主")
	m1 := newTestUser(t, db, "重置成员")
	makeFriends(t, db, owner.ID, m1.ID)
	convID := newManagedGroup(t, convSvc, owner.ID, []uuid.UUID{m1.ID})
	nameRec := &model.FlaggedUGC{UGCType: model.UGCTypeGroupName, Content: "违规群名",
		HitWord: testBadWord, UserID: &owner.ID, ConversationID: &convID}
	annRec := &model.FlaggedUGC{UGCType: model.UGCTypeAnnouncement, Content: "违规公告",
		HitWord: testBadWord, UserID: &owner.ID, ConversationID: &convID}
	for _, rec := range []*model.FlaggedUGC{nameRec, annRec} {
		if err := ugcRepo.Create(ctx, rec); err != nil {
			t.Fatalf("create group record: %v", err)
		}
		if err := svc.ResetFlaggedUGC(ctx, admin.ID, rec.ID); err != nil {
			t.Fatalf("reset group ugc (%s): %v", rec.UGCType, err)
		}
	}
	var gotConv model.Conversation
	if err := db.First(&gotConv, "id = ?", convID).Error; err != nil {
		t.Fatalf("load conversation: %v", err)
	}
	if gotConv.Name != nil {
		t.Fatalf("group name not cleared: %q", *gotConv.Name)
	}
	if gotConv.Announcement != nil {
		t.Fatalf("announcement not cleared: %q", *gotConv.Announcement)
	}

	// 记录全部关闭
	var pending int64
	db.Model(&model.FlaggedUGC{}).Where("handled_at IS NULL").Count(&pending)
	if pending != 0 {
		t.Fatalf("pending records = %d, want 0", pending)
	}

	// 审计日志：昵称与群名重置各一条
	for _, action := range []string{model.AdminActionResetNickname, model.AdminActionResetBio,
		model.AdminActionResetGroupName, model.AdminActionResetAnnouncement} {
		var n int64
		db.Model(&model.AdminActionLog{}).Where("actor_id = ? AND action = ?", admin.ID, action).Count(&n)
		if n != 1 {
			t.Fatalf("audit log %s count = %d, want 1", action, n)
		}
	}
}

// TestAdminListAndDismissFlaggedUGC 队列检索三态过滤 + 放行处置：
// pending 只看待处理、handled 只看已处置；放行不动业务内容，只关记录并写审计。
func TestAdminListAndDismissFlaggedUGC(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	admin := newAdminTestUser(t, db, "队列管理员", model.RoleAdmin)
	user := newAdminTestUser(t, db, "队列用户", model.RoleUser)
	ugcRepo := repository.NewFlaggedUGCRepository(db)
	svc := newAdminService(db)

	rec := &model.FlaggedUGC{UGCType: model.UGCTypeNickname, Content: "待审昵称" + testBadWord,
		HitWord: testBadWord, UserID: &user.ID}
	if err := ugcRepo.Create(ctx, rec); err != nil {
		t.Fatalf("create record: %v", err)
	}

	// pending 视图可见
	list, total, err := svc.SearchFlaggedUGC(ctx, "", "pending", 1, 10)
	if err != nil || total != 1 || len(list) != 1 {
		t.Fatalf("pending list = %d items, total %d, err %v", len(list), total, err)
	}
	// 类型过滤
	if _, total, err = svc.SearchFlaggedUGC(ctx, model.UGCTypeBio, "pending", 1, 10); err != nil || total != 0 {
		t.Fatalf("bio filter total = %d, err %v", total, err)
	}

	// 放行：内容不动、记录关闭、写审计
	if err := svc.DismissFlaggedUGC(ctx, admin.ID, rec.ID); err != nil {
		t.Fatalf("dismiss: %v", err)
	}
	if n := countFlaggedUGC(t, db, model.UGCTypeNickname); n != 1 {
		t.Fatalf("dismiss must not delete the record")
	}
	if _, total, err = svc.SearchFlaggedUGC(ctx, "", "handled", 1, 10); err != nil || total != 1 {
		t.Fatalf("handled list total = %d, err %v", total, err)
	}
	var n int64
	db.Model(&model.AdminActionLog{}).
		Where("actor_id = ? AND action = ?", admin.ID, model.AdminActionClearUGCFlag).Count(&n)
	if n != 1 {
		t.Fatalf("dismiss audit log count = %d, want 1", n)
	}

	// 重复放行幂等成功
	if err := svc.DismissFlaggedUGC(ctx, admin.ID, rec.ID); err != nil {
		t.Fatalf("dismiss twice should be idempotent: %v", err)
	}
}

// TestHandleReportBansReportedUser 举报目标为 user 且选择 delete 处置：
// 目标用户被封禁、举报状态置 deleted、封禁写审计；keep 处置不动用户。
func TestHandleReportBansReportedUser(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	admin := newAdminTestUser(t, db, "举报处置管理员", model.RoleAdmin)
	victim := newAdminTestUser(t, db, "被举报者", model.RoleUser)
	repo := repository.NewAdminRepository(db)
	svc := newAdminService(db)

	report := &model.Report{
		ReporterID: admin.ID,
		TargetType: model.ReportTargetUser,
		TargetID:   victim.ID,
		Reason:     "骚扰",
		Status:     model.ReportStatusPending,
	}
	if err := repo.CreateReport(ctx, report); err != nil {
		t.Fatalf("create report: %v", err)
	}

	// keep：不动用户
	if err := svc.HandleReport(ctx, admin.ID, report.ID, false); err != nil {
		t.Fatalf("keep: %v", err)
	}
	var u model.User
	db.First(&u, "id = ?", victim.ID)
	if u.Status != model.UserStatusNormal {
		t.Fatal("keep disposition must not ban the user")
	}

	// delete：封禁 + 举报置 deleted + 审计
	if err := svc.HandleReport(ctx, admin.ID, report.ID, true); err != nil {
		t.Fatalf("delete disposition: %v", err)
	}
	if err := db.First(&u, "id = ?", victim.ID).Error; err != nil {
		t.Fatalf("reload victim: %v", err)
	}
	if u.Status != model.UserStatusDisabled {
		t.Fatalf("status = %d, want banned", u.Status)
	}
	var rep model.Report
	if err := db.First(&rep, "id = ?", report.ID).Error; err != nil {
		t.Fatalf("load report: %v", err)
	}
	if rep.Status != model.ReportStatusDeleted {
		t.Fatalf("report status = %d, want deleted", rep.Status)
	}
	var logs int64
	db.Model(&model.AdminActionLog{}).
		Where("actor_id = ? AND action = ? AND target_id = ?",
			admin.ID, model.AdminActionBanUser, victim.ID.String()).Count(&logs)
	if logs != 1 {
		t.Fatalf("ban audit log count = %d, want 1", logs)
	}
}

// TestSearchUsersByUUID 用户检索支持按 ID 精确匹配：举报深链只带目标 ID
// 也能定位到人（fuzzy 条件命中不了主键）。
func TestSearchUsersByUUID(t *testing.T) {
	db := testDB(t)
	svc := newAdminService(db)
	user := newAdminTestUser(t, db, "UUID检索目标", model.RoleUser)

	users, total, err := svc.SearchUsers(context.Background(), user.ID.String(), 1, 10)
	if err != nil {
		t.Fatalf("SearchUsers by uuid: %v", err)
	}
	if total != 1 || len(users) != 1 || users[0].ID != user.ID {
		t.Fatalf("SearchUsers(uuid) total=%d len=%d, want exactly the target", total, len(users))
	}
}

// TestMessageMediaExtraction 媒体键提取：四类媒体消息取 key 与元数据；
// 文本 / 系统消息与坏 JSON 归入「无媒体对象」错误。
func TestMessageMediaExtraction(t *testing.T) {
	image, _ := json.Marshal(map[string]any{"key": "images/2026/09/a.png", "width": 100, "height": 80, "size": 5})
	media, err := ExtractMessageMedia(model.MessageTypeImage, string(image))
	if err != nil || media.ObjectKey != "images/2026/09/a.png" || media.Width != 100 {
		t.Fatalf("image extract = %+v, err %v", media, err)
	}

	file, _ := json.Marshal(map[string]any{"key": "files/2026/09/b.zip", "name": "b.zip", "size": 9})
	media, err = ExtractMessageMedia(model.MessageTypeFile, string(file))
	if err != nil || media.FileName != "b.zip" {
		t.Fatalf("file extract = %+v, err %v", media, err)
	}

	voice, _ := json.Marshal(map[string]any{"key": "files/2026/09/c.webm", "duration": 12})
	media, err = ExtractMessageMedia(model.MessageTypeVoice, string(voice))
	if err != nil || media.Duration != 12 {
		t.Fatalf("voice extract = %+v, err %v", media, err)
	}

	sticker, _ := json.Marshal(map[string]any{"sticker_id": uuid.NewString(), "key": "images/2026/09/d.png", "width": 96, "height": 96})
	media, err = ExtractMessageMedia(model.MessageTypeSticker, string(sticker))
	if err != nil || media.ObjectKey != "images/2026/09/d.png" {
		t.Fatalf("sticker extract = %+v, err %v", media, err)
	}

	if _, err := ExtractMessageMedia(model.MessageTypeText, `{"text":"hi"}`); err != ErrMessageMediaNotSupported {
		t.Fatalf("text extract err = %v, want ErrMessageMediaNotSupported", err)
	}
	if _, err := ExtractMessageMedia(model.MessageTypeImage, `{bad`); err != ErrMessageMediaNotSupported {
		t.Fatalf("bad json err = %v, want ErrMessageMediaNotSupported", err)
	}
}

// TestMessageMediaLoadsFromDB MessageMedia 走库链路：未删除消息返回键，
// 已删除消息返回 ErrMessageNotFound。
func TestMessageMediaLoadsFromDB(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	sender := newTestUser(t, db, "媒体发送者")
	conv := &model.Conversation{ID: uuid.New(), Type: model.ConversationTypePrivate}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	msg := &model.Message{
		ConversationID: conv.ID,
		SenderID:       sender.ID,
		MessageType:    model.MessageTypeImage,
		Content:        `{"key":"images/2026/09/live.png","width":10,"height":10,"size":1}`,
		Status:         model.MessageStatusNormal,
	}
	if err := db.Create(msg).Error; err != nil {
		t.Fatalf("create message: %v", err)
	}

	svc := newAdminService(db)
	media, err := svc.MessageMedia(ctx, msg.ID)
	if err != nil || media.ObjectKey != "images/2026/09/live.png" || media.MessageType != model.MessageTypeImage {
		t.Fatalf("MessageMedia = %+v, err %v", media, err)
	}

	// 软删后不可再签
	if err := db.Delete(msg).Error; err != nil {
		t.Fatalf("soft delete message: %v", err)
	}
	if _, err := svc.MessageMedia(ctx, msg.ID); err != ErrMessageNotFound {
		t.Fatalf("deleted message err = %v, want ErrMessageNotFound", err)
	}
}
