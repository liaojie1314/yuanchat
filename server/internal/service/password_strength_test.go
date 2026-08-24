package service

import (
	"errors"
	"strings"
	"testing"
)

// TestValidatePasswordStrength 覆盖 spec 规定的 5 条规则：长度 8-64、含小写、含大写、含数字、不含空白。
func TestValidatePasswordStrength(t *testing.T) {
	cases := []struct {
		name string
		pw   string
		ok   bool
	}{
		{"合规", "Abcdef12", true},
		{"合规-恰好 8 位", "Aa123456", true},
		{"合规-恰好 64 位", strings.Repeat("Aa1", 21) + "b", true},
		{"太短", "Abc12", false},
		{"空", "", false},
		{"过长", strings.Repeat("Aa1", 30), false},
		{"缺小写", "ABCDEF12", false},
		{"缺大写", "abcdef12", false},
		{"缺数字", "Abcdefgh", false},
		{"含空格", "Abcdef 12", false},
		{"含制表符", "Abcdef\t12", false},
		{"含换行", "Abcdef\n12", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := ValidatePasswordStrength(c.pw)
			if c.ok && err != nil {
				t.Fatalf("want ok, got %v", err)
			}
			if !c.ok {
				if err == nil {
					t.Fatal("want error, got nil")
				}
				if !errors.Is(err, ErrWeakPassword) {
					t.Fatalf("错误应可用 errors.Is 判定为 ErrWeakPassword，got %v", err)
				}
			}
		})
	}
}

// TestValidatePasswordStrengthMessageKey 校验失败时必须带上前端可映射的 i18n key（见 R7：走 message 字段）。
func TestValidatePasswordStrengthMessageKey(t *testing.T) {
	cases := []struct {
		pw  string
		key string
	}{
		{"Abc12", "validation.passwordMinLength"},
		{strings.Repeat("Aa1", 30), "validation.passwordMaxLength"},
		{"ABCDEF12", "validation.passwordLowercase"},
		{"abcdef12", "validation.passwordUppercase"},
		{"Abcdefgh", "validation.passwordDigit"},
		{"Abcdef 12", "validation.passwordNoWhitespace"},
	}
	for _, c := range cases {
		var weak *WeakPasswordError
		err := ValidatePasswordStrength(c.pw)
		if !errors.As(err, &weak) {
			t.Fatalf("ValidatePasswordStrength(%q) = %v，应返回 *WeakPasswordError", c.pw, err)
		}
		if weak.MessageKey != c.key {
			t.Errorf("ValidatePasswordStrength(%q) key = %q, want %q", c.pw, weak.MessageKey, c.key)
		}
	}
}

// TestValidatePasswordStrengthBytesNotRunes 长度按字节计：bcrypt 只取前 72 字节，
// 按字符计会让多字节密码被静默截断。
func TestValidatePasswordStrengthBytesNotRunes(t *testing.T) {
	// 22 个汉字 = 66 字节，字符数只有 22，按字节应被拒
	pw := "Aa1" + strings.Repeat("密", 22)
	if err := ValidatePasswordStrength(pw); err == nil {
		t.Fatalf("66+ 字节的密码应被拒（bcrypt 上限 72 字节），got nil")
	}
}
