package config

import (
	"fmt"
	"strings"
	"time"

	"github.com/spf13/viper"
)

// Config 应用配置根结构
type Config struct {
	Server     ServerConfig     `mapstructure:"server"`
	WebSocket  WebSocketConfig  `mapstructure:"websocket"`
	Database   DatabaseConfig   `mapstructure:"database"`
	Redis      RedisConfig      `mapstructure:"redis"`
	JWT        JWTConfig        `mapstructure:"jwt"`
	Log        LogConfig        `mapstructure:"log"`
	Asynq      AsynqConfig      `mapstructure:"asynq"`
	Upload     UploadConfig     `mapstructure:"upload"`
	MinIO      MinIOConfig      `mapstructure:"minio"`
	Moderation ModerationConfig `mapstructure:"moderation"`
	Presence   PresenceConfig   `mapstructure:"presence"`
	Dispatcher DispatcherConfig `mapstructure:"dispatcher"`
	Push       PushConfig       `mapstructure:"push"`
	CodeSender CodeSenderConfig `mapstructure:"codesender"`
	Turn       TurnConfig       `mapstructure:"turn"`
}

type ServerConfig struct {
	Name            string        `mapstructure:"name"`
	Env             string        `mapstructure:"env"`
	Host            string        `mapstructure:"host"`
	Port            int           `mapstructure:"port"`
	ReadTimeout     time.Duration `mapstructure:"read_timeout"`
	WriteTimeout    time.Duration `mapstructure:"write_timeout"`
	ShutdownTimeout time.Duration `mapstructure:"shutdown_timeout"`
}

type WebSocketConfig struct {
	Port                  int           `mapstructure:"port"`
	ReadTimeout           time.Duration `mapstructure:"read_timeout"`
	WriteTimeout          time.Duration `mapstructure:"write_timeout"`
	PingInterval          time.Duration `mapstructure:"ping_interval"`
	PongTimeout           time.Duration `mapstructure:"pong_timeout"`
	MaxMessageSize        int64         `mapstructure:"max_message_size"`
	MaxConnectionsPerUser int           `mapstructure:"max_connections_per_user"`
}

type DatabaseConfig struct {
	Host            string        `mapstructure:"host"`
	Port            int           `mapstructure:"port"`
	User            string        `mapstructure:"user"`
	Password        string        `mapstructure:"password"`
	DBName          string        `mapstructure:"dbname"`
	SSLMode         string        `mapstructure:"sslmode"`
	MaxOpenConns    int           `mapstructure:"max_open_conns"`
	MaxIdleConns    int           `mapstructure:"max_idle_conns"`
	ConnMaxLifetime time.Duration `mapstructure:"conn_max_lifetime"`
	LogLevel        string        `mapstructure:"log_level"`
}

func (d DatabaseConfig) DSN() string {
	return fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		d.Host, d.Port, d.User, d.Password, d.DBName, d.SSLMode,
	)
}

type RedisConfig struct {
	Host         string        `mapstructure:"host"`
	Port         int           `mapstructure:"port"`
	Password     string        `mapstructure:"password"`
	DB           int           `mapstructure:"db"`
	PoolSize     int           `mapstructure:"pool_size"`
	MinIdleConns int           `mapstructure:"min_idle_conns"`
	DialTimeout  time.Duration `mapstructure:"dial_timeout"`
	ReadTimeout  time.Duration `mapstructure:"read_timeout"`
	WriteTimeout time.Duration `mapstructure:"write_timeout"`
}

func (r RedisConfig) Addr() string {
	return fmt.Sprintf("%s:%d", r.Host, r.Port)
}

type JWTConfig struct {
	Secret          string        `mapstructure:"secret"`
	AccessTokenTTL  time.Duration `mapstructure:"access_token_ttl"`
	RefreshTokenTTL time.Duration `mapstructure:"refresh_token_ttl"`
}

type LogConfig struct {
	Level      string `mapstructure:"level"`
	Format     string `mapstructure:"format"`
	Output     string `mapstructure:"output"`
	FilePath   string `mapstructure:"file_path"`
	MaxSize    int    `mapstructure:"max_size"`
	MaxBackups int    `mapstructure:"max_backups"`
	MaxAge     int    `mapstructure:"max_age"`
	Compress   bool   `mapstructure:"compress"`
}

type AsynqConfig struct {
	RedisAddr     string         `mapstructure:"redis_addr"`
	RedisPassword string         `mapstructure:"redis_password"`
	RedisDB       int            `mapstructure:"redis_db"`
	Concurrency   int            `mapstructure:"concurrency"`
	Queues        map[string]int `mapstructure:"queues"`
}

// PushConfig Web Push（VAPID）配置。密钥为空时推送功能整体关闭。
type PushConfig struct {
	VAPIDPublicKey  string `mapstructure:"vapid_public_key"`
	VAPIDPrivateKey string `mapstructure:"vapid_private_key"`
	Subject         string `mapstructure:"subject"` // mailto: 或站点 URL，规范要求
	TTL             int    `mapstructure:"ttl"`     // 推送服务保留秒数
}

