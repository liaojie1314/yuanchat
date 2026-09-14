# F0/F1/F2 — 语音与视频通话（WebRTC）设计文档

> 立项：2026-09-06。基线 `dev @ 124c12b`（K1 消息编辑合并后）。
> 批次覆盖 ROADMAP 的 **F0（可行性 spike）+ F1（1v1 语音）+ F2（视频）+ 群通话（新增）**，
> 分支 `feature/voice-video-call`，`--no-ff` 合回 dev。
>
> **约束**：继承 `AGENTS.md` 全部核心约束（GitFlow、Conventional Commits、i18n 四语无硬编码、
> `build.target=es2019`、圆角上限 `rounded-lg`、JSDoc/godoc、MSW 四态、推送前本地 CI 全绿）。

---

## 1. 目标与范围

### 1.1 做什么

| 能力             | 说明                                                                    |
| ---------------- | ----------------------------------------------------------------------- |
| 1v1 语音通话     | 好友间语音，呼出 / 振铃 / 接听 / 拒绝 / 挂断 / 取消 / 超时 / 忙线全分支 |
| 1v1 视频通话     | 同上 + 视频轨；通话中开关摄像头、前后摄切换（移动端）                   |
| 群通话（新增）   | 发起时**勾选 ≤3 名群成员**邀请；mesh 全连接，房间上限 **4 人**          |
| 通话记录         | 复用 `MessageTypeSystem=6`，content 带结构化 `call` 字段                |
| TURN/STUN        | coturn，dev + prod 都部署；临时凭据经 REST 端点签发                     |
| Linux 桌面端支持 | WebKitGTK 无 GstWebRTC，媒体面改走原生 GStreamer 助手进程（见 §3.11a）  |
| Android 前台服务 | 通话中切后台不被系统回收                                                |

### 1.2 明确不做（本批次范围外，登记为债）

| 项                        | 理由                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| SFU（服务端媒体转发）     | 用户裁决：mesh 先行，SFU 作后续扩展。引 SFU 等于给「单进程 Go 单体、无服务间 RPC」的架构加一个媒体进程 |
| 语音 ↔ 视频通话中升级     | 需要 renegotiation。视频通话内开关摄像头只切 `track.enabled`，语音通话就是语音通话                     |
| 屏幕共享 / 通话录制       | 与 mesh 正交，独立功能                                                                                 |
| E2EE 的 DTLS 指纹签名校验 | 用户裁决：依赖 DTLS-SRTP 自带加密，不与 X3DH 身份密钥绑定                                              |
| 通话记录独立页面          | 记录以系统消息形态留在会话流里，不另建页面                                                             |
| iOS                       | 全仓一致（需 Apple Developer 账户）                                                                    |
| mesh 超 4 人              | 见 §3.1 带宽推算                                                                                       |

---

## 2. 已定裁决

| 编号 | 裁决                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------- |
| N1   | **一批全做**：1v1 语音 + 视频 + 群通话同一分支。信令一次设计到位（房间模型，1v1 是 2 人房间的特例）            |
| N2   | **群通话拓扑 = mesh 全连接，上限 4 人**。SFU 列为后续扩展，数据模型不为它预留字段                              |
| N3   | **dev + prod 都部署 coturn**（钉版本 `coturn/coturn:4.7.0`）。开发期验证走的就是生产同一条路径，不留连通性盲区 |
| N4   | **通话记录复用 `MessageTypeSystem=6`**，content 加结构化 `call` 字段，不新增 message_type                      |
| N5   | **Linux 桌面端要支持**（现有 IM 都支持）。F0 spike 先验，不通则按平台隐藏入口并写进本文档                      |
| N6   | **铃声用 Web Audio 合成**，不引音频资源文件                                                                    |
| N7   | **不与 E2EE 联动**，依赖 DTLS-SRTP                                                                             |
| N8   | **房间态存 Redis**（TTL + Lua 原子操作），不用进程内 map                                                       |
| N9   | **群通话发起时勾选邀请**（≤3 人），非全员振铃；同时会话内出横幅供其他成员主动加入                              |
| N10  | **Android 加前台服务保活**                                                                                     |
| N11  | **通话 UI = 全屏 + 可最小化**，跨页面存活                                                                      |
| N12  | **桌面端（Tauri）通话开独立原生窗口**，不是主窗口内的浮层；Web / 移动端仍为浮层（见 §3.9）                     |

---

## 3. 架构

### 3.1 为什么是 mesh，为什么上限 4

mesh 下每端与其他每端各建一条 `RTCPeerConnection`，服务端只转发信令、不碰媒体字节。
N 人时每端 **N-1 条上行**：

| 人数 | 每端上行（视频 360p@~500kbps） | 每端解码路数 | 结论                         |
| ---- | ------------------------------ | ------------ | ---------------------------- |
| 2    | 0.5 Mbps                       | 1            | 与 1v1 完全相同              |
| 3    | 1.0 Mbps                       | 2            | 宽裕                         |
| 4    | 1.5 Mbps                       | 3            | 旧 Android WebView 可承受    |
| 6    | 2.5 Mbps                       | 5            | 低端机发热掉帧，超出可接受面 |

选 4 的另一个理由：**零新增基建**。mesh 的服务端职责就是"转发不透明信令 + 维护房间成员表"，
与 1v1 完全同一套代码，没有第二条代码路径。

### 3.2 连接级定址（本批次的基础改动）

**问题**：`device_id` 在本仓是**平台标签**，登录时服务端固定写 `"web"`（`user_service.go:214`、`:300`），
同一用户的多台设备拿到的是同一个值。而 `Hub.SendToUsers` 按 user 扇出到该用户全部连接。
mesh 的 SDP/ICE 必须点对点定址到**某一条连接**，用 user_id 定址会把 A 手机的 offer 也发给 A 的桌面端。

**方案**：Hub 增加连接级 ID。

- `Client` 加 `connID uuid.UUID`（`ServeWS` 里生成，进程内唯一即可 —— UUID 全局唯一，多实例也不撞）
- `Hub` 加 `conns map[uuid.UUID]*Client` 索引，`Register`/`Unregister` 同步维护
- 新增 `Hub.SendToConn(connID uuid.UUID, data []byte) bool`（返回是否命中本机连接）

