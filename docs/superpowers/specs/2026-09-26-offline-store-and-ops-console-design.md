# L1 离线本地消息库 + 运维概览重构 — 设计

> 日期：2026-09-26 · 分支：`feature/offline-store-and-ops-console`（自 `dev` 切出）
> 对应未做清单：`MASTER_PLAN.md` §9（L1 离线本地消息库）、§4 J9（离线态与重连反馈）、
> §4 J1（键盘可达性与焦点管理，部分）、阶段四「数据统计面板」、§2.7/§2.8 若干登记债

## 一、问题陈述

**断网启动任何一端，会话列表与历史消息全是空的。** 所有数据都靠进程内 Zustand +
实时拉后端，本地零落盘（全仓唯一的持久化是 `crypto/keyStore.ts` 的 E2EE 密钥，走
localStorage）。既有 D3「PWA 离线可用」只 precache 了 app shell——壳子打得开，里面是空的。

三项现状核实（写 spec 前逐条验证）：

| 项              | 现状                                                                       |
| --------------- | -------------------------------------------------------------------------- |
| 本地落盘        | 零。`packages/shared/src/store/*` 全内存                                   |
| 下拉刷新        | 零。全仓无任何 pull-to-refresh 实现                                        |
| 网络监听        | 仅 `chatSocket.ts:369` 的 `online` 事件用于跳过退避重连，**UI 完全无感知** |
| 增量拉取端点    | 无。`GET /messages` 只有 `before_seq`（向前翻），没有向后补空洞的能力      |
| `client_msg_id` | 有列（`001_baseline.sql:82`）但**无唯一索引、服务端无去重逻辑**            |

同时，管理端概览页（`apps/admin/src/pages/Overview.tsx`，370 行）是 23 个等权小方块
竖着堆叠，无层级、无趋势、无图表；`GET /admin/stats` 只返回标量快照，没有任何时间序列。

## 二、已定裁决（不再重开讨论）

| 编号 | 裁决                                                                                 | 理由                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| L1-1 | **IndexedDB 三端统一**，不引 `tauri-plugin-sql`                                      | Tauri 桌面（WebKitGTK/WebView2）与安卓（System WebView）都自带 IDB。一套实现覆盖三端，无 Rust 依赖/迁移/capabilities 权限 |
| L1-2 | **E2EE 消息不落正文**，只落 seq/时间/发送者 + 「加密消息」占位行                     | 已核实 `doubleRatchet.ts:251` 用后即删消息密钥、棘轮前向推进 → 历史密文**物理上无法二次解密**，「存密文读时解密」不成立   |
| L1-3 | 范围 = **会话列表 + 消息正文 + 媒体本体缓存**                                        | 用户选定                                                                                                                  |
| L1-4 | 媒体缓存 = **图片 + 语音原件；视频只缓存封面**                                       | 视频本体可达几十 MB，占满配额会把图片语音全挤掉，而离线看视频是弱需求                                                     |
| L1-5 | 保留窗口 = **每会话最近 500 条**（不按天数）                                         | 按天数会让高频大群吃光配额、把低频单聊的重要历史一起清掉                                                                  |
| L1-6 | 媒体配额 = **全局 200MB + LRU**（按 `lastAccessAt`），超限删到 80% 水位              | —                                                                                                                         |
| L1-7 | 同步模型 = **投影 + seq 增量对账 + 离线发送 outbox**（方案 C）                       | 用户选定。本地永远是投影、服务端永远是真源，故无冲突合并模型                                                              |
| L1-8 | **不调用 `navigator.storage.persist()`**                                             | Firefox 会弹原生权限框，违反本仓「禁原生权限弹窗」约束。本地库是投影，被系统清掉可从服务端重建，接受 best-effort 语义     |
| L1-9 | IDB 中媒体存 **`ArrayBuffer` + `mimeType`**，不直接存 `Blob`                         | 部分 WebView 对 `Blob` 的 structured clone 会失败；`ArrayBuffer` 支持面广得多。读时 `new Blob([buf], { type })` 重建      |
| N-1  | 下拉刷新按 **`pointer: coarse`** 内部门控（`matchMedia`），**不接 `isDesktop` prop** | 沿用 A8 裁决 D1：`packages/ui` 组件断点一律内部推导。Web 移动视口也是触屏，按平台门控会漏掉它                             |
| N-2  | 桌面端**不加全局刷新按钮**，改为「回前台自动对账」+ 仅三处局部刷新图标               | 会话列表/联系人/新朋友/互动消息都是 WS 驱动的，给它们加刷新按钮是装饰性控件；只有贴纸商城/朋友圈信息流/我发布的确实缺推送 |
| O-1  | 概览页图表 **手写 SVG**，不引图表库                                                  | 零依赖、零 bundle 增量、es2019 天然安全、取色直接走主题 token（暗色自动跟随）。概览页用不上 tooltip 跟随/缩放             |

