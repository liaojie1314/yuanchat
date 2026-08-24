// Package codesender 提供验证码下发通道的抽象。
//
// 调用方只依赖 Sender 接口，切换短信 / 邮件服务商不需要改动业务代码。
package codesender

import (
	"context"
	"fmt"
	"strings"

	"go.uber.org/zap"
)

// Sender 是验证码下发通道。
type Sender interface {
	// Send 向 target（手机号或邮箱）下发验证码 code。
	//
	// 返回错误表示下发失败，调用方应回滚本次发码
	//（删除 Redis 中的验证码与冷却键），否则用户会被冷却期锁住却收不到码。
	Send(ctx context.Context, target, code string) error
}

// LogSender 把验证码写进日志，供开发与测试环境使用。
//
// 手机号与验证码都会打码后再落日志：日志会进文件、被采集、被转发，
// 明文验证码等于把账号交给任何能读日志的人。
type LogSender struct{ logger *zap.Logger }

// NewLogSender 构造日志通道。
func NewLogSender(logger *zap.Logger) *LogSender { return &LogSender{logger: logger} }

// Send 把打码后的验证码写入日志，永不失败。
func (s *LogSender) Send(_ context.Context, target, code string) error {
	s.logger.Info("验证码已下发",
		zap.String("target", maskTarget(target)),
		zap.String("code", maskCode(code)),
		zap.String("channel", "log"))
	return nil
}

// New 按配置构造下发通道。
//
// provider 未知时返回错误，绝不静默退回日志通道——生产环境静默用日志通道
// 等于验证码永远发不出去，而且不会有人发现。调用方应据此让进程启动失败。
func New(provider string, logger *zap.Logger) (Sender, error) {
	switch provider {
	case "log":
		return NewLogSender(logger), nil
	default:
		return nil, fmt.Errorf("未支持的验证码下发通道: %q", provider)
	}
}

// maskTarget 给手机号 / 邮箱打码：长度 ≥ 8 时保留头 3 尾 4（13800138000 → 138****8000），
// 否则退回 maskCode 的首末保留策略。
func maskTarget(s string) string {
	r := []rune(s)
	if len(r) < 8 {
		return maskCode(s)
	}
	return string(r[:3]) + strings.Repeat("*", len(r)-7) + string(r[len(r)-4:])
}

// maskCode 给验证码打码：保留首末字符，中间以 * 替代（123456 → 1****6）；
// 长度不足 3 时整体打码，避免短值等同于明文。
func maskCode(s string) string {
	r := []rune(s)
	if len(r) < 3 {
		return "***"
	}
	return string(r[0]) + strings.Repeat("*", len(r)-2) + string(r[len(r)-1])
}
