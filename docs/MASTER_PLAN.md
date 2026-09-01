# 元聊 (YuanChat) — 即时通讯软件 总体计划书

## 一、项目概述

| 项目        | 说明                                                              |
| ----------- | ----------------------------------------------------------------- |
| 项目名称    | 元聊 (YuanChat)                                                   |
| 项目类型    | 即时通讯 (IM) 软件                                                |
| 开发模式    | GitFlow 工作流                                                    |
| 目标平台    | Web / Windows / macOS / Linux / Android / iOS / 平板              |
| 前端语言    | TypeScript                                                        |
| 前端框架    | React                                                             |
| 后端语言    | Go (Golang)                                                       |
| 容器化      | Docker Compose（开发与生产编排都在 `deploy/`，未使用 Kubernetes） |
| 文档位置    | `docs/` 目录（本文档所在目录）                                    |
| AI 辅助文档 | `AGENTS.md`（根目录约束）、`.claude/TROUBLESHOOTING.md`           |

---

## 二、技术架构（按推荐度排序）

### 2.1 前端技术方案

| 方案                         | 适用范围                | 推荐度     | 说明                                                                                                             |
| ---------------------------- | ----------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| **React (Vite) + Tauri 2**   | Desktop + Mobile + Web  | ⭐⭐⭐⭐⭐ | Rust 内核，同一套 React UI 全平台复用（Win/Mac/Linux/Android/iOS）；体积小、性能高                               |
| **React (Vite) + Capacitor** | Web / iOS / Android     | ⭐⭐⭐     | 曾评估但未采用：Tauri 2 已具备移动端能力，无需两套原生打包工具                                                   |
| **React Native**             | Mobile (Android/iOS)    | ⭐⭐       | 原生体验更好，但 `<View>`/`<Text>` 与 Web `<div>`/`<span>` 是两套渲染体系，Tailwind CSS 无法复用，团队维护成本高 |
| **Electron**                 | Desktop (Win/Mac/Linux) | ⭐⭐       | 成熟但体积大，Tauri 是更好的替代品                                                                               |

**最终采用方案（当前实现）：**

- **Web 端**：React 19 + TypeScript + Vite（`build.target=es2019` 兼容旧 WebView）
- **桌面端**：Tauri 2（Rust 内核 + WebView，Win/Mac/Linux 全覆盖）
- **移动端**：Tauri 2 Android（同一套 React UI，与桌面共享代码）
- **iOS**：Tauri 2 iOS（需 Apple Developer 账户，规划中）

> **为什么弃用 Capacitor？** Tauri 2 已原生支持移动端，同一套 React 代码 + Tailwind CSS 在
> 桌面/移动/Web 100% 复用；Capacitor 会引入独立的移动打包链路，团队维护成本翻倍。

> **macOS/iOS 构建说明**：无 macOS 本地设备时，通过 GitHub Actions 的 `macos-latest` runner
> 自动打包（已实现，见 `.github/workflows/release.yml`）；产物为 universal `.dmg`（Intel + M 系列）。
> iOS 需 Apple Developer 账户（$99/年）+ 证书 secrets，后续接入。

### 2.2 后端技术方案

**最终采用方案（当前实现）：Go 单体，单进程多监听**

| 组成             | 实现                                                                        |
| ---------------- | --------------------------------------------------------------------------- |
| HTTP/REST        | Gin，监听 `:8085`，路由前缀 `/api/v1`（装配在 `internal/router/router.go`） |
| WebSocket 长连接 | gorilla/websocket，独立监听 `:8086`，进程内 Hub 管理连接与帧分发            |
| 指标暴露         | Prometheus client，独立监听 `:9090/metrics`                                 |
| 数据访问         | GORM + goose 嵌入式 SQL 迁移（`internal/database/migrations/`）             |
| 分层             | handler → service → repository，构造与依赖注入集中在 `router.Setup`         |

同一个进程里起 REST、WebSocket、metrics 三个 `http.Server`（见 `server/cmd/server/main.go`），
共享同一套 service / repository 实例，**没有服务间 RPC**。

曾评估但**未采用**：拆分微服务 + gRPC 内部通信、独立 API 网关（Kong / 自研）。
当前规模下拆分只会增加部署、调试与本地开发成本，收益为负。

横向扩容的现状：presence 已支持 Redis Pub/Sub 跨实例广播（配置 `presence.backend=redis`），
但消息分发的 `Dispatcher` 仍是进程内 Hub 实现，多实例部署前需先补一层分布式分发。

### 2.3 通信协议

```
客户端 ──── HTTP/REST  :8085 ────┐
                                 ├──→ yuanchat-server（单进程 Go）
客户端 ──── WebSocket  :8086 ────┘      Gin 路由 + Hub 分发，共享 service/repository
                                              │
                                              ▼
                                PostgreSQL / Redis / MinIO
```

REST 承载增删改查与文件预签名；WebSocket 承载实时帧（消息投递、已读回执、正在输入、
presence、会话创建/变更/移除、reaction、角色变更等）。帧类型与载荷定义见
[`CHAT_API.md`](./CHAT_API.md)，服务端在 `server/internal/ws/protocol.go`。

---

## 三、系统架构图

```
┌──────────────────────────────────────────────────────────────┐
│                          客户端层                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │  Web 端  │  │  桌面端  │  │ Android  │  │ 管理后台 │     │
│  │React+Vite│  │ Tauri 2  │  │ Tauri 2  │  │React+Vite│     │
│  │   PWA    │  │Win/Mac/Lx│  │  签名APK │  │apps/admin│     │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘     │
└───────┼─────────────┼─────────────┼─────────────┼───────────┘
        └─────────────┴──────┬──────┴─────────────┘
                             │ HTTPS / WSS
                   ┌─────────▼──────────┐
                   │   Nginx（生产）    │ ← TLS 终止 + 反向代理 + 静态资源
                   │   certbot 续期     │
                   └─────────┬──────────┘
                             │
        ┌────────────────────▼─────────────────────┐
        │      yuanchat-server（单进程 Go 单体）    │
        │  :8085 REST (Gin)  :8086 WebSocket Hub   │
        │  :9090 /metrics                          │
        │  handler → service → repository          │
        └───┬───────────────┬───────────────┬──────┘
            │               │               │
   ┌────────▼─────┐  ┌──────▼──────┐  ┌─────▼──────┐
   │  PostgreSQL  │  │    Redis    │  │   MinIO    │
   │ 业务数据 +   │  │ 验证码/限流 │  │ 图片/文件/ │
   │ pg_trgm 检索 │  │ presence    │  │ 语音/头像  │
   └──────────────┘  └─────────────┘  └────────────┘

可观测性：Prometheus 抓 `:9090` → Grafana 看板；loki + promtail 收 zap 结构化日志；
前端异常走 Sentry。
```

