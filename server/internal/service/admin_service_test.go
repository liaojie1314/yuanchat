package service

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/pkg/jwt"
	"github.com/yuanchat/server/internal/pkg/password"
	"github.com/yuanchat/server/internal/pkg/shortid"
	"github.com/yuanchat/server/internal/repository"
	"github.com/yuanchat/server/internal/testutil"
	"go.uber.org/zap"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
	"gorm.io/gorm/schema"
)

// adminTestDB 连接本地开发库（deploy/docker-compose.yml 的 postgres :5434）。
// 数据库不可达时跳过集成用例（CI 无 DB 环境仍绿）。
func adminTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := "host=localhost port=5434 user=yuanchat password=yuanchat_dev dbname=yuanchat sslmode=disable"
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger:                 gormlogger.Default.LogMode(gormlogger.Silent),
		NamingStrategy:         schema.NamingStrategy{SingularTable: true},
		SkipDefaultTransaction: true,
	})
	if err != nil {
		t.Skipf("dev postgres unavailable, skip integration test: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil || sqlDB.Ping() != nil {
		t.Skip("dev postgres unavailable, skip integration test")
	}
	// 每个用例开一个连接池，因此必须限量并在结束时关闭：dev 库 max_connections = 100，
	// 池子只开不关时全量 -race 跑到后半程会撞 53300（too many clients），
	// 集成用例被迫跳过，看起来像「库不可达」，实际是自己把连接耗光了
	sqlDB.SetMaxOpenConns(4)
	sqlDB.SetMaxIdleConns(2)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.AdminActionLog{}); err != nil {
		t.Fatalf("migrate admin_action_logs: %v", err)
	}
	// role 列可能尚未迁移（goose 005），确保存在
	if !db.Migrator().HasColumn(&model.User{}, "role") {
		if err := db.Migrator().AddColumn(&model.User{}, "Role"); err != nil {
			t.Fatalf("add role column: %v", err)
		}
	}
	return db
}

func newAdminTestUser(t *testing.T, db *gorm.DB, nick string, role int16) *model.User {
	t.Helper()
	phone := fmt.Sprintf("198%08d", time.Now().UnixNano()%100000000)
	user := &model.User{
		ID:           uuid.New(),
		Phone:        &phone,
		PasswordHash: "x",
		ShortID:      time.Now().UnixNano()%1_000_000_000 + int64(len(nick)),
		Nickname:     nick,
		Status:       model.UserStatusNormal,
		Role:         role,
	}
	if err := db.Create(user).Error; err != nil {
		t.Fatalf("create test user: %v", err)
	}
	t.Cleanup(func() {
		db.Unscoped().Delete(&model.AdminActionLog{}, "actor_id = ?", user.ID)
		db.Unscoped().Delete(user)
	})
	return user
}

func newAdminService(db *gorm.DB) *AdminService {
	return NewAdminService(
		repository.NewAdminRepository(db),
		repository.NewConversationRepository(db),
		zap.NewNop(),
	)
}

func TestAdminBanUnbanUser(t *testing.T) {
	db := adminTestDB(t)
	svc := newAdminService(db)
	ctx := context.Background()

	admin := newAdminTestUser(t, db, "AdminOp", model.RoleAdmin)
	victim := newAdminTestUser(t, db, "Victim", model.RoleUser)

	// 封禁
	if err := svc.BanUser(ctx, admin.ID, victim.ID); err != nil {
		t.Fatalf("BanUser: %v", err)
	}
	var got model.User
	if err := db.First(&got, "id = ?", victim.ID).Error; err != nil {
		t.Fatalf("reload victim: %v", err)
	}
	if got.Status != model.UserStatusDisabled {
		t.Fatalf("status = %d, want %d (disabled)", got.Status, model.UserStatusDisabled)
	}

	// 审计日志已写
	var logCount int64
	db.Model(&model.AdminActionLog{}).
		Where("actor_id = ? AND action = ? AND target_id = ?",
			admin.ID, model.AdminActionBanUser, victim.ID.String()).
		Count(&logCount)
	if logCount != 1 {
		t.Fatalf("audit log count = %d, want 1", logCount)
	}

	// 解封
	if err := svc.UnbanUser(ctx, admin.ID, victim.ID); err != nil {
		t.Fatalf("UnbanUser: %v", err)
	}
	if err := db.First(&got, "id = ?", victim.ID).Error; err != nil {
		t.Fatalf("reload victim: %v", err)
	}
	if got.Status != model.UserStatusNormal {
		t.Fatalf("status = %d, want %d (normal)", got.Status, model.UserStatusNormal)
	}
}

func TestAdminBanSelfRejected(t *testing.T) {
	db := adminTestDB(t)
	svc := newAdminService(db)

	admin := newAdminTestUser(t, db, "AdminSelf", model.RoleAdmin)
	if err := svc.BanUser(context.Background(), admin.ID, admin.ID); err != ErrAdminSelfBan {
		t.Fatalf("BanUser(self) = %v, want ErrAdminSelfBan", err)
	}
}

func TestAdminBanNotFound(t *testing.T) {
	db := adminTestDB(t)
	svc := newAdminService(db)

	admin := newAdminTestUser(t, db, "AdminNF", model.RoleAdmin)
	if err := svc.BanUser(context.Background(), admin.ID, uuid.New()); err != ErrUserNotFound {
		t.Fatalf("BanUser(missing) = %v, want ErrUserNotFound", err)
	}
}

