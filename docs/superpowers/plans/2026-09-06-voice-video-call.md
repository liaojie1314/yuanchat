# 语音与视频通话（WebRTC）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给元聊补上 1v1 语音/视频通话与 ≤4 人群通话（mesh），信令走既有 WebSocket，媒体走 WebRTC + coturn 中继，通话记录以系统消息形态落进会话流。

**Architecture:** 服务端只做「不透明信令转发 + Redis 房间成员表」，永不接触媒体字节。房间是唯一模型，1v1 是 2 人房间的特例。Hub 增加连接级 ID 以支持点对点定址（`device_id` 在本仓是平台标签，恒为 `"web"`，不能用来区分设备）。桌面端（Tauri）通话开独立原生窗口并自建一条 WebSocket，成为房间里真正的参与者；Web/移动端为页面内浮层。

**Tech Stack:** Go 1.25（Gin + gorilla/websocket + go-redis v9 Lua）、React 19 + TypeScript + Zustand、Tauri 2（WebviewWindow / WebKitGTK / Android Kotlin）、coturn 4.7.0、Vitest + Playwright + miniredis。

**Spec:** [`docs/superpowers/specs/2026-09-06-voice-video-call-design.md`](../specs/2026-09-06-voice-video-call-design.md)

## Global Constraints

- **GitFlow**：本计划在 `feature/voice-video-call` 分支执行（已自 `dev @ 124c12b` 切出），完成后 `git merge --no-ff` 合回 `dev`，**禁止 squash**。禁止直接提交到 `dev` / `main`。
- **Commit 规范**：Conventional Commits `<type>(<scope>): <subject>`。完成一个完整功能点再提交，**禁止逐点提交**。**commit message 里禁止写版本号前缀**。
- **i18n**：所有用户可见文案禁止硬编码，走 `useTranslation` / `t()`，并在 `packages/design-system/src/i18n/locales/{zh-CN,en-US,ja-JP,ko-KR}.json` 四份同时补齐。插值占位符是 **`%{var}`**（Rails 风格），不是 `{{var}}`。`node scripts/check-i18n.mjs` 会挡下漏翻、写错 key 与死键（基准 key 必须在源码里以字面量出现）。
- **浏览器兼容**：`build.target=es2019`。禁止在产物里留 `?.` / `??` / `||=` / `replaceAll` / `.at()`。`globalThis` 须有 `typeof` 守卫。
- **圆角**：类名上限 `rounded-lg`（本仓 `lg`=16px），禁止 `xl`/`2xl`（`rounded-full` 圆形除外）。
- **rem 刻度**：`html` 根字号 **14px**，Tailwind rem 刻度缩水 14/16 —— `min-h-6`(1.5rem) 只有 21px。要精确 px 用方括号任意值（如 `min-h-[24px]`）。
- **注释/文档**：注释只能写中文，禁止写进度/批次。所有导出函数/组件/Store/Hook 必须写 JSDoc；Go 所有导出函数/包必须写 godoc。关键并发/事务/错误分支必须注释。
- **主题**：颜色工具类必须在色板内（`scripts/check-theme-classes.mjs` 门禁）。
- **Tauri 权限**：capabilities 权限名**禁止猜测**，必须在 `apps/desktop/src-tauri/gen/schemas/*-schema.json` 中核实存在。桌面专属权限进 `desktop.json`，移动专属进 `mobile.json`，跨平台才进 `default.json`。
- **依赖声明**：app 内 `import` 的包必须在该 app 的 `package.json` 里声明（本地提升会掩盖幽灵依赖）。
- **推送前本地 CI 全绿**：`node scripts/check-i18n.mjs`、`LANG=C.UTF-8 pnpm test`、`pnpm turbo typecheck`、`pnpm --filter @yuanchat/web test:e2e`、`server/` 下 `go vet ./...` + `go test ./...` + `go test -race ./internal/ws/`。本地跑前端测试必须 `LANG=C.UTF-8`（runner 无中文 locale，`navigator.language` 取自宿主 ICU）。
- **测试门禁**：功能未通过测试 = 未完成，不允许开始下一个功能。
- **契约**：新增服务端帧必须同时登记进 `contracts/server-frames.golden.json` 与 `ws/golden_server_frames_test.go` 的 `payloadPrototypes`，否则字段集比对测试直接失败。
- **启动命令**：一律走 `pnpm dev:*` / `pnpm build:pkg`，禁止手敲 docker / goose / go run / vite 底层命令。
- **实测纪律**：每段验证结束立即关停 dev 链路 / 模拟器 / 桌面 app；换端先停前一套。
- **不新增数据库迁移**：本批次无迁移（房间态在 Redis，通话记录复用 `messages` 的系统消息）。

---

## 文件结构

**新建**

| 文件                                                              | 职责                                             |
| ----------------------------------------------------------------- | ------------------------------------------------ |
| `server/internal/service/call_service.go`                         | 房间状态机、3 个 Lua、通话记录落库、ICE 凭据签发 |
| `server/internal/service/call_service_test.go`                    | Lua 原子语义 + 状态机单测（miniredis）           |
| `server/internal/handler/call.go`                                 | `GET /calls/ice-servers`、`GET /calls/:id`       |
| `server/internal/handler/call_test.go`                            | 两个端点的鉴权与响应形状                         |
| `server/internal/ws/call.go`                                      | 4 个 C→S 帧的 handler（`dispatch` 分支实现）     |
| `server/internal/ws/call_test.go`                                 | 信令帧序集成测                                   |
| `packages/shared/src/webrtc/peerMesh.ts`                          | PC 生命周期、glare 消解、ICE 队列、轨道增删      |
| `packages/shared/src/webrtc/ringtone.ts`                          | Web Audio 合成铃声 + 震动                        |
| `packages/shared/src/webrtc/iceServers.ts`                        | ICE 服务器拉取 + TTL 缓存                        |
| `packages/shared/src/store/callStore.ts`                          | 通话状态机（唯一真源）                           |
| `packages/shared/src/hooks/useCallSocket.ts`                      | 精简 bootstrap：只连 WS + 注册 4 个 call 帧      |
| `packages/shared/src/api/call.ts`                                 | 两个 REST 端点的客户端                           |
| `packages/ui/src/CallView.tsx`                                    | 通话主视图（来电/呼出/通话中三态）               |
| `packages/ui/src/CallHost.tsx`                                    | Web/移动端浮层宿主                               |
| `packages/ui/src/CallInviteModal.tsx`                             | 群通话选人（≤3）                                 |
| `packages/ui/src/callFormat.ts`                                   | 时长 `mm:ss` 与通话记录文案 key 映射             |
| `apps/desktop/src/pages/CallWindowPage.tsx`                       | 桌面通话窗口的 `/call` 路由页                    |
| `apps/desktop/src/hooks/useCallWindow.ts`                         | 主窗口侧：订阅 callStore 开/关窗口               |
| `apps/desktop/src-tauri/gen/android/.../CallForegroundService.kt` | Android 通话前台服务                             |
| `deploy/coturn/turnserver.dev.conf`                               | dev coturn 配置（**不**禁私网 peer）             |
| `deploy/coturn/turnserver.prod.conf`                              | prod coturn 配置（禁私网 peer + external-ip）    |

**修改**

`server/internal/ws/{protocol.go,hub.go,client.go,handler.go}`、`server/internal/router/router.go`、`server/internal/config/config.go`、`server/config/config.yaml`、`server/internal/service/conversation_service.go`、`packages/shared/src/ws/chatSocket.ts`、`packages/shared/src/hooks/useChatBootstrap.ts`、`packages/shared/src/mocks/handlers.ts`、`packages/shared/src/index.ts`、`packages/ui/src/{MainLayout,ChatWindow,Composer,ChatDetail,ContactDetail,MessageBubble}.tsx`、`packages/ui/src/index.ts`、`packages/design-system/src/i18n/locales/*.json`、`apps/desktop/src/App.tsx`、`apps/desktop/src-tauri/src/lib.rs`、`apps/desktop/src-tauri/capabilities/default.json`、`apps/desktop/src-tauri/gen/android/app/src/main/{AndroidManifest.xml,java/com/yuanchat/desktop/MainActivity.kt}`、`deploy/docker-compose.yml`、`deploy/docker-compose.prod.yml`、`scripts/dev.mjs`、`contracts/server-frames.golden.json`

---

## Stage A — 可行性与基建（阻塞项先行）

### Task 1: Linux WebKitGTK WebRTC 可行性 spike

**Files:**

- Modify: `apps/desktop/src-tauri/src/lib.rs:10-35`（`allow_microphone` → `allow_media`）
- Modify: `docs/superpowers/specs/2026-09-06-voice-video-call-design.md`（§3.11 写回实测结论）
- Modify: `docs/DEVELOPMENT.md`（宿主依赖新增 `gstreamer1.0-nice`）

**Interfaces:**

- Consumes: 无
- Produces: 结论「Linux 桌面端通话 可用 / 不可用」。不可用时 Task 17 需要加 `isLinuxDesktop()` 平台门控。

- [ ] **Step 1: 确认宿主依赖已装**

```bash
dpkg -l gstreamer1.0-nice 2>/dev/null | tail -1
ls /usr/lib/x86_64-linux-gnu/gstreamer-1.0/libgstnice.so
```

期望：两条都有输出。若缺失，**停下来告知用户执行 `sudo apt install gstreamer1.0-nice`** —— WebKitGTK 的 WebRTC 走 GstWebRTC，ICE 代理由这个插件提供，缺它 `RTCPeerConnection` 收集不到任何候选。

- [ ] **Step 2: 放开 WebKitGTK 的 WebRTC 与摄像头权限**

把 `lib.rs` 的 `allow_microphone` 改名为 `allow_media` 并扩权（调用点 `lib.rs:65` 同步改名）：

```rust
/// Linux（WebKitGTK）上放开麦克风与摄像头采集，并启用 WebRTC。
///
/// WebKitGTK 默认关闭 media-stream：`navigator.mediaDevices` 整个对象都不存在。
/// 它还从 2.38 起把 WebRTC 单独收在 `enable-webrtc` 开关后面，默认关闭 ——
/// 只开 media-stream 的话 getUserMedia 能过，`RTCPeerConnection` 却是 undefined。
/// 而且它不像浏览器自带授权气泡，不接 permission-request 信号的话请求默认被拒。
/// 采集的唯一入口是用户主动点「语音消息」或「通话」按钮，那一次点击即是授权。
///
/// @param window - 主窗口（需要拿到底层 WebKitWebView）
#[cfg(target_os = "linux")]
fn allow_media(window: &tauri::WebviewWindow) {
    use webkit2gtk::glib::prelude::*;
    use webkit2gtk::{
        PermissionRequestExt, SettingsExt, UserMediaPermissionRequest,
        UserMediaPermissionRequestExt, WebViewExt,
    };

    if let Err(e) = window.with_webview(|webview| {
        let view = webview.inner();
        if let Some(settings) = WebViewExt::settings(&view) {
            settings.set_enable_media_stream(true);
            settings.set_enable_webrtc(true);
        }
        view.connect_permission_request(|_, request| {
            match request.downcast_ref::<UserMediaPermissionRequest>() {
                Some(media) if media.is_for_audio_device() || media.is_for_video_device() => {
                    media.allow();
                    true
                }
                _ => false,
            }
        });
    }) {
        log::warn!("媒体权限放行失败，语音消息与通话将不可用: {e}");
    }
}
```

- [ ] **Step 3: 写一个一次性回环探针页**

在 `apps/desktop/src/` 下临时新建 `webrtcProbe.ts`（**spike 结束即删**），并在 `App.tsx` 里临时挂一个按钮调用它：

```ts
/** 一次性可行性探针：同页内建两条 PC 互连，验证 WebRTC 全链路可用。 */
export async function probeWebRTC(): Promise<string> {
  if (typeof RTCPeerConnection === "undefined") return "FAIL: RTCPeerConnection undefined";
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  const a = new RTCPeerConnection();
  const b = new RTCPeerConnection();
  stream.getTracks().forEach((t) => a.addTrack(t, stream));
  a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate);
  b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate);
  const gotTrack = new Promise<boolean>((res) => {
    b.ontrack = () => res(true);
    setTimeout(() => res(false), 8000);
  });
  await a.setLocalDescription(await a.createOffer());
  await b.setRemoteDescription(a.localDescription!);
  await b.setLocalDescription(await b.createAnswer());
  await a.setRemoteDescription(b.localDescription!);
  const ok = await gotTrack;
  const state = a.connectionState;
  stream.getTracks().forEach((t) => t.stop());
  a.close();
  b.close();
  return ok && state === "connected" ? `OK (${state})` : `FAIL (track=${ok} state=${state})`;
}
```

- [ ] **Step 4: 在真实 Tauri 窗口里跑探针**

```bash
pnpm dev:desktop
```

点按钮，读控制台输出。同时观察终端里 WebKit/GStreamer 的报错。

期望：`OK (connected)`。

- [ ] **Step 5: 把结论写回 spec §3.11**

- 若 `OK`：在 §3.11 末尾追加「**F0 实测结论（2026-09-06）**：webkit2gtk 2.50.4 + gstreamer1.0-nice 0.1.18 下回环探针 `OK (connected)`，Linux 桌面端全量支持通话」。
- 若 `FAIL`：记录**确切**的失败现象（`RTCPeerConnection` 是否存在、ICE 候选数量、GStreamer 报错原文）与已试手段，并在 §3.11 改写为「Linux 桌面端不支持，按平台隐藏入口」。**不允许「看起来应该能行」就当通过。**

同时在 `docs/DEVELOPMENT.md` 的 Linux 依赖清单里加一行 `gstreamer1.0-nice`（WebKitGTK 的 WebRTC ICE 代理）。

- [ ] **Step 6: 删除探针，提交**

删掉 `webrtcProbe.ts` 与 `App.tsx` 里的临时按钮。

```bash
git add apps/desktop/src-tauri/src/lib.rs docs/superpowers/specs/2026-09-06-voice-video-call-design.md docs/DEVELOPMENT.md
git commit -m "feat(call): Linux WebKitGTK 启用 WebRTC 并放行摄像头权限"
```

---

### Task 2: coturn 部署 + turn 配置段 + ICE 凭据端点

**Files:**

- Create: `deploy/coturn/turnserver.dev.conf`
- Create: `deploy/coturn/turnserver.prod.conf`
- Modify: `deploy/docker-compose.yml`（新增 coturn 服务）
- Modify: `deploy/docker-compose.prod.yml`（新增 coturn 服务）
- Modify: `server/config/config.yaml`（新增 `turn:` 段）
- Modify: `server/internal/config/config.go`（`TurnConfig` + `SetDefault`）
- Modify: `scripts/dev.mjs`（`REVERSE_PORTS` 加 3478）
- Modify: `docs/deploy/env.md`
- Test: `server/internal/config/config_test.go`（若不存在则创建）

**Interfaces:**

- Consumes: 无
- Produces: `config.TurnConfig{Enabled bool, Host string, Port int, Realm string, StaticAuthSecret string, CredentialTTL time.Duration}`，经 `cfg.Turn` 访问。

- [ ] **Step 1: 写 coturn 配置文件**

`deploy/coturn/turnserver.dev.conf`：

```conf
# 开发环境 TURN 配置。network_mode: host，直接绑宿主接口。
listening-port=3478
fingerprint
use-auth-secret
static-auth-secret=yuanchat-dev-turn-secret
realm=yuanchat
# relay 端口段：范围给窄，开发只会有个位数并发通话
min-port=49160
max-port=49200
# 开发环境刻意【不】禁私网 peer：Web/桌面/模拟器全在 127.0.0.1 与局域网段，
# 禁掉等于把开发环境自己的中继路径封死（生产配置里才禁，见 turnserver.prod.conf）
no-multicast-peers
no-cli
log-file=stdout
```