> 单进程内 REST 与 WebSocket 共享 service/repository 实例，消息经进程内 Hub 直接投递给
> 目标连接，不经消息队列。多实例部署需先把 `Dispatcher` 换成分布式实现（presence 已可切
> Redis Pub/Sub）。

---

## 四、项目目录结构

```
yuanchat/
├── docs/                          # 📖 项目文档
│   ├── MASTER_PLAN.md            # 总体计划书（本文件）
│   ├── ARCHITECTURE.md           # 详细架构设计
│   ├── CHAT_API.md               # 聊天 REST 端点 + WebSocket 协议
│   ├── DB_SCHEMA.md              # 数据库设计 + 迁移
│   ├── DEVELOPMENT.md            # 开发与打包指南（启动/构建/调试/测试）
│   ├── ROADMAP.md                # 迭代路线图
│   ├── RELEASE.md                # 发版指南
│   ├── design/                   # UI/UX 设计规范（7 份专题 + README）
│   ├── deploy/                   # 部署文档（self-hosted.md / env.md）
│   ├── observability/            # 可观测性（logging.md）
│   └── superpowers/              # SDD 产物：specs/ 设计文档 + plans/ TDD 实施计划
│
├── AGENTS.md                     # AI Agent 指南（根目录，核心约束清单）
├── CHANGELOG.md                  # 变更日志（release-it + conventional-changelog 生成）
├── contracts/                    # 前后端黄金契约（message-send.golden.json）
├── .claude/                      # 🤖 Claude Code 项目配置
│   ├── TROUBLESHOOTING.md        # 按平台分类的踩坑记录
│   └── settings.local.json       # 本地权限设置
│
├── server/                       # 🔧 后端 Go 服务（单进程双端口：REST :8085 + WS :8086）
│   ├── go.mod
│   ├── Makefile                  # 后端本地任务（构建 / 测试 / vet）
│   ├── Dockerfile
│   ├── cmd/
│   │   ├── server/               # 主服务入口（REST + WS 网关 + Hub 分发 + metrics）
│   │   ├── migrate/              # goose 迁移单独执行（生产部署用）
│   │   ├── seed/                 # 开发种子数据（Alice/Bob/Carol 测试账号）
│   │   ├── gc/                   # 离线对象 GC（清理未被引用的 MinIO 对象）
│   │   └── genvapid/             # 生成 Web Push VAPID 密钥对
│   ├── internal/
│   │   ├── config/               # Viper 配置加载
│   │   ├── database/             # goose 迁移执行器 + migrations/（001…013，embed 进二进制）
│   │   ├── handler/              # HTTP handlers（user/conversation/message/contact/file/presence/
│   │   │                         #   favorite/sticker/report/admin/e2ee/push/captcha）
│   │   ├── middleware/           # 认证 / 限流 / CORS / 日志
│   │   ├── model/                # GORM 模型
│   │   ├── pkg/                  # jwt / password / shortid
│   │   ├── redis/                # Redis 客户端（图形验证码 / 限流 / 分布式 presence）
│   │   ├── repository/           # 数据访问层
│   │   ├── router/               # 路由装配
│   │   ├── service/              # 业务服务
│   │   ├── storage/              # MinIO 对象存储封装（预签名 URL / 桶策略）
│   │   └── ws/                   # WebSocket Hub + protocol 帧定义
│   └── config/config.yaml
│
├── apps/                         # 🎨 前端应用（pnpm workspace）
│   ├── web/                      # 🌐 Web (Vite + React 19)
│   │   ├── src/                  # 页面路由 + 应用壳
│   │   └── e2e/                  # Playwright E2E（含 pages/ POM + fixtures/）
│   ├── desktop/                  # 🖥️📱 Desktop + Mobile (Tauri 2)
│   │   ├── src/                  # React UI（复用 packages/ui）
│   │   └── src-tauri/            # Rust 内核 + 平台配置
│   │       ├── Cargo.toml
│   │       ├── tauri.conf.json
│   │       ├── capabilities/     # Tauri 2 权限声明（按平台分文件，桌面专属进 desktop.json）
│   │       └── gen/android/      # Tauri Android 生成的 Gradle 工程
│   └── admin/                    # 🛡️ 管理后台 (React + Vite)：用户封禁 / 审核队列 / 审计日志
│
├── packages/                     # 📦 前端共享包（workspace）
│   ├── shared/                   # 跨端共享：api/store/hooks/ws/utils
│   ├── ui/                       # React UI 组件库（跨端复用）
│   └── design-system/            # 设计令牌 + i18n 资源 + Tailwind preset
│
├── deploy/                       # 🚀 部署配置
│   ├── docker-compose.yml        # 开发环境（PostgreSQL/Redis/MinIO，镜像均钉版本号）
│   ├── docker-compose.prod.yml   # 生产编排（+ nginx / prometheus / grafana）
│   ├── logging.yml               # 日志栈（loki + promtail）
│   ├── install.sh / backup.sh    # 一键部署 / 备份脚本
│   ├── nginx/ grafana/ prometheus*.yml
│   └── init-scripts/             # DB 初始化 SQL
│
├── scripts/                      # 📜 脚本工具
│   ├── dev.mjs                   # 一键启动（web/desktop/android/server + 停止）
│   ├── build.mjs                 # 打包脚本
│   ├── check-env.mjs             # 环境检查（preinstall 钩子）
│   ├── check-i18n.mjs            # i18n 门禁（四语齐全 + 查代码实际使用的 key + 死键）
│   ├── check-theme-classes.mjs   # 主题门禁（颜色工具类必须在色板内）
│   └── sync-version.mjs          # release-it 用：同步版本到子包与 tauri.conf.json
│
├── .github/workflows/            # ⚙️ CI/CD
│   ├── ci.yml                    # push 到 dev / 目标 dev 的 PR：i18n 门禁 + 前端 test + 双端 tsc + Playwright E2E + 后端 vet/test/-race
│   └── release.yml               # tag v* 触发：Web + Desktop 三平台 + Android 打包
│
├── turbo.json                    # Turborepo 任务编排
├── pnpm-workspace.yaml           # workspace 定义（apps/* + packages/*）
├── .release-it.json              # release-it 配置（requireBranch: main）
├── LICENSE
└── README.md                     # 项目说明
```

