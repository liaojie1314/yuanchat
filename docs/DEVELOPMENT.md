# 元聊 YuanChat — 开发与打包指南

> **最后更新**：2026-07-27（v0.3.0：E2EE、PWA/Web Push、桌面自动更新、生产部署编排、管理后台）
>
> ⚠️ **文档维护规则**：任何 `package.json` scripts、Tauri 配置、环境变量、workflow 的变更，**必须同步更新本文档**。此规则对所有会话生效。

## 项目结构

```
yuanchat/
├── apps/
│   ├── desktop/          # Tauri 2 桌面端（含 Android 移动端）
│   │   ├── src/          # React UI 源码
│   │   ├── src-tauri/    # Tauri Rust 后端
│   │   └── package.json
│   └── web/              # Web 端（Vite + React）
│       ├── src/          # React UI 源码
│       └── package.json
├── packages/
│   ├── shared/           # 共享 Store、Hooks、类型
│   ├── ui/               # 共享 UI 组件（Button, Input, MainLayout 等）
│   └── design-system/    # Material 3 设计 Tokens、i18n、全局样式
├── server/               # Go 后端
├── deploy/               # Docker Compose 部署配置
├── docs/                 # 项目文档
├── pnpm-workspace.yaml   # pnpm monorepo 配置
└── turbo.json            # Turborepo 任务编排
```

所有命令在**项目根目录**执行，使用 `pnpm --filter` 指定目标应用。

## 前置条件

| 工具                 | 版本要求 | 用途                     |
| -------------------- | -------- | ------------------------ |
| Node.js              | ≥22      | 前端运行时               |
| pnpm                 | ≥10      | 包管理器                 |
| Rust                 | ≥1.80    | 桌面/移动端编译（Tauri） |
| Go                   | ≥1.22    | 后端                     |
| Docker               | ≥24      | 后端基础设施             |
| Android SDK + NDK 29 | —        | Android 移动端打包       |

### 一次性安装

```bash
pnpm install                # 安装所有 workspace 依赖
```

---

## 零、一键启动（推荐入口）

`scripts/dev.mjs` 按「目标端 × 数据模式」组合拉起完整开发环境：

| 命令                    | 数据模式 | 自动完成的步骤                                                                                             |
| ----------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `pnpm dev:web`          | 真实后端 | docker(pg/redis, `--wait` 健康检查) → seed（幂等）→ Go 服务（REST :8085 + WS :8086，健康检查）→ Vite :5173 |
| `pnpm dev:web:mock`     | Mock     | 仅 Vite :5173（MSW + demo 数据，无需后端/数据库）                                                          |
| `pnpm dev:desktop`      | 真实后端 | 同 dev:web 的后端链 → `tauri dev`（桌面窗口，Vite :1420）                                                  |
| `pnpm dev:desktop:mock` | Mock     | 仅 `tauri dev`                                                                                             |
| `pnpm dev:android`      | 真实后端 | 后端链 → `adb reverse tcp:8085/8086`（设备直连宿主机后端）→ `tauri android dev`                            |
| `pnpm dev:android:mock` | Mock     | 仅 `tauri android dev`（需 ANDROID_HOME，见第三章）                                                        |
| `pnpm dev:server`       | —        | 仅后端链（docker → seed → Go 服务），前端另起                                                              |
| `pnpm dev:stop`         | —        | 停止 5173/1420/8085/8086 上的进程 + `docker compose stop`                                                  |

行为约定：

- **Ctrl+C**：终止本次拉起的应用进程与 Go 服务（按进程组 kill，`go run` 的子二进制不会残留）；docker 容器保留以加速下次启动
- **彻底清理**：`pnpm dev:stop`
- Go 工具链不在 PATH 时自动兜底 `/home/liaojie1314/env/go/go/bin`
- 真实模式测试账号见第四章

以下章节为**分步启动**方式（调试单个环节时使用）。

---

## 一、Web 端

| 命令                                     | 说明                                                           |
| ---------------------------------------- | -------------------------------------------------------------- |
| `pnpm --filter @yuanchat/web dev`        | 启动 Vite dev server（**Mock 模式**）→ `http://localhost:5173` |
| `pnpm --filter @yuanchat/web dev:mock`   | 同 `dev`，显式 Mock 模式                                       |
| `pnpm --filter @yuanchat/web dev:real`   | 启动 Vite dev server（**连接真实后端**）                       |
| `pnpm --filter @yuanchat/web dev:test`   | 启动 Vite dev server（**test 环境**，连接测试服务器）          |
| `pnpm --filter @yuanchat/web build`      | 生产构建 → `apps/web/dist/`                                    |
| `pnpm --filter @yuanchat/web build:test` | 测试环境构建 → `apps/web/dist/`                                |
| `pnpm --filter @yuanchat/web preview`    | 预览生产构建                                                   |
| `pnpm --filter @yuanchat/web typecheck`  | TypeScript 类型检查                                            |

