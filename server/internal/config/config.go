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
