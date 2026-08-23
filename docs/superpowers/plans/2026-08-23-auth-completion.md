# auth 补全与安全加固 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/forgot-password` 与 `/qr-login` 两条只有前端假实现的链路做成真链路，并补齐 P0 级账号安全防护。

**Architecture:** 后端在既有单体 Go 服务内新增 `auth/password/*` 三段式改密端点与 `auth/qr/*` 四端点，OTP 与扫码会话状态放 Redis（`verification_codes` 表仅留审计），验证码下发抽象为 `CodeSender` provider；会话吊销靠 `users.token_version` + JWT `tv` 声明，只在 refresh 与 WS 建连两处校验以避免给每个请求增加查库。前端把 web/desktop 各自重复的 4 个 auth 页下沉到 `packages/ui`，端差异用 slot prop 注入，断点在组件内部推导。

**Tech Stack:** Go 1.25 / Gin / GORM / goose / go-redis v9 / miniredis（新增测试依赖）/ React 19 / TypeScript / Vite / Tailwind / Zustand v5 / react-i18next / Playwright / MSW / Tauri 2

**Spec:** [`docs/superpowers/specs/2026-08-23-auth-completion-design.md`](../specs/2026-08-23-auth-completion-design.md)

**真源提示：** 范围与「未做项」的唯一依据是 `docs/MASTER_PLAN.md`。本计划只承担执行细节；执行前先读 MASTER_PLAN 复核范围。

## Global Constraints

- **分支**：基线 `dev`。从 `dev` 切 `feature/auth-completion`；完成后 `git merge --no-ff` 回 `dev`。**禁止直接提交 `dev` / `main`**；dev → main 需当次征询用户同意。
- **前置**：先把 `feature/plan-refresh` `--no-ff` 合入 `dev`，否则新分支上没有本计划与 spec。
- **Commit**：Conventional Commits，**禁止版本号前缀**（不写 `feat(v0.6/A8):`）。完整功能做完再提交，禁止逐点提交（本计划每个 Task 末尾的 commit 即一个完整可测单元）。
- **迁移号**：本批次占用 **014**，文件 `server/internal/database/migrations/014_auth_token_version.sql`。H1b 用 015。
- **i18n**：UI 文案禁止硬编码，全部走 `t()`。locale 文件在 `packages/design-system/src/i18n/locales/{zh-CN,en-US,ja-JP,ko-KR}.json`，**四份必须与代码同一 commit 同步补齐**（`pnpm check:i18n` 校验四份的 key 集合与占位符集合一致；不校验行序）。
- **UI 圆角**：上限 `rounded-lg`（8px），禁止 `rounded-xl` / `rounded-2xl`；`rounded-full` 仅用于圆形元素。
- **浏览器兼容**：`build.target=es2019`（旧 Android WebView / Chrome 74）。新增前端依赖必须确认产物不含 `?.` / `??` / 顶层 await。
- **依赖声明**：app / package 内 `import` 的包必须在**该** `package.json` 显式声明（pnpm 本地提升会掩盖幽灵依赖，CI 会挂）。
- **Tauri 权限**：权限名**禁止猜测**，必须查官方 permissions 表并按平台校验；桌面专属权限进 `desktop.json`，Android 专属权限进 Android 平台限定 capability，**不进 `default.json`**。
- **禁止执行 `tauri android init`**：会重新生成 `gen/android/` 并摧毁 `MainActivity.kt` 的软键盘 WindowInsets 适配。Manifest 只能手工编辑。
- **注释**：只能中文，且**禁止写进度性/批次性描述**（不写「本次」「第几批」）。导出的 Go 函数写 godoc，导出的 TS 写 JSDoc。
- **`packages/ui` 组件禁止接收 `isDesktop` / `isMobile` prop**：断点在组件内部用 `useBreakpoint()` 推导（既有范式：`SettingsScreen.tsx:56`、`ChatScreen.tsx:227`、`ContactsScreen.tsx:107`、`MainLayout.tsx:92`）。端差异只能通过 slot prop 注入。
- **不要照抄 `internal/handler/captcha.go`**：它有三个已知缺陷——`:83-90` 先删再比（输错即废码）、`:52` 用 `math/rand/v2` 的 `rand.IntN` 生成标识（碰撞 + 非加密安全）、Redis key 无命名空间。本批次一律 `crypto/rand` + 带 `auth:` 前缀的 key + 比较正确才删。

### 常用命令

```bash
# 后端单个用例
cd server && go test ./internal/handler/ -run TestPasswordOTP -v
# 后端全量（不依赖 postgres 的用例会自动 skip）
cd server && go test ./...
# 前端门禁（lint + format + stylelint + i18n + theme）
pnpm check
pnpm check:i18n
# packages/ui 组件测试
pnpm --filter @yuanchat/ui test
# E2E
cd apps/web && pnpm test:e2e
# 本地打包验证（推 tag / CI 前必做）
pnpm build:pkg
```

## File Structure

**后端新增**

| 路径                                                             | 职责                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `server/internal/database/migrations/014_auth_token_version.sql` | `users.token_version` 列                                                              |
| `server/internal/pkg/codesender/codesender.go`                   | `Sender` 接口 + `LogSender`                                                           |
| `server/internal/service/password_reset_service.go`              | OTP 生成/校验/改密，含 ticket 换发                                                    |
| `server/internal/service/qr_login_service.go`                    | 扫码会话状态机                                                                        |
| `server/internal/handler/password_reset.go`                      | `POST /auth/password/{otp,verify,reset}`                                              |
| `server/internal/handler/qr_login.go`                            | `POST /auth/qr/session`、`GET /auth/qr/:token`、`POST /auth/qr/:token/{scan,confirm}` |
| `server/internal/handler/testutil_test.go`                       | `newTestRedis(t)` miniredis 夹具                                                      |

**后端修改**

| 路径                                      | 改动                                                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `server/internal/pkg/jwt/jwt.go:16`       | `Claims` 加 `TokenVersion`；`GeneratePair` 签名加参数                                                |
| `server/internal/model/user.go`           | `User` 加 `TokenVersion int`                                                                         |
| `server/internal/service/user_service.go` | `Refresh` 补 banned + `token_version` 校验；`Login` 写 `last_login_at`；密码复杂度校验；登录失败锁定 |
| `server/internal/ws/handler.go`           | `ServeWS` 加 `token_version` 校验                                                                    |
| `server/internal/router/router.go`        | 注册 8 条新路由 + `/auth/logout`                                                                     |
| `server/config/config.yaml` / `config.go` | `codesender.provider`                                                                                |

**前端新增**

| 路径                                            | 职责                                  |
| ----------------------------------------------- | ------------------------------------- |
| `packages/ui/src/auth/AuthShell.tsx`            | 背景装饰 + 磨砂卡片 + `titleBar` slot |
| `packages/ui/src/auth/LoginScreen.tsx`          | 登录                                  |
| `packages/ui/src/auth/RegisterScreen.tsx`       | 注册（含确认密码 + 协议勾选）         |
| `packages/ui/src/auth/ForgotPasswordScreen.tsx` | 三步改密（接真实接口）                |
| `packages/ui/src/auth/QrLoginScreen.tsx`        | 真二维码 + 轮询                       |
| `packages/shared/src/api/auth.ts`               | 7 个新端点的客户端函数                |
| `apps/desktop/src/native/scanner.ts`            | `scanQrCode(): Promise<string>`       |
| `apps/web/e2e/forgot-password.spec.ts`          | E2E                                   |
| `apps/web/e2e/qr-login.spec.ts`                 | E2E                                   |

**前端收敛为薄壳**：`apps/{web,desktop}/src/pages/{Login,Register,ForgotPassword,QrLogin}Page.tsx` 共 8 个文件、当前 1657 行 → 每个 4-8 行。

---

## Task 1: miniredis 测试夹具

`internal/handler` 包目前没有 Redis 测试辅助，涉及 Redis 的用例是 `t.Skipf` 跳过的。后续所有 OTP / 扫码用例都依赖它，所以先建。只建最小可用夹具，完整的 `internal/testutil/` 基建属批次 B8，本批次只借道。

**Files:**

- Create: `server/internal/handler/testutil_test.go`
- Modify: `server/go.mod`（新增 `github.com/alicebob/miniredis/v2`）

**Interfaces:**

- Consumes: 无
- Produces: `func newTestRedis(t *testing.T) *redis.Client` — 包内测试可用，返回连向进程内 miniredis 的客户端，`t.Cleanup` 自动关闭

- [ ] **Step 1: 加依赖**

```bash
cd server && go get github.com/alicebob/miniredis/v2@latest && go mod tidy
```

- [ ] **Step 2: 写失败测试**

`server/internal/handler/testutil_test.go`：

```go
package handler

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

// newTestRedis 启动进程内 miniredis 并返回连向它的客户端。
// 测试结束自动关闭连接与实例，避免 handler 包的 Redis 用例继续被跳过。
func newTestRedis(t *testing.T) *redis.Client {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return rdb
}

func TestNewTestRedis(t *testing.T) {
	rdb := newTestRedis(t)
	ctx := context.Background()
	if err := rdb.Set(ctx, "auth:probe", "1", 0).Err(); err != nil {
		t.Fatalf("set: %v", err)
	}
	got, err := rdb.Get(ctx, "auth:probe").Result()
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got != "1" {
		t.Fatalf("got %q, want %q", got, "1")
	}
}
```

- [ ] **Step 3: 跑测试确认通过**

```bash
cd server && go test ./internal/handler/ -run TestNewTestRedis -v
```

Expected: PASS

- [ ] **Step 4: 确认没有破坏既有用例**

```bash
cd server && go test ./internal/handler/
```

Expected: PASS（`file_test.go` / `forward_content_test.go` 不受影响）

- [ ] **Step 5: Commit**

```bash
git add server/go.mod server/go.sum server/internal/handler/testutil_test.go
git commit -m "test(server): 为 handler 包补 miniredis 测试夹具"
```

---

## Task 2: 迁移 014 + `token_version` 贯通 JWT

**Files:**

- Create: `server/internal/database/migrations/014_auth_token_version.sql`
- Modify: `server/internal/model/user.go`（`User` 结构体）
- Modify: `server/internal/pkg/jwt/jwt.go:16-21`（`Claims`）、`GeneratePair`、`generate`
- Test: `server/internal/pkg/jwt/jwt_test.go`

**Interfaces:**

- Consumes: 无
- Produces:
  - `jwt.Claims` 新字段 `TokenVersion int` （JSON tag `tv`）
  - `func (g *Generator) GeneratePair(userID uuid.UUID, deviceID string, tokenVersion int) (*TokenPair, error)` — **签名变更，所有调用点必须一起改**
  - `model.User` 新字段 `TokenVersion int`

- [ ] **Step 1: 写迁移**

`server/internal/database/migrations/014_auth_token_version.sql`：

```sql
-- +goose Up
-- +goose StatementBegin
-- token_version 用于改密后吊销既有 token：签发时把当前值写进 JWT 的 tv 声明，
-- 校验方比较 tv 与库中值，不一致即视为已吊销。
--
-- 只在 refresh 与 WS 建连处校验，不在 AuthRequired 中校验——后者是纯无状态验签
-- （零 DB/Redis 读），加校验等于给每个已认证请求增加一次查库；access token TTL
-- 只有 15 分钟，改密后旧 access token 的残留有效期上限即 15 分钟。
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE users DROP COLUMN IF EXISTS token_version;
-- +goose StatementEnd
```

- [ ] **Step 2: 写失败测试**

在 `server/internal/pkg/jwt/jwt_test.go` 追加：

```go
func TestGeneratePairCarriesTokenVersion(t *testing.T) {
	g := newTestGenerator(t) // 复用文件内既有构造方式
	userID := uuid.New()

	pair, err := g.GeneratePair(userID, "web", 7)
	if err != nil {
		t.Fatalf("GeneratePair: %v", err)
	}

	access, err := g.Validate(pair.AccessToken)
	if err != nil {
		t.Fatalf("Validate access: %v", err)
	}
	if access.TokenVersion != 7 {
		t.Fatalf("access TokenVersion = %d, want 7", access.TokenVersion)
	}

	refresh, err := g.Validate(pair.RefreshToken)
	if err != nil {
		t.Fatalf("Validate refresh: %v", err)
	}
	if refresh.TokenVersion != 7 {
		t.Fatalf("refresh TokenVersion = %d, want 7", refresh.TokenVersion)
	}
}
```

> 若 `jwt_test.go` 里没有 `newTestGenerator`，就照该文件既有用例的构造方式内联构造 Generator，不要新建辅助函数。

- [ ] **Step 3: 跑测试确认失败**

```bash
cd server && go test ./internal/pkg/jwt/ -run TestGeneratePairCarriesTokenVersion -v
```

Expected: 编译失败 —— `too many arguments in call to g.GeneratePair` 与 `access.TokenVersion undefined`

- [ ] **Step 4: 改 Claims 与 Generator**

`server/internal/pkg/jwt/jwt.go`：

```go
// Claims 是本项目签发的 JWT 载荷。
//
// 必须与 middleware.AuthRequired 的解析端一致，否则解析出的 UserID 恒为零值。
type Claims struct {
	UserID       uuid.UUID `json:"uid"`
	DeviceID     string    `json:"did"`
	TokenUse     string    `json:"use"` // "access" or "refresh"
	TokenVersion int       `json:"tv"`  // 签发时的 users.token_version 快照
	jwt.RegisteredClaims
}
```

`GeneratePair` 与 `generate` 透传：