### Mock 接口 vs 真实后端

前端开发阶段使用 **MSW (Mock Service Worker)** 拦截 API 请求，无需启动后端即可完成登录/注册/首页全流程。

| 命令               | `VITE_ENABLE_MOCK` | 行为                                                     |
| ------------------ | ------------------ | -------------------------------------------------------- |
| `dev` / `dev:mock` | 未设置（默认启用） | 浏览器 Service Worker 拦截 API，返回 mock 数据           |
| `dev:real`         | `false`            | 所有请求直连 `http://localhost:8085`（需先启动 Go 后端） |

**切换方式**：

- 命令行：`pnpm --filter @yuanchat/web dev:real`
- 环境变量：`VITE_ENABLE_MOCK=false pnpm --filter @yuanchat/web dev`
- 已登录状态下刷新页面不影响 mock/real 模式

**Mock 覆盖的接口**：

- `POST /api/v1/users/login` — 账号（手机号/邮箱）+ 密码登录（密码 `wrong` 测试错误）
- `POST /api/v1/users/register` — 手机号 + 密码 + 验证码 + 昵称注册
- `POST /api/v1/auth/logout` — 登出（始终返回成功，300ms 延迟）
- `GET /api/v1/captcha` — SVG 验证码

**聊天数据的 Mock**：会话列表与消息不走 MSW，而是由 `useChatBootstrap` 在
Mock 模式下直接注入 demo 数据（`packages/shared/src/mocks/demoData.ts`），
发送消息用 setTimeout 模拟「送达→已读」回执，无需任何后端。

> **桌面端同理**：`pnpm --filter @yuanchat/desktop dev:mock` / `dev:real`，或 `pnpm tauri:dev` 前设置 `VITE_ENABLE_MOCK`。

---

## 二、桌面端（Tauri 2）

Tauri 2 桌面端同时承担**桌面端**（Windows / macOS / Linux）和**移动端**（Android）的构建。

### 桌面端

| 命令                                          | 说明                                                      |
| --------------------------------------------- | --------------------------------------------------------- |
| `pnpm --filter @yuanchat/desktop dev`         | 仅启动 Vite dev server（**Mock 模式**）                   |
| `pnpm --filter @yuanchat/desktop dev:mock`    | 同 `dev`，显式 Mock 模式                                  |
| `pnpm --filter @yuanchat/desktop dev:real`    | Vite dev server（**连接真实后端**）                       |
| `pnpm --filter @yuanchat/desktop dev:test`    | Vite dev server（**test 环境**，连接测试服务器）          |
| `pnpm --filter @yuanchat/desktop build`       | 生产构建（含 tsc 检查）                                   |
| `pnpm --filter @yuanchat/desktop build:test`  | 测试环境构建                                              |
| `pnpm --filter @yuanchat/desktop tauri:dev`   | 启动 Vite + Tauri 窗口（devUrl: `http://localhost:1420`） |
| `pnpm --filter @yuanchat/desktop tauri:build` | 编译 Rust + 打包前端 → 生成安装包                         |
| `pnpm --filter @yuanchat/desktop typecheck`   | TypeScript 类型检查                                       |

窗口配置：

- 登录页尺寸：540 × 600（固定，不可拉伸）
- 登录后自动切换为首页尺寸：1200 × 800（可拉伸，最小 900 × 600）
- 标题栏：自定义（`decorations: false`），含最小化/最大化/关闭按钮

构建产物位置：`apps/desktop/src-tauri/target/release/bundle/`

| 平台    | 产物格式                    |
| ------- | --------------------------- |
| Linux   | `.deb`, `.rpm`, `.AppImage` |
| macOS   | `.dmg`, `.app`              |
| Windows | `.msi`, `.exe`              |

---

## 三、移动端（Android，通过 Tauri 2）

Tauri 2 原生支持 Android 目标，复用桌面端的同一份 Rust + React 代码。

### 首次初始化

```bash
export ANDROID_HOME=/path/to/Android/Sdk
export JAVA_HOME=/usr/local/java/bellsoft-jdk17.0.11
pnpm --filter @yuanchat/desktop tauri android init
```

### 开发模式（需要模拟器或真机）

