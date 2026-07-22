# 元聊 YuanChat — 聊天 API 与 WebSocket 协议

> 对应实现：`server/internal/ws/`（协议与网关）、`server/internal/handler/conversation.go` / `message.go` / `contact.go`（REST）。
> 前端消费方：`packages/shared/src/api/chat.ts` / `contacts.ts`（REST 映射）、`packages/shared/src/ws/chatSocket.ts`（WS 客户端）。

## 一、认证方式

- **REST**：`Authorization: Bearer <access_token>`（15 分钟有效期）。
- **WebSocket**：浏览器 WS API 无法携带 Header，改用 query 参数：
  `ws://<host>:8081/ws?token=<access_token>`。token 无效返回 HTTP 401，不升级连接。

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
        "last_seq": 10,
        "my_last_read_seq": 8,
        "last_message": {
          "preview": "发布评审改到明早 9 点",
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
        "role": 2
      }
    ]
  }
}
```

- `role`：0=普通成员 1=管理员 2=群主。
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

换取对象的**预签名下载 GET URL**（24 小时有效），用于私有对象（图片消息等）的受控读取。

```json
// GET /api/v1/files/download-url?key=images/2026/07/<uuid>.png
// 响应
{
  "code": 0,
  "message": "ok",
  "data": {
    "url": "http://localhost:9000/yuanchat/images/2026/07/<uuid>.png?X-Amz-...",
    "expires_in": 86400
  }
}
```

- `key` 必须匹配正则 `^(images|avatars|files)/[0-9]{4}/[0-9]{2}/[0-9a-f-]+\.[a-z0-9]+$`，
  拦截任意 key 探测（越权拉取未授权对象）；不匹配 → `400`（`invalid object key`）。
- MinIO 不可达 → `503`。前端对同一 key 的下载 URL 做进程内缓存（提前 5 分钟过期重取），
  避免同图在消息流反复渲染时重复签名。

> **预签名读权限取舍**：图片消息为**私有**对象，每次浏览都要 `download-url` 换一次性预签名 GET
> （带 `X-Amz-*` 签名参数、有 TTL），杜绝越权直取；头像落在 `avatars/` **公共读**前缀（桶策略开放匿名
> `s3:GetObject`），用永久 `public_url` 直接展示、免签名——头像本就随处曝光，换取零签名开销与可长期缓存。

## 三、WebSocket 协议

- 地址：`ws://<host>:8081/ws?token=<access_token>`（生产 `wss://`）。
- 信封：所有帧统一 `{"type": string, "payload": object}`。
- 心跳：WebSocket 协议层 ping/pong。服务端每 `ping_interval`（30s）发 ping，`pong_timeout`（90s）内无 pong 则断开。客户端无需实现业务心跳。
- 每用户最多 `max_connections_per_user`（5）条并发连接，超限拒绝（close code 1008）。

### 客户端 → 服务端

| type           | payload                                                                                             | 说明                                                                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `message.send` | `{conversation_id, content: {type:"text", text}, client_msg_id, reply_to_id?}`                      | 发送文本（≤4000 字符）。`client_msg_id` 客户端生成，幂等/回执匹配用                                                                                                                                          |
| `message.send` | `{conversation_id, content: {type:"image", key, width, height, size}, client_msg_id, reply_to_id?}` | 发送图片。`content` 走图片分支：`key`=`upload-url` 返回的 object_key，`width`/`height`=像素宽高（气泡等比占位防 CLS），`size`=字节；四者缺一或非正 → `400`（`image content requires key/width/height/size`） |
| `message.send` | `{conversation_id, content: {type:"file", key, name, size}, client_msg_id, reply_to_id?}`           | 发送文件。`name`=原始文件名（展示用，≤255 rune），三者缺一 → `400`；MIME 须在 `upload.allowed_types` 白名单内（upload-url 阶段拦截 `4001`）                                                                  |
| `message.send` | `{conversation_id, content: {type:"voice", key, duration, size}, client_msg_id, reply_to_id?}`      | 发送语音（webm/opus）。`duration`=秒数，**1-60s** 之外 → `400`（`voice content requires key/duration(1-60s)/size`）                                                                                          |
| `message.read` | `{conversation_id, seq}`                                                                            | 上报已读进度（已读到的最大 seq，只前进不后退）                                                                                                                                                               |
| `typing`       | `{conversation_id}`                                                                                 | 正在输入（客户端节流 ~3s/次）                                                                                                                                                                                |