## 三、L1 离线本地消息库

### 3.1 库形态与账号隔离

库名 **`yuanchat-l1-<userId>`**，一个账号一个库。退出登录/切换账号时
`indexedDB.deleteDatabase(name)` 一行清干净——顺带把 K13「多账号切换的本地存储分层」
这条债的存储侧提前收口。

新增 `packages/shared/src/localdb/` 目录（遵循「源码目录按领域分子文件夹」约定）：

```
packages/shared/src/localdb/
  index.ts          # 对外唯一出口
  db.ts             # 开库/升级/关库，Promise 包装 IDBRequest
  conversations.ts  # 会话投影读写
  messages.ts       # 消息读写 + 保留窗口淘汰
  outbox.ts         # 待发队列
  media.ts          # 媒体缓存 + 配额 LRU
  types.ts          # 行类型定义
```

### 3.2 Schema（`schemaVersion = 1`）

| store           | keyPath       | 索引                                  | 内容                                                               |
| --------------- | ------------- | ------------------------------------- | ------------------------------------------------------------------ |
| `conversations` | `id`          | `by_updated = updatedAt`              | 会话列表投影 + 每会话水位 `maxSeq` / `clearedBeforeSeq`            |
| `messages`      | `id`          | `by_conv_seq = [conversationId, seq]` | **已确认**消息（必有 seq）                                         |
| `outbox`        | `clientMsgId` | `by_created = createdAt`              | 待发/发送中/失败/过期消息（**无 seq**）                            |
| `media`         | `objectKey`   | `by_access = lastAccessAt`            | `{ buf: ArrayBuffer, mimeType, bytes, lastAccessAt }`              |
| `meta`          | `key`         | —                                     | `schemaVersion`、媒体配额账本 `mediaBytesTotal`、`lastReconcileAt` |

**`messages` 与 `outbox` 必须分 store**：outbox 条目没有 seq，塞进同一个 store 会让
`[conversationId, seq]` 复合索引出现空洞键，翻页游标语义直接破掉。

媒体配额账本 `mediaBytesTotal` 放 `meta` 而不是每次 `SUM`：IDB 无聚合能力，
逐行累加 5000 条 blob 记录只为算个总量，在移动端是明显的卡顿源。
写入/删除时增量维护，冷启动时校准一次。

### 3.3 同步与对账（方案 C）

**冷启动**

1. 开库 → 读 `conversations` → **立即渲染**（断网也有内容）
2. 读 `outbox` → 恢复到内存 `messageStore` 的 `sending`/`failed` 态（**单向恢复**）
3. 并行：连 WS + `GET /conversations`
4. 服务端返回 → 整页替换内存态 + 双写本地

第 3 步失败（断网）时，用户看到的仍是第 1 步的本地数据 + 顶部离线横幅。

**进入会话**

1. 读本地 `by_conv_seq` 最近 **50 条**（与服务端一页等量，避免首屏渲染量两端不一致）
   → 立即渲染
2. 联网则 `GET /messages?conversation_id=&after_seq=<本地 maxSeq>&limit=50` 补空洞
3. 本地为空时退回现有 `before_seq=0` 路径（首次进会话即此路径）
4. 双写本地并推进 `maxSeq`

**`conversations` 投影的字段与写入时机**：行结构直接镜像现有 `ConversationDTO`
（不另造一套形状，否则每次 DTO 加字段都要改两处），额外附 `maxSeq` /
`clearedBeforeSeq` 两个水位。写入时机为：`GET /conversations` 返回后整表替换、
`conversation.created` / `conversation.updated` / `conversation.role_changed`
帧到达后按 id 增量更新。

**重连对账是惰性的**：不对 N 个会话各发一个 `after_seq` 请求。会话列表的
lastMessage/unread 由现有 `GET /conversations` 一次拉回；**各会话的消息空洞等用户
打开该会话时才补**。重连即全量对账会在 50 个会话的账号上瞬间打出 50 个请求。

