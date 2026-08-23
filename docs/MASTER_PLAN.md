# 元聊 (YuanChat) — 即时通讯软件 总体计划书

## 一、项目概述

| 项目        | 说明                                                   |
| ----------- | ------------------------------------------------------ |
| 项目名称    | 元聊 (YuanChat)                                        |
| 项目类型    | 即时通讯 (IM) 软件                                     |
| 开发模式    | GitFlow 工作流                                         |
| 目标平台    | Web / Windows / macOS / Linux / Android / iOS / 平板   |
| 前端语言    | TypeScript                                             |
| 前端框架    | React                                                  |
| 后端语言    | Go (Golang)                                            |
| 容器化      | Docker Compose（开发环境），Kubernetes（生产环境可选） |
| 文档位置    | `docs/` 目录（本文档所在目录）                         |
| AI 辅助文档 | `.claude/` 目录、`AGENTS.md`、`CLAUDE.md`              |

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

> **为什么弃用 Capacitor？** 详见 `.claude/CLAUDE.md` 的"跨平台策略"章节：Tauri 2 已原生支持
> 移动端，同一套 React 代码 + Tailwind CSS 在桌面/移动/Web 100% 复用；Capacitor 会引入独立的
> 移动打包链路，团队维护成本翻倍。

> **macOS/iOS 构建说明**：无 macOS 本地设备时，通过 GitHub Actions 的 `macos-latest` runner
> 自动打包（已实现，见 `.github/workflows/release.yml`）；产物为 universal `.dmg`（Intel + M 系列）。
> iOS 需 Apple Developer 账户（$99/年）+ 证书 secrets，后续接入。

### 2.2 后端技术方案

| 方案                         | 推荐度     | 说明                                                   |
| ---------------------------- | ---------- | ------------------------------------------------------ |
| **Go 微服务架构**            | ⭐⭐⭐⭐⭐ | 高性能、低资源消耗、类型安全；单仓库多服务（Monorepo） |
| **API 网关 + gRPC 内部通信** | ⭐⭐⭐⭐   | Kong / 自研网关；服务间使用 gRPC 高效通信              |
| **WebSocket 长连接服务**     | ⭐⭐⭐⭐⭐ | Go 的 goroutine 天然适合管理海量 WebSocket 连接        |

### 2.3 通信协议

```
客户端 ←→ WebSocket ←→ 长连接网关 (Go) ←→ gRPC ←→ 微服务集群
客户端 ←→ HTTP/REST ←→ API 网关 (Go)  ←→ gRPC ←→ 微服务集群
```

---

## 三、系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        客户端层                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Web 端  │  │ 桌面端   │  │  iOS 端  │  │Android端 │   │
│  │React+Vite│  │Tauri2+React││Tauri2+React│ │Tauri2+React│  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │             │             │             │          │
│       └─────────────┴──────┬──────┴─────────────┘          │
│                            │                                │
└────────────────────────────┼────────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │    Nginx/Envoy   │  ← 反向代理 & 负载均衡
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼───┐  ┌───────▼──────┐  ┌──▼──────────┐
     │  API 网关   │  │ 长连接网关   │  │  静态资源   │
     │  (HTTP)    │  │ (WebSocket)  │  │  (CDN/Nginx)│
     └────────┬───┘  └───────┬──────┘  └─────────────┘
              │              │
              └──────┬───────┘
                     │  gRPC
     ┌───────────────┼───────────────┐
     │               │               │
┌────▼────┐   ┌──────▼──────┐   ┌───▼───────┐
│用户服务  │   │  消息服务    │   │ 群组服务  │
└────┬────┘   └──────┬──────┘   └───┬───────┘
     │               │               │
┌────▼────┐   ┌──────▼──────┐   ┌───▼───────┐
│文件服务  │   │  通知服务    │   │ 会话服务  │
└────┬────┘   └──────┬──────┘   └───┬───────┘
     │               │               │