---

## 五、核心功能清单

### 阶段一：基础能力（MVP）✅ 全部完成

- [x] 用户注册/登录（手机号/邮箱 + 密码 + SVG 验证码，JWT 双 Token 静默刷新）
- [x] 单聊消息（文本 + 图片 + 文件 + 语音 + 表情回应）
- [x] 联系人管理（精确搜索 手机号/元聊号/邮箱、申请/接受/拒绝、字母分组好友列表）
- [x] 在线状态（Hub 首连/末连回调 → 广播好友 + REST 快照，`presence` 帧增量）
- [x] Web 端基础 UI（登录/注册/三端响应式聊天主界面）
- [x] 消息持久化存储（PostgreSQL，seq 会话内原子分配）

### 阶段二：核心体验 ✅ 全部完成

- [x] 群组聊天（建群 + 群管理五操作：改名/邀请/踢人/退群/解散，权限模型 role 0/1/2）
- [x] 图片/文件消息（MinIO 预签名直传，气泡 lucide 图标 + 预签名下载）
- [x] 语音消息（MediaRecorder + audio/webm，60s 自动截断，模块级单例播放器）
- [x] 消息已读/未读（last_read_seq 回执机制 + 未读角标）
- [x] 离线消息推送（Web Push：VAPID + Service Worker，仅推离线收件人并过滤免打扰；
      FCM / APNs 原生推送未接）
- [x] 桌面端基础版本（Tauri 2 Windows/macOS/Linux + Android，同一套 React UI）
- [x] 消息全文搜索（PostgreSQL `pg_trgm` GIN 索引，全局 + 会话内；未引入 Elasticsearch）
- [x] 桌面系统通知（Tauri notification plugin，失焦 + 非免打扰时弹）

### 阶段三：进阶功能

- [ ] 语音/视频通话 (WebRTC)
- [x] 端到端加密 E2EE（X3DH + Double Ratchet，仅单聊，用户自行开启，对方未启用降级明文）
- [x] 多设备消息同步（WS 协议已支持多设备推送 + 已读多端同步）
- [x] 移动端基础版本（Tauri 2 Android，签名 APK 已可通过 CI 打包）
- [ ] 聊天机器人/自动化
- [x] 消息引用/回复（UI + 后端 reply_to_id 联通）
- [x] 消息撤回/编辑（2 分钟撤回窗口 + 5 分钟内可「重新编辑」回填输入框）
- [x] 表情回应 Reactions（快捷 6 emoji 条 + 气泡 toggle + 历史聚合回填）
- [x] 消息转发（一次最多 9 个会话）/ `@` 提及 / 消息收藏
- [x] 贴纸与收藏表情（blob 内容寻址去重，独立 content type，前后端共用 golden 契约）

### 阶段四：企业级特性

- [ ] 组织架构/企业通讯录
- [ ] 企业审批应用（群公告已实现，企业级审批流未做）
- [ ] 开放 API / Webhook
- [ ] 数据统计面板（管理后台目前只有列表与工单，无聚合看板）
- [x] 管理员后台（`apps/admin`：用户封禁解封 / 会话解散 / 消息审核删除 / 举报处理，
      `/api/v1/admin/*` 走 JWT + `role=admin` 双重校验）
- [x] 审计日志（管理端写操作落 `admin_action_logs`，`GET /admin/audit-logs` 分页查询）
- [x] 内容安全（用户举报工单 + 敏感词 `flagged` 审核队列，命中不阻塞发送）
- [ ] 压测（消息列表虚拟滚动、检索索引、限流等前后端优化已做，系统性压测未做）

### 未做清单总览（单一真源）

> **本小节是「还有什么没做」的唯一真源。**`docs/ROADMAP.md` 只排批次顺序，
> `docs/superpowers/plans/*.md` 只在某功能即将实现时才写、写完即用于执行，**都不是真源**。
> 新发现的待实现项、主动留下的技术债，**当次登记到这里**——别的会话不知道你发现了什么，
> 漏登记等于永久丢失（已发生过：A6/A7 的 plan 被删后范围只剩会话记忆）。

**图例**：🔴 数据丢失/安全风险，必须优先 · 🟡 影响体验或可维护性 · ⚪ 增强项

#### 1. A8 — auth 补全与安全加固（**已完成，已合回 dev**）

设计：[`specs/2026-08-23-auth-completion-design.md`](superpowers/specs/2026-08-23-auth-completion-design.md)
执行：[`plans/2026-08-23-auth-completion.md`](superpowers/plans/2026-08-23-auth-completion.md)（18 Task）
分支：`feature/auth-completion`（自 dev @ `03baf6a` 切出，31 个 commit，`--no-ff` 合回 dev）
过程记录：`.superpowers/sdd/2026-08-23-auth-completion/`（ledger `progress.md`、裁决 `rulings.md`、批次报告 `batch-1-report.md` / `batch-2-report.md`、批 1 评审 `batch-1-review.md`）

> ⚠️ **plan 的代码块不可照抄**：pre-flight 证实它引用了不存在的包与符号（`response` 包、`internal/dto`、`jwt.Manager`、`model.UserStatusBanned`）、用了 slog（本仓 zap-only）、含编译不过的笔误，多处确切数值与 spec 相反。已正式降级为「意图草图」。
> **权威顺序：spec > `rulings.md` > 仓库真实代码 > plan（最低）。**

**已完成（Task 1-8，纯后端）**：`go build` + `go vet` + `go test -race ./...` 全绿，12 包通过、0 SKIP。

