package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"gorm.io/gorm"
)

// adminStatsFixture 记录本用例写入的基线行数，断言时叠加自造数据，
// 避免与共享测试库里其他用例（同一事务外）的残留数据互相干扰。
type adminStatsFixture struct {
	users, banned, userToday, userWeek int64
	convs                              int64
	msgs, msgsToday, msgsFlagged       int64
	byType                             map[string]int64
	pendingReports, pendingUGC         int64
	takenDown, flaggedPacks            int64
	frToday, frWeek                    int64
	otpToday, otpWeek                  int64
}

// newStatsSvc 构造被测服务（pushRepo 一并注入，覆盖订阅分页视图）。
func newStatsSvc(db *gorm.DB) *AdminService {
	svc := newAdminService(db)
	svc.SetPushRepo(repository.NewPushRepository(db))
	return svc
}

// seedStatsUser 插入一个用户并按参数累计到 fixture。
func seedStatsUser(t *testing.T, db *gorm.DB, f *adminStatsFixture, status int16, createdAt time.Time) *model.User {
	t.Helper()
	phone := fmt.Sprintf("197%08d", time.Now().UnixNano()%100000000)
	u := &model.User{
		ID:           uuid.New(),
		Phone:        &phone,
		PasswordHash: "x",
		ShortID:      time.Now().UnixNano()%1_000_000_000 + int64(len(phone)),
		Nickname:     "stats-" + phone,
		Status:       status,
		CreatedAt:    createdAt,
	}
	if err := db.Create(u).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	f.users++
	weekStart := statsTodayStart().AddDate(0, 0, -6)
	if !createdAt.Before(weekStart) {
		f.userWeek++
	}
	if !createdAt.Before(statsTodayStart()) {
		f.userToday++
	}
	if status == model.UserStatusDisabled {
		f.banned++
	}
	return u
}

// statsTodayStart 与 repo 层 dayStart 完全同口径的「今日零点」：
// 同用本机时区构造，避免 UTC/本地错位导致今日/本周边界偏差。
func statsTodayStart() time.Time {
	now := time.Now()
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
}

// seedStatsMessage 插入一条消息（含所属会话），按参数累计到 fixture。
func seedStatsMessage(t *testing.T, db *gorm.DB, f *adminStatsFixture, sender uuid.UUID, msgType int16, flagged bool, createdAt time.Time, softDeleted bool) {
	t.Helper()
	conv := &model.Conversation{ID: uuid.New(), Type: model.ConversationTypePrivate, LastSeq: 1}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
	if !softDeleted {
		f.convs++
	}
	msg := &model.Message{
		ID:             uuid.New(),
		ConversationID: conv.ID,
		SenderID:       sender,
		Seq:            1,
		MessageType:    msgType,
		Content:        `{"text":"hi"}`,
		Flagged:        flagged,
		CreatedAt:      createdAt,
	}
	if err := db.Create(msg).Error; err != nil {
		t.Fatalf("seed message: %v", err)
	}
	if softDeleted {
		// 软删的消息不计入任何口径
		if err := db.Delete(msg).Error; err != nil {
			t.Fatalf("soft delete message: %v", err)
		}
		return
	}
	f.msgs++
	if !createdAt.Before(statsTodayStart()) {
		f.msgsToday++
	}
	name, ok := messageTypeNames[msgType]
	if !ok {
		name = "other"
	}
	f.byType[name]++
	if flagged {
		f.msgsFlagged++
	}
}

