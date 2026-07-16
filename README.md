# 元聊 YuanChat

即时通讯软件 — 从零构建的现代 IM 解决方案。

## 平台支持（Tauri 2 统一桌面 + 移动端）

| 平台    | 技术                             | 状态                              |
| ------- | -------------------------------- | --------------------------------- |
| Web     | React + Vite                     | 🚧 开发中（登录/注册/聊天已可用） |
| Desktop | Tauri 2 + React（Win/Mac/Linux） | 🚧 开发中（与 Web 同一套 UI）     |
| Mobile  | Tauri 2 + React（Android）       | 🚧 开发中（与 Web 同一套 UI）     |
| iOS     | Tauri 2 + React                  | 📋 计划中                         |

## 已实现功能

- **认证**：手机号/邮箱 + 密码注册登录、SVG 验证码、JWT 双 Token
- **聊天核心闭环**：会话列表（未读数/置顶/免打扰）、文本消息实时收发（WebSocket）、
  已读回执（双勾）、正在输入指示、历史消息游标分页、断线自动重连、失败重试
- **三端响应式聊天主界面**：桌面四栏 / 平板抽屉 / 手机栈式，同一套 React 代码
- **i18n**：zh-CN / en-US 双语
- **主题**：多皮肤 + 亮暗模式

## 技术栈

- **前端**：React 19 + TypeScript + Vite + Tailwind CSS + Zustand
- **桌面 + 移动**：Tauri 2（Rust + WebView）
- **后端**：Go + Gin + GORM + gorilla/websocket（REST :8080 + WS :8081）
- **存储**：PostgreSQL 16 + Redis 7（MinIO / Elasticsearch 规划中）
- **部署**：Docker Compose / Kubernetes

## 快速开始

```bash
pnpm install    # 安装依赖（含环境检查）
```

### 一键启动（推荐）

| 命令                    | 说明                                                                |
| ----------------------- | ------------------------------------------------------------------- |
| `pnpm dev:web`          | **真实后端** + Web：自动起 docker(pg/redis) → seed → Go 服务 → Vite |
| `pnpm dev:web:mock`     | **Mock 数据** + Web：无需后端/数据库，MSW + demo 数据               |
| `pnpm dev:desktop`      | 真实后端 + Tauri 桌面窗口                                           |
| `pnpm dev:desktop:mock` | Mock 数据 + Tauri 桌面窗口                                          |
| `pnpm dev:android`      | 真实后端 + Tauri Android（自动 `adb reverse` 8080/8081）            |
| `pnpm dev:android:mock` | Mock 数据 + Tauri Android                                           |
| `pnpm dev:server`       | 仅后端（docker → seed → Go 服务）                                   |
| `pnpm dev:stop`         | 停止全部（应用/后端进程 + docker 容器）                             |

真实模式测试账号（seed 自动创建，密码均为 `Test@1234`）：

| 昵称  | 登录账号      |
| ----- | ------------- |
| Alice | `13800000001` |
| Bob   | `13800000002` |
| Carol | `13800000003` |

两个浏览器分别登录 Alice / Bob 即可互发消息，体验实时收发、已读回执、正在输入。

> Ctrl+C 停止当前会话拉起的进程（docker 容器保留以加速下次启动）；
> 彻底清理用 `pnpm dev:stop`。分步启动与更多命令见
> [开发与打包指南](docs/DEVELOPMENT.md)。

## 文档

- [总体计划书](docs/00_MASTER_PLAN.md)
- [详细架构设计](docs/01_ARCHITECTURE.md)
- [聊天 API 与 WebSocket 协议](docs/02_CHAT_API.md)
- [数据库设计](docs/03_DB_SCHEMA.md)
- **[开发与打包指南](docs/DEVELOPMENT.md)** ← 启动/构建/打包/测试命令看这里

## 开发规范

- **GitFlow 工作流**：main ← dev ← feature/bugfix/release/hotfix
- **Commit 规范**：Conventional Commits
- **分支策略**：详见 `.claude/CLAUDE.md`

## License

Proprietary. All rights reserved.
