package codesender

import (
	"context"
	"crypto/tls"
	"fmt"
	"math/rand"
	"mime"
	"net"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	"go.uber.org/zap"
)

// SMTPSender 通过任意 SMTP 服务商发送验证码邮件。
//
// 相比各家的 HTTP API，SMTP 的好处是一份实现通吃 QQ 邮箱 / 163 / Gmail /
// 企业邮，用的还是标准库 net/smtp，不引第三方依赖。
//
// 用 QQ 邮箱时：host=smtp.qq.com、port=465、username 与 from 都填自己的
// QQ 邮箱地址，password 填**授权码**而不是 QQ 密码（设置 → 账号 →
// POP3/SMTP 服务 → 开启后生成）。用登录密码会被服务端以认证失败拒绝。
type SMTPSender struct {
	addr     string // host:port
	host     string // TLS SNI 与证书校验用，不能带端口
	implicit bool   // true 走隐式 TLS（465），false 走 STARTTLS（587）
	auth     smtp.Auth
	from     string
	subject  string
	logger   *zap.Logger
}

// NewSMTPSender 构造 SMTP 邮件通道。
//
// port 决定握手方式：465 是隐式 TLS（连上立刻 TLS），其余端口走 STARTTLS。
// 这个分支不能省 —— 对 465 发明文 EHLO 会卡在握手上直接超时，
// 而 163 已经不提供非 SSL 端口，两种模式都得支持。
func NewSMTPSender(host string, port int, username, password, from, subject string, logger *zap.Logger) *SMTPSender {
	if subject == "" {
		subject = "验证码"
	}
	if username == "" {
		username = from // QQ / 163 的登录名就是邮箱地址本身，省一项配置
	}
	return &SMTPSender{
		addr:     net.JoinHostPort(host, strconv.Itoa(port)),
		host:     host,
		implicit: port == 465,
		auth:     smtp.PlainAuth("", username, password, host),
		from:     from,
		subject:  subject,
		logger:   logger,
	}
}

// Send 向 target（邮箱地址）发送含验证码的邮件。
//
// 返回错误时调用方会回滚 Redis 里的验证码与冷却键，
// 因此这里不能把失败咽掉 —— 咽掉的后果是用户被冷却期锁住却收不到码。
func (s *SMTPSender) Send(ctx context.Context, target, code string) error {
	if !strings.Contains(target, "@") {
		// 邮件通道收到手机号说明上层路由错了。明确报错而不是硬发一封注定失败的信。
		return fmt.Errorf("smtp 通道只支持邮箱地址，收到: %s", maskTarget(target))
	}

	client, err := s.dial(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = client.Close() }()

	if err := client.Auth(s.auth); err != nil {
		// 认证失败最常见的原因是拿 QQ 登录密码当了授权码，错误信息里带上提示，
		// 否则服务端只回一句 "535 Login Fail"，排查时毫无线索。
		return fmt.Errorf("smtp 认证失败（QQ/163 需使用授权码而非登录密码）: %w", err)
	}
	if err := client.Mail(s.from); err != nil {
		return fmt.Errorf("smtp MAIL FROM: %w", err)
	}
	if err := client.Rcpt(target); err != nil {
		return fmt.Errorf("smtp RCPT TO: %w", err)
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp DATA: %w", err)
	}
	if _, err := w.Write([]byte(s.buildMessage(target, code))); err != nil {
		return fmt.Errorf("smtp 写信体: %w", err)
	}
	if err := w.Close(); err != nil {
		// 投递的最终结果在 DATA 结束时才返回（超额、被判垃圾等都在这一步），
		// 漏掉这个错误会把失败的投递当成成功。
		return fmt.Errorf("smtp 投递被拒: %w", err)
	}
	_ = client.Quit()

	s.logger.Info("验证码已下发",
		zap.String("target", maskTarget(target)),
		zap.String("channel", "smtp"))
	return nil
}

// dial 建立到 SMTP 服务器的连接，按 implicit 选择隐式 TLS 或 STARTTLS。
//
// 超时必须显式设：标准库的 smtp.Dial 没有超时，服务商限流时会把发码请求
// 一起拖死，而发码是同步接口，用户那边就是一直转圈。
func (s *SMTPSender) dial(ctx context.Context) (*smtp.Client, error) {
	d := &net.Dialer{Timeout: 10 * time.Second}
	tlsCfg := &tls.Config{ServerName: s.host, MinVersion: tls.VersionTLS12}

	var conn net.Conn
	var err error
	if s.implicit {
		conn, err = tls.DialWithDialer(d, "tcp", s.addr, tlsCfg)
	} else {
		conn, err = d.DialContext(ctx, "tcp", s.addr)
	}
	if err != nil {
		return nil, fmt.Errorf("连接 %s 失败（云厂商常封 25 端口，请用 465/587）: %w", s.addr, err)
	}
	_ = conn.SetDeadline(time.Now().Add(20 * time.Second))

	client, err := smtp.NewClient(conn, s.host)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("smtp 握手失败: %w", err)
	}
	if !s.implicit {
		if err := client.StartTLS(tlsCfg); err != nil {
			_ = client.Close()
			// 不降级成明文：验证码在明文 SMTP 里是全链路可见的。
			return nil, fmt.Errorf("STARTTLS 失败（465 端口请改用隐式 TLS）: %w", err)
		}
	}
	return client, nil
}

// buildMessage 组装 RFC 5322 邮件。
//
// 三个头都不能省：Subject 含中文必须按 RFC 2047 编码，否则收件端是乱码；
// 缺 Date 与 Message-ID 会被明显加权判成垃圾邮件，而进了垃圾箱的表现
// 与「没发出去」完全一样。
func (s *SMTPSender) buildMessage(target, code string) string {
	domain := s.from
	if i := strings.LastIndex(s.from, "@"); i >= 0 {
		domain = s.from[i+1:]
	}
	msgID := fmt.Sprintf("<%d.%d@%s>", time.Now().UnixNano(), rand.Int63(), domain)

	var b strings.Builder
	b.WriteString("From: " + s.from + "\r\n")
	b.WriteString("To: " + target + "\r\n")
	b.WriteString("Subject: " + mime.QEncoding.Encode("utf-8", s.subject) + "\r\n")
	b.WriteString("Date: " + time.Now().Format(time.RFC1123Z) + "\r\n")
	b.WriteString("Message-ID: " + msgID + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/html; charset=UTF-8\r\n\r\n")
	b.WriteString(buildCodeHTML(code))
	return b.String()
}
