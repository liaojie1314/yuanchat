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

| 方案                         | 适用范围                | 推荐度     | 说明                                                                        |
| ---------------------------- | ----------------------- | ---------- | --------------------------------------------------------------------------- |
| **React (Vite) + Capacitor** | Web / iOS / Android     | ⭐⭐⭐⭐⭐ | 一套 React 代码，Capacitor 打包为移动端原生应用；PWA 支持离线；维护成本最低 |
| **React (Vite) + Tauri**     | Desktop (Win/Mac/Linux) | ⭐⭐⭐⭐⭐ | Rust 内核，体积小，性能高，比 Electron 轻量                                 |
| **React Native**             | Mobile (Android/iOS)    | ⭐⭐⭐     | 原生体验更好，但需要维护两套代码（Web + RN），仅当 Capacitor 性能不足时考虑 |
| **Electron**                 | Desktop (Win/Mac/Linux) | ⭐⭐⭐     | 成熟但体积大，Tauri 是更好的替代品                                          |

**最终推荐组合：**

- **Web 端**：React + TypeScript + Vite + PWA
- **桌面端**：Tauri（React 作为 UI 层）
- **移动端**：Capacitor（复用 Web 端 React 代码）

> **关于 macOS/iOS 测试的说明**：由于没有 macOS 设备，iOS 和 macOS 版本通过 Capacitor/Tauri 的跨平台能力保证一致性。CI/CD 中可以集成 GitHub Actions 的 macOS runner 进行构建验证。

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
│  │React+PWA │  │Tauri+React│ │Capacitor │  │Capacitor │   │
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
├── server/                       # 🔧 后端 Go 服务
│   ├── go.mod                    # Go 模块定义
│   ├── go.sum
│   ├── Makefile                  # 编译/运行脚本
│   ├── cmd/                      # 各服务入口
│   │   ├── gateway/              # API 网关
│   │   ├── ws-gateway/           # WebSocket 长连接网关
│   │   ├── user-service/         # 用户服务
│   │   ├── message-service/      # 消息服务
│   │   ├── group-service/        # 群组服务
│   │   ├── file-service/         # 文件服务
│   │   ├── notification-service/ # 通知服务
│   │   ├── session-service/      # 会话服务
│   │   └── search-service/       # 搜索服务
│   ├── internal/                 # 内部共享代码
│   │   ├── proto/                # Protobuf/gRPC 定义
│   │   ├── pkg/                  # 公共工具包
│   │   ├── middleware/           # 中间件
│   │   └── model/                # 数据模型
│   ├── api/                      # API 定义（OpenAPI/Proto）
│   └── config/                   # 配置文件
│
├── web/                          # 🌐 Web 前端 (React + Vite)
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── assets/               # 静态资源
│   │   ├── components/           # 通用组件
│   │   ├── pages/                # 页面组件
│   │   ├── hooks/                # 自定义 Hooks
│   │   ├── store/                # 状态管理 (Zustand)
│   │   ├── services/             # API 调用层
│   │   ├── types/                # TypeScript 类型定义
│   │   ├── utils/                # 工具函数
│   │   └── styles/               # 样式文件 (Tailwind CSS)
│   └── public/
│       └── manifest.json         # PWA 配置
│
├── desktop/                      # 🖥️ 桌面端 (Tauri + React)
│   ├── src-tauri/                # Tauri (Rust) 部分
│   │   ├── Cargo.toml
│   │   ├── tauri.conf.json
│   │   └── src/
│   │       └── main.rs
│   └── src/                      # 复用 web/ 的 React 代码
│
├── mobile/                       # 📱 移动端 (Capacitor)
│   ├── capacitor.config.ts
│   ├── android/                  # Android 原生工程
│   └── ios/                      # iOS 原生工程
│
├── deploy/                       # 🚀 部署配置
│   ├── docker-compose.yml        # 开发环境
│   ├── docker-compose.prod.yml   # 生产环境
│   ├── nginx/                    # Nginx 配置
│   └── k8s/                      # Kubernetes 配置（可选）
│
├── scripts/                      # 📜 脚本工具
│   ├── dev.sh                    # 开发环境启动
│   └── build.sh                  # 构建脚本
│
├── .gitignore
├── .gitflow.yml                  # GitFlow 配置
├── .commitlintrc.js              # Commit 信息规范
└── README.md                     # 项目说明
```

---

## 五、核心功能清单

> 进度更新于 2026-07-16

### 阶段一：基础能力（MVP — 第1~3个月）

- [x] 用户注册/登录（手机号/邮箱 + 密码 + SVG 验证码，JWT 双 Token）
- [x] 单聊消息（文本；表情待做）
- [ ] 联系人管理（添加/删除/搜索）
- [ ] 在线状态（在线/离线）
- [x] Web 端基础 UI（登录/注册/三端响应式聊天主界面）
- [x] 消息持久化存储（PostgreSQL，seq 会话内有序）

### 阶段二：核心体验（第3~6个月）

- [ ] 群组聊天（创建/加入/管理群组；群聊收发已支持，管理流程未做）
- [ ] 图片/文件消息（需 MinIO）
- [ ] 语音消息
- [x] 消息已读/未读（last_read_seq 回执机制 + 未读角标，提前实现）
- [ ] 离线消息推送
- [x] 桌面端基础版本 (Tauri)（与 Web 同一套 UI，提前实现）
- [ ] 消息搜索

### 阶段三：进阶功能（第6~9个月）

- [ ] 语音/视频通话 (WebRTC)
- [ ] 端到端加密 (E2EE)
- [ ] 多设备消息同步（WS 协议已支持多设备推送，同步补齐机制待做）
- [ ] 移动端基础版本（Tauri 2 Android，已可运行，替代原 Capacitor 方案）
- [ ] 聊天机器人/自动化
- [ ] 消息引用/回复（UI 已支持，后端 reply_to_id 已留字段）
- [ ] 消息撤回/编辑

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