| 状态 | 条目                                                                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅   | 会话吊销：`users.token_version`（迁移 **014**）+ JWT `tv` 声明，`Refresh` 与 WS 建连校验（fail-closed）                                              |
| ✅   | 后端密码复杂度：`ValidatePasswordStrength`（8-64 **字节** / 大小写 / 数字 / 不含空白），注册路径已接                                                 |
| ✅   | `POST /auth/logout` 补齐，返 204 空体，**不递增 `token_version`**（无 device 表时会误踢该用户全部设备）                                              |
| ✅   | `Refresh` 补封禁 + 令牌版本校验，封禁返 403/40301；登录写 `last_login_at`；说谎注释已改                                                              |
| ✅   | `CodeSender` 抽象 + `LogSender`，未知 provider **启动即 FATAL**（已实测）；Sender 经 `router.Setup` 末位参数注入                                     |
| ✅   | 忘记密码**后端**三段式链路（`AuthService` + `AuthHandler`）：发码 → 校码换一次性 `reset_ticket`（`GetDel` 单次消费）→ 改密并原子自增 `token_version` |

**Task 9-18 全部完成**（含真机实测）：

| 状态 | 条目                                                                                                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ✅   | **Task 9** 账号级登录失败锁定（`auth:login:fail:{标识}`，5 次锁 15 分钟）。未注册号同样计数 —— 否则「已注册 429 / 未注册 401」就是一个用户枚举探针                                                                                               |
| ✅   | **Task 10** 扫码登录状态机 `pending → scanned → confirmed`，令牌在 confirm 签发、poll 用 Lua 原子取走即销毁                                                                                                                                      |
| ✅   | **加固（超出 plan）** 轮询绑定发起方：`poll_secret` 只随建会话响应下发、不进二维码，轮询须带 `X-Qr-Poll-Secret` 并做常量时间比较。否则拍到屏幕的人可抢先取走令牌                                                                                 |
| ✅   | **Task 11** 8 条新路由的真断言冒烟（按 D3 未引 swaggo）                                                                                                                                                                                          |
| ✅   | **Task 12** `doFetch` 在 `res.json()` 前短路 204；顺带修好 `deleteFriend` / `unblockUser` 两个既有 bug（打 204 端点却总抛 `SyntaxError`）                                                                                                        |
| ✅   | **Task 13** 忘记密码页接真接口并下沉共享组件：`ForgotPasswordPage` web 273 → 6 行、desktop 279 → 44 行                                                                                                                                           |
| ✅   | **Task 14** 前端密码规则统一到 spec 五条，长度按字节（`TextEncoder`）；删 `validation.passwordSpecial`                                                                                                                                           |
| ✅   | **Task 15** 扫码页接真接口并下沉：`QrLoginPage` 172/175 → 6/38 行，删掉写死的 60 秒过期，倒计时用服务端 `expires_in` 校准                                                                                                                        |
| ✅   | **Task 16** Android 原生扫码（`tauri-plugin-barcode-scanner` 2.4.5，权限名取自 crate 自带 `permissions/autogenerated/reference.md`，写进新建的 `capabilities/mobile.json`）。`parseLoginQr` 只接受 `yuanchat://login?t=`，其余判为非本应用二维码 |
| ✅   | **Task 17** MSW 补齐 8 个端点 + 忘记密码/扫码两个 E2E spec                                                                                                                                                                                       |
| ✅   | **Task 18** 桌面 CSP 由 `null` 改为白名单（`script-src 'self'`，另加 `object-src 'none'` / `base-uri 'self'` / `frame-ancestors 'none'`）；nginx HSTS 启用 `max-age=31536000; includeSubDomains`（按 brief 不加 `preload`）                      |
| ✅   | **超出 plan 的补齐**：登录态改密 `POST /auth/password/change`（凭当前密码，先验旧密码再验新密码强度）+ 设置页改密弹窗；CORS 放行 `X-Qr-Poll-Secret`；安卓返回键与沉浸式状态栏（见下）                                                            |

**真机与真后端实测结论**（不只是单测）：

| 项                  | 结论                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| curl 打真后端 27 项 | 登录/登出/改密三段式/登录锁定/扫码状态机全部符合契约；验证码日志已打码（`code=7****0`），要从 Redis 读真码才能续跑      |
| Playwright 打真后端 | dev 与生产构建各 14/15（唯一「失败」是测试脚本自己 `localStorage.clear()` 造成的 WS 400，正常登录与登出路径零 4xx/5xx） |
| 生产构建产物        | 21 个 JS 文件**零** `?.` / `??`，es2019 底线守住                                                                        |
| Android 真机        | 扫码登录全链路走通（用户确认）；相机权限弹框正常；返回键与沉浸式状态栏见下                                              |
| 桌面端 Tauri        | 新 CSP 下正常启动，真实会话数据加载，CSP 拦截日志 0 行                                                                  |

**过程中发现并修掉的既有缺陷**（非 A8 引入）：

| 缺陷                                          | 说明                                                                                                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CORS 缺 `X-Qr-Poll-Secret`                    | 浏览器预检直接拦死扫码轮询。Go 单测走 httptest 不做预检、MSW 在网络层之前拦截，两者都发现不了 —— 只有真浏览器打真后端才暴露。已补 `middleware` 首个测试文件钉住四个自定义头                                        |
| WebView 抢吃返回键                            | `android.webkit.WebView` 自己处理 KEYCODE_BACK（有历史就 `goBack()` 并吞掉），因此系统返回键在应用内一路失效、只在无历史时漏给 Activity 表现为「直接退出」。已在 `dispatchKeyEvent` 层截断并委托前端拦截栈         |
| 状态栏不沉浸                                  | 原本把状态栏高度作为 padding 加在内容视图上，留下一条与应用背景断开的空白。改为 WebView 铺到状态栏之下 + 原生下发 `--safe-area-top`；下发必须重试到真实文档就位（inset 回调早于页面加载，写在 about:blank 上会丢） |
| 测试夹具连接池只开不关                        | 全量跑撞 `53300 too many clients`，11 个用例静默变 SKIP。已限量 4/2 + `t.Cleanup` 关闭                                                                                                                             |
| `APP_VERSION` 手抄常量                        | 停在 `0.1.0` 与实际发版脱节，改读构建期注入的 `__APP_VERSION__`                                                                                                                                                    |
| `apps/web` 依赖缺失                           | `@sentry/vite-plugin`、`vite-plugin-pwa` 声明了但没装，dev server 起不来（`pnpm install --frozen-lockfile` 恢复，lockfile 零改动）                                                                                 |
| `packages/shared` / `packages/ui` 无 tsconfig | 两个包的 `typecheck` 脚本一直跑不了，即从未被单独类型检查（两端 app 的 tsc 会传递覆盖）。**未修，见下方留债**                                                                                                      |

