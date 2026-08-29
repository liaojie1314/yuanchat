package router

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/config"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/pkg/jwt"
	"github.com/yuanchat/server/internal/pkg/password"
	"github.com/yuanchat/server/internal/testutil"
	"go.uber.org/zap"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
	"gorm.io/gorm/schema"
)

// recordingSender 是验证码下发通道的测试替身：只把码记下来，不真的发。
//
// 用例据此断言「码确实被下发」并拿到明文码继续走后续步骤，
// 这是唯一不靠猜数字就能跑通三段式链路的办法。
type recordingSender struct {
	mu     sync.Mutex
	calls  int
	target string
	code   string
}

func (s *recordingSender) Send(_ context.Context, target, code string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	s.target, s.code = target, code
	return nil
}

// last 返回下发次数与最近一次的目标、验证码。
func (s *recordingSender) last() (int, string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls, s.target, s.code
}

// postJSON 向引擎发一个 JSON 请求，返回响应记录器。
func postJSON(r *gin.Engine, target string, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, target, bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// authTestConfig 仅够让 Setup 跑通接线的最小配置（不含 DB / Redis / MinIO）。
func authTestConfig() *config.Config {
	cfg := &config.Config{}
	cfg.Server.Env = "test"
	cfg.JWT.Secret = "test-secret-for-routing-only"
	cfg.JWT.AccessTokenTTL = time.Hour
	cfg.JWT.RefreshTokenTTL = time.Hour
	cfg.WebSocket.MaxConnectionsPerUser = 1
	cfg.Presence.Backend = "local"
	return cfg
}

// authTestEngine 走真实 Setup 装配引擎，并返回一个可用的 access 令牌。
//
// 与 TestA7RoutesRegistered 同因：Setup 内不做 DB/网络调用，db/rdb/storage 传 nil 即可；
// 用真实引擎而非复刻路由表，才能同时覆盖「路由已注册」与「中间件链正确」。
func authTestEngine(t *testing.T) (*gin.Engine, string) {
	t.Helper()
	cfg := authTestConfig()
	r, _ := Setup(nil, nil, nil, cfg, zap.NewNop(), &recordingSender{})

	gen := jwt.NewGenerator(cfg.JWT.Secret, cfg.JWT.AccessTokenTTL, cfg.JWT.RefreshTokenTTL)
	pair, err := gen.GeneratePair(uuid.New(), "web", 0)
	if err != nil {
		t.Fatalf("generate pair: %v", err)
	}
	return r, pair.AccessToken
}

// doLogout 发一次 POST /api/v1/auth/logout；token 为空表示匿名请求。
func doLogout(r *gin.Engine, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// authTestDB 连接本地开发库（deploy/docker-compose.yml 的 postgres :5434），
// 不可达时跳过集成用例。范式同 internal/service 的 testDB。
func authTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := "host=localhost port=5434 user=yuanchat password=yuanchat_dev dbname=yuanchat sslmode=disable"
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
		NamingStrategy: schema.NamingStrategy{
			SingularTable: true,
		},
		SkipDefaultTransaction: true,
	})
	if err != nil {
		t.Skipf("dev postgres unavailable, skip integration test: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil || sqlDB.Ping() != nil {
		t.Skip("dev postgres unavailable, skip integration test")
	}
	return db
}