**跨实例**：`SendToConn` 命中本机就直接投；未命中则退回 `SendToUsers(ownerUserID, ...)`
并在帧里带 `to_conn`，由客户端自行过滤 —— 这样多实例部署下信令仍可达，代价是同用户其他设备
会收到一帧无用数据（自己的设备之间，无隐私问题）。**本批次单实例默认，跨实例路径登记为债**（见 §9）。

> 客户端**不需要知道自己的 connID 才能工作**，但需要它来做 glare 消解与自我过滤，
> 因此 `call.state` 帧里带 `self_conn`。

### 3.3 信令帧

**客户端 → 服务端（4 帧）**

| 帧            | payload                                   | 语义                                                |
| ------------- | ----------------------------------------- | --------------------------------------------------- |
| `call.invite` | `{conversation_id, media, invitee_ids[]}` | 发起。单聊时 `invitee_ids` 可省略（默认对方）       |
| `call.answer` | `{call_id, accept}`                       | 接听 / 拒绝；**群通话的"主动加入"复用 accept=true** |
| `call.leave`  | `{call_id}`                               | 挂断 / 取消 / 退出，同一语义（离开房间）            |
| `call.signal` | `{call_id, to_conn, data}`                | SDP / ICE，服务端不解析 `data`                      |

**服务端 → 客户端（4 帧）**

| 帧              | payload                                                                | 投递对象                              |
| --------------- | ---------------------------------------------------------------------- | ------------------------------------- |
| `call.incoming` | `{call_id, conversation_id, media, caller: UserBrief, participants[]}` | 被邀请者全部设备（振铃）              |
| `call.state`    | `{call_id, conversation_id, media, state, self_conn, participants[]}`  | 房间内全部连接 + 会话其他成员（横幅） |
| `call.signal`   | `{call_id, from_conn, from_user, data}`                                | 目标连接                              |
| `call.ended`    | `{call_id, reason, duration}`                                          | 房间内全部连接 + 曾振铃的设备         |

`participants[]` 元素：`{user_id, conn_id, nickname, avatar_url, state}`，
`state ∈ {invited, joined}`。`conn_id` 在 `state=invited` 时为空串。

**帧类型常量**（`ws/protocol.go`）：`TypeCallInvite`/`TypeCallAnswer`/`TypeCallLeave`/`TypeCallSignal`
（C→S 常量块）与 `TypeCallIncoming`/`TypeCallState`/`TypeCallSignal`/`TypeCallEnded`（S→C 常量块）。
`call.signal` 双向同名，值相同 —— 与既有 `message.read`/`typing` 的双向同名帧一致。

### 3.4 媒体协商（客户端）

**glare 消解**：`self_conn < peer_conn`（字符串字典序）者发 offer，另一方等待。
UUID 字典序全序且唯一，不会双方同时 offer，也不会双方都等。

```
收到 call.state
  → 对每个 participants 中 state=joined 且 conn_id ≠ self_conn 的 peer：
      若无 PC → 建 PC、加本地轨、绑 onicecandidate / ontrack
      若 self_conn < peer.conn_id → createOffer → setLocalDescription → call.signal{type:"offer"}
      否则 → 等对方 offer
  → 对已不在 participants 里的 PC → close + 清理远端流

收到 call.signal
  type=offer     → setRemote → createAnswer → setLocal → call.signal{type:"answer"}
  type=answer    → setRemote
  type=candidate → addIceCandidate（remote 未就位时先入队）
```

**getUserMedia 时机**

- 主叫：点击按钮 → **先** `getUserMedia` → 成功才发 `call.invite`。失败（无设备 / 拒权限）出 toast，不发起
- 被叫：点"接听"时才 `getUserMedia`。失败则自动发 `call.leave`，房间按 `failed` 终结

**约束**：语音通话 `{audio:true}`，视频通话 `{audio:true, video:{width:{ideal:640},height:{ideal:480},facingMode:"user"}}`。
不做自适应码率协商（`RTCRtpSender.setParameters` 的 `maxBitrate` 固定为 500kbps 视频 / 32kbps 音频）。

### 3.5 服务端房间态（Redis）

| Key                     | 类型   | 内容                                                                     | TTL |
| ----------------------- | ------ | ------------------------------------------------------------------------ | --- |
| `call:room:{call_id}`   | HASH   | `conversation_id` `media` `caller_id` `state` `created_at` `answered_at` | 2h  |
| `call:room:{call_id}:p` | HASH   | `user_id` → `{"conn_id":"…","state":"invited\|joined"}`                  | 2h  |
| `call:busy:{user_id}`   | STRING | `call_id`                                                                | 2h  |

`state ∈ {ringing, active}`。房间终结即删除三组 key（无 `ended` 持久态 —— 终结事实落在系统消息里）。

**三个 Lua 脚本**（原子性是必需的，不是优化）：

1. `callCreate(roomKey, partsKey, busyKeys…, args…)`
   校验 caller 不忙 → 写房间 HASH → 写全部参与者（caller=joined，invitee=invited）
   → 只给 caller 置 busy。**返回被跳过的忙线 invitee 列表**。
   非原子的话，两个人同时呼同一个人会双双成功，被叫端出现两个来电弹层。
2. `callAnswer(roomKey, partsKey, busyKey, userID, connID, maxParticipants)`
   校验房间存在 → 校验人数未满 → `SETNX` busy（已忙则拒）→ 写 `{conn_id, state:"joined"}`
   → joined 数 ≥2 且 `state=ringing` 时翻 `active` 并写 `answered_at`。
   返回 `(ok, state, answered_at)`。
3. `callLeave(roomKey, partsKey, busyKey, userID)`
   删该 user 的参与者项与 busy → 统计剩余 joined 数
   → **剩余 joined < 2 即终结房间**（删三组 key），返回 `(ended, state, answered_at, remaining)`。

> **为什么"剩余 <2 即终结"而不是 "=0"**：3 人房间走到只剩 1 人时，那个人对着空房间毫无意义。
> 与 mesh 上限 4 一致，房间不做"等人再来"的挂起态。

