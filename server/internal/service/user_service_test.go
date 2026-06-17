package service

import (
	"testing"

	"github.com/yuanchat/server/internal/pkg/password"
)

// ========================================
// Register — Password Hashing Tests
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
// Login — Password Verification Tests
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
// strPtr Helper
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
// Error Constants
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

// Note: Full UserService.Register() / Login() / Profile() integration tests
// require either a test PostgreSQL database or refactoring UserService to accept
// a repository interface instead of the concrete *repository.UserRepository.
// The password hashing, JWT generation, and validation logic are covered
// by unit tests in their respective packages (pkg/password, pkg/jwt).