```go
// GeneratePair 为指定用户签发 access / refresh token 对。
// tokenVersion 传入 users.token_version 的当前值，用于改密后吊销旧 token。
func (g *Generator) GeneratePair(userID uuid.UUID, deviceID string, tokenVersion int) (*TokenPair, error) {
	access, err := g.generate(userID, deviceID, "access", tokenVersion, g.accessTTL)
	if err != nil {
		return nil, fmt.Errorf("generate access token: %w", err)
	}
	refresh, err := g.generate(userID, deviceID, "refresh", tokenVersion, g.refreshTTL)
	if err != nil {
		return nil, fmt.Errorf("generate refresh token: %w", err)
	}
	return &TokenPair{
		AccessToken:  access,
		RefreshToken: refresh,
		ExpiresIn:    int64(g.accessTTL.Seconds()),
	}, nil
}

func (g *Generator) generate(userID uuid.UUID, deviceID, use string, tokenVersion int, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID:       userID,
		DeviceID:     deviceID,
		TokenUse:     use,
		TokenVersion: tokenVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
			ID:        uuid.New().String(),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(g.secret)
}
```

`server/internal/model/user.go` 的 `User` 结构体加：

```go
	// TokenVersion 为 token 吊销版本号。改密时递增，使既有 refresh token 与 WS 连接失效。
	TokenVersion int `gorm:"not null;default:0" json:"-"`
```

- [ ] **Step 5: 修所有 `GeneratePair` 调用点**

```bash
cd server && grep -rn "GeneratePair(" --include=*.go . | grep -v _test
```

对每个调用点传入 `user.TokenVersion`（`user_service.go` 的 `buildAuthResult` 与 `Refresh` 是主要两处）。

- [ ] **Step 6: 跑测试确认通过**

```bash
cd server && go test ./internal/pkg/jwt/ -v && go build ./...
```

Expected: PASS 且全仓编译通过

- [ ] **Step 7: Commit**

```bash
git add server/internal/database/migrations/014_auth_token_version.sql \
        server/internal/model/user.go server/internal/pkg/jwt/ server/internal/service/
git commit -m "feat(auth): users 表加 token_version 并写入 JWT 声明"
```

---

## Task 3: `Refresh` 加固 + `last_login_at` 写入

`UserService.Refresh` 的注释写着「用户被注销/封禁后 refresh 立即失效」，但实际只判了 `user == nil`——被封禁用户在 refresh TTL（7 天）内刷新过一次就能无限续期。`Refresh` 本来就已经 `FindByID`，所以补 banned 与 `token_version` 两个判断是零额外 I/O。

另外 `users.last_login_at` 列一直存在但登录时从未写入。

**Files:**

- Modify: `server/internal/service/user_service.go`（`Refresh` ~`:186-206`，`Login` ~`:120-135`）
- Test: `server/internal/service/user_service_test.go`

**Interfaces:**

- Consumes: `jwt.Claims.TokenVersion`（Task 2）、`model.User.TokenVersion`（Task 2）
- Produces: `Refresh` 对 banned / 版本不匹配返回既有哨兵 `ErrUserBanned` / `ErrInvalidRefresh`（**不新增哨兵错误**）

- [ ] **Step 1: 写失败测试**

```go
func TestRefreshRejectsBannedUser(t *testing.T) {
	svc, repo, gen := newUserServiceForTest(t)
	user := seedUser(t, repo)
	pair, err := gen.GeneratePair(user.ID, "web", user.TokenVersion)
	if err != nil {
		t.Fatalf("GeneratePair: %v", err)
	}

	user.Status = model.UserStatusDisabled
	repo.save(user)

	if _, err := svc.Refresh(context.Background(), pair.RefreshToken); !errors.Is(err, ErrUserBanned) {
		t.Fatalf("Refresh err = %v, want ErrUserBanned", err)
	}
}

func TestRefreshRejectsStaleTokenVersion(t *testing.T) {
	svc, repo, gen := newUserServiceForTest(t)
	user := seedUser(t, repo)
	pair, err := gen.GeneratePair(user.ID, "web", user.TokenVersion)
	if err != nil {
		t.Fatalf("GeneratePair: %v", err)
	}

	user.TokenVersion++ // 模拟改密
	repo.save(user)

	if _, err := svc.Refresh(context.Background(), pair.RefreshToken); !errors.Is(err, ErrInvalidRefresh) {
		t.Fatalf("Refresh err = %v, want ErrInvalidRefresh", err)
	}
}
```

> `newUserServiceForTest` / `seedUser` / `repo.save` 若不存在，按 `user_service_test.go` 现有的 fake repo 写法补齐同构辅助；不要引入新的 mock 框架。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd server && go test ./internal/service/ -run "TestRefreshRejects" -v
```

Expected: FAIL —— banned 用例拿到的是 `nil` 错误与一对新 token

- [ ] **Step 3: 实现**

`Refresh` 中 `user == nil` 判断之后补两行，并删掉那条与代码不符的注释：

```go
	user, err := s.repo.FindByID(ctx, claims.UserID)
	if err != nil {
		return nil, fmt.Errorf("find user: %w", err)
	}
	if user == nil {
		return nil, ErrInvalidRefresh
	}
	// 封禁用户不得续期
	if user.Status == model.UserStatusDisabled {
		return nil, ErrUserBanned
	}
	// 改密后 token_version 递增，旧 refresh token 随即失效
	if claims.TokenVersion != user.TokenVersion {
		return nil, ErrInvalidRefresh
	}

	pair, err := s.jwtGen.GeneratePair(claims.UserID, claims.DeviceID, user.TokenVersion)
```

`Login` 成功分支（`buildAuthResult` 之前）写入登录时间：

```go
	// 记录本次登录时间，写失败不阻塞登录
	if err := s.repo.TouchLastLogin(ctx, user.ID); err != nil {
		s.logger.Warn("更新 last_login_at 失败", "user_id", user.ID, "err", err)
	}
```

在 user repository 补：

```go
// TouchLastLogin 把用户的 last_login_at 更新为当前时间。
func (r *UserRepository) TouchLastLogin(ctx context.Context, id uuid.UUID) error {
	return r.db.WithContext(ctx).Model(&model.User{}).
		Where("id = ?", id).
		Update("last_login_at", time.Now()).Error
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd server && go test ./internal/service/ -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/internal/service/ server/internal/repository/
git commit -m "fix(auth): refresh 补封禁与 token 版本校验，登录写入 last_login_at"
```

---

## Task 4: WS 建连校验 `token_version`

`ws.ServeWS` 目前只做验签（`ws/handler.go:107` 附近的 `h.tokens.Validate`），零 DB 读。建连是低频动作，加一次查库可接受——这样改密后旧 access token 无法建立新的 WS 连接。

**Files:**

- Modify: `server/internal/ws/handler.go`
- Modify: `server/cmd/`（构造 `ws.Handler` 处，注入版本读取器）
- Test: `server/internal/ws/handler_test.go`

**Interfaces:**

- Consumes: `jwt.Claims.TokenVersion`（Task 2）
- Produces: `ws.Handler` 新增依赖字段 `versions TokenVersionReader`；接口定义：

```go
// TokenVersionReader 读取用户当前的 token 吊销版本号。
type TokenVersionReader interface {
	TokenVersion(ctx context.Context, userID uuid.UUID) (int, error)
}
```

- [ ] **Step 1: 写失败测试**

```go
type fakeVersions struct{ v int }

func (f *fakeVersions) TokenVersion(_ context.Context, _ uuid.UUID) (int, error) { return f.v, nil }

func TestServeWSRejectsStaleTokenVersion(t *testing.T) {
	// 令牌签发时 tv=0，库里已是 1（模拟改密后）
	h := newTestWSHandler(t, &fakeVersions{v: 1})
	token := mustAccessToken(t, uuid.New(), "web", 0)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/ws?token="+token, nil)
	h.ServeWS(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}
```

> `newTestWSHandler` / `mustAccessToken` 按 `internal/ws` 既有测试的构造方式补齐。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd server && go test ./internal/ws/ -run TestServeWSRejectsStaleTokenVersion -v
```

Expected: FAIL —— 当前会升级成功，返回 101 而非 401

- [ ] **Step 3: 实现**

在 `ServeWS` 的 `TokenUse != "access"` 判断之后、`Upgrade` 之前插入：

```go
	// 改密后 token_version 递增，旧 access token 不得再建立连接。
	// 建连是低频动作，这一次查库可接受；REST 侧不做同样校验（见 014 迁移注释）。
	current, err := h.versions.TokenVersion(r.Context(), claims.UserID)
	if err != nil {
		h.logger.Error("读取 token_version 失败", "user_id", claims.UserID, "err", err)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if claims.TokenVersion != current {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
```

用户 repository 补对应方法：

```go
// TokenVersion 返回用户当前的 token 吊销版本号。
func (r *UserRepository) TokenVersion(ctx context.Context, id uuid.UUID) (int, error) {
	var v int
	err := r.db.WithContext(ctx).Model(&model.User{}).
		Where("id = ?", id).
		Pluck("token_version", &v).Error
	return v, err
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd server && go test -race ./internal/ws/ -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/internal/ws/ server/internal/repository/ server/cmd/
git commit -m "feat(auth): WS 建连校验 token 版本号"
```

---

## Task 5: 补 `/auth/logout` 路由

前端 `packages/shared/src/store/authStore.ts:184` 一直在调这个端点，但 `router.go` 里没有——404 被前端 try/catch 吞掉。

**产品语义决策（已在 spec §8.3 定案）**：`Logout` **不递增** `token_version`。因为没有 device/session 表，递增会把该用户所有设备都踢下线，这对用户是意外行为。`token_version` 只在改密时递增。本端点只返回 204，真正的单设备吊销留到多设备管理批次。

**Files:**

- Modify: `server/internal/handler/user.go`
- Modify: `server/internal/router/router.go`（`:188` 附近）
- Test: `server/internal/handler/user_test.go`

**Interfaces:**

- Consumes: `middleware.AuthRequired`
- Produces: `func (h *UserHandler) Logout(c *gin.Context)` → 204

- [ ] **Step 1: 写失败测试**

```go
func TestLogoutReturns204(t *testing.T) {
	r, _ := newAuthedTestRouter(t)
	w := performRequest(r, http.MethodPost, "/api/v1/auth/logout", nil)
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", w.Code)
	}
}

func TestLogoutRequiresAuth(t *testing.T) {
	r := newAnonTestRouter(t)
	w := performRequest(r, http.MethodPost, "/api/v1/auth/logout", nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd server && go test ./internal/handler/ -run TestLogout -v
```

Expected: FAIL —— 404

- [ ] **Step 3: 实现**

```go
// Logout 结束当前会话。
//
// 服务端不保存会话状态，因此这里不吊销任何 token：客户端删除本地 token 即为登出。
// 不递增 token_version——那会把该用户所有设备一并踢下线，属意外行为；
// 全量吊销只发生在改密。
//
//	@Summary		退出登录
//	@Tags			auth
//	@Security		BearerAuth
//	@Success		204
//	@Router			/api/v1/auth/logout [post]
func (h *UserHandler) Logout(c *gin.Context) {
	c.Status(http.StatusNoContent)
}
```

`router.go` 在 `/auth/refresh`（`:188`）那一行下方注册：

```go
	api.POST("/auth/logout", middleware.AuthRequired(cfg.JWT), userH.Logout)
```

> ⚠️ **不要顺手统一路由前缀。** 现状是 `/auth/refresh`（`:188`）与 `/users/login`、`/users/register`（`:192-193`）并存。
> 前端 `authStore.ts:136,160` 写死了 `/api/v1/users/login` 与 `/api/v1/users/register`，把它们挪到 `/auth/*` 会直接打断登录。
> 本批次新增的端点统一挂 `/auth/*`（与 `refresh`、`logout` 一致），既有两条**保持不动**；统一前缀是独立的破坏性变更，不在本批次范围。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd server && go test ./internal/handler/ -run TestLogout -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/internal/handler/user.go server/internal/router/router.go server/internal/handler/user_test.go
git commit -m "feat(auth): 补齐 logout 端点"
```

---

## Task 6: `CodeSender` 验证码下发抽象

**Files:**

- Create: `server/internal/pkg/codesender/codesender.go`
- Create: `server/internal/pkg/codesender/codesender_test.go`
- Modify: `server/config/config.yaml`、`server/config/config.go`

**Interfaces:**

- Consumes: 无
- Produces:
  - `type Sender interface { Send(ctx context.Context, target, code string) error }`
  - `func NewLogSender(logger *slog.Logger) *LogSender`
  - `func New(provider string, logger *slog.Logger) (Sender, error)` — provider 未知时返回错误
  - `func mask(s string) string` — 包内，供日志打码

- [ ] **Step 1: 写失败测试**

```go
func TestLogSenderMasksCode(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))
	s := NewLogSender(logger)

	if err := s.Send(context.Background(), "13800138000", "123456"); err != nil {
		t.Fatalf("Send: %v", err)
	}

	out := buf.String()
	if strings.Contains(out, "123456") {
		t.Fatalf("日志中出现验证码明文: %s", out)
	}
	if strings.Contains(out, "13800138000") {
		t.Fatalf("日志中出现手机号明文: %s", out)
	}
	if !strings.Contains(out, "1****6") {
		t.Fatalf("日志缺少打码后的验证码: %s", out)
	}
}