// CodeSenderConfig 验证码下发通道配置。
//
// provider 为未知值时进程启动即失败：静默退回日志通道等于验证码永远发不出去。
type CodeSenderConfig struct {
	Provider string `mapstructure:"provider"` // log（写日志，开发/测试用）| 后续接入服务商时扩展
}

// PresenceConfig 在线状态后端配置。
type PresenceConfig struct {
	Backend string `mapstructure:"backend"` // local（单实例，默认）| redis（多实例 Pub/Sub）
	Channel string `mapstructure:"channel"` // redis 模式的事件 channel，默认 presence:events
}

// DispatcherConfig 跨实例消息分发配置。
type DispatcherConfig struct {
	Backend string `mapstructure:"backend"` // inproc（进程内 Hub，单实例默认）| redis（多实例 Pub/Sub）
	Channel string `mapstructure:"channel"` // redis 模式的分发 channel，默认 ws:dispatch
}

// TurnConfig WebRTC 通话的 TURN/STUN 配置。
//
// StaticAuthSecret 与 coturn 的 use-auth-secret 模式共享同一个密钥：服务端用它签发
// 带过期时间的临时凭据，coturn 侧用同一密钥复算校验，双方都不需要 TURN 用户表。
// Host 是【客户端可达】的地址，不能填容器内网主机名 —— 那是浏览器解析不了的
// （与 MinIO 的 Endpoint / PublicEndpoint 分离同一个道理）。
type TurnConfig struct {
	Enabled          bool          `mapstructure:"enabled"`
	Host             string        `mapstructure:"host"`
	Port             int           `mapstructure:"port"`
	Realm            string        `mapstructure:"realm"`
	StaticAuthSecret string        `mapstructure:"static_auth_secret"`
	CredentialTTL    time.Duration `mapstructure:"credential_ttl"`
}

// ModerationConfig 内容审核配置。
type ModerationConfig struct {
	Words []string `mapstructure:"words"` // 敏感词库；命中的消息标记 flagged 进审核队列
}

type UploadConfig struct {
	MaxFileSize  int64    `mapstructure:"max_file_size"`
	AllowedTypes []string `mapstructure:"allowed_types"`
}

// MinIOConfig 对象存储（MinIO / S3 兼容）连接配置。
type MinIOConfig struct {
	Endpoint  string `mapstructure:"endpoint"`   // 服务地址，形如 localhost:9000（不含 scheme）
	AccessKey string `mapstructure:"access_key"` // 访问密钥
	SecretKey string `mapstructure:"secret_key"` // 私有密钥
	Bucket    string `mapstructure:"bucket"`     // 默认桶名
	UseSSL    bool   `mapstructure:"use_ssl"`    // 是否使用 HTTPS

	// PublicEndpoint 下发给客户端的对外地址（不含 scheme），形如 storage.example.com。
	// 与 Endpoint 严格分开：后者是服务端建连用的内网地址（生产是 compose 主机名
	// minio:9000，客户端根本解析不了）。留空时回落到 Endpoint，dev 行为不变。
	PublicEndpoint string `mapstructure:"public_endpoint"`
	// PublicUseSSL 对外地址是否走 HTTPS（生产经 nginx 终止 TLS 时为 true）。
	PublicUseSSL bool `mapstructure:"public_use_ssl"`
}

// Load 加载配置文件，支持环境变量覆盖
func Load(configPath string) (*Config, error) {
	v := viper.New()

	// 设置默认配置文件路径
	v.SetConfigFile(configPath)
	v.SetConfigType("yaml")

	// 配置文件里没写 codesender 段时退回日志通道；
	// 显式写了未知值仍会在启动时失败（见 CodeSenderConfig）。
	v.SetDefault("codesender.provider", "log")

	// 环境变量支持: SERVER_PORT=9090 覆盖 server.port
	v.SetEnvPrefix("YUANCHAT")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	// 对象存储对外端点只在生产由环境变量下发，配置文件里不出现。
	// AutomaticEnv 不会把未知 key 登记进 AllKeys，而 Unmarshal 只遍历 AllKeys，
	// 因此必须显式声明默认值让 key 可见，否则环境变量会被静默丢弃
	// （客户端就又会拿到内网主机名的 URL）。
	v.SetDefault("minio.public_endpoint", "")
	v.SetDefault("minio.public_use_ssl", false)

	// TURN 密钥与对外主机同理：生产只由环境变量下发，配置文件里不出现真值。
	v.SetDefault("turn.static_auth_secret", "")
	v.SetDefault("turn.host", "localhost")
	v.SetDefault("turn.realm", "yuanchat")

	if err := v.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	return &cfg, nil
}

// IsDevelopment 是否开发环境
func (s ServerConfig) IsDevelopment() bool {
	return s.Env == "development"
}

// IsProduction 是否生产环境
func (s ServerConfig) IsProduction() bool {
	return s.Env == "production"
}