`deploy/coturn/turnserver.prod.conf`：

```conf
# 生产 TURN 配置。static-auth-secret 与 external-ip 由 install.sh 用 sed 注入。
listening-port=3478
fingerprint
use-auth-secret
static-auth-secret=__TURN_SECRET__
realm=__DOMAIN__
external-ip=__PUBLIC_IP__
min-port=49160
max-port=49200
# 禁止把中继指向内网：否则任何人都能拿 TURN 当跳板扫内网（SSRF 式滥用）
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
no-multicast-peers
no-tlsv1
no-tlsv1_1
total-quota=200
no-cli
log-file=stdout
```

- [ ] **Step 2: 加进两份 compose**

`deploy/docker-compose.yml` 的 `services:` 下追加（**镜像必须钉版本号，禁用 latest**）：

```yaml
coturn:
  image: coturn/coturn:4.7.0
  container_name: yuanchat-coturn
  restart: unless-stopped
  # host 网络：TURN relay 需要一整段 UDP 端口，bridge 模式下逐个发布既慢又易错。
  # 开发环境本就跑在本机，host 模式最贴近真实链路。
  network_mode: host
  volumes:
    - ./coturn/turnserver.dev.conf:/etc/coturn/turnserver.conf:ro
  command: ["-c", "/etc/coturn/turnserver.conf"]
```

`deploy/docker-compose.prod.yml` 的 `services:` 下追加：

```yaml
coturn:
  image: coturn/coturn:4.7.0
  container_name: yuanchat-coturn
  restart: unless-stopped
  ports:
    - "3478:3478/udp"
    - "3478:3478/tcp"
    - "49160-49200:49160-49200/udp"
  volumes:
    - ./coturn/turnserver.prod.conf:/etc/coturn/turnserver.conf:ro
  command: ["-c", "/etc/coturn/turnserver.conf"]
  networks:
    - yuanchat-net
```

- [ ] **Step 3: 加配置段**

`server/config/config.yaml` 末尾追加：

```yaml
# TURN/STUN（WebRTC 通话中继）。enabled=false 时 ice-servers 端点只返回 STUN 项。
turn:
  enabled: true
  # 客户端可达的主机名/IP —— 不是容器内网名（客户端解析不了）
  host: "localhost"
  port: 3478
  realm: "yuanchat"
  # 生产从 YUANCHAT_TURN_STATIC_AUTH_SECRET 下发；留空即等价于 enabled=false
  static_auth_secret: "yuanchat-dev-turn-secret"
  credential_ttl: 1h
```

`server/internal/config/config.go`：`Config` 结构体加 `Turn TurnConfig \`mapstructure:"turn"\``，并新增：

```go
// TurnConfig WebRTC 通话的 TURN/STUN 配置。
//
// StaticAuthSecret 与 coturn 的 use-auth-secret 模式共享同一个密钥：
// 服务端用它签发带过期时间的临时凭据，coturn 侧自行复算校验，双方都不建 TURN 用户表。
type TurnConfig struct {
	Enabled          bool          `mapstructure:"enabled"`
	Host             string        `mapstructure:"host"`
	Port             int           `mapstructure:"port"`
	Realm            string        `mapstructure:"realm"`
	StaticAuthSecret string        `mapstructure:"static_auth_secret"`
	CredentialTTL    time.Duration `mapstructure:"credential_ttl"`
}
```

在 `Load()` 里 `v.SetDefault("minio.public_use_ssl", false)` 之后追加：

```go
	// TURN 密钥与对外主机在生产只由环境变量下发。viper 的 AutomaticEnv 不会把
	// 未知 key 登记进 AllKeys，而 Unmarshal 只遍历 AllKeys —— 不显式 SetDefault
	// 就会被静默丢弃（minio.public_endpoint 踩过同一个坑）。
	v.SetDefault("turn.static_auth_secret", "")
	v.SetDefault("turn.host", "localhost")
```

- [ ] **Step 4: 写失败的配置测试**

`server/internal/config/config_test.go`：

```go
package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestLoadTurnFromEnv 钉住「turn 段可被环境变量覆盖」。
// 没有 SetDefault 时 viper 会静默丢弃这两个 key，本用例即是那道防线。
func TestLoadTurnFromEnv(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	body := "turn:\n  enabled: true\n  port: 3478\n  realm: yuanchat\n  credential_ttl: 1h\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("YUANCHAT_TURN_STATIC_AUTH_SECRET", "from-env")
	t.Setenv("YUANCHAT_TURN_HOST", "turn.example.com")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.Turn.StaticAuthSecret != "from-env" {
		t.Errorf("static_auth_secret = %q, want from-env", cfg.Turn.StaticAuthSecret)
	}
	if cfg.Turn.Host != "turn.example.com" {
		t.Errorf("host = %q, want turn.example.com", cfg.Turn.Host)
	}
	if cfg.Turn.CredentialTTL != time.Hour {
		t.Errorf("credential_ttl = %v, want 1h", cfg.Turn.CredentialTTL)
	}
}
```

- [ ] **Step 5: 运行测试确认失败**

```bash
cd server && go test ./internal/config/ -run TestLoadTurnFromEnv -v
```

Expected: FAIL —— `cfg.Turn` 字段不存在（编译错误）。

- [ ] **Step 6: 实现 Step 3 的改动后重跑**

```bash
cd server && go test ./internal/config/ -run TestLoadTurnFromEnv -v
```

Expected: PASS

- [ ] **Step 7: Android 端口转发 + 文档**

`scripts/dev.mjs` 的端口常量区（约 `:35-43`）：

```js
// 9002 是 docker 起的 MinIO，不进 SERVER_PORTS 以免 dev:stop 误杀；
// 3478 是 coturn 控制端口 —— 模拟器只能走 TURN over TCP（adb reverse 不转发 UDP），
// 没有这条转发，模拟器在 10.0.2.x NAT 后拿不到任何可用候选，通话必然打不通。
const REVERSE_PORTS = [...SERVER_PORTS, 9002, 3478];
```

`docs/deploy/env.md` 追加 `YUANCHAT_TURN_STATIC_AUTH_SECRET`、`YUANCHAT_TURN_HOST`、`YUANCHAT_TURN_REALM` 三项说明（必填/默认值/生成方式 `openssl rand -hex 32`）。

- [ ] **Step 8: 实际起 coturn 验证**

```bash
docker compose -f deploy/docker-compose.yml up -d coturn
docker logs yuanchat-coturn 2>&1 | tail -20
ss -lnup | grep 3478
```

Expected: 日志出现 `Listener opened on : 3478`，`ss` 能看到 3478/udp 在听。

- [ ] **Step 9: 提交**

```bash
git add deploy/coturn deploy/docker-compose.yml deploy/docker-compose.prod.yml \
        server/config/config.yaml server/internal/config/ scripts/dev.mjs docs/deploy/env.md
git commit -m "feat(call): 接入 coturn 并新增 turn 配置段与安卓端口转发"
```

---

## Stage B — 服务端信令

### Task 3: Hub 连接级定址与断连回调

**Files:**

- Modify: `server/internal/ws/client.go:16-26`（`Client` 加 `connID`）
- Modify: `server/internal/ws/hub.go`（`conns` 索引 + `SendToConn` + `disconnectNotifier`）
- Modify: `server/internal/ws/handler.go:154-162`（`ServeWS` 生成 connID）
- Test: `server/internal/ws/hub_test.go`（追加用例）

**Interfaces:**

- Consumes: 无
- Produces:
  - `(*Client).ConnID() uuid.UUID`
  - `(*Hub).SendToConn(connID uuid.UUID, data []byte) bool` —— 命中本机连接并成功入队返 true
  - `(*Hub).SetDisconnectNotifier(fn func(userID, connID uuid.UUID))` —— 连接断开时回调（锁外）

- [ ] **Step 1: 写失败的测试**

追加到 `server/internal/ws/hub_test.go`：

```go
// TestSendToConn 只投递给指定连接，同用户的其它连接收不到。
// device_id 在本仓是平台标签（登录固定写 "web"），多设备同值，
// 因此点对点信令只能按连接定址 —— 本用例钉住这个语义。
func TestSendToConn(t *testing.T) {
	hub := NewHub(0, zap.NewNop())
	uid := uuid.New()
	c1 := &Client{userID: uid, connID: uuid.New(), send: make(chan []byte, 4), hub: hub}
	c2 := &Client{userID: uid, connID: uuid.New(), send: make(chan []byte, 4), hub: hub}
	hub.Register(c1)
	hub.Register(c2)

	if ok := hub.SendToConn(c1.connID, []byte("x")); !ok {
		t.Fatal("SendToConn 应命中 c1")
	}
	if len(c1.send) != 1 {
		t.Errorf("c1 收到 %d 帧，期望 1", len(c1.send))
	}
	if len(c2.send) != 0 {
		t.Errorf("c2 收到 %d 帧，期望 0", len(c2.send))
	}
	if ok := hub.SendToConn(uuid.New(), []byte("x")); ok {
		t.Error("未知 connID 应返回 false")
	}
}

// TestDisconnectNotifier 连接摘除时回调带上 userID 与 connID。
// 通话房间靠它在拔网线/关窗口/杀进程时把参与者摘掉，
// 否则另一端会永远停在「通话中」，只能等 Redis TTL 到期。
func TestDisconnectNotifier(t *testing.T) {
	hub := NewHub(0, zap.NewNop())
	uid, cid := uuid.New(), uuid.New()
	got := make(chan [2]uuid.UUID, 1)
	hub.SetDisconnectNotifier(func(u, c uuid.UUID) { got <- [2]uuid.UUID{u, c} })

	c := &Client{userID: uid, connID: cid, send: make(chan []byte, 1), hub: hub}
	hub.Register(c)
	hub.Unregister(c)

	select {
	case v := <-got:
		if v[0] != uid || v[1] != cid {
			t.Errorf("回调参数 = %v，期望 (%v, %v)", v, uid, cid)
		}
	case <-time.After(time.Second):
		t.Fatal("断连回调未触发")
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd server && go test ./internal/ws/ -run 'TestSendToConn|TestDisconnectNotifier' -v
```

Expected: 编译失败 —— `connID` 字段与两个方法都不存在。

- [ ] **Step 3: 实现**

`client.go` 的 `Client` 结构体在 `deviceID` 下加：

```go
	// connID 本条连接的唯一标识。device_id 是平台标签（登录固定写 "web"），
	// 同一用户多设备同值，无法用于点对点定址；通话信令必须精确到某一条连接。
	connID uuid.UUID
```

并在文件末尾加：

```go
// ConnID 返回本条连接的唯一标识（通话信令的定址依据）。
func (c *Client) ConnID() uuid.UUID { return c.connID }
```

`hub.go` 的 `Hub` 结构体加：

```go
	// conns connID → 连接，供通话信令点对点定址
	conns map[uuid.UUID]*Client
	// disconnectNotifier 连接摘除时回调（锁外调用），通话房间据此清理掉线参与者
	disconnectNotifier func(userID, connID uuid.UUID)
```

`NewHub` 里初始化 `conns: make(map[uuid.UUID]*Client)`。
`Register` 在 `conns[c] = struct{}{}` 之后加 `h.conns[c.connID] = c`。
`Unregister` 在 `delete(conns, c)` 之后加 `delete(h.conns, c.connID)`，并在函数末尾（锁外、`presenceNotifier` 之后）加：

```go
	// 锁外回调：通话服务会反查 Redis，锁内调用会拖住整个 Hub
	if h.disconnectNotifier != nil {
		h.disconnectNotifier(c.userID, c.connID)
	}
```

新增两个方法：

```go
// SetDisconnectNotifier 注册连接断开回调（装配层在启动前调用一次）。
func (h *Hub) SetDisconnectNotifier(fn func(userID, connID uuid.UUID)) {
	h.disconnectNotifier = fn
}

// SendToConn 向指定连接投递一帧，返回是否命中本机连接并成功入队。
//
// 返回 false 有两种情形：连接不在本实例（多实例部署）、或该连接发送缓冲已满。
// 调用方（通话信令）在 false 时退回按用户扇出，由客户端凭 to_conn 自行过滤。
func (h *Hub) SendToConn(connID uuid.UUID, data []byte) bool {
	h.mu.RLock()
	c := h.conns[connID]
	h.mu.RUnlock()
	if c == nil {
		return false
	}
	select {
	case c.send <- data:
		metrics.WSMessagesTotal.WithLabelValues("send").Inc()
		return true
	default:
		h.logger.Warn("ws send buffer full, frame dropped",
			zap.String("conn_id", connID.String()))
		return false
	}
}
```

`handler.go` 的 `ServeWS` 里构造 `Client` 时加 `connID: uuid.New(),`。

- [ ] **Step 4: 运行测试确认通过**

```bash
cd server && go test ./internal/ws/ -run 'TestSendToConn|TestDisconnectNotifier' -v
cd server && go test -race ./internal/ws/
```

Expected: 全 PASS，`-race` 无告警。

- [ ] **Step 5: 提交**

```bash
git add server/internal/ws/
git commit -m "feat(ws): Hub 增加连接级定址与断连回调"
```

---

### Task 4: CallService —— Redis 房间状态机

**Files:**

- Create: `server/internal/service/call_service.go`
- Test: `server/internal/service/call_service_test.go`

**Interfaces:**

- Consumes: `*redis.Client`、`*zap.Logger`、`config.TurnConfig`
- Produces:

```go
type CallMedia string   // "audio" | "video"
type CallState string   // "ringing" | "active" | "ended"
type PartState string   // "invited" | "joined"
type EndReason string   // completed|rejected|canceled|timeout|busy|failed

type Participant struct {
    UserID uuid.UUID
    ConnID string      // invited 时为空串
    State  PartState
}
type Room struct {
    CallID, ConversationID, CallerID uuid.UUID
    Media      CallMedia
    State      CallState
    CreatedAt  time.Time
    AnsweredAt *time.Time
    Participants []Participant
}

func NewCallService(rdb *redis.Client, turn config.TurnConfig, logger *zap.Logger) *CallService
func (s *CallService) Create(ctx, callerID, callerConn, convID uuid.UUID, media CallMedia, invitees []uuid.UUID) (room *Room, skippedBusy []uuid.UUID, err error)
func (s *CallService) Join(ctx, callID, userID uuid.UUID, connID string) (*Room, error)
func (s *CallService) Leave(ctx, callID, userID uuid.UUID) (room *Room, ended bool, reason EndReason, duration int, err error)
func (s *CallService) Get(ctx, callID uuid.UUID) (*Room, error)
func (s *CallService) CallIDForConn(ctx context.Context, connID string) (uuid.UUID, uuid.UUID, bool)
func (s *CallService) ICEServers(userID uuid.UUID) ICEServersDTO

var ErrCallNotFound, ErrCallFull, ErrCallBusy error
```

- [ ] **Step 1: 写失败的测试**

`server/internal/service/call_service_test.go`：

