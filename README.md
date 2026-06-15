# 元聊 YuanChat

即时通讯软件 — 从零构建的现代 IM 解决方案。

## 平台支持

| 平台    | 技术               | 状态      |
| ------- | ------------------ | --------- |
| Web     | React + Vite + PWA | 🚧 开发中 |
| Windows | Tauri + React      | 📋 计划中 |
| macOS   | Tauri + React      | 📋 计划中 |
| Linux   | Tauri + React      | 📋 计划中 |
| Android | Capacitor          | 📋 计划中 |
| iOS     | Capacitor          | 📋 计划中 |

## 技术栈

- **前端**：React + TypeScript + Vite + Tailwind CSS
- **后端**：Go 微服务 + gRPC + WebSocket
- **存储**：PostgreSQL + Redis + MinIO + Elasticsearch
- **部署**：Docker Compose / Kubernetes

## 快速开始

```bash
# 启动基础服务
docker compose -f deploy/docker-compose.yml up -d

# 后端
cd server && make dev

# 前端
cd web && npm install && npm run dev
```

## 文档

- [总体计划书](doc/00_MASTER_PLAN.md)
- [详细架构设计](doc/01_ARCHITECTURE.md)
- [API 接口设计](doc/02_API_DESIGN.md)
- [数据库设计](doc/03_DB_SCHEMA.md)

## 开发规范

- **GitFlow 工作流**：main ← develop ← feature/bugfix/release/hotfix
- **Commit 规范**：Conventional Commits
- **Code Review**：每个 PR 至少一人审核

## License

Proprietary. All rights reserved.
