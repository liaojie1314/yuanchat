package model

import (
	"testing"
	"time"
)

// TestEffectiveStatus 过期即视为无状态；nil 过期时间表示长期有效。
func TestEffectiveStatus(t *testing.T) {
	base := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	expired := base.Add(-time.Minute)
	future := base.Add(time.Hour)

	cases := []struct {
		name      string
		user      User
		wantEmoji string
		wantText  string
	}{
		{"未过期", User{StatusEmoji: "🌞", StatusText: "在学习", StatusExpiresAt: &future}, "🌞", "在学习"},
		{"已过期", User{StatusEmoji: "🌞", StatusText: "在学习", StatusExpiresAt: &expired}, "", ""},
		{"不自动清除", User{StatusEmoji: "🌞", StatusText: "在学习"}, "🌞", "在学习"},
		{"边界即过期", User{StatusEmoji: "🌞", StatusText: "在学习", StatusExpiresAt: &base}, "", ""},
		{"未设置", User{}, "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			emoji, text := c.user.EffectiveStatus(base)
			if emoji != c.wantEmoji || text != c.wantText {
				t.Fatalf("EffectiveStatus = (%q, %q), want (%q, %q)", emoji, text, c.wantEmoji, c.wantText)
			}
		})
	}
}
