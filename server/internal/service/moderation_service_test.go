package service

import "testing"

func TestModerationCheck(t *testing.T) {
	svc := NewModerationService([]string{"赌博", "SCAM", "  ", ""})

	cases := []struct {
		text string
		want string
	}{
		{"今晚一起赌博吗", "赌博"},
		{"this is a scam link", "scam"}, // 大小写不敏感
		{"正常聊天内容", ""},
		{"", ""},
	}
	for _, c := range cases {
		if got := svc.Check(c.text); got != c.want {
			t.Errorf("Check(%q) = %q, want %q", c.text, got, c.want)
		}
	}
}

func TestModerationSetWords(t *testing.T) {
	svc := NewModerationService([]string{"old"})
	if svc.Check("old word") == "" {
		t.Fatal("initial word should hit")
	}
	svc.SetWords([]string{"new"})
	if svc.Check("old word") != "" {
		t.Fatal("old word should no longer hit after SetWords")
	}
	if svc.Check("new word") == "" {
		t.Fatal("new word should hit")
	}
}

func TestModerationEmptyWordlist(t *testing.T) {
	svc := NewModerationService(nil)
	if got := svc.Check("任意内容"); got != "" {
		t.Fatalf("empty wordlist should never hit, got %q", got)
	}
}