```go
package service

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/config"
	"github.com/yuanchat/server/internal/testutil"
	"go.uber.org/zap"
)

func newCallSvc(t *testing.T) *CallService {
	t.Helper()
	rdb, _ := testutil.NewRedis(t)
	return NewCallService(rdb, config.TurnConfig{
		Enabled: true, Host: "turn.test", Port: 3478,
		Realm: "yuanchat", StaticAuthSecret: "s3cret", CredentialTTL: time.Hour,
	}, zap.NewNop())
}

// TestCreateThenJoinActivates 两人齐了房间才进 active，并记下应答时刻。
func TestCreateThenJoinActivates(t *testing.T) {
	s := newCallSvc(t)
	ctx := context.Background()
	caller, callee, conv := uuid.New(), uuid.New(), uuid.New()

	room, skipped, err := s.Create(ctx, caller, "conn-a", conv, CallMediaAudio, []uuid.UUID{callee})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if len(skipped) != 0 {
		t.Fatalf("skipped = %v, want empty", skipped)
	}
	if room.State != CallStateRinging {
		t.Fatalf("state = %s, want ringing", room.State)
	}

	joined, err := s.Join(ctx, room.CallID, callee, "conn-b")
	if err != nil {
		t.Fatalf("join: %v", err)
	}
	if joined.State != CallStateActive {
		t.Errorf("state = %s, want active", joined.State)
	}
	if joined.AnsweredAt == nil {
		t.Error("answered_at 应已写入")
	}
}

// TestBusyRejectsSecondCall 已在通话中的人不会被第二通电话拉进来。
// 这条必须靠 Lua 原子性：先读后写的实现下两个来电会双双成功。
func TestBusyRejectsSecondCall(t *testing.T) {
	s := newCallSvc(t)
	ctx := context.Background()
	a, b, c := uuid.New(), uuid.New(), uuid.New()

	r1, _, err := s.Create(ctx, a, "conn-a", uuid.New(), CallMediaAudio, []uuid.UUID{b})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Join(ctx, r1.CallID, b, "conn-b"); err != nil {
		t.Fatal(err)
	}

	// b 已忙线：c 呼 b 时 b 应出现在 skipped 里
	_, skipped, err := s.Create(ctx, c, "conn-c", uuid.New(), CallMediaAudio, []uuid.UUID{b})
	if err != nil {
		t.Fatal(err)
	}
	if len(skipped) != 1 || skipped[0] != b {
		t.Errorf("skipped = %v, want [%v]", skipped, b)
	}
}

// TestConcurrentJoinOnlyOnceCounted 同一用户多设备并发接听只占一个位置。
func TestConcurrentJoinOnlyOnceCounted(t *testing.T) {
	s := newCallSvc(t)
	ctx := context.Background()
	caller, callee := uuid.New(), uuid.New()
	room, _, err := s.Create(ctx, caller, "conn-a", uuid.New(), CallMediaAudio, []uuid.UUID{callee})
	if err != nil {
		t.Fatal(err)
	}

	done := make(chan error, 8)
	for i := 0; i < 8; i++ {
		go func(i int) {
			_, e := s.Join(ctx, room.CallID, callee, "conn-"+string(rune('A'+i)))
			done <- e
		}(i)
	}
	for i := 0; i < 8; i++ {
		if e := <-done; e != nil {
			t.Fatalf("并发 join 不应失败: %v", e)
		}
	}
	got, err := s.Get(ctx, room.CallID)
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, p := range got.Participants {
		if p.State == PartStateJoined {
			n++
		}
	}
	if n != 2 {
		t.Errorf("joined 数 = %d，期望 2（caller + callee 各一）", n)
	}
}

// TestLeaveEndsRoomWhenFewerThanTwo 剩余 joined < 2 即终结房间并算出时长。
func TestLeaveEndsRoomWhenFewerThanTwo(t *testing.T) {
	s := newCallSvc(t)
	ctx := context.Background()
	caller, callee := uuid.New(), uuid.New()
	room, _, _ := s.Create(ctx, caller, "conn-a", uuid.New(), CallMediaAudio, []uuid.UUID{callee})
	if _, err := s.Join(ctx, room.CallID, callee, "conn-b"); err != nil {
		t.Fatal(err)
	}

	_, ended, reason, _, err := s.Leave(ctx, room.CallID, callee)
	if err != nil {
		t.Fatal(err)
	}
	if !ended {
		t.Fatal("两人房间走掉一个应终结")
	}
	if reason != EndCompleted {
		t.Errorf("reason = %s, want completed", reason)
	}
	if _, err := s.Get(ctx, room.CallID); err != ErrCallNotFound {
		t.Errorf("终结后 Get 应返回 ErrCallNotFound，得到 %v", err)
	}
}

// TestLeaveBeforeAnswerIsCanceled 主叫在振铃期挂断 = canceled（不是 completed）。
func TestLeaveBeforeAnswerIsCanceled(t *testing.T) {
	s := newCallSvc(t)
	ctx := context.Background()
	caller := uuid.New()
	room, _, _ := s.Create(ctx, caller, "conn-a", uuid.New(), CallMediaAudio, []uuid.UUID{uuid.New()})

	_, ended, reason, dur, err := s.Leave(ctx, room.CallID, caller)
	if err != nil {
		t.Fatal(err)
	}
	if !ended || reason != EndCanceled || dur != 0 {
		t.Errorf("ended=%v reason=%s dur=%d，期望 true/canceled/0", ended, reason, dur)
	}
}

// TestCallIDForConn 连接反向索引：断连时靠它一次查到房间，不必遍历。
func TestCallIDForConn(t *testing.T) {
	s := newCallSvc(t)
	ctx := context.Background()
	caller := uuid.New()
	room, _, _ := s.Create(ctx, caller, "conn-a", uuid.New(), CallMediaAudio, nil)

	gotCall, gotUser, ok := s.CallIDForConn(ctx, "conn-a")
	if !ok || gotCall != room.CallID || gotUser != caller {
		t.Errorf("= (%v,%v,%v)，期望 (%v,%v,true)", gotCall, gotUser, ok, room.CallID, caller)
	}
	if _, _, ok := s.CallIDForConn(ctx, "nope"); ok {
		t.Error("未知 conn 应返回 false")
	}
}

// TestICEServersHMAC 凭据按 coturn REST 口径签发：username=<expiry>:<uid>，
// credential=base64(HMAC-SHA1(secret, username))。
func TestICEServersHMAC(t *testing.T) {
	s := newCallSvc(t)
	uid := uuid.New()
	dto := s.ICEServers(uid)
	if len(dto.ICEServers) != 2 {
		t.Fatalf("应有 STUN + TURN 两项，得到 %d", len(dto.ICEServers))
	}
	turn := dto.ICEServers[1]
	parts := strings.SplitN(turn.Username, ":", 2)
	if len(parts) != 2 || parts[1] != uid.String() {
		t.Fatalf("username = %q，期望 <expiry>:%s", turn.Username, uid)
	}
	mac := hmac.New(sha1.New, []byte("s3cret"))
	mac.Write([]byte(turn.Username))
	want := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	if turn.Credential != want {
		t.Errorf("credential = %q, want %q", turn.Credential, want)
	}
}

// TestICEServersDisabled 关掉 TURN 时只回 STUN，不泄露空凭据。
func TestICEServersDisabled(t *testing.T) {
	rdb, _ := testutil.NewRedis(t)
	s := NewCallService(rdb, config.TurnConfig{Enabled: false, Host: "h", Port: 3478}, zap.NewNop())
	dto := s.ICEServers(uuid.New())
	if len(dto.ICEServers) != 1 {
		t.Fatalf("应只有 STUN 一项，得到 %d", len(dto.ICEServers))
	}
}
```

（`import` 里需补 `crypto/hmac`、`crypto/sha1`、`encoding/base64`、`strings`。）

- [ ] **Step 2: 运行测试确认失败**

```bash
cd server && go test ./internal/service/ -run 'TestCreateThenJoin|TestBusy|TestConcurrentJoin|TestLeave|TestCallIDForConn|TestICEServers' -v
```

Expected: 编译失败 —— `call_service.go` 尚不存在。

- [ ] **Step 3: 实现 `call_service.go` —— 类型与 Lua**

```go
package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/yuanchat/server/internal/config"
	"go.uber.org/zap"
)

// CallMedia 通话媒体形态。
type CallMedia string

// CallState 房间状态。ended 是终结中的短暂过渡态，用于挡住「离开与销毁之间挤进来的 join」。
type CallState string

// PartState 参与者在房间里的状态。
type PartState string

// EndReason 通话终结原因，由服务端按房间状态推导，客户端不上报。
type EndReason string

const (
	CallMediaAudio CallMedia = "audio"
	CallMediaVideo CallMedia = "video"

	CallStateRinging CallState = "ringing"
	CallStateActive  CallState = "active"
	CallStateEnded   CallState = "ended"

	PartStateInvited PartState = "invited"
	PartStateJoined  PartState = "joined"

	EndCompleted EndReason = "completed"
	EndRejected  EndReason = "rejected"
	EndCanceled  EndReason = "canceled"
	EndTimeout   EndReason = "timeout"
	EndBusy      EndReason = "busy"
	EndFailed    EndReason = "failed"
)

// MaxCallParticipants mesh 全连接的人数上限。
//
// 4 人时每端 3 条上行（视频 360p 约 1.5Mbps）、解码 3 路，旧 Android WebView 可承受；
// 6 人就是 5 条上行 + 5 路解码，低端机发热掉帧。上调这个数之前先换 SFU。
const MaxCallParticipants = 4

// callTTL 房间键的存活上限，纯属崩溃兜底 —— 正常终结走 Leave 主动删除。
const callTTL = 2 * time.Hour

// RingTimeout 无人应答的最长振铃时间。
const RingTimeout = 60 * time.Second

var (
	ErrCallNotFound = errors.New("call not found")
	ErrCallFull     = errors.New("call room is full")
	ErrCallBusy     = errors.New("user is busy in another call")
)

func roomKey(id uuid.UUID) string  { return "call:room:" + id.String() }
func partsKey(id uuid.UUID) string { return "call:room:" + id.String() + ":p" }
func busyKey(id uuid.UUID) string  { return "call:busy:" + id.String() }
func connKey(conn string) string   { return "call:conn:" + conn }

// 参与者值编码为 "connID|state"，刻意不用 cjson：Lua 侧只需按后缀判断状态，
// 字符串切分比 JSON 编解码少一层依赖，也不受 Redis 实现差异影响。
func encodePart(conn string, st PartState) string { return conn + "|" + string(st) }

func decodePart(v string) (string, PartState) {
	i := strings.LastIndex(v, "|")
	if i < 0 {
		return "", PartStateInvited
	}
	return v[:i], PartState(v[i+1:])
}
```

- [ ] **Step 4: 实现三个 Lua 脚本**

```go
// callCreate 原子建房。
//
// 必须原子：忙线判定与写入分成两步的话，两个人同时呼同一个目标会双双通过，
// 被叫端弹出两个来电。
//
// KEYS[1]=room KEYS[2]=parts KEYS[3]=caller busy KEYS[4]=caller conn
// KEYS[5..]=每个 invitee 的 busy 键（与 ARGV[8..] 一一对应）
// ARGV: 1=call_id 2=conversation_id 3=media 4=caller_id 5=caller_conn
//       6=now(unix) 7=ttl(秒) 8..=invitee user id
// 返回 -1=主叫忙线；否则返回被跳过（忙线）的 invitee id 列表
var callCreate = redis.NewScript(`
if redis.call('EXISTS', KEYS[3]) == 1 then return -1 end
redis.call('HSET', KEYS[1], 'conversation_id', ARGV[2], 'media', ARGV[3],
  'caller_id', ARGV[4], 'state', 'ringing', 'created_at', ARGV[6], 'answered_at', '')
redis.call('EXPIRE', KEYS[1], ARGV[7])
redis.call('HSET', KEYS[2], ARGV[4], ARGV[5] .. '|joined')
redis.call('EXPIRE', KEYS[2], ARGV[7])
redis.call('SET', KEYS[3], ARGV[1], 'EX', ARGV[7])
redis.call('SET', KEYS[4], ARGV[1] .. '|' .. ARGV[4], 'EX', ARGV[7])
local skipped = {}
for i = 8, #ARGV do
  local bkey = KEYS[5 + (i - 8)]
  if redis.call('EXISTS', bkey) == 1 then
    table.insert(skipped, ARGV[i])
  else
    redis.call('HSET', KEYS[2], ARGV[i], '|invited')
  end
end
return skipped
`)

// callJoin 原子入房。
//
// 必须原子：同一用户多设备并发接听时，「查人数 → 判满 → 写入」的非原子实现
// 会让两台设备都写进去，房间瞬间超员。
//
// KEYS[1]=room KEYS[2]=parts KEYS[3]=user busy KEYS[4]=user conn
// ARGV: 1=user_id 2=conn_id 3=call_id 4=now 5=ttl 6=max
// 返回 {code, state, answered_at}；code 0=ok 1=房间不存在/已终结 2=满员 3=忙于别的通话
var callJoin = redis.NewScript(`
if redis.call('EXISTS', KEYS[1]) == 0 then return {1, '', ''} end
if redis.call('HGET', KEYS[1], 'state') == 'ended' then return {1, '', ''} end
local busy = redis.call('GET', KEYS[3])
if busy and busy ~= ARGV[3] then return {3, '', ''} end
local cur = redis.call('HGET', KEYS[2], ARGV[1])
local function countJoined()
  local n = 0
  local all = redis.call('HGETALL', KEYS[2])
  for i = 2, #all, 2 do
    if string.sub(all[i], -6) == 'joined' then n = n + 1 end
  end
  return n
end
if not cur or string.sub(cur, -6) ~= 'joined' then
  if countJoined() >= tonumber(ARGV[6]) then return {2, '', ''} end
end
redis.call('SET', KEYS[3], ARGV[3], 'EX', ARGV[5])
redis.call('SET', KEYS[4], ARGV[3] .. '|' .. ARGV[1], 'EX', ARGV[5])
redis.call('HSET', KEYS[2], ARGV[1], ARGV[2] .. '|joined')
redis.call('EXPIRE', KEYS[2], ARGV[5])
local st = redis.call('HGET', KEYS[1], 'state')
local at = redis.call('HGET', KEYS[1], 'answered_at')
if st == 'ringing' and countJoined() >= 2 then
  redis.call('HSET', KEYS[1], 'state', 'active', 'answered_at', ARGV[4])
  st = 'active'
  at = ARGV[4]
end
redis.call('EXPIRE', KEYS[1], ARGV[5])
return {0, st, at or ''}
`)

// callLeave 原子离房，并在剩余 joined < 2 时把房间打上 ended 标记。
//
// 打标记而不是直接删：删除后到 Go 侧清理完 busy 之间有个窗口，
// 若此时有人 join 会建出一个「幽灵房间」。ended 态让 callJoin 直接拒绝。
//
// KEYS[1]=room KEYS[2]=parts KEYS[3]=离开者 busy
// ARGV[1]=user_id
// 返回 {ended, state, answered_at, caller_id, conversation_id, media, 剩余 user_id...}
var callLeave = redis.NewScript(`
if redis.call('EXISTS', KEYS[1]) == 0 then return {0,'','','','',''} end
redis.call('HDEL', KEYS[2], ARGV[1])
redis.call('DEL', KEYS[3])
local st = redis.call('HGET', KEYS[1], 'state')
local out = {0, st, redis.call('HGET', KEYS[1], 'answered_at') or '',
  redis.call('HGET', KEYS[1], 'caller_id') or '',
  redis.call('HGET', KEYS[1], 'conversation_id') or '',
  redis.call('HGET', KEYS[1], 'media') or ''}
local n, rest = 0, {}
local all = redis.call('HGETALL', KEYS[2])
for i = 1, #all, 2 do
  table.insert(rest, all[i])
  if string.sub(all[i + 1], -6) == 'joined' then n = n + 1 end
end
if n < 2 then
  out[1] = 1
  redis.call('HSET', KEYS[1], 'state', 'ended')
  for _, uid in ipairs(rest) do table.insert(out, uid) end
end
return out
`)
```

