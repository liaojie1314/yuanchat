# 元聊 YuanChat — 聊天 API 与 WebSocket 协议

> 对应实现：`server/internal/ws/`（协议与网关）、`server/internal/handler/conversation.go` / `message.go` / `contact.go`（REST）。
> 前端消费方：`packages/shared/src/api/chat.ts` / `contacts.ts`（REST 映射）、`packages/shared/src/ws/chatSocket.ts`（WS 客户端）。

## 一、认证方式

- **REST**：`Authorization: Bearer <access_token>`（15 分钟有效期）。
- **WebSocket**：浏览器 WS API 无法携带 Header，改用 query 参数：
  `ws://<host>:8081/ws?token=<access_token>`。token 无效返回 HTTP 401，不升级连接。

### POST /api/v1/auth/register / POST /api/v1/auth/login

注册与登录（账号 = 手机号 / 邮箱 + 密码），统一收敛在 `/auth` 前缀下
（与 `/auth/refresh`、`/auth/password`、`/auth/qr` 对齐；旧的
`/users/register`、`/users/login` 已移除，不做兼容）。

```json
// POST /auth/register 请求
{ "account": "13800138000", "password": "pass1234", "captcha_id": "...", "captcha_code": "abcd" }
```

响应与 `POST /auth/refresh` 一致（登录响应额外含 `user` 字段）。

### POST /api/v1/auth/refresh（无需 Authorization）

滑动会话（轮换）：用有效的 refresh token 换**全新的 token 对**，
access/refresh 各自重置 TTL（15min / 7 天），持续活跃的用户永不掉线。
旧 refresh 在剩余有效期内仍可用（无服务端存储；Claims 含 `jti`，后续可加黑名单失效）。

```json
// 请求
{ "refresh_token": "eyJ..." }

// 响应（与登录一致，无 user 字段）
{
  "code": 0,
  "message": "ok",
  "data": { "access_token": "eyJ...", "refresh_token": "eyJ...", "expires_in": 900 }
}
```

- refresh 无效/过期/用 access 冒充 → HTTP 401，前端清登录态回登录页。
- 前端策略（`packages/shared/src/api/tokenManager.ts`）：
  - **主动**：REST 请求发出前与 WS 拨号前，access 距过期 < 60s 即先刷新（单飞行去重并发）；
  - **被动**：REST 收到 401 时兜底刷新并重试原请求一次。

## 二、REST 端点

### GET /api/v1/conversations

返回当前用户参与的所有会话，按 `updated_at` 降序。

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "conversations": [
      {
        "id": "uuid",
        "type": 2,
        "name": "产品研发群",
        "avatar_url": null,
        "member_count": 3,
        "unread_count": 2,
        "is_muted": false,
        "is_pinned": false,
        "pinned_at": null,
        "mention_unread": false,
        "last_seq": 10,
        "my_last_read_seq": 8,
        "announcement": "本周五发布评审",
        "announcement_updated_at": "2026-08-04T10:00:00+08:00",
        "last_message": {
          "preview": "发布评审改到明早 9 点",
          "preview_kind": "text",
          "sender_nickname": "陈曦",
          "created_at": "2026-07-16T09:00:00+08:00"
        },
        "peer": { "id": "uuid", "nickname": "Bob", "avatar_url": null },
        "updated_at": "2026-07-16T09:00:00+08:00"
      }
    ]
  }
}
```

- `type`：1=单聊 2=群聊 3=系统。
- `unread_count` = `last_seq - my_last_read_seq`（服务端计算）。
- `peer` 仅单聊返回；单聊 `name`/`avatar_url` 为空时前端用 `peer` 填充。
- `mention_unread`（v0.2）：群消息 @ 我未读标记；进入会话调用 `message.read` 时后端顺带清零（配合 `last_read_seq` 推进）。前端据此在会话列表条目显示 `[@我]` 高亮前缀。
- `is_pinned` / `pinned_at`（v0.4 A6）：本人置顶态；列表排序置顶优先、组内按 pinned_at 倒序（前端实现）。
- `announcement` / `announcement_updated_at`（v0.4 A7）：群公告正文与最近变更时间；仅群聊有意义，无公告时两字段均不出现（`omitempty`）。
- `last_message`（v0.4 A7）：受本人「清空聊天记录」水位影响——清空后水位内的旧消息不再作为预览返回（对方列表不受影响）。
- `last_message.preview_kind`（v0.4 H1）：消息类型标记，取值 `text` / `system` / `image` / `file` / `voice` / `video` / `sticker` / `encrypted` / `unknown`。
  **非文本类型的 `preview` 为空串，占位文案由前端按当前语言产出**（`previewBodyOf`）：服务端不再返回
  `[图片]`/`[表情]` 等中文硬编码，否则英/日/韩界面下「实时收到」与「刷新后」文案会不一致。
  `text` / `system` 两类的正文仍在 `preview` 里。
  客户端须容忍字段缺失（旧服务端）：无 `preview_kind` 时直接用 `preview` 原文。

### POST /api/v1/conversations

创建群聊。校验发起者与全部成员均为好友后建群：写 `conversations`（type=2）、
`conversation_members`（发起者 role=2 群主、其余 role=0），插入系统消息「X 创建了群聊」（seq=1），
并向全部成员（含发起者）推送 `conversation.created` 帧。

```json
// 请求（name 选填，为空时服务端用「发起者、成员1、成员2」拼接默认群名，rune 数超 100 截断）
{ "name": "产品研发群", "member_ids": ["uuid", "uuid"] }

// 响应（201 Created；发起者视角：unread=0、已读到系统消息）
{
  "code": 0,
  "message": "created",
  "data": {
    "id": "uuid",
    "type": 2,
    "name": "产品研发群",
    "avatar_url": null,
    "member_count": 3,
    "unread_count": 0,
    "is_muted": false,
    "last_seq": 1,
    "my_last_read_seq": 1,
    "last_message": {
      "preview": "Alice 创建了群聊",
      "sender_nickname": "Alice",
      "created_at": "2026-07-16T09:00:00+08:00"
    },
    "updated_at": "2026-07-16T09:00:00+08:00"
  }
}
```

- `member_ids`：1~100 个；去重并剔除发起者本人后须非空，否则 `400`。
- 存在非好友成员返回 `400`（`all members must be your friends`）。
- 响应 `data` 结构同 `GET /conversations` 列表条目；`type` 固定为 2（群聊）。
- 发起者由本响应把会话插入本地列表并激活，随后到达的 `conversation.created` 帧按会话 id 去重吞掉。

### 群管理五操作

权限模型（`role`：0 普通 / 1 管理员 / 2 群主）：改名 role ≥ 1；邀请任意成员（被邀请者须为邀请者好友）；踢人须操作者 role > 目标 role；退群仅非群主；解散仅群主。

| 方法   | 路径                                        | 请求体                       | 成功响应 data      |
| ------ | ------------------------------------------- | ---------------------------- | ------------------ |
| PATCH  | `/api/v1/conversations/:id`                 | `{"name": "新群名"}`（≤100） | `{name}`           |
| POST   | `/api/v1/conversations/:id/members`         | `{"member_ids": ["uuid"]}`   | `{member_count}`   |
| DELETE | `/api/v1/conversations/:id/members/:userId` | —                            | `{member_count}`   |
| POST   | `/api/v1/conversations/:id/leave`           | —                            | `{}`               |
| DELETE | `/api/v1/conversations/:id`                 | —                            | `{}`（解散，软删） |

### PUT /api/v1/conversations/:id/settings

更新本人在该会话的个人设置（member 维度，单聊/群聊通用）。body 至少携带一个字段：

```json
// 请求
{ "is_pinned": true, "is_muted": false }

