# 元聊 YuanChat

即时通讯软件 — 从零构建的现代 IM 解决方案。

**当前状态**：v0.3.0（Web + Desktop 三平台 + Android APK 由 GitHub Actions 自动打包）。

## 平台支持（Tauri 2 统一桌面 + 移动端）

| 平台            | 技术                                | 状态                                      |
| --------------- | ----------------------------------- | ----------------------------------------- |
| Web             | React + Vite                        | ✅ 可用（`.tar.gz` 静态部署，PWA 可安装） |
| Desktop Linux   | Tauri 2                             | ✅ 可用（`.deb` + `.AppImage`）           |
| Desktop Windows | Tauri 2                             | ✅ 可用（`.msi` + `.exe`）                |
| Desktop macOS   | Tauri 2（universal Intel + M 系列） | ✅ 可用（`.dmg`）                         |
| Android         | Tauri 2                             | ✅ 可用（签名 APK）                       |
| iOS             | Tauri 2                             | 📋 计划中（需 Apple 开发者账户）          |

## 已实现功能

### 认证与用户体系

- 手机号/邮箱 + 密码注册登录、SVG 图形验证码
- JWT 双 Token 静默刷新（滑动会话轮换 + 401 兜底重试）
- 个人资料（昵称/头像/签名/性别），512px 中心裁方头像上传至 MinIO

### 好友与关系

- 精确搜索（手机号/元聊号/邮箱）→ 发送申请（WS 实时推送）→ 同意/拒绝
- 同意即原子建单聊 + 打招呼消息 → 字母分组好友列表
- **删好友**：双向软删 `contacts` 两行，幂等
- **黑名单**：拉黑/解除 + 黑名单列表，被拉黑方单聊发送返回 403 `BLOCKED`，群聊不受影响

### 会话与消息

- 会话列表（未读数 / 置顶 / 免打扰）+ 三端响应式布局（桌面四栏 / 平板抽屉 / 手机栈式）
- 文本消息 WebSocket 实时收发 + 已读回执（双勾）+ 正在输入指示
- 历史消息游标分页、断线自动重连、失败重试
- **消息撤回**：发送后 2 分钟内可撤回；自己文本 5 分钟内可「重新编辑」回填输入框
- **图片消息**：canvas 压缩 → MinIO 预签名直传，Lightbox 全屏查看，粘贴/选图发送，PNG 保 alpha
- **文件消息**：任意扩展直传 MinIO，气泡按类型显示 lucide 图标（PDF/Word/表格/演示/压缩/音视频/图片/代码）+ 品类色 + 预签名下载
- **语音消息**：MediaRecorder + audio/webm（1-60s，超 60s 自动截断），录音可暂停/续录，模块级单例播放器 + 播放中波形动画
- **表情回应 Reactions**：右键菜单快捷 6 emoji 条 + 气泡点击 toggle，全员实时同步 + 历史聚合回填（mine 相对请求者）
- **贴纸/收藏表情**：官方表情包 + 图片一键转收藏（blob 内容寻址去重），贴纸消息独立 content type，前后端共用 golden 契约
- **消息菜单**：桌面右键 / 移动端长按 500ms 呼出（位移容差 12px，抬手后的合成事件与 WebView 补发的 `contextmenu` 一并豁免）
- **消息转发**：单条消息一次转发到最多 9 个会话，来源与目标会话都校验操作者身份
- **@提及**：群聊 `@` 选人面板，命中成员落 `mention_unread` 标记 → 会话列表提及角标
- **消息收藏**：任意消息加入收藏夹（`POST/GET/DELETE /favorites`），收藏列表分页浏览
- **消息搜索**：全局搜索 + 会话内搜索，基于 PostgreSQL `pg_trgm` GIN 索引（`GET /messages/search`，仅命中当前用户有权访问的会话）
- **会话维护**：清空聊天记录、群公告（横幅 + 全文弹层）、群内昵称

### 群管理

- 建群（好友多选 → 系统消息 + `conversation.created` 帧全员推送）
- 五操作：**改名 / 邀请 / 踢人 / 退群 / 解散**，权限模型（role：0 普通 / 1 管理员 / 2 群主），全部由 `conversation.updated` / `conversation.removed` / `message.receive[system]` 帧驱动
- **角色管理**：群主任命/撤销管理员、转让群主（新群主升 owner、原群主降管理员），`conversation.role_changed` 帧推群内全员

