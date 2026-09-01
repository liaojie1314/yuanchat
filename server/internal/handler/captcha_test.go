package handler

import (
	"testing"

	"github.com/yuanchat/server/internal/testutil"
)

// TestCaptchaValidateWrongAnswerKeepsCode 输错一次不应作废验证码：
// 比对失败后再次用正确答案校验，仍可通过。
func TestCaptchaValidateWrongAnswerKeepsCode(t *testing.T) {
	rdb, _ := testutil.NewRedis(t)
	h := NewCaptchaHandler(rdb)

	id := "test-captcha-id"
	if err := rdb.Set(t.Context(), captchaKey(id), 42, 0).Err(); err != nil {
		t.Fatalf("预置验证码: %v", err)
	}

	if h.Validate(t.Context(), id, 43) {
		t.Fatal("错误答案不应通过校验")
	}
	// 输错后验证码仍在，正确答案应可再次校验
	if !h.Validate(t.Context(), id, 42) {
		t.Fatal("输错一次后，正确答案应仍可通过校验")
	}
}

// TestCaptchaValidateCorrectAnswerDeletesCode 比对成功后删除，二次使用应失败。
func TestCaptchaValidateCorrectAnswerDeletesCode(t *testing.T) {
	rdb, _ := testutil.NewRedis(t)
	h := NewCaptchaHandler(rdb)

	id := "test-captcha-once"
	if err := rdb.Set(t.Context(), captchaKey(id), 7, 0).Err(); err != nil {
		t.Fatalf("预置验证码: %v", err)
	}

	if !h.Validate(t.Context(), id, 7) {
		t.Fatal("正确答案应通过校验")
	}
	if h.Validate(t.Context(), id, 7) {
		t.Fatal("验证码应一次性使用，二次校验须失败")
	}
	if rdb.Exists(t.Context(), captchaKey(id)).Val() != 0 {
		t.Fatal("校验成功后 Redis key 应已删除")
	}
}

// TestCaptchaValidateMissingID 不存在的 id 应返回 false。
func TestCaptchaValidateMissingID(t *testing.T) {
	rdb, _ := testutil.NewRedis(t)
	h := NewCaptchaHandler(rdb)

	if h.Validate(t.Context(), "no-such-id", 1) {
		t.Fatal("不存在的验证码 id 不应通过校验")
	}
}

// TestNewCaptchaIDRandomness 生成的 id 应为 32 位 hex 且随机不重复。
func TestNewCaptchaIDRandomness(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 100; i++ {
		id, err := newCaptchaID()
		if err != nil {
			t.Fatalf("生成 id: %v", err)
		}
		if len(id) != 32 {
			t.Fatalf("id 长度 = %d, want 32 (128bit hex)", len(id))
		}
		if seen[id] {
			t.Fatalf("id 重复: %s", id)
		}
		seen[id] = true
	}
}