**WS 帧到达**：内存 + 本地双写（`message.receive` / `message.recalled` /
`message.edited` / `message.reaction` 全部落本地）。

**空洞探测（正确性关键）**：WS 帧到达时**不允许无条件推进 `maxSeq`**。判定：

```
收到 frame.seq
  frame.seq == maxSeq + 1  → 连续，写入并推进 maxSeq
  frame.seq >  maxSeq + 1  → 中间有空洞（帧丢失/应用起来前的窗口）：
                             写入该条，但 maxSeq 保持不动，
                             并立即触发一次 after_seq 补齐
  frame.seq <= maxSeq      → 重复帧，按 key 覆盖写，不动 maxSeq
```

无条件推进会**永久丢掉空洞**：`maxSeq` 一旦跳到 15，`after_seq=15` 就再也补不回
11–14，那几条消息在本地永远缺失，而用户看不出来（列表连续、只是少了几条）。
这是本设计最容易写错的一处。

**`maxSeq` 的语义是「已连续确认到的水位」**，不是「见过的最大 seq」。两者混淆即上述缺陷。

### 3.4 新端点：`after_seq` 向后翻页

`GET /messages` 增加两个查询参数，**与 `before_seq` 互斥**（同时给按 400 拒绝，
不静默取其一）：

| 参数        | 语义                                |
| ----------- | ----------------------------------- |
| `after_seq` | 拉取 `seq > after_seq` 的消息，升序 |
| `limit`     | 默认 50，上限 100                   |

响应加 `has_more`（`len(items) == limit`）。**可见性口径与 `GetHistory` 完全一致**
（成员校验 + `status=1` + `seq > cleared_before_seq`）——复用同一个查询构造，
不允许第二处独立判断，否则两条路径会漂移成越权。

**客户端循环上限**：循环拉取直到 `has_more == false` **或**已补满保留窗口（500 条）
**或**循环达 20 次。三道闸门缺一不可——只靠 `has_more` 时，一个长期离线的账号会在
进会话瞬间拉几千条并把本地库撑爆。

### 3.5 Outbox 与幂等发送

**状态机**：`pending → sending → (成功即出队 | failed | expired)`

| 时机                    | 动作                                                          |
| ----------------------- | ------------------------------------------------------------- |
| 用户点发送              | 先写 outbox（`pending`）→ 内存渲染 `sending` → 尝试 WS 发送   |
| 收到 ack（`applyAck`）  | **在同一个 IDB 事务里**从 outbox 删除 + 写入 `messages` store |
| 发送失败 / 离线         | outbox 置 `failed`，保留                                      |
| `online` 事件 / WS 打开 | 扫 outbox，按 `createdAt` **串行**补发（并行会打乱消息顺序）  |
| 超过 **24h** 未发出     | 置 `expired`，UI 给「重发 / 删除」两个出口，**不静默吞掉**    |

**内存 store 仍是渲染的唯一真源**，outbox 只是它的持久化镜像，冷启动时单向恢复。
两者同时参与渲染会出现同一条消息渲染两遍。

ack 出队与写入 `messages` 必须在**一个 IDB 事务**内（IDB 支持多 store 事务）。
分两个事务时，崩在中间会让这条消息既不在 outbox 也不在 `messages` —— 用户看到的是
「发出去了，重启后消失了」。

**幂等发送（后端，迁移 020）** —— 这是方案 C 的隐藏前置，缺了整个补发逻辑就是个
重复消息生成器：

```sql
-- 部分唯一索引：system 消息等无 client_msg_id 的行不受约束
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_sender_client_msg
  ON messages(sender_id, client_msg_id)
  WHERE client_msg_id IS NOT NULL;
```

发送路径改为 `ON CONFLICT DO NOTHING`，冲突时回查既有行、返回**原 ack**
（原 `message_id` / `seq` / `created_at`），客户端据此正常出队。

> **迁移注意**：建唯一索引前须先探测存量重复行。dev 库大概率无重复，但迁移脚本
> 必须能在有重复时给出明确失败信息，而不是半途中断留下不一致状态。

失败场景覆盖的正是「服务端已落库、ack 在回程丢了」——客户端上线重发，服务端认出
是同一条，返回原 ack，不产生第二条消息。