### 实时状态与通知

- **Presence 在线状态**：Hub 首连/末连回调 → 广播给在线好友；`GET /presence` 快照 + `presence` 帧增量
- **多实例 Presence**：`presence.backend` 取 `local`（进程内）或 `redis`（Redis Pub/Sub 跨实例广播上下线）
- **Web Push 离线推送**：VAPID 订阅（`/push/subscribe`）+ Service Worker 接收，仅推离线收件人并过滤免打扰会话；未配置 VAPID 密钥时推送关闭，只走 WS 实时投递
- **桌面系统通知**：Tauri notification plugin，窗口失焦 + 非免打扰时弹（正文截断 60 字）

### 管理后台与内容安全

- **管理后台**（`apps/admin`，独立 Vite 应用）：用户列表/封禁解封、会话列表/解散、消息检索与删除、举报处理、审计日志；`/api/v1/admin/*` 走 JWT + `role=admin` 双重校验，写操作全部留审计日志
- **用户举报**：任意用户举报消息/用户（`POST /reports` 带 IP 限流）→ 进管理后台工单队列
- **敏感词标记**：命中 `moderation.words` 的消息正常投递但标记 `flagged=true` 进审核队列（不阻塞发送）

### 系统能力

- **i18n**：zh-CN / en-US / ja-JP / ko-KR 四语全量覆盖（`react-i18next`，扁平 key，`pnpm check:i18n` 门禁挡漏翻/写错 key/死键），语言选择持久化，重开应用即生效
- **主题**：三套皮肤（`yuan` / `ocean` / `forest`，各含亮暗两版）+ 字体缩放（`pnpm check:theme` 校验颜色工具类都在色板里）
- **端到端加密 E2EE**：X3DH 协商 + Double Ratchet 棘轮（`packages/shared/src/crypto/`），设置页内按用户开关，仅单聊；对方未启用时自动降级明文，支持密钥备份/恢复
- **PWA**：生产构建注入自定义 Service Worker（app shell 预缓存 + Web Push 监听），可安装到桌面/主屏
- **可观测性**：Sentry 前端错误上报（仅 production + 配了 DSN 时启用）+ Prometheus 指标（独立 `:9090/metrics`，HTTP/WS/消息计数与耗时）+ zap 结构化日志
- **兼容性**：所有 `build.target` 保持 `es2019`，支持旧 Android WebView（Chrome 74+）——含 `Object.hasOwn` 运行时补丁、flex `gap` 的 margin 兜底、Tailwind preflight `:where()` 失效的复位补写

### 未做

- 语音转文字
- 音视频通话（WebRTC）、聊天机器人 / 开放 API

## 技术栈

- **前端**：React 19 + TypeScript + Vite + Tailwind CSS + Zustand v5 + lucide-react + react-i18next
- **桌面 + 移动**：Tauri 2（Rust 内核 + WebView，同一套 React UI 全平台复用）
- **后端**：Go 1.25 + Gin + GORM + gorilla/websocket + MinIO SDK（单进程双端口：REST :8085 + WS :8086，另有 Prometheus :9090）
- **存储**：PostgreSQL 16 + Redis 7 + MinIO（S3 兼容，用于图片/文件/语音/头像）
- **测试**：vitest（前端 526）+ go test（13 包，集成测试 -race）+ Playwright E2E（63）
- **发版**：release-it + GitHub Actions（tag 触发 5 平台并行打包）

## 快速开始

```bash
pnpm install    # 安装依赖（含环境检查）
```

### 一键启动（推荐）

