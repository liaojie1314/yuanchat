package router

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/config"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/pkg/jwt"
	"go.uber.org/zap"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
	"gorm.io/gorm/schema"
)

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
	r, _ := Setup(nil, nil, nil, cfg, zap.NewNop())

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
	r, _ := Setup(db, nil, nil, cfg, zap.NewNop())

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
