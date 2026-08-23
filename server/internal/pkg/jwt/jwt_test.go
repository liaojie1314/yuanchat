package jwt

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestGenerateAndValidate(t *testing.T) {
	gen := NewGenerator("test-secret-key-for-jwt", 15*time.Minute, 7*24*time.Hour)
	userID := uuid.New()
	deviceID := "test-device"

	pair, err := gen.GeneratePair(userID, deviceID)
	if err != nil {
		t.Fatalf("GeneratePair() error = %v", err)
	}

	if pair.AccessToken == "" {
		t.Fatal("AccessToken is empty")
	}
	if pair.RefreshToken == "" {
		t.Fatal("RefreshToken is empty")
	}
	if pair.ExpiresIn != int64((15 * time.Minute).Seconds()) {
		t.Fatalf("ExpiresIn = %d, want %d", pair.ExpiresIn, int64((15 * time.Minute).Seconds()))
	}

	// 验证 access token
	claims, err := gen.Validate(pair.AccessToken)
	if err != nil {
		t.Fatalf("Validate(accessToken) error = %v", err)
	}
	if claims.UserID != userID {
		t.Fatalf("UserID = %v, want %v", claims.UserID, userID)
	}
	if claims.TokenUse != "access" {
		t.Fatalf("TokenUse = %q, want %q", claims.TokenUse, "access")
	}

	// 验证 refresh token
	claims2, err := gen.Validate(pair.RefreshToken)
	if err != nil {
		t.Fatalf("Validate(refreshToken) error = %v", err)
	}
	if claims2.TokenUse != "refresh" {
		t.Fatalf("TokenUse = %q, want %q", claims2.TokenUse, "refresh")
	}
}

func TestValidateInvalidToken(t *testing.T) {
	gen := NewGenerator("test-secret", 15*time.Minute, 7*24*time.Hour)

	// 垃圾 token
	_, err := gen.Validate("not.a.valid.token")
	if err == nil {
		t.Fatal("Validate() should fail for garbage token")
	}

	// 空 token
	_, err = gen.Validate("")
	if err == nil {
		t.Fatal("Validate() should fail for empty token")
	}
}

func TestValidateExpiredToken(t *testing.T) {
	// 使用极短的 TTL 来测试过期
	gen := NewGenerator("test-secret", 1*time.Millisecond, 7*24*time.Hour)
	userID := uuid.New()

	pair, _ := gen.GeneratePair(userID, "test")

	// 等待 token 过期
	time.Sleep(5 * time.Millisecond)

	_, err := gen.Validate(pair.AccessToken)
	if err == nil {
		t.Fatal("Validate() should fail for expired token")
	}
}
