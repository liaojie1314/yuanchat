package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/pkg/jwt"
	"github.com/yuanchat/server/internal/pkg/password"
	"go.uber.org/zap"
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
	return NewUserService(nil, gen, nil, zap.NewNop()), gen
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

// 说明：UserService.Register() / Login() / Profile() 的完整集成测试需要一个测试用
// PostgreSQL 库，或把 UserService 改成依赖 repository 接口而非具体的
// *repository.UserRepository。密码哈希、JWT 签发与校验这几段逻辑已由各自所在包
//（pkg/password、pkg/jwt）的单元测试覆盖。
