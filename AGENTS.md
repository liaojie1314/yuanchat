# AGENTS.md — AI Agent 项目指南

## 项目身份

本项目是**元聊 (YuanChat)** — 一个从零构建的即时通讯 (IM) 软件。目标不是复刻 QQ/微信，而是打造一款具有独立审美、现代设计语言的通信工具。

## 核心约束（必须遵守）

1. **GitFlow 工作流**：任何代码修改必须在正确的分支上进行。不允许直接提交到 `main` 或 `dev`。
2. **Commit 规范**：所有 commit 必须遵循 Conventional Commits 格式：`<type>(<scope>): <subject>`。完成一项具体工作后再提交，**禁止逐点提交**（不要写一点改一点就 commit），一个 commit 应包含一个完整的功能点或修复。
3. **Tag 与分支同步**：需要打 tag 时及时打 tag（如 release 分支合并前），tag 打完后必须同步到 `main` 分支，确保 `main` 始终包含最新版本标记。
4. **UI 独立性**：不要照搬 QQ/微信/钉钉/Telegram 的 UI 设计。追求北欧简约风格 — 干净线条、充足留白、柔和阴影。
5. **跨平台思维**：代码设计需考虑 Web/Desktop/Mobile 三端复用。
6. **文档同步**：所有文档统一放在 `docs/` 目录下。架构变更、API 变更、重要设计决策需同步更新对应文档。启动/打包命令变更必须同步更新 `docs/DEVELOPMENT.md`。
7. **问题记录**：遇到困难问题、好的设计点、关键功能实现后，需在博客项目中添加对应文章。
8. **测试门禁**：每个功能必须先通过测试（单元/集成/E2E）才能标记完成。测试未通过 = 功能未完成。不允许在未通过测试时开始下一个功能。
9. **前端 Mock**：所有前端 API 调用必须有 MSW Mock 覆盖正常/空/错误/加载四种状态。
10. **骨架屏**：所有图片必须用 Skeleton 占位（固定宽高），列表加载必须有骨架屏，CLS 必须为零。
11. **JSDoc/注释**：所有导出函数/组件/Store/Hook 必须写 JSDoc。Go 所有导出函数/包必须写 godoc。关键并发/事务/错误分支必须注释。先写注释再写代码。[[]]
12. **浏览器/WebView 兼容适配**：前端代码必须兼容低版本 WebView。`vite.config.ts` 的 `build.target` 须为 `es2019`（转译 `?.`/`??` 等 ES2020+ 语法），不得使用 `chrome105`/`es2020`，否则旧 Android System WebView（如 Chrome 74）解析期 SyntaxError → 白屏。新增 JS 语法/Web API 前须确认目标 WebView 支持，或确保已被转译/polyfill。详见 `docs/DEVELOPMENT.md`、`.claude/TROUBLESHOOTING.md`。
13. **i18n 国际化适配**：所有用户可见文案**禁止硬编码**，必须通过 `react-i18next`（`useTranslation` / `t()`）引用，并在 `packages/design-system/src/i18n/locales/`（`zh-CN`、`en-US`）补齐对应 key。新增/修改 UI 文案时必须同步维护两种语言的翻译条目。

## 技术栈速查

- **前端**：React + TypeScript + Vite + Tailwind CSS + Zustand
- **桌面端 + 移动端**：Tauri 2（桌面 Win/Mac/Linux + 移动 Android/iOS，同一套 Rust 内核 + React UI）
- **后端**：Go 微服务 + gRPC + WebSocket
- **数据库**：PostgreSQL + Redis + MinIO + Elasticsearch
- **部署**：Docker Compose (开发) → Kubernetes (生产)

## 项目结构

详见 `docs/00_MASTER_PLAN.md`

## 当前状态

> 更新于 2026-07-16

**MVP 核心链路已打通**（阶段一进行中）：

- ✅ 认证：注册/登录（手机号/邮箱 + 密码 + SVG 验证码）、JWT 双 Token、
  token 静默刷新（滑动会话轮换 + 401 兜底重试，`api/tokenManager.ts`）
- ✅ 聊天核心闭环：会话列表、文本消息 WebSocket 实时收发、已读回执、
  正在输入、历史游标分页、断线重连、失败重试（协议见 `docs/02_CHAT_API.md`）
- ✅ 三端响应式聊天主界面（`packages/ui/src/ChatScreen.tsx` 编排）
- ✅ 一键启动：`pnpm dev:web` / `dev:web:mock` / `dev:desktop` / `dev:android` /
  `dev:server` / `dev:stop`（`scripts/dev.mjs`，见 `docs/DEVELOPMENT.md` 第零章）
- ⏳ 未做：联系人/好友（进行中）、建群流程、图片/文件/语音消息（需 MinIO）、
  撤回、presence

后端单进程双端口：REST :8080 + WebSocket :8081；消息分发为内存 Hub
（`Dispatcher` 接口，多实例时换 Redis Pub/Sub 实现）。

## 博客

开发过程中的技术文章发布到 Hexo 博客：`/home/liaojie1314/code/blog/liaojie1314'Blog/`
博客编写规范见博客项目的 `BLOG_POST_GUIDE.md`。
