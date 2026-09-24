package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/pkg/jwt"
	"github.com/yuanchat/server/internal/testutil"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// qrEnv 是扫码链路的端到端环境：真实 Setup + dev 库 + 进程内 redis。
type qrEnv struct {
	r   *gin.Engine
	db  *gorm.DB
	gen *jwt.Generator
}

// newQREnv 装配引擎与签发器，签发器与 Setup 内部共用同一份 JWT 配置。
func newQREnv(t *testing.T) *qrEnv {
	t.Helper()
	db := authTestDB(t)
	rdb, _ := testutil.NewRedis(t)
	cfg := authTestConfig()
	r, _ := Setup(db, rdb, nil, cfg, zap.NewNop(), &recordingSender{})
	gen := jwt.NewGenerator(cfg.JWT.Secret, cfg.JWT.AccessTokenTTL, cfg.JWT.RefreshTokenTTL)
	return &qrEnv{r: r, db: db, gen: gen}
}

// bearerFor 为指定用户签发可用的 access 令牌。
func (e *qrEnv) bearerFor(t *testing.T, user *model.User) string {
	t.Helper()
	pair, err := e.gen.GeneratePair(user.ID, "android", user.TokenVersion)
	if err != nil {
		t.Fatalf("generate pair: %v", err)
	}
	return pair.AccessToken
}

// newQRSession 建一个扫码会话，返回其一次性凭据与只交给发起端的轮询密钥。
func (e *qrEnv) newQRSession(t *testing.T, deviceID string) (string, string) {
	t.Helper()
	w := postJSON(e.r, "/api/v1/auth/qr/session", `{"device_id":"`+deviceID+`"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("session status = %d, want 200, body=%s", w.Code, w.Body.String())
	}
	var created struct {
		Data struct {
			QRToken    string `json:"qr_token"`
			QRPayload  string `json:"qr_payload"`
			ExpiresIn  int    `json:"expires_in"`
			PollSecret string `json:"poll_secret"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("解析 session 响应: %v", err)
	}
	if created.Data.QRToken == "" || created.Data.ExpiresIn != 120 {
		t.Fatalf("session 响应不合契约: %s", w.Body.String())
	}
	if created.Data.QRPayload != "yuanchat://login?t="+created.Data.QRToken {
		t.Fatalf("qr_payload = %q", created.Data.QRPayload)
	}
	if created.Data.PollSecret == "" {
		t.Fatalf("session 未返回 poll_secret: %s", w.Body.String())
	}
	// 密钥只回给发起端；进了二维码内容，绑定发起方就失效了
	if strings.Contains(created.Data.QRPayload, created.Data.PollSecret) {
		t.Fatalf("qr_payload 里出现了 poll_secret: %s", w.Body.String())
	}
	return created.Data.QRToken, created.Data.PollSecret
}