func TestNewRejectsUnknownProvider(t *testing.T) {
	if _, err := New("aliyun-typo", slog.Default()); err == nil {
		t.Fatal("未知 provider 应当返回错误，不能静默退回 log 通道")
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd server && go test ./internal/pkg/codesender/ -v
```

Expected: 编译失败 —— 包不存在

- [ ] **Step 3: 实现**

```go
// Package codesender 提供验证码下发通道的抽象。
//
// 调用方只依赖 Sender 接口，切换短信服务商不需要改动业务代码。
package codesender

import (
	"context"
	"fmt"
	"log/slog"
)

// Sender 是验证码下发通道。
type Sender interface {
	// Send 向 target（手机号或邮箱）下发验证码 code。
	// 返回错误表示下发失败，调用方应回滚本次发码（删除 Redis 中的验证码与冷却键）。
	Send(ctx context.Context, target, code string) error
}

// LogSender 把验证码写进日志，供开发与测试环境使用。
// 手机号与验证码均按「首位 + 掩码 + 末位」打码，避免明文落盘。
type LogSender struct{ logger *slog.Logger }

// NewLogSender 构造日志通道。
func NewLogSender(logger *slog.Logger) *LogSender { return &LogSender{logger: logger} }

// Send 把打码后的验证码写入日志。
func (s *LogSender) Send(_ context.Context, target, code string) error {
	s.logger.Info("验证码已下发", "target", mask(target), "code", mask(code), "channel", "log")
	return nil
}

// New 按配置构造下发通道。provider 未知时返回错误，绝不静默退回日志通道——
// 生产环境静默使用日志通道等于验证码永远发不出去，且不会有人发现。
func New(provider string, logger *slog.Logger) (Sender, error) {
	switch provider {
	case "log":
		return NewLogSender(logger), nil
	default:
		return nil, fmt.Errorf("未支持的验证码下发通道: %q", provider)
	}
}

// mask 保留首末字符，中间以 * 替代；长度不足 3 时整体打码。
func mask(s string) string {
	r := []rune(s)
	if len(r) < 3 {
		return "***"
	}
	return string(r[0]) + strings_Repeat("*", len(r)-2) + string(r[len(r)-1])
}
```

> `strings_Repeat` 是占位写法的示意——实现时直接 `import "strings"` 并用 `strings.Repeat`。

配置：`server/config/config.yaml` 增加

```yaml
codesender:
  provider: log # log | (后续接入服务商时扩展)
```

`config.go` 增加对应结构体字段与默认值 `log`。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd server && go test ./internal/pkg/codesender/ -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/internal/pkg/codesender/ server/config/
git commit -m "feat(auth): 新增验证码下发通道抽象与日志通道"
```

---

## Task 7: 后端密码复杂度校验

`handler/user.go:205` 只有 `binding:"required,min=8,max=64"`，前端 `validatePassword` 有 5 条规则——绕过前端直接打接口即可设 `12345678`。注册与改密两条路径必须共用同一份校验。

**Files:**

- Modify: `server/internal/service/user_service.go`
- Test: `server/internal/service/password_strength_test.go`

**Interfaces:**

- Consumes: 无
- Produces: `func ValidatePasswordStrength(pw string) error` — 导出，供注册与改密两处调用；返回既有校验错误哨兵（若无合适的则新增 `ErrWeakPassword`）

- [ ] **Step 1: 写失败测试**

```go
func TestValidatePasswordStrength(t *testing.T) {
	cases := []struct {
		name string
		pw   string
		ok   bool
	}{
		{"合规", "Abcdef12", true},
		{"太短", "Abc12", false},
		{"过长", strings.Repeat("Aa1", 30), false},
		{"缺小写", "ABCDEF12", false},
		{"缺大写", "abcdef12", false},
		{"缺数字", "Abcdefgh", false},
		{"含空白", "Abcdef 12", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := ValidatePasswordStrength(c.pw)
			if c.ok && err != nil {
				t.Fatalf("want ok, got %v", err)
			}
			if !c.ok && err == nil {
				t.Fatal("want error, got nil")
			}
		})
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd server && go test ./internal/service/ -run TestValidatePasswordStrength -v
```

Expected: 编译失败 —— 函数不存在

- [ ] **Step 3: 先对齐前端规则再实现**

```bash
grep -rn -A 30 "export function validatePassword" packages/shared/src/utils/
```

按前端的**同一组规则**实现（不要自行增减）：

```go
// ErrWeakPassword 表示密码不满足复杂度要求。
var ErrWeakPassword = errors.New("weak password")

// ValidatePasswordStrength 校验密码复杂度。
// 规则与前端 validatePassword 逐条对齐：长度 8-64，且同时包含小写、大写、数字，不含空白字符。
// 注册与改密两条路径共用，避免绕过前端即可设置弱密码。
func ValidatePasswordStrength(pw string) error {
	if len(pw) < 8 || len(pw) > 64 {
		return fmt.Errorf("%w: 长度需在 8-64 之间", ErrWeakPassword)
	}
	var hasLower, hasUpper, hasDigit bool
	for _, r := range pw {
		switch {
		case unicode.IsSpace(r):
			return fmt.Errorf("%w: 不得包含空白字符", ErrWeakPassword)
		case unicode.IsLower(r):
			hasLower = true
		case unicode.IsUpper(r):
			hasUpper = true
		case unicode.IsDigit(r):
			hasDigit = true
		}
	}
	if !hasLower || !hasUpper || !hasDigit {
		return fmt.Errorf("%w: 需同时包含大小写字母与数字", ErrWeakPassword)
	}
	return nil
}
```

在 `Register` 的密码处理之前调用它，并把 `ErrWeakPassword` 映射为 400。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd server && go test ./internal/service/ -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/internal/service/
git commit -m "feat(auth): 后端补齐密码复杂度校验并与前端规则对齐"
```

---

## Task 8: 忘记密码三端点（发码 / 校验换票 / 重置）

三段式：发码 → 校验验证码换 `reset_ticket` → 用 ticket 改密。**不能**把「验证码 + 新密码」一次提交，否则用户在最后一步密码不合规时验证码已被消费。

**Redis key 布局**（全部带 `auth:pwd:` 命名空间）：

| Key                        | 值         | TTL  | 用途                      |
| -------------------------- | ---------- | ---- | ------------------------- |
| `auth:pwd:code:{phone}`    | 6 位验证码 | 300s | 待校验的验证码            |
| `auth:pwd:cd:{phone}`      | `1`        | 60s  | 发码冷却，存在即拒绝重发  |
| `auth:pwd:try:{phone}`     | 失败次数   | 300s | 校验失败上限 5 次         |
| `auth:pwd:ticket:{ticket}` | phone      | 600s | 一次性改密票，GETDEL 消费 |

**Files:**

- Create: `server/internal/service/password_reset_service.go`
- Create: `server/internal/service/password_reset_service_test.go`
- Create: `server/internal/handler/password_reset.go`
- Create: `server/internal/handler/password_reset_test.go`
- Modify: `server/internal/router/router.go`
- Modify: `server/internal/repository/user_repo.go`（`UpdatePassword` + `token_version` 递增）
- Modify: `packages/design-system/src/i18n/locales/*.json`（本任务不涉及前端文案，i18n 留到 Task 14）

**Interfaces:**

- Consumes: `codesender.Sender`（Task 6）、`ValidatePasswordStrength`（Task 7）、`newTestRedis`（Task 1）
- Produces:

```go
// PasswordResetService 编排忘记密码的三段式流程。
type PasswordResetService struct { /* rdb, users, sender, logger */ }

func NewPasswordResetService(rdb *redis.Client, users UserRepo, sender codesender.Sender, logger *slog.Logger) *PasswordResetService

// SendCode 生成并下发验证码。手机号未注册时返回 nil（不泄露账号是否存在）。
func (s *PasswordResetService) SendCode(ctx context.Context, phone string) error
// VerifyCode 校验验证码，成功返回一次性 reset ticket 与其有效期秒数。
func (s *PasswordResetService) VerifyCode(ctx context.Context, phone, code string) (ticket string, expiresIn int, err error)
// ResetPassword 消费 ticket 并改密，同时递增 token_version 吊销全部旧 token。
func (s *PasswordResetService) ResetPassword(ctx context.Context, ticket, newPassword string) error

var (
	ErrCodeCooldown  = errors.New("code cooldown")
	ErrCodeInvalid   = errors.New("invalid code")
	ErrTooManyTries  = errors.New("too many attempts")
	ErrTicketInvalid = errors.New("invalid reset ticket")
)
```

HTTP 契约：

| 方法 | 路径                           | 请求体                                             | 成功                                          | 失败                     |
| ---- | ------------------------------ | -------------------------------------------------- | --------------------------------------------- | ------------------------ |
| POST | `/api/v1/auth/password/otp`    | `{"phone":"138..."}`                               | `204`                                         | `429` 冷却中             |
| POST | `/api/v1/auth/password/verify` | `{"phone":"138...","code":"123456"}`               | `200 {"reset_ticket":"...","expires_in":600}` | `400` 码错 / `429` 超次  |
| POST | `/api/v1/auth/password/reset`  | `{"reset_ticket":"...","new_password":"Abcdef12"}` | `204`                                         | `400` 票无效或密码不合规 |

三个端点都挂 `middleware.LimitByIP`（IP 维度，与账号维度的冷却/次数上限互补）。

- [ ] **Step 1: 写失败测试（service 层，用 miniredis）**

```go
func TestSendCodeUnknownPhoneIsSilentSuccess(t *testing.T) {
	svc, _, sender := newPasswordResetSvc(t)
	if err := svc.SendCode(context.Background(), "13900000000"); err != nil {
		t.Fatalf("未注册手机号必须静默成功，避免账号枚举: %v", err)
	}
	if sender.calls != 0 {
		t.Fatal("未注册手机号不应真的下发验证码")
	}
}

func TestSendCodeRespectsCooldown(t *testing.T) {
	svc, _, _ := newPasswordResetSvc(t)
	seedUser(t, "13800138000")
	if err := svc.SendCode(context.Background(), "13800138000"); err != nil {
		t.Fatal(err)
	}
	if err := svc.SendCode(context.Background(), "13800138000"); !errors.Is(err, ErrCodeCooldown) {
		t.Fatalf("err = %v, want ErrCodeCooldown", err)
	}
}

func TestVerifyCodeWrongCodeKeepsCodeAlive(t *testing.T) {
	// 与 captcha.go 的先删再比相反：输错一次不能作废验证码
	svc, rdb, _ := newPasswordResetSvc(t)
	seedUser(t, "13800138000")
	_ = svc.SendCode(context.Background(), "13800138000")

	if _, _, err := svc.VerifyCode(context.Background(), "13800138000", "000000"); !errors.Is(err, ErrCodeInvalid) {
		t.Fatalf("err = %v, want ErrCodeInvalid", err)
	}
	if n, _ := rdb.Exists(context.Background(), "auth:pwd:code:13800138000").Result(); n != 1 {
		t.Fatal("输错验证码后验证码被删除了")
	}
}

func TestVerifyCodeLocksAfterFiveFailures(t *testing.T) {
	svc, _, _ := newPasswordResetSvc(t)
	seedUser(t, "13800138000")
	_ = svc.SendCode(context.Background(), "13800138000")
	for i := 0; i < 5; i++ {
		_, _, _ = svc.VerifyCode(context.Background(), "13800138000", "000000")
	}
	if _, _, err := svc.VerifyCode(context.Background(), "13800138000", "000000"); !errors.Is(err, ErrTooManyTries) {
		t.Fatalf("err = %v, want ErrTooManyTries", err)
	}
}

func TestResetPasswordConsumesTicketOnce(t *testing.T) {
	svc, _, _ := newPasswordResetSvc(t)
	u := seedUser(t, "13800138000")
	_ = svc.SendCode(context.Background(), "13800138000")
	ticket, _, err := svc.VerifyCode(context.Background(), "13800138000", currentCode(t, "13800138000"))
	if err != nil {
		t.Fatal(err)
	}

	if err := svc.ResetPassword(context.Background(), ticket, "Abcdef12"); err != nil {
		t.Fatal(err)
	}
	// 同一张票不能用第二次
	if err := svc.ResetPassword(context.Background(), ticket, "Abcdef34"); !errors.Is(err, ErrTicketInvalid) {
		t.Fatalf("err = %v, want ErrTicketInvalid", err)
	}
	// 改密必须吊销旧 token
	if got := reloadUser(t, u.ID).TokenVersion; got != 1 {
		t.Fatalf("token_version = %d, want 1", got)
	}
}

func TestResetPasswordRejectsWeakPassword(t *testing.T) {
	svc, _, _ := newPasswordResetSvc(t)
	seedUser(t, "13800138000")
	_ = svc.SendCode(context.Background(), "13800138000")
	ticket, _, _ := svc.VerifyCode(context.Background(), "13800138000", currentCode(t, "13800138000"))

	if err := svc.ResetPassword(context.Background(), ticket, "12345678"); !errors.Is(err, ErrWeakPassword) {
		t.Fatalf("err = %v, want ErrWeakPassword", err)
	}
}
```

> `currentCode` 直接从 miniredis 读 `auth:pwd:code:{phone}`——测试里不去猜随机码。
> `seedUser` / `reloadUser` 走既有 service 测试的建数据方式。

handler 层补两条：

```go
func TestPasswordOTPForUnknownPhoneReturns204(t *testing.T) {
	// 端点不得区分「手机号存在」与「不存在」
	r := newAnonTestRouter(t)
	w := performJSON(r, http.MethodPost, "/api/v1/auth/password/otp", `{"phone":"13900000000"}`)
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", w.Code)
	}
}