**A8 期间沉淀的注意事项（后续批次仍适用）**：

| 事项                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **本地跑 E2E 前先确认没有残留 dev server**：Playwright 的 `reuseExistingServer` 会接管已在 5173 的进程，若那个进程是用 `VITE_ENABLE_MOCK=false` 起的，63 条用例会齐刷刷 30s 超时，看起来像代码全坏                                                                     |
| **`--safe-area-top` 由原生下发**：`.app-screen` 用它留出状态栏高度，`ToastHost` 的顶部偏移也叠了它。新增全屏浮层若贴顶，必须一并叠加，否则会压在系统时间/信号图标上                                                                                                    |
| **安卓返回键走前端拦截栈**：`registerBackInterceptor` 注册的拦截器倒序执行（后注册在更上层）。新增手机端「组件内部栈」（子页、抽屉、全屏弹层）必须注册拦截器，否则按返回会被当成「已在标签根页面」而触发退出应用                                                       |
| **不要照抄 `handler/captcha.go`**：它有先删再比、`rand.IntN`、key 无命名空间三个缺陷。`internal/service/auth_service.go` 是正确范式（比对成功才删、`crypto/rand`、key 带 `auth:` 命名空间、发送失败回滚已发的码）                                                      |
| **测试禁止依赖宿主语言环境**：Node 21 起 `navigator.language` 取自宿主 ICU locale（中文机器 `zh-CN`、GitHub runner `en-US`），依赖它的用例会「本地全绿、远程报错」。要固定语言就在 `vi.hoisted()` 里打 `navigator` 桩；本地自测用 `LANG=C.UTF-8 pnpm test` 对齐 runner |
| **新增自定义请求头必须同步 CORS**：`middleware/cors.go` 的 `Allow-Headers` 要逐个列出，浏览器预检不接受通配。`internal/middleware/cors_test.go` 已钉住现有四个头                                                                                                       |
| **i18n 占位符是 `%{var}`**（Rails 风格，见 `i18n/index.ts` 的 `interpolation.prefix`），写成 i18next 默认的 `{{var}}` 不会插值、直接把字面量上屏                                                                                                                       |

**已定裁决（沿用，不要重开讨论）**：

| 编号 | 裁决                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1   | 前后端密码规则**统一到 spec 的 5 条**：前端 `validatePassword` **删掉「特殊字符」**（连同 `validation.ts:47` 与 `__tests__/validation.test.ts:41`），**加**「≤64 字节」+「不含空白」；长度按**字节**算（`new TextEncoder().encode(pw).length`，Chrome 38+ 可用），**不能用 `.length`**；四份 locale **删** `validation.passwordSpecial`（不删会被 check:i18n 判死键）、**加** `passwordMaxLength` + `passwordNoWhitespace`。理由：后端从来没强制过特殊字符，非 web 客户端一直能注册 `Abcdef12`，那条前端规则是装饰性的、不是安全控制 |
| D1   | cursor-glow 用 `pointer: fine` 统一启用（`AuthShell` 内部 `matchMedia`，**不接 `isDesktop` prop**——`packages/ui` 组件断点一律内部 `useBreakpoint()` 推导）                                                                                                                                                                                                                                                                                                                                                                           |
| D3   | Task 11 降为「真断言冒烟」，不引 swaggo、不建 `server/docs/`。注：`@Summary` / `@Router` 注解注释是本仓既有约定（16 个 handler 共 50 处），**允许写注解，禁止引依赖**                                                                                                                                                                                                                                                                                                                                                                |
| —    | `token_version` **只在** `UserService.Refresh` 与 WS `ServeWS` 校验，**`AuthRequired` 中间件里绝不加**（spec 明确用「每请求不查库」换 ≤15 分钟残留窗口）                                                                                                                                                                                                                                                                                                                                                                             |

**A8 主动留债**（本批次明确不做，做完后仍留在本清单）：

| 级别 | 条目                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟡   | `/auth/*` 与 `/users/login`、`/users/register` 前缀不统一——统一是破坏性变更，需前后端同版发布                                                                                                                                                                                                                                                                                                                                                           |
| 🟡   | `AuthRequired` 中间件不校验 `token_version`（它当前零 IO；加校验需先给版本号做 Redis 缓存），改密后 access token 仍有最长 15 分钟残余有效期                                                                                                                                                                                                                                                                                                             |
| ⚪   | 多设备会话管理与「单设备登出」：无 device/session 表，`logout` 只能全量踢或不踢，本批次选不踢                                                                                                                                                                                                                                                                                                                                                           |
| ⚪   | 真实短信/邮件 provider：本批次只有 `LogSender`，`codesender.provider` 留了扩展位                                                                                                                                                                                                                                                                                                                                                                        |
| ⚪   | `verification_codes` 表只写审计不读，无审计查询入口                                                                                                                                                                                                                                                                                                                                                                                                     |
| ⚪   | Swagger 文档：Task 11 按 D3 不引 swaggo，**记债给 B7** 统一补                                                                                                                                                                                                                                                                                                                                                                                           |
| 🔴   | **生产环境对象存储不可达**：`YUANCHAT_MINIO_ENDPOINT` 在 `docker-compose.prod.yml` 里是内网主机名 `minio:9000`，而预签名 URL 与头像直链直接用该值，浏览器/客户端无法解析 → 生产图片、语音、头像全拿不到。修法：加 `DOMAIN_STORAGE` 子域 + nginx server 块 + 一个「对外端点」配置项（与 `Endpoint` 分开），并同步把该域名加进桌面端 CSP 的 `img-src` / `media-src` / `connect-src`。**A8 的 CSP 刻意只列真实可达主机，没有用 `https:` 通配去掩盖这个洞** |
| 🟡   | `/auth/password/otp` 未校验图形码（spec `:203` 的请求体含 `captcha_id` / `captcha_answer`）。单号轰炸已被 60s 冷却按死、枚举已被「未注册号响应完全相同」按死，图形码真正防的是跨 IP 喷洒造成的**短信成本**，而当前 provider 是 `LogSender`、喷洒零成本 —— 因此与「真实短信 provider」同批实现。注意补它会**改请求体**（多两个必填字段），属破坏性变更，前后端须同版发布                                                                                 |
| ⚪   | 扫码会话缺 `canceled` 终态（spec §7 提及）：用户当前只能关页面或等 120 秒过期，无安全影响                                                                                                                                                                                                                                                                                                                                                               |
| ⚪   | `scan` / `confirm` 两端点未加 `LimitByIP`（spec 未给额度，未自造数值）。两者都要 Bearer 令牌，滥用面已受限，待有真实流量数据再定                                                                                                                                                                                                                                                                                                                        |
| ⚪   | `packages/shared` 与 `packages/ui` 没有 `tsconfig.json`，两个包的 `typecheck` 脚本一直跑不了（两端 app 的 `tsc` 会传递覆盖到它们的源码，故并非完全没检查）。与「`.husky/` 不跑 tsc」同源                                                                                                                                                                                                                                                                |
| ⚪   | 改密后当前设备也会被登出（`token_version` 全量递增）。若要保留当前会话，需在改密响应里下发新令牌对                                                                                                                                                                                                                                                                                                                                                      |

