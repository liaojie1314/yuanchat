# 元聊 YuanChat — 迭代路线图

> 从 v0.1.0（MVP）到 v1.0.0（生产就绪）的完整规划。每条批次都能独立成为一个 `feature/*` 分支 + 一次 squash commit。
>
> **约束**：所有批次继承 v0.1.0 已有的全局约束（GitFlow、i18n 双语无硬编码、`build.target=es2019`、`rounded-lg`、每批次末尾门禁 + squash、验证后关服务）。
>
> **执行状态（2026-07-27，v0.3.0 发布时）**：21 个批次中 19 个已完成。
> 实际发布节奏与规划的版本→批次映射不同（tag 按完成时间聚合，见
> [v0.2.0-tag 说明](#里程碑总览)）：
>
> - **tag v0.2.0**（已发布）：A1-A5、B1-B3、C1、C3、E1
> - **tag v0.3.0**（本次）：E2-E4（管理后台/审核/ja-ko）、B4、B5、
>   C2、C4、D1（updater 自签部分）、D3（PWA+Push）、D4（E2EE 单聊）、E5（部署编排）
> - **未完成 2 项**：D2 iOS（需 macOS + Apple Developer 账户）、
>   D1 的 OS 层付费签名（Apple 公证 / Windows SmartScreen，证书就绪后填
>   secrets 即生效，workflow 门控已就绪）
>
> **下一阶段（2026-07-31 立项）**：通话 / 朋友圈 / 表情服务 / 聊天设置补全，
> 见 [v0.4-v0.5 social & calls outline](superpowers/plans/2026-07-31-v0.4-v0.5-social-and-calls.md)。

## 里程碑总览

| 版本   | 主题                       | 包含批次               | 预计工时 | 详细计划文档                                                                                         |
| ------ | -------------------------- | ---------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| v0.2.0 | 关系 & 群管进阶 + 前端观测 | A1 + A2 + A3 + B1      | 4 周     | [超详细 TDD plan](superpowers/plans/2026-07-22-v0.2.0-relations-groups-mentions-sentry.md)（可执行） |
| v0.3.0 | 搜索 & 性能 & 后端观测     | A4 + C1 + C3 + B2 + B3 | 4 周     | [milestone outline](superpowers/plans/2026-08-19-v0.3.0-search-perf-observability.md)                |
| v0.4.0 | 收藏 & 管理后台            | A5 + E1 + E2 + E3 + E4 | 5 周     | [milestone outline](superpowers/plans/2026-09-16-v0.4.0-favorites-admin.md)                          |
| v0.5.0 | 分布式 & 桌面签名 & 性能   | B5 + D1 + C2 + C4 + B4 | 4 周     | [milestone outline](superpowers/plans/2026-10-21-v0.5.0-distributed-signing.md)                      |
| v1.0.0 | iOS & PWA & E2EE           | D2 + D3 + D4 + E5      | 6-8 周   | [milestone outline](superpowers/plans/2026-11-18-v1.0.0-ios-pwa-e2ee.md)                             |

> outline 版本会在临近执行时用 `superpowers:writing-plans` 展开为 TDD-step 级别的可执行 plan。

## A. 功能补齐

### A1 — 删好友 + 黑名单（3 天）

- **目标**：好友列表可移除；黑名单阻止收发消息和好友申请。
- **产物**
  - 后端：`contact_repo.Delete/Block/Unblock`；`POST /friends/:id/block`、`DELETE /friends/:id`；WS 帧 `friend.removed` 双向推送。
  - 消息发送前 `blocklist` 校验；被拉黑方发送时 `403`。
  - 前端：好友项右键菜单「删除 / 拉黑」；黑名单管理页；同意好友申请时 uncheck blocklist。
- **验收**
  - 单元：`contact_repo` Delete/Block；集成：blocklist 阻塞消息。
  - E2E：Alice 拉黑 Bob → Bob 消息 tab 收到发送失败提示 + Alice 无未读。
- **依赖**：无。

### A2 — 群管理进阶（4 天）

- **目标**：群主可任命/免除管理员、转让群主。
- **产物**
  - 后端：`POST /conversations/:id/admins`（body: `{userIds:[]}`）、`DELETE /admins/:userId`、`POST /owner-transfer`。
  - 权限：群主 = role 2，管理员 = role 1；仅群主可任命/转让；管理员继承除解散/转让外的所有权限。
  - WS 帧 `conversation.role_changed`（payload：`userId + newRole`）+ 系统消息「X 被任命为管理员」。
  - 前端：群设置页「成员管理」子页，长按/右键成员显示操作菜单。
- **验收**
  - 集成：任命/免除/转让链路；权限拒绝分支覆盖。
  - E2E：Alice 建群 → 任命 Bob 管理员 → Bob 可踢 Carol、不可解散。
- **依赖**：无（基于 v0.1 群管理）。

### A3 — @ 提及 + 引用回复 + 转发（1 周）

- **目标**：三种消息交互增强。
- **产物**
  - 数据模型：`Message` 加 `mentions int64[]` + `quoteMessageId *int64`。
  - 后端：WS `message.receive` payload 附带 `mentions/quoteId`；被 @ 者的会话 unread 打 `mentionUnread` 标。
  - 前端：
    - `@` 触发成员选择器（群内实时过滤 + 键盘导航）；发送时高亮 @ 段。
    - 引用回复：消息气泡上方显示 quote 卡片，点击滚动到原消息。
    - 转发：气泡菜单 → 选择目标会话（单/多选，最多 9 个），系统消息 `[转发自 X]`。
- **验收**
  - 单元：mention parser（`@张三` → `mentions:[42]`）+ quoteId 卡片渲染。
  - E2E：@ + 未读打标 + 引用滚动到原消息 + 转发到 2 个会话。
- **依赖**：无。

### A4 — 消息全文搜索（1 周）

- **目标**：全局搜索 + 会话内搜索。
- **产物**
  - 后端：PG `pg_trgm` 扩展 + `messages.content_tokens` GIN 索引（GORM migration）。
  - `GET /messages/search?q=&conversationId=&cursor=`；`GET /search?q=`（联系人 + 群 + 消息聚合）。
  - 前端：顶栏搜索 modal（Cmd/Ctrl+K）；会话内搜索侧栏（滚动定位 + 高亮）。
- **验收**
  - 集成：中英文分词、命中排序（时间倒序 + 完整匹配优先）。
  - E2E：跨会话搜索 → 点击结果跳转 + 高亮 + 上下文 3 条。
- **依赖**：`E1 DB migrate` 更优先（避免手动 SQL），但可独立于 E1 用 GORM AutoMigrate。

### A5 — 消息收藏（3 天）

- **目标**：任意消息可收藏，我的收藏页分类查看。
- **产物**
  - 后端：`favorites` 表（`user_id/message_id/created_at`）+ REST。
  - 前端：气泡菜单「收藏」；「我的收藏」页 tabs（全部 / 图片 / 文件 / 链接）；点击原文可跳回原会话。
- **验收**：单元 + E2E 收藏 → 列表命中 → 跳回原会话。
- **依赖**：无。

## B. 稳定性 / 可观测性

### B1 — Sentry 前端错误上报（2 天）

- **目标**：Web + Tauri 两端 uncaught error + performance 上报。
- **产物**
  - `packages/shared/src/observability/sentry.ts` 初始化（DSN 从 `VITE_SENTRY_DSN`）。
  - Web / Desktop / Android 三端 App 入口注入。
  - CI：`vite build` 后 `sentry-cli sourcemaps upload`。
- **验收**：手动触发 throw → Sentry 后台可见；release name = version。
- **依赖**：无。用户需先注册 Sentry.io（Team plan 起免费额度够开发）。

### B2 — Prometheus 指标 + Grafana 看板（3 天）

- **目标**：后端可观测化。
- **产物**
  - 后端 Gin middleware：`http_request_duration_seconds` + `http_requests_total`；WS 层：`ws_connections`、`ws_messages_total{type=...}`；业务：`chat_messages_sent_total`。
  - `/metrics` 端口独立（避免和业务同暴露）。
  - `docs/observability/grafana-dashboard.json` 覆盖 REST latency P50/P95/P99、WS 连接数、error rate。
- **验收**：docker-compose 起 prom + grafana，看板加载 dashboard.json 正常。
- **依赖**：无。

### B3 — E2E CI 集成（3 天）

- **目标**：Playwright 关键流跑进 CI。
- **产物**
  - 新 workflow `.github/workflows/e2e.yml`：docker-compose 起 pg/redis/minio → seed → Go 服务 → `pnpm test:e2e`。
  - 关键场景：登录 / 收发文本 / 撤回 / 图片消息 / 建群 / 群改名。
  - 失败截图 + trace 上传 artifact。
- **验收**：新 PR 自动跑 E2E，失败可复现（下载 trace 用 `playwright show-trace`）。
- **依赖**：无。

### B4 — 结构化日志聚合（2 天）

- **目标**：后端日志 JSON 化 + 部署侧接入 loki/vector。
- **产物**
  - 后端 zap production config：JSON 输出、请求 ID 贯穿、level filter。
  - `docs/observability/logging.md`：docker log driver 配置 + loki grafana 查询示例。
- **验收**：本地 `docker-compose -f logging.yml up` 起 loki → grafana 可查询过滤。
- **依赖**：无。

### B5 — Presence 分布式（1 周）

- **目标**：多实例后端下 presence 一致。
- **产物**
  - `ws/hub.go` 抽 `PresenceBackend` 接口：`Local`（当前 v0.1 单实例）+ `RedisPubSub`（多实例）。
  - Redis channel `presence:events`，Register/Unregister 发布，各实例订阅广播到本地连接。
  - 集成测试起两个 hub 实例共享 Redis，验证跨实例 presence。
- **验收**：两实例部署下，实例 A 上的 Alice 上线 → 实例 B 上的 Bob 收到 presence 帧。
- **依赖**：无（backend refactor）。

## C. 性能

### C1 — 消息列表虚拟滚动（1 周）

- **目标**：长会话（5k+ 消息）流畅滚动。
- **产物**
  - `@tanstack/react-virtual` 集成 ChatMessages 组件。
  - 三端布局（桌面 / 平板抽屉 / 手机）兼容。
  - 撤回/reaction/引用 UI 复用现有气泡。
- **验收**：单元 + 手动压测 10000 条消息滚动 fps > 55。
- **依赖**：无。

### C2 — 图片消息懒加载 + 缩略图（3 天）

- **目标**：会话打开时不批量预签名图片，滚到再加载。
- **产物**
  - 后端：`message.image` payload 加 `width/height`（上传时 canvas 读取）。
  - 前端：`IntersectionObserver` 触发预签名，占位用 skeleton + aspect ratio。
- **验收**：会话打开时 network 无图片预签名请求；滚动到时才发起。
- **依赖**：无。

### C3 — 首屏 code-splitting（2 天）

- **目标**：首屏 bundle < 200 KB gzip。
- **产物**
  - Vite `React.lazy` + `Suspense` 拆路由（chat / settings / friends / admin）。
  - `vite-plugin-visualizer` 分析 + 提交 `docs/perf/bundle-report-v0.3.md`。
- **验收**：Lighthouse Performance > 90；首屏 JS < 200 KB。
- **依赖**：无。

### C4 — WebSocket 心跳自适应（2 天）

- **目标**：移动端后台省电。
- **产物**
  - 前端：`document.visibilityState` + `navigator.getBattery()` 检测。
  - 前台心跳 30 s / 后台 120 s / 低电量 300 s；断线指数退避 1-30 s。
  - 后端：`pong deadline` 匹配调整。
- **验收**：Android 息屏 5 min 后前台重连 < 2 s；桌面前台每 30 s 一个 pong。
- **依赖**：无。

## D. 平台扩展

### D1 — 桌面代码签名 + 公证（1 周）

- **目标**：macOS / Windows 装包无警告。
- **产物**
  - macOS：Apple Developer ID 证书 → CI secret 注入 → `codesign` + `notarytool submit`。
  - Windows：EV / OV 证书 → `signtool sign`。
  - `.github/workflows/release.yml` 签名开关（已预留 sign_macos）打通。
  - `docs/RELEASE.md` 补 macOS 公证 + Windows EV cert 申请流程。
- **验收**：新装 macOS Ventura → 打开 dmg 无「无法验证开发者」；Windows SmartScreen 通过。
- **依赖**：用户购买证书（macOS $99/y，Windows OV ~$200/y、EV ~$400/y）。

### D2 — iOS 打包（2 周）

- **目标**：iOS ipa 出包 + TestFlight 分发。
- **产物**
  - `tauri ios init` + Xcode 项目模板。
  - CI matrix 加 iOS job（macOS-latest runner）：`xcodebuild archive` + `xcodebuild -exportArchive`。
  - Fastlane match 管理证书；TestFlight upload via `xcrun altool`。
- **验收**：CI 产出 ipa → TestFlight 审核通过 → 内测账号可安装。
- **依赖**：用户注册 Apple Developer 账户 ($99/y) + 完成 D1（Apple ID 认证）。

### D3 — PWA + Web Push（1 周）

- **目标**：Web 端离线可用 + 推送通知。
- **产物**
  - Service Worker（Workbox）：precache app shell + runtime cache API GET。
  - Web Push API：VAPID 密钥对 → 前端订阅 → 后端 `web-push` 库发推。
  - `manifest.json` 完善 icons/screenshots/shortcuts。
- **验收**：Chrome 安装 PWA → 断网可打开；对方发消息桌面/移动浏览器收到通知。
- **依赖**：无。

### D4 — E2EE 端到端加密（3-4 周）

- **目标**：单聊消息端到端加密（群聊 v1.1 再加）。
- **产物**
  - 选型：`@matrix-org/olm` 或 `libsignal-client-node`（Signal Protocol）。
  - 密钥生命周期：设备注册 → 密钥交换（X3DH）→ 会话密钥（Double Ratchet）→ 密钥备份（PIN 加密云端存 blob）。
  - UI：会话头显示锁头图标；密钥指纹对比页；重装/换设备恢复流程。
  - 服务器端只存密文，不能解密。
- **验收**：Alice 发消息 → 服务器 DB 里 content 是密文 → Bob 客户端解密显示；换 Alice 设备后能通过 PIN 恢复历史。
- **依赖**：C1 完成（消息渲染稳定）。

## E. 运营 / 管理

### E1 — 数据库迁移工具化（3 天）

- **目标**：从 GORM AutoMigrate 迁到版本化迁移。
- **产物**
  - `pressly/goose` 集成；`server/migrations/*.sql` 起始快照 = v0.1 schema。
  - `pnpm dev:server` 起动前跑 `goose up`；CI 校验 `goose status`。
  - `docs/03_DB_SCHEMA.md` 补迁移工作流。
- **验收**：新迁移文件 → 本地 `goose up/down` 可回滚 → CI green。
- **依赖**：无（早做早收益）。

### E2 — 管理后台 MVP（1-2 周）

- **目标**：管理员可查/封用户 + 处置违规会话。
- **产物**
  - 新 sub-app `apps/admin/`（React + Vite，共用 `packages/shared`）。
  - `role=admin` guard；后端 `POST /admin/*` 全部走 admin middleware。
  - 页面：用户列表 + 封禁 / 解封；会话列表 + 强制解散；消息审计 + 删除。
  - 审计日志表：`admin_action_logs(actor_id, action, target, at)`。
- **验收**：E2E：admin 封 Bob → Bob 客户端弹「账号已封禁」拒绝登录 → admin 解封 → Bob 恢复。
- **依赖**：E1（新增 admin 表用迁移文件）。

### E3 — 内容审核（1 周）

- **目标**：敏感词过滤 + 用户举报流程。
- **产物**
  - 敏感词库（可配置 `config.yaml.moderation.words: [...]`）；命中不阻止但打标 `flag`。
  - 用户举报接口 `POST /reports`（消息 / 用户 / 群），气泡菜单加「举报」。
  - 管理后台加「举报队列」+「敏感消息命中」两个页面。
- **验收**：命中敏感词 → 审核队列出现记录 + admin 可处理 / 忽略。
- **依赖**：E2。

### E4 — i18n 补齐（3 天）

- **目标**：ja-JP + ko-KR 双语。
- **产物**
  - `packages/shared/src/i18n/{ja-JP,ko-KR}.json` 全量翻译。
  - 日期/时区本地化验证（当前用 `Intl.DateTimeFormat`，需验证 ja/ko 输出）。
  - 语言切换页新增两项。
- **验收**：切到 ja / ko → 全 UI 无中英文残留（自动化 lint 扫 zh-CN key 全量对应）。
- **依赖**：无（翻译可外包）。

### E5 — 部署编排（1 周）

- **目标**：一键生产部署。
- **产物**
  - `deploy/docker-compose.prod.yml`：Go 服务 + pg + redis + minio + nginx + prometheus + grafana + loki。
  - 可选 `deploy/helm/`（Kubernetes chart，v1.1 完善）。
  - `docs/deploy/self-hosted.md` 覆盖：域名/证书/环境变量/备份策略。
- **验收**：干净 Ubuntu VPS `curl … | bash` 一键跑起完整服务栈。
- **依赖**：B2 + B4（监控栈复用）。

## 依赖图（关键路径）

```
A1 A2 A3 A5 B1 B3 C1 C3 C4 D1 D3 E4  (相互独立，可插队)
       │                    │
       ▼                    ▼
       A4 需 pg_trgm       D2 需 D1（Apple 认证）
       │
       ▼
       E1 → E2 → E3
       │
       ▼
       B2 → B4 → E5（监控 → 日志 → 部署）
                 │
                 ▼
                 B5（多实例 presence，配合 E5）

D4 (E2EE) 需要 C1 完成（消息渲染稳定后再加密层）
```

## 里程碑决策要点

| 决策                    | 何时              | 输入                                      |
| ----------------------- | ----------------- | ----------------------------------------- |
| 采购签名证书            | v0.4.0 收尾前     | 预算：$99/y (macOS) + $200/y (Windows OV) |
| Apple 开发者            | v0.5.0 前         | $99/y                                     |
| Sentry 账户             | v0.2.0 前         | 免费 team plan 起                         |
| 加密协议选型            | v0.5.0 收尾复盘时 | matrix olm vs libsignal 对比              |
| Grafana Cloud vs 自托管 | E5 前             | 视用户量而定                              |

## 版本发布节奏

- 每个大版本（v0.X.0）：feature branch 累积 → 最后一批次 squash 后开 `release/v0.X.0` 分支 → 走 release-it → tag → GitHub Actions 自动出包。
- Hotfix：`hotfix/*` 从 main → 修完 merge dev + main + 手动 patch tag。
- Changelog：release-it + conventional-changelog（angular）自动生成，人工润色 Highlights 段。