func TestPasswordResetRejectsUnknownTicket(t *testing.T) {
	r := newAnonTestRouter(t)
	w := performJSON(r, http.MethodPost, "/api/v1/auth/password/reset",
		`{"reset_ticket":"deadbeef","new_password":"Abcdef12"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd server && go test ./internal/service/ -run TestSendCode -v && go test ./internal/handler/ -run TestPassword -v
```

Expected: 编译失败 —— `PasswordResetService` / 端点不存在

- [ ] **Step 3: 实现 service**

```go
// Package service 之外的说明见各方法 godoc。
const (
	pwdCodeTTL     = 5 * time.Minute
	pwdCooldownTTL = time.Minute
	pwdTicketTTL   = 10 * time.Minute
	pwdMaxTries    = 5
)

// SendCode 生成 6 位验证码并通过下发通道送出。
//
// 手机号未注册时直接返回 nil 且不下发：端点对「存在」与「不存在」返回同样的结果，
// 否则接口会退化成账号枚举工具。
func (s *PasswordResetService) SendCode(ctx context.Context, phone string) error {
	if n, err := s.rdb.Exists(ctx, pwdKey("cd", phone)).Result(); err != nil {
		return err
	} else if n > 0 {
		return ErrCodeCooldown
	}

	user, err := s.users.FindByPhone(ctx, phone)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil // 静默成功
		}
		return err
	}

	code, err := randomDigits(6)
	if err != nil {
		return err
	}
	pipe := s.rdb.TxPipeline()
	pipe.Set(ctx, pwdKey("code", phone), code, pwdCodeTTL)
	pipe.Set(ctx, pwdKey("cd", phone), "1", pwdCooldownTTL)
	pipe.Del(ctx, pwdKey("try", phone))
	if _, err := pipe.Exec(ctx); err != nil {
		return err
	}

	if err := s.sender.Send(ctx, phone, code); err != nil {
		// 下发失败要把验证码与冷却一并回滚，否则用户被锁在冷却里却收不到码
		s.rdb.Del(ctx, pwdKey("code", phone), pwdKey("cd", phone))
		return err
	}
	// 审计留痕：verification_codes 表只写不读，热路径完全在 Redis
	s.recordAudit(ctx, phone, code, VerificationTypePasswordReset)
	_ = user
	return nil
}

// VerifyCode 校验验证码并换发一次性改密票。
//
// 先比较、比对成功才删除——与 captcha.go 的先删再比相反，避免用户输错一次就得重新发码。
func (s *PasswordResetService) VerifyCode(ctx context.Context, phone, code string) (string, int, error) {
	tries, err := s.rdb.Incr(ctx, pwdKey("try", phone)).Result()
	if err != nil {
		return "", 0, err
	}
	if tries == 1 {
		s.rdb.Expire(ctx, pwdKey("try", phone), pwdCodeTTL)
	}
	if tries > pwdMaxTries {
		return "", 0, ErrTooManyTries
	}

	want, err := s.rdb.Get(ctx, pwdKey("code", phone)).Result()
	if errors.Is(err, redis.Nil) {
		return "", 0, ErrCodeInvalid
	} else if err != nil {
		return "", 0, err
	}
	// 定长比较，避免按字节短路带来的时序差异
	if subtle.ConstantTimeCompare([]byte(want), []byte(code)) != 1 {
		return "", 0, ErrCodeInvalid
	}

	ticket, err := randomToken(32)
	if err != nil {
		return "", 0, err
	}
	pipe := s.rdb.TxPipeline()
	pipe.Set(ctx, pwdKey("ticket", ticket), phone, pwdTicketTTL)
	pipe.Del(ctx, pwdKey("code", phone), pwdKey("try", phone))
	if _, err := pipe.Exec(ctx); err != nil {
		return "", 0, err
	}
	return ticket, int(pwdTicketTTL.Seconds()), nil
}

// ResetPassword 消费改密票并写入新密码，同时递增 token_version 使全部旧 token 失效。
func (s *PasswordResetService) ResetPassword(ctx context.Context, ticket, newPassword string) error {
	if err := ValidatePasswordStrength(newPassword); err != nil {
		return err // 密码不合规时不消费票，用户可以直接重试
	}
	phone, err := s.rdb.GetDel(ctx, pwdKey("ticket", ticket)).Result()
	if errors.Is(err, redis.Nil) {
		return ErrTicketInvalid
	} else if err != nil {
		return err
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	return s.users.UpdatePasswordAndBumpTokenVersion(ctx, phone, string(hash))
}

// pwdKey 拼接带命名空间的 Redis 键。
func pwdKey(kind, id string) string { return "auth:pwd:" + kind + ":" + id }
```

**注意校验顺序**：`ValidatePasswordStrength` 在 `GetDel` 之前——密码不合规不能消费掉票。

随机数工具（**用 `crypto/rand`，不用 `math/rand/v2`**）：

```go
// randomDigits 返回 n 位十进制验证码，使用密码学安全随机源。
func randomDigits(n int) (string, error) {
	b := make([]byte, n)
	for i := range b {
		v, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			return "", err
		}
		b[i] = byte('0' + v.Int64())
	}
	return string(b), nil
}

// randomToken 返回 n 字节随机数的 URL-safe base64 编码。
func randomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
```

repository：

```go
// UpdatePasswordAndBumpTokenVersion 按手机号写入新密码哈希并递增 token 吊销版本号。
func (r *UserRepository) UpdatePasswordAndBumpTokenVersion(ctx context.Context, phone, hash string) error {
	return r.db.WithContext(ctx).Model(&model.User{}).
		Where("phone = ?", phone).
		UpdateColumns(map[string]any{
			"password_hash": hash,
			"token_version": gorm.Expr("token_version + 1"),
			"updated_at":    time.Now(),
		}).Error
}
```

- [ ] **Step 4: 实现 handler + 注册路由**

```go
// SendResetCode 下发忘记密码验证码。
//
//	@Summary		忘记密码-发送验证码
//	@Tags			auth
//	@Param			body	body		dto.PhoneRequest	true	"手机号"
//	@Success		204
//	@Failure		429	{object}	dto.ErrorResponse	"发送过于频繁"
//	@Router			/api/v1/auth/password/otp [post]
func (h *PasswordResetHandler) SendResetCode(c *gin.Context) {
	var req dto.PhoneRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, err)
		return
	}
	switch err := h.svc.SendCode(c.Request.Context(), req.Phone); {
	case err == nil:
		c.Status(http.StatusNoContent)
	case errors.Is(err, service.ErrCodeCooldown):
		response.Error(c, http.StatusTooManyRequests, "auth.code_cooldown")
	default:
		response.InternalError(c, err)
	}
}
```

> `VerifyResetCode` / `ResetPassword` 同构：`ErrCodeInvalid` → 400、`ErrTooManyTries` → 429、`ErrTicketInvalid` / `ErrWeakPassword` → 400。错误码字符串沿用既有 `response` 包的用法（先 `grep -rn "response.Error(" server/internal/handler/ | head -20` 对齐风格）。

`router.go`（放在 `/auth/login` 附近的公开路由组）：

```go
	pwd := api.Group("/auth/password", middleware.LimitByIP(1, 5))
	{
		pwd.POST("/otp", pwdH.SendResetCode)
		pwd.POST("/verify", pwdH.VerifyResetCode)
		pwd.POST("/reset", pwdH.ResetPassword)
	}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd server && go test -race ./internal/service/ ./internal/handler/ -v
```

Expected: PASS

- [ ] **Step 6: 手工验一遍完整链路**

```bash
cd server && make dev   # 或 pnpm dev:server
curl -i -XPOST localhost:8085/api/v1/auth/password/otp -d '{"phone":"13800138000"}'
# 从服务端日志读打码后的验证码位数确认已下发；开发期完整码可临时提高日志级别查看
```

- [ ] **Step 7: Commit**

```bash
git add server/internal/service/password_reset_service.go server/internal/service/password_reset_service_test.go \
        server/internal/handler/password_reset.go server/internal/handler/password_reset_test.go \
        server/internal/repository/ server/internal/router/router.go server/internal/dto/
git commit -m "feat(auth): 实现忘记密码三段式改密链路"
```

---

## Task 9: 账号级登录失败锁定

`middleware.LimitByIP` 是**进程内** map + mutex（`ratelimit.go:92-107`），按 IP 计数——换 IP 即绕过，且多实例部署时各自为政。补一层按手机号的 Redis 计数：5 次失败锁 15 分钟，**在 bcrypt 之前检查**（bcrypt 是故意慢的，锁定检查放它后面等于把 CPU 送给攻击者）。

**Files:**

- Modify: `server/internal/service/user_service.go`（`Login`）
- Test: `server/internal/service/login_lockout_test.go`

**Interfaces:**

- Consumes: `newTestRedis`（Task 1）
- Produces: `var ErrAccountLocked = errors.New("account locked")`；Redis key `auth:login:fail:{phone}`（TTL 15min）

- [ ] **Step 1: 写失败测试**

```go
func TestLoginLocksAfterFiveFailures(t *testing.T) {
	svc := newUserSvc(t)
	seedUserWithPassword(t, "13800138000", "Abcdef12")

	for i := 0; i < 5; i++ {
		if _, err := svc.Login(context.Background(), "13800138000", "wrong-pw", "web"); err == nil {
			t.Fatal("错误密码不应登录成功")
		}
	}
	// 第 6 次即使密码正确也必须被拒
	if _, err := svc.Login(context.Background(), "13800138000", "Abcdef12", "web"); !errors.Is(err, ErrAccountLocked) {
		t.Fatalf("err = %v, want ErrAccountLocked", err)
	}
}

func TestLoginSuccessClearsFailureCounter(t *testing.T) {
	svc := newUserSvc(t)
	seedUserWithPassword(t, "13800138000", "Abcdef12")

	_, _ = svc.Login(context.Background(), "13800138000", "wrong-pw", "web")
	if _, err := svc.Login(context.Background(), "13800138000", "Abcdef12", "web"); err != nil {
		t.Fatal(err)
	}
	// 成功后计数清零，再连错 5 次才应锁定
	for i := 0; i < 4; i++ {
		_, _ = svc.Login(context.Background(), "13800138000", "wrong-pw", "web")
	}
	if _, err := svc.Login(context.Background(), "13800138000", "Abcdef12", "web"); err != nil {
		t.Fatalf("计数未清零，被提前锁定: %v", err)
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd server && go test ./internal/service/ -run TestLogin -v
```

Expected: FAIL —— 第 6 次登录成功返回，没有 `ErrAccountLocked`

- [ ] **Step 3: 实现**

在 `Login` 最开头（**查库与 bcrypt 之前**）：

```go
const (
	loginFailMax = 5
	loginFailTTL = 15 * time.Minute
)

	// 账号维度锁定：LimitByIP 是进程内按 IP 计数，换 IP 即可绕过。
	// 这里的检查必须在 bcrypt 之前——bcrypt 故意很慢，放它之后等于替攻击者承担开销。
	failKey := "auth:login:fail:" + phone
	if n, err := s.rdb.Get(ctx, failKey).Int(); err == nil && n >= loginFailMax {
		return nil, ErrAccountLocked
	}
```

密码校验失败分支里累加，成功分支里清零：

```go
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		if n, incrErr := s.rdb.Incr(ctx, failKey).Result(); incrErr == nil && n == 1 {
			s.rdb.Expire(ctx, failKey, loginFailTTL)
		}
		return nil, ErrInvalidCredentials
	}
	s.rdb.Del(ctx, failKey)
```

> 注意：手机号不存在的分支**不要**累加计数，否则攻击者可以用不存在的手机号把任意号码锁死（那个号码若之后注册，将开局即锁）。返回的错误仍与密码错误一致，保持不可区分。

handler 把 `ErrAccountLocked` 映射为 `429`，错误码 `auth.account_locked`。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd server && go test -race ./internal/service/ -run TestLogin -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/internal/service/ server/internal/handler/
git commit -m "feat(auth): 登录失败按账号维度锁定"
```

---

## Task 10: 扫码登录状态机与四端点

状态机 `pending → scanned → confirmed`，全程只活在 Redis，TTL 120s。四端点做成一个 Task：轮询端点在 `scan`/`confirm` 落地前永远到不了 `confirmed`，拆开无法独立验收。

```
浏览器/桌面端                     服务端(Redis)                    已登录手机端
     │  POST /auth/qr/session          │                                │
     │ ───────────────────────────────>│  SET auth:qr:{t} state=pending │
     │ <─────────────── {qr_token,120} │  TTL 120s                      │
     │  渲染二维码 yuanchat://login?t= │                                │
     │  GET /auth/qr/{t}  (每 2s)      │                                │
     │ ───────────────────────────────>│                                │
     │ <──────────── {state:"pending"} │       扫码解析出 t              │
     │                                 │<── POST /auth/qr/{t}/scan ─────│ (Bearer)
     │ <──────────── {state:"scanned"} │    state=scanned, uid=<me>     │
     │        「已扫描，请在手机确认」  │                                │
     │                                 │<── POST /auth/qr/{t}/confirm ──│ (Bearer)
     │ ───────────────────────────────>│    state=confirmed             │
     │ <── {state:"confirmed",tokens}  │    GETDEL → 签发 token pair     │
```

**Redis 结构**：`auth:qr:{token}` 用 Hash，字段 `state`、`uid`（scan 时写入）；整体 TTL 120s。

**Files:**

- Create: `server/internal/service/qr_login_service.go`
- Create: `server/internal/service/qr_login_service_test.go`
- Create: `server/internal/handler/qr_login.go`
- Create: `server/internal/handler/qr_login_test.go`
- Modify: `server/internal/router/router.go`

**Interfaces:**

- Consumes: `jwt.Manager.GeneratePair(userID, deviceID, tokenVersion)`（Task 2）、`randomToken`（Task 8）、`newTestRedis`（Task 1）
- Produces:

```go
// QRState 是扫码会话的状态。
type QRState string

const (
	QRPending   QRState = "pending"
	QRScanned   QRState = "scanned"
	QRConfirmed QRState = "confirmed"
)

// QRStatus 是轮询结果。Tokens 仅在 confirmed 的那一次返回。
type QRStatus struct {
	State     QRState        `json:"state"`
	ExpiresIn int            `json:"expires_in"`
	Tokens    *dto.TokenPair `json:"tokens,omitempty"`
}

func NewQRLoginService(rdb *redis.Client, users UserRepo, tokens *jwt.Manager) *QRLoginService

// CreateSession 创建扫码会话，返回二维码内容中携带的一次性 token 与有效期秒数。
func (s *QRLoginService) CreateSession(ctx context.Context) (qrToken string, expiresIn int, err error)
// Poll 查询会话状态；状态为 confirmed 时消费会话并签发 token 对。
func (s *QRLoginService) Poll(ctx context.Context, qrToken string) (*QRStatus, error)
// Scan 把会话从 pending 推进到 scanned，并记录扫码用户。
func (s *QRLoginService) Scan(ctx context.Context, qrToken string, userID uuid.UUID) error
// Confirm 把会话从 scanned 推进到 confirmed，要求与 Scan 为同一用户。
func (s *QRLoginService) Confirm(ctx context.Context, qrToken string, userID uuid.UUID) error

var (
	ErrQRNotFound   = errors.New("qr session not found")
	ErrQRBadState   = errors.New("qr session state mismatch")
	ErrQRWrongUser  = errors.New("qr session belongs to another user")
)
```

HTTP 契约：

| 方法 | 路径                             | 鉴权   | 成功                                      | 失败                             |
| ---- | -------------------------------- | ------ | ----------------------------------------- | -------------------------------- |
| POST | `/api/v1/auth/qr/session`        | 公开   | `200 {"qr_token":"...","expires_in":120}` | `429`                            |
| GET  | `/api/v1/auth/qr/:token`         | 公开   | `200 QRStatus`                            | `404` 不存在或已过期             |
| POST | `/api/v1/auth/qr/:token/scan`    | Bearer | `204`                                     | `404` / `409` 状态不对           |
| POST | `/api/v1/auth/qr/:token/confirm` | Bearer | `204`                                     | `404` / `409` / `403` 非同一用户 |

**二维码载荷**：`yuanchat://login?t=<qr_token>`。扫码端**必须先校验 scheme 前缀**再取 `t`，任意二维码内容不得直接当 token 提交。

- [ ] **Step 1: 写失败测试（service 层）**

```go
func TestQRHappyPath(t *testing.T) {
	svc, _ := newQRSvc(t)
	u := seedUser(t, "13800138000")
	ctx := context.Background()

	token, expiresIn, err := svc.CreateSession(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if expiresIn != 120 {
		t.Fatalf("expires_in = %d, want 120", expiresIn)
	}

	st, _ := svc.Poll(ctx, token)
	if st.State != QRPending {
		t.Fatalf("state = %q, want pending", st.State)
	}

	if err := svc.Scan(ctx, token, u.ID); err != nil {
		t.Fatal(err)
	}
	st, _ = svc.Poll(ctx, token)
	if st.State != QRScanned || st.Tokens != nil {
		t.Fatalf("scanned 阶段不得下发 token: %+v", st)
	}

	if err := svc.Confirm(ctx, token, u.ID); err != nil {
		t.Fatal(err)
	}
	st, err = svc.Poll(ctx, token)
	if err != nil {
		t.Fatal(err)
	}
	if st.State != QRConfirmed || st.Tokens == nil || st.Tokens.AccessToken == "" {
		t.Fatalf("confirmed 必须返回 token 对: %+v", st)
	}
}

func TestQRTokensCanBeClaimedOnlyOnce(t *testing.T) {
	svc, _ := newQRSvc(t)
	u := seedUser(t, "13800138000")
	ctx := context.Background()
	token, _, _ := svc.CreateSession(ctx)
	_ = svc.Scan(ctx, token, u.ID)
	_ = svc.Confirm(ctx, token, u.ID)

	if _, err := svc.Poll(ctx, token); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Poll(ctx, token); !errors.Is(err, ErrQRNotFound) {
		t.Fatalf("err = %v, want ErrQRNotFound（会话应已被消费）", err)
	}
}

func TestQRConfirmWithoutScanIsRejected(t *testing.T) {
	svc, _ := newQRSvc(t)
	u := seedUser(t, "13800138000")
	ctx := context.Background()
	token, _, _ := svc.CreateSession(ctx)

	if err := svc.Confirm(ctx, token, u.ID); !errors.Is(err, ErrQRBadState) {
		t.Fatalf("err = %v, want ErrQRBadState（不得跳过 scan）", err)
	}
}

func TestQRConfirmByAnotherUserIsRejected(t *testing.T) {
	svc, _ := newQRSvc(t)
	scanner := seedUser(t, "13800138000")
	attacker := seedUser(t, "13800138001")
	ctx := context.Background()
	token, _, _ := svc.CreateSession(ctx)
	_ = svc.Scan(ctx, token, scanner.ID)

	if err := svc.Confirm(ctx, token, attacker.ID); !errors.Is(err, ErrQRWrongUser) {
		t.Fatalf("err = %v, want ErrQRWrongUser", err)
	}
}

func TestQRScanTwiceIsRejected(t *testing.T) {
	svc, _ := newQRSvc(t)
	u := seedUser(t, "13800138000")
	ctx := context.Background()
	token, _, _ := svc.CreateSession(ctx)
	_ = svc.Scan(ctx, token, u.ID)

	if err := svc.Scan(ctx, token, u.ID); !errors.Is(err, ErrQRBadState) {
		t.Fatalf("err = %v, want ErrQRBadState", err)
	}
}

func TestQRExpiredSessionIsNotFound(t *testing.T) {
	svc, mr := newQRSvc(t)
	ctx := context.Background()
	token, _, _ := svc.CreateSession(ctx)

	mr.FastForward(121 * time.Second) // miniredis 手动推进时钟
	if _, err := svc.Poll(ctx, token); !errors.Is(err, ErrQRNotFound) {
		t.Fatalf("err = %v, want ErrQRNotFound", err)
	}
}

func TestQRPollUnknownTokenIsNotFound(t *testing.T) {
	svc, _ := newQRSvc(t)
	if _, err := svc.Poll(context.Background(), "not-a-real-token"); !errors.Is(err, ErrQRNotFound) {
		t.Fatalf("err = %v, want ErrQRNotFound（不区分不存在与已过期）", err)
	}
}
```

> `newQRSvc` 返回 `(*QRLoginService, *miniredis.Miniredis)`——过期用例需要 `FastForward`。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd server && go test ./internal/service/ -run TestQR -v
```

Expected: 编译失败 —— `QRLoginService` 不存在

- [ ] **Step 3: 实现 service**

状态推进必须**原子**，否则两台手机同时 scan 会都成功。用 Lua 做 CAS：

```go
const qrTTL = 120 * time.Second

// qrAdvance 原子地校验当前状态并推进。
// KEYS[1]=会话键 ARGV[1]=期望的当前状态 ARGV[2]=目标状态 ARGV[3]=用户 ID
// 返回 0=成功 1=会话不存在 2=状态不匹配 3=用户不匹配
var qrAdvance = redis.NewScript(`
local st = redis.call('HGET', KEYS[1], 'state')
if not st then return 1 end
if st ~= ARGV[1] then return 2 end
local uid = redis.call('HGET', KEYS[1], 'uid')
if uid and uid ~= '' and uid ~= ARGV[3] then return 3 end
redis.call('HSET', KEYS[1], 'state', ARGV[2], 'uid', ARGV[3])
return 0
`)

// advance 按状态机推进会话，把 Lua 返回码翻译成哨兵错误。
func (s *QRLoginService) advance(ctx context.Context, qrToken string, from, to QRState, userID uuid.UUID) error {
	code, err := qrAdvance.Run(ctx, s.rdb, []string{qrKey(qrToken)},
		string(from), string(to), userID.String()).Int()
	if err != nil {
		return err
	}
	switch code {
	case 0:
		return nil
	case 1:
		return ErrQRNotFound
	case 2:
		return ErrQRBadState
	default:
		return ErrQRWrongUser
	}
}

// Scan 把会话从 pending 推进到 scanned，并记录扫码用户。
func (s *QRLoginService) Scan(ctx context.Context, qrToken string, userID uuid.UUID) error {
	return s.advance(ctx, qrToken, QRPending, QRScanned, userID)
}

// Confirm 把会话从 scanned 推进到 confirmed，要求与 Scan 为同一用户。
func (s *QRLoginService) Confirm(ctx context.Context, qrToken string, userID uuid.UUID) error {
	return s.advance(ctx, qrToken, QRScanned, QRConfirmed, userID)
}

// CreateSession 创建扫码会话。
//
// qrToken 是 32 字节密码学随机数：它同时充当浏览器侧的会话凭据，
// 猜中即可窃取一次登录，因此不能用可预测的自增或 math/rand。
func (s *QRLoginService) CreateSession(ctx context.Context) (string, int, error) {
	token, err := randomToken(32)
	if err != nil {
		return "", 0, err
	}
	pipe := s.rdb.TxPipeline()
	pipe.HSet(ctx, qrKey(token), "state", string(QRPending), "uid", "")
	pipe.Expire(ctx, qrKey(token), qrTTL)
	if _, err := pipe.Exec(ctx); err != nil {
		return "", 0, err
	}
	return token, int(qrTTL.Seconds()), nil
}

// Poll 查询会话状态；confirmed 时消费会话并签发 token 对。
//
// 会话不存在与已过期返回同一个错误：区分二者会让攻击者能探测 token 是否曾存在。
func (s *QRLoginService) Poll(ctx context.Context, qrToken string) (*QRStatus, error) {
	vals, err := s.rdb.HGetAll(ctx, qrKey(qrToken)).Result()
	if err != nil {
		return nil, err
	}
	if len(vals) == 0 {
		return nil, ErrQRNotFound
	}
	ttl, err := s.rdb.TTL(ctx, qrKey(qrToken)).Result()
	if err != nil {
		return nil, err
	}
	st := QRState(vals["state"])
	if st != QRConfirmed {
		return &QRStatus{State: st, ExpiresIn: int(ttl.Seconds())}, nil
	}

	// 先删后签：删除成功（返回 1）的那一次调用独占签发权，重复轮询拿不到第二份 token。
	deleted, err := s.rdb.Del(ctx, qrKey(qrToken)).Result()
	if err != nil {
		return nil, err
	}
	if deleted == 0 {
		return nil, ErrQRNotFound
	}
	userID, err := uuid.Parse(vals["uid"])
	if err != nil {
		return nil, err
	}
	user, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user.Status == model.UserStatusBanned {
		return nil, ErrUserBanned
	}
	pair, err := s.tokens.GeneratePair(user.ID, "qr", user.TokenVersion)
	if err != nil {
		return nil, err
	}
	return &QRStatus{State: QRConfirmed, ExpiresIn: 0, Tokens: pair}, nil
}

// qrKey 拼接带命名空间的会话键。
func qrKey(token string) string { return "auth:qr:" + token }
```

> `deviceID` 传 `"qr"`：扫码登录没有真实设备标识，与既有登录的 `device_id` 语义保持一致即可。

- [ ] **Step 4: 实现 handler + 注册路由**

```go
	qr := api.Group("/auth/qr")
	{
		qr.POST("/session", middleware.LimitByIP(1, 5), qrH.CreateSession)
		qr.GET("/:token", middleware.LimitByIP(5, 30), qrH.Poll) // 轮询频率高，限流放宽
		qr.POST("/:token/scan", middleware.AuthRequired(cfg.JWT), qrH.Scan)
		qr.POST("/:token/confirm", middleware.AuthRequired(cfg.JWT), qrH.Confirm)
	}
```

错误映射：`ErrQRNotFound` → 404 `auth.qr_expired`、`ErrQRBadState` → 409 `auth.qr_bad_state`、`ErrQRWrongUser` → 403 `auth.qr_wrong_user`、`ErrUserBanned` → 403 `auth.banned`。

handler 层补一条端到端用例：

```go
func TestQREndpointsHappyPath(t *testing.T) {
	r, bearer := newAuthedTestRouter(t)

	w := performJSON(r, http.MethodPost, "/api/v1/auth/qr/session", `{}`)
	var created struct{ QRToken string `json:"qr_token"` }
	mustUnmarshal(t, w.Body.Bytes(), &created)

	if w := performAuthed(r, bearer, http.MethodPost, "/api/v1/auth/qr/"+created.QRToken+"/scan"); w.Code != 204 {
		t.Fatalf("scan status = %d", w.Code)
	}
	if w := performAuthed(r, bearer, http.MethodPost, "/api/v1/auth/qr/"+created.QRToken+"/confirm"); w.Code != 204 {
		t.Fatalf("confirm status = %d", w.Code)
	}
	w = performRequest(r, http.MethodGet, "/api/v1/auth/qr/"+created.QRToken, nil)
	if !strings.Contains(w.Body.String(), "access_token") {
		t.Fatalf("轮询未返回 token: %s", w.Body.String())
	}
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd server && go test -race ./internal/service/ ./internal/handler/ -run TestQR -v
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/internal/service/qr_login_service.go server/internal/service/qr_login_service_test.go \
        server/internal/handler/qr_login.go server/internal/handler/qr_login_test.go \
        server/internal/router/router.go server/internal/dto/
git commit -m "feat(auth): 实现扫码登录会话状态机与四端点"
```

---

## Task 11: 后端收口 —— Swagger 与端到端冒烟

后端六个新端点全部落地后统一收口，避免每个 Task 都重跑一遍全量。

**Files:**

- Modify: `server/docs/`（`make swagger` 产物）
- Create: `server/scripts/smoke_auth.sh`

- [ ] **Step 1: 重新生成 Swagger**

```bash
cd server && make swagger
git diff --stat server/docs/
```

Expected: `docs/swagger.json` / `docs/docs.go` 出现 6 个新路径。若无变化，说明 godoc 注解写错了（`@Router` 路径必须与实际注册路径一致）。

- [ ] **Step 2: 写冒烟脚本**

```bash
#!/usr/bin/env bash
# auth 链路冒烟：需要本地 server 已在 8085 端口运行。
set -euo pipefail
BASE=${BASE:-http://localhost:8085/api/v1}

echo "== 忘记密码发码（未注册号码应为 204） =="
curl -sS -o /dev/null -w '%{http_code}\n' -XPOST "$BASE/auth/password/otp" \
  -H 'Content-Type: application/json' -d '{"phone":"13900000000"}'

echo "== 扫码会话 =="
QR=$(curl -sS -XPOST "$BASE/auth/qr/session" | grep -o '"qr_token":"[^"]*' | cut -d'"' -f4)
echo "qr_token=${QR:0:8}..."
curl -sS "$BASE/auth/qr/$QR"; echo

echo "== 未鉴权 scan 应为 401 =="
curl -sS -o /dev/null -w '%{http_code}\n' -XPOST "$BASE/auth/qr/$QR/scan"

echo "== logout 未鉴权应为 401 =="
curl -sS -o /dev/null -w '%{http_code}\n' -XPOST "$BASE/auth/logout"
```

- [ ] **Step 3: 跑全量后端测试 + 冒烟**

```bash
cd server && go test -race ./... 2>&1 | tail -30
chmod +x scripts/smoke_auth.sh && ./scripts/smoke_auth.sh
```

Expected: 测试全绿；冒烟输出 `204` / pending / `401` / `401`

- [ ] **Step 4: Commit**

```bash
git add server/docs/ server/scripts/smoke_auth.sh
git commit -m "docs(server): 更新 auth 端点 Swagger 并补冒烟脚本"
```

---

## Task 12: 前端 auth API 模块 + `AuthShell` 下沉

**Files:**

- Create: `packages/shared/src/api/auth.ts`
- Create: `packages/ui/src/auth/AuthShell.tsx`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/auth/AuthShell.test.tsx`

**Interfaces:**

- Consumes: `apiGet` / `apiPost`（`packages/shared/src/api/client.ts:103,107`）
- Produces:

```ts
// packages/shared/src/api/auth.ts
export interface ResetTicket {
  resetTicket: string;
  expiresIn: number;
}
export interface QrSession {
  qrToken: string;
  expiresIn: number;
}
export type QrState = "pending" | "scanned" | "confirmed";
export interface QrStatus {
  state: QrState;
  expiresIn: number;
  tokens?: TokenPair;
}

export function sendResetCode(phone: string): Promise<void>;
export function verifyResetCode(phone: string, code: string): Promise<ResetTicket>;
export function resetPassword(resetTicket: string, newPassword: string): Promise<void>;
export function createQrSession(): Promise<QrSession>;
export function pollQrSession(qrToken: string): Promise<QrStatus>;
export function scanQr(qrToken: string): Promise<void>;
export function confirmQr(qrToken: string): Promise<void>;
```

```tsx
// packages/ui/src/auth/AuthShell.tsx
export interface AuthShellProps {
  /** 卡片顶部图标，各页自带（KeyRound / MessageCircle / QrCode） */
  icon: ReactNode;
  /** 卡片主标题 */
  title: string;
  /** 窗口顶栏插槽，桌面端传入 TitleBar，web 端不传 */
  topSlot?: ReactNode;
  /** 卡片主体 */
  children: ReactNode;
  /** 卡片底部链接区 */
  footer?: ReactNode;
}
export function AuthShell(props: AuthShellProps): JSX.Element;
```

**已定的两个设计点**（不要再讨论）：

1. `cursor-glow` 鼠标跟随光晕**进 AuthShell，不做端区分**——web 与桌面 `LoginPage.tsx:67` / `:97` 本来都有，`packages/design-system/src/global.css:414` 是全局类。
2. 断点在 `AuthShell` 内部用 `useBreakpoint()` 推导，**禁止 `isDesktop` / `isMobile` prop**（范式见 Global Constraints）。桌面端只通过 `topSlot` 注入 `TitleBar`。

- [ ] **Step 1: 写失败测试**

```tsx
import { render, screen } from "@testing-library/react";
import { AuthShell } from "./AuthShell";

describe("AuthShell", () => {
  it("渲染标题与主体", () => {
    render(
      <AuthShell icon={<span />} title="重置密码">
        <p>body</p>
      </AuthShell>,
    );
    expect(screen.getByRole("heading", { name: "重置密码" })).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("不传 topSlot 时不渲染顶栏容器", () => {
    const { container } = render(
      <AuthShell icon={<span />} title="t">
        <p>b</p>
      </AuthShell>,
    );
    expect(container.querySelector("[data-auth-topslot]")).toBeNull();
  });

  it("传入 topSlot 时渲染它", () => {
    render(
      <AuthShell icon={<span />} title="t" topSlot={<div>bar</div>}>
        <p>b</p>
      </AuthShell>,
    );
    expect(screen.getByText("bar")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @yuanchat/ui test -- AuthShell
```

Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现 api 模块**

后端返回 snake_case，这里统一转 camelCase（与 `api/users.ts` 的 `mapProfile` 同范式）。

```ts
/**
 * 认证补充流程 REST API —— 忘记密码三段式 / 扫码登录状态机
 *
 * @description 对应后端 /auth/password/* 与 /auth/qr/*。
 * 登录与注册仍在 authStore 里直连 /users/login、/users/register，不在此模块。
 */
import { apiGet, apiPost } from "./client";

/** 忘记密码：下发验证码。手机号未注册时后端同样返回 204，不泄露账号是否存在。 */
export async function sendResetCode(phone: string): Promise<void> {
  await apiPost<void>("/api/v1/auth/password/otp", { phone });
}

/** 忘记密码：校验验证码，换取一次性改密票。 */
export async function verifyResetCode(phone: string, code: string): Promise<ResetTicket> {
  const dto = await apiPost<{ reset_ticket: string; expires_in: number }>(
    "/api/v1/auth/password/verify",
    { phone, code },
  );
  return { resetTicket: dto.reset_ticket, expiresIn: dto.expires_in };
}

/** 忘记密码：用改密票写入新密码。成功后该用户全部旧 token 失效。 */
export async function resetPassword(resetTicket: string, newPassword: string): Promise<void> {
  await apiPost<void>("/api/v1/auth/password/reset", {
    reset_ticket: resetTicket,
    new_password: newPassword,
  });
}

/** 扫码登录：创建会话，返回二维码要承载的一次性 token。 */
export async function createQrSession(): Promise<QrSession> {
  const dto = await apiPost<{ qr_token: string; expires_in: number }>(
    "/api/v1/auth/qr/session",
    {},
  );
  return { qrToken: dto.qr_token, expiresIn: dto.expires_in };
}

/** 扫码登录：轮询会话状态；confirmed 时同时返回 token 对。 */
export async function pollQrSession(qrToken: string): Promise<QrStatus> {
  const dto = await apiGet<{
    state: QrState;
    expires_in: number;
    tokens?: { access_token: string; refresh_token: string; expires_in: number };
  }>(`/api/v1/auth/qr/${encodeURIComponent(qrToken)}`);
  return {
    state: dto.state,
    expiresIn: dto.expires_in,
    tokens: dto.tokens && {
      accessToken: dto.tokens.access_token,
      refreshToken: dto.tokens.refresh_token,
      expiresIn: dto.tokens.expires_in,
    },
  };
}

/** 扫码登录：已登录端上报「已扫描」。 */
export async function scanQr(qrToken: string): Promise<void> {
  await apiPost<void>(`/api/v1/auth/qr/${encodeURIComponent(qrToken)}/scan`, {});
}

/** 扫码登录：已登录端确认授权。 */
export async function confirmQr(qrToken: string): Promise<void> {
  await apiPost<void>(`/api/v1/auth/qr/${encodeURIComponent(qrToken)}/confirm`, {});
}
```

> `encodeURIComponent` 不能省：`qr_token` 是 base64url，虽不含 `/` 与 `+`，但拼接前编码是硬要求。

- [ ] **Step 4: 实现 AuthShell**

把 web `ForgotPasswordPage.tsx:93-110` 的外层结构原样搬过来（背景 orb + dot-grid + 玻璃卡片 + logo + h1），加上 `topSlot` 与 `cursor-glow`：

```tsx
/**
 * 认证页外壳 —— 背景装饰、磨砂玻璃卡片、Logo 与标题
 *
 * @description 登录 / 注册 / 忘记密码 / 扫码登录四页共用。
 * 端差异只通过 topSlot 注入（桌面端传 TitleBar），断点在内部推导。
 */
export function AuthShell({ icon, title, topSlot, children, footer }: AuthShellProps) {
  const bp = useBreakpoint();
  const isMobile = bp === "mobile";
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // 移动端没有鼠标，不挂监听
  useEffect(() => {
    if (isMobile) return;
    const onMove = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [isMobile]);

  return (
    <div className="surface-gradient relative flex min-h-[var(--app-height,100vh)] flex-col overflow-y-auto">
      {topSlot ? <div data-auth-topslot>{topSlot}</div> : null}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="aurora-orb -top-20 -left-20 h-[500px] w-[500px] bg-[#7EC8E3]" />
        <div className="aurora-orb top-1/2 -right-32 h-[400px] w-[400px] bg-[#A8CFFF]" />
        <div className="aurora-orb -bottom-20 left-1/3 h-[350px] w-[350px] bg-[#B8D8F0]" />
      </div>
      <div className="dot-grid pointer-events-none fixed inset-0" />
      {!isMobile && <div className="cursor-glow" style={{ left: mousePos.x, top: mousePos.y }} />}

      <div className="relative m-auto w-full max-w-md px-5 py-8">
        <div className="rounded-lg border border-white/60 bg-white/70 px-10 py-12 shadow-[0_8px_40px_rgba(0,0,0,0.08)] backdrop-blur-2xl">
          <div className="mb-6 text-center">
            <div className="brand-gradient glow-brand mx-auto mb-4 inline-flex h-16 w-16 items-center justify-center rounded-lg text-white shadow-lg">
              {icon}
            </div>
            <h1 className="text-on-surface text-2xl font-bold">{title}</h1>
          </div>
          {children}
          {footer}
        </div>
      </div>
    </div>
  );
}
```

`packages/ui/src/index.ts` 增加（放在 `// 认证` 分组注释下）：

```ts
export { AuthShell } from "./auth/AuthShell";
export type { AuthShellProps } from "./auth/AuthShell";
```

- [ ] **Step 5: 跑测试 + 门禁**

```bash
pnpm --filter @yuanchat/ui test -- AuthShell && pnpm check
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/api/auth.ts packages/ui/src/auth/ packages/ui/src/index.ts
git commit -m "feat(auth): 新增认证 API 模块与认证页外壳组件"
```

---

## Task 13: `ForgotPasswordScreen` 下沉并接真接口

三条 `await new Promise((r) => setTimeout(r, 500))` 假实现（web `:43,61,85`）换成真调用；重发按钮（`:210`）从只倒计时改为真的重新发码。

**Files:**

- Create: `packages/ui/src/auth/ForgotPasswordScreen.tsx`
- Modify: `packages/ui/src/index.ts`
- Rewrite: `apps/web/src/pages/ForgotPasswordPage.tsx`（142 行 → 薄壳）
- Rewrite: `apps/desktop/src/pages/ForgotPasswordPage.tsx`（181 行 → 薄壳）
- Modify: `packages/design-system/src/i18n/locales/{zh-CN,en-US,ja-JP,ko-KR}.json`
- Test: `packages/ui/src/auth/ForgotPasswordScreen.test.tsx`

**Interfaces:**

- Consumes: `AuthShell`、`sendResetCode` / `verifyResetCode` / `resetPassword`（Task 12）
- Produces:

```tsx
export interface ForgotPasswordScreenProps {
  /** 窗口顶栏插槽（桌面端传 TitleBar） */
  topSlot?: ReactNode;
  /** 完成后回登录页的导航行为；不传则渲染 <Link to="/login"> */
  onDone?: () => void;
}
export function ForgotPasswordScreen(props: ForgotPasswordScreenProps): JSX.Element;
```

> `packages/ui/package.json:42` 已声明 `react-router-dom ^7.0.0`（`MainLayout.tsx:26` 在用 `Link`），所以**默认直接用 `Link`**，`onDone` 只是给桌面端 `useNavigate` 留的口子。

**新增 i18n key**（四份 locale 同 commit 补齐）：

| key                       | zh-CN                              |
| ------------------------- | ---------------------------------- |
| `auth.otpExpired`         | 验证码已过期，请重新获取           |
| `auth.otpTooManyTries`    | 尝试次数过多，请重新获取验证码     |
| `auth.sendCooldown`       | 发送过于频繁，请稍后再试           |
| `auth.resetTicketExpired` | 会话已过期，请重新验证             |
| `auth.accountLocked`      | 登录失败次数过多，请 15 分钟后再试 |

- [ ] **Step 1: 写失败测试**

```tsx
vi.mock("@yuanchat/shared", async (orig) => ({
  ...(await orig<object>()),
  sendResetCode: vi.fn().mockResolvedValue(undefined),
  verifyResetCode: vi.fn().mockResolvedValue({ resetTicket: "tk", expiresIn: 600 }),
  resetPassword: vi.fn().mockResolvedValue(undefined),
}));

it("第一步提交手机号会真的调发码接口", async () => {
  renderWithRouter(<ForgotPasswordScreen />);
  await userEvent.type(screen.getByPlaceholderText("auth.phone"), "13800138000");
  await userEvent.click(screen.getByRole("button", { name: "auth.sendCode" }));
  expect(sendResetCode).toHaveBeenCalledWith("13800138000");
});

it("重发按钮会再次调发码接口，而不是只重启倒计时", async () => {
  renderWithRouter(<ForgotPasswordScreen />);
  await goToStep2();
  vi.mocked(sendResetCode).mockClear();
  await userEvent.click(screen.getByRole("button", { name: "auth.resend" }));
  expect(sendResetCode).toHaveBeenCalledTimes(1);
});

it("改密用第二步换回的 ticket，而不是验证码", async () => {
  renderWithRouter(<ForgotPasswordScreen />);
  await goToStep3();
  await userEvent.type(screen.getByPlaceholderText("auth.newPassword"), "Abcdef12");
  await userEvent.type(screen.getByPlaceholderText("auth.confirmNewPassword"), "Abcdef12");
  await userEvent.click(screen.getByRole("button", { name: "auth.confirmChange" }));
  expect(resetPassword).toHaveBeenCalledWith("tk", "Abcdef12");
});

it("429 冷却错误映射到冷却文案", async () => {
  vi.mocked(sendResetCode).mockRejectedValueOnce(new ApiError(429, "auth.code_cooldown"));
  renderWithRouter(<ForgotPasswordScreen />);
  await userEvent.type(screen.getByPlaceholderText("auth.phone"), "13800138000");
  await userEvent.click(screen.getByRole("button", { name: "auth.sendCode" }));
  expect(await screen.findByText("auth.sendCooldown")).toBeInTheDocument();
});
```

> `packages/ui` 的测试用 i18n key 原样断言（测试环境 `t()` 返回 key 本身），与既有组件测试一致。

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @yuanchat/ui test -- ForgotPasswordScreen
```

Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现（搬 web 版为基底，替换三处假实现）**

以 `apps/web/src/pages/ForgotPasswordPage.tsx` 全文为基底搬进 `packages/ui/src/auth/ForgotPasswordScreen.tsx`，改动点只有四处：

1. 外层结构（`:93-110` 与收尾）换成 `<AuthShell icon={<KeyRound size={28} />} title={t("auth.resetPassword")} topSlot={topSlot} footer={...}>`。
2. `handleSendOtp` 的假 await 换成：

```tsx
try {
  await sendResetCode(phone);
  startCountdown();
  setStep(2);
} catch (e) {
  setPhoneError(t(mapAuthError(e, "auth.sendFailed")));
} finally {
  setLoading(false);
}
```

3. `handleVerifyOtp` 换成真校验并存下 ticket：

```tsx
  const [ticket, setTicket] = useState("");
  ...
    try {
      const res = await verifyResetCode(phone, otp);
      setTicket(res.resetTicket);
      setStep(3);
    } catch (e) {
      setOtpError(t(mapAuthError(e, "auth.otpWrong")));
    } finally {
      setLoading(false);
    }
```

4. `handleResetPassword` 用 ticket 改密；`startCountdown()` 的重发按钮改为 `onClick={handleSendOtp}`（它内部已带冷却与错误处理）。

错误码映射工具（同文件内，不导出）：

```tsx
/** 把后端错误码翻成 i18n key；未知错误回落到 fallback。 */
function mapAuthError(e: unknown, fallback: string): string {
  const code = e instanceof ApiError ? e.code : "";
  switch (code) {
    case "auth.code_cooldown":
      return "auth.sendCooldown";
    case "auth.otp_too_many":
      return "auth.otpTooManyTries";
    case "auth.otp_invalid":
      return "auth.otpWrong";
    case "auth.ticket_invalid":
      return "auth.resetTicketExpired";
    default:
      return fallback;
  }
}
```

> 先 `grep -n "code" packages/shared/src/api/client.ts` 确认 `ApiError` 上承载错误码的字段名，按实际字段写。

- [ ] **Step 4: 两端改薄壳**

```tsx
// apps/web/src/pages/ForgotPasswordPage.tsx
import { ForgotPasswordScreen } from "@yuanchat/ui";

/** 忘记密码页 —— web 端不需要窗口顶栏 */
export function ForgotPasswordPage() {
  return <ForgotPasswordScreen />;
}
```

```tsx
// apps/desktop/src/pages/ForgotPasswordPage.tsx
import { useNavigate } from "react-router-dom";
import { ForgotPasswordScreen } from "@yuanchat/ui";
import { TitleBar } from "../components/TitleBar";

/** 忘记密码页 —— 桌面端注入窗口顶栏与原生导航 */
export function ForgotPasswordPage() {
  const navigate = useNavigate();
  return (
    <ForgotPasswordScreen
      topSlot={<TitleBar />}
      onDone={() => navigate("/login", { replace: true })}
    />
  );
}
```

- [ ] **Step 5: 补四份 locale 并跑门禁**

```bash
pnpm check:i18n && pnpm --filter @yuanchat/ui test && pnpm check
```

Expected: 全绿。`check:i18n` 报缺 key 就是四份没补齐。

- [ ] **Step 6: 真机/浏览器验一遍三步流程**

```bash
pnpm dev:web    # 走 /forgot-password，确认三步都打到真接口（Network 面板）
```

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/auth/ packages/ui/src/index.ts apps/web/src/pages/ForgotPasswordPage.tsx \
        apps/desktop/src/pages/ForgotPasswordPage.tsx packages/design-system/src/i18n/locales/
git commit -m "feat(auth): 忘记密码页下沉共享组件并接入真实接口"
```

---

## Task 14: `LoginScreen` / `RegisterScreen` 下沉 + 注册补确认密码与协议勾选

**Files:**

- Create: `packages/ui/src/auth/LoginScreen.tsx`、`packages/ui/src/auth/RegisterScreen.tsx`
- Modify: `packages/ui/src/index.ts`
- Rewrite: `apps/{web,desktop}/src/pages/LoginPage.tsx`、`apps/{web,desktop}/src/pages/RegisterPage.tsx`
- Modify: `packages/design-system/src/i18n/locales/*.json`
- Test: `packages/ui/src/auth/RegisterScreen.test.tsx`

**Interfaces:**

- Consumes: `AuthShell`（Task 12）、`useAuthStore` 的 `loginWithPassword` / `registerWithPassword`（`packages/shared/src/store/authStore.ts:135,153`）
- Produces:

```tsx
export interface LoginScreenProps {
  topSlot?: ReactNode;
  onLoggedIn?: () => void;
}
export interface RegisterScreenProps {
  topSlot?: ReactNode;
  onRegistered?: () => void;
}
```

**新增 i18n key**：`auth.confirmPassword`、`auth.agreeTerms`（含 `<0>` 占位的服务条款链接文案）、`auth.mustAgreeTerms`、`auth.termsTitle`、`auth.privacyTitle`。

- [ ] **Step 1: 写失败测试**

```tsx
it("未勾选协议时提交被拦下且不调注册接口", async () => {
  renderWithRouter(<RegisterScreen />);
  await fillValidForm();
  await userEvent.click(screen.getByRole("button", { name: "auth.register" }));
  expect(await screen.findByText("auth.mustAgreeTerms")).toBeInTheDocument();
  expect(registerWithPassword).not.toHaveBeenCalled();
});

it("两次密码不一致时提交被拦下", async () => {
  renderWithRouter(<RegisterScreen />);
  await fillValidForm({ confirm: "Abcdef34" });
  await userEvent.click(screen.getByLabelText("auth.agreeTerms"));
  await userEvent.click(screen.getByRole("button", { name: "auth.register" }));
  expect(await screen.findByText("auth.passwordMismatch")).toBeInTheDocument();
  expect(registerWithPassword).not.toHaveBeenCalled();
});

it("表单合规且已勾选协议时正常注册", async () => {
  renderWithRouter(<RegisterScreen />);
  await fillValidForm();
  await userEvent.click(screen.getByLabelText("auth.agreeTerms"));
  await userEvent.click(screen.getByRole("button", { name: "auth.register" }));
  expect(registerWithPassword).toHaveBeenCalled();
});

it("账号锁定错误映射到锁定文案", async () => {
  vi.mocked(loginWithPassword).mockRejectedValueOnce(new ApiError(429, "auth.account_locked"));
  renderWithRouter(<LoginScreen />);
  await submitLogin();
  expect(await screen.findByText("auth.accountLocked")).toBeInTheDocument();
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @yuanchat/ui test -- Screen
```

Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现**

以 web 版 `LoginPage.tsx` / `RegisterPage.tsx` 为基底搬入，改动：外层换 `AuthShell`；删掉各自的 `cursor-glow` / orb / 卡片结构（已在 shell 里）；`RegisterScreen` 增加确认密码 `Input` 与协议 `checkbox`：

```tsx
  const [agreed, setAgreed] = useState(false);
  ...
  <label className="flex items-start gap-2 text-xs text-on-surface-variant">
    <input
      type="checkbox"
      aria-label={t("auth.agreeTerms")}
      checked={agreed}
      onChange={(e) => { setAgreed(e.target.checked); if (agreeError) setAgreeError(""); }}
      className="mt-0.5 h-4 w-4 rounded border-outline accent-primary"
    />
    <span>
      <Trans i18nKey="auth.agreeTerms">
        <Link to="/terms" className="text-primary hover:opacity-80" />
      </Trans>
    </span>
  </label>
  {agreeError && <p className="text-xs text-error">{agreeError}</p>}
```

> 用 `<Trans>` 而不是拼字符串——协议文案里内嵌链接，拼接会在其他语种语序下错位。`Trans` 已随 `react-i18next` 提供，无需新依赖。
> 复选框保持 `rounded`（4px），不要 `rounded-full`。

`onSubmit` 里先校验 `agreed`、再校验两次密码一致，最后才调 `registerWithPassword`。

- [ ] **Step 4: 四份 locale + 两端薄壳（同 Task 13 的写法）**

- [ ] **Step 5: 跑测试与门禁**

```bash
pnpm --filter @yuanchat/ui test && pnpm check
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/auth/ packages/ui/src/index.ts apps/web/src/pages/ apps/desktop/src/pages/ \
        packages/design-system/src/i18n/locales/
git commit -m "feat(auth): 登录注册页下沉共享组件并补确认密码与协议勾选"
```

---

## Task 15: `QrLoginScreen` 下沉 + 真二维码 + 轮询

现状：`let s = 31337` 伪随机串（web `:44` / desktop `:50`）拼成假二维码，`scanning` / `confirmed` 两个状态永远不会被触发。

**二维码库选型规则**（不要凭印象装）：

1. 候选优先 `qrcode.react`（纯 React、无 canvas 依赖可选 SVG 渲染）。
2. 装之前**必须**确认产物不含 `?.` / `??` / 顶层 await——es2019 目标下这些会让旧 WebView 白屏（教训见 `08b4e88`）：
   ```bash
   pnpm --filter @yuanchat/ui add qrcode.react
   grep -rn "?\.\|??" node_modules/qrcode.react/lib/*.js | head
   pnpm build:pkg && grep -rn "?\." apps/web/dist/assets/*.js | head
   ```
   若命中，改用 SVG 渲染入口或换库，**不要**降低 `build.target`。
3. 依赖必须声明在 `packages/ui/package.json`（用到它的包），不是根 package.json。

**Files:**

- Create: `packages/ui/src/auth/QrLoginScreen.tsx`
- Modify: `packages/ui/src/index.ts`、`packages/ui/package.json`
- Rewrite: `apps/{web,desktop}/src/pages/QrLoginPage.tsx`
- Modify: `packages/design-system/src/i18n/locales/*.json`
- Test: `packages/ui/src/auth/QrLoginScreen.test.tsx`

**Interfaces:**

- Consumes: `AuthShell`、`createQrSession` / `pollQrSession`（Task 12）、`useAuthStore` 的 token 落盘方法
- Produces: `export function QrLoginScreen(props: { topSlot?: ReactNode; onLoggedIn?: () => void }): JSX.Element`

**新增 i18n key**：`auth.qrScanned`（已扫描，请在手机上确认）、`auth.qrExpired`（二维码已过期）、`auth.qrRefresh`（刷新二维码）、`auth.qrExpiresIn`（`{{seconds}} 秒后过期`）。

- [ ] **Step 1: 写失败测试**

```tsx
it("挂载即创建会话并渲染二维码", async () => {
  renderWithRouter(<QrLoginScreen />);
  expect(createQrSession).toHaveBeenCalledTimes(1);
  expect(await screen.findByTestId("qr-canvas")).toBeInTheDocument();
});

it("轮询到 scanned 时提示在手机确认", async () => {
  vi.mocked(pollQrSession).mockResolvedValueOnce({ state: "scanned", expiresIn: 100 });
  renderWithRouter(<QrLoginScreen />);
  await vi.advanceTimersByTimeAsync(2000);
  expect(await screen.findByText("auth.qrScanned")).toBeInTheDocument();
});

it("轮询到 confirmed 时落盘 token 并回调", async () => {
  const onLoggedIn = vi.fn();
  vi.mocked(pollQrSession).mockResolvedValueOnce({
    state: "confirmed",
    expiresIn: 0,
    tokens: { accessToken: "a", refreshToken: "r", expiresIn: 900 },
  });
  renderWithRouter(<QrLoginScreen onLoggedIn={onLoggedIn} />);
  await vi.advanceTimersByTimeAsync(2000);
  expect(onLoggedIn).toHaveBeenCalled();
});

it("会话 404 后停止轮询并展示过期与刷新入口", async () => {
  vi.mocked(pollQrSession).mockRejectedValue(new ApiError(404, "auth.qr_expired"));
  renderWithRouter(<QrLoginScreen />);
  await vi.advanceTimersByTimeAsync(2000);
  expect(await screen.findByText("auth.qrExpired")).toBeInTheDocument();
  vi.mocked(pollQrSession).mockClear();
  await vi.advanceTimersByTimeAsync(6000);
  expect(pollQrSession).not.toHaveBeenCalled(); // 过期后不许继续打接口
});

it("卸载后不再轮询", async () => {
  const { unmount } = renderWithRouter(<QrLoginScreen />);
  unmount();
  vi.mocked(pollQrSession).mockClear();
  await vi.advanceTimersByTimeAsync(6000);
  expect(pollQrSession).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @yuanchat/ui test -- QrLoginScreen
```

Expected: FAIL

- [ ] **Step 3: 实现**

```tsx
const POLL_INTERVAL_MS = 2000;

/**
 * 扫码登录页
 *
 * @description 创建会话 → 渲染二维码 → 每 2s 轮询状态 → confirmed 时落盘 token。
 * 倒计时以服务端返回的 expires_in 为准，不在前端自行推算 TTL。
 */
export function QrLoginScreen({ topSlot, onLoggedIn }: QrLoginScreenProps) {
  const { t } = useTranslation();
  const [qrToken, setQrToken] = useState("");
  const [state, setState] = useState<QrState | "expired">("pending");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const setTokens = useAuthStore((s) => s.setTokens);

  const start = useCallback(async () => {
    try {
      const s = await createQrSession();
      setQrToken(s.qrToken);
      setSecondsLeft(s.expiresIn);
      setState("pending");
    } catch {
      setState("expired");
    }
  }, []);

  useEffect(() => {
    void start();
  }, [start]);

  // 轮询：会话未就绪、已确认或已过期时都不发请求
  useEffect(() => {
    if (!qrToken || state === "confirmed" || state === "expired") return;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const st = await pollQrSession(qrToken);
        if (cancelled) return;
        setSecondsLeft(st.expiresIn);
        setState(st.state);
        if (st.state === "confirmed" && st.tokens) {
          setTokens(st.tokens);
          onLoggedIn?.();
        }
      } catch {
        if (!cancelled) setState("expired"); // 404 即过期，停止轮询
      }
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [qrToken, state, setTokens, onLoggedIn]);

  return (
    <AuthShell icon={<QrCode size={28} />} title={t("auth.qrLogin")} topSlot={topSlot}>
      {state === "expired" ? (
        <div className="text-center">
          <p className="text-on-surface-variant text-sm">{t("auth.qrExpired")}</p>
          <Button className="mt-4 w-full" onClick={() => void start()}>
            {t("auth.qrRefresh")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="rounded-lg bg-white p-3" data-testid="qr-canvas">
            <QRCodeSVG value={`yuanchat://login?t=${encodeURIComponent(qrToken)}`} size={200} />
          </div>
          <p className="text-on-surface-variant text-sm">
            {state === "scanned" ? t("auth.qrScanned") : t("auth.qrHint")}
          </p>
          <p className="text-on-surface-variant text-xs">
            {t("auth.qrExpiresIn", { seconds: secondsLeft })}
          </p>
        </div>
      )}
    </AuthShell>
  );
}
```

> `setTokens` 若 `authStore` 里没有等价的公开方法，就在 store 上补一个（写入 `accessToken` / `refreshToken` / `expiresAt` 并拉一次 `/users/me` 填 `user`），**不要**在组件里直接改 store 内部字段。

- [ ] **Step 4: 两端薄壳 + 四份 locale**

- [ ] **Step 5: 跑测试与门禁 + 打包验证**

```bash
pnpm --filter @yuanchat/ui test && pnpm check && pnpm build:pkg
```

Expected: PASS，且打包产物无 `?.` / `??`（见选型规则第 2 条）

- [ ] **Step 6: Commit**

```bash
git add packages/ui/ apps/web/src/pages/QrLoginPage.tsx apps/desktop/src/pages/QrLoginPage.tsx \
        packages/design-system/src/i18n/locales/