func TestAdminSearchUsers(t *testing.T) {
	db := adminTestDB(t)
	svc := newAdminService(db)
	ctx := context.Background()

	marker := fmt.Sprintf("ZZAdminSearch%d", time.Now().UnixNano()%100000)
	newAdminTestUser(t, db, marker, model.RoleUser)

	users, total, err := svc.SearchUsers(ctx, marker, 1, 10)
	if err != nil {
		t.Fatalf("SearchUsers: %v", err)
	}
	if total != 1 || len(users) != 1 || users[0].Nickname != marker {
		t.Fatalf("SearchUsers(%q) = %d users total=%d, want exactly 1", marker, len(users), total)
	}
}

// TestBannedUserCannotLogin 封禁后走真实 Login 链路被拒（ErrUserBanned）。
func TestBannedUserCannotLogin(t *testing.T) {
	db := adminTestDB(t)
	ctx := context.Background()

	const plainPwd = "Test@1234"
	hash, err := password.Hash(plainPwd)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	user := newAdminTestUser(t, db, "BanLogin", model.RoleUser)
	db.Model(user).Updates(map[string]any{
		"password_hash": hash,
		"status":        model.UserStatusDisabled,
	})

	rdb, _ := testutil.NewRedis(t)
	userSvc := NewUserService(
		repository.NewUserRepository(db),
		jwt.NewGenerator("test-secret", time.Minute, time.Hour),
		shortid.NewGenerator(db),
		rdb,
		zap.NewNop(),
	)
	_, err = userSvc.Login(ctx, LoginRequest{Account: *user.Phone, Password: plainPwd})
	if !errors.Is(err, ErrUserBanned) {
		t.Fatalf("Login(banned) = %v, want ErrUserBanned", err)
	}

	// 解封后可登录
	db.Model(user).Update("status", model.UserStatusNormal)
	if _, err := userSvc.Login(ctx, LoginRequest{Account: *user.Phone, Password: plainPwd}); err != nil {
		t.Fatalf("Login(after unban) = %v, want nil", err)
	}
}

// TestHandleReportTakesDownStickerPack 举报表情包并选择删除 → 包置 taken_down
// （商城不再展示、已添加者保留），举报状态置 deleted，处置写审计；
// 驳回（不删除）则不动包。
func TestHandleReportTakesDownStickerPack(t *testing.T) {
	db := adminTestDB(t)
	if err := db.AutoMigrate(&model.StickerPack{}); err != nil {
		t.Fatalf("migrate sticker_packs: %v", err)
	}
	repo := repository.NewAdminRepository(db)
	svc := NewAdminService(repo, repository.NewConversationRepository(db), zap.NewNop())
	ctx := context.Background()

	admin := newAdminTestUser(t, db, "TakedownAdmin", model.RoleAdmin)
	publisher := newAdminTestUser(t, db, "TakedownPackOwner", model.RoleUser)

	pack := &model.StickerPack{Name: "被举报的包", OwnerID: &publisher.ID, IsPublic: true}
	if err := db.Create(pack).Error; err != nil {
		t.Fatalf("create pack: %v", err)
	}
	t.Cleanup(func() {
		db.Exec(`DELETE FROM reports WHERE target_type = ? AND target_id = ?`, model.ReportTargetStickerPack, pack.ID)
		db.Exec(`DELETE FROM admin_action_logs WHERE target_type = ? AND target_id = ?`, model.ReportTargetStickerPack, pack.ID.String())
		db.Unscoped().Delete(pack)
	})

	report := &model.Report{
		ReporterID: admin.ID,
		TargetType: model.ReportTargetStickerPack,
		TargetID:   pack.ID,
		Reason:     "包名违规",
		Status:     model.ReportStatusPending,
	}
	if err := repo.CreateReport(ctx, report); err != nil {
		t.Fatalf("create report: %v", err)
	}

	// 驳回：包不受影响
	if err := svc.HandleReport(ctx, admin.ID, report.ID, false); err != nil {
		t.Fatalf("keep: %v", err)
	}
	var kept model.StickerPack
	if err := db.First(&kept, "id = ?", pack.ID).Error; err != nil {
		t.Fatalf("load pack after keep: %v", err)
	}
	if kept.TakenDown {
		t.Fatal("keep disposition must not take down the pack")
	}

	// 删除处置：下架 + 状态 deleted + 审计
	if err := svc.HandleReport(ctx, admin.ID, report.ID, true); err != nil {
		t.Fatalf("delete: %v", err)
	}
	var got model.StickerPack
	if err := db.First(&got, "id = ?", pack.ID).Error; err != nil {
		t.Fatalf("load pack after delete: %v", err)
	}
	if !got.TakenDown {
		t.Fatal("delete disposition must set taken_down on the pack")
	}
	var rep model.Report
	if err := db.First(&rep, "id = ?", report.ID).Error; err != nil {
		t.Fatalf("load report: %v", err)
	}
	if rep.Status != model.ReportStatusDeleted {
		t.Fatalf("report status = %d, want %d (deleted)", rep.Status, model.ReportStatusDeleted)
	}
	var logs int64
	db.Model(&model.AdminActionLog{}).
		Where("action = ? AND target_type = ? AND target_id = ?",
			model.AdminActionReportDelete, model.ReportTargetStickerPack, pack.ID.String()).
		Count(&logs)
	if logs == 0 {
		t.Fatal("audit log missing for the takedown disposition")
	}
}