// 响应（data 为变更后的完整设置值）
{ "code": 0, "message": "ok", "data": { "is_pinned": true, "pinned_at": "2026-07-31T12:00:00+08:00", "is_muted": false } }
```

- 置顶语义：首次置顶落 `pinned_at`；重复置顶不刷新（置顶顺序稳定）；取消置顶清空。
- 非成员 `403`；两字段均缺 `400`。
- 成功后向**本人全部设备**推 `conversation.updated`（含 `is_pinned/pinned_at/is_muted`），其他成员不感知。
- 免打扰生效面：在线设备前端不弹系统通知；服务端离线 Web Push 同样跳过。

### DELETE /api/v1/conversations/:id/messages

清空本人的聊天记录（v0.4 A7，member 维度，单聊/群聊通用）。无请求体，成功 `data` 为 `{}`。

- **软清空**：不删消息行，只把本人成员行的 `cleared_before_seq` 推进到会话当前 `last_seq`；
  拉历史（`GET /conversations/:id/messages`）与会话列表预览均过滤 `seq <= cleared_before_seq` 的消息。
- **对方无感**：其他成员的历史与预览完全不受影响；清空后新收发的消息本人正常可见。
- 同时把本人 `last_read_seq` 推进到同一水位：否则未读数仍会计入已被过滤、再也拉不回的旧消息
  （列表显示未读却点进去是空消息流）。清空后该会话 `unread_count` 归零、`last_message` 为空。
- 水位只前进：重复清空幂等，不会因并发回退。
- 非成员 `403`；会话不存在 `404`。
- 不发系统消息、不推 WS 帧（纯本地视图操作）。**多端注意**：本端清空后，该用户的其他在线设备
  不会收到任何通知，且前端 `loadHistory` 在本地缓存非空时直接 early-return，
  因此另一设备需**重连或重启**后才看到清空效果。

### PATCH /api/v1/conversations/:id/announcement

编辑群公告（v0.4 A7，`role ≥ 1` 管理员/群主）。

```json
// 请求（空串 = 清除公告）
{ "announcement": "本周五 10:00 发布评审" }

// 响应
{
  "code": 0,
  "message": "ok",
  "data": { "announcement": "本周五 10:00 发布评审", "announcement_updated_at": "2026-08-04T10:00:00+08:00" }
}
```

- 普通成员 `403`；非成员 `403`；非群聊 `400`；正文超 1000 字符 `400 announcement too long`。
- 空串（或纯空白）= 清除公告：库中 `announcement` 置 NULL，响应 `announcement` 为 `null`。
- 成功后在同一事务内落系统消息（`X 更新了群公告` / `X 清空了群公告`），全体在群成员收
  `message.receive`（`content.type="system"`）+ `conversation.updated`。
  该帧中 `announcement` **恒存在**：清除时为空串 `""`（不是省略），前端据此直接覆盖本地值即可。

### PUT /api/v1/conversations/:id/my-alias

设置本人在该群内的昵称（v0.4 A7，**任意成员**均可改自己的）。

```json
// 请求（空串 = 清除，署名回退用户本名）
{ "alias": "群里的我" }

// 响应（回显 trim 后的值，与库中一致）
{ "code": 0, "message": "ok", "data": { "alias": "群里的我" } }
```

- 上限 30 字符（按 rune 计），超限 `400 alias too long`；非成员 `403`。
- **仅群聊可设**：单聊调用返回 `400 not a group conversation`（历史署名的 COALESCE 投影
  不区分会话类型，单聊若能设 alias 会导致同一条消息历史显示 alias、实时显示本名）。
- 生效面：成员列表 `nickname`、历史消息 `sender_nickname`、实时 `message.receive` 的 `sender_nickname`
  统一按 `COALESCE(NULLIF(alias,''), nickname)` 取值。
- 空串清除时库中写 SQL NULL（与「从未设置」同一状态）。
- 不推 WS 帧：其他成员在下次拉成员列表/历史时看到新署名。

### 群角色管理（v0.2）

以下三操作**仅群主**可执行：

| 方法   | 路径                                       | 请求体                     | 成功响应 data                  |
| ------ | ------------------------------------------ | -------------------------- | ------------------------------ |
| POST   | `/api/v1/conversations/:id/admins`         | `{"user_id": "uuid"}`      | `{user_id, new_role: 1}`       |
| DELETE | `/api/v1/conversations/:id/admins/:userId` | —                          | `{user_id, new_role: 0}`       |
| POST   | `/api/v1/conversations/:id/owner-transfer` | `{"new_owner_id": "uuid"}` | `{old_owner_id, new_owner_id}` |

- 任命要求目标为普通成员（已是管理员 → `400 member is already an admin`；对群主 → `403`）。
- 免除要求目标为管理员（普通成员 → `400 member is not an admin`）。
- 转让在一个事务里：新群主 `role=2`、原群主降为 `role=1`（管理员，微信语义）；转给自己 → `400 cannot transfer ownership to yourself`。
- 成功后全员收系统消息（`Bob 被任命为管理员` / `Bob 被免除管理员` / `群主已由 A 转让至 B`）+ `conversation.role_changed` 帧（转让连发两帧：新群主 role=2、原群主 role=1）。

错误码：

- `400`：非群聊 / 群名空或超长 / 群主退群 / 邀请对象全部已在群 / 被邀请者非好友（`all members must be your friends`）
- `403`：非会话成员 / 角色权限不足（普通成员改名、踢平级或群主等）
- `404`：会话不存在（含已解散）/ 踢的目标不在群内

成功后的状态同步全部走 WS 帧（REST 响应仅回执，前端不做乐观更新）：

- 改名/邀请/踢人/退群：全体在群成员收 `message.receive`（`content.type="system"` 系统消息）+ `conversation.updated`
- 邀请：新成员额外收 `conversation.created`（新成员视角 DTO，`unread_count`=1）
- 被踢者收 `conversation.removed(reason="kicked")`；退群者本人多端收 `reason="left"`；解散时全员收 `reason="dissolved"`

### GET /api/v1/conversations/:id/messages

历史消息分页（seq 降序返回，前端反转为升序展示）。

| Query 参数   | 说明                                                    |
| ------------ | ------------------------------------------------------- |
| `before_seq` | 取 `seq < before_seq` 的消息；`0`（默认）表示从最新开始 |
| `limit`      | 页大小，默认 30，最大 100                               |

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "messages": [
      {
        "id": "uuid",
        "conversation_id": "uuid",
        "sender_id": "uuid",
        "seq": 42,
        "message_type": 1,
        "content": "{\"text\":\"你好\"}",
        "status": 1,
        "reply_to_id": null,
        "client_msg_id": "c-xxx",
        "created_at": "2026-07-16T09:00:00+08:00",
        "sender_nickname": "Alice",
        "sender_avatar_url": null
      }
    ],
    "has_more": true
  }
}
```

