package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// devCORS 开发环境策略（原行为：放行全部 Origin）。
var devCORS = CORSOptions{IsProd: false}

// preflight 发一次浏览器风格的预检请求，返回响应记录器。
func preflight(t *testing.T, requestHeaders string) *httptest.ResponseRecorder {
	t.Helper()
	return request(t, devCORS, http.MethodOptions, "http://localhost:5173", requestHeaders, nil)
}

// request 以给定策略跑一次请求。reached 非 nil 时在业务 handler 里置为 true，
// 用于验证预检被短路。host 固定 example.com，便于断言「退回同源」那一档。
func request(
	t *testing.T,
	opts CORSOptions,
	method, origin, requestHeaders string,
	reached *bool,
) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(CORS(opts))
	r.GET("/x", func(c *gin.Context) {
		if reached != nil {
			*reached = true
		}
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(method, "http://example.com/x", nil)
	req.Host = "example.com"
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if method == http.MethodOptions {
		req.Header.Set("Access-Control-Request-Method", http.MethodGet)
	}
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
	reached := false
	w := request(t, devCORS, http.MethodOptions, "http://localhost:5173", "", &reached)

	if w.Code != http.StatusNoContent {
		t.Errorf("状态码 = %d, want 204", w.Code)
	}
	if reached {
		t.Error("预检请求进入了业务 handler，应当在中间件里就被短路")
	}
}

// prodCORS 生产策略，白名单取真实部署的那一组取值。
func prodCORS(origins ...string) CORSOptions {
	return CORSOptions{AllowedOrigins: origins, IsProd: true}
}

// acao 取响应里的 Access-Control-Allow-Origin。
func acao(w *httptest.ResponseRecorder) string {
	return w.Header().Get("Access-Control-Allow-Origin")
}

// TestCORSProdWhitelistReflectsOnlyListedOrigins 生产环境只回显白名单内的 Origin。
//
// 这是本中间件存在的理由。此前无条件回 `*`：鉴权走 Authorization 头，攻击者站点
// 拿不到 token，所以读不到已登录数据；但**免鉴权端点**敞着 —— 任意网站都能借访客的
// 浏览器与 IP 去打 /auth/login 并**读到响应**，由此判断哪组密码对了，
// 而按 IP 的限流被摊薄到成千上万个访客 IP 上。
func TestCORSProdWhitelistReflectsOnlyListedOrigins(t *testing.T) {
	opts := prodCORS("https://chat.example.com", "tauri://localhost")

	for _, origin := range []string{"https://chat.example.com", "tauri://localhost"} {
		w := request(t, opts, http.MethodGet, origin, "", nil)
		if got := acao(w); got != origin {
			t.Errorf("白名单内 Origin %q 的 ACAO = %q, want 原样回显", origin, got)
		}
		// 回显必须带 Vary: Origin，否则 nginx/CDN 会把一个 Origin 的响应
		// 喂给另一个 Origin —— 白名单形同虚设，且表现为间歇性故障
		if w.Header().Get("Vary") != "Origin" {
			t.Errorf("Origin %q 回显了却没发 Vary: Origin，缓存会跨 Origin 串响应", origin)
		}
	}

	// 不在白名单：绝不能回 ACAO（含不能回 `*`），否则浏览器照样放行读取
	evil := request(t, opts, http.MethodGet, "https://evil.example.com", "", nil)
	if got := acao(evil); got != "" {
		t.Errorf("白名单外 Origin 的 ACAO = %q, want 空（不发该头）", got)
	}
}

// TestCORSProdNeverWildcards 生产环境在任何情况下都不得回 `*`。
func TestCORSProdNeverWildcards(t *testing.T) {
	cases := map[string]CORSOptions{
		"配了白名单":  prodCORS("https://chat.example.com"),
		"未配白名单": prodCORS(),
	}
	for name, opts := range cases {
		t.Run(name, func(t *testing.T) {
			for _, origin := range []string{
				"https://chat.example.com",
				"https://evil.example.com",
				"http://example.com",
				"https://example.com",
			} {
				if got := acao(request(t, opts, http.MethodGet, origin, "", nil)); got == "*" {
					t.Errorf("Origin %q 换到了通配 ACAO，生产环境绝不允许", origin)
				}
			}
		})
	}
}

// TestCORSProdFallsBackToSameOrigin 生产环境未配白名单时退回同源。
//
// 不是「一律放行」也不是「一律拒绝」：同源部署（app 与 api 同域）必须还能用，
// 否则升级这个中间件会把那类部署直接打死。
func TestCORSProdFallsBackToSameOrigin(t *testing.T) {
	opts := prodCORS() // 空白名单
	for _, origin := range []string{"https://example.com", "http://example.com"} {
		if got := acao(request(t, opts, http.MethodGet, origin, "", nil)); got != origin {
			t.Errorf("同源 Origin %q 的 ACAO = %q, want 原样回显", origin, got)
		}
	}
	if got := acao(request(t, opts, http.MethodGet, "https://other.example.com", "", nil)); got != "" {
		t.Errorf("异源 Origin 的 ACAO = %q, want 空", got)
	}
}

// TestCORSWhitelistWinsOverSameOrigin 配了白名单就以白名单为准，不再回落同源。
//
// 与 ws.CheckOrigin 同一取舍：回落会让「漏配一个 Origin」表现成部分客户端静默失败，
// 而页面和登录都正常，极难定位。
func TestCORSWhitelistWinsOverSameOrigin(t *testing.T) {
	opts := prodCORS("https://chat.example.com")
	// example.com 是本次请求的 Host，但不在白名单里 —— 必须被拒
	if got := acao(request(t, opts, http.MethodGet, "https://example.com", "", nil)); got != "" {
		t.Errorf("白名单已配时同源仍被放行（ACAO = %q），白名单就不是唯一真源了", got)
	}
}

// TestCORSNoOriginHeaderPassesThrough 没有 Origin 头的请求照常放行且不发 ACAO。
//
// 非浏览器客户端、curl、服务端互调压根不走 CORS；收紧 CORS 不该把这类调用掐死。
func TestCORSNoOriginHeaderPassesThrough(t *testing.T) {
	reached := false
	w := request(t, prodCORS("https://chat.example.com"), http.MethodGet, "", "", &reached)
	if w.Code != http.StatusOK {
		t.Errorf("无 Origin 的请求状态码 = %d, want 200", w.Code)
	}
	if !reached {
		t.Error("无 Origin 的请求没进业务 handler，非浏览器客户端会被 CORS 收紧误杀")
	}
	if got := acao(w); got != "" {
		t.Errorf("无 Origin 却发了 ACAO = %q", got)
	}
}

// TestCORSNeverAllowsCredentials 任何档位都不得发 Allow-Credentials。
//
// 鉴权走 Authorization 头，不需要它；发了它就把「回显 Origin」从
// 「能读公开响应」升级成「能带着受害者的 cookie 读已登录响应」。
func TestCORSNeverAllowsCredentials(t *testing.T) {
	for _, opts := range []CORSOptions{devCORS, prodCORS("https://chat.example.com"), prodCORS()} {
		w := request(t, opts, http.MethodGet, "https://chat.example.com", "", nil)
		if got := w.Header().Get("Access-Control-Allow-Credentials"); got != "" {
			t.Errorf("发了 Access-Control-Allow-Credentials = %q", got)
		}
	}
}

// TestCORSDevAllowsAnyOrigin 开发环境放行全部 Origin（本地端口多变）。
func TestCORSDevAllowsAnyOrigin(t *testing.T) {
	if got := acao(request(t, devCORS, http.MethodGet, "http://localhost:5173", "", nil)); got != "*" {
		t.Errorf("开发环境 ACAO = %q, want *", got)
	}
}