```bash
# 查看可用 AVD（模拟器列表）
$ANDROID_HOME/emulator/emulator -list-avds

# 1. 启动模拟器（选择一个 AVD）
$ANDROID_HOME/emulator/emulator -avd Medium_Phone_API_29 &

# 2. 等待模拟器启动
adb wait-for-device

# 3. 启动 Tauri Android 开发（Vite 由 beforeDevCommand 自动启动）
export ANDROID_HOME=/path/to/Android/Sdk
export JAVA_HOME=/usr/local/java/bellsoft-jdk17.0.11
pnpm --filter @yuanchat/desktop tauri android dev
# ⚠️ 保持终端运行！关闭终端 = Vite 停止 = 白屏
```

> **工作原理**：Tauri 通过 `adb forward` 将模拟器的 `localhost:1420` 转发到宿主机，所以无需设置 `TAURI_DEV_HOST`。`vite.config.ts` 中 `host` 固定为 `"0.0.0.0"` 确保所有接口可达；HMR WebSocket 复用同一 `localhost:1420` 隧道（`hmr.host: "localhost"`、`hmr.port: 1420`）。
>
> **HMR 热重载失败**：若页面能打开但改代码不刷新、控制台报
> `ws://0.0.0.0:1421 ... ERR_CONNECTION_REFUSED` —— `hmr.host` **不能**设为 `"0.0.0.0"`
> （那是服务端绑定地址，浏览器无法作为连接目标），且 1421 端口未被 `adb reverse` 转发。
> 正确做法：`hmr` 复用页面所在的 `localhost:1420` 隧道。
>
> **白屏问题**：如果应用白屏，分两类排查：
>
> **A. 页面完全空白且终端无报错（JS 语法不兼容）** — 最隐蔽，详见
> [`.claude/TROUBLESHOOTING.md`](../.claude/TROUBLESHOOTING.md) 的「应用白屏（旧 WebView 语法不兼容）」。
> 要点：旧 Android（如 API 29 自带 **Chrome 74**）的 System WebView 不支持
> `?.` / `??`（ES2020，需 Chrome 80+）。
>
> - **生产构建**：`vite.config.ts` 的 `build.target` 必须为 `es2019`（转译掉 `?.`/`??`），
>   **不能**用 `chrome105`/`es2020`，否则 esbuild 原样保留 → 旧 WebView 解析期 SyntaxError → 白屏。
> - **`tauri android dev`（开发模式）**：Vite 自带的 `@vite/client`、`@react-refresh` 本身就用
>   `?.`/`??`，无法转译，因此 **dev 模式无法在 Chrome 74 上运行**。请使用搭载现代 WebView 的
>   模拟器/真机（Android 7+ 且 System WebView ≥ Chrome 80）。已实测可用：
>   **`Medium_Phone`（API 35 / Android 15 / WebView Chrome 124）** —— dev 模式登录页正常渲染、HMR 正常。
>   旧的 `Medium_Phone_API_29`（Chrome 74）仅可用于 `tauri android build` 出的生产 APK。
>
> **B. 连接/可达性问题**：
>
> 1. Vite 是否在运行：`curl http://localhost:1420` 应返回 HTML
> 2. 端口转发是否生效：`adb forward --list` 应包含 `tcp:1420`
> 3. 终端是否还开着：关闭终端会杀死 Vite
> 4. `vite.config.ts` 中 `host` 是否为 `"0.0.0.0"`

首次编译需要下载 Rust Android 目标 + Gradle 依赖，约 5-15 分钟。后续增量编译仅需数十秒。

### 真机调试（Android）

```bash
# 1. 手机开启「USB 调试」，USB 连接电脑
adb devices                       # 应列出设备序列号

# 2. 若显示 unauthorized，手机上点击「允许 USB 调试」

# 3. 启动（Tauri 会自动安装 APK 并启动）
pnpm --filter @yuanchat/desktop tauri android dev
```

**无线调试（Android 11+）**：

```bash
# 手机「设置」→「开发者选项」→「无线调试」→ 查看配对码
adb pair <ip>:<port>             # 输入配对码（仅首次）
adb connect <ip>:<port>          # 连接设备
pnpm --filter @yuanchat/desktop tauri android dev
```

### 生产构建（APK / AAB）

```bash
pnpm --filter @yuanchat/desktop tauri android build
```

构建产物位置：`apps/desktop/src-tauri/gen/android/app/build/outputs/`

> 常见问题排查见 [`.claude/TROUBLESHOOTING.md`](../.claude/TROUBLESHOOTING.md)

### `gen/android` 的版本控制约定

`apps/desktop/src-tauri/gen/android` **纳入版本控制**（不整体忽略），因为它含手改源码：