- 非会话成员访问返回 `403`。
- `content` 是 JSONB 字符串；`message_type`：1=文本 2=图片 3=文件 4=语音 5=视频 6=系统。

### POST /api/v1/messages/:id/recall

撤回消息：仅**发送者本人**、且在**发送后 2 分钟**（`RecallWindow`）内可撤回。
成功后消息 `status` 翻为已撤回、`content` 清空为 `{}`，并向会话全部成员推送 `message.recalled` 帧。

```json
// 请求：无 body，:id 为消息的服务端 UUID
// 响应
{ "code": 0, "message": "ok", "data": { "message": "recalled" } }
```

- 已撤回的消息重复调用视为**幂等成功**（返回 200，不重复推送 `message.recalled`）。
- `:id` 非合法 UUID 返回 `400`（`invalid message id`）。
- 消息不存在返回 `404`；非发送者本人返回 `403`（`only the sender can recall`）。
- 超出 2 分钟窗口返回 **`403`，body `code=4031`**（`recall window expired`）——前端据此行内提示「超过可撤回时间」。

### POST /api/v1/messages/:id/reactions

切换自己对消息的某个 emoji 回应（**toggle 语义**：有则删、无则加），推 `message.reaction` 帧给会话全员。

```json
// 请求
{ "emoji": "👍" }

// 响应（count 为该 emoji 操作后的总数，reacted 表示自己操作后的参与态）
{ "code": 0, "message": "ok", "data": { "emoji": "👍", "count": 2, "reacted": true } }
```

- `emoji`：trim 后非空且 ≤8 rune，否则 `400`（`invalid emoji`）。
- 消息不存在或**已撤回**返回 `404`；非会话成员返回 `403`。
- 表 `message_reactions`：`(message_id, user_id, emoji)` 联合唯一（一人一消息一 emoji 至多一条）。
- 历史消息（`GET /conversations/:id/messages`）每条附 `reactions: [{emoji, count, mine}]` 聚合
  （`mine` 相对请求者；无回应时字段省略）。前端不做乐观更新，统一由帧驱动。

### POST /api/v1/messages/:id/forward（v0.2）

一次转发一条消息到多个会话（最多 9 个）。操作者必须是**源会话**和**每个目标会话**的成员，否则拒绝。

```json
// 请求
{ "conversation_ids": ["uuid", "uuid"] }

// 响应（每个目标会话独立分配 seq；后端另行推 message.receive 帧给各会话全员）
{
  "code": 0,
  "message": "ok",
  "data": {
    "results": [
      { "conversation_id": "uuid", "message_id": "uuid", "seq": 42 },
      { "conversation_id": "uuid", "message_id": "uuid", "seq": 17 }
    ]
  }
}
```

- 源消息不存在或已撤回 → `404 message not found`；系统消息不可转发（同报 404）。
- 端到端加密消息不可转发 → `400 encrypted messages cannot be forwarded`（v0.4 H1）。密文是针对
  「本会话、本棘轮状态」加密的，复制到另一个会话后那边任何人（含转发者自己）都拿不到对应链密钥，
  只会渲染成一条永久「无法解密」；因此在服务层入口直接拒绝，不落任何行。
- `conversation_ids` 缺失/为空 → `400 no forward target`；超过 9 个 → `400 too many forward targets`。
- 操作者不在源会话 → `403 not a source conversation member`；不在某个目标会话 → `403 one or more target conversations are inaccessible`。
- 语义：新消息复制源 `message_type` + `content`（text/image/file/voice/sticker 都保留原字段），无 `client_msg_id`、无 `reply_to_id`、无 `mentions`。转发感由前端"从右键菜单进入"的交互隐式表达。
- 实时推送与落库解耦：服务端重建 WS `content` 载荷失败的类型（未来新增而忘补分支者）**跳过实时推送并告警**，
  不再退化成 `{"type":"text"}` 空气泡——落库仍是完整 content，对端刷新后可正常看到。
- 部分成功不做回滚：任一目标会话失败即立刻回错，已成功的目标已产生独立消息（转发本身是"广播"语义）。

### GET /api/v1/presence

返回**我的好友中当前在线的用户 ID**。登录/重连时拉一次做快照，之后靠 `presence` 帧增量维护。

```json
{ "code": 0, "message": "ok", "data": { "online_ids": ["uuid"] } }
```

- 在线 = 该用户在 Hub 中至少有 1 条 WebSocket 连接。多设备去重（首连触发 online、末连触发 offline）。
- 未来横向扩展换 Redis Pub/Sub 时接口不变，Hub 抽象已预留。

### GET /api/v1/users/:id

按用户 ID 查看**公开资料**（好友资料卡、群成员点击等入口）。仅返回对外可见字段，
不含手机号、账号状态等隐私信息。

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": "uuid",
    "nickname": "Bob",
    "avatar_url": null,
    "short_id": 10002,
    "bio": null,
    "gender": 0
  }
}
```

- `gender`：0=未设置 1=男 2=女；`bio`（个性签名）可为 `null`。
- 用户不存在返回 `404`。

### GET /api/v1/conversations/:id/members

返回指定会话的成员列表，**群主排在首位**（服务端按 `role` 降序、加入时间升序排序）。

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "members": [
      {
        "user_id": "uuid",
        "nickname": "Alice",
        "avatar_url": null,
        "role": 2,
        "alias": "群里的我"
      }
    ]
  }
}
```

- `role`：0=普通成员 1=管理员 2=群主。
- `nickname`（v0.4 A7）：**展示名**——群内设置了群昵称时为 alias 覆盖值，否则为用户本名。
- `alias`（v0.4 A7）：该成员的原始群昵称值，供「编辑我的群昵称」回填输入框。
  未设置或已清除时库中为 NULL，该字段**整个不出现**在 JSON 中（`omitempty`），而非 `null` 或 `""`。
- 非会话成员访问返回 `403`。

### PUT /api/v1/users/me

修改当前登录用户的资料（昵称 / 头像 / 个性签名 / 性别），落库持久化。
成功后返回**完整的用户对象**（含更新后的字段），前端据此刷新本地登录态。

