# 01 — 详细架构设计

> **前置阅读**：[MASTER_PLAN.md](./MASTER_PLAN.md)
>
> **实现状态（2026-07-16）**：本文档描述的是**目标微服务架构**。当前实现为
> **单体 Go 服务**（`server/`，单进程双端口：REST :8080 + WebSocket :8081），
> 分层为 handler → service → repository，尚未拆分 gRPC 微服务。
> 消息分发为进程内内存 Hub（`ws.Dispatcher` 接口），多实例部署时以
> Redis Pub/Sub 实现同一接口替换。已实现的聊天协议见
> [CHAT_API.md](./CHAT_API.md)。

---

## 一、整体架构分层

```
┌─────────────────────────────────────────────────────────────────┐
│                         接入层 (Access Layer)                     │
│  ┌──────────┐  ┌───────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ Nginx LB │  │ API G/W   │  │ WS G/W       │  │ CDN (MinIO)│ │
│  │ :443     │  │ :8080     │  │ :8081        │  │ :9000      │ │
│  └──────────┘  └───────────┘  └──────────────┘  └────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │  gRPC (内部)
┌─────────────────────────────────────────────────────────────────┐
│                       服务层 (Service Layer)                      │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │  user    │ │ message  │ │  group   │ │  file    │           │
│  │  service │ │ service  │ │ service  │ │  service │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ session  │ │notify    │ │  search  │ │  bot     │           │
│  │  service │ │ service  │ │  service │ │  service │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                       数据层 (Data Layer)                         │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │PostgreSQL│ │  Redis   │ │  MinIO   │ │  Elastic │           │
│  │   :5432  │ │  :6379   │ │  :9000   │ │ search   │           │
│  └──────────┘ └──────────┘ └──────────┘ │  :9200   │           │
│                                          └──────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、微服务详解

### 2.1 API 网关 (api-gateway)

**职责**：HTTP 流量入口，认证、路由、限流、日志

```
功能：
- 用户认证（JWT 校验）
- 请求路由（→ gRPC 后端服务）
- 速率限制（Token Bucket）
- 请求/响应日志
- CORS 处理
- Request ID 注入（链路追踪）

端口：8080
协议：HTTP/1.1, HTTP/2
依赖：所有后端微服务
```

**路由映射示例**：
| HTTP Path | Method | gRPC 服务 | RPC 方法 |
|-----------|--------|-----------|----------|
| `/api/v1/auth/register` | POST | user.UserService | Register |
| `/api/v1/auth/login` | POST | user.UserService | Login |
| `/api/v1/messages/send` | POST | message.MessageService | SendMessage |
| `/api/v1/messages/history` | GET | message.MessageService | GetHistory |
| `/api/v1/groups/create` | POST | group.GroupService | CreateGroup |
| `/api/v1/files/upload` | POST | file.FileService | Upload |

### 2.2 WebSocket 长连接网关 (ws-gateway)

**职责**：管理客户端 WebSocket 连接，实时消息转发

```
功能：
- WebSocket 连接管理（心跳、重连）
- 用户上线/下线通知
- 消息实时推送
- 连接数限制
- 消息队列消费（离线消息推送）