// postAuthed 发一个带 Bearer 令牌的 POST；token 为空表示匿名请求。
func postAuthed(r *gin.Engine, token, target string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, target, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// getPoll 发一次轮询请求；pollSecret 为空表示不带 X-Qr-Poll-Secret 请求头。
func getPoll(r *gin.Engine, qrToken, pollSecret string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/qr/"+qrToken, nil)
	if pollSecret != "" {
		req.Header.Set("X-Qr-Poll-Secret", pollSecret)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// TestQRLoginFlowLogsInScannedUser 扫码链路走完后，被扫端拿到的令牌真的能用。
//
// 这是本条链路的核心验收：此前 /qr-login 页面的二维码不编码任何内容，
// scanning / confirmed 两个状态是无路径可达的死代码。
func TestQRLoginFlowLogsInScannedUser(t *testing.T) {
	env := newQREnv(t)
	user := newResetUser(t, env.db, "Qrpass123")
	bearer := env.bearerFor(t, user)

	qrToken, pollSecret := env.newQRSession(t, "desktop")

	// 未被扫时只回 pending
	w := getPoll(env.r, qrToken, pollSecret)
	if w.Code != http.StatusOK {
		t.Fatalf("poll status = %d, want 200, body=%s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"status":"pending"`) {
		t.Fatalf("poll body = %s, want status pending", w.Body.String())
	}

	// 扫码端标记已扫，并拿回自己的身份用于确认页展示
	w = postAuthed(env.r, bearer, "/api/v1/auth/qr/"+qrToken+"/scan")
	if w.Code != http.StatusOK {
		t.Fatalf("scan status = %d, want 200, body=%s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"nickname":"`+user.Nickname+`"`) {
		t.Fatalf("scan body = %s, want nickname %q", w.Body.String(), user.Nickname)
	}

	// 已扫未确认时仍不得下发令牌
	w = getPoll(env.r, qrToken, pollSecret)
	if !strings.Contains(w.Body.String(), `"status":"scanned"`) {
		t.Fatalf("poll body = %s, want status scanned", w.Body.String())
	}
	if strings.Contains(w.Body.String(), "access_token") {
		t.Fatalf("scanned 阶段泄露了令牌: %s", w.Body.String())
	}

	// 确认授权
	w = postAuthed(env.r, bearer, "/api/v1/auth/qr/"+qrToken+"/confirm")
	if w.Code != http.StatusNoContent {
		t.Fatalf("confirm status = %d, want 204, body=%s", w.Code, w.Body.String())
	}
	if w.Body.Len() != 0 {
		t.Fatalf("204 不应带响应体，got %q", w.Body.String())
	}

	// 被扫端取走令牌
	w = getPoll(env.r, qrToken, pollSecret)
	if w.Code != http.StatusOK {
		t.Fatalf("poll status = %d, want 200, body=%s", w.Code, w.Body.String())
	}
	var polled struct {
		Data struct {
			Status    string `json:"status"`
			ExpiresIn int    `json:"expires_in"`
			Tokens    *struct {
				AccessToken  string `json:"access_token"`
				RefreshToken string `json:"refresh_token"`
				ExpiresIn    int64  `json:"expires_in"`
			} `json:"tokens"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &polled); err != nil {
		t.Fatalf("解析 poll 响应: %v", err)
	}
	if polled.Data.Status != "confirmed" || polled.Data.Tokens == nil {
		t.Fatalf("poll body = %s, want confirmed + tokens", w.Body.String())
	}

	// 换出的 access 令牌必须真的能访问鉴权端点，且身份是扫码端用户
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me", nil)
	req.Header.Set("Authorization", "Bearer "+polled.Data.Tokens.AccessToken)
	me := httptest.NewRecorder()
	env.r.ServeHTTP(me, req)
	if me.Code != http.StatusOK {
		t.Fatalf("用换出的令牌访问 /users/me status = %d, want 200, body=%s", me.Code, me.Body.String())
	}
	if !strings.Contains(me.Body.String(), user.ID.String()) {
		t.Fatalf("令牌身份不是扫码端用户: %s", me.Body.String())
	}

	// refresh 令牌同样可用：与登录同源的令牌对
	if w := postJSON(env.r, "/api/v1/auth/refresh",
		`{"refresh_token":"`+polled.Data.Tokens.RefreshToken+`"}`); w.Code != http.StatusOK {
		t.Fatalf("refresh status = %d, want 200, body=%s", w.Code, w.Body.String())
	}

	// 令牌只能取一次
	if w := getPoll(env.r, qrToken, pollSecret); w.Code != http.StatusNotFound {
		t.Fatalf("第二次轮询 status = %d, want 404, body=%s", w.Code, w.Body.String())
	}
}

// TestQRPollRequiresPollSecret 轮询必须带 X-Qr-Poll-Secret，缺了或错了都拿不到令牌。
//
// 这条守的是「公共场合拍到二维码的人抢先取走令牌」那个攻击：
// 他手上只有 qr_token，没有建会话时才回给发起端的密钥。
func TestQRPollRequiresPollSecret(t *testing.T) {
	env := newQREnv(t)
	user := newResetUser(t, env.db, "Qrpass123")
	bearer := env.bearerFor(t, user)
	qrToken, pollSecret := env.newQRSession(t, "web")

	// 缺密钥：连状态都不给
	w := getPoll(env.r, qrToken, "")
	if w.Code != http.StatusForbidden {
		t.Fatalf("缺密钥 status = %d, want 403, body=%s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "auth.qrFailed") {
		t.Fatalf("body = %s, want auth.qrFailed", w.Body.String())
	}

	if w := postAuthed(env.r, bearer, "/api/v1/auth/qr/"+qrToken+"/scan"); w.Code != http.StatusOK {
		t.Fatalf("scan status = %d, want 200, body=%s", w.Code, w.Body.String())
	}
	if w := postAuthed(env.r, bearer, "/api/v1/auth/qr/"+qrToken+"/confirm"); w.Code != http.StatusNoContent {
		t.Fatalf("confirm status = %d, want 204, body=%s", w.Code, w.Body.String())
	}

	// 已确认后仍然一样：错密钥拿不到令牌，也毁不掉令牌
	w = getPoll(env.r, qrToken, "wrong-poll-secret")
	if w.Code != http.StatusForbidden {
		t.Fatalf("错密钥 status = %d, want 403, body=%s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "access_token") {
		t.Fatalf("403 响应泄露了令牌: %s", w.Body.String())
	}
	w = getPoll(env.r, qrToken, "")
	if w.Code != http.StatusForbidden {
		t.Fatalf("缺密钥 status = %d, want 403, body=%s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "access_token") {
		t.Fatalf("403 响应泄露了令牌: %s", w.Body.String())
	}

	// 发起端持正确密钥仍能取走，且只有一次
	w = getPoll(env.r, qrToken, pollSecret)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "access_token") {
		t.Fatalf("持正确密钥 status = %d body = %s, want 200 + tokens", w.Code, w.Body.String())
	}
	if w := getPoll(env.r, qrToken, pollSecret); w.Code != http.StatusNotFound {
		t.Fatalf("第二次轮询 status = %d, want 404, body=%s", w.Code, w.Body.String())
	}
}

// TestQRScanRequiresAuth 扫码端两个端点都必须带 access 令牌。
//
// 少了鉴权，任何人拿到二维码里的 token 就能给自己授权登录别人的账号。
func TestQRScanRequiresAuth(t *testing.T) {
	env := newQREnv(t)
	qrToken, _ := env.newQRSession(t, "web")

	if w := postAuthed(env.r, "", "/api/v1/auth/qr/"+qrToken+"/scan"); w.Code != http.StatusUnauthorized {
		t.Fatalf("匿名 scan status = %d, want 401, body=%s", w.Code, w.Body.String())
	}
	if w := postAuthed(env.r, "", "/api/v1/auth/qr/"+qrToken+"/confirm"); w.Code != http.StatusUnauthorized {
		t.Fatalf("匿名 confirm status = %d, want 401, body=%s", w.Code, w.Body.String())
	}
}

// TestQRConfirmWithoutScanReturns409 跳过 scanned 直接确认是 409。
func TestQRConfirmWithoutScanReturns409(t *testing.T) {
	env := newQREnv(t)
	user := newResetUser(t, env.db, "Qrpass123")
	qrToken, _ := env.newQRSession(t, "web")

	w := postAuthed(env.r, env.bearerFor(t, user), "/api/v1/auth/qr/"+qrToken+"/confirm")
	if w.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409, body=%s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "auth.qrBadState") {
		t.Fatalf("body = %s, want auth.qrBadState", w.Body.String())
	}
}

// TestQRConfirmByAnotherUserReturns403 A 扫码、B 确认是 403。
func TestQRConfirmByAnotherUserReturns403(t *testing.T) {
	env := newQREnv(t)
	scanner := newResetUser(t, env.db, "Qrpass123")
	attacker := newResetUser(t, env.db, "Qrpass456")
	qrToken, _ := env.newQRSession(t, "web")

	if w := postAuthed(env.r, env.bearerFor(t, scanner),
		"/api/v1/auth/qr/"+qrToken+"/scan"); w.Code != http.StatusOK {
		t.Fatalf("scan status = %d, want 200, body=%s", w.Code, w.Body.String())
	}

	w := postAuthed(env.r, env.bearerFor(t, attacker), "/api/v1/auth/qr/"+qrToken+"/confirm")
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403, body=%s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "auth.qrWrongUser") {
		t.Fatalf("body = %s, want auth.qrWrongUser", w.Body.String())
	}
}

// TestQRBannedScannerReturns403 被封禁用户扫码得 403，且会话状态不动。
func TestQRBannedScannerReturns403(t *testing.T) {
	env := newQREnv(t)
	banned := newBannedUser(t, env.db)
	qrToken, pollSecret := env.newQRSession(t, "web")

	w := postAuthed(env.r, env.bearerFor(t, banned), "/api/v1/auth/qr/"+qrToken+"/scan")
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403, body=%s", w.Code, w.Body.String())
	}

	if w := getPoll(env.r, qrToken, pollSecret); !strings.Contains(w.Body.String(), `"status":"pending"`) {
		t.Fatalf("被封禁用户推进了状态: %s", w.Body.String())
	}
}

// TestQRCancelStopsFlowForScanner 扫码端取消后，被扫端轮询到 canceled，且授权再也换不出令牌。
func TestQRCancelStopsFlowForScanner(t *testing.T) {
	env := newQREnv(t)
	user := newResetUser(t, env.db, "Qrpass123")
	bearer := env.bearerFor(t, user)
	qrToken, pollSecret := env.newQRSession(t, "web")

	if w := postAuthed(env.r, bearer, "/api/v1/auth/qr/"+qrToken+"/scan"); w.Code != http.StatusOK {
		t.Fatalf("scan status = %d, want 200, body=%s", w.Code, w.Body.String())
	}

	w := postAuthed(env.r, bearer, "/api/v1/auth/qr/"+qrToken+"/cancel")
	if w.Code != http.StatusNoContent {
		t.Fatalf("cancel status = %d, want 204, body=%s", w.Code, w.Body.String())
	}
	if w.Body.Len() != 0 {
		t.Fatalf("204 不应带响应体，got %q", w.Body.String())
	}

	// 被扫端必须能看到 canceled：这是它得知「手机上按了取消」的唯一途径
	w = getPoll(env.r, qrToken, pollSecret)
	if w.Code != http.StatusOK {
		t.Fatalf("poll status = %d, want 200, body=%s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"status":"canceled"`) {
		t.Fatalf("poll body = %s, want status canceled", w.Body.String())
	}
	if strings.Contains(w.Body.String(), "access_token") {
		t.Fatalf("canceled 响应泄露了令牌: %s", w.Body.String())
	}

	// canceled 是终态：取消后再确认必须 409，否则用户按下的取消形同虚设
	if w := postAuthed(env.r, bearer, "/api/v1/auth/qr/"+qrToken+"/confirm"); w.Code != http.StatusConflict {
		t.Fatalf("取消后 confirm status = %d, want 409, body=%s", w.Code, w.Body.String())
	}
}

// TestQRCancelRequiresScannerIdentity 取消端点必须带 Bearer，且只有扫码的那个账号能取消。
//
// 少了这两道校验，任何拿到二维码的人都能把别人正在进行的登录会话废掉。
func TestQRCancelRequiresScannerIdentity(t *testing.T) {
	env := newQREnv(t)
	scanner := newResetUser(t, env.db, "Qrpass123")
	attacker := newResetUser(t, env.db, "Qrpass456")
	qrToken, pollSecret := env.newQRSession(t, "web")

	if w := postAuthed(env.r, "", "/api/v1/auth/qr/"+qrToken+"/cancel"); w.Code != http.StatusUnauthorized {
		t.Fatalf("匿名 cancel status = %d, want 401, body=%s", w.Code, w.Body.String())
	}
	// 尚未被扫的会话没有扫码端，取消无从谈起
	if w := postAuthed(env.r, env.bearerFor(t, scanner),
		"/api/v1/auth/qr/"+qrToken+"/cancel"); w.Code != http.StatusConflict {
		t.Fatalf("pending 阶段 cancel status = %d, want 409, body=%s", w.Code, w.Body.String())
	}

	if w := postAuthed(env.r, env.bearerFor(t, scanner),
		"/api/v1/auth/qr/"+qrToken+"/scan"); w.Code != http.StatusOK {
		t.Fatalf("scan status = %d, want 200, body=%s", w.Code, w.Body.String())
	}

	w := postAuthed(env.r, env.bearerFor(t, attacker), "/api/v1/auth/qr/"+qrToken+"/cancel")
	if w.Code != http.StatusForbidden {
		t.Fatalf("他人 cancel status = %d, want 403, body=%s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "auth.qrWrongUser") {
		t.Fatalf("body = %s, want auth.qrWrongUser", w.Body.String())
	}
	// 外人的取消不得改动状态：扫码者本人仍能正常确认
	if w := getPoll(env.r, qrToken, pollSecret); !strings.Contains(w.Body.String(), `"status":"scanned"`) {
		t.Fatalf("外人取消改动了状态: %s", w.Body.String())
	}
	if w := postAuthed(env.r, env.bearerFor(t, scanner),
		"/api/v1/auth/qr/"+qrToken+"/confirm"); w.Code != http.StatusNoContent {
		t.Fatalf("confirm status = %d, want 204, body=%s", w.Code, w.Body.String())
	}
}