- [ ] **Step 5: 实现 Go 方法**

```go
// CallService 管理通话房间的生命周期。
//
// 房间态全部落 Redis：进程内 map 会在多实例部署下各存一份，
// 且进程重启即丢掉全部进行中的通话。
type CallService struct {
	rdb    *redis.Client
	turn   config.TurnConfig
	logger *zap.Logger
}

// NewCallService 构造通话服务。
func NewCallService(rdb *redis.Client, turn config.TurnConfig, logger *zap.Logger) *CallService {
	return &CallService{rdb: rdb, turn: turn, logger: logger}
}

// Create 建房并邀请。返回房间快照与被跳过的忙线 invitee。
// 主叫本人忙线时返回 ErrCallBusy。
func (s *CallService) Create(
	ctx context.Context, callerID uuid.UUID, callerConn string,
	convID uuid.UUID, media CallMedia, invitees []uuid.UUID,
) (*Room, []uuid.UUID, error) {
	callID := uuid.New()
	now := time.Now().UTC()
	keys := []string{roomKey(callID), partsKey(callID), busyKey(callerID), connKey(callerConn)}
	args := []any{callID.String(), convID.String(), string(media), callerID.String(),
		callerConn, now.Unix(), int(callTTL.Seconds())}
	for _, id := range invitees {
		keys = append(keys, busyKey(id))
		args = append(args, id.String())
	}
	res, err := callCreate.Run(ctx, s.rdb, keys, args...).Result()
	if err != nil {
		return nil, nil, fmt.Errorf("call create: %w", err)
	}
	if n, ok := res.(int64); ok && n == -1 {
		return nil, nil, ErrCallBusy
	}
	skipped := make([]uuid.UUID, 0)
	if list, ok := res.([]any); ok {
		for _, v := range list {
			if id, err := uuid.Parse(fmt.Sprint(v)); err == nil {
				skipped = append(skipped, id)
			}
		}
	}
	room, err := s.Get(ctx, callID)
	if err != nil {
		return nil, nil, err
	}
	return room, skipped, nil
}

// Join 让 userID 以 connID 这条连接加入房间。
// 群通话的「主动加入」复用本方法 —— 会话成员校验在 ws 层做，这里只管房间容量与忙线。
func (s *CallService) Join(ctx context.Context, callID, userID uuid.UUID, connID string) (*Room, error) {
	res, err := callJoin.Run(ctx, s.rdb,
		[]string{roomKey(callID), partsKey(callID), busyKey(userID), connKey(connID)},
		userID.String(), connID, callID.String(),
		time.Now().UTC().Unix(), int(callTTL.Seconds()), MaxCallParticipants,
	).Slice()
	if err != nil {
		return nil, fmt.Errorf("call join: %w", err)
	}
	switch toInt(res[0]) {
	case 1:
		return nil, ErrCallNotFound
	case 2:
		return nil, ErrCallFull
	case 3:
		return nil, ErrCallBusy
	}
	return s.Get(ctx, callID)
}

// Leave 让 userID 离开房间。剩余 joined < 2 时终结房间并推导终结原因。
//
// 返回的 room 是【离开前】的快照：终结时要用它给全体成员发 call.ended，
// 而此时 Redis 里的房间已被删掉。
func (s *CallService) Leave(
	ctx context.Context, callID, userID uuid.UUID,
) (*Room, bool, EndReason, int, error) {
	before, err := s.Get(ctx, callID)
	if err != nil {
		return nil, false, "", 0, err
	}
	res, err := callLeave.Run(ctx, s.rdb,
		[]string{roomKey(callID), partsKey(callID), busyKey(userID)},
		userID.String(),
	).Slice()
	if err != nil {
		return nil, false, "", 0, fmt.Errorf("call leave: %w", err)
	}
	if toInt(res[0]) == 0 {
		return before, false, "", 0, nil
	}

	state := CallState(fmt.Sprint(res[1]))
	answeredAt := parseUnix(fmt.Sprint(res[2]))
	duration := 0
	reason := EndCanceled
	switch {
	case state == CallStateActive && answeredAt != nil:
		reason = EndCompleted
		duration = int(time.Since(*answeredAt).Seconds())
	case userID == before.CallerID:
		reason = EndCanceled
	default:
		// 振铃期间被叫离开 = 拒接（call.answer{accept:false} 也走这条路径）
		reason = EndRejected
	}

	// 清理：房间、参与者表、剩余成员的 busy 与连接索引
	del := []string{roomKey(callID), partsKey(callID)}
	for _, v := range res[6:] {
		if id, err := uuid.Parse(fmt.Sprint(v)); err == nil {
			del = append(del, busyKey(id))
		}
	}
	for _, p := range before.Participants {
		if p.ConnID != "" {
			del = append(del, connKey(p.ConnID))
		}
	}
	if err := s.rdb.Del(ctx, del...).Err(); err != nil {
		s.logger.Warn("清理通话房间键失败", zap.Error(err), zap.String("call_id", callID.String()))
	}
	return before, true, reason, duration, nil
}

// EndWithReason 以指定原因强制终结房间（振铃超时、全员忙线）。
func (s *CallService) EndWithReason(
	ctx context.Context, callID uuid.UUID, reason EndReason,
) (*Room, bool, error) {
	room, err := s.Get(ctx, callID)
	if err != nil {
		return nil, false, err
	}
	if room.State == CallStateActive {
		return room, false, nil // 已接通，不该被超时终结
	}
	del := []string{roomKey(callID), partsKey(callID)}
	for _, p := range room.Participants {
		del = append(del, busyKey(p.UserID))
		if p.ConnID != "" {
			del = append(del, connKey(p.ConnID))
		}
	}
	if err := s.rdb.Del(ctx, del...).Err(); err != nil {
		return nil, false, err
	}
	return room, true, nil
}

// Get 读房间快照。房间不存在或已进入 ended 过渡态时返回 ErrCallNotFound。
func (s *CallService) Get(ctx context.Context, callID uuid.UUID) (*Room, error) {
	h, err := s.rdb.HGetAll(ctx, roomKey(callID)).Result()
	if err != nil {
		return nil, err
	}
	if len(h) == 0 || h["state"] == string(CallStateEnded) {
		return nil, ErrCallNotFound
	}
	parts, err := s.rdb.HGetAll(ctx, partsKey(callID)).Result()
	if err != nil {
		return nil, err
	}
	room := &Room{
		CallID:    callID,
		Media:     CallMedia(h["media"]),
		State:     CallState(h["state"]),
		CreatedAt: derefTime(parseUnix(h["created_at"])),
	}
	room.ConversationID, _ = uuid.Parse(h["conversation_id"])
	room.CallerID, _ = uuid.Parse(h["caller_id"])
	room.AnsweredAt = parseUnix(h["answered_at"])
	for uidStr, v := range parts {
		id, err := uuid.Parse(uidStr)
		if err != nil {
			continue
		}
		conn, st := decodePart(v)
		room.Participants = append(room.Participants, Participant{UserID: id, ConnID: conn, State: st})
	}
	return room, nil
}

// CallIDForConn 由连接反查其所属通话与所属用户（断连清理用）。
func (s *CallService) CallIDForConn(ctx context.Context, connID string) (uuid.UUID, uuid.UUID, bool) {
	v, err := s.rdb.Get(ctx, connKey(connID)).Result()
	if err != nil || v == "" {
		return uuid.Nil, uuid.Nil, false
	}
	i := strings.Index(v, "|")
	if i < 0 {
		return uuid.Nil, uuid.Nil, false
	}
	callID, err1 := uuid.Parse(v[:i])
	userID, err2 := uuid.Parse(v[i+1:])
	if err1 != nil || err2 != nil {
		return uuid.Nil, uuid.Nil, false
	}
	return callID, userID, true
}

func toInt(v any) int64 {
	if n, ok := v.(int64); ok {
		return n
	}
	n, _ := strconv.ParseInt(fmt.Sprint(v), 10, 64)
	return n
}

func parseUnix(s string) *time.Time {
	if s == "" {
		return nil
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil || n == 0 {
		return nil
	}
	t := time.Unix(n, 0).UTC()
	return &t
}

func derefTime(t *time.Time) time.Time {
	if t == nil {
		return time.Time{}
	}
	return *t
}
```

- [ ] **Step 6: 实现 ICE 凭据签发**

```go
// ICEServer 一组 ICE 服务器配置（RTCIceServer 的 JSON 形状）。
type ICEServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

// ICEServersDTO ice-servers 端点的响应体。
type ICEServersDTO struct {
	ICEServers []ICEServer `json:"ice_servers"`
	TTL        int         `json:"ttl"`
}

// ICEServers 按 coturn 的 use-auth-secret（REST API）口径签发临时凭据。
//
// username = "<过期unix时间戳>:<用户ID>"，credential = base64(HMAC-SHA1(密钥, username))。
// coturn 侧用同一密钥复算校验，因此双方都不需要 TURN 用户表，凭据自带过期时间。
// HMAC-SHA1 是该协议规定的算法，不是安全强度上的选择。
func (s *CallService) ICEServers(userID uuid.UUID) ICEServersDTO {
	ttl := s.turn.CredentialTTL
	if ttl <= 0 {
		ttl = time.Hour
	}
	out := ICEServersDTO{
		ICEServers: []ICEServer{{URLs: []string{fmt.Sprintf("stun:%s:%d", s.turn.Host, s.turn.Port)}}},
		TTL:        int(ttl.Seconds()),
	}
	if !s.turn.Enabled || s.turn.StaticAuthSecret == "" {
		return out
	}
	username := fmt.Sprintf("%d:%s", time.Now().Add(ttl).Unix(), userID)
	mac := hmac.New(sha1.New, []byte(s.turn.StaticAuthSecret))
	mac.Write([]byte(username))
	out.ICEServers = append(out.ICEServers, ICEServer{
		URLs: []string{
			fmt.Sprintf("turn:%s:%d?transport=udp", s.turn.Host, s.turn.Port),
			fmt.Sprintf("turn:%s:%d?transport=tcp", s.turn.Host, s.turn.Port),
		},
		Username:   username,
		Credential: base64.StdEncoding.EncodeToString(mac.Sum(nil)),
	})
	return out
}
```

- [ ] **Step 7: 运行测试确认通过**

```bash
cd server && go test ./internal/service/ -run 'TestCreateThenJoin|TestBusy|TestConcurrentJoin|TestLeave|TestCallIDForConn|TestICEServers' -v
cd server && go test -race ./internal/service/ -run 'TestConcurrentJoin'
```

Expected: 全 PASS，`-race` 无告警。

- [ ] **Step 8: 提交**

```bash
git add server/internal/service/call_service.go server/internal/service/call_service_test.go
git commit -m "feat(call): 通话房间状态机（Redis Lua 原子建房/入房/离房 + ICE 凭据签发）"
```

---

### Task 5: WS 信令帧与 golden 契约

**Files:**

- Modify: `server/internal/ws/protocol.go`（8 个帧常量 + 5 个 payload struct）
- Create: `server/internal/ws/call.go`
- Modify: `server/internal/ws/handler.go:183-203`（dispatch 加 4 分支）+ `:34-51`（Handler 加 callSvc 与回调）
- Modify: `contracts/server-frames.golden.json`
- Modify: `server/internal/ws/golden_server_frames_test.go:56-69, 76-81`
- Test: `server/internal/ws/call_test.go`

**Interfaces:**

- Consumes: Task 3 的 `SendToConn` / `SetDisconnectNotifier`；Task 4 的 `CallService`
- Produces:
  - `(*Handler).SetCallService(svc *service.CallService, onEnd func(ctx, room *service.Room, reason service.EndReason, duration int))`
  - `(*Handler).HandleDisconnect(userID, connID uuid.UUID)` —— 交给 `Hub.SetDisconnectNotifier`
  - `(*Handler).SetConversationMembers(fn func(ctx context.Context, userID, convID uuid.UUID) ([]uuid.UUID, error))` —— 成员校验注入

- [ ] **Step 1: 加帧常量与 payload struct**

`protocol.go` 的 C→S 常量块加：

```go
	TypeCallInvite = "call.invite"
	TypeCallAnswer = "call.answer"
	TypeCallLeave  = "call.leave"
	// TypeCallSignal 双向同名帧：客户端发出时带 to_conn，服务端转发时改带 from_conn。
	// 与既有的 message.read / typing 双向同名帧同一惯例。
	TypeCallSignal = "call.signal"
```

S→C 常量块加：

```go
	TypeCallIncoming = "call.incoming"
	TypeCallState    = "call.state"
	TypeCallEnded    = "call.ended"
```

payload struct（放在 `MessageEditedPayload` 之后）：

```go
// CallParticipant 通话房间里的一名参与者。
// ConnID 在 state=invited（尚未接听）时为空串。
type CallParticipant struct {
	UserID    uuid.UUID `json:"user_id"`
	ConnID    string    `json:"conn_id"`
	Nickname  string    `json:"nickname"`
	AvatarURL *string   `json:"avatar_url,omitempty"`
	State     string    `json:"state"` // invited | joined
}

// CallInvitePayload 客户端发起通话。
// 单聊时 InviteeIDs 可省略（服务端取会话另一方）；群聊时最多 3 人（房间上限 4）。
type CallInvitePayload struct {
	ConversationID uuid.UUID   `json:"conversation_id"`
	Media          string      `json:"media"` // audio | video
	InviteeIDs     []uuid.UUID `json:"invitee_ids,omitempty"`
}

// CallAnswerPayload 接听或拒绝。群通话的「主动加入」复用 Accept=true。
type CallAnswerPayload struct {
	CallID uuid.UUID `json:"call_id"`
	Accept bool      `json:"accept"`
}

// CallLeavePayload 离开房间（挂断 / 取消 / 退出同一语义）。
type CallLeavePayload struct {
	CallID uuid.UUID `json:"call_id"`
}

// CallSignalPayload SDP / ICE 转发。
//
// Data 保持 json.RawMessage：服务端不理解也不需要理解 WebRTC 协商内容，
// 解析它只会在协议演进时逼着服务端跟着改版本。
// 客户端上行填 ToConn，服务端下行填 FromConn / FromUser。
type CallSignalPayload struct {
	CallID   uuid.UUID       `json:"call_id"`
	ToConn   string          `json:"to_conn,omitempty"`
	FromConn string          `json:"from_conn,omitempty"`
	FromUser *uuid.UUID      `json:"from_user,omitempty"`
	Data     json.RawMessage `json:"data"`
}

// CallIncomingPayload 来电推送，推给被邀请者的全部设备。
type CallIncomingPayload struct {
	CallID         uuid.UUID         `json:"call_id"`
	ConversationID uuid.UUID         `json:"conversation_id"`
	Media          string            `json:"media"`
	Caller         UserBrief         `json:"caller"`
	Participants   []CallParticipant `json:"participants"`
}

// CallStatePayload 房间成员变更推送。
//
// SelfConn 让收帧方认出自己那条连接：mesh 的 offer/answer 谁先发，
// 靠 self_conn 与 peer conn_id 的字典序比较来定，双方结论必然相反，不会撞车。
// 推给会话内非参与成员时 SelfConn 为空串（他们只用它渲染「通话中」横幅）。
type CallStatePayload struct {
	CallID         uuid.UUID         `json:"call_id"`
	ConversationID uuid.UUID         `json:"conversation_id"`
	Media          string            `json:"media"`
	State          string            `json:"state"` // ringing | active
	SelfConn       string            `json:"self_conn"`
	Participants   []CallParticipant `json:"participants"`
}

// CallEndedPayload 通话终结推送。Duration 单位秒，未接通时为 0。
type CallEndedPayload struct {
	CallID   uuid.UUID `json:"call_id"`
	Reason   string    `json:"reason"` // completed|rejected|canceled|timeout|busy|failed
	Duration int       `json:"duration"`
}
```

