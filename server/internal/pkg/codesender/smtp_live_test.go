package codesender

import (
	"context"
	"os"
	"strconv"
	"strings"
	"testing"

	"go.uber.org/zap"
)

// TestSMTPLiveSend 真发一封验证码邮件，用来验证服务商侧也通。
//
// 默认跳过：CI 里不该依赖外部服务商，也不该把发信额度烧在每次推送上。
// 要跑就带上真实凭据（口令用授权码，不是邮箱登录密码）：
//
//	SMTP_HOST=smtp.qq.com SMTP_PORT=465 \
//	SMTP_USER=you@qq.com SMTP_PASSWORD=<16位授权码> \
//	SMTP_TO=a@x.com,b@y.com \
//	go test ./internal/pkg/codesender/ -run TestSMTPLiveSend -v
//
// 凭据只从环境变量读，不落代码也不落配置文件。
func TestSMTPLiveSend(t *testing.T) {
	host := os.Getenv("SMTP_HOST")
	user := os.Getenv("SMTP_USER")
	pass := os.Getenv("SMTP_PASSWORD")
	to := os.Getenv("SMTP_TO")
	if host == "" || user == "" || pass == "" || to == "" {
		t.Skip("未提供 SMTP_HOST/SMTP_USER/SMTP_PASSWORD/SMTP_TO，跳过实发测试")
	}

	port := 465
	if p := os.Getenv("SMTP_PORT"); p != "" {
		n, err := strconv.Atoi(p)
		if err != nil {
			t.Fatalf("SMTP_PORT 不是数字: %v", err)
		}
		port = n
	}

	logger, _ := zap.NewDevelopment()
	s := NewSMTPSender(host, port, user, pass, user, "元聊验证码（实发测试）", logger)

	for _, addr := range strings.Split(to, ",") {
		addr = strings.TrimSpace(addr)
		if addr == "" {
			continue
		}
		t.Run(addr, func(t *testing.T) {
			if err := s.Send(context.Background(), addr, "246813"); err != nil {
				t.Fatalf("发往 %s 失败: %v", addr, err)
			}
			t.Logf("已发往 %s", addr)
		})
	}
}
