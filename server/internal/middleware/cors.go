package middleware

import (
	"net/http"
	"slices"

	"github.com/gin-gonic/gin"
)

// CORSOptions 跨域策略。
//
// AllowedOrigins 为生产环境允许读取响应的 Origin 白名单；IsProd 决定未配白名单时的兜底。
type CORSOptions struct {
	AllowedOrigins []string
	IsProd         bool
}

// corsAllowHeaders 预检放行的请求头。
//
// 必须逐个列出前端会发的自定义头：浏览器预检不接受通配，漏一个头会让该请求在
// preflight 阶段就被拦死，服务端日志里连请求都看不到（X-Qr-Poll-Secret 就是这么
// 被漏掉过一次：Go 单测走 httptest 不做预检，MSW 也在网络层之前拦截，
// 只有真浏览器打真后端才会暴露）。
const corsAllowHeaders = "Origin, Content-Type, Accept, Authorization, X-Request-ID, X-Qr-Poll-Secret"

// CORS 跨域中间件。
//
// 不再无条件回 `Access-Control-Allow-Origin: *`。`*` 配上「鉴权走 Authorization 头」
// 挡住了经典的跨站读取已登录数据（浏览器不带 cookie，攻击者站点也拿不到 token），
// 但**免鉴权端点**仍然敞着：任意网站都能借访客的浏览器与 IP 去打 `/auth/login`
// 并**读到响应**。请求本身 CORS 本来也拦不住（表单 POST / no-cors fetch 就能发），
// 「能读响应」才让撞库与账号枚举可行 —— 攻击者由此能判断哪一组密码对了，
// 而按 IP 的限流被摊薄到成千上万个访客 IP 上。故改为白名单回显。
//
// 三档行为与 WS 的 CheckOrigin 完全对齐（见 ws/handler.go），两处同一套语义：
//   - 开发环境：放行全部 Origin（本地端口多变，收紧只会把自己挡在门外）
//   - 生产 + 配了白名单：命中才回显该 Origin，未命中不发 ACAO 头（浏览器自行拦截）
//   - 生产 + 未配白名单：退回同源
//
// 回显而非通配时**必须**发 `Vary: Origin`：否则中间的 nginx / CDN 会把某一个
// Origin 的 ACAO 响应喂给另一个 Origin，白名单形同虚设，且会造成「有时能通、
// 有时被拦」这种最难查的间歇故障。
//
// 没有 Origin 头的请求（非浏览器客户端、curl、服务端互调）压根不走 CORS，
// 此处不发任何 ACAO 头并照常放行 —— 收紧 CORS 不该把这类调用一起掐死。
func CORS(opts CORSOptions) gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" {
			if allowed, wildcard := corsAllowOrigin(origin, c.Request.Host, opts); allowed {
				if wildcard {
					c.Header("Access-Control-Allow-Origin", "*")
				} else {
					c.Header("Access-Control-Allow-Origin", origin)
					c.Header("Vary", "Origin")
				}
			}
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			c.Header("Access-Control-Allow-Headers", corsAllowHeaders)
			c.Header("Access-Control-Expose-Headers", "Content-Length, X-Request-ID")
			c.Header("Access-Control-Max-Age", "86400")
		}

		if c.Request.Method == http.MethodOptions {
			// 预检一律 204：是否放行由上面有没有发 ACAO 头决定，不靠状态码表达。
			// 回 403 反而会让「这个 Origin 不在白名单」和「这个端点不存在」
			// 在前端看起来一模一样。
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

// corsAllowOrigin 判定某 Origin 可否读取响应。
//
// 返回 (是否放行, 是否以通配形式放行)。通配只出现在开发环境。
func corsAllowOrigin(origin, host string, opts CORSOptions) (allowed, wildcard bool) {
	if !opts.IsProd {
		return true, true
	}
	// 同 WS：一旦配了白名单就以白名单为准，不再回落同源。回落会让「漏配一个
	// Origin」表现成部分客户端静默失败，而页面和登录都正常，极难定位。
	if len(opts.AllowedOrigins) > 0 {
		return slices.Contains(opts.AllowedOrigins, origin), false
	}
	return origin == "https://"+host || origin == "http://"+host, false
}
