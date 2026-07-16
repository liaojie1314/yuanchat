# Token 刷新 + 联系人/好友体系 — 设计文档

> 日期：2026-07-16
> 分支：`feature/token-refresh`（第一阶段）→ `feature/contacts`（第二阶段）
> 前置：聊天核心闭环已完成（会话列表 / 文本消息 WS 收发 / 已读回执 / typing / 历史分页）

## 背景与目标

当前 access token 15 分钟过期后所有 REST 请求 401、WS 无法重连，用户被迫重新登录——这是文档记录的最高优先短板。同时通讯录 (`/contacts`) 路由只渲染 ChatPage 占位，无任何联系人功能，用户只能使用 seed 预建的会话。

本轮两个目标：

1. **Token 静默刷新**：用户登录后 7 天内（持续活跃则无限期）不再需要重新登录。
2. **联系人/好友核心闭环**：搜索用户 → 发好友申请 → 对方同意/拒绝 → 好友列表 → 点联系人发起单聊。

## 已确认的决策

| 决策点       | 结论                                                                                 |
| ------------ | ------------------------------------------------------------------------------------ |
| 本轮范围     | Token 刷新 + 联系人/好友核心闭环（备注/删好友/扫码/企业通讯录留后续）                |
| Refresh 策略 | 滑动会话（轮换）：每次刷新同时签发新 access + 新 refresh，各自重置 TTL；无服务端存储 |
| 刷新时机     | 主动（到期前 60s）+ 被动（401 兜底，单飞行刷新 + 重试原请求）双保险                  |
| 申请实时性   | WS 推送 `contact.request` / `contact.accepted`，离线靠登录拉取                       |
| 存储模型     | 新建 `friend_requests` 表；`contacts` 表只存已通过的双向关系                         |
| 搜索匹配     | 精确匹配：手机号全匹配 或 元聊号（short_id）全匹配，命中返回单个用户                 |
| 会话创建     | 同意申请即原子地：双向好友 + get-or-create 单聊会话 + 以同意方身份发打招呼消息       |

---

## 第一节：Token 刷新

### 后端

**新端点 `POST /api/v1/auth/refresh`**（无 AuthRequired 中间件，自行校验 refresh token）：

- 请求体 `{"refresh_token": "..."}`
- 校验：`jwt.Generator.Validate()` 成功且 `TokenUse == "refresh"`，否则 401
- 成功：`GeneratePair(claims.UserID, claims.DeviceID)` 签发全新 TokenPair（轮换：refresh TTL 也重置），响应与登录一致 `{access_token, refresh_token, expires_in}`
- 位置：`UserService.Refresh(ctx, refreshToken)` + `UserHandler.Refresh` + router 注册 `api.POST("/auth/refresh", limitByIP, userH.Refresh)`
- 不引入 Redis 黑名单（旧 refresh 在剩余 TTL 内仍有效）；Claims 已含 `jti`，后续可平滑加失效

### 前端（packages/shared）

**新模块 `src/api/tokenManager.ts`** —— 唯一的刷新协调器（不依赖 React）：

- `setRefreshHandler(fn)`：由 authStore 注册实际刷新动作（调 `/auth/refresh` + 更新 store），避免循环导入（沿用 tokenProvider 模式）
- `ensureFreshToken(): Promise<string | null>`：若 access 距过期 < 60s（本地记录 `expiresAt = Date.now() + expires_in*1000`，持久化在 authStore），触发刷新；**单飞行**：并发调用共享同一个 in-flight Promise
- `forceRefresh()`：401 兜底时调用；刷新失败（refresh 也过期/无效）→ 调 authStore.logout() 清态，UI 路由守卫自动回登录页

**改造点**：

- `api/client.ts`：`request()` 发请求前 `await ensureFreshToken()`；收到 HTTP 401（或信封 code 401）时 `forceRefresh()` 成功后重试原请求一次，仍失败才抛错
- `ws/chatSocket.ts`：`connect()` 与重连前 `await ensureFreshToken()` 再取 token 拼 URL（token 过期导致的 WS 握手失败不再进入死循环退避）
- `authStore.ts`：新增 `expiresAt` 字段（persist）；login/register/refresh 统一写入；新增 `applyTokens(pair)` action 供 tokenManager 回写

### 测试

