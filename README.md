# 元聊 YuanChat

即时通讯软件 — 从零构建的现代 IM 解决方案。

## 平台支持（Tauri 2 统一桌面 + 移动端）

| 平台    | 技术                             | 状态      |
| ------- | -------------------------------- | --------- |
| Web     | React + Vite                     | 🚧 开发中 |
| Desktop | Tauri 2 + React（Win/Mac/Linux） | 🚧 开发中 |
| Mobile  | Tauri 2 + React（Android）       | 🚧 开发中 |
| iOS     | Tauri 2 + React                  | 📋 计划中 |

## 技术栈

- **前端**：React 19 + TypeScript + Vite + Tailwind CSS + Zustand
- **桌面 + 移动**：Tauri 2（Rust + WebView）
- **后端**：Go + Gin + GORM + WebSocket
- **存储**：PostgreSQL 16 + Redis 7 + MinIO + Elasticsearch 8
- **部署**：Docker Compose / Kubernetes

## 快速开始

```bash
# 安装依赖
pnpm install

# 启动基础服务
docker compose -f deploy/docker-compose.yml up -d

# 后端
cd server && make dev

# Web 端 → http://localhost:5173
cd apps/web && pnpm dev

# 桌面端（Tauri 窗口）
cd apps/desktop && pnpm tauri:dev
```

## 文档

- [总体计划书](docs/00_MASTER_PLAN.md)
- [详细架构设计](docs/01_ARCHITECTURE.md)
- [数据库设计](docs/03_DB_SCHEMA.md)
- **[开发与打包指南](docs/DEVELOPMENT.md)** ← 启动/构建/打包命令看这里

## 开发规范

- **GitFlow 工作流**：main ← dev ← feature/bugfix/release/hotfix
- **Commit 规范**：Conventional Commits
- **分支策略**：详见 `.claude/CLAUDE.md`

## License

Proprietary. All rights reserved.