#### 2. H1b — 贴纸商城与投稿发布（✅ 已完成，2026-08-30）

按 [`plans/2026-08-09-h1b-sticker-market.md`](superpowers/plans/2026-08-09-h1b-sticker-market.md) 执行完毕（迁移号 **015**），`feature/sticker-market` 分支。已交付：

- **商城**：`GET /sticker-packs/market`（`created_at DESC` 游标分页）、包详情、幂等添加/移除（`user_sticker_packs` 关系表非快照，发布者编辑实时生效）；`GET /sticker-packs` 语义扩展为「官方包 + 已添加的包」，EmojiPicker 零改动接入
- **投稿发布**：发布（collection 复制 / upload 直传两来源，包+贴纸同事务）、改名/换封面、增删贴纸、删包（级联）、我发布的；每用户发布上限 20（超限 400 + 业务码 4003）
- **治理**：包名敏感词打标 `flagged`（不阻塞发布）；`POST /reports` 支持 `target_type=sticker_pack`；admin 三端点（flagged 包检索 / 直接下架 / 清标记）+ admin 审核队列第三个 tab；下架 = `taken_down` 软下架（已添加者保留），举报处置「删除」对包执行下架
- **存储**：上传类别 `sticker-covers/` 公共读（独立桶策略 Statement）；发布封面自动以首张贴纸复制上传；商城/详情投影带 `first_sticker_key`，无封面包回退展示首图
- **前置缺陷修复**：`ReferencedKeys` 补 `sticker_packs.cover_url`（GC 误删封面）
- **三端实测中追加修复**：贴纸消息（kind=sticker）右键菜单缺「添加到表情」入口；发布封面因路由漏注入 PublicURL 转换静默丢库；封面缓存命中 onLoad 丢失占位不消失；认证四页磨砂卡片暗色适配；安卓返回键在商城子页落入「回聊天页」兜底（useStickerBack 拦截器 + 入口带 from）；设置页商城入口移到 About 上面；移除收藏页头商城按钮（入口收敛为设置页 + 表情选择器）
- 实测覆盖：Web（Playwright 暗亮双主题 + 移动视口 + admin 审核闭环）、Android（模拟器，底栏 4 项、返回键语义）、桌面（渲染走查）

| 级别 | 条目                                                                                                                                                                                                                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟡   | `GET /sticker-packs`（官方 + 已添加）仍无分页——集合小（官方包 + 用户添加数）尚可接受，包数量级上来再分页                                                                                                                                                                     |
| 🟡   | handler 集成测试直连 dev Postgres 且部分用例不清理（H1b 实测时 17 个测试包以 `is_public=true` 泄进商城列表）——测试需独立库/事务回滚                                                                                                                                          |
| 🟡   | WS 发送校验 `FindInAnyPack` 对**任何**表情包贴纸放行（未添加也可凭 sticker_id 发送，下架包贴纸同理）——与商城「公开内容」姿态一致暂不收紧，收紧需统一口径到「is_public 未下架 + 已添加」                                                                                      |
| ⚪   | 发布上限 20 / 单包贴纸上限 500 的校验是「先 COUNT 后 INSERT」两步，同一用户并发连发可少量越过上限（TOCTOU）。上限是防滥用软护栏、越界量以并发度为界、且全是用户自伤面，收紧需事务内 advisory lock（`pg_advisory_xact_lock(owner_id)`）或 serializable 重试，待有真实滥用再上 |
| ⚪   | 商城分类 / 搜索 / 热度排序未做（H1b-i 有意不做，需要时再加）                                                                                                                                                                                                                 |
| ⚪   | H1c 付费贴纸为候选，未立项（数据模型未预留 price 字段）                                                                                                                                                                                                                      |

#### 3. 既有代码的真实缺陷（无 plan，可随手批次收口）

| 级别 | 位置                                | 问题                                                                                                                                         |
| ---- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟡   | `handler/captcha.go:83-90`          | `Validate` 先 `Del` 再比较 → 用户输错一次验证码即被作废，只能重新获取                                                                        |
| 🟡   | `handler/captcha.go:52`             | captcha id 用 `math/rand/v2` 的 `rand.IntN(1000000)` → 会碰撞且非加密安全                                                                    |
| 🟡   | `middleware/ratelimit.go:92-107`    | 令牌桶是**进程内** map + mutex，多实例部署时各限各的，形同失效                                                                               |
| 🟡   | `.husky/` 钩子不跑 `tsc`            | 幽灵依赖与类型错误只在 CI 暴露（pnpm 本地提升掩盖）                                                                                          |
| 🟡   | `deploy/docker-compose.yml`         | minio / certbot / prometheus 三个镜像未钉版本号，仍是 `latest`                                                                               |
| ⚪   | `handler` 包 Redis 用例仍 `t.Skipf` | A8 已建 `internal/testutil.NewRedis(t) (*redis.Client, *miniredis.Miniredis)`（返回句柄供 `FastForward`），但 `handler` 包既有用例还没改用它 |
| ⚪   | 消息分发 `Dispatcher`               | 进程内 Hub，多实例需换分布式实现；presence 已可切 `presence.backend=redis`                                                                   |

#### 4. J 泳道 — 用户体验与无障碍（新增，未立项）

6.1 已承诺 WCAG 2.1 AA，但从未系统验证过。**这条泳道不是"新奇功能"，是把已承诺的质量补上。**