- `app/src/main/java/.../MainActivity.kt` — 用户扩展点，Tauri **只生成一次、构建不覆盖**
  （被覆盖的是 `generated/TauriActivity.kt`）。当前含**软键盘适配**的 `WindowInsets` 监听，
  软键盘弹起时把 IME 高度作为 padding 应用到内容区（详见 `.claude/TROUBLESHOOTING.md`
  「软键盘遮挡输入框」）。
- `app/src/main/AndroidManifest.xml`、`build.gradle.kts`、`res/`、Gradle Wrapper 等。

构建产物（`build/`、`.gradle/`、`.cxx/`、`jniLibs/**/*.so`、`generated/`）由 Tauri 内置于
`gen/android/.gitignore` 与 `gen/android/app/.gitignore` 精确排除，**勿**手动 `git add -f` 这些目录。

> ⚠️ 不要对已有工程重跑 `tauri android init`（会覆盖脚手架）。若必须重跑，在干净分支上做，
> 再 diff 回填 `MainActivity.kt` 的软键盘改动。

---

## 四、Go 后端

> Go 工具链位置：`/home/liaojie1314/env/go/go/bin`（若 `go` 不在 PATH：`export PATH=/home/liaojie1314/env/go/go/bin:$PATH`）

| 命令                                                             | 说明                                               |
| ---------------------------------------------------------------- | -------------------------------------------------- |
| `cd server && make dev`                                          | 启动服务（REST :8085 + WebSocket :8086，同一进程） |
| `cd server && go run ./cmd/server`                               | 等价于 make dev                                    |
| `cd server && go run ./cmd/seed`                                 | 灌入联调测试数据（幂等，可重复执行）               |
| `cd server && make build`                                        | 编译为 `server/bin/yuanchat-server`                |
| `cd server && go test -v -race -coverprofile=coverage.out ./...` | 运行测试                                           |

### 聊天功能联调（前端 + 后端全链路）

> 一键完成下面全部步骤：`pnpm dev:web`（详见第零章）。以下为手动分步方式。

```bash
# 1. 启动基础设施（PostgreSQL :5434 + Redis :6380）
docker compose -f deploy/docker-compose.yml up -d

# 2. 灌入测试数据（3 个用户 + 单聊 + 群聊 + 历史消息）
cd server && go run ./cmd/seed

# 3. 启动后端（REST :8085 + WS :8086）
go run ./cmd/server

# 4. 另开终端，启动前端（真实模式，关闭 MSW）
pnpm --filter @yuanchat/web dev:real
```

**测试账号**（密码均为 `Test@1234`）：

| 昵称  | 手机号（登录账号） | 说明                                   |
| ----- | ------------------ | -------------------------------------- |
| Alice | `13800000001`      | 单聊（Bob）+ 群聊（群主）；好友 Bob    |
| Bob   | `13800000002`      | 单聊（Alice、Carol）+ 群聊；好友双向   |
| Carol | `13800000003`      | 单聊（Bob）+ 群聊；有发给 Alice 的申请 |

两个浏览器（或普通+隐身窗口）分别登录 Alice / Bob 即可互发消息，验证实时收发、已读回执（双勾变蓝）、正在输入、未读角标。

通讯录联调：登录 Alice → 通讯录「新的朋友」有 Carol 的待处理申请（同意后自动建单聊 + 打招呼消息）；「+」添加联系人支持手机号 / 元聊号 / 邮箱精确搜索。

> 聊天 REST 端点与 WebSocket 协议详见 [`docs/02_CHAT_API.md`](./02_CHAT_API.md)。

---

## 五、基础设施（Docker Compose）

```bash
docker compose -f deploy/docker-compose.yml up -d     # 启动
docker compose -f deploy/docker-compose.yml ps        # 状态
docker compose -f deploy/docker-compose.yml down      # 停止
```

Compose 含三个服务：**PostgreSQL**（`:5434`→5432）、**Redis**（`:6380`→6379）、**MinIO**（对象存储，图片/文件/头像）。

> 宿主机端口整体避让本机 yuanai 项目占用的 5433/6379/9000/9001。

### MinIO（对象存储）

图片消息、文件、头像的对象存储，随 compose 一并启动，无需单独安装。

| 端口    | 用途                                                            |
| ------- | --------------------------------------------------------------- |
| `:9002` | S3 API 端点（后端签发预签名 URL、前端直传/下载都走它）          |
| `:9003` | Web 控制台（浏览器打开 `http://localhost:9003` 可视化管理对象） |

- **控制台账号**（开发默认，见 `deploy/docker-compose.yml` 与 `server/config/config.yaml`）：
  用户名 `yuanchat_minio` / 密码 `yuanchat_minio_dev`，默认桶 `yuanchat`。
