package service

import (
	"context"
	"errors"
	"strconv"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/pkg/jwt"
	"github.com/yuanchat/server/internal/pkg/password"
	"github.com/yuanchat/server/internal/repository"
	"github.com/yuanchat/server/internal/testutil"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// ========================================
// Register —— 密码哈希相关用例
// ========================================

func TestRegisterPasswordHashing(t *testing.T) {
	hash, err := password.Hash("StrongP@ss1")
	if err != nil {
		t.Fatalf("hash failed: %v", err)
	}

	if hash == "" {
		t.Fatal("hash should not be empty")
	}

	if hash == "StrongP@ss1" {
		t.Fatal("hash should not equal plaintext")
	}

	if !password.Verify(hash, "StrongP@ss1") {
		t.Fatal("correct password should verify")
	}

	if password.Verify(hash, "WrongP@ss1") {
		t.Fatal("wrong password should not verify")
	}

	t.Log("Register password hashing: PASS")
}

func TestRegisterDifferentSalts(t *testing.T) {
	hash1, _ := password.Hash("SamePassword")
	hash2, _ := password.Hash("SamePassword")

	if hash1 == hash2 {
		t.Fatal("same password should produce different hashes (different salts)")
	}

	if !password.Verify(hash1, "SamePassword") {
		t.Fatal("hash1 should verify")
	}
	if !password.Verify(hash2, "SamePassword") {
		t.Fatal("hash2 should verify")
	}

	t.Log("Register different salts: PASS")
}

// ========================================
// Login —— 密码校验相关用例
// ========================================

func TestLoginPasswordVerify(t *testing.T) {
	hash, _ := password.Hash("LoginP@ss1")
	if !password.Verify(hash, "LoginP@ss1") {
		t.Fatal("password verification should succeed")
	}
	if password.Verify(hash, "WrongPassword") {
		t.Fatal("wrong password should not verify")
	}
	t.Log("Login password verify: PASS")
}

// ========================================
// strPtr 辅助函数
// ========================================

func TestStrPtr(t *testing.T) {
	if p := strPtr(""); p != nil {
		t.Errorf("strPtr(\"\") should return nil, got %v", *p)
	}
	if p := strPtr("hello"); p == nil || *p != "hello" {
		t.Errorf("strPtr(\"hello\") should return pointer to \"hello\", got %v", p)
	}
}

// ========================================
// 错误常量
// ========================================

func TestErrorConstants(t *testing.T) {
	if ErrDuplicateUser.Error() == "" {
		t.Error("ErrDuplicateUser should have message")
	}
	if ErrInvalidPassword.Error() == "" {
		t.Error("ErrInvalidPassword should have message")
	}
	if ErrUserNotFound.Error() == "" {
		t.Error("ErrUserNotFound should have message")
	}
}

// ========================================
// Refresh —— 令牌轮换相关用例
// ========================================

// refreshSvc 构造仅含 JWT 生成器的 UserService。
// 以下用例全部在 token 校验阶段失败返回，不会触达 nil repo
// （合法 refresh 的完整链路由 E2E 覆盖）。
func refreshSvc(accessTTL, refreshTTL time.Duration) (*UserService, *jwt.Generator) {
	gen := jwt.NewGenerator("test-secret", accessTTL, refreshTTL)
	return NewUserService(nil, gen, nil, nil, zap.NewNop()), gen
}

func TestRefreshRejectsGarbageToken(t *testing.T) {
	svc, _ := refreshSvc(time.Minute, time.Hour)

	_, err := svc.Refresh(context.Background(), "not-a-jwt")
	if !errors.Is(err, ErrInvalidRefresh) {
		t.Fatalf("expected ErrInvalidRefresh, got %v", err)
	}
}

func TestRefreshRejectsAccessTokenAsRefresh(t *testing.T) {
	svc, gen := refreshSvc(time.Minute, time.Hour)

	pair, err := gen.GeneratePair(uuid.New(), "web", 0)
	if err != nil {
		t.Fatalf("generate pair: %v", err)
	}

	// access token 冒充 refresh：签名合法但 use != "refresh"
	_, err = svc.Refresh(context.Background(), pair.AccessToken)
	if !errors.Is(err, ErrInvalidRefresh) {
		t.Fatalf("expected ErrInvalidRefresh for access token, got %v", err)
	}
}

func TestRefreshRejectsExpiredRefreshToken(t *testing.T) {
	svc, gen := refreshSvc(time.Minute, -time.Minute) // refresh 签发即过期

	pair, err := gen.GeneratePair(uuid.New(), "web", 0)
	if err != nil {
		t.Fatalf("generate pair: %v", err)
	}

	_, err = svc.Refresh(context.Background(), pair.RefreshToken)
	if !errors.Is(err, ErrInvalidRefresh) {
		t.Fatalf("expected ErrInvalidRefresh for expired token, got %v", err)
	}
}

func TestRefreshRejectsTamperedSignature(t *testing.T) {
	svc, _ := refreshSvc(time.Minute, time.Hour)

	// 用另一个 secret 签发的 refresh token
	otherGen := jwt.NewGenerator("other-secret", time.Minute, time.Hour)
	pair, err := otherGen.GeneratePair(uuid.New(), "web", 0)
	if err != nil {
		t.Fatalf("generate pair: %v", err)
	}

	_, err = svc.Refresh(context.Background(), pair.RefreshToken)
	if !errors.Is(err, ErrInvalidRefresh) {
		t.Fatalf("expected ErrInvalidRefresh for tampered token, got %v", err)
	}
}

// 说明：以上用例全部在令牌校验阶段返回，不触达 repo。下面几条需要真实用户行，
// 因此走包内既有的 testDB / newTestUser 集成夹具（库不可达时自动 skip）。

// authSvc 构造接真实 repo 的 UserService 与配套 JWT 生成器。
func authSvc(t *testing.T, db *gorm.DB) (*UserService, *jwt.Generator) {
	t.Helper()
	svc, gen, _, _ := authSvcWithRedis(t, db)
	return svc, gen
}

// authSvcWithRedis 在 authSvc 之上额外交出 Redis 客户端与 miniredis 句柄，
// 供需要断言计数器或推进时间的用例使用。构造只有这一处，避免各用例各拼一份依赖。
func authSvcWithRedis(t *testing.T, db *gorm.DB) (*UserService, *jwt.Generator, *redis.Client, *miniredis.Miniredis) {
	t.Helper()
	gen := jwt.NewGenerator("test-secret", time.Minute, time.Hour)
	rdb, mr := testutil.NewRedis(t)
	return NewUserService(repository.NewUserRepository(db), gen, nil, rdb, zap.NewNop()), gen, rdb, mr
}

func TestRefreshRejectsBannedUser(t *testing.T) {
	db := testDB(t)
	user := newTestUser(t, db, "refresh-banned")
	svc, gen := authSvc(t, db)

	pair, err := gen.GeneratePair(user.ID, "web", user.TokenVersion)
	if err != nil {
		t.Fatalf("generate pair: %v", err)
	}

	if err := db.Model(user).Update("status", model.UserStatusDisabled).Error; err != nil {
		t.Fatalf("disable user: %v", err)
	}

	if _, err := svc.Refresh(context.Background(), pair.RefreshToken); !errors.Is(err, ErrUserBanned) {
		t.Fatalf("expected ErrUserBanned, got %v", err)
	}
}

func TestRefreshRejectsStaleTokenVersion(t *testing.T) {
	db := testDB(t)
	user := newTestUser(t, db, "refresh-stale-tv")
	svc, gen := authSvc(t, db)

	pair, err := gen.GeneratePair(user.ID, "web", user.TokenVersion)
	if err != nil {
		t.Fatalf("generate pair: %v", err)
	}

	// 模拟改密：token_version 递增后，早先签发的 refresh 令牌应立即失效
	if err := db.Model(user).Update("token_version", user.TokenVersion+1).Error; err != nil {
		t.Fatalf("bump token_version: %v", err)
	}

	if _, err := svc.Refresh(context.Background(), pair.RefreshToken); !errors.Is(err, ErrInvalidRefresh) {
		t.Fatalf("expected ErrInvalidRefresh, got %v", err)
	}
}

func TestRefreshAcceptsCurrentTokenVersion(t *testing.T) {
	db := testDB(t)
	user := newTestUser(t, db, "refresh-ok-tv")
	svc, gen := authSvc(t, db)

	pair, err := gen.GeneratePair(user.ID, "web", user.TokenVersion)
	if err != nil {
		t.Fatalf("generate pair: %v", err)
	}

	fresh, err := svc.Refresh(context.Background(), pair.RefreshToken)
	if err != nil {
		t.Fatalf("Refresh with current token_version should succeed, got %v", err)
	}
	if fresh.AccessToken == "" || fresh.RefreshToken == "" {
		t.Fatal("Refresh 应返回非空令牌对")
	}
}

func TestLoginWritesLastLoginAt(t *testing.T) {
	db := testDB(t)
	user := newTestUser(t, db, "login-touch")
	svc, _ := authSvc(t, db)

	const pw = "Abcdef12"
	hash, err := password.Hash(pw)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	if err := db.Model(user).Update("password_hash", hash).Error; err != nil {
		t.Fatalf("set password hash: %v", err)
	}

	if _, err := svc.Login(context.Background(), LoginRequest{Account: *user.Phone, Password: pw}); err != nil {
		t.Fatalf("Login: %v", err)
	}

	var stored model.User
	if err := db.First(&stored, "id = ?", user.ID).Error; err != nil {
		t.Fatalf("reload user: %v", err)
	}
	if stored.LastLoginAt == nil {
		t.Fatal("登录成功后 last_login_at 应被写入，实际仍为 NULL")
	}
}

// TestLoginByShortID 元聊号登录：登录框标的就是「元聊号」，设置页与名片页
// 也把它当可复制的身份展示，登不进去就是名不副实（早先只认手机号与邮箱）。
func TestLoginByShortID(t *testing.T) {
	db := testDB(t)
	user := newTestUser(t, db, "login-shortid")
	svc, _ := authSvc(t, db)

	const pw = "Abcdef12"
	hash, err := password.Hash(pw)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	if err := db.Model(user).Update("password_hash", hash).Error; err != nil {
		t.Fatalf("set password hash: %v", err)
	}

	ctx := context.Background()
	account := strconv.FormatInt(user.ShortID, 10)
	if _, err := svc.Login(ctx, LoginRequest{Account: account, Password: pw}); err != nil {
		t.Fatalf("按元聊号登录应成功: %v", err)
	}

	// 手机号这条老路径不能被顺序调整弄坏
	if _, err := svc.Login(ctx, LoginRequest{Account: *user.Phone, Password: pw}); err != nil {
		t.Fatalf("按手机号登录应仍然成功: %v", err)
	}

	// 不存在的短号照旧当凭据错误，不额外泄漏账号是否存在
	if _, err := svc.Login(ctx, LoginRequest{Account: "999999999", Password: pw}); !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("不存在的元聊号应回 ErrUserNotFound，got %v", err)
	}
}