**60 秒无应答**：`callCreate` 成功后起一个进程内 `time.AfterFunc(60s)`，到点若房间仍 `ringing`
则按 `timeout` 终结。Redis 的 2h TTL 是崩溃兜底，不是业务定时器。

### 3.6 终结原因与通话记录

**reason 由服务端推导，客户端不上报**（客户端只说"我离开了"）：

| reason      | 触发                                               | 系统消息 result |
| ----------- | -------------------------------------------------- | --------------- |
| `completed` | 房间曾 `active`，最后走到 joined <2                | `answered`      |
| `rejected`  | `call.answer{accept:false}`（1v1）                 | `rejected`      |
| `canceled`  | 房间 `ringing` 期间主叫 `call.leave`               | `canceled`      |
| `timeout`   | 60s 定时器触发，房间仍 `ringing`                   | `missed`        |
| `busy`      | 全部 invitee 忙线（`callCreate` 返回空 joined 面） | `busy`          |
| `failed`    | 被叫接听后媒体获取失败即离开，房间从未 `active`    | `canceled`      |

**通话记录落库**：房间终结时由 `CallService` 调既有 `appendSystemMessage` + `pushSystemReceive`。

```jsonc
// messages.content（message_type = 6）
{
  "text": "通话时长 03:24", // 兜底：老客户端与服务端预览都读它
  "call": {
    "media": "audio", // audio | video
    "result": "answered", // answered | missed | rejected | canceled | busy
    "duration": 204, // 秒，非 answered 时为 0
  },
}
```

- `ContentPayload` 加 `Call *CallInfo \`json:"call,omitempty"\``，不影响既有帧
- 前端：`content.call` 存在 → 走 i18n 渲染（图标 + `chat.call.answered` 等 + `mm:ss` 时长）；
  不存在 → 回退 `text`。老版本客户端不会白屏
- 未接来电**自然计入未读**：系统消息走 `CreateWithSeq` 递增 seq，无需额外改动
- **会话列表预览**：`previewOf` 的 system 分支加一条 —— content 含 `call` 键时返回
  `("", previewKindCall)`，客户端渲染本地化的 `[通话]`。
  不能沿用现状返回 `c.Text`：那会让英/日/韩界面的列表出现中文"通话时长 03:24"

### 3.7 TURN / STUN

**部署**

- `deploy/docker-compose.yml`：`coturn/coturn:4.7.0`，`network_mode: host`。
  host 模式是 dev 的正确选择 —— relay 需要一整段 UDP 端口，bridge 模式下逐个发布既慢又易错
- `deploy/docker-compose.prod.yml`：发布 `3478:3478/udp`、`3478:3478/tcp`、
  `49160-49200:49160-49200/udp`，并配 `external-ip=$PUBLIC_IP`（NAT 后必须显式告知外网 IP，
  否则 coturn 把内网地址写进 relay candidate，客户端连不上）
- coturn 配置走 `deploy/coturn/turnserver.conf`：`use-auth-secret` + `static-auth-secret`
  - `realm` + `fingerprint` + `no-multicast-peers` + `denied-peer-ip`（私网段，防 SSRF 式中继滥用）

**凭据签发**：`GET /api/v1/calls/ice-servers`（`AuthRequired` + `LimitByIP(20, 40)`）

```jsonc
{
  "ice_servers": [
    { "urls": ["stun:localhost:3478"] },
    {
      "urls": ["turn:localhost:3478?transport=udp", "turn:localhost:3478?transport=tcp"],
      "username": "1757142000:8f3e…", // <unix_expiry>:<user_id>
      "credential": "b64(HMAC-SHA1(secret, username))",
    },
  ],
  "ttl": 3600,
}
```

这是 coturn 的标准 REST API 口径（`use-auth-secret` 模式）：**不建 TURN 用户表**，
凭据自校验且带过期时间。`turn.enabled=false` 时只返回 STUN 项。

**Android 联调**：`scripts/dev.mjs` 的 `REVERSE_PORTS` 加 `3478`。
模拟器走 **TURN over TCP**（`adb reverse` 只转发 TCP），relay 侧仍是 UDP，连通性不受影响。
这一条是"模拟器 ↔ Web 跨端真机验证"能成立的前提 —— 模拟器在 `10.0.2.x` NAT 后，
host candidate 对宿主不可达，没有 relay 就必然打不通。

### 3.7.1 房间快照端点

`GET /api/v1/calls/:call_id`（`AuthRequired` + `LimitByIP(20, 40)`）→ 房间当前状态：

```jsonc
{
  "call_id": "…",
  "conversation_id": "…",
  "media": "video",
  "state": "ringing",
  "caller": { "id": "…", "nickname": "…", "avatar_url": null },
  "participants": [
    { "user_id": "…", "conn_id": "", "nickname": "…", "avatar_url": null, "state": "invited" },
  ],
}
```

调用方只有一个：**桌面通话窗口启动时拉快照**（§3.9）。它解决的是一个真实竞态 ——
通话窗口是在 `call.incoming` 之后才创建的，它的 WS 连上时那一帧早已发完，
不拉快照就没有房间信息可渲染。同时它让"通话窗口刷新/重开"天然可恢复。
非房间参与者请求返回 403；房间不存在返回 404。

**新增配置段**（`server/config/config.yaml` + `internal/config/config.go`）：

```yaml
turn:
  enabled: true
  host: "localhost" # 客户端可达的主机名/IP（不是容器内网名）
  port: 3478
  realm: "yuanchat"
  static_auth_secret: "" # 生产走 YUANCHAT_TURN_STATIC_AUTH_SECRET
  credential_ttl: 3600
```

> ⚠️ `static_auth_secret` 生产只从环境变量下发，因此 `Load()` 里**必须** `v.SetDefault("turn.static_auth_secret", "")`。
> viper 的 `AutomaticEnv` 不把未知 key 注册进 `AllKeys()`，而 `Unmarshal` 只遍历 `AllKeys()` ——
> 不 `SetDefault` 就会被静默丢弃（`minio.public_endpoint` 踩过同一个坑，见 `config.go:180-185`）。

