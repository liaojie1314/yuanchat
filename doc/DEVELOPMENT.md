# 元聊 YuanChat — 开发与打包指南

> **最后更新**：2026-06-16
>
> ⚠️ **文档维护规则**：任何 `package.json` scripts、Tauri 配置、环境变量的变更，**必须同步更新本文档**。此规则对所有会话生效。

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
├── doc/                  # 项目文档
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

## 一、Web 端

| 命令                                    | 说明                                           |
| --------------------------------------- | ---------------------------------------------- |
| `pnpm --filter @yuanchat/web dev`       | 启动 Vite dev server → `http://localhost:5173` |
| `pnpm --filter @yuanchat/web build`     | 生产构建 → `apps/web/dist/`                    |
| `pnpm --filter @yuanchat/web preview`   | 预览生产构建                                   |
| `pnpm --filter @yuanchat/web typecheck` | TypeScript 类型检查                            |

---

## 二、桌面端（Tauri 2）

Tauri 2 桌面端同时承担**桌面端**（Windows / macOS / Linux）和**移动端**（Android）的构建。

### 桌面端

| 命令                                          | 说明                                                      |
| --------------------------------------------- | --------------------------------------------------------- |
| `pnpm --filter @yuanchat/desktop tauri:dev`   | 启动 Vite + Tauri 窗口（devUrl: `http://localhost:1420`） |
| `pnpm --filter @yuanchat/desktop tauri:build` | 编译 Rust + 打包前端 → 生成安装包                         |
| `pnpm --filter @yuanchat/desktop typecheck`   | TypeScript 类型检查                                       |

窗口配置：

- 尺寸：540 × 600（固定，不可拉伸）
- 圆角：12px（CSS `html { border-radius: 12px }`）
- 标题栏：自定义（`decorations: false`）

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

---

## 四、Go 后端

| 命令                                                             | 说明                                |
| ---------------------------------------------------------------- | ----------------------------------- |
| `cd server && make dev`                                          | 启动 Gin HTTP 服务（:8080）         |
| `cd server && make build`                                        | 编译为 `server/bin/yuanchat-server` |
| `cd server && go test -v -race -coverprofile=coverage.out ./...` | 运行测试                            |

---

## 五、基础设施（Docker Compose）

```bash
docker compose -f deploy/docker-compose.yml up -d     # 启动
docker compose -f deploy/docker-compose.yml ps        # 状态
docker compose -f deploy/docker-compose.yml down      # 停止
```

---

## 六、Monorepo 全局命令

| 命令             | 说明                       |
| ---------------- | -------------------------- |
| `pnpm install`   | 安装所有 workspace 依赖    |
| `pnpm typecheck` | 所有包 TypeScript 类型检查 |
| `pnpm lint`      | ESLint 全量检查            |
| `pnpm build`     | 构建所有应用               |

---

## 七、环境变量

### 后端

| 变量             | 默认值           | 说明            |
| ---------------- | ---------------- | --------------- |
| `SERVER_ENV`     | `development`    | 运行环境        |
| `DB_HOST`        | `localhost`      | PostgreSQL 主机 |
| `DB_PORT`        | `5432`           | PostgreSQL 端口 |
| `DB_USER`        | `yuanchat`       | 数据库用户      |
| `DB_PASSWORD`    | —                | 数据库密码      |
| `DB_NAME`        | `yuanchat`       | 数据库名        |
| `REDIS_ADDR`     | `localhost:6379` | Redis 地址      |
| `JWT_SECRET`     | —                | JWT 签名密钥    |
| `MINIO_ENDPOINT` | `localhost:9000` | MinIO S3 端点   |

### 前端

| 变量                | 默认值                  | 说明           |
| ------------------- | ----------------------- | -------------- |
| `VITE_API_BASE_URL` | `http://localhost:8080` | 后端 API 地址  |
| `VITE_WS_URL`       | `ws://localhost:8081`   | WebSocket 地址 |

---

## 八、文档更新规则

1. 任何 `package.json` scripts 的**增删改**，必须同步更新本文档的对应章节
2. 任何 Tauri 配置（`tauri.conf.json`、`capabilities/`）的变更，必须同步更新本文档
3. 环境变量的**新增/修改/删除**，必须同步更新本文档第七章
4. 故障排查 / 踩坑记录 → 追加到 `.claude/TROUBLESHOOTING.md`（按平台分类）
5. 本文档和 `.claude/TROUBLESHOOTING.md` 必须并行更新，所有 AI 会话必须遵守此规则