| 命令                    | 说明                                                                      |
| ----------------------- | ------------------------------------------------------------------------- |
| `pnpm dev:web`          | **真实后端** + Web：自动起 docker(pg/redis/minio) → seed → Go 服务 → Vite |
| `pnpm dev:web:mock`     | **Mock 数据** + Web：无需后端/数据库，MSW + demo 数据                     |
| `pnpm dev:desktop`      | 真实后端 + Tauri 桌面窗口                                                 |
| `pnpm dev:desktop:mock` | Mock 数据 + Tauri 桌面窗口                                                |
| `pnpm dev:android`      | 真实后端 + Tauri Android（自动 `adb reverse` 8085/8086）                  |
| `pnpm dev:android:mock` | Mock 数据 + Tauri Android                                                 |
| `pnpm dev:server`       | 仅后端（docker → seed → Go 服务）                                         |
| `pnpm dev:stop`         | 停止全部（应用/后端进程 + docker 容器）                                   |

真实模式测试账号（seed 自动创建，密码均为 `Test@1234`）：

| 昵称  | 登录账号      |
| ----- | ------------- |
| Alice | `13800000001` |
| Bob   | `13800000002` |
| Carol | `13800000003` |

Alice ↔ Bob、Bob ↔ Carol 互为好友。用两个浏览器分别登录即可体验实时收发/已读/正在输入/文件/语音/reactions/presence 全套。

> Ctrl+C 停止当前会话拉起的进程（docker 容器保留以加速下次启动）；
> 彻底清理用 `pnpm dev:stop`。分步启动与更多命令见
> [开发与打包指南](docs/DEVELOPMENT.md)。

## 发布安装包

tag push（`v*`）自动触发 GitHub Actions 打包并上传到 [Releases](https://github.com/liaojie1314/yuanchat/releases)；也可在 Actions 页手动 `workflow_dispatch` 指定已有 tag 补跑某个平台：

```bash
git checkout main
pnpm release            # 交互式，选 patch/minor/major
pnpm release:dry        # 模拟运行，看会做什么
```

产物清单（每次发版自动上传）：

| 平台            | 产物                                                    |
| --------------- | ------------------------------------------------------- |
| Web             | `yuanchat-web-vX.Y.Z.tar.gz`                            |
| Linux Desktop   | `.deb` + `.AppImage`                                    |
| Windows Desktop | `.msi` + `.exe`                                         |
| macOS Desktop   | `.dmg`（Intel + M 系列 universal binary）               |
| Android         | `.apk`（按 ABI 分包：arm64-v8a / armeabi-v7a / x86_64） |

完整发版流程 + Android keystore 配置 + 未来 macOS/Windows 代码签名 → **[发版指南](docs/RELEASE.md)**

## 文档

- **[总体计划书](docs/MASTER_PLAN.md)** — 技术选型、系统架构、路线图
- **[详细架构设计](docs/ARCHITECTURE.md)** — 前后端模块划分、数据流
- **[聊天 API 与 WebSocket 协议](docs/CHAT_API.md)** — REST 端点 + WS 帧 + 系统消息约定
- **[数据库设计](docs/DB_SCHEMA.md)** — 表结构 + 索引 + 迁移
- **[开发与打包指南](docs/DEVELOPMENT.md)** — 启动/构建/调试/测试命令，i18n 与旧 WebView 兼容约定
- **[常见问题排查](.claude/TROUBLESHOOTING.md)** — 按平台分类的踩坑记录（白屏、软键盘、旧 WebView 静默失效、语言持久化…）
- **[发版指南](docs/RELEASE.md)** — release-it + GitHub Actions + 签名策略
- **[UI/UX 设计规范](docs/design/README.md)** — Material Design 3 Aurora 主题、组件、多端适配

## 开发规范

- **GitFlow 工作流**：main ← dev ← feature / bugfix / release / hotfix
- **Commit 规范**：Conventional Commits（`feat`/`fix`/`chore`/`docs`/`test`/`refactor`/`build`/`ci`）
- **分支策略**：详见 [`AGENTS.md`](AGENTS.md)
- **CI 门禁**：push 到 `dev` 分支、以及目标为 `dev` 的 PR 触发 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
  （i18n 完整性门禁 + 前端 test + web/desktop 双端 tsc、Playwright E2E（mock 模式）、后端 go vet/test + `internal/ws` 的 -race）
- **推远程前先本地跑通 CI**：同一批检查在本地全绿才推 `dev`，前端测试用 `LANG=C.UTF-8 pnpm test` 对齐 runner 语言环境（详见 [`AGENTS.md`](AGENTS.md) 第 14 条）

## License

Proprietary. All rights reserved.