┌────▼────┐   ┌──────▼──────┐   ┌───▼───────┐
│搜索服务  │   │  机器人服务  │   │ 开放API   │
└─────────┘   └─────────────┘   └───────────┘
     │               │               │
     └───────────────┼───────────────┘
                     │
     ┌───────────────┼───────────────┐
     │               │               │
┌────▼────┐   ┌──────▼──────┐   ┌───▼───────┐
│PostgreSQL│   │   Redis     │   │   MinIO   │
│ 持久化存储│   │ 缓存/会话   │   │ 文件存储  │
└─────────┘   └─────────────┘   └───────────┘

     ┌───────────┐   ┌───────────────┐
     │Elasticsearch│  │ Prometheus +  │
     │ 消息搜索    │   │ Grafana 监控  │
     └───────────┘   └───────────────┘
```

---

## 四、项目目录结构

```
yuanchat/
├── docs/                          # 📖 项目文档
│   ├── 00_MASTER_PLAN.md         # 总体计划书（本文件）
│   ├── 01_ARCHITECTURE.md        # 详细架构设计
│   ├── 02_API_DESIGN.md          # API 接口设计
│   ├── 03_DB_SCHEMA.md           # 数据库设计
│   ├── 04_FRONTEND_GUIDE.md      # 前端开发指南
│   ├── 05_DEPLOYMENT.md          # 部署运维文档
│   └── 06_CHANGELOG.md           # 开发变更日志
│
├── .claude/                      # 🤖 AI 辅助文档
│   ├── CLAUDE.md                 # Claude 项目上下文
│   ├── MEMORY.md                 # 项目记忆索引
│   ├── settings.json             # Claude 项目设置
│   └── memories/                 # 持久化记忆文件
│
├── AGENTS.md                     # AI Agent 指南（根目录）
│
├── server/                       # 🔧 后端 Go 服务（单进程双端口：REST :8080 + WS :8081）
│   ├── go.mod
│   ├── cmd/
│   │   ├── server/               # 主服务入口（含 REST + WS 网关 + 内存 Hub 分发）
│   │   └── seed/                 # 开发种子数据（Alice/Bob/Carol 测试账号）
│   ├── internal/
│   │   ├── config/               # Viper 配置加载
│   │   ├── handler/              # HTTP handlers（user/conversation/message/contact/file/presence）
│   │   ├── middleware/           # 认证 / 限流 / CORS / 日志
│   │   ├── model/                # GORM 模型（user/conversation/message/reaction/friend_request）
│   │   ├── pkg/                  # jwt / password / shortid
│   │   ├── repository/           # 数据访问层
│   │   ├── router/               # 路由装配
│   │   ├── service/              # 业务服务（user/conversation/conversation_manage/message/contact）
│   │   ├── storage/              # MinIO 对象存储封装（预签名 URL / 桶管理）
│   │   └── ws/                   # WebSocket Hub + protocol 帧定义
│   └── config/config.yaml
│
├── apps/                         # 🎨 前端应用（monorepo workspace）
│   ├── web/                      # 🌐 Web (Vite + React 19)
│   │   ├── src/                  # 页面路由 + 应用壳
│   │   └── e2e/                  # Playwright E2E
│   └── desktop/                  # 🖥️📱 Desktop + Mobile (Tauri 2)
│       ├── src/                  # React UI（复用 packages/ui）
│       └── src-tauri/            # Rust 内核 + 平台配置
│           ├── Cargo.toml
│           ├── tauri.conf.json
│           ├── capabilities/     # Tauri 2 权限声明
│           └── gen/android/      # Tauri Android 生成的 Gradle 工程
│
├── packages/                     # 📦 前端共享包（workspace）
│   ├── shared/                   # 跨端共享：api/store/hooks/ws/utils
│   ├── ui/                       # React UI 组件库（跨端复用）
│   └── design-system/            # 设计令牌 + i18n 资源 + Tailwind preset
│
├── deploy/                       # 🚀 部署配置
│   ├── docker-compose.yml        # 开发环境（PostgreSQL/Redis/MinIO）
│   └── init-scripts/             # DB 初始化 SQL
│
├── scripts/                      # 📜 脚本工具
│   ├── dev.mjs                   # 一键启动（web/desktop/android/server + 停止）
│   ├── build.mjs                 # 打包脚本
│   └── sync-version.mjs          # release-it 用：同步版本到子包与 tauri.conf.json
│
├── .github/workflows/            # ⚙️ CI/CD
│   ├── ci.yml                    # 每次 push/PR：前端 test + tsc + 后端 vet/test/-race
│   └── release.yml               # tag v* 触发：Web + Desktop 三平台 + Android 打包
│
├── .release-it.json              # release-it 配置（requireBranch: main）
├── .gitignore
└── README.md                     # 项目说明
```

---

## 五、核心功能清单

> 进度更新于 2026-07-22（MVP 已完成，v0.1.0 发版准备就绪）

### 阶段一：基础能力（MVP — 第1~3个月）✅ 全部完成

- [x] 用户注册/登录（手机号/邮箱 + 密码 + SVG 验证码，JWT 双 Token 静默刷新）
- [x] 单聊消息（文本 + 图片 + 文件 + 语音 + 表情回应）
- [x] 联系人管理（精确搜索 手机号/元聊号/邮箱、申请/接受/拒绝、字母分组好友列表）
- [x] 在线状态（Hub 首连/末连回调 → 广播好友 + REST 快照，`presence` 帧增量）
- [x] Web 端基础 UI（登录/注册/三端响应式聊天主界面）
- [x] 消息持久化存储（PostgreSQL，seq 会话内原子分配）

### 阶段二：核心体验（第3~6个月）✅ MVP 部分完成

- [x] 群组聊天（建群 + 群管理五操作：改名/邀请/踢人/退群/解散，权限模型 role 0/1/2）
- [x] 图片/文件消息（MinIO 预签名直传，气泡 lucide 图标 + 预签名下载）
- [x] 语音消息（MediaRecorder + audio/webm，60s 自动截断，模块级单例播放器）
- [x] 消息已读/未读（last_read_seq 回执机制 + 未读角标）
- [ ] 离线消息推送（Web Push / FCM，未做）
- [x] 桌面端基础版本（Tauri 2 Windows/macOS/Linux + Android，同一套 React UI）
- [ ] 消息全文搜索（需 Elasticsearch，未做）
- [x] 桌面系统通知（Tauri notification plugin，失焦 + 非免打扰时弹）

### 阶段三：进阶功能（第6~9个月）— 计划中

- [ ] 语音/视频通话 (WebRTC)
- [ ] 端到端加密 (E2EE)
- [x] 多设备消息同步（WS 协议已支持多设备推送 + 已读多端同步）
- [x] 移动端基础版本（Tauri 2 Android，签名 APK 已可通过 CI 打包）
- [ ] 聊天机器人/自动化
- [x] 消息引用/回复（UI + 后端 reply_to_id 联通）
- [x] 消息撤回/编辑（2 分钟撤回窗口 + 5 分钟内可「重新编辑」回填输入框）
- [x] 表情回应 Reactions（快捷 6 emoji 条 + 气泡 toggle + 历史聚合回填）

### 阶段四：企业级特性（第9~12个月）

- [ ] 组织架构/企业通讯录
- [ ] 审批/公告等企业应用
- [ ] 开放 API / Webhook
- [ ] 数据统计面板
- [ ] 管理员后台
- [ ] 审计日志
- [ ] 性能优化 & 压测

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

| 工具           | 版本要求      | 用途                 |
| -------------- | ------------- | -------------------- |
| Go             | ≥ 1.23        | 后端服务             |
| Node.js        | ≥ 20 LTS      | 前端构建             |
| Docker         | ≥ 26.x        | 容器运行时           |
| Docker Compose | ≥ v2.27       | 服务编排             |
| Rust           | latest stable | Tauri 桌面端         |
| Android Studio | latest        | Android 构建         |
| Xcode          | latest        | iOS 构建（仅 macOS） |

### 9.2 快速启动（Docker Compose）

```bash
# 1. 克隆项目
git clone <repository-url> yuanchat
cd yuanchat