端口：8081
协议：WebSocket (wss://)
依赖：message-service, session-service
```

**WebSocket 协议设计**：

```json
// 客户端 → 服务端
{
  "type": "message.send",
  "payload": {
    "conversation_id": "uuid",
    "content": { "type": "text", "text": "Hello" },
    "client_msg_id": "client-uuid"
  }
}

// 服务端 → 客户端
{
  "type": "message.receive",
  "payload": {
    "message_id": "uuid",
    "from_user_id": "uuid",
    "conversation_id": "uuid",
    "content": { "type": "text", "text": "Hello" },
    "timestamp": 1718123456789,
    "seq": 1234
  }
}
```

### 2.3 用户服务 (user-service)

**职责**：用户生命周期管理、认证鉴权

```
功能：
- 注册（手机号/邮箱 + 验证码）
- 登录（密码 / 验证码 / 扫码）
- JWT Token 签发与刷新
- 用户资料 CRUD
- 联系人关系管理
- 黑名单管理
- 在线状态管理（与 session-service 协作）

端口：50051 (gRPC)
数据库：PostgreSQL (users, contacts, blacklists 表)
缓存：Redis (用户信息缓存、在线状态)
```

### 2.4 消息服务 (message-service)

**职责**：消息的存储、转发、状态管理（核心服务）

```
功能：
- 发送消息（文本/图片/文件/语音/视频）
- 消息持久化存储
- 消息状态（已发送/已送达/已读）
- 消息撤回（2分钟窗口）
- 消息编辑
- 消息转发/引用/回复
- 离线消息队列
- 消息序列号管理

端口：50052 (gRPC)
数据库：PostgreSQL (messages, message_status 表)
缓存：Redis (最近消息缓存、离线消息队列)
```

### 2.5 群组服务 (group-service)

**职责**：群组生命周期、成员管理、权限控制

```
功能：
- 创建群组 & 解散群组
- 成员邀请/移除
- 群角色（群主/管理员/成员）
- 群设置（名称/头像/公告/禁言）
- 群二维码/邀请链接
- @ 提及功能

端口：50053 (gRPC)
数据库：PostgreSQL (groups, group_members, group_settings 表)
```

### 2.6 文件服务 (file-service)

**职责**：文件上传、存储、缩略图、访问控制

```
功能：
- 文件上传（图片/文件/语音/视频）
- 图片缩略图生成
- 文件访问权限控制
- 预签名 URL 生成
- 文件过期管理

端口：50054 (gRPC)
存储：MinIO (S3 兼容)
数据库：PostgreSQL (files 元数据表)
```

### 2.7 会话服务 (session-service)

**职责**：多设备会话管理、设备列表

```
功能：
- 会话创建/销毁（登录/登出）
- 设备列表管理
- 多端同时在线
- 设备踢下线
- 会话安全检测

端口：50055 (gRPC)
数据库：Redis (会话存储)
```

### 2.8 通知服务 (notification-service)

**职责**：推送通知、系统消息

```
功能：
- APNs (iOS) 推送
- FCM (Android) 推送
- Web Push (Web 端)
- 桌面通知
- 系统消息模板

端口：50056 (gRPC)
依赖：FCM SDK, APNs API
```

### 2.9 搜索服务 (search-service)

**职责**：全文搜索、消息搜索、联系人搜索

```
功能：
- 消息内容搜索
- 联系人搜索
- 群组搜索
- 文件搜索（按文件名）

端口：50057 (gRPC)
依赖：Elasticsearch
```

---

## 三、通信流程详解

### 3.1 用户登录流程

```
Client                  API Gateway           User Service           Redis
  │                         │                      │                   │
  │ POST /api/v1/auth/login │                      │                   │
  │ ────────────────────────►                      │                   │
  │                         │ gRPC: Login          │                   │
  │                         │ ─────────────────────►                   │
  │                         │                      │ Verify password   │
  │                         │                      │ ─────────────────►│
  │                         │                      │ ◄─────────────── │
  │                         │                      │ Create JWT        │
  │                         │ ◄─────────────────────│                   │
  │ ◄────────────────────────│                      │                   │
  │ { access_token,         │                      │                   │
  │   refresh_token }       │                      │                   │
  │                         │                      │                   │
  │ WebSocket Connect       │                      │                   │
  │ ────────────────────────► WS Gateway           │                   │
  │                         │ Verify JWT           │                   │
  │                         │ ◄─────────────────────│                   │
  │ ◄── Connected ──────────│                      │                   │
```

### 3.2 消息发送与接收流程

```
Sender App          WS Gateway        Message Service       Receiver App
    │                    │                    │                    │
    │ message.send       │                    │                    │
    │ ──────────────────►│                    │                    │
    │                    │ gRPC: SendMessage  │                    │
    │                    │ ──────────────────►│                    │
    │                    │                    │ Persist to DB      │
    │                    │                    │ Assign seq no      │
    │                    │ ◄──────────────────│                    │
    │                    │                    │                    │
    │ ◄── message.ack ───│                    │                    │
    │ (with seq + msg_id)│                    │                    │
    │                    │                    │                    │
    │                    │ message.receive    │                    │
    │                    │ ──────────────────────────────────────►│
    │                    │                    │                    │
    │                    │                    │ message.receive    │
    │                    │                    │ (if sender         │
    │                    │                    │  multi-device)     │
    │                    │ ◄──────────────────│                    │
```

### 3.3 心跳与断线重连

```
Client                    WS Gateway
  │                           │
  │ ping (every 30s)          │
  │ ─────────────────────────►│
  │ ◄─ pong ──────────────────│
  │                           │
  │  若 90s 无 ping：         │
  │  ◄─ 连接关闭 ─────────────│  (服务端超时断开)
  │                           │
  │  Client 自动重连：        │
  │  - 指数退避 (1s→2s→4s→8s)│
  │  - 最大重试 10 次         │
  │  - 重连后拉取离线消息     │
  │ ────── reconnect ────────►│
```

### 3.4 通话信令流程（WebRTC）

服务端**只转发不透明信令、永不接触媒体字节**，媒体走端到端（必要时经 coturn 中继）。
房间是唯一模型，1v1 只是 2 人房间的特例；拓扑为 mesh 全连接，房间上限 4 人。

```
Caller              WS Gateway            Callee            coturn
  │ call.invite ────────►│                    │                │
  │                      │ ── call.incoming ─►│（被叫全设备振铃）
  │ ◄─ call.state ───────│ ── call.state ────►│  state=ringing │
  │                      │                    │                │
  │                      │ ◄─ call.answer ────│  accept=true   │
  │ ◄─ call.state ───────│ ── call.state ────►│  state=active  │
  │                                                            │
  │ ◄════ SDP / ICE（call.signal 定址到 conn，原样透传）══════►│
  │                                                            │
  │ ◄══════════ 媒体：SRTP 直连，打不通则经 TURN 中继 ════════►│
  │                      │                    │                │
  │ call.leave ─────────►│ ── call.ended ────►│ reason 由服务端推导
```

- **房间态存 Redis**（Lua 保证原子），TTL 2h 仅作崩溃兜底，正常终结主动删除
- **定址到连接**而非用户：同一账号多端在线时，后接的顶替先接的，旧端仅本地复位
- **通话记录**复用 `MessageTypeSystem=6` 落进会话流，不建新表（本批无迁移）
- **TURN 凭据**由 `GET /calls/ice-servers` 现签 HMAC 临时凭据，服务端不存长期账号

> 帧定义见 [CHAT_API.md 三点五](./CHAT_API.md)，客户端实现（含 Linux 桌面端的原生
> GStreamer 后端）见
> [通话设计文档](./superpowers/specs/2026-09-06-voice-video-call-design.md)。

---

## 四、数据流设计

### 4.1 消息序列号 (message sequence)

每个会话独立维护单调递增的消息序列号：

- `last_seq`: 该会话最后一条消息的序列号
- 客户端本地记录 `local_seq`，重连时与服务端 `last_seq` 对比
- 差异消息通过 `/api/v1/messages/sync` 同步

### 4.2 多设备同步

```
User A 有 3 台设备：Phone / Desktop / Web
消息发送到 User A ↔ User B 的会话中：

1. Phone 发送消息 → 服务端分配 seq=100
2. 服务端推送 seq=100 到 User A 的所有在线设备 (Desktop, Web)
3. 服务端推送 seq=100 到 User B 的所有在线设备
4. User A 的所有设备得到相同的消息视图
```

---

## 五、安全架构

### 5.1 认证流程

```
短期 Token (Access Token)：15 分钟有效期
长期 Token (Refresh Token)：7 天有效期

Access Token 过期 → 用 Refresh Token 换新的 Access Token
Refresh Token 过期 → 需重新登录
```

### 5.2 数据加密

| 层级                | 方案                                    |
| ------------------- | --------------------------------------- |
| 传输加密            | TLS 1.3                                 |
| 密码存储            | bcrypt (cost=12)                        |
| 敏感字段            | AES-256-GCM (数据库加密)                |
| 端到端加密 (阶段三) | Signal Protocol (X3DH + Double Ratchet) |

---

## 六、容器化架构

```
docker-compose.yml 服务列表：

nginx              — 反向代理 :443
api-gateway        — API 网关 :8080
ws-gateway         — WebSocket 网关 :8081
user-service       — gRPC :50051
message-service    — gRPC :50052
group-service      — gRPC :50053
file-service       — gRPC :50054
session-service    — gRPC :50055
notification-svc   — gRPC :50056
search-service     — gRPC :50057
postgres           — :5432
redis              — :6379
minio              — :9000, :9001 (console)
elasticsearch      — :9200
web                — 前端静态资源 :3000
```

---

> **下一步**：[CHAT_API.md](./CHAT_API.md) — 聊天 REST API 与 WebSocket 协议