git commit -m "feat(auth): 扫码登录页渲染真实二维码并接入轮询"
```

---

## Task 16: Android 原生扫码接线

用户会连 USB 真机调试，这一 Task 的验收必须在真机上做。

**⚠️ 禁止执行 `tauri android init`**——会重新生成 `gen/android/` 并摧毁 `MainActivity.kt` 里的软键盘 WindowInsets 适配。Manifest 与 Kotlin 只能手工编辑。

**Files:**

- Modify: `apps/desktop/src-tauri/gen/android/app/src/main/AndroidManifest.xml`（相机权限）
- Modify: `apps/desktop/src-tauri/capabilities/`（新增 Android 平台限定 capability，**不进 `default.json`**）
- Modify: `apps/desktop/src-tauri/Cargo.toml` / `src/lib.rs`（注册扫码插件）
- Create: `packages/ui/src/auth/ScanQrEntry.tsx`（已登录端的扫码入口）
- Modify: `packages/ui/src/SettingsScreen.tsx` 或聊天页 `+` 菜单（挂入口）

**五个接线点：**

| #   | 位置                | 内容                                                                                                                                              |
| --- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | AndroidManifest.xml | `<uses-permission android:name="android.permission.CAMERA"/>` + `<uses-feature android:name="android.hardware.camera" android:required="false"/>` |
| 2   | Cargo.toml          | 扫码插件依赖（见下方选型步骤）                                                                                                                    |
| 3   | `src/lib.rs`        | `.plugin(tauri_plugin_barcode_scanner::init())`（仅 Android/iOS 编译）                                                                            |
| 4   | capabilities        | Android 限定 capability 声明插件权限                                                                                                              |
| 5   | 前端入口            | `ScanQrEntry` 调插件取扫码结果 → 校验 scheme → `scanQr` → 用户确认 → `confirmQr`                                                                  |

**两条硬约束：**

- **权限名禁止猜测**：查 Tauri 官方 barcode-scanner 插件 permissions 表，逐个核对名字与平台，写进 Android 限定 capability。
- **扫码结果必须校验 scheme**：只接受 `yuanchat://login?t=`，其余内容一律提示「非本应用二维码」——否则任意二维码都会被当 token 提交。