// TestAdminStatsOverview 覆盖概览各计数的口径：今日 / 近 7 天边界、
// 软删排除、封禁计数、各消息类型聚合、治理队列积压与 OTP 台账量。
func TestAdminStatsOverview(t *testing.T) {
	db := adminTestDB(t)
	svc := newStatsSvc(db)
	ctx := context.Background()

	f := &adminStatsFixture{byType: map[string]int64{}}
	today := statsTodayStart()
	weekAgo := today.AddDate(0, 0, -6)
	old := today.AddDate(0, 0, -10)

	// 用户：旧用户、本周新增、今日新增、封禁者
	seedStatsUser(t, db, f, model.UserStatusNormal, old)
	seedStatsUser(t, db, f, model.UserStatusNormal, weekAgo)
	seedStatsUser(t, db, f, model.UserStatusNormal, today.Add(time.Hour))
	seedStatsUser(t, db, f, model.UserStatusDisabled, today.Add(2*time.Hour))

	// 消息：今天普通文本、本周图片、十一天前的文件、敏感词命中、软删消息
	u := seedStatsUser(t, db, f, model.UserStatusNormal, old)
	seedStatsMessage(t, db, f, u.ID, model.MessageTypeText, false, today.Add(time.Hour), false)
	seedStatsMessage(t, db, f, u.ID, model.MessageTypeImage, false, weekAgo.Add(time.Hour), false)
	seedStatsMessage(t, db, f, u.ID, model.MessageTypeFile, false, old.Add(time.Hour), false)
	seedStatsMessage(t, db, f, u.ID, model.MessageTypeText, true, today.Add(2*time.Hour), false)
	seedStatsMessage(t, db, f, u.ID, model.MessageTypeVoice, false, today.Add(3*time.Hour), true)

	// 治理积压：一条待处理举报 + 一条已处置举报、一条未处置 UGC、
	// 一个下架包与一个打标包
	report := &model.Report{ReporterID: u.ID, TargetType: "message", TargetID: uuid.New(), Reason: "spam", Status: model.ReportStatusPending}
	if err := db.Create(report).Error; err != nil {
		t.Fatalf("seed report: %v", err)
	}
	done := &model.Report{ReporterID: u.ID, TargetType: "message", TargetID: uuid.New(), Reason: "spam", Status: model.ReportStatusKept}
	if err := db.Create(done).Error; err != nil {
		t.Fatalf("seed resolved report: %v", err)
	}
	f.pendingReports++
	ugc := &model.FlaggedUGC{ID: uuid.New(), UGCType: model.UGCTypeNickname, UserID: &u.ID, Content: "违规词", HandledAt: nil}
	if err := db.Create(ugc).Error; err != nil {
		t.Fatalf("seed ugc: %v", err)
	}
	f.pendingUGC++
	pack := &model.StickerPack{ID: uuid.New(), Name: "下架包", TakenDown: true}
	if err := db.Create(pack).Error; err != nil {
		t.Fatalf("seed taken down pack: %v", err)
	}
	f.takenDown++
	flaggedPack := &model.StickerPack{ID: uuid.New(), Name: "打标包", Flagged: true}
	if err := db.Create(flaggedPack).Error; err != nil {
		t.Fatalf("seed flagged pack: %v", err)
	}
	f.flaggedPacks++

	// 好友申请：今日一条、十一天前一条
	target := seedStatsUser(t, db, f, model.UserStatusNormal, old)
	if err := db.Create(&model.FriendRequest{ID: uuid.New(), RequesterID: u.ID, TargetID: target.ID, Status: model.FriendRequestStatusPending, CreatedAt: today.Add(time.Hour)}).Error; err != nil {
		t.Fatalf("seed friend request: %v", err)
	}
	f.frToday++
	f.frWeek++
	if err := db.Create(&model.FriendRequest{ID: uuid.New(), RequesterID: target.ID, TargetID: u.ID, Status: model.FriendRequestStatusRejected, CreatedAt: old.Add(time.Hour)}).Error; err != nil {
		t.Fatalf("seed old friend request: %v", err)
	}

	// OTP 台账：今日两条、十一天前一条
	for _, ca := range []time.Time{today.Add(time.Hour), today.Add(2 * time.Hour), old.Add(time.Hour)} {
		if err := db.Create(&model.VerificationCode{ID: uuid.New(), Target: "13800000000", Code: "123456", Type: model.VerificationTypeRegister, ExpiresAt: ca.Add(5 * time.Minute), CreatedAt: ca}).Error; err != nil {
			t.Fatalf("seed verification code: %v", err)
		}
	}
	f.otpToday += 2
	f.otpWeek += 2

	stats, err := svc.StatsOverview(ctx)
	if err != nil {
		t.Fatalf("StatsOverview: %v", err)
	}

	// 用基线 + fixture 对账：其余用例的行可能与本事务隔离不足（都在
	// 各自事务里，这里只要求不小于 fixture，且今日/本周差值精确）。
	if stats.Users.Total < f.users {
		t.Fatalf("users.total = %d, want >= %d", stats.Users.Total, f.users)
	}
	if stats.Users.Banned < f.banned {
		t.Fatalf("users.banned = %d, want >= %d", stats.Users.Banned, f.banned)
	}
	if stats.Users.NewToday != f.userToday {
		t.Fatalf("users.new_today = %d, want %d", stats.Users.NewToday, f.userToday)
	}
	if stats.Users.NewWeek != f.userWeek {
		t.Fatalf("users.new_week = %d, want %d", stats.Users.NewWeek, f.userWeek)
	}
	if stats.Conversations.Total < f.convs {
		t.Fatalf("conversations.total = %d, want >= %d", stats.Conversations.Total, f.convs)
	}
	if stats.Messages.Total != f.msgs {
		t.Fatalf("messages.total = %d, want %d（测试库独占事务，应精确）", stats.Messages.Total, f.msgs)
	}
	if stats.Messages.Today != f.msgsToday {
		t.Fatalf("messages.today = %d, want %d", stats.Messages.Today, f.msgsToday)
	}
	for name, want := range f.byType {
		if got := stats.Messages.ByType[name]; got != want {
			t.Fatalf("messages.by_type[%s] = %d, want %d", name, got, want)
		}
	}
	if stats.Moderation.FlaggedMessages != f.msgsFlagged {
		t.Fatalf("moderation.flagged_messages = %d, want %d", stats.Moderation.FlaggedMessages, f.msgsFlagged)
	}
	if stats.Moderation.PendingReports != f.pendingReports {
		t.Fatalf("moderation.pending_reports = %d, want %d", stats.Moderation.PendingReports, f.pendingReports)
	}
	if stats.Moderation.PendingUGC != f.pendingUGC {
		t.Fatalf("moderation.pending_ugc = %d, want %d", stats.Moderation.PendingUGC, f.pendingUGC)
	}
	if stats.Moderation.TakenDownPacks != f.takenDown {
		t.Fatalf("moderation.taken_down_packs = %d, want %d", stats.Moderation.TakenDownPacks, f.takenDown)
	}
	if stats.Moderation.FlaggedPacks != f.flaggedPacks {
		t.Fatalf("moderation.flagged_packs = %d, want %d", stats.Moderation.FlaggedPacks, f.flaggedPacks)
	}
	if stats.Growth.FriendRequestsToday != f.frToday || stats.Growth.FriendRequestsWeek != f.frWeek {
		t.Fatalf("growth.friend_requests = today %d/week %d, want %d/%d",
			stats.Growth.FriendRequestsToday, stats.Growth.FriendRequestsWeek, f.frToday, f.frWeek)
	}
	if stats.Growth.OTPToday != f.otpToday || stats.Growth.OTPWeek != f.otpWeek {
		t.Fatalf("growth.otp = today %d/week %d, want %d/%d",
			stats.Growth.OTPToday, stats.Growth.OTPWeek, f.otpToday, f.otpWeek)
	}
	if stats.Runtime.OnlineConnections != 0 {
		t.Fatalf("runtime.online_connections = %d, want 0（service 层不填，由 handler 从 Hub 补齐）", stats.Runtime.OnlineConnections)
	}
}

