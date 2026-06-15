# AGENTS.md — AI Agent 项目指南

## 项目身份

本项目是**元聊 (YuanChat)** — 一个从零构建的即时通讯 (IM) 软件。目标不是复刻 QQ/微信，而是打造一款具有独立审美、现代设计语言的通信工具。

## 核心约束（必须遵守）

1. **GitFlow 工作流**：任何代码修改必须在正确的分支上进行。不允许直接提交到 `main` 或 `dev`。
2. **Commit 规范**：所有 commit 必须遵循 Conventional Commits 格式：`<type>(<scope>): <subject>`。
3. **UI 独立性**：不要照搬 QQ/微信/钉钉/Telegram 的 UI 设计。追求北欧简约风格 — 干净线条、充足留白、柔和阴影。
4. **跨平台思维**：代码设计需考虑 Web/Desktop/Mobile 三端复用。
5. **文档同步**：架构变更、API 变更、重要设计决策需同步更新 `doc/` 下的对应文档。
6. **问题记录**：遇到困难问题、好的设计点、关键功能实现后，需在博客项目中添加对应文章。
7. **测试门禁**：每个功能必须先通过测试（单元/集成/E2E）才能标记完成。测试未通过 = 功能未完成。不允许在未通过测试时开始下一个功能。
8. **前端 Mock**：所有前端 API 调用必须有 MSW Mock 覆盖正常/空/错误/加载四种状态。
9. **骨架屏**：所有图片必须用 Skeleton 占位（固定宽高），列表加载必须有骨架屏，CLS 必须为零。
10. **JSDoc/注释**：所有导出函数/组件/Store/Hook 必须写 JSDoc。Go 所有导出函数/包必须写 godoc。关键并发/事务/错误分支必须注释。先写注释再写代码。[[]]

## 技术栈速查

- **前端**：React + TypeScript + Vite + Tailwind CSS + Zustand
- **桌面端 + 移动端**：Tauri 2（桌面 Win/Mac/Linux + 移动 Android/iOS，同一套 Rust 内核 + React UI）
- **后端**：Go 微服务 + gRPC + WebSocket
- **数据库**：PostgreSQL + Redis + MinIO + Elasticsearch
- **部署**：Docker Compose (开发) → Kubernetes (生产)

## 项目结构

详见 `doc/00_MASTER_PLAN.md`

## 当前状态

项目处于**初始化阶段**，正在搭建项目骨架和基础设施。

## 博客

开发过程中的技术文章发布到 Hexo 博客：`/home/liaojie1314/code/blog/liaojie1314'Blog/`
博客编写规范见博客项目的 `BLOG_POST_GUIDE.md`。