```json
// 请求（字段均选填，仅更新传入项）
// nickname 1~50 字，bio ≤500 字，avatar_url 须为合法 URL，gender ∈ {0,1,2}
{ "nickname": "Alice", "avatar_url": null, "bio": "介绍一下自己…", "gender": 1 }

// 响应
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": "uuid",
    "phone": "13800000001",
    "short_id": 10001,
    "nickname": "Alice",
    "bio": "介绍一下自己…",
    "gender": 1,
    "status": 1,
    "created_at": "2026-07-16T14:35:21+08:00",
    "updated_at": "2026-07-17T20:31:26+08:00"
  }
}
```

- `gender`：0=未设置 1=男 2=女。
- 参数校验失败（如昵称超长）返回 `400`。

### GET /api/v1/users/search?q=…

精确搜索用户（好友添加入口，不做模糊匹配防扫号）。`q` 按格式路由：
11 位数字 → 手机号；纯数字 → 元聊号（short_id）；含 `@` → 邮箱。

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "user": { "id": "uuid", "nickname": "Bob", "avatar_url": null, "short_id": 10002 },
    "relation": "friend"
  }
}
```

- `relation`：`none`（可发申请）/ `friend` / `pending_out`（我已申请）/ `pending_in`（对方申请了我）/ `self`。
- 未找到返回 `404`。

### POST /api/v1/contacts/requests

发好友申请。已是好友返回 `409`；对自己发返回 `400`；重复申请（pending/被拒后）UPSERT 重置为 pending 并更新验证消息。

```json
// 请求
{ "target_id": "uuid", "message": "我是 Alice，加个好友" } // message 选填，≤200 字
```

成功后向目标用户在线设备推 WS `contact.request` 帧。

### GET /api/v1/contacts/requests

我相关的申请列表（双向），按 `updated_at` 降序。

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "requests": [
      {
        "id": "uuid",
        "direction": "in",
        "status": 0,
        "message": "我是 Carol",
        "requester": { "id": "uuid", "nickname": "Carol", "avatar_url": null, "short_id": 10003 },
        "target": { "id": "uuid", "nickname": "Alice", "avatar_url": null, "short_id": 10001 },
        "updated_at": "2026-07-16T10:00:00+08:00"
      }
    ]
  }
}
```

- `direction`：`in` 收到的 / `out` 我发出的；`status`：0=待处理 1=已同意 2=已拒绝。

### POST /api/v1/contacts/requests/:id/accept

同意申请（仅 target 可调，否则 `403`）。**原子事务**：翻转申请状态（`WHERE status=pending` 守卫并发）→ 双向写 `contacts`（UPSERT，复活软删）→ get-or-create 单聊会话 → 以同意方身份插入打招呼消息。幂等：已同意的申请重复 accept 返回既有会话、不再发消息。

```json
// 响应
{ "code": 0, "message": "ok", "data": { "conversation_id": "uuid" } }
```

成功后：向申请方推 `contact.accepted`；向双方推打招呼消息的 `message.receive`。

### POST /api/v1/contacts/requests/:id/reject

拒绝申请（仅 target 可调）。非 pending 状态返回 `409`。

### GET /api/v1/contacts

好友列表（含好友的单聊会话 ID，点好友直接进会话）。

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "friends": [
      {
        "user_id": "uuid",
        "nickname": "Bob",
        "avatar_url": null,
        "short_id": 10002,
        "conversation_id": "uuid"
      }
    ]
  }
}
```

- `conversation_id` 为双方共同所在、恰好 2 人的 private 会话（accept 事务保证"好友必有会话"，`null` 仅容忍脏数据）。

### DELETE /api/v1/contacts/:id

删除好友（`:id` 为好友的用户 UUID）。**双向软删** `contacts` 两行，幂等（已非好友仍返回 `204`）。单聊会话与历史消息保留（重新加好友可继续对话）。

- 成功：`204 No Content`。
- 副作用：向**双方**所有在线设备推送 `friend.removed` 帧（见 WS 帧表），前端据此移除好友 + 隐藏关联单聊会话。
- `400`：`:id` 非法或试图删除自己。

### GET /api/v1/blocks

黑名单列表（含目标用户资料，按拉黑时间倒序；目标已注销的条目自动跳过）。

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "items": [
      {
        "target_id": "uuid",
        "nickname": "Bob",
        "avatar_url": null,
        "short_id": 10002,
        "created_at": 1753150000000
      }
    ]
  }
}
```

### POST /api/v1/blocks

拉黑用户。body `{"target_id": "uuid"}`。幂等（重复拉黑返回 `200`）。

- 效果：**单聊消息双向拦截**——任一方拉黑另一方后，双方互发单聊消息都会被拒（`error` 帧 `code=403, message=BLOCKED`）；先解除拉黑才能恢复。群聊消息不受成员间拉黑影响。
- `400`：拉黑自己；`404`：目标用户不存在。
- 拉黑**不**解除好友关系、**不**推送任何 WS 帧（纯个人视角数据）。

### DELETE /api/v1/blocks/:targetId

解除拉黑（`:targetId` 为被拉黑用户 UUID）。幂等，成功 `204 No Content`。

### POST /api/v1/files/upload-url

签发**预签名上传 URL**，客户端凭此 PUT 直传对象存储（MinIO / S3 兼容），服务端不中转文件字节。
校验通过后返回 `upload_url`（15 分钟有效）与 `object_key`（后续 `message.send` / 下载凭此）。

```json
// 请求
// content_type 须在白名单内（image/jpeg|png|gif|webp、application/pdf|msword|docx、text/plain）；
// size 为字节数，超上限（默认 100MB）回 4002
{ "filename": "photo.png", "content_type": "image/png", "size": 20480 }

// 响应
{
  "code": 0,
  "message": "ok",
  "data": {
    "upload_url": "http://localhost:9000/yuanchat/images/2026/07/<uuid>.png?X-Amz-...",
    "object_key": "images/2026/07/<uuid>.png",
    "expires_in": 900
  }
}
```

- Query `category`：显式 `images` / `avatars` / `files`；缺省按 `content_type` 推断（`image/*` → images，其余 → files）。
- **头像专用**：`?category=avatars` 时对象落在 `avatars/` 前缀（匿名公共读），响应额外返回
  `public_url`（形如 `http://<endpoint>/<bucket>/avatars/…`），前端直接存库，**无需再签下载**。
- `object_key` 形如 `{category}/{yyyy}/{mm}/{uuid}.{ext}`：uuid 防碰撞、隐藏原始文件名，扩展名统一小写。
- 错误码：类型非白名单（含空串）→ **`400 code=4001`**（`unsupported file type`）；
  超大 → **`400 code=4002`**（`file too large`）；文件名扩展名脏（含空格/缺失/非小写字母数字，
  会生成下载正则拒收的键）→ **`400 code=4001`**（`invalid file extension`，提前拦截避免对象永久取不回）；
  MinIO 不可达 → **`503`**（`object storage unavailable`）。

