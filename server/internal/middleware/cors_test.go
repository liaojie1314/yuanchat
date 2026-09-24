package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// preflight 发一次浏览器风格的预检请求，返回响应记录器。
func preflight(t *testing.T, requestHeaders string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(CORS())
	r.GET("/x", func(c *gin.Context) { c.Status(http.StatusOK) })

	req := httptest.NewRequest(http.MethodOptions, "/x", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	req.Header.Set("Access-Control-Request-Method", http.MethodGet)
	if requestHeaders != "" {
		req.Header.Set("Access-Control-Request-Headers", requestHeaders)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// allowedHeaders 把 Access-Control-Allow-Headers 拆成小写集合，便于逐项断言。
func allowedHeaders(t *testing.T, w *httptest.ResponseRecorder) map[string]bool {
	t.Helper()
	set := map[string]bool{}
	for _, h := range strings.Split(w.Header().Get("Access-Control-Allow-Headers"), ",") {
		set[strings.ToLower(strings.TrimSpace(h))] = true
	}
	return set
}

// TestCORSAllowsFrontendCustomHeaders 钉住前端实际会发送的自定义请求头。
//
// 浏览器预检不接受通配符：Allow-Headers 里漏掉一个头，该请求就在 preflight 阶段
// 被浏览器自己拦死，服务端不会收到真实请求、日志里也看不到任何痕迹。
// X-Qr-Poll-Secret 曾因此让扫码轮询在真实浏览器里完全不通，而 handler 层单测
// （httptest 不做预检）与 MSW（在网络层之前拦截）都无法发现。
func TestCORSAllowsFrontendCustomHeaders(t *testing.T) {
	w := preflight(t, "authorization, x-qr-poll-secret")
	if w.Code != http.StatusNoContent {
		t.Fatalf("预检状态码 = %d, want 204", w.Code)
	}

	allowed := allowedHeaders(t, w)
	for _, want := range []string{
		"authorization",
		"content-type",
		"x-request-id",
		"x-qr-poll-secret",
	} {
		if !allowed[want] {
			t.Errorf("Allow-Headers 缺少 %q，该头的请求会在浏览器预检阶段被拦死；实际值 = %q",
				want, w.Header().Get("Access-Control-Allow-Headers"))
		}
	}
}

// TestCORSPreflightShortCircuits 预检必须直接以 204 结束，不落到业务 handler。
func TestCORSPreflightShortCircuits(t *testing.T) {
	gin.SetMode(gin.TestMode)
	reached := false
	r := gin.New()
	r.Use(CORS())
	r.GET("/x", func(c *gin.Context) {
		reached = true
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodOptions, "/x", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("状态码 = %d, want 204", w.Code)
	}
	if reached {
		t.Error("预检请求进入了业务 handler，应当在中间件里就被短路")
	}
}
