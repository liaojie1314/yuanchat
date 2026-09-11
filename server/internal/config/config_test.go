package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// writeConfig 写一份最小可加载的配置文件，返回其路径。
func writeConfig(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return path
}

const minimalMinIOConfig = `minio:
  endpoint: localhost:9002
  bucket: yuanchat
  use_ssl: false
`

// TestLoadMinIOPublicEndpointFromEnv 钉住「对外端点能被环境变量注入」这件事。
//
// viper 的 AutomaticEnv 不会把未知 key 登记进 AllKeys，而 Unmarshal 只遍历 AllKeys，
// 所以配置文件里没有出现过的 key 光靠环境变量是读不到的（静默为零值）。
// 生产的对外端点只通过 compose 的环境变量下发，一旦这里退化，
// 客户端又会拿到内网主机名 minio:9000 —— 即本次要修的那个故障本身。
func TestLoadMinIOPublicEndpointFromEnv(t *testing.T) {
	path := writeConfig(t, minimalMinIOConfig)
	t.Setenv("YUANCHAT_MINIO_PUBLIC_ENDPOINT", "storage.example.com")
	t.Setenv("YUANCHAT_MINIO_PUBLIC_USE_SSL", "true")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.MinIO.PublicEndpoint != "storage.example.com" {
		t.Errorf("PublicEndpoint = %q, want storage.example.com", cfg.MinIO.PublicEndpoint)
	}
	// 环境变量是字符串 "true"，需被弱类型解码成 bool
	if !cfg.MinIO.PublicUseSSL {
		t.Error("PublicUseSSL = false, want true")
	}
	// 内网建连地址不受对外端点影响
	if cfg.MinIO.Endpoint != "localhost:9002" {
		t.Errorf("Endpoint = %q, want localhost:9002", cfg.MinIO.Endpoint)
	}
}

// TestLoadMinIOPublicEndpointDefaultsEmpty 未配置时保持空值 —— dev 环境回落到内网 endpoint。
func TestLoadMinIOPublicEndpointDefaultsEmpty(t *testing.T) {
	path := writeConfig(t, minimalMinIOConfig)

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.MinIO.PublicEndpoint != "" {
		t.Errorf("PublicEndpoint = %q, want empty", cfg.MinIO.PublicEndpoint)
	}
	if cfg.MinIO.PublicUseSSL {
		t.Error("PublicUseSSL = true, want false")
	}
}

// TestLoadTurnFromEnv 钉住「turn 段能被环境变量注入」，与上面 MinIO 那两条同一道防线：
// TURN 密钥在生产只由环境变量下发，配置文件里不出现真值，
// 一旦 SetDefault 退化，签出的凭据就是空密钥算的 —— 全部通话打不通。
func TestLoadTurnFromEnv(t *testing.T) {
	path := writeConfig(t, "turn:\n  enabled: true\n  port: 3478\n  credential_ttl: 1h\n")
	t.Setenv("YUANCHAT_TURN_STATIC_AUTH_SECRET", "from-env")
	t.Setenv("YUANCHAT_TURN_HOST", "turn.example.com")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !cfg.Turn.Enabled {
		t.Error("Enabled = false, want true")
	}
	if cfg.Turn.StaticAuthSecret != "from-env" {
		t.Errorf("StaticAuthSecret = %q, want from-env", cfg.Turn.StaticAuthSecret)
	}
	if cfg.Turn.Host != "turn.example.com" {
		t.Errorf("Host = %q, want turn.example.com", cfg.Turn.Host)
	}
	if cfg.Turn.CredentialTTL != time.Hour {
		t.Errorf("CredentialTTL = %v, want 1h", cfg.Turn.CredentialTTL)
	}
}

// TestLoadTurnDefaults 配置文件完全不写 turn 段时，host / realm 仍有可用默认值。
func TestLoadTurnDefaults(t *testing.T) {
	cfg, err := Load(writeConfig(t, minimalMinIOConfig))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Turn.Host != "localhost" {
		t.Errorf("Host = %q, want localhost", cfg.Turn.Host)
	}
	if cfg.Turn.Realm != "yuanchat" {
		t.Errorf("Realm = %q, want yuanchat", cfg.Turn.Realm)
	}
}