// newBannedUser 建一个被封禁的一次性用户，用后删除。
func newBannedUser(t *testing.T, db *gorm.DB) *model.User {
	t.Helper()
	phone := fmt.Sprintf("198%08d", time.Now().UnixNano()%100000000)
	user := &model.User{
		ID:           uuid.New(),
		Phone:        &phone,
		PasswordHash: "x",
		ShortID:      time.Now().UnixNano() % 1_000_000_000,
		Nickname:     "banned-refresh",
		Status:       model.UserStatusDisabled,
	}
	if err := db.Create(user).Error; err != nil {
		t.Fatalf("create banned user: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(user) })
	return user
}

// TestRefreshBannedUserReturns403 被封禁用户续期必须是 403，不能是 500。
//
// 500 会被前端 client.ts 的 doFetch 当成服务端故障上报异常通道，
// 且客户端无法区分「账号被封」与「服务器坏了」。
func TestRefreshBannedUserReturns403(t *testing.T) {
	db := authTestDB(t)
	cfg := authTestConfig()
	r, _ := Setup(db, nil, nil, cfg, zap.NewNop(), &recordingSender{})

	user := newBannedUser(t, db)
	gen := jwt.NewGenerator(cfg.JWT.Secret, cfg.JWT.AccessTokenTTL, cfg.JWT.RefreshTokenTTL)
	pair, err := gen.GeneratePair(user.ID, "web", user.TokenVersion)
	if err != nil {
		t.Fatalf("generate pair: %v", err)
	}

	body := strings.NewReader(`{"refresh_token":"` + pair.RefreshToken + `"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403, body=%s", w.Code, w.Body.String())
	}
}

// newResetUser 建一个已知明文密码的一次性用户，用后删除。
func newResetUser(t *testing.T, db *gorm.DB, plain string) *model.User {
	t.Helper()
	hash, err := password.Hash(plain)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	phone := fmt.Sprintf("197%08d", time.Now().UnixNano()%100000000)
	user := &model.User{
		ID:           uuid.New(),
		Phone:        &phone,
		PasswordHash: hash,
		ShortID:      time.Now().UnixNano() % 1_000_000_000,
		Nickname:     "reset-flow",
		Status:       model.UserStatusNormal,
	}
	if err := db.Create(user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() {
		db.Exec("DELETE FROM verification_codes WHERE target = ?", phone)
		db.Unscoped().Delete(user)
	})
	return user
}

// TestForgotPasswordFlowChangesPassword 三段式链路走完后，新密码能登录、旧密码不能。
//
// 这是本条链路的核心验收：此前三个 handler 都是前端 setTimeout 假实现，
// 走完显示「重置成功」而密码根本没动。
func TestForgotPasswordFlowChangesPassword(t *testing.T) {
	const oldPassword = "Oldpass123"
	const newPassword = "Newpass456"

	db := authTestDB(t)
	rdb, _ := testutil.NewRedis(t)
	sender := &recordingSender{}
	cfg := authTestConfig()
	r, _ := Setup(db, rdb, nil, cfg, zap.NewNop(), sender)

	user := newResetUser(t, db, oldPassword)
	phone := *user.Phone

	// 第一段：发码
	if w := postJSON(r, "/api/v1/auth/password/otp", `{"phone":"`+phone+`"}`); w.Code != http.StatusNoContent {
		t.Fatalf("otp status = %d, want 204, body=%s", w.Code, w.Body.String())
	}
	calls, target, code := sender.last()
	if calls != 1 || target != phone {
		t.Fatalf("下发记录 = (%d, %q), want (1, %q)", calls, target, phone)
	}
	if len(code) != 6 {
		t.Fatalf("验证码 = %q, 期望 6 位", code)
	}

	// 第二段：校验换票
	w := postJSON(r, "/api/v1/auth/password/verify", `{"phone":"`+phone+`","code":"`+code+`"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("verify status = %d, want 200, body=%s", w.Code, w.Body.String())
	}
	var verified struct {
		Data struct {
			ResetTicket string `json:"reset_ticket"`
			ExpiresIn   int    `json:"expires_in"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &verified); err != nil {
		t.Fatalf("解析 verify 响应: %v", err)
	}
	if verified.Data.ResetTicket == "" {
		t.Fatal("verify 未返回 reset_ticket")
	}
	if verified.Data.ExpiresIn != 300 {
		t.Fatalf("expires_in = %d, want 300", verified.Data.ExpiresIn)
	}

	// 第三段：改密
	body := `{"reset_ticket":"` + verified.Data.ResetTicket + `","new_password":"` + newPassword + `"}`
	if w := postJSON(r, "/api/v1/auth/password/reset", body); w.Code != http.StatusNoContent {
		t.Fatalf("reset status = %d, want 204, body=%s", w.Code, w.Body.String())
	}

	// 旧密码必须失效，否则「重置成功」依旧是假的
	if w := postJSON(r, "/api/v1/users/login", `{"account":"`+phone+`","password":"`+oldPassword+`"}`); w.Code != http.StatusUnauthorized {
		t.Fatalf("旧密码登录 status = %d, want 401, body=%s", w.Code, w.Body.String())
	}
	if w := postJSON(r, "/api/v1/users/login", `{"account":"`+phone+`","password":"`+newPassword+`"}`); w.Code != http.StatusOK {
		t.Fatalf("新密码登录 status = %d, want 200, body=%s", w.Code, w.Body.String())
	}
}

// TestForgotPasswordOtpUnknownPhoneReturns204 未注册手机号也返回 204 且不下发，
// 否则该端点就成了「这个号码注册过没有」的枚举器。
func TestForgotPasswordOtpUnknownPhoneReturns204(t *testing.T) {
	db := authTestDB(t)
	rdb, _ := testutil.NewRedis(t)
	sender := &recordingSender{}
	cfg := authTestConfig()
	r, _ := Setup(db, rdb, nil, cfg, zap.NewNop(), sender)

	w := postJSON(r, "/api/v1/auth/password/otp", `{"phone":"19900000000"}`)
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204, body=%s", w.Code, w.Body.String())
	}
	if w.Body.Len() != 0 {
		t.Fatalf("204 不应带响应体，got %q", w.Body.String())
	}
	if calls, _, _ := sender.last(); calls != 0 {
		t.Fatalf("下发次数 = %d, 未注册手机号不应下发", calls)
	}
}

// TestLogoutReturns204 带合法 access 令牌登出 → 204 且响应体为空。
func TestLogoutReturns204(t *testing.T) {
	r, token := authTestEngine(t)

	w := doLogout(r, token)
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204, body=%s", w.Code, w.Body.String())
	}
	if w.Body.Len() != 0 {
		t.Fatalf("204 不应带响应体，got %q", w.Body.String())
	}
}

// TestLogoutRequiresAuth 匿名请求 → 401（端点挂在 AuthRequired 之后）。
func TestLogoutRequiresAuth(t *testing.T) {
	r, _ := authTestEngine(t)

	w := doLogout(r, "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401, body=%s", w.Code, w.Body.String())
	}
}

// TestLoginLocksAccountAfterFiveFailures 同一账号连错 5 次后，
// 第 6 次即使密码正确也必须是 429 + auth.accountLocked。
//
// 这是账号级锁定的端到端契约：middleware.LimitByIP 只按 IP 计数且是进程内的，
// 攻击者换 IP 即可对同一账号无限撞密码，这条用例守的正是那个洞。
func TestLoginLocksAccountAfterFiveFailures(t *testing.T) {
	const goodPassword = "Lockpass123"
	const badPassword = "Wrongpass99"

	db := authTestDB(t)
	rdb, _ := testutil.NewRedis(t)
	cfg := authTestConfig()
	r, _ := Setup(db, rdb, nil, cfg, zap.NewNop(), &recordingSender{})

	user := newResetUser(t, db, goodPassword)
	phone := *user.Phone

	for i := 0; i < 5; i++ {
		w := postJSON(r, "/api/v1/users/login", `{"account":"`+phone+`","password":"`+badPassword+`"}`)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("第 %d 次错误密码 status = %d, want 401, body=%s", i+1, w.Code, w.Body.String())
		}
	}

	w := postJSON(r, "/api/v1/users/login", `{"account":"`+phone+`","password":"`+goodPassword+`"}`)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("锁定后 status = %d, want 429, body=%s", w.Code, w.Body.String())
	}
	var locked struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &locked); err != nil {
		t.Fatalf("解析锁定响应: %v", err)
	}
	// 前端按 message 里的 i18n key 出文案（错误码走 message 不走 code）
	if locked.Message != "auth.accountLocked" {
		t.Fatalf("message = %q, want auth.accountLocked", locked.Message)
	}
}
