package codesender

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// bufLogger 构造一个把日志写进内存缓冲的 zap logger，供断言日志内容用。
func bufLogger() (*zap.Logger, *bytes.Buffer) {
	buf := &bytes.Buffer{}
	core := zapcore.NewCore(
		zapcore.NewJSONEncoder(zap.NewProductionEncoderConfig()),
		zapcore.AddSync(buf),
		zapcore.DebugLevel,
	)
	return zap.New(core), buf
}

// TestLogSenderMasksCode 日志通道不得把手机号与验证码明文写进日志。
func TestLogSenderMasksCode(t *testing.T) {
	logger, buf := bufLogger()
	s := NewLogSender(logger)

	if err := s.Send(context.Background(), "13800138000", "123456"); err != nil {
		t.Fatalf("Send: %v", err)
	}

	out := buf.String()
	if strings.Contains(out, "123456") {
		t.Fatalf("日志中出现验证码明文: %s", out)
	}
	if strings.Contains(out, "13800138000") {
		t.Fatalf("日志中出现手机号明文: %s", out)
	}
	if !strings.Contains(out, "1****6") {
		t.Fatalf("日志缺少打码后的验证码: %s", out)
	}
	if !strings.Contains(out, "138****8000") {
		t.Fatalf("日志缺少打码后的手机号: %s", out)
	}
	if !strings.Contains(out, "log") {
		t.Fatalf("日志缺少 channel 标识: %s", out)
	}
}

// TestNewRejectsUnknownProvider 未知 provider 必须报错，不能静默退回日志通道。
func TestNewRejectsUnknownProvider(t *testing.T) {
	if _, err := New("aliyun-typo", zap.NewNop()); err == nil {
		t.Fatal("未知 provider 应当返回错误，不能静默退回 log 通道")
	}
	if _, err := New("", zap.NewNop()); err == nil {
		t.Fatal("空 provider 应当返回错误")
	}
}

// TestNewLogProvider provider=log 时返回日志通道。
func TestNewLogProvider(t *testing.T) {
	s, err := New("log", zap.NewNop())
	if err != nil {
		t.Fatalf("New(log): %v", err)
	}
	if _, ok := s.(*LogSender); !ok {
		t.Fatalf("New(log) 应返回 *LogSender，got %T", s)
	}
}

// TestMaskShortValues 短值与空值不得漏出原文。
func TestMaskShortValues(t *testing.T) {
	codes := []struct {
		in   string
		want string
	}{
		{"", "***"},
		{"ab", "***"},
		{"abc", "a*c"},
		{"123456", "1****6"},
	}
	for _, tc := range codes {
		if got := maskCode(tc.in); got != tc.want {
			t.Errorf("maskCode(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}

	targets := []struct {
		in   string
		want string
	}{
		{"13800138000", "138****8000"},
		{"12345678", "123*5678"}, // 恰好 8 位：头 3 尾 4，中间 1 位打码
		{"1234567", "1*****7"},   // 不足 8 位：退回首末保留
		{"ab", "***"},            // 过短：整体打码
		{"a@b.co", "a****o"},     // 短邮箱同样不漏出原文
	}
	for _, tc := range targets {
		if got := maskTarget(tc.in); got != tc.want {
			t.Errorf("maskTarget(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