### GET /api/v1/files/download-url

换取对象的**预签名下载 GET URL**（2 小时有效），用于私有对象（图片消息等）的受控读取。

```json
// GET /api/v1/files/download-url?key=images/2026/07/<uuid>.png
// 响应
{
  "code": 0,
  "message": "ok",
  "data": {
    "url": "http://localhost:9000/yuanchat/images/2026/07/<uuid>.png?X-Amz-...",
    "expires_in": 7200
  }
}
```

- `key` 必须匹配正则 `^(images|avatars|files)/[0-9]{4}/[0-9]{2}/[0-9a-f-]+\.[a-z0-9]+$`，
  拦截任意 key 探测（越权拉取未授权对象）；不匹配 → `400`（`invalid object key`）。
- MinIO 不可达 → `503`。前端对同一 key 的下载 URL 做进程内缓存（提前 5 分钟过期重取），
  避免同图在消息流反复渲染时重复签名。

#### 对象级读授权（v0.4 H1）

`avatars/` 前缀直接放行（桶策略本就是匿名公共读，签与不签都能取）；**其余前缀逐个校验归属**，
命中任一条即放行，否则 `403`（`object not accessible`）：

1. 该 key 出现在某条**未撤回**消息的 `content.key` 里，且请求者是该会话成员，
   且该消息未被请求者自己的「清空聊天记录」水位过滤；
2. 该 key 属于请求者的**收藏贴纸**，或属于一个**当前可用的表情包**：包未下架
   （`taken_down=false`）、未被敏感词打标（`flagged=false`），且为官方包
   （`is_official=true`，无需添加即可用）或发送者已添加的包。

由此得到的语义与副作用：

- **撤回即撤销**：撤回把 `content` 置 `{}`，key 随之从判定中消失，此后签不出新 URL。
- **清空即对本人撤销**：本人水位推进后本人失效，其他成员不受影响。
- **退群/被踢即失效**：不再是会话成员 → 该会话的媒体一律签不出（本地已缓存的图不受影响）。
- 已签发的 URL **无法追回**，因此 TTL 从 24h 收到 **2h**——TTL 就是撤销的最坏延迟。
- 授权判定失败（查库出错）→ `500`；服务端漏接线（未注入 ACL）→ `500` 而非放行（fail closed）。
- 403 与"对象不存在"共用同一响应，不泄漏某个 key 是否存在。
- 客户端无需改动：所有 presign 都发生在消息已落库之后（发送中用本地 blob 预览）；
  取不到时 `MessageImage`/`StickerImage` 显示可点击重试的错误占位。

> **预签名读权限取舍**：图片消息为**私有**对象，每次浏览都要 `download-url` 换一次性预签名 GET
> （带 `X-Amz-*` 签名参数、有 TTL、且经上述归属校验），杜绝越权直取；头像落在 `avatars/` **公共读**前缀
> （桶策略开放匿名 `s3:GetObject`），用永久 `public_url` 直接展示、免签名——头像本就随处曝光，
> 换取零签名开销与可长期缓存。
>
> **对象字节的回收**独立于本授权模型：业务路径从不删对象（撤回只清 content、清空只推水位、
> 删贴纸只删表行），由离线作业 `go run ./cmd/gc` 回收「宽限期外且无人引用」的对象，
> 见 `docs/DEVELOPMENT.md` 的「对象存储 GC」。

### GET /api/v1/sticker-packs（v0.4 H1）

返回**表情包列表**（商城上线后为**官方包 + 当前用户已添加的包**）及各包全部贴纸
（一次性下发，避免逐包再请求）。个人收藏不在本端点，走 `GET /api/v1/stickers/mine`。

分页为可选（照抄 `/sticker-packs/market` 的游标范式）：

- **不传 `limit`：返回全量**（向后兼容，`sort ASC, created_at ASC` 排序，`next_cursor` 为 `null`）；
- 传 `limit`（上限 50）：按 `created_at ASC` 游标分页，`?cursor=<上一页 next_cursor>&limit=<n>`，
  `next_cursor` 为最后一条的 `created_at`（RFC3339Nano），无下一页为 `null`；非法游标 → `400`。

每个贴纸携带 `object_key`，前端用 `POST /api/v1/files/download-url` 换预签名 GET 渲染
（同 key 的下载 URL 在前端有进程内缓存，见上文）。

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "packs": [
      {
        "pack": {
          "id": "uuid",
          "name": "YuanChat 官方表情",
          "is_official": true,
          "sort": 0,
          "created_at": "2026-08-09T10:00:00+08:00"
        },
        // 分页模式下响应额外含 "next_cursor"（全量模式为 null）
        "stickers": [
          {
            "id": "uuid",
            "pack_id": "uuid",
            "object_key": "images/2026/08/<uuid>.png",
            "width": 96,
            "height": 96,
            "content_hash": "<hex-sha256>",
            "created_at": "2026-08-09T10:00:00+08:00"
          }
        ]
      }
    ]
  }
}
```

> 注意响应形状是 `packs[].pack` + `packs[].stickers` 两层，**不是**把 stickers 平铺进 pack 对象。
> 官方包贴纸 `owner_id` 为 `null`、`pack_id` 非空；个人收藏反之（两者互斥）。

### GET /api/v1/stickers/mine（v0.4 H1）

返回当前用户的**个人收藏贴纸**（`owner_id = 自己`），最新在前（`created_at DESC`）。
无收藏时 `stickers` 为空数组 `[]`（**不是 `null`**，服务端显式保证）：客户端把
「该字段不是数组」视为响应损坏并抛错走错误态 + 重试，真实空列表不能撞进那条路径。
`GET /api/v1/sticker-packs` 的 `packs` 同此约定。

支持游标分页：`?before=<RFC3339>&limit=<n>`。页大小默认与上限均为 500，
即**一页足以装下一个用户可能拥有的全部收藏**（收藏上限亦为 500），
故前端单次请求即可拿全、无需翻页；`has_more` 恒为 `false`，
除非将来放宽收藏上限。`before` 非法 → `400`（`invalid before cursor`）。

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "stickers": [
      {
        "id": "uuid",
        "owner_id": "uuid",
        "object_key": "images/2026/08/<uuid>.png",
        "width": 96,
        "height": 96,
        "content_hash": "<hex-sha256>",
        "created_at": "2026-08-09T10:00:00+08:00"
      }
    ],
    "has_more": false
  }
}
```

### POST /api/v1/stickers（v0.4 H1）

**收藏贴纸**：把一个**已上传的图片对象**登记为个人贴纸，不做二次上传。当前前端入口是
「图片消息 → 右键 → 添加到表情」，直接复用该图片消息已有的 `object_key`；若要收藏新图，
先走常规图片上传（`POST /api/v1/files/upload-url` → 直传 MinIO）拿到 `images/` 下的 key 再调本端点。