# 2. 启动所有依赖服务
docker compose -f deploy/docker-compose.yml up -d

# 3. 启动后端服务
cd server && make dev

# 4. 启动前端开发服务器
cd web && npm install && npm run dev
```

---

## 十、数据库选型

| 数据库            | 用途                                | 推荐度     |
| ----------------- | ----------------------------------- | ---------- |
| **PostgreSQL**    | 用户、群组、关系等结构化数据        | ⭐⭐⭐⭐⭐ |
| **Redis**         | 会话缓存、在线状态、消息队列        | ⭐⭐⭐⭐⭐ |
| **MinIO**         | 文件/图片/语音存储（兼容 S3）       | ⭐⭐⭐⭐⭐ |
| **Elasticsearch** | 消息全文搜索                        | ⭐⭐⭐⭐   |
| **MongoDB**       | 消息历史归档（可选替代 PostgreSQL） | ⭐⭐⭐     |

---

## 十一、安全设计

- [ ] HTTPS/TLS 全链路加密
- [ ] JWT + Refresh Token 鉴权
- [ ] 密码 bcrypt 哈希
- [ ] SQL 注入防护（参数化查询）
- [ ] XSS 防护（CSP、输入校验）
- [ ] CSRF Token
- [ ] 速率限制 (Rate Limiting)
- [ ] WebSocket 连接认证
- [ ] 文件上传类型/大小校验
- [ ] 端到端加密（Signal Protocol，阶段三）

---

## 十二、里程碑与时间线

```
Month 1-2  │  架构搭建、CI/CD、用户系统、Web 端骨架
Month 3    │  MVP 发布：单聊、联系人、在线状态
Month 4-5  │  群组聊天、文件消息、消息状态
Month 6    │  桌面端 Beta、离线推送、消息搜索
Month 7-8  │  音视频通话、E2EE、多设备同步
Month 9    │  移动端 Beta、聊天机器人
Month 10-11│  企业特性、开放 API、管理后台
Month 12   │  正式上线、性能优化、安全审计
```

---

## 十三、文档索引

| 文档                                       | 内容                           | 状态        |
| ------------------------------------------ | ------------------------------ | ----------- |
| [00_MASTER_PLAN.md](./00_MASTER_PLAN.md)   | 总体计划书                     | ✅ 已完成   |
| [01_ARCHITECTURE.md](./01_ARCHITECTURE.md) | 详细架构设计                   | ✅ 已完成   |
| [02_CHAT_API.md](./02_CHAT_API.md)         | 聊天 REST API + WebSocket 协议 | ✅ 已完成   |
| [03_DB_SCHEMA.md](./03_DB_SCHEMA.md)       | 数据库设计                     | ✅ 已完成   |
| [DEVELOPMENT.md](./DEVELOPMENT.md)         | 开发与打包指南（启动/测试）    | ✅ 持续更新 |
| [design/](./design/)                       | UI/UX 设计规范                 | ✅ 已完成   |
| 05_DEPLOYMENT.md                           | 部署运维文档                   | 📝 待编写   |
| 06_CHANGELOG.md                            | 开发变更日志（见 release-it）  | 📝 待编写   |

---

> **最后更新**：2026-06-12
> **文档版本**：v1.0
> **下一步**：请审阅本计划书，确认架构选型后，开始编写详细架构文档和搭建项目骨架。