// TestAdminPushSubscriptionsPagination 校验管理端订阅分页：总数、按创建时间
// 倒序、偏移正确、附用户昵称。
func TestAdminPushSubscriptionsPagination(t *testing.T) {
	db := adminTestDB(t)
	svc := newStatsSvc(db)
	ctx := context.Background()

	user := seedStatsUser(t, db, &adminStatsFixture{}, model.UserStatusNormal, statsTodayStart().Add(-time.Hour))
	endpointBase := "https://push.example/test-" + uuid.NewString()
	for i := 0; i < 5; i++ {
		sub := &model.PushSubscription{
			ID:       uuid.New(),
			UserID:   user.ID,
			Endpoint: fmt.Sprintf("%s-%d", endpointBase, i),
			Auth:     "a",
			P256dh:   "b",
		}
		if err := db.Create(sub).Error; err != nil {
			t.Fatalf("seed subscription: %v", err)
		}
	}

	subs, total, err := svc.SearchPushSubscriptions(ctx, 1, 3)
	if err != nil {
		t.Fatalf("page 1: %v", err)
	}
	if total != 5 {
		t.Fatalf("total = %d, want 5", total)
	}
	if len(subs) != 3 {
		t.Fatalf("page1 len = %d, want 3", len(subs))
	}
	if subs[0].Endpoint != endpointBase+"-4" || subs[2].Endpoint != endpointBase+"-2" {
		t.Fatalf("page1 order wrong: %s, %s, %s", subs[0].Endpoint, subs[1].Endpoint, subs[2].Endpoint)
	}
	if subs[0].UserNickname == nil || *subs[0].UserNickname != user.Nickname {
		t.Fatalf("user_nickname = %v, want %q", subs[0].UserNickname, user.Nickname)
	}

	subs2, total2, err := svc.SearchPushSubscriptions(ctx, 2, 3)
	if err != nil {
		t.Fatalf("page 2: %v", err)
	}
	if total2 != 5 || len(subs2) != 2 || subs2[0].Endpoint != endpointBase+"-1" || subs2[1].Endpoint != endpointBase+"-0" {
		t.Fatalf("page2 = total %d, len %d, first %s", total2, len(subs2), subs2[0].Endpoint)
	}

	// 越界页返回空页而非报错
	empty, total3, err := svc.SearchPushSubscriptions(ctx, 9, 3)
	if err != nil || total3 != 5 || len(empty) != 0 {
		t.Fatalf("page 9 = err %v, total %d, len %d", err, total3, len(empty))
	}
}