| 编号 | 条目                  | 说明                                                                     |
| ---- | --------------------- | ------------------------------------------------------------------------ |
| J1   | 键盘可达性与焦点管理  | 全部弹窗/抽屉做焦点陷阱与 Esc 关闭；Tab 序与可见焦点环；跳转到主内容链接 |
| J2   | 屏幕阅读器语义        | `aria-label` / `role` 系统化；新消息与在线状态用 live region 播报        |
| J3   | 快捷键一览表 + 自定义 | 现有快捷键无处可查；先出一览表，再考虑自定义                             |
| J4   | 骨架屏与 CLS 收敛     | MSW mock 已有，骨架屏未全覆盖；目标 CLS < 0.1                            |
| J5   | 空状态 / 错误态统一   | 各页空状态文案与插图各写一套，收敛成共享组件                             |
| J6   | 首次使用引导          | 新用户进来没有任何 onboarding                                            |
| J7   | 动效降级              | 尊重 `prefers-reduced-motion`；aurora orb / cursor-glow 应可关           |
| J8   | 字号缩放与大字体模式  | 系统字号放大时布局不应溢出                                               |
| J9   | 离线态与重连反馈      | WS 断线目前静默重连，用户不知道自己处于离线                              |
| J10  | i18n 文案质量         | ja-JP / ko-KR 为机翻，未经母语校对；key 集合已由 `check:i18n` 守住       |

#### 5. C5–C9 — 性能与容量（新增，未立项）

已做的是点状优化（虚拟滚动、`pg_trgm` 索引、限流）；**从未做过一次量化测量**。

| 编号 | 条目              | 目标与手段                                                                    |
| ---- | ----------------- | ----------------------------------------------------------------------------- |
| C5   | 首屏与包体        | 路由级 code split；依赖体积审计；es2019 产物大小基线与预算（超预算 CI 报警）  |
| C6   | 长列表与图片内存  | 虚拟滚动已有；缺图片解码节流与滚出视口后的内存回收，长会话滑久了会卡          |
| C7   | DB 慢查询         | 开 `pg_stat_statements`；排 N+1（会话列表 + 未读数 + 最后一条消息是重点嫌疑） |
| C8   | WS 吞吐与消息压测 | k6/vegeta 打并发连接与消息扇出，定 QPS 与 P99 目标（阶段四「压测」的具体化）  |
| C9   | 移动端启动与内存  | 旧机型 Chrome 74 WebView 冷启动时间、内存峰值；对照 `08b4e88` 的白屏教训      |

#### 6. B6–B9 — 文档与质量门禁（新增）

| 编号 | 条目               | 状态                                                                                                                         |
| ---- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| B6   | 四份主文档口径对齐 | ✅ 已完成（README / AGENTS / MASTER_PLAN / ROADMAP 端口与完成度）                                                            |
| B7   | CI 门禁补齐        | 待做：`tsc --noEmit`、`go vet`、覆盖率阈值（后端 80% / 前端 60%，6.2 已承诺未落地）；`docs/DB_SCHEMA.md` 按 001-013 迁移重建 |
| B8   | 测试基建           | 待做：`server/internal/testutil/`（DB + Redis 夹具）、前端统一 render helper                                                 |
| B9   | 压测与容量文档     | 待做：C8 产出的数字要落成文档，否则下次还得重测                                                                              |

---

## 六、设计原则

### 6.1 视觉设计

- **不过度参考 QQ/微信**：采用现代、简约的北欧风格（干净线条、留白、柔和阴影）
- **色彩方案**：以蓝灰为主色调，传达专业与可靠
- **暗黑模式**：从 Day 1 就支持
- **响应式**：移动端优先，再适配大屏
- **无障碍**：满足 WCAG 2.1 AA 级标准

### 6.2 工程规范

- **GitFlow 工作流**：`main` / `develop` / `feature/*` / `bugfix/*` / `release/*` / `hotfix/*`
- **Commit 规范**：Conventional Commits（`feat:` / `fix:` / `docs:` / `refactor:` 等）
- **Code Review**：每个 PR 至少一人 Review 通过后方可合并
- **测试覆盖率**：后端 ≥ 80%，前端 ≥ 60%（核心组件 100%）
- **CI/CD**：GitHub Actions 自动化构建、测试、部署

---

## 七、GitFlow 分支规范

| 分支        | 用途         | 命名示例                                       |
| ----------- | ------------ | ---------------------------------------------- |
| `main`      | 生产环境代码 | `main`                                         |
| `develop`   | 开发主线     | `develop`                                      |
| `feature/*` | 新功能开发   | `feature/user-login`、`feature/message-search` |
| `bugfix/*`  | Bug 修复     | `bugfix/login-error-handling`                  |
| `release/*` | 发布准备     | `release/v1.0.0`                               |
| `hotfix/*`  | 紧急生产修复 | `hotfix/v1.0.1-security-patch`                 |

---

## 八、Commit 信息规范

采用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

**类型 (type)** ：

- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `style`: 代码格式（不影响功能）
- `refactor`: 重构
- `perf`: 性能优化
- `test`: 测试相关
- `chore`: 构建/工具/依赖
- `ci`: CI/CD 配置变更

**示例：**

```
feat(chat): add real-time message delivery via WebSocket
fix(auth): resolve token refresh expiration bug
docs(api): update WebSocket protocol documentation
```

---

## 九、开发环境配置

### 9.1 所需工具

| 工具           | 版本要求                                 | 用途                 |
| -------------- | ---------------------------------------- | -------------------- |
| Go             | ≥ 1.25（`server/go.mod` 声明 1.25.7）    | 后端服务             |
| Node.js        | ≥ 20.19（仓库固定 22.23.0，见 `.nvmrc`） | 前端构建             |
| pnpm           | ≥ 10（`packageManager` 钉 10.22.0）      | 包管理               |
| Docker         | ≥ 26.x                                   | 容器运行时           |
| Docker Compose | ≥ v2.27                                  | 服务编排             |
| Rust           | latest stable                            | Tauri 桌面端与移动端 |
| Android Studio | latest                                   | Android 构建         |
| Xcode          | latest                                   | iOS 构建（仅 macOS） |

### 9.2 快速启动

依赖服务（PostgreSQL / Redis / MinIO）、种子数据、后端、前端全部由 `pnpm dev:*` 一键编排。
**不要手敲底层命令** —— docker / goose / go run / vite 的启动参数与就绪等待都封装在
`scripts/dev.mjs` 里，绕过它会漏掉迁移与健康检查。

