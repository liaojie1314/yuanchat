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

## 三、WebSocket 协议

- 地址：`ws://<host>:8081/ws?token=<access_token>`（生产 `wss://`）。
- 信封：所有帧统一 `{"type": string, "payload": object}`。
- 心跳：WebSocket 协议层 ping/pong。服务端每 `ping_interval`（30s）发 ping，`pong_timeout`（90s）内无 pong 则断开。客户端无需实现业务心跳。
- 每用户最多 `max_connections_per_user`（5）条并发连接，超限拒绝（close code 1008）。

### 客户端 → 服务端

| type           | payload                                                                        | 说明                                                                |
| -------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `message.send` | `{conversation_id, content: {type:"text", text}, client_msg_id, reply_to_id?}` | 发送文本（≤4000 字符）。`client_msg_id` 客户端生成，幂等/回执匹配用 |
| `message.read` | `{conversation_id, seq}`                                                       | 上报已读进度（已读到的最大 seq，只前进不后退）                      |
| `typing`       | `{conversation_id}`                                                            | 正在输入（客户端节流 ~3s/次）                                       |

### 服务端 → 客户端

| type               | payload                                                                                                            | 推送对象                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `message.ack`      | `{client_msg_id, message_id, conversation_id, seq, timestamp}`                                                     | 发送者的所有设备。乐观 UI 收到后：sending → sent，补服务端 seq                                            |
| `message.receive`  | `{message_id, conversation_id, sender_id, sender_nickname, content, seq, timestamp, reply_to_id?, client_msg_id?}` | 会话全部成员（含发送者其他设备；本设备按 `client_msg_id` 去重）                                           |
| `message.read`     | `{conversation_id, user_id, seq}`                                                                                  | 会话全部成员。`user_id`=自己 → 多端未读同步清零；`user_id`=他人 → 把自己 `seq ≤` 该值的已送达消息翻为已读 |
| `typing`           | `{conversation_id, user_id, nickname}`                                                                             | 会话中除输入者外的成员（前端显示 4s 后自动消失）                                                          |
| `contact.request`  | `{request_id, requester: {id, nickname, avatar_url, short_id}, message, created_at}`                               | 被申请方全部设备。前端置顶插入"新的朋友"列表 + 角标 +1                                                    |
| `contact.accepted` | `{request_id, friend: {id, nickname, avatar_url, short_id}, conversation_id}`                                      | 申请方全部设备。前端翻转申请状态 + 加好友 + 拉会话列表（随后收到打招呼 `message.receive`）                |
| `error`            | `{code, message, client_msg_id?}`                                                                                  | 当前连接。`client_msg_id` 非空表示对应那次发送失败                                                        |

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