### 3.6 三条不可让步的不变量

1. **撤回 = 访问撤销必须回放到本地。** `message.recalled` 不只是把本地那行改成占位，
   **必须同时删掉关联的 media blob**。否则断网还能看到已撤回的图片 —— 等于开了个
   绕过撤回的后门。
2. **清空记录同理。** `clearedBeforeSeq` 水位推进后，本地 `seq <= 水位` 的消息与其
   blob 一并删除。
3. **E2EE 占位行参与保留窗口淘汰。** 不因为「没正文很便宜」就豁免 500 条上限。

**「消息行在，blob 才在」是支撑上述不变量的底层约束。** `media` store 按 `objectKey`
寻址、与消息生命周期本来是解耦的，而 `message.recalled` 帧只带 `message_id`、
**不带 objectKey** —— 若那条消息已被保留窗口淘汰掉，撤回时就无从得知该删哪个 blob，
blob 会变成永久孤儿（既占配额，又能被后续渲染命中，撤回等于没生效）。

因此：**删消息行的所有路径（撤回 / 清空 / 保留窗口淘汰）必须走同一个函数**，
在删行的同一事务里删掉它引用的 blob。这样「行已不在 → blob 必然也已不在」，
撤回落到不存在的行上时 no-op 才是正确的。

### 3.7 保留窗口与淘汰时机

每会话保留最近 500 条（按 seq 降序）。

**淘汰只在「会话关闭」与「冷启动」两个时机执行**，不在写入时立即执行。
写入即淘汰会在用户正往上翻历史时把刚渲染出来的旧消息删掉，表现为列表在手里跳。

用户在线往上翻到第 600 条时，这些旧消息照常写入本地；下次淘汰时按「最近 500」
被清掉。这符合 L1-5 的语义，不是缺陷。

### 3.8 媒体缓存

**写入时机**：用户**实际看过/播过**才缓存（图片 Lightbox 打开、语音播放、
视频封面渲染），**不预下载**。

**读取**：优先本地 → `URL.createObjectURL(new Blob([buf], { type: mimeType }))`；
未命中走网络并回填。

这条顺带干掉 §2.7 登记的「同一对象 key 的 `download-url` 单页连发 8 次」——
本地命中就不发请求了。

**配额失败处理**（必须有，否则缓存失败会升级成功能失败）：

```
put 失败且 err.name === "QuotaExceededError"
  → 触发 LRU 淘汰到 80% 水位
  → 重试一次
  → 仍失败：本次不缓存，功能照常走网络，记一条 warn（不上报 Sentry）
```

浏览器给单 origin 的配额可能远小于 200MB。用 `navigator.storage.estimate()` 探测时
必须 `typeof` 守卫（旧 WebView 无此 API），探不到就按 200MB 硬上限走。

### 3.9 降级与失败姿态

| 失败                          | 行为                                                   |
| ----------------------------- | ------------------------------------------------------ |
| 开库失败（隐私模式等）        | 整个 L1 静默降级为「无本地库」，应用行为与今天完全一致 |
| 单次读失败                    | 当作未命中，走网络                                     |
| 单次写失败                    | 吞掉并记 warn，不影响在线功能                          |
| schema 版本不认识（降级安装） | 删库重建（本地库是投影，重建无数据损失）               |

**多标签页并发**：两个标签各自持有 WS 连接并双写同一个库。IDB 的 `put` 按 key 幂等，
覆盖写无害；outbox 并发补发的重复由 §3.5 的服务端幂等索引兜住。**已知取舍，不加锁**。

## 四、离线态、下拉刷新与桌面刷新

### 4.1 网络状态

新增 `packages/shared/src/hooks/useNetworkStatus.ts`，产出三态而非布尔：

| 态           | 判定                | 横幅                     |
| ------------ | ------------------- | ------------------------ |
| `offline`    | `!navigator.onLine` | 「当前无网络」（常驻）   |
| `connecting` | 在线但 WS 未 `open` | 「连接中…」（常驻）      |
| `online`     | 在线且 WS `open`    | 「已连接」短暂显示后消失 |

合并成布尔会在 WS 短暂重连时误报「断网」，用户看到的是一条无端闪烁的红条。

### 4.2 全局顶部横幅

`packages/ui/src/layout/NetworkBanner.tsx`，挂在 `MainLayout` 顶部。

