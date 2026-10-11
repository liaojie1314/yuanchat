package codesender

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"go.uber.org/zap"

	"github.com/yuanchat/server/internal/config"
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
	if _, err := New(config.CodeSenderConfig{Provider: "aliyun-typo"}, zap.NewNop()); err == nil {
		t.Fatal("未知 provider 应当返回错误，不能静默退回 log 通道")
	}
	if _, err := New(config.CodeSenderConfig{}, zap.NewNop()); err == nil {
		t.Fatal("空 provider 应当返回错误")
	}
}

// TestNewLogProvider provider=log 时返回日志通道。
func TestNewLogProvider(t *testing.T) {
	s, err := New(config.CodeSenderConfig{Provider: "log"}, zap.NewNop())
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

// provider=resend 但缺密钥或发件人时必须启动即失败。
//
// 带着空配置启动的话，要等到第一个用户来发码才暴露，而那时他已经被冷却期锁住了 ——
// 「收不到码且 60 秒内不能重发」比「服务起不来」难查得多。
func TestNewResendRequiresCredentials(t *testing.T) {
	cases := []struct {
		name string
		cfg  config.CodeSenderConfig
	}{
		{"缺 api_key", config.CodeSenderConfig{Provider: "resend", From: "noreply@example.com"}},
		{"缺 from", config.CodeSenderConfig{Provider: "resend", APIKey: "re_test"}},
		{"两者都缺", config.CodeSenderConfig{Provider: "resend"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := New(tc.cfg, zap.NewNop()); err == nil {
				t.Fatal("配置不全时应当返回错误")
			}
		})
	}

	s, err := New(config.CodeSenderConfig{
		Provider: "resend", APIKey: "re_test", From: "noreply@example.com",
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("配置齐全时不该报错: %v", err)
	}
	if _, ok := s.(*ResendSender); !ok {
		t.Fatalf("provider=resend 应当返回 ResendSender，实际 %T", s)
	}
}

// 邮件通道收到手机号必须报错，不能硬发一封注定失败的信。
func TestResendRejectsNonEmailTarget(t *testing.T) {
	s := NewResendSender("re_test", "noreply@example.com", "", zap.NewNop())
	err := s.Send(context.Background(), "13800138000", "123456")
	if err == nil {
		t.Fatal("手机号走邮件通道应当返回错误")
	}
	// 错误信息里不能出现完整手机号：错误会进日志，日志会被采集转发
	if strings.Contains(err.Error(), "13800138000") {
		t.Fatalf("错误信息泄露了完整手机号: %v", err)
	}
}

// provider=smtp 缺 host / from / password 任一项都必须启动即失败。
//
// password 这项尤其要挡：QQ / 163 要的是授权码，很容易误填成邮箱登录密码或干脆留空，
// 而留空启动后的表现是「注册页一直转圈」，从前端完全看不出是发信认证失败。
func TestNewSMTPRequiresCredentials(t *testing.T) {
	cases := []struct {
		name string
		cfg  config.CodeSenderConfig
	}{
		{"缺 host", config.CodeSenderConfig{Provider: "smtp", From: "me@qq.com", Password: "authcode"}},
		{"缺 from", config.CodeSenderConfig{Provider: "smtp", Host: "smtp.qq.com", Password: "authcode"}},
		{"缺 password", config.CodeSenderConfig{Provider: "smtp", Host: "smtp.qq.com", From: "me@qq.com"}},
		{"全缺", config.CodeSenderConfig{Provider: "smtp"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := New(tc.cfg, zap.NewNop()); err == nil {
				t.Fatal("配置不全时应当返回错误")
			}
		})
	}

	s, err := New(config.CodeSenderConfig{
		Provider: "smtp", Host: "smtp.qq.com", Port: 465,
		From: "me@qq.com", Password: "authcode",
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("配置齐全时不该报错: %v", err)
	}
	if _, ok := s.(*SMTPSender); !ok {
		t.Fatalf("provider=smtp 应当返回 SMTPSender，实际 %T", s)
	}
}

// 邮件通道收到手机号必须报错，且不能泄露完整号码。
func TestSMTPRejectsNonEmailTarget(t *testing.T) {
	s := NewSMTPSender("smtp.qq.com", 465, "", "authcode", "me@qq.com", "", zap.NewNop())
	err := s.Send(context.Background(), "13800138000", "123456")
	if err == nil {
		t.Fatal("手机号走邮件通道应当返回错误")
	}
	if strings.Contains(err.Error(), "13800138000") {
		t.Fatalf("错误信息泄露了完整手机号: %v", err)
	}
}

// 端口决定握手方式：465 隐式 TLS，其余 STARTTLS。
// 搞反了的表现是连接直接超时（对 465 发明文 EHLO server 不会回应），
// 而超时的报错看不出是模式选错了。
func TestSMTPImplicitTLSByPort(t *testing.T) {
	if !NewSMTPSender("smtp.qq.com", 465, "", "p", "me@qq.com", "", zap.NewNop()).implicit {
		t.Error("465 应当走隐式 TLS")
	}
	if NewSMTPSender("smtp.qq.com", 587, "", "p", "me@qq.com", "", zap.NewNop()).implicit {
		t.Error("587 应当走 STARTTLS")
	}
}

// 信件头必须是合规的 RFC 5322：中文标题经 RFC 2047 编码、头部用 CRLF、
// 带 Date 与 Message-ID。任一项不合规的后果都是「发出去了但进垃圾箱」，
// 表现与没发出去完全一样。
func TestSMTPBuildMessageHeaders(t *testing.T) {
	s := NewSMTPSender("smtp.qq.com", 465, "", "p", "me@qq.com", "", zap.NewNop())
	msg := s.buildMessage("you@163.com", "123456")

	if strings.Contains(msg, "Subject: 验证码") {
		t.Error("中文标题必须按 RFC 2047 编码，不能裸写 UTF-8")
	}
	for _, want := range []string{
		"From: me@qq.com\r\n",
		"To: you@163.com\r\n",
		"Subject: =?utf-8?q?",
		"Date: ",
		"@qq.com>\r\n", // Message-ID 的域取自发件地址
		"Content-Type: text/html; charset=UTF-8\r\n\r\n",
		"123456",
	} {
		if !strings.Contains(msg, want) {
			t.Errorf("信件缺少 %q\n---\n%s", want, msg)
		}
	}
	// 用户名默认取 From：QQ / 163 的登录名就是邮箱地址，省一项配置
	if got := NewSMTPSender("smtp.qq.com", 465, "", "p", "me@qq.com", "", zap.NewNop()); got.from != "me@qq.com" {
		t.Errorf("from 应为 me@qq.com，实际 %q", got.from)
	}
}