### 3.8 前端结构

```
packages/shared/src/webrtc/
  peerMesh.ts        # PC 生命周期、mesh 建连、ICE 队列、轨道增删（无 React 依赖）
  ringtone.ts        # Web Audio 合成铃声 + 移动端震动
  iceServers.ts      # GET /calls/ice-servers + 缓存（TTL 内复用）
packages/shared/src/store/callStore.ts   # 状态机（唯一真源，各端一致）
packages/shared/src/hooks/useCallSocket.ts  # 精简 bootstrap：只连 WS + 注册 4 个 call 帧
packages/ui/src/
  CallView.tsx              # 通话主视图（来电 / 呼出 / 通话中三态同一组件）
  CallHost.tsx              # Web/移动端的浮层宿主（读 callStore 决定挂不挂）
  CallInviteModal.tsx       # 群通话选人（≤3）
  callFormat.ts             # 时长 mm:ss 格式化
```

**`CallView` 与挂载方式解耦**：它是纯组件，只读 `callStore` + 收回调。
Web / 移动端由 `CallHost` 挂成浮层，桌面端由独立窗口的 `/call` 路由挂成整页（§3.9）。
两种挂载共用同一份视图代码，不做两套 UI。

**callStore 状态机**

```
idle ──invite──> outgoing ──首个 joined──> active ──leave/ended──> idle
 │                  │                         │
 │                  └──ended(canceled/timeout/busy/rejected)──> idle
 └──call.incoming──> incoming ──accept──> active
                          └──reject/ended──> idle
```

`minimized: boolean` 是 UI 态，与上面正交。

**Web / 移动端挂载**：`CallHost` 挂在 `MainLayout` 的 mobile / desktop 两个分支里
（与 `ToastHost` 同级），因此切页面、进设置、看联系人都不中断。z-index：来电态 `z-[110]`
高于 `ToastHost` 的 `z-[100]`（来电是最高优先级的打断）；最小化悬浮条 `z-[90]`。
全屏态要叠 `paddingTop: var(--safe-area-top, 0px)`。

**安卓返回键**：`CallView` 按当前态注册 `registerBackInterceptor` ——
来电态拦截 → 返回键 = 拒接；通话全屏态拦截 → 返回键 = 最小化（不挂断）。

**入口接线**（四处，现均为占位）：

| 位置                        | 现状                               |
| --------------------------- | ---------------------------------- |
| `ChatWindow.tsx:359-373`    | 两个按钮有 `aria-label` 无 onClick |
| `Composer.tsx:690-699`      | 更多宫格两项 → `comingSoon` toast  |
| `ChatDetail.tsx:261`        | QuickAction 无 onClick             |
| `ContactDetail.tsx:175-184` | 两个 QuickAction → `comingSoon`    |

群会话点通话按钮 → 先开 `CallInviteModal` 选人；单聊直接发起。

### 3.9 桌面端：独立原生窗口（N12）

**为什么必须是"完整参与者"而不是"投屏的视图"**：Tauri 的每个 `WebviewWindow` 是独立
JS 上下文，`MediaStream` 与 `RTCPeerConnection` 不能跨窗口传递。视频要在通话窗口里渲染，
PeerConnection 就必须建在通话窗口里；PC 需要信令，信令就得有连接。

于是通话窗口**自己建一条 WebSocket**（`max_connections_per_user: 5`，主窗口 + 通话窗口共 2 条，
远未触顶），拿到自己的 `conn_id`，成为房间里那个真正的参与者。
主窗口的连接只负责"收到来电 → 开窗口"和"作为会话成员收 `call.state` 渲染横幅"。

> 曾评估的替代方案：主窗口持 WS，把 SDP/ICE 经 Tauri `emit`/`listen` 转发给通话窗口。
> 否决理由：每条 ICE 候选多两跳序列化、`conn_id` 归属主窗口造成身份错位，
> 且主窗口一关通话立刻死 —— 而独立连接方案下通话窗口自成一体。

**窗口生命周期**

| 事件                     | 行为                                                                                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 主叫点通话按钮           | 主窗口**不发** `call.invite`，只开通话窗口 `/call?role=caller&conversation_id=…&media=…&invitees=…`；`call.invite` 由通话窗口发出（这样发起者的 `conn_id` 就是通话窗口的） |
| 主窗口收 `call.incoming` | 开通话窗口 `/call?role=callee&call_id=…`；主窗口自身不渲染来电 UI                                                                                                          |
| 通话窗口启动             | 连 WS → `GET /calls/:call_id` 拉房间快照（呼出场景则先 `call.invite`）→ 渲染 `CallView`                                                                                    |
| 用户关窗口               | WS 断开 → 服务端按"连接掉线即离开房间"处理（§3.10），等价于挂断                                                                                                            |
| 通话终结                 | 通话窗口自行 `close()`                                                                                                                                                     |
| 最小化                   | `setSize(320×72)` + `setAlwaysOnTop(true)`；还原则复位尺寸并取消置顶                                                                                                       |

**窗口参数**：`label: "call"`、`decorations: false`（复用既有 `TitleBar`）、
`width: 420 / height: 620`（语音）或 `760×560`（视频）、`center: true`、`resizable: true`。
`WebviewWindow.getByLabel("call")` 已存在则 `setFocus()`，不重复开 —— 与 `useTauriAuth.ts:17-24` 同一范式。

**Tauri 配置改动**

- `capabilities/default.json`：`windows` 数组加 `"call"`；
  `permissions` 加 **`core:window:allow-set-always-on-top`**（已在 `gen/schemas/desktop-schema.json`
  中核实存在，未凭印象猜权限名）
- `tauri.conf.json` 的 CSP **不改**：媒体走 `blob:`（已放行），ICE/TURN 是 UDP/TCP 传输层，不受 CSP 约束

**新增前端文件**：`apps/desktop/src/pages/CallWindowPage.tsx`（`/call` 路由）、
`apps/desktop/src/hooks/useCallWindow.ts`（主窗口侧：订阅 `callStore` 开/关窗口）。

