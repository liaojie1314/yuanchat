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
11. **JSDoc/注释**：所有导出函数/组件/Store/Hook 必须写 JSDoc。Go 所有导出函数/包必须写 godoc。关键并发/事务/错误分支必须注释。先写注释再写代码。
12. **浏览器/WebView 兼容适配**：前端代码必须兼容低版本 WebView。`vite.config.ts` 的 `build.target` 须为 `es2019`（转译 `?.`/`??` 等 ES2020+ 语法），不得使用 `chrome105`/`es2020`，否则旧 Android System WebView（如 Chrome 74）解析期 SyntaxError → 白屏。新增 JS 语法/Web API 前须确认目标 WebView 支持，或确保已被转译/polyfill。详见 `docs/DEVELOPMENT.md`、`.claude/TROUBLESHOOTING.md`。
13. **i18n 国际化适配**：所有用户可见文案**禁止硬编码**，必须通过 `react-i18next`（`useTranslation` / `t()`）引用，并在 `packages/design-system/src/i18n/locales/`（`zh-CN`、`en-US`、`ja-JP`、`ko-KR`）补齐对应 key。新增/修改 UI 文案时必须同步维护四种语言的翻译条目，`node scripts/check-i18n.mjs`（CI 门禁）会挡下漏翻、写错 key 与死键。
14. **推送前本地 CI 门禁**：推送到远程 `dev` 之前，必须先在本地跑通 CI 的全部检查并全绿，禁止「先推上去让 CI 跑」。CI 实际执行的是 `node scripts/check-i18n.mjs`、`pnpm test`、`apps/web` 与 `apps/desktop` 各自的 `npx tsc --noEmit`、`pnpm --filter @yuanchat/web test:e2e`（Playwright chromium），以及 `server/` 下的 `go vet ./...`、`go test ./...`、`go test -race ./internal/ws/`。本地跑前端测试必须把语言环境对齐 runner（`LANG=C.UTF-8 pnpm test`，runner 没有中文 locale）—— Node 21 起 `navigator.language` 取自宿主 ICU 语言环境，中文机器上报 `zh-CN`、runner 上报 `en-US`，依赖它的用例会「本地全绿、远程报错」。理由：CI 失败要等远程跑完才知道，而失败的 commit 已经落在共享分支上，别人拉下来就是坏的。
15. **发版前本地打包门禁**：打 tag / 触发 release 之前，必须先在本地完整打包一遍并成功 —— `pnpm build:pkg`（web + tsc + tauri build）与 Android aarch64 APK 构建。理由：release 流水线跨 macOS/Windows/Linux/Android 多个 runner，任一平台失败整条发版作废，还可能留下半个 GitHub Release。

## 技术栈速查

- **前端**：React 19 + TypeScript + Vite + Tailwind CSS + Zustand + react-i18next
- **桌面端 + 移动端**：Tauri 2（桌面 Win/Mac/Linux + 移动 Android/iOS，同一套 Rust 内核 + React UI）
- **后端**：Go 单体（Gin + GORM + gorilla/websocket），一个进程同时监听 REST 与 WebSocket，消息分发走进程内 Hub
- **数据库**：PostgreSQL（全文检索用 `pg_trgm` GIN 索引）+ Redis + MinIO
- **可观测性**：zap 结构化日志 + Prometheus 指标（`:9090/metrics`）+ Sentry 前端错误上报
- **部署**：Docker Compose — 开发 `deploy/docker-compose.yml`（pg/redis/minio），生产 `deploy/docker-compose.prod.yml`（+ nginx/certbot/prometheus/grafana/loki）

## 项目结构

详见 `docs/MASTER_PLAN.md`

## 当前状态

已实现的能力（代码路径与协议细节见 `docs/CHAT_API.md`、`docs/ARCHITECTURE.md`）：

- 认证：注册/登录（手机号/邮箱 + 密码 + SVG 验证码）、JWT 双 Token、
  token 静默刷新（滑动会话轮换 + 401 兜底重试，`api/tokenManager.ts`）
- 聊天核心闭环：会话列表、文本消息 WebSocket 实时收发、已读回执、
  正在输入、历史游标分页、断线重连、失败重试
- 好友与关系：精确搜索（手机号/元聊号/邮箱）→ 发申请（WS 实时推送）→
  同意/拒绝 → 同意即原子建单聊 + 打招呼消息 → 字母分组好友列表
  （`ContactsScreen.tsx` 三端编排）；删好友（双向软删，幂等）+ 黑名单
  （单聊发送拦截 403 `BLOCKED`，群聊不受影响）