```bash
git clone <repository-url> yuanchat
cd yuanchat
pnpm install          # 安装依赖（preinstall 跑 check-env.mjs 校验 Node/Go/Rust 版本）

pnpm dev:web          # 真实后端 + Web：docker(pg/redis/minio) → seed → Go 服务 → Vite
pnpm dev:web:mock     # 免后端：MSW Mock + demo 数据
pnpm dev:desktop      # 真实后端 + Tauri 桌面窗口
pnpm dev:android      # 真实后端 + Tauri Android（自动 adb reverse 8085/8086）
pnpm dev:server       # 仅后端
pnpm dev:stop         # 停止全部（应用进程 + docker 容器）
```

后端监听 **REST :8085 + WS :8086**（见 `server/config/config.yaml`）。分步启动、打包、测试与门禁
命令的完整表格见 [`DEVELOPMENT.md`](./DEVELOPMENT.md)。

---

## 十、数据库选型

| 数据库            | 用途                                | 推荐度     |
| ----------------- | ----------------------------------- | ---------- |
| **PostgreSQL**    | 用户、群组、关系等结构化数据        | ⭐⭐⭐⭐⭐ |
| **Redis**         | 会话缓存、在线状态、消息队列        | ⭐⭐⭐⭐⭐ |
| **MinIO**         | 文件/图片/语音存储（兼容 S3）       | ⭐⭐⭐⭐⭐ |
| **Elasticsearch** | 消息全文搜索                        | ⭐⭐⭐⭐   |
| **MongoDB**       | 消息历史归档（可选替代 PostgreSQL） | ⭐⭐⭐     |

**实际采用**：PostgreSQL + Redis + MinIO 三件套。消息全文搜索用 PostgreSQL 的 `pg_trgm`
GIN 索引实现（`migrations/003_message_search_index.sql`），**未引入 Elasticsearch**；
MongoDB 亦未引入，消息历史留在 PostgreSQL。Redis 用于图形验证码、限流与分布式 presence，
未用作消息队列。

---

## 十一、安全设计

- [x] HTTPS/TLS 全链路加密（生产 nginx TLS 1.2/1.3 + certbot 自动续期，
      `X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy` 已下发；
      HSTS 默认注释关闭，待证书稳定后开启）
- [x] JWT + Refresh Token 鉴权（access 15m / refresh 168h，滑动轮换）
- [x] 密码 bcrypt 哈希（cost 12）
- [x] SQL 注入防护（GORM 参数化查询）
- [ ] XSS 防护：输入校验已做（Gin binding 校验 + 服务端约束，React 默认转义），
      但 **Content-Security-Policy 未下发**（nginx 无 CSP 头，Tauri `csp` 为 `null`）
- [ ] CSRF Token（**未做**；当前鉴权走 Authorization 头而非 Cookie，风险有限）
- [x] 速率限制（`middleware.LimitByIP`，注册/登录/刷新/上传/举报等端点按档位限流）
- [x] WebSocket 连接认证（`?token=` 传 access token，`jwt.Validate` 校验后才升级）
- [x] 文件上传类型/大小校验（`upload.allowed_types` 白名单 + `max_file_size` 100MB）
- [x] 端到端加密（X3DH + Double Ratchet，仅单聊，用户自行开启）

---

## 十二、交付节奏

按批次迭代交付，版本与批次的映射见 [`ROADMAP.md`](./ROADMAP.md)，逐版本变更见
[`CHANGELOG.md`](../CHANGELOG.md)。tag 名与计划阶段并非严格对应，实际交付内容以 CHANGELOG 为准。

| 版本   | 交付内容                                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| v0.1.0 | MVP：认证、单聊（文本/图片/文件/语音/reactions）、联系人、在线状态、群聊、Web + 桌面 + Android 骨架、CI/CD                           |
| v0.2.0 | 删好友与黑名单、群角色管理、@提及 / 引用回复 / 转发、Sentry 错误监控、goose 迁移 + Prometheus 指标 + Grafana 看板、E2E 接 CI         |
| v0.3.0 | 端到端加密（单聊）、管理后台 + 内容审核、ja-JP / ko-KR 翻译 + i18n CI 门禁、分布式 Presence、PWA、生产部署编排、后端端口改 8085/8086 |

发版由 tag `v*` 触发 GitHub Actions 打包 Web + 桌面三平台 + Android，流程见
[`RELEASE.md`](./RELEASE.md)。

---

## 十三、文档索引

| 文档                                                   | 内容                             | 状态        |
| ------------------------------------------------------ | -------------------------------- | ----------- |
| [MASTER_PLAN.md](./MASTER_PLAN.md)                     | 总体计划书                       | ✅ 已完成   |
| [ARCHITECTURE.md](./ARCHITECTURE.md)                   | 详细架构设计                     | ✅ 已完成   |
| [CHAT_API.md](./CHAT_API.md)                           | 聊天 REST API + WebSocket 协议   | ✅ 已完成   |
| [DB_SCHEMA.md](./DB_SCHEMA.md)                         | 数据库设计 + goose 迁移工作流    | ✅ 已完成   |
| [DEVELOPMENT.md](./DEVELOPMENT.md)                     | 开发与打包指南（启动/测试）      | ✅ 持续更新 |
| [ROADMAP.md](./ROADMAP.md)                             | 迭代路线图（批次 → 版本映射）    | ✅ 持续更新 |
| [RELEASE.md](./RELEASE.md)                             | 发版指南（release-it + CI 签名） | ✅ 已完成   |
| [design/](./design/)                                   | UI/UX 设计规范（7 份专题）       | ✅ 已完成   |
| [deploy/self-hosted.md](./deploy/self-hosted.md)       | 自托管部署（域名/证书/备份）     | ✅ 已完成   |
| [deploy/env.md](./deploy/env.md)                       | 环境变量清单                     | ✅ 已完成   |
| [observability/logging.md](./observability/logging.md) | 结构化日志 + loki 查询           | ✅ 已完成   |
| [superpowers/](./superpowers/)                         | SDD 产物：specs/ + plans/        | ✅ 持续更新 |
| [../CHANGELOG.md](../CHANGELOG.md)                     | 变更日志（release-it 自动生成）  | ✅ 持续更新 |