**浮层 vs 窗口的开关不做平台嗅探**：`MainLayout` 加 `callMode?: "overlay" | "window"` prop
（默认 `"overlay"`），`apps/desktop` 在 `!useIsMobile()` 时传 `"window"`。
理由：`useIsDesktop()` 其实只判 `__TAURI_INTERNALS__`，Android 的 Tauri 也为真，
在 `packages/ui` 里再嗅探一次平台会把"桌面"与"Tauri"两个概念混掉；
而 app 侧本就掌握平台信息，显式传下来最不易错。

**window 模式下主窗口 `callStore` 只作触发器**：`useCallWindow` 观察到
`incoming`/`outgoing` 即开窗，随后把主窗口的 store 复位为 `idle`（通话态归通话窗口所有）。
重复开窗由 `WebviewWindow.getByLabel("call")` 去重。

**三端挂载对照**

| 端            | 来电呈现        | 通话中呈现          | 最小化形态                  |
| ------------- | --------------- | ------------------- | --------------------------- |
| Web           | `CallHost` 浮层 | `CallHost` 浮层全屏 | 页面内悬浮条 `z-[90]`       |
| 桌面（Tauri） | **独立窗口**    | **独立窗口**        | 窗口缩为 320×72 置顶        |
| Android       | `CallHost` 浮层 | `CallHost` 浮层全屏 | 页面内悬浮条 + 前台服务通知 |

### 3.10 连接掉线即离开房间

`Hub.Unregister` 增加回调：连接断开时若该 `conn_id` 是某房间的 joined 参与者，
按 `call.leave` 同一路径处理。

这不是为桌面窗口特设的 —— 拔网线、杀进程、手机切后台被回收都会走到这里。
没有它，一方掉线后另一方会永远停在"通话中"，房间要等 Redis 2h TTL 才消失。

实现：`CallService` 维护 `conn_id → call_id` 的 Redis 反向索引（`call:conn:{conn_id}`，与房间同 TTL），
`Unregister` 时查一次即可，不需要遍历房间。

### 3.11 Linux 桌面（F0 spike 的核心）—— 实测结论：(b) 不通，按能力降级

`apps/desktop/src-tauri/src/lib.rs` 两处改动已实施并保留（对 WebRTC 可用的宿主是必要条件）：

```rust
settings.set_enable_media_stream(true);
settings.set_enable_webrtc(true);              // WebKitGTK 2.38+ 默认关闭 WebRTC
// permission 放行从「仅音频」扩到「音频或视频」
```

`set_enable_webrtc` 需要 `webkit2gtk` crate 的 `v2_38` feature；`Cargo.toml` 已钉 `v2_40`（包含它）。

#### 实测结论

**spike 结果是 (b)：本机 WebKitGTK 上 `RTCPeerConnection` 不存在，Linux 桌面端打不了电话。**

复现与定位（本机 WebKitGTK 2.50.4 / GStreamer 1.20.3）：

| 步骤                                                               | 观测                                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Tauri 窗口内求值                                                   | `RTCPeerConnection=undefined`、`RTCDataChannel=undefined`，而 `navigator.mediaDevices.getUserMedia=function` |
| Rust 侧回读设置                                                    | `media_stream=true webrtc=true` —— 开关确实设上了                                                            |
| 纯 GTK+WebKit 最小程序（脱离 Tauri，创建前就设好 `enable-webrtc`） | 同样 `RTCPeerConnection=undefined`                                                                           |
| `webkit_settings_get_all_features()` 465 项                        | 无 `PeerConnectionEnabled` 之类的运行时开关可翻                                                              |
| `objdump -p libwebkit2gtk-4.1.so`                                  | NEEDED 有 10 个 GStreamer **API 库**，独缺 `libgstwebrtc-1.0` / `libgstsdp-1.0`                              |
| `strings` 查 `gst_webrtc_*` 符号                                   | 0 个 —— 没有任何 GstWebRTC API 调用                                                                          |
| 查 `webrtcbin` / `gstwebrtc` 字面量                                | 0 个                                                                                                         |
| GTK4 版 `libwebkitgtk-6.0.so.4` 同样检查                           | 同样 0 个（换 ABI 无救）                                                                                     |
| 查运行时强制开关 `WEBKIT_FORCE_ENABLE_FEATURES`                    | 该机制在 2.50.4 里不存在                                                                                     |

即：该 WebKitGTK **构建时就没编进 GstWebRTC 后端**，`enable-webrtc` 是个读回 true 的空开关。

**证据链要按库的性质分开看**（这里容易推错）：GStreamer 的**插件**是运行时 dlopen 的，
所以 `libgstnice.so` 不在 NEEDED 里属正常，不能据此下结论；而 `libgstwebrtc-1.0.so.0`
是**API 库**（由 `libgstreamer-plugins-bad1.0-0` 提供），编了后端就必然直接链接。
它**装在系统里**却不在 NEEDED 中 —— 排除「缺依赖」，坐实「没编进去」。
对照：确实编进的 `libgstreamer-1.0`/`libgstvideo-1.0`/`libgstgl-1.0` 等 10 个都列在 NEEDED，
说明该检查方法有效。

与 `gstreamer1.0-nice` 无关：系统里 `webrtcbin`、`libgstnice.so`、`gstdtls`、`gstsrtp` 插件
都在且可用，`libgstwebrtc-1.0.so.0` 也在，只是 WebKit 从不引用它们。
**应用侧无法绕过**：换 Tauri API、改设置时机、创建前设好设置、重载页面、换 GTK4 ABI 都试过，均无效。

**可行的出路（都需改环境，不在应用范围内）**：把 WebKitGTK 换成编进了 GstWebRTC 的构建
（发行版较新者或自行编译），或让桌面端不走 WebView 的 WebRTC 而改用原生 GStreamer/libwebrtc。

**后续（2026-09-12）：已走通第二条路 —— 原生 GStreamer 后端，语音与视频均可用。**
详见下面的 §3.11a。能力探测的逻辑保留不变，只是 Linux 上现在探测得到了。

### 3.11a Linux 原生通话后端（已实现）

