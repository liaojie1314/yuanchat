# AGENTS.md — AI Agent 项目指南

## 项目身份

本项目是**元聊 (YuanChat)** — 一个从零构建的企业级即时通讯 (IM) 软件。目标不是复刻 QQ/微信，而是打造一款具有独立审美、现代设计语言的通信工具。

## 核心约束（必须遵守）

1. **GitFlow 工作流**：任何代码修改必须在正确的分支上进行。不允许直接提交到 `main` 或 `develop`。
2. **Commit 规范**：所有 commit 必须遵循 Conventional Commits 格式：`<type>(<scope>): <subject>`。
3. **UI 独立性**：不要照搬 QQ/微信/钉钉/Telegram 的 UI 设计。追求北欧简约风格 — 干净线条、充足留白、柔和阴影。
4. **跨平台思维**：代码设计需考虑 Web/Desktop/Mobile 三端复用。
5. **文档同步**：架构变更、API 变更、重要设计决策需同步更新 `doc/` 下的对应文档。
6. **问题记录**：遇到困难问题、好的设计点、关键功能实现后，需在博客项目中添加对应文章。

## 技术栈速查

- **前端**：React + TypeScript + Vite + Tailwind CSS + Zustand
- **桌面端**：Tauri (Rust 内核 + React UI)
- **移动端**：Capacitor (复用 Web 代码)
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