客户端需自算内容 SHA-256（浏览器 `crypto.subtle.digest`，Chrome 74+ 原生支持；Node 22+ 亦有）。
服务端按唯一约束 `(owner_id, content_hash)` 幂等去重：同一用户重复收藏同一内容返回**既有行**，
不新增；不同用户各自独立（Postgres 唯一约束视 NULL 互不相等，故官方包 `owner_id=NULL` 的多行不受影响）。

```json
// 请求（四个字段全部必填）
{
  "object_key": "images/2026/08/<uuid>.png",
  "width": 96,
  "height": 96,
  "content_hash": "<hex-sha256>"
}

// 响应（200 OK，首次创建与去重命中同为 200）
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": "uuid",
    "object_key": "images/2026/08/<uuid>.png",
    "width": 96,
    "height": 96
  }
}
```

- 缺任一字段（`width`/`height` 传 `0` 亦视为缺失，gin `binding:"required"` 语义）→ `400`。
- `object_key` 必须匹配 `^images/[0-9]{4}/[0-9]{2}/[0-9a-f-]+\.[a-z0-9]+$` 且长度 ≤ 255，
  否则 `400`（`invalid object key`）。这是数据卫生 + 列宽约束；真正拦截路径穿越的是
  `POST /files/download-url` 的同类锚定正则（贴纸表不是预签名的信任来源）。
- `content_hash` 必须匹配 `^[0-9a-f]{64}$`（小写十六进制 SHA-256），
  否则 `400`（`invalid content hash`）。
- `width`/`height` 须为正且 ≤ 4096，否则 `400`（`invalid sticker dimensions`）。
- `object_key` 指向的对象必须真实存在于存储中，否则 `404`
  （`sticker object does not exist`）——重试无意义，前端据此提示"图片已失效"。
  MinIO 不可达时该校验降级跳过。
- 单用户收藏上限 500，超限 `409`（`too many favorited stickers`）。
  已达上限时**重复收藏已有内容**仍返回 `200`（幂等，不新增行）。
- 并发重复收藏（同 `owner_id` + `content_hash`）返回 `200` 与既有行，不再是 `500`。

### DELETE /api/v1/stickers/:id（v0.4 H1）

删除**自己的**收藏贴纸。官方包贴纸（`owner_id=NULL`）不可删。
删除后对应 MinIO 对象**不删除**（对象存储开销可忽略；且该 key 可能仍被历史图片消息引用）。

```json
// DELETE /api/v1/stickers/<uuid>
// 响应（200 OK）
{ "code": 0, "message": "ok", "data": { "message": "removed" } }
```

- `id` 非合法 UUID → `400`（`invalid sticker id`）。
- 贴纸不存在 → `404`；存在但非本人（含官方包贴纸）→ `403`（`not the sticker owner`）。

### 表情商城与投稿发布（v0.4 H1b）

`sticker_packs` 自 H1b 起新增 `owner_id`（发布者，注销置 NULL——**有意偏离** CASCADE 惯例：
已添加该包的用户不因发布者注销而丢失）、`is_public`、`flagged`（包名敏感词命中打标，
不阻塞发布，同 `messages.flagged` 范式）、`taken_down`（管理员下架标记，商城不再展示、
已添加者保留）四列；新表 `user_sticker_packs(user_id, pack_id, sort, created_at)` 是
**关系表非快照**（发布者编辑包内容对所有已添加者实时生效）。迁移号 015。

`GET /sticker-packs`（H1 端点）语义扩展为「**官方包 + 已添加的包**」，响应结构不变——
EmojiPicker 无需改动即可展示已添加的包。官方包与发布包贴纸行 `owner_id` 均可为 `NULL`。
分页可选：不传 `limit` 返回全量（向后兼容）；传 `limit` 走 `created_at ASC` 游标分页
（响应多一个 `next_cursor`，无下一页为 `null`），见上文端点说明。

#### 商城浏览

| 方法   | 路径                                          | 说明                                                                                                                                       |
| ------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/v1/sticker-packs/market?cursor=&limit=` | 商城列表：`is_public=true AND taken_down=false`，`created_at DESC` 游标分页（`cursor`=上一页 `next_cursor`，RFC3339），每页默认/上限 20/50 |
| GET    | `/api/v1/sticker-packs/:id`                   | 包详情（含 `owner_name`、`is_owner`、`first_sticker_key`、全部贴纸、`added`）；下架包仅对已添加者保留可见                                  |
| POST   | `/api/v1/sticker-packs/:id/add`               | 添加到我的列表（幂等，`UNIQUE(user_id, pack_id)`）；下架/未公开包按 404 拒绝                                                               |
| DELETE | `/api/v1/sticker-packs/:id/add`               | 从我的列表移除（不影响包本身）                                                                                                             |

商城列表项形状（`added` 为当前用户是否已添加，批量查询防 N+1）：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "packs": [
      {
        "id": "uuid",
        "name": "包名",
        "cover_url": "http://<minio>/yuanchat/sticker-covers/… | null",
        "first_sticker_key": "images/2026/08/<uuid>.png | null",
        "owner_name": "Alice | null（官方或已注销）",
        "is_official": false,
        "sticker_count": 8,
        "added": false,
        "created_at": "2026-08-30T16:31:57+08:00"
      }
    ],
    "next_cursor": "2026-08-30T16:31:57.907293+08:00 | null"
  }
}
```

`first_sticker_key` 为包内最早一张贴纸的对象键，封面缺失时前端回退展示它
（`cover_url` 走 `sticker-covers/` 公共读直链，贴纸本体仍走预签名）。

#### 投稿发布与管理

| 方法   | 路径                                            | 说明                                                                 |
| ------ | ----------------------------------------------- | -------------------------------------------------------------------- |
| POST   | `/api/v1/sticker-packs`                         | 发布（`is_public=true` 一步公开，无草稿态）：包 + 全部贴纸同事务创建 |
| PATCH  | `/api/v1/sticker-packs/:id`                     | 改名 / 换封面（仅发布者；改名过敏感词）                              |
| POST   | `/api/v1/sticker-packs/:id/stickers`            | 追加一张贴纸（仅发布者；单包上限 500，超限 `409`）                   |
| DELETE | `/api/v1/sticker-packs/:id/stickers/:stickerId` | 从包移除一张贴纸（仅发布者；允许空包）                               |
| GET    | `/api/v1/sticker-packs/mine`                    | 我发布的包（`is_owner` 恒 true，带 `sticker_count`）                 |
| DELETE | `/api/v1/sticker-packs/:id`                     | 删除我发布的包（级联清理贴纸与添加关系，已添加者同步失去）           |

发布请求体（`collection` 从本人收藏**复制**新行、`object_key` 复用同一 MinIO 对象；
`upload` 为直传新图）：

