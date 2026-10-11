package codesender

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"go.uber.org/zap"
)

// resendEndpoint 是 Resend 的发信 API。
const resendEndpoint = "https://api.resend.com/emails"

// ResendSender 通过 Resend 发送验证码邮件。
//
// 选它的原因见 docs/deploy/sms.md：个人开发者 + 海外服务器这一组合下，
// 国内四家云厂商的短信签名全部拿不到（必须企业主体），而 Resend 免费档
// 每月 3000 封、每日 100 封，是当前身份下唯一能即刻跑通的真实下发通道。
type ResendSender struct {
	apiKey  string
	from    string
	subject string
	client  *http.Client
	logger  *zap.Logger
}

// NewResendSender 构造 Resend 邮件通道。
//
// from 必须是已在 Resend 验证过域名下的地址（如 noreply@mail.example.com），
// 用未验证的域名发信会被 API 以 403 拒绝。
func NewResendSender(apiKey, from, subject string, logger *zap.Logger) *ResendSender {
	if subject == "" {
		subject = "验证码"
	}
	return &ResendSender{
		apiKey:  apiKey,
		from:    from,
		subject: subject,
		// 超时必须设：默认 http.Client 没有超时，下游卡住会把发码请求一起拖死，
		// 而发码是同步接口，用户那边就是一直转圈。
		client: &http.Client{Timeout: 10 * time.Second},
		logger: logger,
	}
}

// resendRequest 是 Resend 发信接口的请求体。
type resendRequest struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	HTML    string   `json:"html"`
}

// Send 向 target（邮箱地址）发送含验证码的邮件。
//
// 返回错误时调用方会回滚 Redis 里的验证码与冷却键，
// 因此这里**不能**把失败咽掉 —— 咽掉的后果是用户被冷却期锁住却收不到码。
func (s *ResendSender) Send(ctx context.Context, target, code string) error {
	if !strings.Contains(target, "@") {
		// 邮件通道收到手机号说明上层路由错了。明确报错而不是硬发一封注定失败的信：
		// 静默失败会让「为什么收不到码」变成一桩无从查起的悬案。
		return fmt.Errorf("resend 通道只支持邮箱地址，收到: %s", maskTarget(target))
	}

	body, err := json.Marshal(resendRequest{
		From:    s.from,
		To:      []string{target},
		Subject: s.subject,
		HTML:    buildCodeHTML(code),
	})
	if err != nil {
		return fmt.Errorf("marshal resend request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, resendEndpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("new resend request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+s.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("resend request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// 响应体里有 Resend 的具体原因（域名未验证、额度用尽、from 不合法等），
		// 截断后带进错误里 —— 只报状态码的话排查时等于没有信息。
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("resend 返回 %d: %s", resp.StatusCode, strings.TrimSpace(string(detail)))
	}

	s.logger.Info("验证码已下发",
		zap.String("target", maskTarget(target)),
		zap.String("channel", "resend"))
	return nil
}

// buildCodeHTML 生成验证码邮件正文。
//
// 刻意保持极简：没有外链、没有图片、没有追踪像素。验证码邮件带外链会显著提高
// 被判成钓鱼而进垃圾箱的概率，而进了垃圾箱的表现与「没发出去」完全一样。
func buildCodeHTML(code string) string {
	return `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;color:#1f2328">` +
		`<p>你的验证码是：</p>` +
		`<p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:16px 0">` + code + `</p>` +
		`<p style="color:#59636e">5 分钟内有效。如果不是你本人操作，请忽略本邮件。</p>` +
		`</div>`
}