媒体面下沉到进程外的 GStreamer，信令面**完全不动** —— 仍走既有 WebSocket 与
`peerMesh.ts`。前端由 `apps/desktop/src/nativeRtc.ts` 垫片把标准 `RTCPeerConnection`
调用转成对助手的命令，`PeerMesh` 因此不必加任何分支，白拿既有全部测试覆盖。

```
WebView(WebKitGTK)          主进程(Tauri)              助手进程(yuanchat-call-helper)
  nativeRtc.ts  ──invoke──>  native_rtc.rs  ──stdio──>  call_helper.rs
       ▲                          │  行分隔 JSON            │ webrtcbin / v4l2src / vp8enc
       └────── <img src> ─────────┴── MJPEG(127.0.0.1) ─────┘ mjpeg.rs
```

#### 为什么助手必须是独立进程

`webrtcbin` 会拽进 `libnice → libgupnp-igd → libsoup-2.4`，而 WebKitGTK 用的是
`libsoup-3.0`。libsoup2 一旦发现进程里已有 libsoup3 符号就**无条件 abort**
（该检查没有任何环境变量开关，实测 `LD_PRELOAD` 也绕不过）。触发点不是 `gst::init()`
而是**创建 `webrtcbin` 元件**那一刻。拆成两个进程后各自持有自己的 libsoup，互不可见；
附带好处是 GStreamer 崩了只掉一次通话，主界面不受影响。

#### 视频为什么走 MJPEG 而不是 MediaStream

远端画面在助手进程的 GStreamer 里，要显示它的元素在 WebView 里，中间隔着进程边界，
而 WebKitGTK 又没有 `RTCPeerConnection` 可接。三条路里选了 MJPEG：

| 方案                | 否决/采纳理由                                                           |
| ------------------- | ----------------------------------------------------------------------- |
| 复用 stdio 控制通道 | 一帧几十 KB，会把 answer/candidate 挤在后面排队，且长期霸占 stdout 的锁 |
| WebSocket           | 要 SHA-1 握手 + 掩码解帧，得引依赖                                      |
| **MJPEG**（采纳）   | 裸 HTTP，`multipart/x-mixed-replace` 一条响应连续推帧，前端一个 `<img>` |

WebKitGTK 对 `multipart/x-mixed-replace` 的支持是**实测确认**的（同源页面里取两次像素
不同 → 画面在持续刷新，不是只显示首帧）。服务只绑 `127.0.0.1`、端口由系统分配
（故 CSP 按 `http://127.0.0.1:*` 放行），URL 路径带一枚随机 token —— 否则同机任何进程
都能连上来围观用户的通话画面。

音频不走这条路：直接进系统默认输出即可，回传 WebView 只会增加延迟。

#### 摄像头必须共享采集

V4L2 设备**只允许一个打开者**（实测第二个打开 `/dev/video0` 的直接 `not-negotiated`），
而 mesh 拓扑下每个对端各有一条 pipeline。照搬音频的「每条连接各采一份」在第二个人加入时
必然拿不到摄像头。故采集独立成一条 pipeline，**编码也只做一次**，再把编码后的 VP8 帧
分发给每个对端的 `appsrc` —— 顺带省下 N-1 次编码。

同一条采集的另一个分支出 JPEG 作本端自视，因此 WebView 侧**不能**再
`getUserMedia({video})`：那会和助手抢设备。通话窗口在原生路径下只探麦克风。

关摄像头用 `input-selector` 在「摄像头」与「黑帧」两路之间切，而不是断流 ——
断流的话对端抖动缓冲会把最后一帧冻在屏幕上，看起来像卡死而不是「他关了摄像头」。

#### 已知上限

| 项                   | 现状                       | 影响 / 升级路径                                      |
| -------------------- | -------------------------- | ---------------------------------------------------- |
| 关摄像头时设备仍占用 | 只切黑帧，不停采集         | 摄像头指示灯仍亮。停了再开有 1~2s 初始化，按钮像卡住 |
| 新对端等关键帧       | `keyframe-max-dist=30`     | 群通话中途加入最多等 2s 才出画面（15fps）            |
| 采集固定 640×480@15  | 不随网络自适应             | 弱网下丢帧而非降质，需要码率协商才能改善             |
| 摄像头设备写死默认   | `v4l2src` 取 `/dev/video0` | 多摄像头机器不能选；打不开时退化为黑帧并发 warn 事件 |

#### 依赖

见 `docs/DEVELOPMENT.md` 的「Linux 桌面端额外依赖」一节（含逐元件对应的包名、
缺失后果与一次性核对脚本）。要点：视频所需的 `v4l2src`/`vp8enc`/`jpegenc` 等都在
`gstreamer1.0-plugins-good`，缺它**只让视频不可用，语音照常** —— 故
`available` 命令分开回报 `audio` 与 `video` 两个布尔值。

#### 因此的处理：能力探测，不是平台判断

刻意**不**按 `isLinuxDesktop()` 隐藏入口。理由是这不是「Linux 的属性」而是「某个 WebView 构建的属性」：
同为 Linux，换一个编进了 GstWebRTC 的 WebKitGTK 就能用；反过来旧版 Android System WebView
也出现过同样形态。四端跑的分别是 WebView2 / WKWebView / Android System WebView / WebKitGTK，
支持度由宿主系统的版本与构建选项决定，应用侧无从枚举。

落点是 `packages/ui/src/callActions.ts` 的 `canUseWebRTC()`：只问这一个运行时有没有
`RTCPeerConnection`，三端共用一份判断，新平台新版本都不必回来改。三条路径各挡一次：

- **发起**（`startCall`）：闸门在承载器之前 —— 否则桌面端会开出一个连不通的空窗口再自己关掉；
- **加入**（`joinCall`）：同上，且在要麦克风权限之前；
- **接听**（`callFrameHandlers["call.incoming"]`）：**当场回绝**而不是摆出接不通的来电界面，
  主叫据此立刻拿到 rejected，不必干等 60s 振铃超时。

拦下时出 `call.unsupported` 文案（四语言齐备）。**采集能力与连接能力必须分开判**：
本例正是 `getUserMedia` 能出流而 `RTCPeerConnection` 不存在，合并判断会漏。

