# 元聊 YuanChat — 迭代路线图

> **本文档只负责「批次顺序与版本归属」。「还有什么没做」的唯一真源是
> [`MASTER_PLAN.md` 的未做清单总览](MASTER_PLAN.md#未做清单总览单一真源)**——新发现的待实现项
> 与技术债一律登记到那里，不要只写在这里。
>
> 从 v0.1.0（MVP）到 v1.0.0（生产就绪）的完整规划。每条批次都能独立成为一个 `feature/*` 分支。
>
> **约束**：所有批次继承 v0.1.0 已有的全局约束（GitFlow、i18n 四语种无硬编码、
> `build.target=es2019`、`rounded-lg`、每批次末尾门禁、验证后关服务）。合并回 `dev` 一律
> `git merge --no-ff` 保留每个独立 commit，**禁止 squash**。
>
> **执行状态（2026-09-04，代码审计核实，基线 `b179320`）**：v1.0 路线图 **23 个批次
> 中 21 个已完成**（此前记作「21 中 19」，批次总数与完成数均为笔误）。v1.0 路线图之外
> 又追加完成了 A6 / A7 / A8 / H1 / H1b / admin-hardening / K1 / K6 / K7 / K8 与
> 「对象级读授权 + 离线对象 GC」。
>
> - **tag v0.2.0**（已发布）：A1-A5、B1-B3、C1、C3、E1
> - **tag v0.3.0**（已发布）：E2-E4（管理后台/审核/ja-ko）、B4、B5、
>   C2、C4、D1（updater 自签部分）、D3（PWA+Push）、D4（E2EE 单聊）、E5（部署编排）
> - **tag 后追加已完成（尚未发版）**：A6（会话置顶+免打扰）、A7（清空记录/群公告/群内昵称）、
>   H1（贴纸/收藏表情，含审计修复批）、对象级读授权 + 离线对象 GC、
>   A8（auth 补全与安全加固）、H1b（表情商城与投稿发布）、
>   admin-hardening（管理端治理 + 限流/分发多实例化 + B7 覆盖率门禁 + B8 后端测试基建）、
>   **K7 会话媒体相册 + K6 视频消息 + K8 语音倍速**（含 husky pre-commit tsc 门禁）、
>   **K1 消息编辑与编辑历史**（迁移 017；含生产对象存储对外端点、扫码 canceled 终态、
>   shared/ui 补 tsconfig 三项债收口）
> - **v1.0 路线图未完成 2 项**：D2 iOS（需 macOS + Apple Developer 账户）、
>   D1 的 OS 层付费签名（Apple 公证 / Windows SmartScreen，证书就绪后填
>   secrets 即生效，workflow 门控已就绪）
>
> **下一阶段（2026-07-31 立项，2026-08-23 重排）**：通话 / 朋友圈 / 表情服务，
> 见 [v0.4-v0.5 social & calls outline](superpowers/plans/2026-07-31-v0.4-v0.5-social-and-calls.md)。
> 该 outline 的 A6 / A7 / H1 / H1b 均已完成，剩余 F0-F2（通话）、G1-G2（朋友圈）。
> **待排**：K 泳道剩余项（K3 命令面板、K12 桌面托盘、K17 新设备登录通知…）、
> J 泳道（体验与无障碍）、C5-C9（性能工程）、B9（压测与容量文档）。
>
> ⚠️ **凡本文档判定为「未做」的内容，一律登记在
> [MASTER_PLAN 未做清单总览](MASTER_PLAN.md#未做清单总览单一真源) 并挂到批次号上。**
> 曾发生过 A6/A7 的 plan 被静默删除、范围记录只剩记忆的事故，也发生过 README 把
> 4 项早已完成的功能长期列为「未做」。新增/关闭未完成项时必须同步那份清单。

## 里程碑总览

### 已交付（v1.0 原始规划，23 批次）

> ⚠️ 本表是**立项时的原始规划**，与实际发版节奏不同：23 个批次实际被压缩进
> v0.2.0 与 v0.3.0 两个 tag 发出（见文首执行状态）。表中 v0.4.0 / v0.5.0 / v1.0.0
> 三行是历史规划编号，**与下方「后续规划」里同名的 v0.4.0 / v0.5.0 不是同一批内容** ——
> 前者的批次除 D2 与 D1 付费签名外均已随 v0.3.0 交付。保留本表用于追溯批次归属。

| 版本           | 主题                       | 包含批次               | 预计工时 | 详细计划文档                                                                                         |
| -------------- | -------------------------- | ---------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| v0.2.0         | 关系 & 群管进阶 + 前端观测 | A1 + A2 + A3 + B1      | 4 周     | [超详细 TDD plan](superpowers/plans/2026-07-22-v0.2.0-relations-groups-mentions-sentry.md)（可执行） |
| v0.3.0         | 搜索 & 性能 & 后端观测     | A4 + C1 + C3 + B2 + B3 | 4 周     | [milestone outline](superpowers/plans/2026-08-19-v0.3.0-search-perf-observability.md)                |
| （历史）v0.4.0 | 收藏 & 管理后台            | A5 + E1 + E2 + E3 + E4 | 5 周     | [milestone outline](superpowers/plans/2026-09-16-v0.4.0-favorites-admin.md)                          |
| （历史）v0.5.0 | 分布式 & 桌面签名 & 性能   | B5 + D1 + C2 + C4 + B4 | 4 周     | [milestone outline](superpowers/plans/2026-10-21-v0.5.0-distributed-signing.md)                      |
| （历史）v1.0.0 | iOS & PWA & E2EE           | D2 + D3 + D4 + E5      | 6-8 周   | [milestone outline](superpowers/plans/2026-11-18-v1.0.0-ios-pwa-e2ee.md)                             |

### 后续规划

| 版本       | 主题                | 包含批次                   | 预计工时 | 状态                      |
| ---------- | ------------------- | -------------------------- | -------- | ------------------------- |
| （未发版） | 已完成但未发 tag    | A6 + A7 + H1 + 对象 ACL/GC | —        | ✅ 已在 dev               |
| （未发版） | auth 补全与安全加固 | A8                         | 1-1.5 周 | ✅ 已在 dev               |
| （未发版） | 表情商城与投稿发布  | H1b                        | 1.5 周   | ✅ 已在 dev               |
| （未发版） | 管理端治理 + 债收口 | admin-hardening + B7 + B8  | 1.5 周   | ✅ 已在 dev               |
| （未发版） | 媒体相册与视频消息  | **K7 + K6 + K8**           | 3-5 天   | ✅ 已在 dev（2026-09-04） |
| （未发版） | 消息编辑与编辑历史  | **K1**（+ 3 项债收口）     | 3-5 天   | ✅ 已在 dev（2026-09-05） |
| 待排       | 社交扩展            | G1 + G2                    | 2 周     | outline 已有，需展开 plan |
| 待排       | 实时通话            | F0 + F1 + F2               | 3-4 周   | 需 F0 spike 先行          |
| 待排       | 体验与无障碍        | J1 + J2 + J3 + J4 + J5     | 3-4 周   | 本轮新增泳道              |
| 待排       | 性能工程            | C5 + C6 + C7 + C8 + C9     | 3-4 周   | 本轮新增批次              |
| 待排       | 质量工程            | B9                         | 0.5 周   | B7/B8 已随治理批次完成    |
| 待排       | K 泳道剩余项        | K3 / K12 / K17 等          | 视挑选   | 见 MASTER_PLAN K 泳道表   |

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

### A6 — 会话置顶 + 免打扰（3-4 天）✅ 已完成

- 迁移 009；`PUT /conversations/:id/settings`；置顶排序 + 免打扰全链路。
- 详细计划：[a6-conversation-pin-mute](superpowers/plans/2026-07-31-a6-conversation-pin-mute.md)。

### A7 — 聊天体验补全（4-5 天）✅ 已完成

- 迁移 010；清空聊天记录（`cleared_before_seq` 单侧）、群公告、群内昵称（`alias`）。
- 详细计划：[a7-chat-experience](superpowers/plans/2026-08-03-a7-chat-experience.md)。

### A8 — auth 补全与安全加固（1-1.5 周）✅ 已完成

- **目标**：消除两条「看起来能用、实际什么都没做」的假链路，并补上账号维度的暴力破解防护。
  当前 `/forgot-password` 三步走完会显示「密码重置成功」但**密码根本没改**；
  `/qr-login` 的二维码是 canvas 手绘伪码（xorshift 种子 31337），不编码任何 token。
  两个入口都已对用户开放（`LoginPage.tsx:119`、`:124`）。
- **产物**
  - 迁移 014：`users` 加 `token_version int not null default 0`（重置密码后全设备下线）。
  - 后端 — 忘记密码：`POST /auth/password/otp`（发码）、`POST /auth/password/verify`（验码换
    一次性 reset ticket）、`POST /auth/password/reset`（改密 + 自增 token_version）。
    OTP 走 Redis TTL key（对齐 captcha 范式）+ `verification_codes` 表留审计（该表自
    `001_baseline.sql:129` 起就存在但零 Go 引用，本批次复活，不新增建表）。
  - 后端 — 发码通道：`CodeSender` provider 抽象（`internal/pkg/codesender/`），
    开发期 `LogSender` 打码到日志，生产期可换 SMS/邮件 provider 而不改调用方。
  - 后端 — 扫码登录：`POST /auth/qr/session`（建会话返 token）、`GET /auth/qr/:token`
    （桌面轮询状态）、`POST /auth/qr/:token/scan`（手机已登录态标记已扫）、
    `POST /auth/qr/:token/confirm`（确认换 token pair）。状态机存 Redis，
    token 用 `crypto/rand`（**不可照抄 captcha 的 `rand.IntN`，有碰撞风险**）。
  - 后端 — P0 安全组：账号级登录失败锁定（Redis 计数器，5 次失败 → 冷却 15 min；
    现有 `middleware/ratelimit.go:98` **只有 IP 维度**，换 IP 即可绕过）；
    后端密码复杂度校验（现 `handler/user.go:205` 仅 `min=8,max=64`，绕过前端可设弱密码，
    需与前端 `validatePassword` 的 5 条规则对齐）；补 `POST /auth/logout` 路由
    （前端 `authStore.ts:184` 一直在调，后端不存在，被 try/catch 吞掉）。
  - 前端：四个 auth 页（Login/Register/ForgotPassword/QrLogin）从 `apps/web` 与
    `apps/desktop` 各一份**下沉到 `packages/ui`**，端差异按 `SettingsScreen` 既有范式
    注入 —— 内部 `useBreakpoint()` 自决形态 + `ReactNode` slot 接端专属件
    （桌面 `TitleBar`），**`isDesktop`/`isMobile` 不作为 prop 传入 packages/ui**。
    下沉后这四页首次获得组件测试能力（`apps/web` 无 vitest 配置，测试只在 `packages/ui`）。
  - 前端：真二维码（生成库需选型，es2019 兼容）+ 轮询；注册页用户协议勾选（未勾选禁用提交）。
  - 安卓扫码：Tauri barcode-scanner 插件（**仓库零痕迹，权限名须查官方 permissions 表，
    禁止猜测**）；`capabilities/default.json:5` 的 windows 白名单补 `"qr-login"`；
    `AndroidManifest.xml` 手改加 CAMERA（**该文件是手改并提交的，禁止 `tauri android init`
    重新生成**，会摧毁 MainActivity.kt 的软键盘适配）。
  - 安全头：`tauri.conf.json:25` 的 `"csp": null` 收紧；`deploy/nginx/ssl-params.conf:12`
    被注释的 HSTS 打开。
- **验收**
  - 集成：OTP 发→验→改密全链路；错码不消费 OTP（尝试计数器，**不照抄 captcha
    「答案错也删 key」的写法**）；改密后旧 access token 401；账号锁定触发与解除；
    弱密码被后端拒绝。
  - E2E：新增 `forgot-password.spec.ts` + `qr-login.spec.ts`（这两页目前是全仓唯一
    零测试的页面，也正是缺陷能活下来的原因）；MSW 补 reset/OTP/QR + 缺失的 refresh handler。
  - 真机：USB 连安卓真机扫桌面二维码完成登录。
- **依赖**：无。**设计文档**：`superpowers/specs/2026-08-23-auth-completion-design.md`。

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

### B6 — 文档与进度真源对齐（2-3 天）

- **目标**：让文档不再骗人。四份主文档当前与代码严重脱节，已造成实际误导：README
  把 4 项早已完成的功能列为「未做」；MASTER_PLAN 架构图画的是 gRPC 微服务 +
  Elasticsearch（实际是单进程 Gin 单体 + PG `pg_trgm`）；AGENTS.md 说 i18n
  只有中英两语（实际四语 × 506 键）。
- **产物**
  - `README.md`：端口 8080/8081 → 8085/8086（含 `adb reverse` 那行）；删掉 4 条
    假「未做」；皮肤名改真值（`yuan/ocean/forest`，非 Aurora/Ocean/Emerald）；
    补漏掉的已完成项（`apps/admin`、E2EE、转发、@提及、Push、举报、收藏、PWA、
    Sentry、Prometheus）；CI 触发条件改真值。
  - `docs/MASTER_PLAN.md`：§2.2/§2.3/§三 架构图重画为真实单体形态；§五 功能清单
    勾选修正（离线推送/全文搜索/E2EE/管理后台/审计日志已完成）；§十一 安全设计
    10 项按真实状态勾选（8 项已完成）；§十二 里程碑改为真实批次时间线；
    页脚「最后更新 2026-06-12」与「下一步：请审阅本计划书」清除。
  - `AGENTS.md`：删第 19 行 `[[]]` 残留；i18n 两语 → 四语；删「Go 微服务 + gRPC」、
    Elasticsearch、Kubernetes(生产) 三处失真表述；状态块（2026-07-22）刷新；
    端口 8080/8081 + MinIO 9000/9001 → 8085/8086 + 9002/9003。
  - `.env.example:2-3` 端口同步（唯一非文档改动，与文档同批以免再次漂移）。
- **验收**：全仓 grep `8080`/`8081`/`gRPC`/`Elasticsearch` 零命中于文档；
  README「未做」段每条都能在代码里找到对应缺口。
- **依赖**：无。**注**：`docs/DB_SCHEMA.md` 按 001-013 迁移重建**不在本批次**，见未做清单 B7。

### B7 — 提交与 CI 门禁补齐（2 天）✅ 已完成（覆盖率门禁随 admin-hardening；husky tsc 随 K7 批次）

- **目标**：把「靠人记得」的规范变成机器挡下的门禁。当前 Conventional Commits
  只写在文档里，无 commitlint；`husky` 不跑 `tsc`，幽灵依赖只能在 CI 才暴露。
- **产物**：`@commitlint/{cli,config-conventional}` + `commit-msg` 钩子；
  CI 触发补 `main` 分支；`test:coverage` 接入 CI 并设阈值（后端 80% / 前端 60%，
  MASTER_PLAN §6.2 已承诺但从未落地）；`docs/DB_SCHEMA.md` 按 001-013 实际迁移重建。
- **验收**：故意写不合规 commit message 被本地钩子拒；覆盖率低于阈值 CI 红。
- **依赖**：无。

### B8 — 后端测试基建（3 天）✅ 后端已完成（前端统一 render helper 未做）

- **目标**：消除测试重复与「连不上就跳过」的假绿。当前无 testify/sqlmock/miniredis，
  DSN 硬编码 `port=5434`、Redis `localhost:6380 DB 2`，连不上直接 `t.Skipf`——
  CI 环境缺依赖时测试全部静默跳过仍显示通过。`testRedis` helper 在三个包各抄一份，
  handler 包干脆没有（A8 的 OTP 测试首个撞上此坑）。
- **产物**：引入 `miniredis` 消除对真实 Redis 的依赖；`internal/testutil/` 收敛
  DSN/Redis/fixture helper（替掉三份重复）；`t.Skipf` 改为 CI 环境下 `t.Fatal`
  （本地保留 skip，用环境变量区分）。
- **验收**：`go test ./...` 在无 Redis 环境下仍全绿（miniredis 接管）；CI 缺 PG 时红而非跳过。
- **依赖**：无。建议与 A8 相邻或前置（A8 的 OTP/QR 测试直接受益）。

### B9 — 契约与错误码收敛（3 天）

- **目标**：错误映射与 API 文档现在都是手工复制。每个 handler 各写一串
  `errors.Is` 链（`handler/user.go:74-86`），业务码不一致（409 / 40301 / 4001 混用）；
  swagger 注解 78 处待补。
- **产物**：sentinel error → HTTP 状态 + 业务码的**集中映射表**，handler 只调一次；
  业务码规范化（统一位数与分段）；swagger 注解补齐并生成可访问的 API 文档；
  golden 契约从 `message-send` 扩展到贴纸/文件/auth 三类。
- **验收**：新增 sentinel 只需改映射表一处；`errors.Is` 链在 handler 层零残留。
- **依赖**：无。

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

### C5 — 性能基线与预算门禁（3 天）

- **目标**：把性能从「感觉快」变成有数字、能回归。C3 承诺的
  `docs/perf/bundle-report-v0.3.md` 从未产出，Lighthouse > 90 与首屏 < 200 KB
  两个指标至今无人复核，也没有任何机制阻止下一次提交把体积吃回去。
- **产物**：`docs/perf/baseline.md` 记录四端首屏体积/冷启动/首帧/内存基线数字；
  CI 加 bundle size 预算门禁（超阈值红）；`vite-plugin-visualizer` 产物入库
  （补齐 C3 欠的 bundle report）；Lighthouse CI 跑关键路由。
- **验收**：故意 import 一个大库 → CI 因超预算而红。
- **依赖**：无（B7 门禁基建可复用）。

### C6 — 冷启动与首帧（1 周）

- **目标**：优化「点开到能用」这段。当前四端均无冷启动埋点，安卓旧 WebView
  的首帧成本未测量。
- **产物**：启动阶段埋点（进程起 → JS 执行 → 首帧 → 可交互）；
  首屏关键请求并行化与预取（会话列表 + 用户信息现为串行）；
  字体与图标按需子集化；Tauri 侧窗口显示时机与白屏遮挡处理。
- **验收**：安卓真机（Chrome 74 WebView 档位）冷启动到可交互的数字优于 C5 基线。
- **依赖**：C5（无基线无从验收）。

### C7 — 长列表与内存（1 周）

- **目标**：C1 已把消息列表虚拟化，但会话列表、成员列表、收藏列表、贴纸网格
  仍是全量渲染；长时间挂着不关的会话内存增长未测。
- **产物**：剩余长列表虚拟化；图片/贴纸对象 URL 与预签名缓存的淘汰策略
  （当前内存 Map 只增不减）；长会话切换时的消息 store 卸载；
  内存快照对比（挂机 1h 前后）。
- **验收**：10 万条历史 + 500 会话下滚动 fps > 55；挂机 1h 内存增长有上界。
- **依赖**：C5。

### C8 — 网络与缓存（4 天）

- **目标**：减少重复请求与冷缓存。当前预签名 URL 每端各自缓存在内存、刷新即失效；
  头像与贴纸没有 HTTP 缓存策略；WS 重连后会全量重拉。
- **产物**：预签名 URL 持久化缓存（含过期时间，跨刷新复用）；
  静态对象响应头 `Cache-Control` / `ETag`（MinIO 侧与 nginx 侧）；
  WS 重连增量同步（按 seq 水位补齐而非全量重拉）；请求去重与合并。
- **验收**：二次进入会话零重复预签名请求；重连只拉增量。
- **依赖**：无。

### C9 — 后端压测与容量基线（4 天）

- **目标**：MASTER_PLAN §四 阶段四列了「性能优化 & 压测」但从未执行，
  至今不知道单实例能承载多少并发连接与消息吞吐。
- **产物**：WS 连接数与消息吞吐压测脚本（k6 或 vegeta + 自建 WS 客户端）；
  慢查询采集与索引复核（`pg_stat_statements`）；
  `docs/perf/capacity.md` 记录单实例容量与瓶颈点；
  限流参数按压测结果调整（现全部硬编码在 `router/router.go`，非配置项）。
- **验收**：给出「单实例支撑 N 并发连接 / M msg/s」的可复现数字与瓶颈定位。
- **依赖**：B2（Prometheus 指标做压测观测面）。

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
  - `docs/DB_SCHEMA.md` 补迁移工作流。
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

## F / G / H. 通话 / 朋友圈 / 表情服务

这三条泳道于 2026-07-31 立项，批次正文见
[v0.4-v0.5 social & calls outline](superpowers/plans/2026-07-31-v0.4-v0.5-social-and-calls.md)
（为免两处漂移，此处只列状态与批次号，不复制正文）。

| 批次 | 主题                    | 状态      | 备注                                                     |
| ---- | ----------------------- | --------- | -------------------------------------------------------- |
| F0   | WebRTC 跨端可行性 spike | 未开始    | Linux webkit2gtk 4.1 与 Android 权限转发是两个已知风险点 |
| F1   | 1v1 语音通话            | 未开始    | 依赖 F0；需 coturn，端口须避开 yuanai 占用               |
| F2   | 视频通话                | 未开始    | 依赖 F1                                                  |
| G1   | 朋友圈后端              | 未开始    | 迁移号需顺延（outline 写的 012 已被占用）                |
| G2   | 朋友圈前端三端          | 未开始    | 依赖 G1；移动端底栏已 4 项，加第 5 项需重排              |
| H1   | 表情收藏 + 表情包       | ✅ 已完成 | 迁移 011/012；含审计修复批                               |
| H1b  | 表情商城 + 自主发布     | ✅ 已完成 | 迁移 **015**；含商城/投稿/治理与三端实测修复             |
| H1c  | 表情包付费/购买         | 候选      | 需支付网关，暂不排期                                     |

## J. 用户体验与无障碍

> 泳道字母从 J 起（I 与数字 1 易混，跳过）。A-H 已占用。

### J1 — 首次使用引导与空态体系（4 天）

- **目标**：新用户注册完直接落到空会话列表，不知道下一步该干什么。
  当前空态只有图标 + 一行字，没有引导动作。
- **产物**：注册后引导（完善资料 → 加好友 → 发第一条消息，可跳过且不再提示）；
  空态统一为「插画 + 说明 + 主行动按钮」三件套（会话/好友/申请/收藏/贴纸/搜索无结果）；
  首次使用某功能的轻量提示（长按菜单、@提及、贴纸收藏各一次，localStorage 记录）。
- **验收**：新账号从注册到发出第一条消息全程有明确下一步；引导可跳过且不复现。
- **依赖**：无。

### J2 — 三态统一与页面级重试（4 天）

- **目标**：加载/空/错三态各页面写法不一，错误处理普遍只弹 toast 就算完。
  `FavoritesView.tsx` 是典型：加载态是个居中转圈（无骨架屏），
  三处错误全走 `showToast("error")`，用户看完 toast 消失后面对一个空页面、无从重试。
- **产物**：`AsyncBoundary`（或等价约定）统一三态；列表页一律骨架屏（对齐既有 CLS 规范）；
  错误态给页面级重试按钮而非仅 toast；离线/429/服务不可达三种情形给可区分的提示条。
- **验收**：随机断网后每个列表页都能看到可重试的错误态，而非空白页。
- **依赖**：无。

### J3 — 快捷键与命令面板（4 天）

- **目标**：桌面端目前只有 Cmd/Ctrl+K 搜索一个快捷键，重度用户全程靠鼠标。
- **产物**：命令面板（会话跳转 / 功能跳转 / 设置项直达）；
  快捷键体系（会话上下切换、标记已读、发送/换行、Esc 层级关闭、数字键切换导航）；
  快捷键一览表（设置页内）；与 IME 输入法组合键冲突的规避。
- **验收**：键盘完成「找会话 → 发消息 → 切下一个会话」全程不碰鼠标；中文输入法下无误触发。
- **依赖**：无。

### J4 — 无障碍 WCAG 2.1 AA（1 周）

- **目标**：MASTER_PLAN §6.1 承诺「满足 WCAG 2.1 AA」，实际从未验证。
- **产物**：焦点管理与可见焦点环（弹层/抽屉/菜单的焦点捕获与归还）；
  语义化与 `aria-*` 补齐（列表、菜单、开关、Tab）；`aria-live` 播报
  （新消息、发送状态、错误）；对比度全色板核查（含四套皮肤 × 亮暗）；
  `prefers-reduced-motion` 尊重；键盘可达性全量走查；axe 自动化扫描接入 CI。
- **验收**：axe 关键页面零 serious/critical；仅键盘 + 屏幕阅读器可完成登录到发消息。
- **依赖**：J3（焦点与键盘体系同源）。

### J5 — 移动端手势与触感（4 天）

- **目标**：移动端除长按菜单外无任何手势，返回只能点左上角箭头。
- **产物**：会话项左滑操作（置顶/免打扰/删除）；页面右滑返回（栈式布局）；
  下拉刷新（会话列表/朋友圈 feed）；关键操作触感反馈（haptics，需查 Tauri 插件权限名）；
  安全区与横屏适配复核。
- **验收**：安卓真机手势全部生效且不与系统返回手势冲突；旧 WebView 下无卡顿。
- **依赖**：无。**注**：涉及 Tauri 插件时权限名须查官方文档，禁止猜测。

## K. 体验增强（候选池，见 [MASTER_PLAN K 泳道表](MASTER_PLAN.md#8-k-泳道--体验增强候选池2026-08-30-发散全部未立项)）

| 批次 | 主题              | 状态      | 备注                                               |
| ---- | ----------------- | --------- | -------------------------------------------------- |
| K1   | 消息编辑          | ✅ 已完成 | 2026-09-05；5 分钟窗口 + 编辑历史 + 编辑重跑审核   |
| K6   | 视频消息（≤120s） | ✅ 已完成 | 2026-09-04；仅文件选择，客户端 canvas 抽帧封面     |
| K7   | 会话媒体相册      | ✅ 已完成 | 2026-09-04；`GET /conversations/:id/media`，无迁移 |
| K8   | 语音倍速播放      | ✅ 已完成 | 2026-09-04；1x/1.5x/2x 全局速率，跨播放保持        |
| 其余 | K2-K5 / K9-K17    | 候选      | 优先级与依赖见 MASTER_PLAN K 泳道表                |

## 未做清单总览 → 已迁移

> **本节内容已迁往 [`MASTER_PLAN.md` 的未做清单总览](MASTER_PLAN.md#未做清单总览单一真源)。**
>
> 真源只留一份：本文档负责「批次顺序与版本归属」，MASTER_PLAN 负责「还有什么没做」。
> 新发现的待实现项与技术债一律登记到 MASTER_PLAN，不要写回这里——两处并存必然漂移，
> 而漂移正是当初建表要解决的问题（A6/A7 的 plan 被静默删除、README 把 4 项已完成功能长期列为「未做」）。
>
> MASTER_PLAN 的清单按六组组织：A8 auth 补全 / H1b 贴纸商城 / 既有代码真实缺陷 /
> J 泳道体验与无障碍 / C5-C9 性能与容量 / B6-B9 文档与质量门禁。批次号与本文档一致。

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

### 新批次依赖（B9 / C5-C9 / J1-J5 / F / G / K 剩余项）

```
A8 B6 B7 B8 H1b K1 K6 K7 K8   ✅ 已完成（保留于图中以示依赖已解除）

B9                            契约与错误码收敛（B7 门禁已就位）

C5 → C6                       无基线无从验收冷启动
C5 → C7                       同上（内存/长列表）
C8                            独立
B2 → C9                       压测要有指标观测面

J3 → J4                       焦点与键盘体系同源
J1  J2  J5                    相互独立

F0 → F1 → F2                  spike 先行
G1 → G2                       后端先行

K3 K12 K17                    相互独立，纯前端/桌面/登录钩子
K13 K15                       依赖 A8 留的多设备会话债（device/session 表）
```

> GC 引用登记是每次新增「对象引用来源」时的必做项，不是某一批的特例：
> `sticker_packs.cover_url`（H1b）与 `messages.content->>'thumb_key'`（K6 视频封面）
> 都曾/会因漏登记而被 GC 在宽限期后误删。新增任何存 object key 的字段时，
> 必须同步改 `ObjectACLRepository.ReferencedKeys` 与 `CanRead`。
> 见 [MASTER_PLAN 未做清单总览](MASTER_PLAN.md#未做清单总览单一真源)。

## 里程碑决策要点

| 决策                    | 何时              | 输入                                      |
| ----------------------- | ----------------- | ----------------------------------------- |
| 采购签名证书            | v0.4.0 收尾前     | 预算：$99/y (macOS) + $200/y (Windows OV) |
| Apple 开发者            | v0.5.0 前         | $99/y                                     |
| Sentry 账户             | v0.2.0 前         | 免费 team plan 起                         |
| 加密协议选型            | v0.5.0 收尾复盘时 | matrix olm vs libsignal 对比              |
| Grafana Cloud vs 自托管 | E5 前             | 视用户量而定                              |

## 版本发布节奏

- 每个大版本（v0.X.0）：feature 分支逐批 `--no-ff` 合入 `dev` → 开 `release/v0.X.0` 分支 → 走 release-it → tag → GitHub Actions 自动出包。
- Hotfix：`hotfix/*` 从 main → 修完 merge dev + main + 手动 patch tag。
- Changelog：release-it + conventional-changelog（angular）自动生成，人工润色 Highlights 段。
