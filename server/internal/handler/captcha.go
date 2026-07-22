package handler

import (
	"context"
	"fmt"
	"math/rand/v2"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

// CaptchaHandler handles CAPTCHA generation and verification.
type CaptchaHandler struct {
	rdb *redis.Client
}

func NewCaptchaHandler(rdb *redis.Client) *CaptchaHandler {
	return &CaptchaHandler{rdb: rdb}
}

// Generate returns an SVG math CAPTCHA image and stores the answer in Redis.
//
//	@Summary		Generate CAPTCHA
//	@Description	Returns a math CAPTCHA as SVG image
//	@Tags			system
//	@Produce		svg
//	@Success		200	{string}	string	"SVG image"
//	@Router			/api/v1/captcha [get]
func (h *CaptchaHandler) Generate(c *gin.Context) {
	// 生成随机数学题：a op b = ?
	a := rand.IntN(20) + 1 // 1-20
	b := rand.IntN(20) + 1
	op := rand.IntN(2) // 0=加 1=减

	var question string
	var answer int
	if op == 0 {
		answer = a + b
		question = fmt.Sprintf("%d + %d = ?", a, b)
	} else {
		// 确保结果为正
		if a < b {
			a, b = b, a
		}
		answer = a - b
		question = fmt.Sprintf("%d - %d = ?", a, b)
	}

	// 存入 Redis，5 分钟有效
	id := fmt.Sprintf("captcha_%d", rand.IntN(1000000))
	ctx := context.Background()
	if err := h.rdb.Set(ctx, id, answer, 5*time.Minute).Err(); err != nil {
		c.String(http.StatusInternalServerError, "captcha generation failed")
		return
	}

	// 生成 SVG 图片
	svg := fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="56" viewBox="0 0 160 56">
  <rect width="160" height="56" rx="8" fill="#F0F7FF" stroke="#C2C8D3" stroke-width="1.5"/>
  <text x="80" y="36" text-anchor="middle" font-family="monospace" font-size="20" font-weight="bold" fill="#5B9BD5">%s</text>
  <line x1="15" y1="10" x2="50" y2="40" stroke="#7EC8E3" stroke-width="0.8" opacity="0.4"/>
  <line x1="120" y1="8" x2="145" y2="45" stroke="#7EC8E3" stroke-width="0.8" opacity="0.4"/>
  <circle cx="20" cy="45" r="2" fill="#A8CFFF" opacity="0.3"/>
  <circle cx="140" cy="15" r="3" fill="#A8CFFF" opacity="0.3"/>
</svg>`, question)

	c.Header("X-Captcha-ID", id)
	c.Header("Content-Type", "image/svg+xml")
	c.Header("Cache-Control", "no-cache")
	c.String(http.StatusOK, svg)
}

// VerifyRequest is the CAPTCHA validation request body.
type VerifyRequest struct {
	ID     string `json:"captcha_id" binding:"required"`
	Answer int    `json:"captcha_answer" binding:"required"`
}

// Validate checks a CAPTCHA answer against the stored value in Redis.
// Returns true if the answer is correct and removes the key (one-time use).
func (h *CaptchaHandler) Validate(ctx context.Context, id string, answer int) bool {
	val, err := h.rdb.Get(ctx, id).Int()
	if err != nil {
		return false
	}
	// 验证后立即删除，防止重复使用
	h.rdb.Del(ctx, id)
	return val == answer
}