- **健康检查**：`curl http://localhost:9002/minio/health/live` 返回 200 即就绪。
- 后端首次连接时幂等创建 `yuanchat` 桶，并对 `avatars/` 前缀开放匿名公共读（头像用永久 public URL，
  免签名）；图片消息落 `images/` 前缀，文件/语音消息落 `files/` 前缀，均走一次性预签名 GET
  （详见 `docs/02_CHAT_API.md` 的 files 端点）。
- **上传 MIME 白名单**（`server/config/config.yaml` 的 `upload.allowed_types`）：图片 4 类
  （jpeg/png/gif/webp）+ 文档（pdf/doc/docx/xlsx/pptx/txt/zip）+ 语音 `audio/webm`。
  新增可传类型时在此追加，重启后端生效；白名单外的 MIME 在 `upload-url` 阶段被 `4001` 拒绝。

> **真机联调注意**：MinIO 预签名 URL 里的 host 来自 `minio.endpoint`（默认 `localhost:9002`）。
> 手机/平板真机访问宿主机的 `localhost` 会指向设备自身而非开发机，导致图片上传/下载失败。
> 真机联调时须把 `server/config/config.yaml` 的 `minio.endpoint` 改为开发机的**局域网 IP**
> （如 `192.168.1.100:9002`），并确保防火墙放行 9002 端口；后端据此签名，真机才能直连对象存储。

---

## 六、打包构建（Desktop + Android）

`pnpm build`（即 `turbo build`）**仅构建前端代码**（Vite → JS/CSS 产物），不生成安装包。

生成可安装的桌面端/安卓端安装包，使用**交互式打包脚本**：

```bash
pnpm build:pkg
# 或直接运行
node scripts/build.mjs
```

### 交互流程

脚本会逐步询问以下选项：

1. **构建目标**：桌面端 / 安卓端 / 全平台
2. **构建类型**：正式包（Release）/ 调试包（Debug）
3. **桌面端格式**（当前平台自动检测可用格式）：

   | 平台    | 可选格式                 |
   | ------- | ------------------------ |
   | Linux   | `deb`, `AppImage`, `rpm` |
   | macOS   | `dmg`, `app`             |
   | Windows | `msi`, `nsis`            |

4. **安卓端输出**：`APK` / `AAB` / 两者
5. **安卓端架构**：ARM64、ARMv7、x86（模拟器）、x86_64
6. **安卓端拆分**：是否按 ABI 拆分（减小 APK 体积）
7. **确认摘要** → 开始构建

### 示例

```bash
$ pnpm build:pkg

╔══════════════════════════════════════╗
║   元聊 YuanChat — 交互式打包工具   ║
╚══════════════════════════════════════╝

当前平台: linux

1. 选择构建目标
  [1] 桌面端 (Windows/macOS/Linux)
  [2] 安卓端 (APK / AAB)
  [3] 全平台 (桌面 + 安卓)
请输入选项编号: 1

2. 选择构建类型
  [1] 正式包 (Release) — 优化体积和性能
  [2] 调试包 (Debug) — 包含调试符号，方便排查问题
请输入选项编号: 1

3. 选择桌面端打包格式
  [1] deb — Debian/Ubuntu (推荐 Linux)
  [2] AppImage — 通用 Linux 免安装
  [3] rpm — Fedora/RHEL/CentOS
  输入编号（逗号分隔），或直接回车选择全部
请输入: 1

╔══════════════════════════════════════╗
║           构建摘要                  ║
╚══════════════════════════════════════╝
  构建目标:     桌面端
  构建类型:     正式包 (Release)
  桌面端格式:   deb
  工作目录: apps/desktop

确认开始构建？[Y/n]: y

▶ npx tauri build --bundles deb
...
✅ 桌面端构建完成！
```

### 构建产物位置

| 平台   | 路径                                                                          |
| ------ | ----------------------------------------------------------------------------- |
| 桌面端 | `apps/desktop/src-tauri/target/release/bundle/`（debug 时为 `debug/bundle/`） |
| 安卓端 | `apps/desktop/src-tauri/gen/android/app/build/outputs/`                       |

### 纯命令行打包（不使用交互脚本）

如果需要 CI/CD 集成，可直接使用 Tauri 命令行：

```bash
# 桌面端正式包
npx tauri build                          # apps/desktop 目录下执行

# 桌面端调试包
npx tauri build --debug

# 仅打 deb
npx tauri build --bundles deb

# 安卓端正式包
npx tauri android build

# 安卓端调试包（APK）
npx tauri android build --debug --apk

# 安卓端 AAB + 按 ABI 拆分
npx tauri android build --aab --split-per-abi --target aarch64
```

---

## 七、Monorepo 全局命令