- [ ] **Step 1: 选型与权限核对（先查文档再动手）**

```bash
# 确认插件版本与 Tauri 2 匹配、以及它声明的权限名
pnpm --filter @yuanchat/desktop add @tauri-apps/plugin-barcode-scanner
grep -rn "permissions" node_modules/@tauri-apps/plugin-barcode-scanner/README.md | head
```

把查到的权限名逐条记在提交信息里。**查不到就停下来问，不要猜。**

- [ ] **Step 2: 改 Manifest 与 capability**

```xml
<!-- AndroidManifest.xml：相机为可选特性，无相机设备仍可安装 -->
<uses-permission android:name="android.permission.CAMERA" />
<uses-feature android:name="android.hardware.camera" android:required="false" />
```

- [ ] **Step 3: 注册插件（仅移动端目标编译）**

```rust
    // 条码扫描仅在移动端可用，桌面端不编译进去
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());
```

- [ ] **Step 4: 实现 `ScanQrEntry`**

```tsx
/** 从二维码内容中取出扫码登录 token；非本应用二维码返回 null。 */
export function parseLoginQr(raw: string): string | null {
  const prefix = "yuanchat://login?t=";
  if (!raw.startsWith(prefix)) return null;
  const token = raw.slice(prefix.length);
  return token.length > 0 ? decodeURIComponent(token) : null;
}
```