**必须叠加 `--safe-area-top`**（A8 已有教训：安卓状态栏由原生下发该变量，
贴顶浮层不叠会压在系统时间/信号图标上）。

恢复在线时：显示「已连接」→ 2s 后自动消失 → 同时触发重连与对账刷新。

### 4.3 下拉刷新

`packages/ui/src/util/usePullToRefresh.ts` + `packages/ui/src/primitives/PullToRefresh.tsx`
（容器组件，各屏接入只加一层包裹）。

**要点**：

- **按 `pointer: coarse` 内部门控**（裁决 N-1），非触屏直接返回空 handler
- 容器必须 `overscroll-behavior-y: contain`，否则被 Chrome 自带下拉刷新接管，
  表现为「安卓上我们的刷新永远触发不了」
- 仅当 `scrollTop === 0` 且手指向下拖才进入手势；阈值 64px，带阻尼
- 刷新中禁止重复触发；失败也要收起指示器并 toast

**接入 7 屏**：会话列表 / 联系人 / 新朋友 / 朋友圈信息流 / 贴纸商城 / 我发布的 / 互动消息。

（消息列表 `ChatWindow` **不接**——它是向上加载更多，语义与下拉刷新相反。）

### 4.4 桌面端刷新（裁决 N-2）

- **回前台自动对账**：`visibilitychange` → `visible` 且距 `meta.lastReconcileAt` > 30s
  时静默对账一次。搭 `chatSocket.ts:357` 现有监听，不新起监听器。
- **仅三处加局部刷新图标**（区块标题旁）：贴纸商城 / 朋友圈信息流 / 我发布的 ——
  这三处无任何 WS 推送。WS 驱动的列表一律不加。

## 五、运维概览页重构

### 5.1 后端：`GET /admin/stats/timeseries?days=30`

按日聚合，返回三条序列：每日消息量、每日新增用户、每日好友申请。

- `days` 取值范围 7–90，越界按 400 拒绝（不静默夹取）
- 查询带 `WHERE created_at >= now() - interval 'N days'`，走既有
  `idx_messages_created`（已核实存在）
- 空日补零，返回连续日期序列（前端不做补洞）
- 与 `/admin/stats` 一样只读、不写审计日志

### 5.2 手写 SVG 图表（裁决 O-1）

`apps/admin/src/components/charts/`：

| 组件         | 用途                 |
| ------------ | -------------------- |
| `Sparkline`  | 指标卡内嵌趋势小折线 |
| `LineChart`  | 主趋势图（多序列）   |
| `DonutChart` | 消息类型占比         |

取色全部走既有主题 token（`--color-primary` 等），暗色自动跟随；不做 tooltip 跟随与缩放。
必须有 `role="img"` + `aria-label` 描述数据要点（无障碍，不能只给一张哑图）。

### 5.3 布局

从「23 个等权方块竖着堆」改为四层：

1. **顶部 4 张关键指标大卡**：总用户 / 今日消息 / 在线连接 / 待处理治理项，
   各带 sparkline 与环比
2. **中部两列图表**：消息量趋势折线（左）+ 消息类型占比环形（右）
3. **治理项独立一栏**：有积压才高亮（沿用现有 `GovernanceCard` 的 urgent 语义）
4. **次要区**：存储统计与推送订阅表格降级

同时：admin 内 4 处 `rounded-xl` 改 `rounded-lg`（本仓圆角上限）、新增文案补齐四语、
骨架屏固定宽高保证 CLS 为零。

## 六、顺带的小任务

| 项                                                                                 | 说明                                                                                                         |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `Button` 补 danger hover + 全变体 `focus-visible` 焦点环                           | 根因：`Button.tsx:41` danger 变体**零 hover**，且全变体 `focus:outline-none` 无替代。一处改全仓受益（J1 债） |
| `ConfirmDialog` 补 `role="dialog"` / `aria-modal` / Esc 关闭 / 焦点陷阱 / 初始焦点 | J1 债                                                                                                        |
| admin 4 处 `rounded-xl` → `rounded-lg`                                             | 圆角规范违规                                                                                                 |
| `packages/design-system` 补 `tsconfig.json` + `typecheck` 脚本                     | `turbo typecheck` 一直漏它（§2.7 登记债）                                                                    |
| 两端 app `tsconfig` `target` ES2021 → ES2019                                       | 与 `vite build.target=es2019` 对齐（§2.7 登记债）。**可能引出连锁类型错误，plan 里单独留时间**               |
| WS 卸载中止不再上报 Sentry                                                         | 区分「页面卸载中止」与「真实故障」（§2.7 登记债）                                                            |
| `download-url` 去重                                                                | 被 §3.8 媒体缓存天然吸收                                                                                     |