| 命令             | 说明                                   |
| ---------------- | -------------------------------------- |
| `pnpm install`   | 安装所有 workspace 依赖                |
| `pnpm dev:*`     | **一键启动**（见第零章）               |
| `pnpm dev:stop`  | 停止一键启动拉起的全部进程与容器       |
| `pnpm typecheck` | 所有包 TypeScript 类型检查             |
| `pnpm lint`      | ESLint 全量检查                        |
| `pnpm build`     | 构建所有应用（**仅前端 JS/CSS**）      |
| `pnpm build:pkg` | **交互式打包**（桌面安装包 + APK/AAB） |

---

## 八、环境变量

### 后端

| 变量               | 默认值               | 说明                                           |
| ------------------ | -------------------- | ---------------------------------------------- |
| `SERVER_ENV`       | `development`        | 运行环境                                       |
| `DB_HOST`          | `localhost`          | PostgreSQL 主机                                |
| `DB_PORT`          | `5434`               | PostgreSQL 端口（compose 宿主机映射）          |
| `DB_USER`          | `yuanchat`           | 数据库用户                                     |
| `DB_PASSWORD`      | —                    | 数据库密码                                     |
| `DB_NAME`          | `yuanchat`           | 数据库名                                       |
| `REDIS_ADDR`       | `localhost:6380`     | Redis 地址                                     |
| `JWT_SECRET`       | —                    | JWT 签名密钥                                   |
| `MINIO_ENDPOINT`   | `localhost:9002`     | MinIO S3 端点（真机联调改局域网 IP，见第五章） |
| `MINIO_ACCESS_KEY` | `yuanchat_minio`     | MinIO 访问密钥（对应控制台用户名）             |
| `MINIO_SECRET_KEY` | `yuanchat_minio_dev` | MinIO 私有密钥（对应控制台密码）               |

### 前端

前端通过 Vite 的 `--mode` 自动加载对应的 `.env.[mode]` 文件：

| 模式          | 配置文件                   | Mock | API 地址示例                   |
| ------------- | -------------------------- | ---- | ------------------------------ |
| `development` | `apps/*/\.env.development` | 开启 | `http://localhost:8085`        |
| `test`        | `apps/*/\.env.test`        | 关闭 | `http://test-api.yuanchat.com` |
| `production`  | `apps/*/\.env.production`  | 关闭 | `https://api.yuanchat.com`     |

> **注意**：`--mode test` 时 `import.meta.env.DEV` 为 `false`，MSW 不会启动。`--mode development` 为 Vite 默认模式，无需显式指定。

| 变量                | 默认值                  | 说明                    |
| ------------------- | ----------------------- | ----------------------- |
| `VITE_API_BASE_URL` | `http://localhost:8085` | 后端 API 地址           |
| `VITE_WS_URL`       | `ws://localhost:8086`   | WebSocket 地址          |
| `VITE_ENABLE_MOCK`  | —                       | `false` 时关闭 MSW Mock |

---

## 九、测试

### 前端测试

| 包                       | 测试框架                 | 环境  | 覆盖内容                                                                                    |
| ------------------------ | ------------------------ | ----- | ------------------------------------------------------------------------------------------- |
| `packages/shared`        | Vitest                   | node  | Store（auth/theme/conversation）、Utils（cn/formatTime/truncate/validate\*/getAvatarColor） |
| `packages/ui`            | Vitest + Testing Library | jsdom | React 组件（Avatar/Button/Input/ChatWindow 等）                                             |
| `packages/design-system` | Vitest                   | node  | Tokens、Skins、i18n                                                                         |

#### 常用命令

| 命令                                           | 说明                                     |
| ---------------------------------------------- | ---------------------------------------- |
| `pnpm test`                                    | 运行**全部**测试（通过 Turborepo 编排）  |
| `pnpm test:coverage`                           | 运行全部测试 + 生成覆盖率报告            |
| `pnpm --filter @yuanchat/shared test`          | 仅运行 shared 包测试                     |
| `pnpm --filter @yuanchat/shared test:watch`    | shared 包 watch 模式（改代码自动重跑）   |
| `pnpm --filter @yuanchat/shared test:coverage` | shared 包测试 + 覆盖率（text/html/lcov） |
| `pnpm --filter @yuanchat/shared test:ui`       | shared 包 Vitest UI 界面模式             |
| `pnpm --filter @yuanchat/ui test`              | 仅运行 UI 组件测试                       |
| `pnpm --filter @yuanchat/design-system test`   | 仅运行设计系统测试                       |

#### 覆盖率报告