```json
{
  "name": "包名（≤64 字）",
  "cover_object_key": "sticker-covers/2026/08/<uuid>.png",
  "sticker_sources": [
    { "source": "collection", "sticker_id": "uuid" },
    {
      "source": "upload",
      "object_key": "images/2026/08/<uuid>.png",
      "width": 96,
      "height": 96,
      "content_hash": "<hex>"
    }
  ]
}
```

- 贴纸来源为空 → `400`；封面 key 非 `sticker-covers/` 前缀 → `400`；
  贴纸 `object_key` 非 `images/` 前缀 → `400`。
- **每用户发布包上限 20**（硬编码常量），超限返回 `400` 且业务码 **`4003`**
  （`publish limit exceeded`；沿用 file.go 4001/4002 惯例，前端按 code 识别）。
- 包名非合法（空/超长）→ `400`；命中敏感词不拒绝，落 `flagged=true` 进 admin 审核队列。
- 非发布者操作他人包 → `403`；包不存在 → `404`；下架/未公开包按 `404` 返回（不区分状态）。
- 发布成功返回与详情一致的形状（`added=false`、`is_owner=true`）。

#### 举报与治理

- `POST /api/v1/reports` 的 `target_type` 白名单扩展 `sticker_pack`。
- 管理端（JWT + `role=admin`，写操作留审计日志）新增三端点：
  - `GET /api/v1/admin/sticker-packs?q=&flagged=true`——表情包检索（`flagged=true` 只看审核队列）；
  - `POST /api/v1/admin/sticker-packs/:id/takedown`——直接下架（`taken_down=true`，软下架非硬删）；
  - `DELETE /api/v1/admin/sticker-packs/:id/flag`——清除敏感词标记（审核通过）。
- 举报处置选「删除」时对 `sticker_pack` 目标执行下架（原 `admin_service` 只会删消息）。

#### 对象存储

上传类别新增 **`sticker-covers/`**（`POST /files/upload-url?category=sticker-covers`）：
匿名公共读（桶策略独立 Statement，同 `avatars/` 模式），upload-url 响应带 `public_url`
直链，无需预签名下载。贴纸本体仍走 `images/`（私有 + 预签名）。
对象级 ACL / GC（`ReferencedKeys`）已把 `sticker_packs.cover_url` 计入引用，
离线 `cmd/gc` 不会把封面判为孤儿。

## 三、WebSocket 协议

- 地址：`ws://<host>:8081/ws?token=<access_token>`（生产 `wss://`）。
- 信封：所有帧统一 `{"type": string, "payload": object}`。
- 心跳：WebSocket 协议层 ping/pong。服务端每 `ping_interval`（30s）发 ping，`pong_timeout`（90s）内无 pong 则断开。客户端无需实现业务心跳。
- 每用户最多 `max_connections_per_user`（5）条并发连接，超限拒绝（close code 1008）。

### 客户端 → 服务端

| type           | payload                                                                                                     | 说明                                                                                                                                                                                                                                                                                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `message.send` | `{conversation_id, content: {type:"text", text}, client_msg_id, reply_to_id?, mentions?}`                   | 发送文本（≤4000 字符）。`client_msg_id` 客户端生成，幂等/回执匹配用。`mentions[]`（v0.2）=被 @ 的用户 UUID 列表：仅群聊有效，全部须为群成员且不含自己，命中的成员 `mention_unread` 置 true                                                                                                                                                                         |
| `message.send` | `{conversation_id, content: {type:"image", key, width, height, size}, client_msg_id, reply_to_id?}`         | 发送图片。`content` 走图片分支：`key`=`upload-url` 返回的 object_key，`width`/`height`=像素宽高（气泡等比占位防 CLS），`size`=字节；四者缺一或非正 → `400`（`image content requires key/width/height/size`）                                                                                                                                                       |
| `message.send` | `{conversation_id, content: {type:"file", key, name, size}, client_msg_id, reply_to_id?}`                   | 发送文件。`name`=原始文件名（展示用，≤255 rune），三者缺一 → `400`；MIME 须在 `upload.allowed_types` 白名单内（upload-url 阶段拦截 `4001`）                                                                                                                                                                                                                        |
| `message.send` | `{conversation_id, content: {type:"voice", key, duration, size}, client_msg_id, reply_to_id?}`              | 发送语音（webm/opus）。`duration`=秒数，**1-60s** 之外 → `400`（`voice content requires key/duration(1-60s)/size`）                                                                                                                                                                                                                                                |
| `message.send` | `{conversation_id, content: {type:"sticker", sticker_id, key, width, height}, client_msg_id, reply_to_id?}` | 发送贴纸（v0.4 H1）。`sticker_id` 须为合法 UUID 且**属于发送者收藏，或属于一个可用表情包**（未下架、未被打标，且为官方包或发送者已添加的包；未添加的非官方包贴纸拒绝），否则 `403`（`sticker not available to sender`）；非 UUID → `400`。服务端按 `sticker_id` 查库并用库中的 `object_key`/`width`/`height` **覆盖**客户端传值，客户端传来的 `key`/宽高一律不采信 |
| `message.read` | `{conversation_id, seq}`                                                                                    | 上报已读进度（已读到的最大 seq，只前进不后退）                                                                                                                                                                                                                                                                                                                     |
| `typing`       | `{conversation_id}`                                                                                         | 正在输入（客户端节流 ~3s/次）                                                                                                                                                                                                                                                                                                                                      |

> **ContentPayload（消息体传输结构）**：`{type, text?, key?, width?, height?, size?, name?, duration?, sticker_id?}`。
> text 帧只用 `type`/`text`；image 帧用 `key`/`width`/`height`/`size`；file 帧用 `key`/`name`/`size`；
> voice 帧用 `key`/`duration`/`size`；sticker 帧用 `sticker_id`/`key`/`width`/`height`（均 `omitempty`，不污染文本消息）。
> 服务端落库时按 `content.type` 分流 `message_type`（text=1、image=2、file=3、voice=4、system=6、sticker=8），
> `message.receive` 原样回传 `content`，接收端据 `type` 渲染对应气泡
> （image/file/voice/sticker 均用 `key` 换 `download-url` 拉预签名 GET；voice 播放走单例 Audio；
> sticker 渲染为无气泡裸图、不进大图查看器，见 `StickerImage`）。

> **帧契约的唯一来源**：`contracts/message-send.golden.json`（v0.4 H1）为每种
> `content.type` 存一个完整 `message.send` 样本帧。前端
> `packages/shared/src/__tests__/messageSendGolden.test.ts` 驱动 `messageStore` 真的发帧、
> 与样本深比较；Go 侧 `server/internal/ws/golden_contract_test.go` 把**同一份 JSON**
> 以 `DisallowUnknownFields` 解进 `SendPayload` 再跑 `buildContent` 断言通过与落库类型。
> **改任何一侧的字段名/类型/嵌套都会两端同时变红**，新增 content type 若不补样本，
> Go 侧的覆盖度用例也会失败。改帧结构的正确顺序是：先改 golden，再让两侧变绿。
> 客户端类型侧另有 `ClientFrames`（`ws/chatSocket.ts`）把 `send()` 的 payload 钉死，
> `reply_to_id` 是 branded 类型 `ServerMessageId`，本地 clientMsgId 传进去编译不过。