> **ContentPayload（消息体传输结构）**：`{type, text?, key?, width?, height?, size?, name?, duration?}`。
> text 帧只用 `type`/`text`；image 帧用 `key`/`width`/`height`/`size`；file 帧用 `key`/`name`/`size`；
> voice 帧用 `key`/`duration`/`size`（均 `omitempty`，不污染文本消息）。
> 服务端落库时按 `content.type` 分流 `message_type`（text=1、image=2、file=3、voice=4、system=6），
> `message.receive` 原样回传 `content`，接收端据 `type` 渲染对应气泡
> （image/file/voice 均用 `key` 换 `download-url` 拉预签名 GET；voice 播放走单例 Audio）。

### 服务端 → 客户端

| type                   | payload                                                                                                            | 推送对象                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `presence`             | `{user_id, online}`                                                                                                | 好友上下线广播（推给上下线用户的**在线好友**）。前端 `applyPresence` 按 `peerId` 匹配单聊会话，`presence` 从 `online`→`offline` 切换              |
| `message.ack`          | `{client_msg_id, message_id, conversation_id, seq, timestamp}`                                                     | 发送者的所有设备。乐观 UI 收到后：sending → sent，补服务端 seq                                                                                    |
| `message.receive`      | `{message_id, conversation_id, sender_id, sender_nickname, content, seq, timestamp, reply_to_id?, client_msg_id?}` | 会话全部成员（含发送者其他设备；本设备按 `client_msg_id` 去重）                                                                                   |
| `message.read`         | `{conversation_id, user_id, seq}`                                                                                  | 会话全部成员。`user_id`=自己 → 多端未读同步清零；`user_id`=他人 → 把自己 `seq ≤` 该值的已送达消息翻为已读                                         |
| `typing`               | `{conversation_id, user_id, nickname}`                                                                             | 会话中除输入者外的成员（前端显示 4s 后自动消失）                                                                                                  |
| `contact.request`      | `{request_id, requester: {id, nickname, avatar_url, short_id}, message, created_at}`                               | 被申请方全部设备。前端置顶插入"新的朋友"列表 + 角标 +1                                                                                            |
| `contact.accepted`     | `{request_id, friend: {id, nickname, avatar_url, short_id}, conversation_id}`                                      | 申请方全部设备。前端翻转申请状态 + 加好友 + 拉会话列表（随后收到打招呼 `message.receive`）                                                        |
| `conversation.created` | `{conversation: ConversationDTO}`                                                                                  | 新建群会话的全部成员（含发起者，前端按会话 id 去重）。帧内 DTO 取成员视角（`unread_count`=1、`my_last_read_seq`=0）；被邀请入群时也推给新成员     |
| `conversation.updated` | `{conversation_id, name?, member_count?}`                                                                          | 群改名/成员数变更后推给全体在群成员，前端 patch 会话列表条目                                                                                      |
| `conversation.removed` | `{conversation_id, reason}`                                                                                        | `reason`：`kicked`（被踢者）/ `left`（退群者本人多端同步）/ `dissolved`（解散全员）。前端把会话移出列表，kicked/dissolved 弹提示                  |
| `message.recalled`     | `{message_id, conversation_id, seq, operator_id, operator_nickname}`                                               | 会话全部成员。前端把对应气泡翻成撤回占位（本人「你撤回了一条消息」/ 他人「X 撤回了一条消息」）；撤回最后一条时刷新列表预览                        |
| `message.reaction`     | `{message_id, conversation_id, user_id, emoji, count, reacted}`                                                    | 会话全员（含操作者多端）。`count`=该 emoji 最新总数；`reacted`=操作者动作是加是删。前端 `user_id`=自己时按 reacted 更新 mine，他人操作保持原 mine |
| `error`                | `{code, message, client_msg_id?}`                                                                                  | 当前连接。`client_msg_id` 非空表示对应那次发送失败                                                                                                |

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