`ContentPayload` 追加一个字段（放在 `ThumbKey` 之后）：

```go
	// Call 通话记录（仅 system 消息使用）。带结构化字段而非只给一句中文，
	// 客户端才能按自己的语言渲染「未接来电」/「通话时长 03:24」。
	Call *CallInfo `json:"call,omitempty"`
```

并新增：

```go
// CallInfo 通话记录的结构化内容，落进系统消息的 content.call。
type CallInfo struct {
	Media    string `json:"media"`  // audio | video
	Result   string `json:"result"` // answered|missed|rejected|canceled|busy
	Duration int    `json:"duration"`
}
```

- [ ] **Step 2: 写 golden 契约的 4 个新 case**

`contracts/server-frames.golden.json` 的 `cases` 数组追加（字段必须与 struct json tag **完全一致**，多一个少一个测试都红）：

```json
{
  "name": "call.incoming",
  "frame": {
    "type": "call.incoming",
    "payload": {
      "call_id": "6f1c9c62-7f9a-4d7e-8f2b-1b0b1f2e3a41",
      "conversation_id": "0a4c2f10-6f3d-4a58-9f77-2b0c9d1e4f52",
      "media": "video",
      "caller": {
        "id": "3c9d1a7e-4b2f-4c81-9a6d-5e0f7b8c9d10",
        "nickname": "Alice",
        "avatar_url": null,
        "short_id": 100001
      },
      "participants": [
        {
          "user_id": "3c9d1a7e-4b2f-4c81-9a6d-5e0f7b8c9d10",
          "conn_id": "b1e2c3d4-0000-4000-8000-000000000001",
          "nickname": "Alice",
          "avatar_url": null,
          "state": "joined"
        }
      ]
    }
  }
},
{
  "name": "call.state",
  "frame": {
    "type": "call.state",
    "payload": {
      "call_id": "6f1c9c62-7f9a-4d7e-8f2b-1b0b1f2e3a41",
      "conversation_id": "0a4c2f10-6f3d-4a58-9f77-2b0c9d1e4f52",
      "media": "audio",
      "state": "active",
      "self_conn": "b1e2c3d4-0000-4000-8000-000000000001",
      "participants": [
        {
          "user_id": "3c9d1a7e-4b2f-4c81-9a6d-5e0f7b8c9d10",
          "conn_id": "b1e2c3d4-0000-4000-8000-000000000001",
          "nickname": "Alice",
          "avatar_url": null,
          "state": "joined"
        }
      ]
    }
  }
},
{
  "name": "call.signal",
  "frame": {
    "type": "call.signal",
    "payload": {
      "call_id": "6f1c9c62-7f9a-4d7e-8f2b-1b0b1f2e3a41",
      "to_conn": "",
      "from_conn": "b1e2c3d4-0000-4000-8000-000000000001",
      "from_user": "3c9d1a7e-4b2f-4c81-9a6d-5e0f7b8c9d10",
      "data": { "type": "offer", "sdp": "v=0\r\n" }
    }
  }
},
{
  "name": "call.ended",
  "frame": {
    "type": "call.ended",
    "payload": {
      "call_id": "6f1c9c62-7f9a-4d7e-8f2b-1b0b1f2e3a41",
      "reason": "completed",
      "duration": 204
    }
  }
}
```

`golden_server_frames_test.go` 的 decode switch（`:56-69`）加 4 个 case，`payloadPrototypes()`（`:76-81`）加 4 项：

```go
		case TypeCallIncoming:
			var p CallIncomingPayload
			err = dec.Decode(&p)
		case TypeCallState:
			var p CallStatePayload
			err = dec.Decode(&p)
		case TypeCallSignal:
			var p CallSignalPayload
			err = dec.Decode(&p)
		case TypeCallEnded:
			var p CallEndedPayload
			err = dec.Decode(&p)
```

```go
		TypeCallIncoming: CallIncomingPayload{},
		TypeCallState:    CallStatePayload{},
		TypeCallSignal:   CallSignalPayload{},
		TypeCallEnded:    CallEndedPayload{},
```

- [ ] **Step 3: 运行 golden 测试确认失败**

```bash
cd server && go test ./internal/ws/ -run TestGoldenServerFrames -v
```

Expected: FAIL —— payload struct 尚未定义（Step 1 若已写则应 PASS，此时确认 Step 1、2 已一致再往下）。

- [ ] **Step 4: 写信令 handler 的失败测试**

`server/internal/ws/call_test.go`：

```go
package ws

import (
	"encoding/json"
	"testing"
)

// TestCallSignalRoutesToTargetConn 信令只送给 to_conn 指定的那条连接。
// 用户级扇出会把 A 手机的 offer 也发到 A 的桌面端，mesh 直接乱套。
func TestCallSignalRoutesToTargetConn(t *testing.T) {
	h, hub := newTestCallHandler(t)
	alice := newTestClient(hub, "alice")
	bob1 := newTestClient(hub, "bob")
	bob2 := newTestClient(hub, "bob") // bob 的第二台设备

	room := seedActiveRoom(t, h, alice, bob1)

	payload, _ := json.Marshal(CallSignalPayload{
		CallID: room.CallID,
		ToConn: bob1.connID.String(),
		Data:   json.RawMessage(`{"type":"offer"}`),
	})
	h.dispatch(alice, &Envelope{Type: TypeCallSignal, Payload: payload})

	if got := drainFrames(bob1); len(got) != 1 || got[0].Type != TypeCallSignal {
		t.Errorf("bob1 应收到 1 帧 call.signal，实收 %v", got)
	}
	if got := drainFrames(bob2); len(got) != 0 {
		t.Errorf("bob2 不应收到信令，实收 %v", got)
	}
}

// TestCallInviteRejectsNonMember 非会话成员不能对该会话发起通话。
func TestCallInviteRejectsNonMember(t *testing.T) {
	h, hub := newTestCallHandler(t)
	outsider := newTestClient(hub, "mallory")
	payload, _ := json.Marshal(CallInvitePayload{
		ConversationID: uuid.New(), Media: "audio",
	})
	h.dispatch(outsider, &Envelope{Type: TypeCallInvite, Payload: payload})

	got := drainFrames(outsider)
	if len(got) != 1 || got[0].Type != TypeError {
		t.Fatalf("应回一帧 error，实收 %v", got)
	}
}

// TestDisconnectLeavesRoom 连接断开等价于挂断：另一端应收到 call.ended。
func TestDisconnectLeavesRoom(t *testing.T) {
	h, hub := newTestCallHandler(t)
	alice := newTestClient(hub, "alice")
	bob := newTestClient(hub, "bob")
	seedActiveRoom(t, h, alice, bob)

	hub.Unregister(bob) // 模拟关窗口 / 拔网线

	frames := drainFrames(alice)
	found := false
	for _, f := range frames {
		if f.Type == TypeCallEnded {
			found = true
		}
	}
	if !found {
		t.Errorf("alice 应收到 call.ended，实收 %v", frames)
	}
}
```

测试辅助（同文件下方）：`newTestCallHandler` 用 `testutil.NewRedis(t)` 造 `CallService` 并注入桩成员解析器（固定返回 alice+bob）；`newTestClient` 造带 `connID` 的 `Client` 并 `hub.Register`；`drainFrames` 把 `c.send` 里的帧解成 `[]Envelope`；`seedActiveRoom` 走 `call.invite` + `call.answer` 两帧把房间推到 active 并返回 `*service.Room`。

- [ ] **Step 5: 运行测试确认失败**

```bash
cd server && go test ./internal/ws/ -run 'TestCall|TestDisconnectLeaves' -v
```

Expected: 编译失败 —— `call.go` 未实现。

- [ ] **Step 6: 实现 `server/internal/ws/call.go`**

要点（逐条实现，每条都有明确行为）：

1. `Handler` 结构体加三个字段：`callSvc *service.CallService`、`callMembers func(ctx, userID, convID) ([]uuid.UUID, error)`、`onCallEnd func(ctx, room *service.Room, reason service.EndReason, duration int)`；配套 `SetCallService` / `SetConversationMembers` 注入方法。
2. `dispatch` 加 4 个 case 转到 `handleCallInvite` / `handleCallAnswer` / `handleCallLeave` / `handleCallSignal`。
3. `handleCallInvite`：
   - 校验 `media ∈ {audio, video}`，否则 `c.sendError(400, "invalid media", "")`
   - `callMembers` 取会话成员；`c.userID` 不在其中 → `sendError(403, "not a conversation member", "")`
   - `invitee_ids` 为空且成员恰为 2 人 → 取另一方；为空且成员 >2 → `sendError(400, "invitee_ids required for group call", "")`
   - `len(invitees) > MaxCallParticipants-1` → `sendError(400, "too many invitees", "")`
   - invitees 必须全部是会话成员，否则 403
   - `callSvc.Create(...)`；`ErrCallBusy` → `sendError(409, "you are already in a call", "")`
   - 全部 invitee 都在 `skipped` 里（且 invitee 非空）→ 立刻 `EndWithReason(EndBusy)` + 给主叫推 `call.ended{reason:"busy"}` + `onCallEnd` 落系统消息，直接 return
   - 否则：给未跳过的 invitee 推 `call.incoming`（`SendToUsers`，全设备振铃）；给主叫连接推 `call.state`；给会话内其余成员推 `call.state`（`SelfConn=""`）
   - 起 `time.AfterFunc(service.RingTimeout, ...)` → 到点调 `EndWithReason(EndTimeout)`，若 `ended` 则广播 `call.ended` 并 `onCallEnd`
4. `handleCallAnswer`：
   - `accept=false` → 走 `callSvc.Leave` 同一路径
   - `accept=true` → 校验该用户是会话成员（群通话主动加入的入口）→ `callSvc.Join`；`ErrCallFull` → `sendError(409, "call is full", "")`；`ErrCallNotFound` → `sendError(404, "call not found", "")`
   - 成功后给房间内每条 joined 连接各推一帧 `call.state`（**每帧的 `SelfConn` 填该连接自己的 conn_id**），并给该用户的其它设备推 `call.ended{reason:"answered_elsewhere"}`… **注意**：不新增 reason 值，改推 `call.state` 即可 —— 其它设备发现 participants 里自己那项的 `conn_id` 不是本机，就自行停止振铃
5. `handleCallLeave` / 断连：`callSvc.Leave` → `ended` 时广播 `call.ended` 给离开前快照里的全部参与者，并调 `onCallEnd`；未 `ended` 时广播 `call.state`
6. `handleCallSignal`：校验发送方在房间内且 `to_conn` 也在房间内（**防止把服务器当任意连接的转发器**）→ 填 `FromConn`/`FromUser` 后 `hub.SendToConn`；返回 false 时退回 `SendToUsers(目标用户)`（跨实例降级路径）
7. `HandleDisconnect(userID, connID)`：`callSvc.CallIDForConn` 查到房间就走第 5 条的离开路径

- [ ] **Step 7: 运行测试确认通过**

```bash
cd server && go test ./internal/ws/ -v
cd server && go test -race ./internal/ws/
```

Expected: 全 PASS（含 golden 四个新 case）。

- [ ] **Step 8: 提交**

```bash
git add server/internal/ws/ contracts/server-frames.golden.json
git commit -m "feat(call): WebSocket 通话信令帧与转发路由"
```

---

### Task 6: 通话记录系统消息 + REST 端点 + 装配

**Files:**

- Modify: `server/internal/service/conversation_service.go`（`previewOf` 加 call 分支 + `previewKindCall` 常量）
- Modify: `server/internal/service/conversation_manage.go`（`appendSystemMessage` 增加 content 变体）
- Create: `server/internal/handler/call.go`
- Test: `server/internal/handler/call_test.go`
- Modify: `server/internal/router/router.go`
- Modify: `docs/CHAT_API.md`

**Interfaces:**

- Consumes: Task 4 的 `CallService`、Task 5 的 `Handler.SetCallService`
- Produces: `GET /api/v1/calls/ice-servers`、`GET /api/v1/calls/:call_id`；`previewKindCall = "call"`

- [ ] **Step 1: 写失败的 handler 测试**

`server/internal/handler/call_test.go`：

```go
// TestICEServersRequiresAuth 未登录拿不到 TURN 凭据 —— 凭据即中继配额。
func TestICEServersRequiresAuth(t *testing.T) { /* httptest 打 /api/v1/calls/ice-servers 不带 token，断言 401 */ }

// TestICEServersShape 返回 STUN + TURN 两项，username 形如 <expiry>:<uid>。
func TestICEServersShape(t *testing.T) { /* 带 token，断言 data.ice_servers 长度 2 与 username 前缀 */ }

// TestGetCallForbidsNonParticipant 非房间参与者读不到房间快照（含对端 conn_id）。
func TestGetCallForbidsNonParticipant(t *testing.T) { /* 断言 403 */ }

// TestGetCallNotFound 房间不存在返回 404，不返回空对象。
func TestGetCallNotFound(t *testing.T) { /* 断言 404 */ }
```

（实现时把注释里的描述写成真实断言；沿用本包既有的 `newTestRouter` 范式与 `testutil.NewRedis`。）

- [ ] **Step 2: 运行确认失败**

```bash
cd server && go test ./internal/handler/ -run TestICEServers -v
```

Expected: 编译失败 —— `handler/call.go` 不存在。

- [ ] **Step 3: 实现 handler**

```go
// CallHandler 通话相关的 REST 端点。
type CallHandler struct {
	calls  *service.CallService
	users  *repository.UserRepository
	logger *zap.Logger
}

// GetICEServers 下发 STUN/TURN 配置与临时凭据。
//
// @Summary 获取 ICE 服务器配置
// @Router /calls/ice-servers [get]
func (h *CallHandler) GetICEServers(c *gin.Context) {
	userID := middleware.MustUserID(c)
	Success(c, h.calls.ICEServers(userID))
}

// GetCall 返回通话房间快照。
//
// 通话窗口是在 call.incoming 之后才创建的，它的 WebSocket 连上时那一帧早已发完 ——
// 没有这个端点，新窗口就没有房间信息可渲染。顺带让「通话窗口刷新/重开」可恢复。
//
// @Summary 获取通话房间快照
// @Router /calls/{call_id} [get]
func (h *CallHandler) GetCall(c *gin.Context) { /* 解析 :call_id → calls.Get → 校验请求者在 participants 内否则 403 → 补昵称/头像 → Success */ }
```

`router.go` 装配：

```go
	callSvc := service.NewCallService(rdb, cfg.Turn, logger)   // service 区块
	callH := handler.NewCallHandler(callSvc, userRepo, logger) // handler 区块

	// ws 侧注入（在 SetOfflinePush 那一段附近）
	wsH.SetCallService(callSvc, func(ctx context.Context, room *service.Room, reason service.EndReason, dur int) {
		// 通话终结即落一条系统消息，未接来电靠 seq 递增自然计入未读
		convSvc.AppendCallRecord(ctx, room.ConversationID, room.CallerID, string(room.Media), callResultOf(reason), dur)
	})
	wsH.SetConversationMembers(convSvc.MemberIDsFor)
	hub.SetDisconnectNotifier(wsH.HandleDisconnect)

	// 路由（挂在已鉴权 group chat 上）
	chat.GET("/calls/ice-servers", middleware.LimitByIP(20, 40), callH.GetICEServers)
	chat.GET("/calls/:call_id", middleware.LimitByIP(20, 40), callH.GetCall)
```

- [ ] **Step 4: 实现通话记录落库与预览**