### 服务端 → 客户端

| type                        | payload                                                                                                                       | 推送对象                                                                                                                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `presence`                  | `{user_id, online}`                                                                                                           | 好友上下线广播（推给上下线用户的**在线好友**）。前端 `applyPresence` 按 `peerId` 匹配单聊会话，`presence` 从 `online`→`offline` 切换                                                                               |
| `message.ack`               | `{client_msg_id, message_id, conversation_id, seq, timestamp}`                                                                | 发送者的所有设备。乐观 UI 收到后：sending → sent，补服务端 seq                                                                                                                                                     |
| `message.receive`           | `{message_id, conversation_id, sender_id, sender_nickname, content, seq, timestamp, reply_to_id?, mentions?, client_msg_id?}` | 会话全部成员（含发送者其他设备；本设备按 `client_msg_id` 去重）。`mentions?`（v0.2）=被 @ 的用户 UUID 数组                                                                                                         |
| `message.read`              | `{conversation_id, user_id, seq}`                                                                                             | 会话全部成员。`user_id`=自己 → 多端未读同步清零；`user_id`=他人 → 把自己 `seq ≤` 该值的已送达消息翻为已读                                                                                                          |
| `typing`                    | `{conversation_id, user_id, nickname}`                                                                                        | 会话中除输入者外的成员（前端显示 4s 后自动消失）                                                                                                                                                                   |
| `contact.request`           | `{request_id, requester: {id, nickname, avatar_url, short_id}, message, created_at}`                                          | 被申请方全部设备。前端置顶插入"新的朋友"列表 + 角标 +1                                                                                                                                                             |
| `contact.accepted`          | `{request_id, friend: {id, nickname, avatar_url, short_id}, conversation_id}`                                                 | 申请方全部设备。前端翻转申请状态 + 加好友 + 拉会话列表（随后收到打招呼 `message.receive`）                                                                                                                         |
| `conversation.created`      | `{conversation: ConversationDTO}`                                                                                             | 新建群会话的全部成员（含发起者，前端按会话 id 去重）。帧内 DTO 取成员视角（`unread_count`=1、`my_last_read_seq`=0）；被邀请入群时也推给新成员                                                                      |
| `conversation.updated`      | `{conversation_id, name?, member_count?, is_pinned?, pinned_at?, is_muted?, announcement?, announcement_updated_at?}`         | 群改名/成员数变更后推给全体在群成员，前端 patch 会话列表条目；置顶/免打扰变更仅推本人多端（其他成员不感知）；群公告变更推群内全员，**该帧 `announcement` 恒存在**（清除公告时为空串 `""`），前端直接覆盖本地值即可 |
| `conversation.removed`      | `{conversation_id, reason}`                                                                                                   | `reason`：`kicked`（被踢者）/ `left`（退群者本人多端同步）/ `dissolved`（解散全员）。前端把会话移出列表，kicked/dissolved 弹提示                                                                                   |
| `message.recalled`          | `{message_id, conversation_id, seq, operator_id, operator_nickname}`                                                          | 会话全部成员。前端把对应气泡翻成撤回占位（本人「你撤回了一条消息」/ 他人「X 撤回了一条消息」）；撤回最后一条时刷新列表预览                                                                                         |
| `message.reaction`          | `{message_id, conversation_id, user_id, emoji, count, reacted}`                                                               | 会话全员（含操作者多端）。`count`=该 emoji 最新总数；`reacted`=操作者动作是加是删。前端 `user_id`=自己时按 reacted 更新 mine，他人操作保持原 mine                                                                  |
| `friend.removed`            | `{friend_id}`                                                                                                                 | 删好友后推给**双方**所有设备（各自视角的 `friend_id` 是对方）。前端移除好友 + 隐藏关联单聊会话（历史保留）                                                                                                         |
| `conversation.role_changed` | `{conversation_id, user_id, new_role, changed_by}`                                                                            | 任命/免除/转让后推给全体在群成员（转让连发两帧）。前端递增会话 memberVersion 触发成员列表重拉；`user_id`=自己且 `changed_by`≠自己时 toast 提示                                                                     |
| `error`                     | `{code, message, client_msg_id?}`                                                                                             | 当前连接。`client_msg_id` 非空表示对应那次发送失败。`code=403, message=BLOCKED`：单聊被拉黑拒发，前端翻 failed + toast                                                                                             |

> **系统消息**：群管理操作（改名/邀请/踢人/退群）产生的系统消息复用 `message.receive` 帧下发，
> `content.type = "system"`、`content.text` 为文案（如「Alice 修改群名为「X」」）。
> 前端渲染为居中胶囊，列表预览不加发送者昵称前缀。落库 `message_type=6`。

## 四、seq 与已读机制

- 每个会话独立维护单调递增 `last_seq`（`conversations.last_seq`），消息落库时通过
  `UPDATE ... SET last_seq = last_seq + 1 ... RETURNING last_seq` 原子分配，保证会话内消息严格有序、无重复。
- 每个成员维护 `last_read_seq`（`conversation_members.last_read_seq`）。
  **未读数 = last_seq − last_read_seq**，不需要逐条已读表。
- 已读上报只前进不后退（`WHERE last_read_seq < ?`）。
- 断线重连后客户端应重新拉取会话列表 + 活跃会话历史（`chatSocket.onReconnect` 已实现），
  以 seq 对比补齐掉线期间的消息。

## 五、消息发送时序

```
发送端                    服务端                       接收端
  │ message.send            │                            │
  │ ────────────────────────►                            │
  │        （事务：分配 seq + 落库 + 更新 last_message）  │
  │ ◄── message.ack ────────│                            │
  │  (sending → sent)       │ ── message.receive ───────►│
  │                         │    (追加气泡 + 未读+1)      │
  │                         │ ◄── message.read ──────────│（接收端打开会话）
  │ ◄── message.read ───────│                            │
  │  (sent → read 双勾)     │                            │
```

失败路径：发送端 5s 内未收到 `message.ack` → 本地标记 `failed`，用户点击重试按钮以**相同 `client_msg_id`** 重发。

## 六、部署形态

单 Go 进程双监听（`server/cmd/server/main.go`）：

| 端口    | 用途                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------ |
| `:8080` | Gin REST API                                                                                           |
| `:8081` | WebSocket 网关（仅 `/ws` 路径，独立 `http.Server`，无 Read/WriteTimeout——长连接超时由 ping/pong 管理） |

消息分发当前为进程内内存 Hub（`ws.Hub`，实现 `ws.Dispatcher` 接口）。未来多实例部署时，以 Redis Pub/Sub 实现同一接口替换，业务代码不变。
