# 设计文档：auth 补全与安全加固（批次 A8）

> 日期：2026-08-23
> 批次：**A8**（见 [ROADMAP](../../ROADMAP.md#a8--auth-补全与安全加固1-15-周-进行中)）
> 迁移号：**014**（012/013 已被 H1 与对象 ACL 占用，H1b 顺延到 015）

### 分支与基线

| 项       | 值                                                                               |
| -------- | -------------------------------------------------------------------------------- |
| 基线     | **`dev`**（当前 HEAD `799e050`，另需先并入 `feature/plan-refresh` 的 `bc4ae8d`） |
| 工作分支 | `feature/auth-completion`，从 `dev` 切出                                         |
| 收口     | 完成后 `feature/auth-completion` → **`dev`**，`git merge --no-ff`                |

约束（来自项目既定流程，不可变更）：

- **禁止直接提交到 `dev` / `main`**，一切改动走 `feature/*` 分支
- feature → dev **必须 `--no-ff`**，保留每个独立 commit，**禁止 squash**
- dev → main 需**当次**征询用户同意，不延续历史授权
- Commit message **不带版本号前缀**（不写 `feat(v0.6/A8):`，版本归属由 tag 记录）
- 完整功能做完再提交，**禁止逐点提交**

前置动作（在切 `feature/auth-completion` 之前必须完成）：
本轮的文档改动（ROADMAP 新泳道、本设计文档、A8/H1b 计划、10 份恢复的历史 plan）
连同 `bc4ae8d` 都还在 `feature/plan-refresh` 上未合入 dev。
**先把 `feature/plan-refresh` `--no-ff` 合进 `dev`**，再从 dev 切 A8 分支，
否则新分支上看不到本计划。

## 一、背景：两条已对用户开放的假链路

这不是「新功能开发」，而是**修复两条会骗用户的已上线链路**。两个入口都挂在登录页上，
用户点得到、走得完、看得到成功提示，但后端什么都没发生。

| 链路               | 入口                | 表面行为                     | 实际行为                                                                         |
| ------------------ | ------------------- | ---------------------------- | -------------------------------------------------------------------------------- |
| `/forgot-password` | `LoginPage.tsx:119` | 三步走完显示「密码重置成功」 | **密码根本没改**：三个 handler 各是 `await new Promise(r => setTimeout(r, 500))` |
| `/qr-login`        | `LoginPage.tsx:124` | 显示二维码，60 秒后过期      | **二维码不编码任何 token**：canvas 手绘 21×21 伪码，xorshift 种子 31337          |

证据（web 与 desktop 各一份，共 4 个文件、约 900 行重复代码）：

- `apps/web/src/pages/ForgotPasswordPage.tsx:43,61,85` — 三处 `setTimeout(r, 500)` 假异步
- `apps/desktop/src/pages/ForgotPasswordPage.tsx:49-50,68-69,93-94` — 同上，另带 3 条
  `// TODO: 接入后端找回密码接口（当前仅走本地表单流程）`
- `apps/web/src/pages/QrLoginPage.tsx:44` / `apps/desktop/src/pages/QrLoginPage.tsx:50` —
  `let s = 31337;` 伪随机填格；`:88`/`:93` 一个 60 秒 `setTimeout` 直接置 `expired`
- 两份 QrLoginPage 的 `scanning` / `confirmed` 状态是**死代码**，无任何路径能进入
- 「重新发送」按钮（`ForgotPasswordPage.tsx:210`）只调 `startCountdown()`，**不发请求**

顺带一提，`/forgot-password` 与 `/qr-login` 是全仓**唯一两个零测试覆盖的页面**——
这正是缺陷能活到今天的原因。

### 本轮新发现的两条真实缺陷

审计过程中发现两个与 auth 相关、但此前未登记的问题，一并纳入本批次：

1. **`Refresh` 漏 banned 校验**（`server/internal/service/user_service.go:186-195`）
   注释写着「用户被注销/封禁后 refresh 立即失效」，代码只判了 `user == nil`：

   ```go
   // 用户被注销/封禁后 refresh 立即失效   ← 注释在说谎
   user, err := s.repo.FindByID(ctx, claims.UserID)
   if err != nil { return nil, fmt.Errorf("find user: %w", err) }
   if user == nil { return nil, ErrInvalidRefresh }
   // 缺: if user.Status == model.UserStatusDisabled { return nil, ErrUserBanned }
   ```

   后果：admin 封禁一个在线用户后，该用户只要在 refresh TTL（7 天）内刷新过一次，
   就能无限续期留在线上。`Login` 侧的校验（`:127-129`）形同虚设。

2. **`POST /api/v1/auth/logout` 路由不存在**
   前端 `authStore.ts:184` 一直在调，`router.go:184-193` 里没有这条路由，
   404 被前端 try/catch 吞掉，用户以为登出成功了。

## 二、范围与决策

### 已确认的决策（用户选择）

| #   | 决策项      | 结论                                                  | 理由                                                         |
| --- | ----------- | ----------------------------------------------------- | ------------------------------------------------------------ |
| 1   | 执行顺序    | auth 优先 → H1b → 文档收口                            | 假链路是信任缺陷，优先级高于新功能                           |
| 2   | 验证码通道  | `CodeSender` provider 抽象 + 开发期日志打码           | 无短信服务商账号也能端到端验证；生产期换 provider 不改调用方 |
| 3   | 扫码方案    | 真二维码 + Redis 状态机 + 桌面轮询 + Android 原生扫码 | 无需 WS 改造；轮询实现简单且状态可观测                       |
| 4   | auth 页结构 | 四页下沉 `packages/ui`，端差异用 props/slot 注入      | 消除 900 行重复；下沉后首次获得组件测试能力                  |
| 5   | 范围        | 两条假链路 + **P0 安全组**                            | 只修假链路会留下账号级暴破口                                 |
| 6   | OTP 存储    | Redis 热路径 + `verification_codes` 表留审计          | 复活死表，**迁移 014 不新增建表**                            |
| 7   | 会话吊销    | `users` 加 `token_version`，改密后全设备下线          | 仓库无任何 device/session 表，这是唯一可行的吊销钩子         |
| 8   | 文档债范围  | 可执行错误 + 四份主文档对齐 + 恢复被删 plan           | DB_SCHEMA 重建与门禁补齐移交 B7                              |

### P0 安全组（决策 5 的展开）

| 项                  | 现状问题                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| 账号级失败锁定      | `middleware/ratelimit.go:92-107` 的 `LimitByIP` **只有 IP 维度**，换 IP 即可对同一账号无限撞密码   |
| 后端密码复杂度      | `handler/user.go:205` 仅 `min=8,max=64`；前端 `validatePassword` 有 5 条规则，绕过前端即可设弱密码 |
| `/auth/logout` 路由 | 见上，前端一直在调的幽灵端点                                                                       |
| `Refresh` banned    | 见上，封禁不生效                                                                                   |
| 用户协议勾选        | `RegisterPage.tsx` **完全没有**协议勾选与确认密码字段                                              |
| CSP / HSTS          | `tauri.conf.json:25` 是 `"csp": null`；`deploy/nginx/ssl-params.conf:12` 的 HSTS 被注释掉          |

### 明确不做

以下均已登记进 [MASTER_PLAN 未做清单总览](../../MASTER_PLAN.md#未做清单总览单一真源)「auth 与安全类未做」，
本设计不再重复列举：2FA/TOTP、Passkey/WebAuthn、第三方 SSO、CSRF Token、
陌生 IP 二次验证、多设备管理与单设备踢下线、国际区号、「记住我」、两步式注册、
注册头像上传、密码强度条可视化、6 格 OTP 输入框、登录页三 Tab、
blur 即时校验与动效（归 J2）、注册成功引导页（归 J1）、Android `FLAG_SECURE`。

## 三、数据模型：迁移 014

迁移目录 `server/internal/database/migrations/`，现存 `001` … `013`（`013_object_acl_and_gc.sql`
为最后一个），通过 `//go:embed` 嵌入。014 只做**一件事**：

```sql
-- +goose Up
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE users DROP COLUMN IF EXISTS token_version;
```

### 为什么只有一列

| 需求            | 为什么不建表                                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OTP 存储        | `verification_codes` 表**已存在**（`001_baseline.sql:129-139`），字段 `target / code / type / expires_at / used / created_at` + 索引 `idx_vc_target_expires`，够用；这是一张从未被写入的死表，本批次让它复活 |
| 登录失败锁定    | 计数器是高频写、短生命周期、可丢失数据 → Redis 而非 Postgres                                                                                                                                                 |
| 扫码会话        | 60 秒生命周期的状态机 → Redis                                                                                                                                                                                |
| `last_login_at` | 列**已存在**（`model/user.go` 有 `LastLoginAt *time.Time`），只是登录成功时从未写入，属代码缺陷不是模型缺陷                                                                                                  |

`verification_codes.type` 是 `SMALLINT`，本批次约定枚举值（写进 `model` 常量）：

```go
const (
    VerificationTypeRegister      int16 = 1 // 预留，注册短信验证暂未启用
    VerificationTypePasswordReset int16 = 2 // 找回密码
)
```

## 四、会话吊销模型：`token_version`

### 问题

改密成功后，旧 access / refresh token 必须失效——否则「改密」对已被盗用的会话毫无意义。
但仓库**没有任何 device / session 表**，JWT 是纯无状态的：`middleware/auth.go` 的
`AuthRequired` 拿到 Bearer token 后只做 HMAC 验签 + `TokenUse == "access"` 检查，
然后 `c.Set("user_id", …)`，**零 DB / 零 Redis 读**。

### 设计

`Claims` 增加一个字段。全仓只有**一处** `Claims` 定义（`internal/pkg/jwt/jwt.go:16-21`），
所以是单点改动：

```go
type Claims struct {
    UserID       uuid.UUID `json:"uid"`
    DeviceID     string    `json:"did"`
    TokenUse     string    `json:"use"` // "access" or "refresh"
    TokenVersion int       `json:"tv"`  // 签发时的 users.token_version 快照
    jwt.RegisteredClaims
}
```

`GeneratePair` 签名相应变为 `GeneratePair(userID uuid.UUID, deviceID string, tokenVersion int)`。
改密成功时执行 `UPDATE users SET token_version = token_version + 1 WHERE id = ?`，
此后所有旧 token 的 `tv` 都落后于库里的值。

### 校验点：只在 refresh 与 WS 建连，**不在** `AuthRequired`

这是本设计最关键的取舍，理由是 I/O 成本：

| 校验点                | 现状 I/O                                 | 加校验的代价                         | 结论    |
| --------------------- | ---------------------------------------- | ------------------------------------ | ------- |
| `AuthRequired`        | 零                                       | **每个已认证请求多一次查库**         | ❌ 不加 |
| `UserService.Refresh` | 已有 `FindByID`（`user_service.go:190`） | **零额外代价**，顺手比较即可         | ✅ 加   |
| WS 建连 `ServeWS`     | 零（`ws/handler.go:107` 只验签）         | 每次建连多一次查库，但建连是低频动作 | ✅ 加   |

**收敛窗口**：access token TTL 是 15 分钟（`config/config.yaml`），所以改密后最坏情况下
旧 access token 仍能调用 REST 接口 **≤15 分钟**；但它无法续期（refresh 被拒），
也无法建立新的 WS 连接。这个残留窗口是**明确接受的取舍**，
换来的是不给每个请求增加一次数据库往返。

如果将来要做到「改密即刻全站失效」，正确做法是引入 Redis 版本号缓存 +
`AuthRequired` 读缓存，而不是直接查库——已登记进 MASTER_PLAN 未做清单，不在本批次。

### 顺带修掉 `Refresh` 的 banned 缺口

`token_version` 的比较点正好就是 banned 校验缺失的那几行，一起补：

```go
if user == nil { return nil, ErrInvalidRefresh }
if user.Status == model.UserStatusDisabled { return nil, ErrUserBanned }   // 新增
if claims.TokenVersion != user.TokenVersion { return nil, ErrInvalidRefresh } // 新增
```

注意：`ErrUserBanned` 已存在（`Login` 在 `user_service.go:127-129` 用过），无需新增哨兵错误。

## 五、忘记密码：三段式链路

### 端点

| 方法 | 路径                           | 请求                                  | 响应                         | 限流                          |
| ---- | ------------------------------ | ------------------------------------- | ---------------------------- | ----------------------------- |
| POST | `/api/v1/auth/password/otp`    | `{phone, captcha_id, captcha_answer}` | `204`                        | `LimitByIP(3,5)` + 手机号维度 |
| POST | `/api/v1/auth/password/verify` | `{phone, code}`                       | `{reset_ticket, expires_in}` | `LimitByIP(10,20)`            |
| POST | `/api/v1/auth/password/reset`  | `{reset_ticket, new_password}`        | `204`                        | `LimitByIP(5,10)`             |

三段式而非一次性提交，是为了匹配已有的三步 UI（`ForgotPasswordPage` 的 `Step = 1 | 2 | 3`），
让第 2 步能立即告知「验证码错了」，而不是等用户填完新密码才报错。

### 为什么要 `reset_ticket`，不能直接拿 code 改密

如果 `reset` 接口收的是 `{phone, code, new_password}`，那么 code 必须在 verify 之后**继续有效**，
等于把一个 6 位数字的有效期从「验证一次」拉长到「用户填完密码」。
改用一次性 ticket：verify 成功即**消费掉 OTP**并换发一个 `crypto/rand` 生成的
32 字节 ticket（Redis 存 5 分钟，用后立删）。OTP 的暴破面因此只有 verify 这一个入口。

### 存储布局

```
Redis（热路径）
  auth:pwd:otp:{phone}        = 6 位数字          TTL 5min   验证成功后 DEL
  auth:pwd:otp:cd:{phone}     = "1"               TTL 60s    发码冷却，存在即拒绝重发
  auth:pwd:otp:fail:{phone}   = 失败次数          TTL 15min  达 5 次锁定该手机号
  auth:pwd:ticket:{ticket}    = user_id           TTL 5min   reset 成功后 DEL

Postgres（审计，非热路径）
  verification_codes 每次发码 INSERT 一行；verify 成功时把该行 used = TRUE
```

Redis key 全部带 `auth:pwd:` 命名空间前缀。这是刻意与既有 captcha 实现区分——
`handler/captcha.go:52` 用的是 `fmt.Sprintf("captcha_%d", rand.IntN(1000000))`，
既没有命名空间、又用了会碰撞的 `math/rand/v2`。

### 与既有 captcha 实现的三处**刻意偏离**（不要照抄）

1. **不要先删再比**。`captcha.go:83-90` 的 `Validate` 是 `Get` 之后**无条件 `Del`**，
   再比较答案——用户手滑输错一位，验证码就废了，必须重新发。
   OTP 必须是 **比较正确才 DEL**；错误只递增 `fail` 计数器。
2. **不要用 `rand.IntN` 生成标识**。`captcha.go:52` 的 ID 空间只有 100 万，
   `math/rand/v2` 未加密安全，并发下会撞。OTP 码与 ticket 一律用 `crypto/rand`。
3. **不要无命名空间裸 key**。见上。

### 时序

```
用户            前端                      后端                     Redis / PG        CodeSender
 │  输手机号+图形码 │                          │                        │                 │
 │───────────────>│  POST /password/otp      │                        │                 │
 │                │─────────────────────────>│ 校验图形码              │                 │
 │                │                          │ 查冷却 cd:{phone} ─────>│                 │
 │                │                          │ 生成 6 位码(crypto/rand)│                 │
 │                │                          │ SET otp/cd ────────────>│                 │
 │                │                          │ INSERT verification_codes                │
 │                │                          │ Send(phone, code) ──────────────────────>│
 │                │<──── 204 ────────────────│                        │       (dev: 日志打码)
 │  输 6 位码      │                          │                        │                 │
 │───────────────>│  POST /password/verify   │                        │                 │
 │                │─────────────────────────>│ 查锁定 fail:{phone}     │                 │
 │                │                          │ GET otp 比较            │                 │
 │                │                          │ 对: DEL otp + used=TRUE │                 │
 │                │                          │ 错: INCR fail（不删 otp）│                 │
 │                │<─ {reset_ticket} ────────│ SET ticket ────────────>│                 │
 │  输新密码       │                          │                        │                 │
 │───────────────>│  POST /password/reset    │                        │                 │
 │                │─────────────────────────>│ GET ticket → user_id    │                 │
 │                │                          │ 后端密码复杂度校验       │                 │
 │                │                          │ bcrypt + token_version++ │                 │
 │                │<──── 204 ────────────────│ DEL ticket ────────────>│                 │
```

### 手机号不存在时的响应

**返回 `204`，与存在时完全一致**（响应体、状态码、耗时量级都不能有差异）。
否则该接口就成了一个「这个号码注册过没有」的枚举器。
真实情况只写进服务端日志。这一条要写进测试用例，防止后续重构时被「优化」成 404。

## 六、发码通道：`CodeSender` 抽象

新建 `server/internal/pkg/codesender/`：

```go
// Package codesender 提供验证码下发通道的抽象。
package codesender

// Sender 是验证码下发通道。实现方负责把 code 送达 target。
type Sender interface {
    // Send 向 target（手机号或邮箱）下发验证码 code。
    // 返回错误表示下发失败，调用方应回滚本次发码（删除 Redis 中的 otp 与冷却键）。
    Send(ctx context.Context, target, code string) error
}

// LogSender 把验证码打进日志，供开发与测试环境使用。
// 日志中的 code 按「首位 + 掩码 + 末位」打码，避免生产误用时验证码明文落盘。
type LogSender struct{ logger *slog.Logger }
```

- 开发期日志形如 `验证码已下发 target=138****8000 code=1****6 channel=log`
- 生产期换成 `AliyunSender` / `TencentSender`，**调用方代码不变**
- 通道由配置选择：`config.yaml` 增加 `codesender: { provider: log }`，
  `provider` 为未知值时**启动即失败**，不要静默退回 log（生产环境静默用 LogSender
  等于验证码永远发不出去，而且没人会发现）

## 七、扫码登录

### 角色

- **被扫端**（显示二维码）：web 浏览器 / 桌面端，**未登录**
- **扫码端**（扫二维码）：Android app，**必须已登录**——它用自己的 access token 为被扫端授权

### 状态机（Redis）

```
                POST /auth/qr/session
                        │
                        ▼
                    pending ──────── TTL 到期 ─────> (key 消失，轮询得 expired)
                        │
         POST /auth/qr/:token/scan（已登录端）
                        │
                        ▼
                    scanned ──────── TTL 到期 ─────> (同上)
                        │
      POST /auth/qr/:token/confirm（同一已登录端）
                        │
                        ▼
                   confirmed ─── 被扫端轮询取走一次 ──> (key 立即删除)
```

`canceled` 也是终态（扫码端点「取消」，或被扫端离开页面）。

Redis 布局，全部带命名空间：

```
auth:qr:{token}  = JSON{ status, user_id, scanned_at, access_token, refresh_token }  TTL 120s
```

`user_id` 在 scan 时写入；`access_token` / `refresh_token` 在 confirm 时生成并写入，
被扫端轮询到 `confirmed` 时用 **`GETDEL`** 语义取走——保证 token 只能被消费一次。

### 端点

| 方法 | 路径                             | 鉴权     | 说明                                                                                        |
| ---- | -------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| POST | `/api/v1/auth/qr/session`        | 无       | 返回 `{qr_token, qr_payload, expires_in}`；`qr_token` 为 32 字节 `crypto/rand` 的 base64url |
| GET  | `/api/v1/auth/qr/:token`         | 无       | 轮询。返回 `{status}`；`status == "confirmed"` 时额外返回 token 对并销毁会话                |
| POST | `/api/v1/auth/qr/:token/scan`    | **需要** | 扫码端标记已扫；返回 `{nickname, avatar_url}` 供扫码端确认页展示自己是谁                    |
| POST | `/api/v1/auth/qr/:token/confirm` | **需要** | 扫码端确认授权，签发 token 对写入会话                                                       |

### 安全约束（每条都要有对应测试）

1. **`crypto/rand`，不是 `math/rand`**。`qr_token` 是唯一凭据，被猜到即等于账号被盗。
   明确禁止照抄 `handler/captcha.go:52` 的 `rand.IntN` 写法。
2. **`scan` 与 `confirm` 必须是同一个 user**。confirm 时校验 `claims.UserID == 会话里的 user_id`，
   否则 A 扫码、B 确认就能把 A 的账号授权给被扫端。
3. **状态只能单向前进**。已 `confirmed` 的会话再次 confirm 返回 409；
   未 `scanned` 直接 confirm 返回 409。
4. **token 对只能被取走一次**，取走即删 key。
5. **轮询限流**：`GET /auth/qr/:token` 用 `LimitByIP(30, 60)`——前端 2 秒一次，
   120 秒最多 60 次，留一倍余量。
6. **被扫端拿到的 token 属于扫码端的 user**，`device_id` 用被扫端在 `session` 请求里声明的
   平台标识（`web` / `desktop`），不是扫码端的。

### `qr_payload` 的形态

二维码里编码的**不是裸 token**，而是带 scheme 前缀的串：

```
yuanchat://login?t=<qr_token>
```

扫码端必须校验前缀，前缀不匹配直接提示「不是有效的登录码」——
避免用户扫了别的二维码后，把随机字符串当 token 发给后端。

### TTL 与前端倒计时

TTL 定为 **120 秒**（当前 UI 硬编码 60 秒，对「掏出手机 → 解锁 → 打开 app → 扫 → 确认」偏紧）。
前端倒计时**必须用后端返回的 `expires_in` 初始化**，不能再写死
`setTimeout(() => setStatus("expired"), 60000)`（`QrLoginPage.tsx:88`）——
否则后端调 TTL 时前端会与服务端不一致。

## 八、P0 安全组

### 8.1 账号级失败锁定

现状：`middleware/ratelimit.go:92-107` 的 `LimitByIP` 用 `c.ClientIP()` 做 key，
且限流器是**进程内 map + mutex**（`rl.buckets`），不是 Redis。
攻击者换 IP 即可对同一账号无限撞密码。

新增 Redis 计数器（与 OTP 的失败计数同构）：

```
auth:login:fail:{phone}   = 失败次数   TTL 15min
```

- 登录失败 `INCR`；成功则 `DEL`
- 达到 **5 次**后，15 分钟内该账号的登录请求直接返回 `429` + `auth.accountLocked` 文案
- 计数以**账号**为 key，与 IP 限流**叠加**而非替代
- 锁定判断要在**校验密码之前**，否则锁定期间仍在做 bcrypt，等于留了个 CPU 消耗入口

### 8.2 后端密码复杂度

现状 `handler/user.go:205` 只有 `binding:"required,min=8,max=64"`，
而前端 `validatePassword` 有 5 条规则。绕过前端直接打接口即可设 `12345678`。

在 service 层新增 `validatePasswordStrength(pw string) error`，规则与前端**逐条对齐**
（长度 8-64、含小写、含大写、含数字、不含空白），注册与改密**两条路径共用**。
错误码复用既有校验错误形态，文案走 i18n key。

### 8.3 补 `/auth/logout` 路由

前端 `packages/shared/src/store/authStore.ts:184` 一直在调，路由不存在。
既然本批次引入了 `token_version`，logout 就有了真实语义：

```go
api.POST("/auth/logout", middleware.AuthRequired(cfg.JWT), userH.Logout)
```

`Logout` 只做一件事：`token_version + 1`。这会把该用户**所有设备**都踢下线。

> 注意这是一个**产品语义决策**：因为没有 device/session 表，无法只吊销当前设备。
> 「在一台设备上登出 = 所有设备登出」需要用户确认是否接受。
> 若不接受，替代方案是 logout 只清前端本地 token（即维持现状的行为，仅补路由返回 204），
> 把真正的单设备吊销留到多设备管理批次。**本设计默认取后者**（logout 返回 204 且不动
> `token_version`），理由是全量踢下线对用户是意外行为；`token_version` 只在**改密**时递增。

### 8.4 注册页补确认密码 + 用户协议勾选

`RegisterPage.tsx` 里 grep `confirm|agree|terms|protocol|checkbox` **零命中**——两项都没有。
补：确认密码字段（与 `ForgotPasswordPage` 第 3 步同构）、协议勾选 checkbox（未勾选禁用提交按钮）。
协议正文本身不在本批次（无法凭空写法律文本），链接先指向占位路由并在 MASTER_PLAN 未做清单登记。

### 8.5 CSP 与 HSTS

- `apps/desktop/src-tauri/tauri.conf.json:25` 现为 `"csp": null`，即**完全不启用** CSP。
  改为显式白名单，至少限制 `default-src 'self'`、`connect-src` 限定后端地址与 WS，
  `img-src 'self' data: blob:`（头像与对象存储需要）。
  ⚠️ 改完**必须真机验证**：CSP 收紧最容易打挂的就是 WS 连接与 MinIO 图片加载。
- `deploy/nginx/ssl-params.conf:12` 的 HSTS 头被注释，取消注释。
  ⚠️ HSTS 有粘滞性（浏览器会记住），先不加 `preload`，`max-age` 从较小值起步。

## 九、前端：四页下沉 `packages/ui`

### 现状

8 个文件、**1657 行**，web/desktop 两两高度重复：

| 页面               | web | desktop | diff 行数 |
| ------------------ | --- | ------- | --------- |
| LoginPage          | 142 | 181     | 95        |
| RegisterPage       | 197 | 238     | 73        |
| ForgotPasswordPage | 273 | 279     | 314       |
| QrLoginPage        | 172 | 175     | 133       |

### 实测出的真实端差异（只有三类）

1. **desktop 有 `TitleBar`**（Tauri 窗口控制按钮），web 没有 → 用 **slot prop** 注入
2. **web 有 `cursor-glow`** 鼠标跟随光效，desktop 没有 → 见下方决策
3. **导航方式不同**：web 用 `<Link>`，desktop 用 `useNavigate()` → 统一为 `<Link>`，
   `packages/ui` **已经依赖 `react-router-dom ^7.0.0`**（`packages/ui/package.json:42`，
   `MainLayout.tsx:26` 已在用 `Link` / `useLocation` / `Outlet`），所以不需要注入导航回调

网络与状态同理不需要注入：`packages/ui` 已可直接用 `packages/shared` 的
`api/client.ts` 与 `store/authStore.ts`。

### 组件边界

```
packages/ui/src/auth/
  AuthShell.tsx          // 背景装饰 + 磨砂卡片 + titleBar slot，四页共用
  LoginScreen.tsx
  RegisterScreen.tsx
  ForgotPasswordScreen.tsx
  QrLoginScreen.tsx
```

props 签名（**严格遵守既有范式**）：

```tsx
export function AuthShell({ titleBar, children }: { titleBar?: ReactNode; children: ReactNode });
export function QrLoginScreen({
  titleBar,
  onNativeScan,
}: {
  titleBar?: ReactNode;
  /** 原生扫码能力；仅 Android 注入，未注入时不渲染「扫一扫」入口 */
  onNativeScan?: () => Promise<string>;
});
```

**禁止把 `isDesktop` / `isMobile` 作为 prop 传进 `packages/ui`。**
断点在组件内部自行用 `useBreakpoint()` 推导——这是仓库既有范式：
`SettingsScreen.tsx:56`、`ChatScreen.tsx:227`、`ContactsScreen.tsx:107`、`MainLayout.tsx:92`
全都是内部 `const isMobile = bp === "mobile"`，唯一的 prop 是 slot（`aboutExtra?: ReactNode`）。

`apps/*/src/pages/*.tsx` 收敛成薄壳：

```tsx
// apps/desktop/src/pages/QrLoginPage.tsx
import { QrLoginScreen } from "@yuanchat/ui";
import { TitleBar } from "../components/TitleBar";
import { scanQrCode } from "../native/scanner";

export function QrLoginPage() {
  return <QrLoginScreen titleBar={<TitleBar />} onNativeScan={scanQrCode} />;
}
```

### 需人确认的小决策：`cursor-glow`

web 独有的鼠标跟随光效，桌面端同样有鼠标。建议**下沉到 `AuthShell` 并对
`matchMedia("(pointer: fine)")` 为真的环境统一启用**——即桌面端会新获得这个光效。
这是一次刻意的视觉统一，而非 bug。若不希望桌面端有该效果，则加 `cursorGlow?: boolean` prop
（默认 `true`，desktop 传 `false`）。

### 二维码生成库

仓库**当前没有任何二维码库**（已 grep 全部 `package.json`）。需新增一个依赖到
**`packages/ui`**（因为组件在这里渲染），并遵守：

- **必须在 `packages/ui/package.json` 显式声明**——pnpm 的幽灵依赖在本地会被提升掩盖，
  但 CI 会挂
- 必须兼容 `build.target=es2019`（Chrome 74 WebView）：选型时确认其产物不含
  `?.` / `??` / 顶层 await
- 优先选纯函数式、能输出 SVG 的轻量库（SVG 比 canvas 好：可缩放、可做暗色适配、
  截图测试稳定）

## 十、Android 原生扫码

仓库里**零痕迹**——没有扫码插件、没有 CAMERA 权限、没有相关 capability。需要 5 个接线点：

| #   | 位置                                                        | 动作                                                                     |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | `apps/desktop/package.json`                                 | 声明扫码插件的 JS 侧依赖                                                 |
| 2   | `apps/desktop/src-tauri/Cargo.toml`                         | 声明插件 crate                                                           |
| 3   | `apps/desktop/src-tauri/capabilities/`                      | 权限**只进 Android 平台限定的 capability 文件，不进 `default.json`**     |
| 4   | `apps/desktop/src-tauri/gen/android/**/AndroidManifest.xml` | **手工**加 `<uses-permission android:name="android.permission.CAMERA"/>` |
| 5   | `apps/desktop/src/native/scanner.ts`                        | 封装 `scanQrCode(): Promise<string>`，非 Android 环境返回 reject         |

### 两条硬约束

1. **权限名禁止猜测**。必须查 Tauri 官方 permissions 表确认插件暴露的确切权限标识，
   并按平台校验；桌面专属权限进 `desktop.json`，Android 专属权限进 Android capability。
   历史上因为猜权限名导致过 Android 打包失败（见 `main` 分支 `49d91ec`）。
2. **禁止执行 `tauri android init`**。它会重新生成 `gen/android/`，
   **摧毁 `MainActivity.kt` 里的软键盘 WindowInsets 适配**——那是 edge-to-edge 下
   顶起输入框的唯一实现，web 侧信号全部失效，重做代价极高。
   Manifest 只能手工编辑。

### 权限被拒的处理

用户拒绝相机权限后，必须给出可操作提示（`auth.cameraPermissionDenied`），
而不是静默失败或反复弹窗。扫码入口保留，点按后再次尝试。

## 十一、i18n

`auth.*` 命名空间下已有 61 个 key。以下 key **不存在，必须新增**，
四个 locale（zh-CN / en-US / ja-JP / ko-KR）**同一 commit 一起补齐**：

| key                           | 用途                       |
| ----------------------------- | -------------------------- |
| `auth.otpRequired`            | 未填验证码                 |
| `auth.agreeTerms`             | 「我已阅读并同意」         |
| `auth.termsOfService`         | 用户协议链接文案           |
| `auth.privacyPolicy`          | 隐私政策链接文案           |
| `auth.accountLocked`          | 账号被锁定（失败次数超限） |
| `auth.qrScanning`             | 扫码中 / 待确认            |
| `auth.cameraPermissionDenied` | 相机权限被拒               |

已存在、可直接用的：`auth.otpWrong`、`auth.sendFailed`、`auth.resetFailed`。

约束：`scripts/check-i18n.mjs` 是三层 CI 门禁，校验**四个 locale 的 key 集合与占位符集合完全一致**。
它**不校验行序**，所以不必纠结插入位置，但**少一个 locale 就会挂**。
UI 文案一律 `t()`，禁止硬编码。

## 十二、测试策略

### 后端

⚠️ **前置障碍**：`internal/handler` 包**没有 Redis 测试辅助**，现有涉及 Redis 的测试是
`t.Skipf` 跳过的。A8 是第一批真正需要它的测试。

因此 A8 内部先建最小可用的测试夹具（`miniredis` + 一个 `newTestRedis(t)` 辅助），
**不做**完整的 `internal/testutil/` 基建——那是批次 B8 的范围，A8 只借道。

用例清单（每条对应上文一个约束）：

| 用例                          | 断言                                           |
| ----------------------------- | ---------------------------------------------- |
| 发码后 60 秒内重发            | 被冷却拒绝                                     |
| **OTP 输错**                  | **返回错误，且 Redis 里 otp key 仍存在**       |
| OTP 连错 5 次                 | 第 6 次返回锁定                                |
| OTP 正确                      | 换发 ticket，otp key 被删，DB 行 `used = TRUE` |
| ticket 用两次                 | 第二次失败                                     |
| 手机号不存在                  | 返回 204，与存在时无差异                       |
| 改密后用旧 refresh token      | 被拒（`token_version` 不匹配）                 |
| 改密后用旧 access token 建 WS | 被拒                                           |
| 被封禁用户 refresh            | 被拒（补上的 banned 校验）                     |
| 弱密码走接口直接改密          | 被后端复杂度校验拒绝                           |
| A 扫码、B confirm             | 被拒                                           |
| 未 scan 直接 confirm          | 409                                            |
| confirmed 会话轮询两次        | 第二次拿不到 token                             |
| 登录成功                      | `last_login_at` 被写入                         |

### 前端

四页下沉到 `packages/ui` 后**首次获得组件测试能力**（此前在 `apps/*` 无测试）。
覆盖：三步流转、错误态渲染、倒计时按钮禁用、未勾选协议时提交按钮禁用、
`onNativeScan` 未注入时不渲染扫一扫入口。

### E2E

新增 `e2e/forgot-password.spec.ts` 与 `e2e/qr-login.spec.ts`，遵循既有 POM 范式。
MSW 需补 handler：密码重置三段、QR 四端点、以及**当前缺失的 `refresh`**（顺带补）。

### 真机

USB 连真机验证：Android 扫码授权 web/desktop 登录全链路、相机权限拒绝路径、
CSP 收紧后 WS 与图片加载正常、软键盘顶起行为未被破坏。
`adb reverse` 端口用真值 `8085` / `8086`。

## 十三、验收清单

- [ ] `/forgot-password` 走完后，**用新密码能登录、旧密码不能登录**（这是本批次的核心验收）
- [ ] `/qr-login` 的二维码用系统相机扫描能识别出 `yuanchat://login?t=...`（证明是真码）
- [ ] Android app 扫码 + 确认 → web/desktop 自动登录成功
- [ ] OTP 输错不消费验证码，重输正确仍可通过
- [ ] 改密后所有设备的 refresh 与新建 WS 均被拒
- [ ] 被封禁账号无法通过 refresh 续期
- [ ] 同一账号连续 5 次密码错误后被锁定 15 分钟，换 IP 无效
- [ ] 绕过前端直接调接口无法设置弱密码
- [ ] 注册页未勾选协议时无法提交
- [ ] 四个 locale 的 i18n 门禁通过（`pnpm` 脚本跑 `check-i18n`）
- [ ] `apps/web` 与 `apps/desktop` 的 4 个 auth 页面均为薄壳，无重复业务逻辑
- [ ] 本地打包全绿：web build + tsc + tauri build + Android aarch64 APK
- [ ] 真机验证 CSP 收紧后 WS / 图片正常，软键盘适配未回退

## 十四、风险与已接受的取舍

| 风险 / 取舍                                   | 处置                                                               |
| --------------------------------------------- | ------------------------------------------------------------------ |
| 改密后旧 access token 仍有 ≤15 分钟有效期     | **明确接受**（见 §4），换取不给每请求加一次查库                    |
| CSP 收紧可能打挂 WS 或 MinIO 图片             | 必须真机验证；出问题就按最小必要放宽 `connect-src` / `img-src`     |
| HSTS 有浏览器粘滞性                           | 不加 `preload`，`max-age` 从小值起步                               |
| Android 权限名或 capability 写错导致打包失败  | 查官方 permissions 表，按平台拆 capability，本地先打 APK 验证      |
| `tauri android init` 会摧毁软键盘适配         | **禁止执行**，Manifest 手改                                        |
| 二维码库产物含 ES2020 语法导致旧 WebView 白屏 | 选型时确认，`build.target=es2019` 下本地打包 + 真机验证            |
| logout 全量踢下线是意外行为                   | 默认 logout **不动** `token_version`，仅改密时递增（见 §8.3）      |
| 短信通道未接真实服务商                        | `CodeSender` 抽象已就位；provider 未知值**启动即失败**，不静默退回 |