组件流程：`scan()` → `parseLoginQr` → 为 null 就提示 `auth.qrNotOurs` → 否则 `await scanQr(token)` → 弹确认对话框（`ConfirmDialog`，`packages/ui/src/index.ts:23` 已导出）→ 确认后 `await confirmQr(token)` → 成功提示。

`parseLoginQr` 单测（纯函数，不需要真机）：

```tsx
it.each([
  ["yuanchat://login?t=abc", "abc"],
  ["https://evil.example/?t=abc", null],
  ["yuanchat://login?t=", null],
  ["", null],
])("parseLoginQr(%s)", (input, want) => {
  expect(parseLoginQr(input)).toBe(want);
});
```

- [ ] **Step 5: 真机验收（USB 调试）**

```bash
pnpm build:pkg                      # 先本地打包验证
pnpm --filter @yuanchat/desktop tauri android dev   # 连 USB 真机
```

真机上逐项确认：① 首次扫码弹相机权限；② 拒权后有可读提示不崩；③ 扫非本应用二维码给出提示；④ 扫本应用二维码后桌面/web 端在 2s 内变「已扫描」；⑤ 手机确认后另一端完成登录；⑥ 软键盘顶起适配未被破坏（回归项，因为动了 `gen/android/`）。

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/ packages/ui/src/auth/ScanQrEntry.tsx packages/ui/src/index.ts \
        packages/design-system/src/i18n/locales/ apps/desktop/package.json