```
packages/shared/coverage/
├── index.html          # HTML 覆盖率报告（浏览器打开）
├── lcov.info           # LCOV 格式（CI 集成用）
└── coverage-summary.json
```

在浏览器打开 `packages/shared/coverage/index.html` 可逐行查看覆盖情况。

#### 测试文件规范

- 测试文件与源文件同目录，放在 `__tests__/` 子目录下
- 命名：`<模块名>.test.ts` 或 `<模块名>.test.tsx`
- Vitest 配置：各包根目录下的 `vitest.config.ts`
- UI 组件测试 setup：`packages/ui/src/__tests__/setup.ts`（引入 `@testing-library/jest-dom`）

#### 覆盖率阈值

`packages/shared` 设置了最低覆盖率阈值（`vitest.config.ts`）：

| 指标       | 阈值 |
| ---------- | ---- |
| statements | 60%  |
| branches   | 50%  |
| functions  | 60%  |
| lines      | 60%  |

低于阈值时 CI 失败。

### Go 后端测试

| 命令                                                    | 说明                                          |
| ------------------------------------------------------- | --------------------------------------------- |
| `cd server && go test ./...`                            | 运行所有测试                                  |
| `cd server && go test -v -race ./...`                   | 详细输出 + 竞态检测                           |
| `cd server && go test -coverprofile=coverage.out ./...` | 生成覆盖率文件                                |
| `cd server && go tool cover -html=coverage.out`         | 浏览器查看覆盖率（逐行标注）                  |
| `cd server && go tool cover -func=coverage.out`         | 终端查看各函数覆盖率                          |
| `cd server && make test`                                | Makefile 封装的测试命令（含 race + coverage） |
| `cd server && go test -short ./...`                     | 跳过集成测试，仅跑单元测试                    |

#### 已有测试覆盖

| 包                      | 测试文件               | 内容                                          |
| ----------------------- | ---------------------- | --------------------------------------------- |
| `internal/pkg/jwt`      | `jwt_test.go`          | Token 生成/验证/过期/无效                     |
| `internal/pkg/password` | `password_test.go`     | bcrypt 哈希/验证/盐值                         |
| `internal/service`      | `user_service_test.go` | 密码哈希、strPtr、错误常量                    |
| `internal/ws`           | `hub_test.go`          | Hub 注册/注销、多设备投递、连接上限、并发安全 |
| `internal/ws`           | `protocol_test.go`     | WS 信封编解码                                 |

> **注意**：`UserService` 依赖具体的 `*repository.UserRepository` 而非接口，完整的 Register/Login/Profile 集成测试需要连接测试数据库或重构为接口注入。

### E2E 端到端测试

**框架**：Playwright（Chromium，headless）
**环境**：测试自动启动 Vite dev server（Mock 模式，`VITE_ENABLE_MOCK=true`），使用 MSW Service Worker 拦截所有 API 调用，无需真实后端。

**测试文件位置**：`apps/web/e2e/`

#### 命令

| 命令                                                      | 说明                               |
| --------------------------------------------------------- | ---------------------------------- |
| `pnpm --filter @yuanchat/web test:e2e`                    | 运行 E2E 测试（headless Chromium） |
| `pnpm --filter @yuanchat/web test:e2e:ui`                 | 交互式 UI 模式运行                 |
| `pnpm --filter @yuanchat/web test:e2e:debug`              | 调试模式（逐个断点）               |
| `pnpm --filter @yuanchat/web exec playwright show-report` | 打开最新测试报告                   |

#### 覆盖范围

| 测试文件                        | 覆盖内容                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `e2e/login.spec.ts`             | 登录成功/失败、表单校验错误、API 错误、Enter 快捷键                             |
| `e2e/register.spec.ts`          | 注册成功/失败、表单校验、验证码加载/刷新、Enter 快捷键                          |
| `e2e/logout.spec.ts`            | 登出跳转、localStorage 清除、登出后路由守卫                                     |
| `e2e/route-guards.spec.ts`      | 未登录重定向（/ → /login）、已登录重定向（/login → /chat）                      |
| `e2e/navigation.spec.ts`        | 登录/注册页间跳转、表单状态独立                                                 |
| `e2e/authenticated-nav.spec.ts` | 已登录状态下聊天/通讯录/收藏/设置四大区域可访问、侧边栏导航链接                 |
| `e2e/search.spec.ts`            | Ctrl/Meta+K 打开搜索弹窗、输入框自动聚焦、Escape/关闭按钮关闭                   |
| `e2e/favorites.spec.ts`         | 收藏页可访问、四个分类 Tab 按钮可见且可点击                                     |
| `e2e/stickers.spec.ts`          | 贴纸两 tab 渲染、官方/收藏列表数量、发贴纸、图片→收藏、删除收藏、缩略图真实出图 |