- Go：`user_service_test.go` 加 Refresh 用例（合法 refresh / 过期 / access 冒充 refresh / 篡改签名）
- TS：`tokenManager.test.ts`（fake timers：到期前主动刷新、单飞行去重、401 重试一次、refresh 失败登出）；`client` 401 重试路径用例

---

## 第二节：联系人/好友（后端）

### 数据模型

**新表 `friend_requests`**（`server/internal/model/friend_request.go` + `deploy/init-scripts/002_contacts.sql`，服务启动时对新表跑定向 AutoMigrate 以覆盖已有开发库）：

```sql
CREATE TABLE IF NOT EXISTS friend_requests (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message      VARCHAR(200),
    status       SMALLINT NOT NULL DEFAULT 0,  -- 0 pending / 1 accepted / 2 rejected
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(requester_id, target_id)
);
```

重复申请（已 pending / 被拒后再申请）= UPSERT 同一行：重置 status=pending、更新 message 与时间。`contacts` 表（已存在）只写 `status=accepted` 的双向两行。

### REST API（均挂 AuthRequired）

| 端点                                        | 行为                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/users/search?q=`               | q 依次尝试：全为数字且长度=11 → 按 phone 精确查；否则全为数字 → 按 short_id 查；含 `@` → 按 email 查。命中返回 `{user: {id, nickname, avatar_url, short_id}, relation: "none"\|"friend"\|"pending_out"\|"pending_in"\|"self"}`；未命中 404                                                                                                   |
| `POST /api/v1/contacts/requests`            | body `{target_id, message?}`。校验：非自己、目标存在、非已好友。UPSERT friend_requests → WS 推 `contact.request` 给目标                                                                                                                                                                                                                      |
| `GET /api/v1/contacts/requests`             | 双向列表：收到的 + 发出的，各带用户资料/验证消息/状态/时间，按时间倒序                                                                                                                                                                                                                                                                       |
| `POST /api/v1/contacts/requests/:id/accept` | 仅 target 本人可调。事务内：status→accepted + 双向 contacts 两行 + get-or-create 单聊会话（复用 seed 的成员集合匹配逻辑）+ 以同意方身份走 `MessageService.SendText` 发打招呼消息（"我通过了你的好友申请，现在我们可以开始聊天了"）。消息链路天然触发 `message.receive` 推送 → 申请方会话列表自动出现新会话；另推 `contact.accepted` 给申请方 |
| `POST /api/v1/contacts/requests/:id/reject` | 仅 target 本人；status→rejected，不推送（申请方无感知，符合主流 IM 习惯）                                                                                                                                                                                                                                                                    |
| `GET /api/v1/contacts`                      | 好友列表：join users 取 id/nickname/avatar_url/short_id，并解析每个好友对应的单聊 `conversation_id`（accept 时必建，故不为空）；排序分组交给前端                                                                                                                                                                                             |

新文件：`repository/contact_repo.go`、`service/contact_service.go`、`handler/contact.go`。ContactService 依赖 ConversationRepo/MessageService（打招呼复用现有发消息事务）与 `ws.Dispatcher`（推送）。

### WS 协议扩展（`ws/protocol.go`）

服务端 → 客户端新增两帧（客户端无新帧）：

| type               | payload                                                                              |
| ------------------ | ------------------------------------------------------------------------------------ |
| `contact.request`  | `{request_id, requester: {id, nickname, avatar_url, short_id}, message, created_at}` |
| `contact.accepted` | `{request_id, friend: {id, nickname, avatar_url, short_id}, conversation_id}`        |

推送经由现有 `Dispatcher.SendToUsers`，由 ContactService 在事务提交后调用。

---

## 第三节：联系人/好友（前端）

### 数据层（packages/shared）

- `api/contacts.ts`：`searchUser(q)` / `sendFriendRequest` / `listFriendRequests` / `acceptRequest` / `rejectRequest` / `fetchContacts` + DTO 映射
- `store/contactStore.ts`（Zustand）：`friends[]`（字母分组在 selector 中派生：引入 `pinyin-pro` 取昵称首字母归一化为 A-Z，非字母/无法解析归 `#` 组）、`requests[]`、`pendingInCount`（角标）、actions：`loadContacts` / `loadRequests` / `accept`（同时把返回的 conversation_id 写入 conversationStore 并可跳转）/ `reject` / `sendRequest` / `applyIncomingRequest`（WS）/ `applyAccepted`（WS）
- `useChatBootstrap.wireSocket()` 注册 `contact.request`（插入 requests + 角标）与 `contact.accepted`（好友列表加人 + 重拉会话列表）
- Mock：`mocks/handlers.ts` 补上述 REST handler，`demoData.ts` 加 demo 好友/申请，保证 `dev:web:mock` 可演示