git commit -m "feat(auth): Android 接入原生扫码并校验二维码来源"
```

---

## Task 17: MSW handler + E2E

**Files:**

- Modify: `apps/web/src/mocks/handlers.ts`（先 `ls apps/web/src/mocks/` 确认实际路径）
- Create: `apps/web/e2e/forgot-password.spec.ts`
- Create: `apps/web/e2e/qr-login.spec.ts`

- [ ] **Step 1: 补 MSW handler**

六个端点各一条：`/auth/password/otp` → 204；`/auth/password/verify` → `{reset_ticket:"mock-ticket",expires_in:600}`；`/auth/password/reset` → 204；`/auth/qr/session` → `{qr_token:"mock-qr",expires_in:120}`；`GET /auth/qr/:token` → 前两次 `pending`、第三次 `confirmed` 带 mock token（用模块级计数器驱动）；`scan`/`confirm` → 204。

- [ ] **Step 2: 写 E2E**

```ts
test("忘记密码三步走通", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByPlaceholder(/手机号|phone/i).fill("13800138000");
  await page.getByRole("button", { name: /发送验证码|send/i }).click();
  await page.getByPlaceholder(/验证码|code/i).fill("123456");
  await page.getByRole("button", { name: /下一步|next/i }).click();
  await page.getByPlaceholder(/^新密码|new password/i).fill("Abcdef12");
  await page.getByPlaceholder(/确认新密码|confirm/i).fill("Abcdef12");
  await page.getByRole("button", { name: /确认修改|confirm/i }).click();
  await expect(page.getByText(/重置成功|reset success/i)).toBeVisible();
});

test("扫码登录轮询到确认后进入主界面", async ({ page }) => {
  await page.goto("/qr-login");
  await expect(page.getByTestId("qr-canvas")).toBeVisible();
  await expect(page).toHaveURL(/\/(chat)?$/, { timeout: 15_000 });
});
```

- [ ] **Step 3: 跑 E2E**

```bash
cd apps/web && pnpm test:e2e
```

Expected: 两个 spec 通过

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/mocks/ apps/web/e2e/
git commit -m "test(web): 补认证补充链路的 Mock 与端到端用例"
```

---

## Task 18: 收紧 CSP 与 HSTS

**Files:**

- Modify: `apps/desktop/src-tauri/tauri.conf.json`（`"csp": null`）
- Modify: `deploy/nginx/*.conf`（HSTS 注释行；先 `grep -rn "Strict-Transport-Security" deploy/` 定位）

- [ ] **Step 1: 写出白名单 CSP**

```json
"security": {
  "csp": "default-src 'self'; img-src 'self' data: blob: http://localhost:9002; media-src 'self' blob:; connect-src 'self' http://localhost:8085 ws://localhost:8086; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'"
}
```

> `style-src` 必须留 `'unsafe-inline'`——Tailwind 运行时与内联 `style` 属性（`cursor-glow` 的 `left`/`top`、`--app-height`）都依赖它。生产域名要替换 `localhost` 那三处；`connect-src` 漏了 WS 端口会让长连接静默失败。

- [ ] **Step 2: 桌面端 + Android 真机双验**

```bash
pnpm build:pkg
pnpm --filter @yuanchat/desktop tauri dev        # 桌面：看 devtools console 有无 CSP 报错
pnpm --filter @yuanchat/desktop tauri android dev # 真机：重点验图片/贴纸/语音/WS
```

逐项确认：登录、图片消息、贴纸、语音、WebSocket 长连接、头像上传全部正常。**CSP 拦截在 console 里是 warning，界面上往往只是"图片不显示"，必须逐项点过。**

- [ ] **Step 3: 打开 HSTS**

取消 nginx 里 `Strict-Transport-Security` 的注释，`max-age=31536000; includeSubDomains`。**先不加 `preload`**——preload 一旦提交到浏览器列表就极难回退。

```bash
docker compose -f deploy/docker-compose.yml config >/dev/null && echo "compose 语法 OK"
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/tauri.conf.json deploy/
git commit -m "chore(security): 收紧桌面端 CSP 白名单并启用 HSTS"
```

---

## 收尾

- [ ] **全量门禁**

```bash
pnpm check && pnpm test && (cd server && go test -race ./...) && pnpm build:pkg
```

- [ ] **回写 MASTER_PLAN**：把 A8 各条目状态改为已完成，并把本计划里主动留下的债（统一 `/auth/*` 路由前缀、`AuthRequired` 层的 `token_version` 校验、多设备会话管理与单设备登出、真实短信 provider）登记进「未做清单」。**这一步不做，下个会话就再也不知道这些债存在。**

- [ ] **合并回 dev**

```bash
git checkout dev
git merge --no-ff feature/auth-completion
```

> 合并前确认 18 个 Task 的 commit 都在；**禁止 squash**（每个 Task 是独立可回溯单元）。

## 自检（写完计划后的复核结果）

| 检查项        | 结果                                                                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| spec 章节覆盖 | §1–§14 全部有对应 Task；§9 的 `cursor-glow` 开放项已在 Task 12 定案（进 shell，不做端区分）                                                                            |
| 占位符扫描    | 无 TBD / 「同上」；`strings.Repeat` 处已注明是示意写法                                                                                                                 |
| 类型一致性    | `GeneratePair(userID, deviceID, tokenVersion)` 在 Task 2 定义、Task 10 使用；`randomToken` 在 Task 8 定义、Task 10 复用；`QrStatus` / `ResetTicket` 前后端字段映射一致 |
| 已知偏离      | 后端 6 个端点合并为 Task 8/10/11 三个 Task（拆开无法独立验收）；i18n key 随文案所在 Task 提交，不单列 Task                                                             |