- 三端响应式聊天主界面（`packages/ui/src/ChatScreen.tsx` 编排）
- 设置页 / 个人资料：昵称/签名/性别编辑 + 头像上传（512px 中心裁方 → MinIO
  `avatars/` 公开 URL，落库持久化，`PUT /users/me`）
- 群聊：好友多选建群（校验全员互为好友）→ 系统消息 + `conversation.created` 实时推送；
  群管理改名 / 邀请 / 踢人 / 退群 / 解散（软删）；任命与撤销管理员、转让群主
  （`conversation.role_changed` 帧推群内全员）；群公告、群内昵称、清空聊天记录
- 消息类型：文本、图片（canvas 压缩 + 预签名直传 + Lightbox）、文件（任意扩展 →
  `fileIconOf` 按类型出图标 + 预签名下载）、语音（MediaRecorder + audio/webm，
  1-60s 自动截断）、贴纸/收藏表情（blob 内容寻址去重，独立 content type，
  前后端共用 `contracts/` golden 契约。契约按方向分两份：
  `message-send.golden.json` 是客户端→服务端、`server-frames.golden.json` 是服务端→客户端；
  新增服务端帧必须同时登记进后者与 `ws/golden_server_frames_test.go` 的 `payloadPrototypes`，
  否则字段集比对测试直接失败）
- 消息操作：撤回（2 分钟窗口 → `message.recalled` 全员推送 + 气泡占位，
  自己文本 5 分钟内可「重新编辑」）、**编辑**（纯文本、5 分钟窗口、累计 20 次上限 →
  `message.edited` 全员推送 + 「已编辑」角标 + 全量编辑历史弹窗；编辑重跑敏感词审核，
  否则「先发干净文本再改成敏感词」可绕过审核）、引用回复、表情回应（`message.reaction` 帧
  实时 + 历史聚合回填，mine 相对请求者）、转发（一次最多 9 个会话）、
  `@` 提及（落 `mention_unread` → 会话列表角标）、收藏
- 消息搜索：全局 + 会话内，`GET /messages/search`，PostgreSQL `pg_trgm` GIN 索引，
  只命中当前用户有权访问的会话
- Presence 在线状态：Hub 首连/末连回调 → 广播给在线好友；`GET /presence` 快照
  加 `presence` 帧增量；`applyPresence` 按 peerId 匹配单聊
- 通知：桌面 Tauri notification plugin（注入 shared `notifyIncoming`，失焦 + 非免打扰时弹）；
  Web Push（VAPID + Service Worker，仅推离线收件人并过滤免打扰会话，未配 VAPID 密钥即关闭）
- 端到端加密：X3DH + Double Ratchet（`packages/shared/src/crypto/`），用户自行开启，
  仅单聊，对方未启用自动降级明文，支持密钥备份/恢复
- 管理后台 `apps/admin`：用户封禁解封、会话解散、消息检索与删除、举报处理、审计日志；
  `/api/v1/admin/*` 走 JWT + `role=admin` 双重校验，写操作留审计日志；
  敏感词命中标记 `flagged=true` 进审核队列（不阻塞发送）
- PWA：生产构建注入自定义 Service Worker（app shell 预缓存 + Web Push 监听）
- 一键启动：`pnpm dev:web` / `dev:web:mock` / `dev:desktop` / `dev:android` /
  `dev:server` / `dev:stop`（`scripts/dev.mjs`，见 `docs/DEVELOPMENT.md` 第零章）

未做：语音转文字、音视频通话（WebRTC）、聊天机器人 / 开放 API、iOS 打包（需 Apple 开发者账户）。

后端单进程双端口：REST :8085 + WebSocket :8086（另有 Prometheus `:9090/metrics`）。
消息分发是进程内 Hub（`Dispatcher` 接口，多实例需换分布式实现）；presence 可通过
`presence.backend=redis` 走 Redis Pub/Sub 跨实例广播。对象存储为 MinIO（`:9002` S3 端点、
`:9003` 控制台），PostgreSQL `:5434`、Redis `:6380`，随 `deploy/docker-compose.yml` 启动。

## 博客

开发过程中的技术文章发布到 Hexo 博客：`/home/liaojie1314/code/blog/liaojie1314'Blog/`
博客编写规范见博客项目的 `BLOG_POST_GUIDE.md`。