### UI（packages/ui，遵循 docs/design/03_CONTACTS_PAGE.md）

新增 `ContactsScreen.tsx` 编排（对应 `/contacts` 路由，替换现占位；App.tsx 两端改指向 ContactsPage）：

- **ContactsPanel**：顶部标题 + [+] 添加按钮、搜索框（过滤本地好友）、功能入口「新的朋友」（含 pending 角标）、字母分组列表 + 右侧字母索引条（≥5 人启用快跳）
- **ContactDetail**：内容区显示选中联系人资料（头像/昵称/元聊号/手机号）+「发消息」按钮 → 用好友列表自带的 `conversation_id` 直接 `navigate("/chat/:id")`（不变式：好友必有单聊会话——accept 时创建，seed 好友同样补建）
- **NewFriendsView**：申请列表（收到的带 同意/拒绝 按钮，发出的显示状态）
- **AddContactModal**：输入手机号/元聊号 → 搜索结果卡片（按 relation 显示 加好友/已是好友/等待验证/发消息）→ 验证消息输入 → 发送
- 响应式：desktop 双栏（面板+内容区）/ mobile 栈式 push（与 ChatScreen 同套 useBreakpoint 模式）；文案全部走 i18n（zh-CN/en-US 同步补 key，`contacts.*` 命名空间已有基础）

### Seed 扩展

`cmd/seed`：Alice↔Bob、Bob↔Carol 互为好友（写 contacts 双向行；Bob↔Carol 补建单聊会话以维持"好友必有会话"不变式，Alice↔Bob 已有）；Carol→Alice 一条 pending 申请（演示新的朋友角标）。幂等。

---

## 错误处理

- 刷新竞态：单飞行 Promise；多标签页并发刷新——轮换策略下旧 refresh 仍有效（无服务端失效），后到者刷新同样成功，无锁需求
- refresh 过期/无效 → 前端 logout 清态回登录页（路由守卫已有）
- 申请幂等：UNIQUE(requester_id, target_id) + UPSERT；accept 幂等：已 accepted 再调返回成功同一 conversation_id
- accept 事务失败回滚（好友/会话/消息同生共死）；WS 推送在事务提交后，推送失败仅记日志（离线拉取兜底）

## 测试与验收

- Go：contact_service 单测（申请/同意建会话+打招呼/拒绝/重复申请/非法操作者）+ 现有测试全绿（`go vet && go test ./...`）
- TS：tokenManager、contactStore、contacts API 映射单测 + 现有测试全绿 + `tsc --noEmit`
- E2E（Playwright 双上下文）：Carol 搜索 Bob 手机号 → 发申请 → Bob 实时收到角标 → 同意 → 双方好友列表出现对方、Carol 会话列表实时出现新单聊（含打招呼消息）→ Carol 从联系人详情进入聊天发消息；15 分钟 token 过期场景用缩短 TTL 的 config 验证静默刷新（REST 与 WS 均不中断）
- 完成后按惯例：更新 `docs/02_CHAT_API.md`（新 REST + WS 帧）、`docs/DEVELOPMENT.md`（如有命令变化）、README 功能清单、AGENTS.md 当前状态；测试后关闭全部进程/容器

## 分支与提交

1. `feature/token-refresh`：后端 refresh 端点 + 前端 tokenManager/client/WS 改造 + 测试 → 一次完整 commit → merge dev
2. `feature/contacts`：从 dev 切出，后端（模型/仓储/服务/REST/WS 帧/seed）与前端（api/store/UI/mock/i18n）+ 测试 + 文档 → 按「后端闭环」「前端闭环」两次 commit → merge dev

## 不做（后续迭代）

联系人备注、删除好友、黑名单、扫码/二维码添加、企业通讯录、附近的人、Redis refresh 黑名单、好友分组标签、在线状态（presence）。