#### 测试文件结构

```
apps/web/e2e/
├── playwright.config.ts          # Playwright 配置（webServer 自动启动 Vite）
├── fixtures/
│   └── auth.fixture.ts           # localStorage 认证状态设置/清除
├── pages/
│   ├── LoginPage.ts              # 登录页 Page Object Model
│   └── RegisterPage.ts           # 注册页 Page Object Model
├── utils/
│   └── msw.ts                    # MSW Service Worker 就绪等待工具
├── login.spec.ts
├── register.spec.ts
├── logout.spec.ts
├── route-guards.spec.ts
├── navigation.spec.ts
├── authenticated-nav.spec.ts     # 已登录导航（聊天/通讯录/收藏/设置）
├── search.spec.ts                # Cmd/Ctrl+K 全局搜索弹窗
└── favorites.spec.ts             # 收藏页可访问 + Tab 过滤
```

---

## 十、CI/CD 与发版

### CI（每次 push / PR 触发）

`.github/workflows/ci.yml`：dev / main 分支的 push + PR 触发，三个 job（`e2e` 依赖 `frontend` 完成后串行，`backend` 独立并行）：

| Job        | 依赖       | 内容                                                                                       |
| ---------- | ---------- | ------------------------------------------------------------------------------------------ |
| `frontend` | —          | `pnpm test`（全部 workspace）+ `apps/web` 和 `apps/desktop` 分别 `tsc --noEmit`            |
| `e2e`      | `frontend` | Playwright headless Chromium，MSW mock 模式（无需后端）；失败时上传 playwright-report 附件 |
| `backend`  | —          | `go vet ./...` + `go test ./...` + `go test -race ./internal/ws/`                          |

### Release（tag `v*` push 触发）

`.github/workflows/release.yml`：并行打包 5 类产物 → 自动上传到 GitHub Release：

| Job                 | Runner         | 产物                                                      |
| ------------------- | -------------- | --------------------------------------------------------- |
| `web`               | ubuntu-latest  | `yuanchat-web-vX.Y.Z.tar.gz`（Vite dist）                 |
| `desktop (linux)`   | ubuntu-22.04   | `.deb` + `.AppImage`                                      |
| `desktop (windows)` | windows-latest | `.msi` + `.exe`                                           |
| `desktop (macos)`   | macos-latest   | `.dmg`（`universal-apple-darwin` = Intel + M 系列）       |
| `android`           | ubuntu-22.04   | `.apk`（`--split-per-abi`：arm64-v8a/armeabi-v7a/x86_64） |

### 发版命令（本地在 main 分支执行）

```bash
git checkout main
pnpm release            # 交互式，选 patch/minor/major
pnpm release:patch      # 0.1.0 → 0.1.1
pnpm release:minor      # 0.1.0 → 0.2.0
pnpm release:major      # 0.1.0 → 1.0.0
pnpm release:dry        # 模拟运行
```

release-it 会：跑 `pnpm test` 前置门禁 → bump version → 同步 `apps/*/package.json` +
`tauri.conf.json` 版本号（`scripts/sync-version.mjs`）→ 生成/更新 `CHANGELOG.md` →
commit + tag `vX.Y.Z` + push → 在 GitHub 创建 draft Release。

**tag push 的瞬间**触发 release workflow，20-30 分钟后所有产物 attach 到 draft，
手动 publish 即完成发布。

### GitHub Secrets（一次性配置）

Android 签名必需：

- `ANDROID_KEYSTORE_BASE64` — release keystore 的 base64
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

macOS / Windows 代码签名（可选，用 `if` 门控——secrets 存在时才签）：

- `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `APPLE_SIGNING_IDENTITY`
- `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`（notarize 用）
- `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（更新签名，未来做自动更新用）

完整流程、keystore 生成命令、签名策略详见 **[docs/RELEASE.md](RELEASE.md)**。

---

## 十一、文档更新规则

1. 任何 `package.json` scripts 的**增删改**，必须同步更新本文档的对应章节
2. 任何 Tauri 配置（`tauri.conf.json`、`capabilities/`）的变更，必须同步更新本文档
3. 环境变量的**新增/修改/删除**，必须同步更新本文档第七章
4. 故障排查 / 踩坑记录 → 追加到 `.claude/TROUBLESHOOTING.md`（按平台分类）
5. 本文档和 `.claude/TROUBLESHOOTING.md` 必须并行更新，所有 AI 会话必须遵守此规则
6. `.github/workflows/` 的变更须同步更新本文档"CI/CD 与发版"章节，签名策略变化须更新 `docs/RELEASE.md`