单测：`packages/ui/src/__tests__/callActions.test.ts`（3 例）、
`packages/shared/src/__tests__/callFrameHandlers.test.ts`（2 例），均已做变异验证。

#### 宿主依赖（对 WebRTC 可用的宿主仍然成立）

WebKitGTK 的 WebRTC 走 GstWebRTC，ICE 代理由 `gstreamer1.0-nice`（`libgstnice.so`）提供，
缺它 `RTCPeerConnection` 收集不到任何候选。需 `sudo apt install gstreamer1.0-nice`。
但**装了也救不了本机**：问题在 WebKitGTK 构建本身，不在插件缺失。

### 3.12 Android

**前台服务保活**：通话中切后台，系统会回收进程导致通话中断。

实现走 **JavascriptInterface 桥**，不写 Rust：
`MainActivity.onWebViewCreate` 已持有 `WebView` 引用，加
`webView.addJavascriptInterface(CallBridge(this), "__yuanchatCall__")`；
新建 `CallForegroundService.kt`（`startForeground` + 常驻通知 + 点击回到应用）。
前端 `startCallService(media)` / `stopCallService()` 在 `typeof window.__yuanchatCall__ !== "undefined"` 时调用。

> 走 JS 桥而非 `#[tauri::command]`：Rust 侧要调 Android API 得引 `jni` + `ndk-context`
> 并手写 JNI 调用，而 `MainActivity.kt` 本来就是本仓已定制的文件（返回键、安全区都在里面）。
> 桥接方向反过来一次，省掉一整层 FFI。

