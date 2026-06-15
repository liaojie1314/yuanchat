package password

import "testing"

func TestHashAndVerify(t *testing.T) {
	password := "mySecureP@ss1"

	hash, err := Hash(password)
	if err != nil {
		t.Fatalf("Hash() error = %v", err)
	}

	if hash == "" {
		t.Fatal("Hash() returned empty string")
	}

	if hash == password {
		t.Fatal("Hash() returned the password itself (not hashed)")
	}

	// 验证正确密码
	if !Verify(hash, password) {
		t.Fatal("Verify() failed for correct password")
	}

	// 验证错误密码
	if Verify(hash, "wrongPassword") {
		t.Fatal("Verify() passed for wrong password")
	}
}

func TestHashProducesDifferentSalts(t *testing.T) {
	password := "samePassword"

	hash1, _ := Hash(password)
	hash2, _ := Hash(password)

	if hash1 == hash2 {
		t.Fatal("Same password produced identical hashes (salt not working)")
	}
}