## 七、明确不做（本批）

- **本地全文搜索**：IDB 无全文索引，自建中文分词倒排是独立工程；且 K18「搜索体验重做」
  尚未立项，现在做会与之冲突返工
- **视频本体缓存**（裁决 L1-4）
- **本地库加密**：Web 端密钥只能存同源可读的地方，防护约等于零；真要有用得靠系统
  keychain，Web 端无解、Tauri 端要另写 Rust
- **多设备本地库一致性**：依赖 A8 未收口的 device/session 表
- **预下载媒体**：只缓存用户实际看过的

## 八、测试与验收

### 单元 / 集成

- `localdb` 各模块：开库/升级/降级重建、保留窗口淘汰边界（499/500/501）、
  LRU 淘汰到 80% 水位、`QuotaExceededError` 三段降级
- **空洞探测**：`maxSeq=10` 时依次投入 `seq=11`（推进到 11）、`seq=15`（**maxSeq 仍为 11**
  且触发补齐）、`seq=9`（覆盖写、maxSeq 不动）—— 这三条断言直接钉住 §3.3 那个
  「永久丢空洞」的缺陷
- **「行在 blob 才在」**：撤回一条已被淘汰的消息 → 断言其 blob 也已不存在（无孤儿）；
  淘汰一条图片消息 → 断言 `mediaBytesTotal` 同步下降
- outbox 状态机：ack 出队、失败保留、24h 过期、串行补发顺序；**ack 事务原子性**
  （事务中途抛错后断言消息仍在 outbox、不会两头皆空）
- 后端：`after_seq` 与 `before_seq` 互斥（400）、`limit` 上限夹取、可见性口径与
  `GetHistory` 一致（同一批夹具跑两条路径断言结果集相同）
- **幂等发送并发测试**：N 个 goroutine 同时用同一 `client_msg_id` 发送，
  断言落库恰好 1 行、N 个响应的 `message_id` 全部相同
- `useNetworkStatus` 三态转换；`usePullToRefresh` 阈值与非触屏短路

### 真机实测（合并前必须完成）

| 端    | 必测                                                                                                              |
| ----- | ----------------------------------------------------------------------------------------------------------------- |
| Web   | 断网后刷新页面仍能看到会话列表与历史；离线横幅；恢复后自动对账；移动视口下拉刷新；outbox 离线发送→上线补发不重复  |
| 桌面  | **WebKitGTK 下 IDB 持久化跨进程重启有效**（这是 L1-1 的核心风险点）；回前台自动对账；三处刷新图标                 |
| 安卓  | **真机 IDB 存 `ArrayBuffer` 媒体成功**（L1-9 的验证点）；下拉刷新不被 Chrome 自带下拉接管；离线横幅不压系统状态栏 |
| admin | 概览页三种图表暗亮双主题；`days` 越界 400；骨架屏 CLS 为零                                                        |

### 本地 CI 门禁（推 dev 前全绿）

`node scripts/check-i18n.mjs` · `LANG=C.UTF-8 pnpm test` · `pnpm turbo typecheck` ·
`pnpm --filter @yuanchat/web test:e2e` · `go vet ./...` · `go test ./...` ·
`go test -race ./internal/ws/`

## 九、已知风险

| 风险                                             | 应对                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| WebKitGTK 的 IDB 持久化行为未验证                | 列为桌面端必测项；若不持久，桌面端降级为「会话内缓存」并当次登记进未做清单 |
| 安卓旧 WebView 对大 `ArrayBuffer` 写入的表现未知 | 列为安卓必测项；失败则下调单对象缓存上限                                   |
| `target` ES2021 → ES2019 可能引出连锁类型错误    | plan 中单列一个 task，不与其他项混在一个 commit                            |
| `Button` 改动影响全仓所有按钮视觉                | 三端走查；`focus-visible` 用 ring（box-shadow，不占位）不会破坏布局        |
| 存量重复 `client_msg_id` 导致迁移 020 失败       | 迁移前先跑探测查询，有重复则给出明确失败信息而非半途中断                   |