Manifest 新增：

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_CAMERA" />
<service android:name=".CallForegroundService" android:foregroundServiceType="microphone|camera" android:exported="false" />
```

`CAMERA` / `RECORD_AUDIO` / `MODIFY_AUDIO_SETTINGS` 已在（语音消息与扫码登录留下的），
`getUserMedia` 的权限转发链路（`generated/RustWebChromeClient.kt:96-104`）已覆盖音视频两种资源。

### 3.13 铃声（Web Audio 合成）

`AudioContext` + 两个 `OscillatorNode` 经 `GainNode` 做包络：

- **来电铃**：440 Hz + 480 Hz 双音，2s 响 / 4s 停 循环；移动端叠 `navigator.vibrate([600, 1000])`
- **呼出回铃**：450 Hz 单音，1s 响 / 2s 停，音量为来电的 40%
- **挂断提示**：单次 200ms 下滑音

`AudioContext` 必须由用户手势创建（浏览器自动播放策略）。主叫侧的手势是"点通话按钮"，
天然满足；**被叫侧没有手势** —— 来电铃在 `AudioContext.state === "suspended"` 时会静音。
对策：应用启动后首个用户交互（任意 pointerdown）就预创建并 `resume()` 一个模块级 `AudioContext`，
之后一直复用。这是浏览器铃声的标准解法，不是本仓特有的绕行。

---

## 4. 数据与迁移

**无迁移。** 通话不新建表：房间态在 Redis（生命周期 ≤ 通话时长），
通话记录复用既有 `messages` 表的系统消息。

---

## 5. 契约变更

### 5.1 `contracts/server-frames.golden.json`

新增 4 个 case：`call.incoming` / `call.state` / `call.signal` / `call.ended`。
按 `golden_server_frames_test.go` 的既有机制，每个新帧要同步改 **4 处**：
帧常量 + payload struct（`protocol.go`）、契约 case、decode switch（`:56-69`）、
`payloadPrototypes()`（`:76-81`）。字段集双向相等测试会挡下任何一处漏改。

前端侧 `packages/shared/src/__tests__/serverFramesGolden.test.ts` 同步加断言块。

### 5.2 `contracts/message-send.golden.json`

不变。`call.*` 是独立帧，不经 `message.send`。
`ContentPayload` 新增的 `call` 字段带 `omitempty`，既有 case 的 `DisallowUnknownFields` 解码不受影响。

### 5.3 `packages/shared/src/ws/chatSocket.ts`

`ClientFrames` 加 4 键、`ServerFrames` 加 4 键，字段名 snake_case 逐字对齐 Go json tag。

---

## 6. 测试策略

| 层                | 覆盖                                                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Go 单测           | 三个 Lua 脚本的原子语义（miniredis）：并发 answer 恰一人占位、忙线拒绝、剩余 <2 终结、超时终结                                                      |
| Go 集成           | `call.invite → answer → signal → leave` 全链路帧序（httptest + 真 WS）；非会话成员 invite 被拒；房间满员 answer 被拒；**连接掉线自动离开房间**      |
| Go handler        | `GET /calls/ice-servers`：未登录 401、`turn.enabled=false` 只回 STUN、HMAC 凭据可被 coturn 口径复算；`GET /calls/:id`：非参与者 403、房间不存在 404 |
| golden            | 4 个新帧的字段集双向相等（Go + 前端各一套）                                                                                                         |
| 前端单测          | `callStore` 状态机全分支；`peerMesh` 的 glare 消解与 ICE 入队；`ringtone` 的 suspended 恢复；时长格式化                                             |
| 组件测            | `CallView` 四态（来电/呼出/通话中/最小化）+ 返回键拦截；`CallInviteModal` 选人上限                                                                  |
| MSW               | `/calls/ice-servers` 与 `/calls/:id` 四态（正常/空/错误/加载）                                                                                      |
| E2E（Playwright） | **mock 模式不建 WS 连接**（`useChatBootstrap.ts:457-460`），故 E2E 只能经 store 注入验 UI 层：来电弹层出现/接听/拒绝/最小化                         |

**真机与真后端实测（不只是单测）**

| 场景                      | 手段                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Web ↔ Web 1v1 语音 + 视频 | Playwright 双 context 打真后端，断言双向 `ontrack` 与 `connectionState=connected`                          |
| 强制 relay                | `iceTransportPolicy: "relay"` 跑一遍，证明 coturn 真的在中继（不是靠 host candidate 蒙混）                 |
| 桌面 Tauri                | **独立通话窗口**：主窗口收来电即开窗、窗口内接通、最小化置顶、关窗即挂断；CSP 违规 0 行、console 错误 0 行 |
| Android 模拟器 ↔ Web      | 跨端接通（TURN-TCP 经 adb reverse），验证前台服务通知、返回键语义、软键盘无冲突                            |
| 群通话                    | Web × 2 + 桌面 1 三方 mesh 接通，逐个离开时房间正确终结                                                    |
| 掉线鲁棒性                | 直接杀掉一端（关窗 / kill 进程），另一端应在秒级看到对方离场并正确终结                                     |
| 通话记录                  | 五种 result 各产一条系统消息，四语言渲染 + 会话列表预览为本地化 `[通话]`                                   |
| 生产构建                  | 产物零 `?.` / `??`（es2019 底线）                                                                          |

---

## 7. 搭车收口的既有债

| 债                                   | 处理                                                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `packages/design-system` 无 tsconfig | 本批要往它加 i18n key，顺手补 `tsconfig.json` + `typecheck` 脚本，`turbo typecheck` 从 8 包扩到 9 包                   |
| `edited_at` 两条出口序列化口径不一   | WS 帧走 `time.Now().UTC()`（纳秒 Z），REST 走 DB 回读（+08:00 微秒）。通话帧也要出时间戳，一次把口径统一为 UTC RFC3339 |

---

## 8. 风险

| 风险                                 | 缓解                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| **Linux WebKitGTK 的 WebRTC 不可用** | F0 spike 第一件事就验；不通则按平台隐藏入口，不阻塞其余部分（结论写回本文档 §3.11）       |
| Android 模拟器无真实摄像头           | AVD 已配 `hw.camera.front=emulated` + `hw.audioInput=yes`，模拟器给的是走样但可用的视频流 |
| coturn relay 端口在目标机被占        | ROADMAP 早已提醒"须避开 yuanai 占用"。本机 3478/5349 已实测空闲；部署时 `ss -lnup` 复核   |
| mesh 在 4 人时低端机发热             | 已按 §3.1 推算封顶；超 4 人直接不给入口                                                   |
| 60s 定时器是进程内的，多实例下不迁移 | 登记为债（§9）；Redis 2h TTL 是崩溃兜底                                                   |

---

## 9. 本批次主动留债（做完仍留在 MASTER_PLAN 清单）

| 级别 | 条目                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------- |
| 🟡   | **60s 振铃超时定时器是进程内 `time.AfterFunc`**：创建房间的实例挂掉后该房间不会被超时终结，只能等 Redis 2h TTL |
| 🟡   | **`SendToConn` 跨实例走降级路径**：目标连接不在本机时退回按 user 扇出 + 客户端过滤，同用户其他设备会收到无用帧 |
| ⚪   | **不做 SFU**（N2）：mesh 上限 4 人；超 4 人的群不给通话入口                                                    |
| ⚪   | **不做语音 ↔ 视频通话中升级**：需 renegotiation                                                                |
| ⚪   | **不做自适应码率 / 网络质量指示**：`maxBitrate` 固定，无 `getStats` 轮询与弱网提示                             |
| ⚪   | **不做屏幕共享 / 通话录制**                                                                                    |
| ⚪   | **通话不与 E2EE 联动**（N7）：无 DTLS 指纹签名，服务端理论上可 MITM 信令                                       |
| ⚪   | **通话记录不可撤回 / 不可编辑 / 不进搜索**：与既有系统消息一致                                                 |
| ⚪   | **E2E 无法覆盖真实信令**：mock 模式不建 WS，自动化只到 UI 层（与 ROADMAP F1 的"媒体流人工双端验证"一致）       |
| ⚪   | **桌面通话窗口独占一条 WS 连接**：通话期间该用户占 2 条（上限 5），配额与在线连接数指标会相应偏高              |
| ⚪   | **Web 端通话仍是页面内浮层**，不开新标签页（浏览器弹窗拦截 + 新标签页再建一条 WS，收益不抵成本）               |

---

## 10. 交付面清单

**后端**：`ws/protocol.go`（8 帧 + payload struct）、`ws/handler.go`（dispatch 4 分支）、
`ws/hub.go`（connID 索引 + `SendToConn` + 断连回调）、`ws/client.go`（connID 字段）、
`service/call_service.go`（新建，房间状态机 + 3 个 Lua + conn 反向索引）、
`handler/call.go`（新建，`ice-servers` + 房间快照）、
`router/router.go`（装配 + 路由）、`config/`（turn 段）、
`service/conversation_service.go`（`previewOf` 加 call 分支）

**前端（跨端共享）**：`shared/src/webrtc/{peerMesh,ringtone,iceServers}.ts`、`shared/src/store/callStore.ts`、
`shared/src/hooks/{useChatBootstrap,useCallSocket}.ts`、`shared/src/ws/chatSocket.ts`、
`shared/src/api/call.ts`、`shared/src/mocks/handlers.ts`、
`ui/src/{CallView,CallHost,CallInviteModal,callFormat}`、
`ui/src/{MainLayout,ChatWindow,Composer,ChatDetail,ContactDetail,MessageBubble}.tsx`、
`design-system/src/i18n/locales/*.json` ×4

**桌面端专属**：`apps/desktop/src/pages/CallWindowPage.tsx`（新建）、
`apps/desktop/src/hooks/useCallWindow.ts`（新建）、`apps/desktop/src/App.tsx`（`/call` 路由）、
`src-tauri/capabilities/default.json`（`"call"` 窗口 + `core:window:allow-set-always-on-top`）

**平台**：`src-tauri/src/lib.rs`、`gen/android/.../MainActivity.kt`、
`gen/android/.../CallForegroundService.kt`（新建）、`AndroidManifest.xml`

**部署与脚本**：`deploy/docker-compose.yml`、`deploy/docker-compose.prod.yml`、
`deploy/coturn/turnserver.conf`（新建）、`scripts/dev.mjs`、`deploy/env.md`

**文档**：`docs/CHAT_API.md`（8 帧 + 1 端点）、`docs/DEVELOPMENT.md`（gstreamer1.0-nice + coturn）、
`docs/ARCHITECTURE.md`、`docs/MASTER_PLAN.md`（清单状态 + 新债）、`docs/ROADMAP.md`、`AGENTS.md`