`conversation_service.go` 的预览常量区加 `previewKindCall = "call"`；`previewOf` 的 `MessageTypeSystem` 分支改为：

```go
	case model.MessageTypeSystem:
		// 系统消息与文本同为 {"text":...}，原实现落 default 返回空串 → 建群后列表预览空白
		var c struct {
			Text string          `json:"text"`
			Call json.RawMessage `json:"call"`
		}
		if err := json.Unmarshal([]byte(m.Content), &c); err == nil {
			// 通话记录不回传服务端中文：列表预览由客户端按 kind 渲染本地化的「[通话]」，
			// 否则英/日/韩界面会在会话列表里看到中文「通话时长 03:24」
			if len(c.Call) > 0 {
				return "", previewKindCall
			}
			return c.Text, previewKindSystem
		}
		return "", previewKindSystem
```

`ConversationService` 新增：

```go
// AppendCallRecord 通话终结后写一条通话记录系统消息。
//
// 复用系统消息而不新增 message_type：渲染管线、撤回/编辑闸门、相册过滤、
// 内容审核、收藏映射全都按 message_type 分支，多一个类型要改的地方远多于收益。
// content 里同时给 text（兜底）与 call（结构化）：老客户端读 text 不会白屏，
// 新客户端读 call 走自己的语言渲染。
func (s *ConversationService) AppendCallRecord(
	ctx context.Context, convID, callerID uuid.UUID, media, result string, duration int,
) { /* 组 content JSON → CreateWithSeq → pushSystemReceive 推全员 */ }

// MemberIDsFor 返回会话成员 ID 列表，并校验 userID 确为其中一员。
func (s *ConversationService) MemberIDsFor(ctx context.Context, userID, convID uuid.UUID) ([]uuid.UUID, error)
```

`callResultOf(reason)` 映射：`completed→answered`、`timeout→missed`、`rejected→rejected`、`canceled|failed→canceled`、`busy→busy`。

- [ ] **Step 5: 运行全部后端测试**

```bash
cd server && go vet ./... && go test ./... && go test -race ./internal/ws/
```

Expected: 全 PASS。

- [ ] **Step 6: 更新 API 文档并提交**

`docs/CHAT_API.md` 补：8 个通话帧的完整 payload 表、2 个 REST 端点、`content.call` 的字段说明与 result 枚举。

```bash
git add server/ docs/CHAT_API.md
git commit -m "feat(call): 通话记录系统消息、ICE 与房间快照端点及服务装配"
```

---

## Stage C — 前端共享层

### Task 7: 帧类型、callStore、REST 客户端与 MSW

**Files:**

- Modify: `packages/shared/src/ws/chatSocket.ts:67-79, 95-200`
- Create: `packages/shared/src/store/callStore.ts`
- Create: `packages/shared/src/api/call.ts`
- Create: `packages/shared/src/webrtc/iceServers.ts`
- Modify: `packages/shared/src/mocks/handlers.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/__tests__/callStore.test.ts`
- Test: `packages/shared/src/__tests__/serverFramesGolden.test.ts`（追加 4 帧断言）

**Interfaces:**

- Consumes: Task 5 的帧契约
- Produces:

```ts
type CallPhase = "idle" | "outgoing" | "incoming" | "active";
interface CallParticipant { user_id: string; conn_id: string; nickname: string; avatar_url?: string | null; state: "invited" | "joined" }
interface CallStore {
  phase: CallPhase; callId: string | null; conversationId: string | null;
  media: "audio" | "video"; selfConn: string; participants: CallParticipant[];
  caller: { id: string; nickname: string; avatar_url?: string | null } | null;
  minimized: boolean; muted: boolean; cameraOff: boolean; startedAt: number | null;
  endReason: string | null;
  applyIncoming(p): void; applyState(p): void; applyEnded(p): void;
  startOutgoing(conversationId, media, inviteeIds): void;
  setMinimized(v: boolean): void; toggleMute(): void; toggleCamera(): void; reset(): void;
}
const useCallStore: UseBoundStore<...>
function fetchIceServers(): Promise<RTCIceServer[]>   // 带 TTL 缓存
function fetchCall(callId: string): Promise<CallRoomDTO>
```

- [ ] **Step 1: 写失败的 callStore 测试**

`packages/shared/src/__tests__/callStore.test.ts`：

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useCallStore } from "../store/callStore";

const P = (conn: string, state: "invited" | "joined" = "joined") => ({
  user_id: "u-" + conn,
  conn_id: conn,
  nickname: "N" + conn,
  avatar_url: null,
  state,
});

