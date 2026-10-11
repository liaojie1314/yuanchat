package config

import (
	"os"
	"path/filepath"
	"testing"
)

// 发码通道的全部配置项都只由环境变量下发，必须逐项验证真的读到了。
//
// 这类 key 在配置文件里不出现，而 viper 的 AutomaticEnv 不会把未知 key
// 登记进 AllKeys、Unmarshal 又只遍历 AllKeys —— 漏登记默认值的后果是
// 「环境变量填了却读到空串」，表现为配好了通道但发信一直报凭据为空。
// Port 额外要验类型转换：环境变量永远是字符串，转不动就会退回默认值 465。
func TestCodeSenderEnvOverrides(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte("server:\n  env: test\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	for k, v := range map[string]string{
		"YUANCHAT_CODESENDER_PROVIDER": "smtp",
		"YUANCHAT_CODESENDER_HOST":     "smtp.qq.com",
		"YUANCHAT_CODESENDER_PORT":     "587",
		"YUANCHAT_CODESENDER_USERNAME": "me@qq.com",
		"YUANCHAT_CODESENDER_PASSWORD": "authcode",
		"YUANCHAT_CODESENDER_FROM":     "me@qq.com",
		"YUANCHAT_CODESENDER_SUBJECT":  "验证码",
		"YUANCHAT_CODESENDER_API_KEY":  "re_test",
	} {
		t.Setenv(k, v)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("加载配置失败: %v", err)
	}
	c := cfg.CodeSender
	for _, tc := range []struct{ name, got, want string }{
		{"provider", c.Provider, "smtp"},
		{"host", c.Host, "smtp.qq.com"},
		{"username", c.Username, "me@qq.com"},
		{"password", c.Password, "authcode"},
		{"from", c.From, "me@qq.com"},
		{"subject", c.Subject, "验证码"},
		{"api_key", c.APIKey, "re_test"},
	} {
		if tc.got != tc.want {
			t.Errorf("%s = %q，期望 %q", tc.name, tc.got, tc.want)
		}
	}
	// 字符串 → int 的弱类型转换必须生效，否则端口会悄悄退回 465，
	// 对 587 发隐式 TLS 会卡在握手上超时
	if c.Port != 587 {
		t.Errorf("port = %d，期望 587（环境变量是字符串，转换没生效）", c.Port)
	}
}

// WS Origin 白名单是逗号分隔的环境变量，必须切成切片。
// 切不开的后果是白名单永远匹配不上，生产所有客户端的 WS 连接全部 403。
func TestWebSocketAllowedOriginsEnvSplit(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte("server:\n  env: test\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("YUANCHAT_WEBSOCKET_ALLOWED_ORIGINS", "https://a.example.com,tauri://localhost")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("加载配置失败: %v", err)
	}
	got := cfg.WebSocket.AllowedOrigins
	if len(got) != 2 || got[0] != "https://a.example.com" || got[1] != "tauri://localhost" {
		t.Fatalf("AllowedOrigins = %#v，期望切成两项", got)
	}
}