describe("callStore", () => {
  beforeEach(() => useCallStore.getState().reset());

  it("来电帧把 phase 推到 incoming 并记住主叫", () => {
    useCallStore.getState().applyIncoming({
      call_id: "c1",
      conversation_id: "v1",
      media: "video",
      caller: { id: "a", nickname: "Alice", avatar_url: null, short_id: 1 },
      participants: [P("ca")],
    });
    const s = useCallStore.getState();
    expect(s.phase).toBe("incoming");
    expect(s.callId).toBe("c1");
    expect(s.caller?.nickname).toBe("Alice");
  });

  it("state 帧进 active 时记下开始时刻，重复帧不刷新它", () => {
    const st = useCallStore.getState();
    st.applyIncoming({
      call_id: "c1",
      conversation_id: "v1",
      media: "audio",
      caller: { id: "a", nickname: "A", avatar_url: null, short_id: 1 },
      participants: [P("ca")],
    });
    st.applyState({
      call_id: "c1",
      conversation_id: "v1",
      media: "audio",
      state: "active",
      self_conn: "cb",
      participants: [P("ca"), P("cb")],
    });
    const first = useCallStore.getState().startedAt;
    expect(useCallStore.getState().phase).toBe("active");
    expect(first).not.toBeNull();

    st.applyState({
      call_id: "c1",
      conversation_id: "v1",
      media: "audio",
      state: "active",
      self_conn: "cb",
      participants: [P("ca"), P("cb"), P("cc")],
    });
    // 通话时长必须从第一次接通算起：每来一帧就刷新会让计时器一直归零
    expect(useCallStore.getState().startedAt).toBe(first);
  });

  it("ended 帧无条件复位，并保留终结原因供 toast 用", () => {
    const st = useCallStore.getState();
    st.applyIncoming({
      call_id: "c1",
      conversation_id: "v1",
      media: "audio",
      caller: { id: "a", nickname: "A", avatar_url: null, short_id: 1 },
      participants: [P("ca")],
    });
    st.applyEnded({ call_id: "c1", reason: "rejected", duration: 0 });
    expect(useCallStore.getState().phase).toBe("idle");
    expect(useCallStore.getState().endReason).toBe("rejected");
  });

  it("非当前通话的帧一律忽略", () => {
    const st = useCallStore.getState();
    st.applyIncoming({
      call_id: "c1",
      conversation_id: "v1",
      media: "audio",
      caller: { id: "a", nickname: "A", avatar_url: null, short_id: 1 },
      participants: [P("ca")],
    });
    // 通话中又来一路 ended：串号会把正在进行的通话直接挂掉
    st.applyEnded({ call_id: "OTHER", reason: "completed", duration: 9 });
    expect(useCallStore.getState().phase).toBe("incoming");
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd packages/shared && LANG=C.UTF-8 npx vitest run src/__tests__/callStore.test.ts
```

Expected: FAIL —— `store/callStore` 不存在。

- [ ] **Step 3: 实现 chatSocket 帧契约**

`ClientFrames` 追加：

```ts
  "call.invite": { conversation_id: string; media: "audio" | "video"; invitee_ids?: string[] };
  "call.answer": { call_id: string; accept: boolean };
  "call.leave": { call_id: string };
  "call.signal": { call_id: string; to_conn: string; data: CallSignalData };
```

`ServerFrames` 追加 `call.incoming` / `call.state` / `call.signal` / `call.ended` 四键，
字段名逐字对齐 Task 5 的 Go json tag。并新增：

```ts
/** SDP / ICE 协商载荷。服务端只转发不解析，类型只在客户端两侧成立。 */
export type CallSignalData =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "candidate"; candidate: RTCIceCandidateInit };
```

- [ ] **Step 4: 实现 callStore / api / iceServers**

`callStore.ts` 关键点：

- 所有 `apply*` 首先比对 `call_id`，不匹配直接 `return`（对应 Step 1 的第四条用例）
- `applyState` 只在 `phase !== "active" && payload.state === "active"` 时写 `startedAt = Date.now()`
- `applyEnded` 复位全部字段但保留 `endReason`

`api/call.ts`：`fetchIceServers()` / `fetchCall(callId)` 走既有 `doFetch`。

`webrtc/iceServers.ts`：模块级缓存 `{ servers, expiresAt }`，`Date.now() < expiresAt` 直接复用，
过期或首次才打接口；失败时回退 `[{ urls: ["stun:localhost:3478"] }]` 并 `captureException`
（**不能静默返回空数组**：那会让通话在无中继时静静失败，用户只看到一直"连接中"）。

`index.ts` 导出 `useCallStore`、`fetchIceServers`、`fetchCall` 及相关类型。

- [ ] **Step 5: 补 MSW 四态**

`mocks/handlers.ts` 追加：

```ts
  http.get("http://localhost:8085/api/v1/calls/ice-servers", () =>
    HttpResponse.json({ code: 0, message: "ok", data: {
      ice_servers: [{ urls: ["stun:localhost:3478"] }],
      ttl: 3600,
    } })),
  http.get("http://localhost:8085/api/v1/calls/:callId", ({ params }) =>
    params.callId === "missing"
      ? HttpResponse.json({ code: 404, message: "call not found" }, { status: 404 })
      : HttpResponse.json({ code: 0, message: "ok", data: MOCK_CALL_ROOM })),
```

`MOCK_CALL_ROOM` 放在文件的 mock 数据区，形状与 Go 的房间快照一致。

- [ ] **Step 6: 补 golden 前端断言**

`serverFramesGolden.test.ts` 的用例名清单里加四个新帧，并为每帧加
`expect(Object.keys(raw).sort()).toEqual([...].sort())` 的精确字段集断言。

- [ ] **Step 7: 运行测试确认通过**

```bash
cd packages/shared && LANG=C.UTF-8 npx vitest run
```

Expected: 全 PASS。

- [ ] **Step 8: 提交**

```bash
git add packages/shared/src
git commit -m "feat(call): 通话帧契约、状态机 store 与 ICE 客户端"
```

---

### Task 8: peerMesh + ringtone + 帧接线

**Files:**

- Create: `packages/shared/src/webrtc/peerMesh.ts`
- Create: `packages/shared/src/webrtc/ringtone.ts`
- Create: `packages/shared/src/hooks/useCallSocket.ts`
- Modify: `packages/shared/src/hooks/useChatBootstrap.ts:107-399`（加 4 个 handler）
- Test: `packages/shared/src/__tests__/peerMesh.test.ts`
- Test: `packages/shared/src/__tests__/ringtone.test.ts`

**Interfaces:**

- Consumes: Task 7 的 `useCallStore`、`fetchIceServers`、`chatSocket`
- Produces:

```ts
class PeerMesh {
  constructor(opts: {
    selfConn: string;
    iceServers: RTCIceServer[];
    onSignal: (toConn: string, data: CallSignalData) => void;
    onRemoteStream: (connId: string, stream: MediaStream) => void;
    onPeerGone: (connId: string) => void;
  });
  setLocalStream(stream: MediaStream): void;
  syncPeers(peers: string[]): Promise<void>; // 幂等：建新的、拆走掉的
  handleSignal(fromConn: string, data: CallSignalData): Promise<void>;
  close(): void;
}
const ringtone: {
  primeOnFirstGesture(): void;
  playIncoming(): void;
  playOutgoing(): void;
  playHangup(): void;
  stop(): void;
};
function useCallSocket(): void; // 通话窗口专用的精简 bootstrap
```

- [ ] **Step 1: 写失败的 peerMesh 测试**

```ts
// packages/shared/src/__tests__/peerMesh.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PeerMesh } from "../webrtc/peerMesh";

// jsdom 没有 RTCPeerConnection，用最小桩顶上：
// 本用例要验的是「谁先发 offer」与「候选入队」，不是浏览器实现本身
class FakePC {
  static instances: FakePC[] = [];
  localDescription: unknown = null;
  remoteDescription: unknown = null;
  pending: unknown[] = [];
  onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
  ontrack: ((e: { streams: MediaStream[] }) => void) | null = null;
  constructor() {
    FakePC.instances.push(this);
  }
  addTrack = vi.fn();
  createOffer = vi.fn(async () => ({ type: "offer", sdp: "o" }));
  createAnswer = vi.fn(async () => ({ type: "answer", sdp: "a" }));
  setLocalDescription = vi.fn(async (d: unknown) => {
    this.localDescription = d;
  });
  setRemoteDescription = vi.fn(async (d: unknown) => {
    this.remoteDescription = d;
  });
  addIceCandidate = vi.fn(async (c: unknown) => {
    this.pending.push(c);
  });
  close = vi.fn();
}

describe("PeerMesh", () => {
  beforeEach(() => {
    FakePC.instances = [];
    (globalThis as Record<string, unknown>).RTCPeerConnection = FakePC;
  });

  it("conn_id 字典序小的一方发 offer，大的一方等待", async () => {
    const sent: Array<[string, { type: string }]> = [];
    const mesh = new PeerMesh({
      selfConn: "aaa",
      iceServers: [],
      onSignal: (to, d) => sent.push([to, d]),
      onRemoteStream: () => {},
      onPeerGone: () => {},
    });
    await mesh.syncPeers(["bbb"]);
    expect(sent.map(([, d]) => d.type)).toEqual(["offer"]);

    // 反过来：自己是较大的一方，不该主动发
    sent.length = 0;
    const mesh2 = new PeerMesh({
      selfConn: "zzz",
      iceServers: [],
      onSignal: (to, d) => sent.push([to, d]),
      onRemoteStream: () => {},
      onPeerGone: () => {},
    });
    await mesh2.syncPeers(["bbb"]);
    expect(sent).toHaveLength(0);
  });

  it("remote description 未就位时候选先入队，就位后一次性补投", async () => {
    const mesh = new PeerMesh({
      selfConn: "zzz",
      iceServers: [],
      onSignal: () => {},
      onRemoteStream: () => {},
      onPeerGone: () => {},
    });
    await mesh.syncPeers(["bbb"]);
    const pc = FakePC.instances[0];
    await mesh.handleSignal("bbb", { type: "candidate", candidate: { candidate: "c1" } });
    expect(pc.addIceCandidate).not.toHaveBeenCalled();

    await mesh.handleSignal("bbb", { type: "offer", sdp: "o" });
    expect(pc.addIceCandidate).toHaveBeenCalledTimes(1);
  });

  it("syncPeers 幂等：同一 peer 不重复建连，消失的 peer 被关闭", async () => {
    const gone: string[] = [];
    const mesh = new PeerMesh({
      selfConn: "aaa",
      iceServers: [],
      onSignal: () => {},
      onRemoteStream: () => {},
      onPeerGone: (c) => gone.push(c),
    });
    await mesh.syncPeers(["bbb"]);
    await mesh.syncPeers(["bbb"]);
    expect(FakePC.instances).toHaveLength(1);
    await mesh.syncPeers([]);
    expect(gone).toEqual(["bbb"]);
    expect(FakePC.instances[0].close).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 写失败的 ringtone 测试**

```ts
// packages/shared/src/__tests__/ringtone.test.ts
import { describe, expect, it, vi } from "vitest";
import { ringtone } from "../webrtc/ringtone";

describe("ringtone", () => {
  it("AudioContext 处于 suspended 时会先 resume 再响", async () => {
    const resume = vi.fn(async () => {});
    class FakeCtx {
      state = "suspended";
      currentTime = 0;
      destination = {};
      resume = resume;
      createOscillator = () => ({
        type: "",
        frequency: { value: 0 },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      });
      createGain = () => ({
        gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      });
    }
    (globalThis as Record<string, unknown>).AudioContext = FakeCtx;
    ringtone.primeOnFirstGesture();
    ringtone.playIncoming();
    await Promise.resolve();
    // 被叫侧没有用户手势，autoplay 策略会让 AudioContext 停在 suspended —— 不 resume 就是静音来电
    expect(resume).toHaveBeenCalled();
    ringtone.stop();
  });
});
```

- [ ] **Step 3: 运行两个测试确认失败**

```bash
cd packages/shared && LANG=C.UTF-8 npx vitest run src/__tests__/peerMesh.test.ts src/__tests__/ringtone.test.ts
```

Expected: FAIL —— 两个模块都不存在。

- [ ] **Step 4: 实现 peerMesh**

关键实现点：

- `peers: Map<string, { pc: RTCPeerConnection; queued: RTCIceCandidateInit[] }>`
- `syncPeers(list)`：对新增的建 PC + `addTrack(localStream)` + 绑 `onicecandidate`/`ontrack`；
  `this.selfConn < peerConn` 时立即 `createOffer`。对消失的 `pc.close()` + `onPeerGone`
- `handleSignal`：`offer` → `setRemote` → 冲刷候选队列 → `createAnswer` → `setLocal` → `onSignal(answer)`；
  `answer` → `setRemote` → 冲刷队列；`candidate` → `pc.remoteDescription` 为空则入队，否则 `addIceCandidate`
- **候选队列是必需的**：ICE 候选常常先于 offer/answer 到达，此时 `addIceCandidate` 会抛
  `InvalidStateError`，丢掉的候选往往正是唯一能连通的那条 relay 候选
- 兼容：不用 `?.` / `??`（`build.target=es2019` 会转译，但源码保持一致风格）

- [ ] **Step 5: 实现 ringtone**

```ts
/**
 * 通话铃声（Web Audio 合成，不引音频资源）。
 *
 * 浏览器 autoplay 策略要求 AudioContext 由用户手势创建/恢复。主叫侧的手势是
 * 「点通话按钮」，天然满足；被叫侧没有任何手势 —— 所以在应用首个 pointerdown 上
 * 预创建并 resume 一个模块级 AudioContext，之后一直复用。这是浏览器铃声的标准解法。
 */
```

- 来电：440 Hz + 480 Hz 双音，2s 响 / 4s 停 循环；`navigator.vibrate` 存在时叠 `[600, 1000]` 循环
- 呼出回铃：450 Hz 单音，1s 响 / 2s 停，增益为来电的 40%
- 挂断：单次 200ms 下滑音
- `stop()` 清定时器 + 停振荡器 + `navigator.vibrate(0)`

- [ ] **Step 6: 接线帧 handler**

`useChatBootstrap.ts` 的 `setHandlers` 对象里加四个 handler：

```ts
      "call.incoming": (p) => {
        useCallStore.getState().applyIncoming(p);
      },
      "call.state": (p) => {
        useCallStore.getState().applyState(p);
      },
      "call.signal": (p) => {
        // 信令交给 PeerMesh 实例（由 CallView 在挂载时注册），
        // store 不持有 RTCPeerConnection —— 它不是可序列化状态
        callSignalSink.push(p);
      },
      "call.ended": (p) => {
        useCallStore.getState().applyEnded(p);
      },
```

`callSignalSink` 是 `webrtc/peerMesh.ts` 导出的模块级小队列（`push` / `subscribe`），
解决"帧比 PeerMesh 实例先到"的竞态：订阅时先冲刷积压。

`useCallSocket.ts`：桌面通话窗口专用 —— 只做 `chatSocket.setTokenProvider` +
上面四个 handler 的 `setHandlers` + `connect()`，**不拉会话列表/联系人**（通话窗口用不到）。

- [ ] **Step 7: 运行确认通过**

```bash
cd packages/shared && LANG=C.UTF-8 npx vitest run
```

Expected: 全 PASS。

- [ ] **Step 8: 提交**

```bash
git add packages/shared/src
git commit -m "feat(call): mesh 连接管理、合成铃声与信令接线"
```

---

## Stage D — UI

### Task 9: CallView / CallHost / CallInviteModal + 入口接线 + i18n

**Files:**

- Create: `packages/ui/src/CallView.tsx`、`CallHost.tsx`、`CallInviteModal.tsx`、`callFormat.ts`
- Modify: `packages/ui/src/MainLayout.tsx:107-161, 164-230`（加 `callMode` prop + 挂 `CallHost`）
- Modify: `packages/ui/src/ChatWindow.tsx:359-373`、`Composer.tsx:690-699`、`ChatDetail.tsx:261`、`ContactDetail.tsx:175-184`
- Modify: `packages/ui/src/MessageBubble.tsx:307-314`（系统消息分支加通话记录渲染）
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/design-system/src/i18n/locales/{zh-CN,en-US,ja-JP,ko-KR}.json`
- Test: `packages/ui/src/__tests__/CallView.test.tsx`、`__tests__/CallInviteModal.test.tsx`

**Interfaces:**

- Consumes: Task 7/8 的 `useCallStore`、`PeerMesh`、`ringtone`、`fetchIceServers`
- Produces: `<CallView />`、`<CallHost />`、`<CallInviteModal />`、`formatCallDuration(sec): string`、`callRecordKey(result): string`

- [ ] **Step 1: 补 i18n 四语 key**

在四份 locale 各加以下 key（`chat.voiceCall` / `chat.videoCall` 已存在，复用）：

| key                    | zh-CN                  | en-US                              |
| ---------------------- | ---------------------- | ---------------------------------- |
| `call.calling`         | 正在呼叫…              | Calling…                           |
| `call.incoming`        | 邀请你语音通话         | Incoming voice call                |
| `call.incomingVideo`   | 邀请你视频通话         | Incoming video call                |
| `call.accept`          | 接听                   | Accept                             |
| `call.reject`          | 拒绝                   | Decline                            |
| `call.hangup`          | 挂断                   | Hang up                            |
| `call.mute`            | 静音                   | Mute                               |
| `call.unmute`          | 取消静音               | Unmute                             |
| `call.cameraOn`        | 打开摄像头             | Turn camera on                     |
| `call.cameraOff`       | 关闭摄像头             | Turn camera off                    |
| `call.switchCamera`    | 切换摄像头             | Switch camera                      |
| `call.minimize`        | 最小化                 | Minimize                           |
| `call.restore`         | 返回通话               | Back to call                       |
| `call.connecting`      | 连接中…                | Connecting…                        |
| `call.inviteTitle`     | 选择通话成员           | Select participants                |
| `call.inviteHint`      | 最多再选 %{n} 人       | Up to %{n} more                    |
| `call.joinBanner`      | %{name} 发起了通话     | %{name} started a call             |
| `call.join`            | 加入                   | Join                               |
| `call.full`            | 通话人数已满           | The call is full                   |
| `call.busy`            | 对方正在通话中         | The other party is busy            |
| `call.failedMedia`     | 无法访问麦克风或摄像头 | Cannot access microphone or camera |
| `call.record.answered` | 通话时长 %{duration}   | Call duration %{duration}          |
| `call.record.missed`   | 未接来电               | Missed call                        |
| `call.record.rejected` | 已拒绝                 | Call declined                      |
| `call.record.canceled` | 已取消                 | Call canceled                      |
| `call.record.busy`     | 对方忙线               | Line busy                          |
| `chat.preview.call`    | [通话]                 | [Call]                             |

ja-JP / ko-KR 同步补齐（机翻可接受，与仓库现状一致）。**四份的 key 集合与 `%{}` 占位符集合必须完全相同**，否则 `check:i18n` 直接 fail。

- [ ] **Step 2: 写失败的组件测试**

```tsx
// packages/ui/src/__tests__/CallView.test.tsx（setup 已把语言切成 en-US）
it("来电态显示主叫昵称与接听/拒绝两个按钮", () => {
  /* setState 到 incoming → render → getByText("Alice") / getByRole("button", {name: "Accept"}) */
});
it("通话中点最小化只改 minimized，不挂断", () => {
  /* phase 仍为 active */
});
it("语音通话不显示摄像头按钮", () => {
  /* queryByRole(..., {name:/camera/i}) 为 null */
});
it("安卓返回键在来电态等于拒接，在通话态等于最小化", () => {
  /* 触发 runBackInterceptors，断言两次不同结果 */
});
```

```tsx
// packages/ui/src/__tests__/CallInviteModal.test.tsx
it("最多只能勾选 3 人，第 4 个复选框被禁用", () => {
  /* mesh 上限 4 = 自己 + 3 */
});
```

- [ ] **Step 3: 运行确认失败**

```bash
cd packages/ui && LANG=C.UTF-8 npx vitest run src/__tests__/CallView.test.tsx src/__tests__/CallInviteModal.test.tsx
```

Expected: FAIL —— 组件不存在。

- [ ] **Step 4: 实现 callFormat + CallView**

`callFormat.ts`：

```ts
/** 把秒数格式化为 mm:ss（超过一小时给 h:mm:ss）。 */
export function formatCallDuration(sec: number): string {
  /* … */
}

/** 通话记录 result → i18n key。未知值回落到 canceled，绝不返回空串上屏。 */
export function callRecordKey(result: string): string {
  /* … */
}
```

`CallView.tsx` 结构：

- 三态由 `phase` 驱动：`incoming`（大头像 + 主叫名 + 接听/拒绝）、`outgoing`（大头像 + "正在呼叫…" + 取消）、`active`（远端视频网格 + 本地画中画 + 控制条）
- 视频网格按参与者数量：1 人全屏、2-3 人两列、4 人两行两列
- 控制条：静音 / 摄像头（仅 video）/ 切换摄像头（仅移动端 video）/ 最小化 / 挂断
- 挂载时：`fetchIceServers()` → 建 `PeerMesh` → `subscribe(callSignalSink)` → `syncPeers`
- `phase === "active"` 时启动 1s 计时器显示时长（`formatCallDuration(Date.now() - startedAt)`）
- 卸载时：`mesh.close()`、停本地轨、`ringtone.stop()`
- 圆角一律 `rounded-lg`；触控目标写死 `min-h-[44px]`（rem 刻度 14/16，`min-h-11` 只有 38.5px）
- 全屏容器叠 `paddingTop: "var(--safe-area-top, 0px)"`

`CallHost.tsx`：读 `useCallStore`，`phase === "idle"` 返回 `null`；否则 portal 到 `document.body`，
`minimized` 时渲染悬浮条（`z-[90]`），否则渲染 `CallView` 全屏（来电 `z-[110]`、通话 `z-[100]`）。

- [ ] **Step 5: 接线四处入口 + MainLayout**

- `MainLayout.tsx`：加 `callMode?: "overlay" | "window"` prop（默认 `"overlay"`），
  两个分支在 `<ToastHost />` 旁挂 `{callMode === "overlay" ? <CallHost /> : null}`
- `ChatWindow.tsx:359-373`：两个按钮加 `onClick` —— 单聊直接 `startCall(media)`；群聊打开 `CallInviteModal`
- `Composer.tsx:690-699`：两项的 `comingSoon` toast 换成同样的 `onOpenCall(media)` 回调（经 prop 从 ChatWindow 传下，与既有 `onOpenMedia` 同一范式）
- `ChatDetail.tsx:261`、`ContactDetail.tsx:175-184`：同上
- `startCall` 内先 `navigator.mediaDevices.getUserMedia`，失败出 `t("call.failedMedia")` toast 且**不发** `call.invite`

- [ ] **Step 6: 通话记录气泡**

`MessageBubble.tsx` 的 `msg.kind === "system"` 分支（`:307-314`）改为：先看 `msg.call`，
有则渲染「图标 + `t(callRecordKey(result), { duration: formatCallDuration(d) })`」，
无则沿用现有 `msg.text`。图标用 `lucide-react` 的 `Phone` / `Video` / `PhoneMissed`。

`packages/shared` 侧把 `content.call` 映射进 store 的 `msg.call`：
`useChatBootstrap.ts:154-166`（WS 路径）与 `api/chat.ts:393`（REST 路径）各加一处。

- [ ] **Step 7: 运行测试与门禁**

```bash
cd packages/ui && LANG=C.UTF-8 npx vitest run
node scripts/check-i18n.mjs
node scripts/check-theme-classes.mjs
```

Expected: 全 PASS，i18n 与主题门禁绿。

- [ ] **Step 8: 提交**

```bash
git add packages/ui/src packages/shared/src packages/design-system/src/i18n
git commit -m "feat(call): 通话界面、群通话选人弹窗与通话记录气泡"
```

---

## Stage E — 平台适配

### Task 10: 桌面独立通话窗口

**Files:**

- Create: `apps/desktop/src/pages/CallWindowPage.tsx`
- Create: `apps/desktop/src/hooks/useCallWindow.ts`
- Modify: `apps/desktop/src/App.tsx`（`/call` 路由 + `callMode` 传参）
- Modify: `apps/desktop/src-tauri/capabilities/default.json`
- Test: `apps/desktop/src/__tests__/useCallWindow.test.ts`（若该目录不存在则建）

**Interfaces:**

- Consumes: Task 9 的 `CallView`、Task 8 的 `useCallSocket`
- Produces: 桌面端通话在独立窗口内完成

- [ ] **Step 1: 加 capability**

`capabilities/default.json`：`windows` 数组加 `"call"`；`permissions` 加
`"core:window:allow-set-always-on-top"`（**已在 `gen/schemas/desktop-schema.json` 中核实存在**）。

验证：

```bash
grep -c 'core:window:allow-set-always-on-top' apps/desktop/src-tauri/gen/schemas/desktop-schema.json
```

Expected: 输出 ≥ 1。若为 0，**停下来**，权限名不得凭印象填。

- [ ] **Step 2: 实现 useCallWindow（主窗口侧）**

```ts
/**
 * 主窗口侧的通话窗口控制器。
 *
 * 桌面端通话开独立原生窗口：Tauri 每个 WebviewWindow 是独立 JS 上下文，
 * MediaStream 与 RTCPeerConnection 不能跨窗口传递，视频要在哪渲染，
 * PeerConnection 就必须建在哪。因此通话窗口自建一条 WebSocket，
 * 成为房间里真正的参与者；主窗口这边只负责开窗与关窗。
 *
 * 开窗后立刻把主窗口的 callStore 复位为 idle —— 通话态归通话窗口所有，
 * 两边都持有会导致挂断时互相打架。重复开窗由 getByLabel 去重。
 */
export function useCallWindow(enabled: boolean): void;
```

行为：订阅 `useCallStore`，`phase` 变为 `incoming` / `outgoing` 时构造 URL
（dev 用 `http://localhost:1420/call?...`，生产用 `/call?...`，与 `useTauriAuth.ts:28-29` 同一判定）
并 `new WebviewWindow("call", {...})`；随后 `useCallStore.getState().reset()`。

- [ ] **Step 3: 实现 CallWindowPage**

```tsx
/**
 * 桌面通话窗口页（路由 /call）。
 *
 * 自建 WebSocket（useCallSocket）而非复用主窗口连接。启动时按 role 分流：
 * caller 直接发 call.invite；callee 先拉 GET /calls/:id 房间快照 —— 它是在
 * call.incoming 之后才被创建的，那一帧早已发完，不拉快照就没有房间信息可渲染。
 */
```

- 解析 URL query：`role` / `call_id` / `conversation_id` / `media` / `invitees`
- 挂 `useCallSocket()`
- `role=caller` → `getUserMedia` → `chatSocket.send("call.invite", ...)`
- `role=callee` → `fetchCall(callId)` → 写进 `useCallStore`
- 渲染 `<TitleBar />` + `<CallView />`
- 监听 `phase === "idle"` → `getCurrentWindow().close()`
- 最小化：`setSize(new LogicalSize(320, 72))` + `setAlwaysOnTop(true)`；还原反之

`App.tsx` 加路由 `/call` → `CallWindowPage`，并给 `MainLayout` 传
`callMode={isMobile ? "overlay" : "window"}`（`useIsMobile()` 已存在于 `apps/desktop/src/hooks/`）。

- [ ] **Step 4: 类型检查与构建**

```bash
pnpm turbo typecheck
pnpm --filter @yuanchat/desktop build
```

Expected: 均通过。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src apps/desktop/src-tauri/capabilities/default.json
git commit -m "feat(call): 桌面端通话独立窗口"
```

---

### Task 11: Android 前台服务保活

**Files:**

- Create: `apps/desktop/src-tauri/gen/android/app/src/main/java/com/yuanchat/desktop/CallForegroundService.kt`
- Modify: `apps/desktop/src-tauri/gen/android/app/src/main/java/com/yuanchat/desktop/MainActivity.kt:23-26`
- Modify: `apps/desktop/src-tauri/gen/android/app/src/main/AndroidManifest.xml`
- Modify: `packages/ui/src/CallView.tsx`（进入/离开 active 时调桥）

**Interfaces:**

- Consumes: Task 9 的 `CallView`
- Produces: `window.__yuanchatCall__?.start(media: string)` / `.stop()`（仅 Android 存在）

- [ ] **Step 1: 加 manifest 权限与 service 声明**

`AndroidManifest.xml` 权限区追加（**带中文注释说明为什么**）：

```xml
    <!-- 通话前台服务。通话中切后台，系统会回收进程导致通话中断；
         Android 14+ 还要求按用途细分 microphone / camera 两个子类型，
         只声明 FOREGROUND_SERVICE 会在 startForeground 时抛 SecurityException -->
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_CAMERA" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

`<application>` 内追加：

```xml
        <service
            android:name=".CallForegroundService"
            android:foregroundServiceType="microphone|camera"
            android:exported="false" />
```

- [ ] **Step 2: 实现 CallForegroundService.kt**

```kotlin
package com.yuanchat.desktop

/**
 * 通话前台服务：通话期间把应用钉在前台，避免系统回收进程导致通话中断。
 *
 * 常驻通知点击回到 MainActivity（launchMode=singleTask，不会新开一个实例）。
 * 通知渠道走 IMPORTANCE_LOW：通话本身有铃声与界面，通知只是保活载体，
 * 用 DEFAULT 会在每次通话开始时再响一声。
 */
class CallForegroundService : Service() { /* onStartCommand → startForeground(NOTIF_ID, buildNotification(), type) */ }
```

- [ ] **Step 3: 加 JavascriptInterface 桥**

`MainActivity.kt` 的 `onWebViewCreate`：

```kotlin
  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    // 通话保活桥。走 JavascriptInterface 而不是 #[tauri::command]：
    // Rust 侧要调 Android API 得引 jni + ndk-context 并手写 JNI 调用，
    // 而本文件本来就是已定制的（返回键、安全区都在这里），桥接方向反过来一次即可。
    webView.addJavascriptInterface(CallBridge(this), "__yuanchatCall__")
    pushSafeAreaTop()
  }
```

`CallBridge` 内两个 `@JavascriptInterface` 方法：`start(media: String)` 与 `stop()`，
分别 `startForegroundService` / `stopService`。

- [ ] **Step 4: 前端调用桥**

`CallView.tsx` 的 `useEffect`：`phase === "active"` 时

```ts
// Android 通话保活桥，其它平台上这个对象不存在
const bridge = (
  window as unknown as { __yuanchatCall__?: { start(m: string): void; stop(): void } }
).__yuanchatCall__;
if (typeof bridge !== "undefined" && bridge) bridge.start(media);
return () => {
  if (typeof bridge !== "undefined" && bridge) bridge.stop();
};
```

- [ ] **Step 5: 编译 Android**

```bash
pnpm build:android
```

Expected: aarch64 APK 构建成功（Kotlin 编译无误）。

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/src-tauri/gen/android packages/ui/src/CallView.tsx
git commit -m "feat(call): 安卓通话前台服务保活"
```

---

## Stage F — 债收口、门禁与实测

### Task 12: 搭车债收口

**Files:**

- Create: `packages/design-system/tsconfig.json`
- Modify: `packages/design-system/package.json`（加 `typecheck` 脚本）
- Modify: `server/internal/service/message_edit.go` 或 `handler/message.go`（`edited_at` 口径）
- Modify: `docs/MASTER_PLAN.md`

**Interfaces:**

- Consumes: 无
- Produces: `turbo typecheck` 覆盖 9 个包；`edited_at` 两条出口统一为 UTC RFC3339

- [ ] **Step 1: 补 design-system 的 tsconfig**

仿 `packages/shared/tsconfig.json`：`target` 钉 `ES2019`（对齐 vite 的 `build.target`），
开 `noUnusedLocals` / `noUnusedParameters`，`noEmit: true`。
`package.json` 加 `"typecheck": "tsc --noEmit"`。

```bash
pnpm turbo typecheck
```

Expected: 9 个包全绿（原为 8 个）。若 design-system 暴露出既有类型错误，**修掉它们**，不要放宽配置。

- [ ] **Step 2: 统一 edited_at 序列化口径**

现状：WS 帧走 `time.Now().UTC()`（纳秒 Z），REST 走 DB 回读（`+08:00` 微秒）。
改法：REST 的编辑历史与消息 DTO 在序列化前统一 `.UTC().Truncate(time.Microsecond)`。
通话帧的时间字段同样按此口径。

追加断言到既有的编辑历史测试：同一条消息的 WS 帧与 REST 响应里的 `edited_at`
`time.Parse(time.RFC3339Nano, …)` 后必须相等且时区为 UTC。

- [ ] **Step 3: 运行测试并提交**

```bash
cd server && go test ./... && cd .. && pnpm turbo typecheck
git add packages/design-system server/ docs/MASTER_PLAN.md
git commit -m "chore(debt): design-system 补 typecheck 门禁并统一时间序列化口径"
```

---

### Task 13: E2E + 本地 CI 全量

**Files:**

- Create: `apps/web/e2e/call.spec.ts`
- Modify: `packages/shared/src/mocks/demoData.ts`（加一条通话记录系统消息样本）

**Interfaces:**

- Consumes: 全部前序 Task
- Produces: 本地 CI 全绿的证据

- [ ] **Step 1: 写 E2E**

mock 模式**不建 WS 连接**（`useChatBootstrap.ts:457-460` 直接 return），
所以 E2E 只能经 store 注入验 UI 层：

```ts
// apps/web/e2e/call.spec.ts
test("来电弹层：出现、拒接后消失", async ({ page }) => {
  await setAuth(page);
  await waitForMSW(page);
  await page.evaluate(() => {
    // 直接推 store：mock 模式没有 WebSocket，真实信令无法在 E2E 里复现
    (window as any).__yuanchatCallStore__.getState().applyIncoming({
      /* … */
    });
  });
  await expect(page.getByRole("button", { name: "拒绝" })).toBeVisible();
  await page.getByRole("button", { name: "拒绝" }).click();
  await expect(page.getByRole("button", { name: "拒绝" })).toHaveCount(0);
});

test("通话记录气泡按 result 渲染本地化文案", async ({ page }) => {
  /* demoData 里的样本 */
});
```

需要在 `apps/web` 的 bootstrap 里把 store 暴露成 `window.__yuanchatCallStore__`
（**仅 `import.meta.env.DEV` 下**，生产构建不挂）。

- [ ] **Step 2: 跑本地 CI 全量**

```bash
node scripts/check-i18n.mjs
pnpm format:check && pnpm lint && pnpm stylelint && node scripts/check-theme-classes.mjs
pnpm turbo typecheck
LANG=C.UTF-8 pnpm test
pnpm --filter @yuanchat/web test:e2e
cd server && go vet ./... && go test ./... && go test -race ./internal/ws/
```

Expected: 全绿。任一项红即停下修，不往下走。

- [ ] **Step 3: 验证生产产物的 es2019 底线**

```bash
pnpm --filter @yuanchat/web build
grep -rlE '\?\.|\?\?|\|\|=|replaceAll|\.at\(' apps/web/dist/assets/*.js | grep -v mockServiceWorker || echo "es2019 OK"
```

Expected: 输出 `es2019 OK`。

- [ ] **Step 4: 提交**

```bash
git add apps/web/e2e packages/shared/src/mocks
git commit -m "test(call): 通话 UI 的 E2E 覆盖与 demo 通话记录样本"
```

---

### Task 14: 真机与真后端实测

**Files:** 无代码变更（发现缺陷则就地修复并单独 commit）

- [ ] **Step 1: Web ↔ Web 1v1 语音 + 视频**

```bash
pnpm dev:web
```

用 Playwright MCP 开两个 context 分别登录 Alice / Bob，A 呼 B、B 接听。
断言：双方 `connectionState === "connected"`、双向 `ontrack` 触发、通话时长在走。
抓 Bob socket 上的真实 `call.incoming` 帧，字段与 `contracts/server-frames.golden.json` 逐一对上。

- [ ] **Step 2: 强制 relay，证明 coturn 真在中继**

在页面控制台把 `RTCPeerConnection` 配置改成 `iceTransportPolicy: "relay"` 再走一遍。
断言：仍能接通，且 `getStats()` 里选中的候选对 `candidateType === "relay"`。
**这一步不能省** —— 不强制 relay 的话，同机通话靠 host candidate 就通了，coturn 是否可用完全没被验证。

- [ ] **Step 3: 桌面 Tauri 独立窗口**

```bash
pnpm dev:desktop
```

验证：主窗口收到来电 → 自动弹出通话窗口 → 窗口内接听 → 视频渲染 → 最小化变 320×72 并置顶 →
还原 → 关窗口即挂断（对端收到 `call.ended`）。CSP 违规 0 行、console 错误 0 行。
**Linux 上若 Task 1 的 spike 结论是不可用，此步改为验证"入口已按平台隐藏"。**

- [ ] **Step 4: Android 模拟器 ↔ Web 跨端**

```bash
$ANDROID_HOME/emulator/emulator -avd Medium_Phone -no-snapshot-load &
adb wait-for-device && pnpm dev:android
```

验证：模拟器与宿主浏览器互呼接通（**走 TURN-TCP**，确认 `adb reverse` 列表里有 3478）、
通话中切后台不断线（前台服务通知可见）、返回键在来电态=拒接 / 通话态=最小化、
软键盘与通话界面无冲突。

- [ ] **Step 5: 群通话三方 mesh**

Web × 2 + 桌面 × 1 三方接通，逐个离开：剩 2 人时通话继续，剩 1 人时房间终结、
所有人收到 `call.ended`、会话里出现一条通话记录。

- [ ] **Step 6: 掉线鲁棒性**

通话中直接杀掉一端（关窗口 / `kill` 进程）。另一端应在秒级看到对方离场并正确终结，
不是停在"通话中"。DB 里应有对应的通话记录系统消息。

- [ ] **Step 7: 通话记录五态 + 四语言**

分别造出 answered / missed / rejected / canceled / busy 五种记录，
逐一核对气泡文案与会话列表预览，并切到 en-US / ja-JP / ko-KR 各看一遍
（**列表预览必须是本地化的 `[通话]`，不能是中文**）。

- [ ] **Step 8: 关停全部实测环境**

```bash
pnpm dev:stop
adb emu kill
```

---

### Task 15: 文档回写与合并

**Files:** `docs/MASTER_PLAN.md`、`docs/ROADMAP.md`、`docs/CHAT_API.md`、`docs/ARCHITECTURE.md`、`docs/DEVELOPMENT.md`、`AGENTS.md`、`docs/superpowers/specs/2026-09-06-voice-video-call-design.md`

- [ ] **Step 1: MASTER_PLAN 状态回写**

- 阶段三清单：`- [ ] 语音/视频通话 (WebRTC)` → `- [x]`，补一行说明（1v1 + ≤4 人群通话 mesh、coturn、桌面独立窗口）
- K 泳道表：无对应编号，在「未做清单总览」新增小节 `#### 2.8 F0/F1/F2 — 语音与视频通话（✅ 已完成，2026-09-06）`，
  照 §2.7（K1）的体例写：设计/执行文档链接、分支、迁移号（**无**）、已交付面、真机实测结论表、
  发现并修掉的缺陷表、本批新登记的债表（照搬 spec §9 的 11 条 + 实测新发现的）
- 搭车收口的两条债在原表里改 ✅
- ROADMAP 的「待排 · 实时通话 F0+F1+F2」行改为 ✅ 已在 dev

- [ ] **Step 2: AGENTS.md 现状更新**

「未做」那一行删掉「音视频通话（WebRTC）」；已实现能力清单加通话条目
（含 8 个信令帧、coturn、桌面独立窗口、Android 前台服务）。

- [ ] **Step 3: 本地 CI 复跑一次并合回 dev**

```bash
node scripts/check-i18n.mjs && pnpm turbo typecheck && LANG=C.UTF-8 pnpm test \
  && pnpm --filter @yuanchat/web test:e2e \
  && (cd server && go vet ./... && go test ./... && go test -race ./internal/ws/)
git add docs AGENTS.md && git commit -m "docs(call): 通话批次回写四份主文档与未做清单"
git checkout dev && git merge --no-ff feature/voice-video-call
```

**`--no-ff` 且禁止 squash**（保留每个独立 commit）。合并前 CI 必须全绿。

- [ ] **Step 4: 推送**

```bash
git push origin dev
```

**推送前本地 CI 必须已全绿**（Step 3 已跑）。

---

## 自审记录

**Spec 覆盖检查**：spec §3.1（mesh 上限）→ Task 4 的 `MaxCallParticipants`；§3.2（连接级定址）→ Task 3；
§3.3（8 帧）→ Task 5；§3.4（媒体协商/glare）→ Task 8；§3.5（Redis + 3 Lua）→ Task 4；
§3.6（终结原因/通话记录）→ Task 4 + Task 6 + Task 9 Step 6；§3.7（TURN）→ Task 2；
§3.7.1（房间快照）→ Task 6；§3.8（前端结构）→ Task 7/8/9；§3.9（桌面窗口）→ Task 10；
§3.10（掉线离房）→ Task 3 + Task 5 Step 6 第 7 条；§3.11（Linux）→ Task 1；
§3.12（Android）→ Task 11；§3.13（铃声）→ Task 8；§5（契约）→ Task 5 Step 2 + Task 7 Step 6；
§6（测试）→ Task 13 + Task 14；§7（搭车债）→ Task 12；§9（留债登记）→ Task 15。

**类型一致性**：`CallService` 的方法签名在 Task 4 的 Interfaces 块定义，Task 5/6 按同名调用；
`PeerMesh` 的构造参数在 Task 8 定义，Task 9 按同名使用；`callMode` prop 在 Task 9 引入、Task 10 传值；
`window.__yuanchatCall__` 在 Task 11 两端同名。

**已知的执行期判断点**：Task 1 的 spike 结论若为「不可用」，Task 10 Step 3 需追加平台门控
（`CallView` 挂载前判 Linux 桌面则渲染不支持提示），Task 14 Step 3 相应改为验证入口隐藏。
