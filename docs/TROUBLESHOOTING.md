# 元聊 YuanChat — 常见问题排查

> AI 上下文文件，与 `doc/DEVELOPMENT.md` 并行维护。新问题追加到对应平台章节末尾。

## Windows

### Gradle 代理错误：`Connect to 127.0.0.1:7890 failed`

**原因**：全局 `~/.gradle/gradle.properties` 中配置了代理（通常为 Clash 等工具），但代理进程未运行或被防火墙阻止。

**解决**：在项目的 `apps/desktop/src-tauri/gen/android/gradle.properties` 末尾显式置空：

```properties
systemProp.http.proxyHost=
systemProp.http.proxyPort=
systemProp.https.proxyHost=
systemProp.https.proxyPort=
```

### Cargo 下载 crate 失败（proxy / SSL 错误）

**原因**：Cargo 读取了 git config 或环境变量中的代理配置，但代理不可达。

**解决**：

```bash
export CARGO_HTTP_PROXY=""
export CARGO_HTTPS_PROXY=""
```

## Desktop (Tauri)

### `JAVA_HOME is set to an invalid directory`

**原因**：`JAVA_HOME` 指向了 jenv shim 路径而非实际 JDK 目录。

**解决**：

```bash
export JAVA_HOME=$(dirname $(dirname $(readlink -f $(which java))))
```

### `pnpm tauri:dev` 后窗口白屏 / 空白

**原因**：Vite dev server 未启动或端口被占用。

**解决**：

1. 确认 `http://localhost:1420` 可访问
2. 检查终端是否有 Vite 启动日志
3. `lsof -i :1420` 确认端口未被占用

### 点击「立即注册」无反应

**原因**：Tauri 权限不足，缺少 `core:webview:allow-create-webview-window`。

**解决**：检查 `apps/desktop/src-tauri/capabilities/default.json` 是否包含：

```json
"core:webview:allow-create-webview-window"
```

### 注册窗口创建失败 (tauri://error)

**原因**：权限配置不完整。

**解决**：确认 `capabilities/default.json` 包含以下全部权限：

```json
"windows": ["main", "register", "login"],
"permissions": [
  "core:default",
  "core:webview:allow-create-webview-window",
  "core:window:allow-close",
  "core:window:allow-set-focus",
  "core:window:allow-center",
  "core:window:allow-minimize",
  "core:window:allow-start-dragging",
  "core:event:allow-emit",
  "core:event:allow-listen"
]
```

## Android / 移动端

### 构建时 `ANDROID_HOME` 未设置

```bash
export ANDROID_HOME=/path/to/Android/Sdk
# 默认路径参考
# Linux: ~/env/Android/Sdk 或 ~/Android/Sdk
# macOS: ~/Library/Android/sdk
# Windows: %LOCALAPPDATA%/Android/Sdk
```

### 构建时找不到 NDK

Tauri Android 需要 NDK。安装方式：

**方式一：通过 Android Studio**
Settings → Languages & Frameworks → Android SDK → SDK Tools → 勾选 NDK (Side by side)

**方式二：通过命令行**

```bash
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "ndk;29.0.14206865"
```

### 模拟器启动后 adb 找不到设备

```bash
adb kill-server
adb start-server
adb devices     # 应列出 emulator-5554
```

### 应用白屏（旧 WebView 语法不兼容）— 终端无任何报错

**现象**：手机端/模拟器打开后页面**完全空白**，登录界面不显示，但**终端没有任何报错**。
桌面端（Windows/macOS/Linux）一切正常。

**根因**：旧 Android 设备的 **System WebView 版本过低**，不支持现代 JS 语法。
典型场景：API 29 模拟器（Android 10）自带 **Chrome 74**（2019 年），而代码中大量使用
可选链 `?.` 和空值合并 `??`（属 ES2020，需 **Chrome 80+**）。WebView 在**解析期**就抛
`SyntaxError: Unexpected token .` → 整个 JS 模块不执行 → React 不挂载 → `#root` 为空。
因为是 WebView 内部的解析错误，**宿主机终端完全看不到**，极具迷惑性。

**确认 WebView 版本**：

```bash
adb shell dumpsys package com.google.android.webview | grep versionName
# versionName=74.0.3729.185  → Chrome 74，不支持 ES2020
```

**抓取真实错误（关键技巧）**：标准 Chrome 不把 JS console 写入 logcat，需用 DevTools 协议：

```bash
adb forward tcp:9222 localabstract:chrome_devtools_remote
curl -s http://localhost:9222/json          # 列出页面，取 webSocketDebuggerUrl
# 用 WebSocket 连上后 Runtime.enable，即可收到 Runtime.exceptionThrown：
#   SyntaxError: Unexpected token . @ .../react-router-dom.js
```

**解决（两个独立层面）**：

1. **生产构建 / 真机 APK** — 改 `apps/desktop/vite.config.ts` 的 `build.target`：

   ```ts
   build: {
     target: "es2019";
   } // ✅ 转译 ?./?? → b == null ? void 0 : b.c
   // ❌ 不要用 "chrome105" / "es2020"：esbuild 会原样保留 ?./??
   ```

   验证产物已被转译：

   ```bash
   pnpm --filter @yuanchat/desktop build
   grep -lE '\?\?|[a-zA-Z0-9_)\]]\?\.' apps/desktop/dist/assets/*.js   # 应无输出
   ```

2. **`tauri android dev`（开发热重载模式）** — **无法修复以兼容 Chrome 74**：
   Vite 注入的 `@vite/client`、`@react-refresh` 及部分预构建依赖（react-router-dom 等）
   自身就含 `?.`/`??`，且不经 `build.target` 转译。因此 dev 模式必须用**现代 WebView**：
   - 用 API 30+ 的 **Google Play** 镜像模拟器，并在「Play 商店」更新「Android System WebView」
   - 或用 Android 7+ 且 WebView ≥ Chrome 80 的真机
   - 仅需验证生产行为时，可 `vite build` 后用静态服务器托管 `dist` 再加载（绕过 dev client）

**验证（Chrome 74 模拟器实测）**：托管 `dist` 后用 DevTools 探测 DOM，登录页正常渲染：

```
DOM_PROBE: {"rootChildCount":1,"inputs":2,"placeholders":["手机号或邮箱","密码"],
            "buttons":["登 录"],"h1":"元聊"}   // ✅ 无 exception
```

---

### `tauri android dev` 热重载失效（HMR WebSocket 连接失败）

**现象**：dev 模式下页面能正常打开、登录页能显示，但**改代码不会自动刷新**；
DevTools 控制台报 `WebSocket connection to 'ws://0.0.0.0:1421/...' failed: net::ERR_CONNECTION_REFUSED`。

**根因**：`vite.config.ts` 把 `hmr.host` 设成了 `"0.0.0.0"`。`0.0.0.0` 是**服务端绑定地址**，
浏览器无法把它当作**连接目标**；且 HMR 端口（曾用 1421）未被 `adb reverse` 转发到设备。

**解决**：让 HMR 复用页面所在的 `localhost:1420` 隧道（`tauri android dev` 已自动建立
`adb reverse tcp:1420`）：

```ts
server: {
  host: "0.0.0.0",          // Vite 监听用 0.0.0.0（服务端绑定，正确）
  hmr: { protocol: "ws", host: "localhost", port: 1420 },  // 浏览器连接用 localhost
}
```

验证：DevTools 控制台应出现 `[vite] connecting...` → `[vite] connected.`，无 `0.0.0.0`/`1421` 报错。
（已在 `Medium_Phone` API 35 / Chrome 124 模拟器实测通过。）

---

### 软键盘遮挡输入框 / 点输入框内容不上移

**现象**：移动端（Android）点击输入框唤起软键盘后，键盘**浮在内容之上**，把底部输入框/
表单字段挡住，内容不会被「顶起」。常见于登录/注册页和聊天输入框。

**根因（两层，缺一不可）**：

1. **Android 原生层**：`targetSdk 35+`（Android 15）**强制** edge-to-edge，旧的
   `android:windowSoftInputMode="adjustResize"` 已失效；且 Tauri 的 init 模板在
   `MainActivity.kt` 调用了 `enableEdgeToEdge()`（见 [tauri#13780](https://github.com/tauri-apps/tauri/pull/13780)），
   软键盘以 **IME inset 覆盖层**形式出现，**不会**压缩窗口。
2. **Web 层**：因窗口没被压缩，`window.visualViewport.height`、
   `navigator.virtualKeyboard.boundingRect`、CSS `env(keyboard-inset-height)` **三者全部失效**
   （实测均不随键盘变化，但 `adb shell dumpsys input_method | grep mInputShown` 显示 `true`）。
   纯前端无法拿到键盘高度，必须由原生层先把 inset 喂给 WebView。

**解决（原生 + 前端联动）**：

- **原生**：`MainActivity.kt` 注册 `WindowInsets` 监听，把 IME 高度作为底部 padding 应用到
  `android.R.id.content`，使内容区真正变矮 → WebView 的 `visualViewport` 随之收缩：
  ```kotlin
  ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
    val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
    val nav = insets.getInsets(WindowInsetsCompat.Type.systemBars()).bottom
    view.setPadding(view.paddingLeft, view.paddingTop, view.paddingRight, maxOf(ime, nav))
    insets
  }
  ```
- **前端**：`useKeyboardAwareViewport`（`packages/shared`）监听 `visualViewport` resize，
  把可见高度写入 CSS 变量 `--app-height`；全屏容器改用 `.app-screen { height: var(--app-height) }`
  （替代 `h-screen`），并对登录/注册表单用 `flex-col + overflow-y-auto + 卡片 m-auto`，
  键盘弹起时表单可滚动、聚焦字段 `scrollIntoView` 到可见区。

**关键点**：`gen/android/` 的 `MainActivity.kt` 是 Tauri **只生成一次、不会覆盖**的用户扩展点
（被覆盖的是 `generated/TauriActivity.kt`），必须纳入版本控制——见
[`doc/DEVELOPMENT.md`](../doc/DEVELOPMENT.md) 关于 `gen/android` 的提交约定。

**CDP 验证手法**（标准 Chrome 不把 JS 控制台写进 logcat，需用 DevTools 协议）：

```bash
# 取应用 pid，转发 WebView DevTools socket（注意 socket 名带 pid 后缀）
PID=$(adb shell pidof com.yuanchat.desktop.debug)
adb forward tcp:9222 localabstract:webview_devtools_remote_$PID
curl -s http://localhost:9222/json   # 取 webSocketDebuggerUrl
# Chrome 124 对 CDP WebSocket 校验 Origin：用 websocket-client 的 suppress_origin=True 绕过
# 物理点击输入框（programmatic .focus() 不会唤起 IME，必须模拟真实手势）：
#   adb shell input tap <x*dpr> <y*dpr>
# 再读 getComputedStyle(documentElement)['--app-height'] 是否随键盘收缩
```

（已在 `Medium_Phone` API 35 / Chrome 124 实测：键盘弹起 `visualViewport` 891→578、
`--app-height` 同步、底部「验证码答案」字段滚入可见区。）

---

### 应用白屏（WebView 加载不出页面）

> 若上一节（语法不兼容）已排除，再按下面排查**连接/可达性**问题。

按以下顺序排查：

1. **Vite 是否在运行**

```bash
curl http://localhost:1420   # 应返回 HTML
```

如果 Vite 没运行，检查 `tauri android dev` 终端是否还开着。关闭终端会杀死 Vite。

2. **adb 端口转发是否生效**

```bash
adb forward --list            # 应包含 tcp:1420
```

3. **模拟器是否在运行**

```bash
adb devices                   # 应列出设备
```

4. **Vite 配置是否正确**

- `host` 必须是 `"0.0.0.0"`（服务端绑定地址；不是 `localhost`，不是 `10.0.2.2`）
- `hmr.host` 必须是 `"localhost"`（浏览器连接目标，复用 `adb reverse tcp:1420` 隧道；**不能**用 `0.0.0.0`，见上一节 HMR）
- 不需要设置 `TAURI_DEV_HOST` — Tauri 通过 `adb forward` 处理端口转发

**原理**：

```
宿主机 Vite (:1420, 0.0.0.0)  ←  adb forward tcp:1420 →  模拟器 localhost:1420 → WebView
```

### 模拟器黑屏 / 卡住

```bash
# 冷启动（清除快照）
$ANDROID_HOME/emulator/emulator -avd Medium_Phone_API_29 -no-snapshot-load

# 或擦除数据重来
$ANDROID_HOME/emulator/emulator -avd Medium_Phone_API_29 -wipe-data
```

### 真机调试（Android）

**前置条件**：

- 手机开启「开发者选项」→「USB 调试」
- USB 连接电脑

**步骤**：

```bash
# 1. 确认设备已连接
adb devices
# 应显示类似：
# List of devices attached
# 0123456789ABCDEF   device

# 2. 若显示 unauthorized，手机上点击「允许 USB 调试」
# 3. 若设备未出现，检查 USB 线是否支持数据传输（非仅充电线）

# 4. 启动 Tauri Android 开发
export ANDROID_HOME=/path/to/Android/Sdk
export JAVA_HOME=/path/to/jdk17
pnpm --filter @yuanchat/desktop tauri android dev
```

**无线调试（Android 11+）**：

```bash
# 1. 手机开启「开发者选项」→「无线调试」
# 2. 在手机上查看 IP 地址和端口（如 192.168.1.100:12345）
# 3. 配对（仅首次）
adb pair 192.168.1.100:12345
# 输入手机上显示的配对码

# 4. 连接
adb connect 192.168.1.100:12345

# 5. 确认
adb devices

# 6. 启动
pnpm --filter @yuanchat/desktop tauri android dev
```

**常见真机问题**：

| 问题                                          | 解决                                                             |
| --------------------------------------------- | ---------------------------------------------------------------- |
| `unauthorized`                                | 手机上确认 USB 调试授权弹窗，或撤销授权后重连                    |
| `offline`                                     | 重新插拔 USB，或 `adb kill-server && adb start-server`           |
| 安装失败 `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | 先卸载手机上已有版本：`adb uninstall com.yuanchat.desktop.debug` |
| 签名不匹配                                    | debug 和 release 签名不同，真机调试只用 debug 构建               |

---

### 整屏空白且无报错，但白屏原因不是语法（缺 ES2020+ 内置方法）

**现象**：`build.target=es2019` 已经配好、旧 WebView（Chrome 74）上仍然整屏空白，
logcat 无 `SyntaxError`。表现与「语法不兼容」那条一模一样，但根因不同。

**根因**：`build.target` 只降级**语法**，不会补**内置方法**。依赖里一旦调用 ES2020+ 新增
API，旧引擎上就是运行期 `TypeError`。已踩到的是 `@noble/curves`（E2EE 的椭圆曲线库）——
它在**模块初始化阶段**调 `Object.hasOwn`（ES2022 / Chrome 93+）校验参数，异常抛在 React
挂载之前，于是整屏空白、零提示。

**解决**：`packages/shared/src/polyfills.ts` 手写补丁，各端入口把它放在 **import 列表第一位**
（必须早于任何业务模块求值）：

```ts
if (typeof objectCtor.hasOwn !== "function") {
  objectCtor.hasOwn = function hasOwn(target, key) {
    if (target === null || target === undefined) throw new TypeError("...");
    return Object.prototype.hasOwnProperty.call(Object(target), key);
  };
}
```

**关键点**：只补**确实被调用**的方法——凭空补一堆 API 只是死代码。排查手法：用 CDP 连上
WebView（见上文「软键盘」条的 CDP 段）读 `Runtime.exceptionThrown`，能直接看到是哪个方法缺失。

---

### 图标和文字紧紧贴在一起 / 间距全没了（flex `gap` 静默失效）

**现象**：旧 WebView 上按钮里的图标与文案贴死、列表项之间没有间隙，
但**没有任何报错**，桌面浏览器完全正常。

**根因**：flex 容器的 `gap` 要 Chrome 84（grid 的 `gap` 从 66 起就有）。
Chrome 74 直接忽略该声明。`@supports (gap: 1px)` **不能**用来判断——grid 支持就返回 true。

**解决**（探测 + 样式兜底两段）：

- **探测**：`packages/shared/src/polyfills.ts` 真的摆两个盒子量一次宽度
  （`detectFlexGap()`），不支持时在 `<html>` 上加 `no-flex-gap`
- **兜底**：`packages/design-system/src/legacyWebViewCompat.ts`（Tailwind 插件）为
  `gap-*` 额外输出一份 margin，只在 `.no-flex-gap` 下命中：
  - 相邻兄弟 `> * + *` 按主轴方向加边距，四种 `flex-direction` 方向各不同
    （方向搞错等于没间距，反向容器里第二个元素在视觉上位于第一个之前）
  - `> svg:only-child` 单独加尾边距：`<button><Icon/>{文案}</button>` 里的文案是
    **裸文本节点**（匿名 flex item），CSS 选择器命中不到，`* + *` 永远不生效
  - 兜底只挂 `.flex` / `.inline-flex`，**不能**挂 grid——会与原生 `gap` 叠加，间距翻倍

**已知降级**：兜底用相邻兄弟选择器，`flex-wrap` 换行后的**行间距**无法补，旧引擎上会偏小。

---

### 所有按钮变成系统灰底、`hidden` 属性不隐藏（preflight 整条作废）

**现象**：旧 WebView 上凡是没显式写背景类的按钮（通讯录「+」、会话列表行、设置项、
忘记密码链接…）全都回落成系统默认灰底；`[hidden]` 元素照样显示。

**根因**：Tailwind preflight 把按钮复位写成
`button, input:where([type=button]), …`，而 `:where()` 要 Chrome 88。
**CSS 规范：选择器列表中任意一项非法，整条规则作废**——所以连开头合法的 `button`
也一起失效。`[hidden]:where(:not([hidden=until-found]))` 同理。

**解决**：`packages/design-system/src/global.css` 用不含新语法的选择器补一遍，
属性值与 preflight 保持一致（新引擎上是重复声明同值，无副作用）：

```css
button,
input[type="button"],
input[type="reset"],
input[type="submit"] {
  -webkit-appearance: button;
  background-color: transparent;
  background-image: none;
}

[hidden] {
  display: none;
}
```

**同类坑**：自己写的 CSS 也不能用 `inset`（Chrome 87）、`place-items` / `place-content`
的单值形式，一律写长写法；stylelint 的「合并回简写」规则已对这三个开例外
（见 `stylelint.config.js`）。

---

### 输入框、消息列表右侧常驻一条灰色滚动条

**现象**：移动端每个可滚动区域右侧永远挂着一条实体滚动条，还占布局宽度。

**根因**：一旦给 `::-webkit-scrollbar` 设过任何样式，Android WebView 就把默认的
「滚动时才浮现的覆盖式滚动条」换成**常驻实体滚动条**。

**解决**：滚动条定制整段包进 `@media (hover: hover) and (pointer: fine)`，
只对桌面生效，触摸设备保留系统自带的自动隐藏行为（`global.css`）。

---

### 长按消息/会话不弹菜单，或菜单闪一下就消失

**现象**（三种，桌面浏览器切触屏模拟都复现不出来）：

1. 长按到 500ms 也不弹菜单
2. 菜单弹出后立刻被关掉
3. 菜单确实进了 DOM，但整屏看不见（位置在视口外）

**根因**（逐条对应）：

1. **手指按住时不可能完全不动**。「任何 `touchmove` 都取消长按」的写法在真机上几乎按不出菜单
2. **抬手时浏览器会在长按目标上补发一整套合成鼠标事件**（`mousedown` → `mouseup` → `click`），
   菜单的「点外部关闭」监听立刻把它关掉。此外 Android WebView 自己还会在 `touchstart`
   约 **500ms** 后补发一个 `contextmenu`（实测 502ms）。
   按「呼出时刻 + 固定时间窗」豁免**不够**——按住 1 秒再抬手时窗口早过期了
3. **菜单锚点存在 ref 里**：定位是在 `useLayoutEffect` 里量的，ref 变化不触发重跑，
   于是用的是上一次的坐标

**解决**：

- 手势收敛到 `packages/ui/src/useLongPress.ts`：位移超过 `MOVE_TOLERANCE`（12px）才算滑动取消；
  豁免改成**按手势状态**判断——手指还按着、或抬手后 400ms 内，`isTouchEcho()` 为真，
  关闭监听据此放行。且只有「确实呼出过菜单」的那次按压才算余波
- **锚点必须放进 state**（`setContextMenu({ conv, x, y })`），不能放 ref——坐标要参与渲染
- 手势挂在**列表层**而非每个条目：同一时刻只可能按住一个条目，refs 共享无冲突，
  且关闭监听正好要读同一份手势状态

**验证**：`adb shell input swipe x y x y 700`（同点位、时长 700ms）可模拟长按；
菜单是否在视口内用 CDP 读 `getBoundingClientRect()` 核对。

## 跨端前端问题（web / desktop / android 同源）

### 切换语言后重开应用又变回系统语言，进设置页才恢复

**现象**：设置页把语言切成中文，杀掉应用重开，界面又是英文（系统语言）；
一进设置页，界面立刻变回中文。

**根因**：i18n 在**模块加载期**初始化，那时 store 还没建起来，`lng` 只能取
`navigator.language`；持久化的选择要等 zustand `persist` rehydrate 才知道。
而当时唯一把 locale 推给 i18next 的地方是 `SettingsScreen` 挂载时的一个 effect——
所以只有进过设置页才「补上」。

**解决**：语言落地收敛到 `themeStore`，三处齐全（`packages/shared/src/store/themeStore.ts`）：

```ts
locale: detectLocale(),                       // 从未选过语言时才跟随系统
setLocale: (locale) => { set({ locale }); void i18n.changeLanguage(locale); },
onRehydrateStorage: () => (state) => {        // 冷启动恢复
  if (state && state.locale !== i18n.language) void i18n.changeLanguage(state.locale);
},
```

同时删掉 `SettingsScreen` 的补偿 effect 和 `SettingsSections` 里重复的
`changeLanguage`——多个入口各自同步，迟早出现「状态是中文、界面是英文」。

**测试这条时的坑**：zustand 5 的 `persist` 默认 storage 是
`createJSONStorage(() => window.localStorage)`，**不是**裸 `localStorage`。
node 测试环境没有 `window` 时 persist **静默降级成不持久化**，连 `api.persist`
都不挂（表现为 `Cannot read properties of undefined (reading 'setOptions')`）。
因此冷启动用例必须独立成文件，在 `vi.hoisted()` 里同时打桩 `globalThis.localStorage`
与 `globalThis.window`——`vi.hoisted` 跑在所有 import 之前，块内**不能引用**文件里的常量
（会 `Cannot access 'X' before initialization`），键名只能写字面量。
参考 `packages/shared/src/__tests__/themeStoreLocaleBoot.test.ts`。

---

### 登录/注册/找回密码页文案不跟随界面语言

**现象**：应用语言是英文，但登录页整页中文；切语言对这些页面无效。

**根因**：auth 页面（web + desktop 各 4 个）的文案是**硬编码中文**，从未接 react-i18next；
更隐蔽的是 `validation.ts` 的校验器直接返回中文错误串，即使页面接了 i18n，
错误提示仍是中文。

**解决**：

- 8 个页面全部改成 `t("auth.*")`；句中要给某个词单独上色的用
  `<Trans i18nKey components={{ id: <span className="text-primary" /> }} />`，
  不能字符串拼接（日/韩语词序不同）
- 校验器返回 **i18n key**，调用方 `t(result.errors[0])` 翻译——纯共享函数里拿不到 `t()`
- 靠 `pnpm check:i18n` 的「静态 `t()` key 必须存在 + 无死键」两层挡住回归

---

### 次要文字与正文同色 / hover 没反应（色板里没注册的工具类）

**现象**：`text-on-surface-variant`、`hover:bg-surface-container-highest` 之类的类名
写了但**完全没效果**，元素静默继承父级颜色。曾一次性影响 210 处次要文字色和
两处右键菜单 hover。

**根因**：Tailwind 对色板里不存在的颜色类**不产出任何 CSS**，也不报错。

**解决**：`pnpm check:theme`（`scripts/check-theme-classes.mjs`）扫源码里所有主题色工具类，
逐个对色板 key 校验，同时校验三个 app 的色板一致；已并入 `pnpm check`。

---

### E2E 一改 i18n 词条就整片红

**现象**：把页面文案接到 i18n 后 Playwright 挂了 14 条，改完选择器又变成 8 条
`strict mode violation: ... resolved to 2 elements`。

**根因**：两层。① 定位器写的是改造前带排版空格的文案（`登 录`），词条里是 `登录`；
② `getByRole` 的可访问名是**子串匹配且不锚定**，`/登录/` 同时命中「登录」与「扫码登录」。

**解决**：`playwright.config.ts` 把 `use.locale` 钉在 `zh-CN`（保证 `detectLocale()`
落到中文），Page Object 用**首尾锚定 + `\s*`** 的正则：

```ts
this.loginButton = page.getByRole("button", { name: /^(登\s*录|登录中…)$/ });
```

## Web 端

### `pnpm dev` 启动后页面空白

**原因**：共享包（`packages/*`）未构建。

**解决**：

```bash
pnpm install        # 重新安装依赖（含 workspace 链接）
pnpm build          # 或单独构建共享包
```

### API 请求 404 / CORS 错误

**原因**：后端未启动或端口不匹配。

**解决**：

1. 确认后端已启动：`curl http://localhost:8080/api/v1/health`
2. 检查 `VITE_API_BASE_URL` 环境变量

## 后端 (Go)

### `make dev` 报错 `cannot find package`

```bash
cd server && go mod tidy && go mod download
```

### PostgreSQL 连接被拒绝

```bash
docker compose -f deploy/docker-compose.yml up -d postgres
# 等待 PostgreSQL 就绪
docker compose -f deploy/docker-compose.yml ps
```

### Redis 连接被拒绝

```bash
docker compose -f deploy/docker-compose.yml up -d redis
```

---

## 发版 / CI 打包

> 以下五条都出自 v0.4.0 那轮发版：本地 `pnpm build:pkg` 全绿，五个平台的 CI 却红了三个。
> 共同点是**本机环境早被历史操作喂饱了，只有干净 runner 才暴露**——
> 所以「本地打包通过」并不能替 CI 背书，两者查的不是同一件事。

### Linux：`failed to run custom build command for gstreamer-sys`

```
error: failed to run custom build command for `gstreamer-sys v0.23.6`
Package gstreamer-1.0 was not found in the pkg-config search path.
The PKG_CONFIG_PATH environment variable is not set.
```

通话助手依赖 `gstreamer` / `gstreamer-webrtc` / `gstreamer-sdp` 三个 crate，它们的
build.rs 走 pkg-config 找 `.pc` 文件。`DEVELOPMENT.md` 里列的是**运行期**插件包
（`gstreamer1.0-plugins-*`），装在终端用户机器上；**编译期**要的是另一组 `-dev` 包：

| `.pc` 文件             | 提供方                             |
| ---------------------- | ---------------------------------- |
| `gstreamer-1.0`        | `libgstreamer1.0-dev`              |
| `gstreamer-sdp-1.0`    | `libgstreamer-plugins-base1.0-dev` |
| `gstreamer-webrtc-1.0` | `libgstreamer-plugins-bad1.0-dev`  |

开发机装过运行期插件包时往往连带装过 `-dev`，所以本地永远复现不出来。

### Linux：`libgstreamer1.0-dev : Depends: libunwind-dev` + `held broken packages`

```
The following packages have unmet dependencies:
 libgstreamer1.0-dev : Depends: libunwind-dev
E: Unable to correct problems, you have held broken packages.
```

**不是包名写错**，是 GitHub `ubuntu-22.04` runner 镜像自带的缺陷：镜像预装了 LLVM 那套
`libunwind-*-dev`，与 Ubuntu 仓库的 `libunwind-dev` 冲突，而 `libgstreamer1.0-dev`
恰好依赖后者；apt 只丢一句 held broken packages，连冲突方是谁都不说
（[openFrameworks#8543](https://github.com/openframeworks/openFrameworks/issues/8543)）。

修法是装之前先把冲突方摘掉（该 job 用不到 LLVM）：

```bash
sudo apt-get purge -y 'libunwind-.*-dev' || true
sudo apt-get install -y libunwind-dev <其余依赖...>
```

`ubuntu-24.04` 镜像没这毛病，但**不要**为此换过去——那会把产物的 glibc 下限从 2.35
抬到 2.39，老发行版的用户直接装不上。

### macOS：`Failed to copy binary ... universal-apple-darwin/release/yuanchat-call-helper: does not exist`

打 universal 包时 tauri 会分别编 `aarch64-apple-darwin` 与 `x86_64-apple-darwin`，
然后 **只把主程序** lipo 进 `target/universal-apple-darwin/release/`。本仓有第二个 bin
（通话助手），它仍留在两个单架构目录里，bundler 去通用目录取就报 does not exist。

修法是在 tauri 构建**之前**自己补一次 lipo（助手在 macOS 上只是个空 `main`，很快）：

```bash
for t in aarch64-apple-darwin x86_64-apple-darwin; do
  cargo build --release --target "$t" --bin yuanchat-call-helper
done
lipo -create -output target/universal-apple-darwin/release/yuanchat-call-helper \
  target/{aarch64,x86_64}-apple-darwin/release/yuanchat-call-helper
```

### 三端同时报 `call_helper does not exist`（Windows 表现为 `light.exe` 失败）

上一条如果试图用 `required-features` 把助手 bin 在 macOS 上关掉，会引出更大的问题 ——
**三个平台一起挂**，且 Windows 的报错面目全非（WiX 的 `light.exe` failed，因为 .wxs
引用了不存在的文件）。

根因在 tauri-cli 的 `get_binaries`（`crates/tauri-cli/src/interface/rust.rs`）：

> 它判定一个 bin 是否启用，**只看 CLI 的 `-f/--features` 参数，不看 cargo 的
> default features**。

于是 `required-features = ["call-helper"]` 一写，哪怕 `default = ["call-helper"]`，
tauri 在所有平台都判成禁用；接着它退回去扫 `src/bin/` 目录，按**文件名**去要二进制 ——
要的是 `call_helper`，而 cargo 按 `[[bin]] name` 产出的是 `yuanchat-call-helper`，
两边对不上。

**结论：不要用 `required-features` 去按平台裁剪 tauri 项目的 bin。** 需要裁剪就改
`[[bin]] path` 让源文件离开 `src/bin/`，或者像上一条那样把产物补齐。

### Android：`Failed to find package 'tools'`

```
Warning: Failed to find package 'tools'
Error: The process '.../sdkmanager' failed with exit code 1
```

`android-actions/setup-android@v3` 的 `packages` 输入默认值是 `tools platform-tools`，
而 `tools` 这个旧版 SDK 包 Google 已经从仓库下架，sdkmanager 找不到就整步退出 1。
显式覆盖即可，`build-tools` / `platforms` 由 Gradle 自己按需拉：

```yaml
- uses: android-actions/setup-android@v3
  with:
    packages: platform-tools
```

### tag 已经指向坏代码时怎么补跑

修好 CI 脚本后不能直接「重跑失败的 job」——重跑用的还是 tag 那个 commit 的代码和
workflow。必须走 `workflow_dispatch` 并把 `ref` 指到修好的分支：

```bash
gh workflow run release.yml --ref main -f tag=v0.4.0 -f ref=main -f only=desktop
```

## 通用故障排查流程

1. **确认所有基础设施已启动**：`docker compose -f deploy/docker-compose.yml ps`
2. **确认后端可访问**：`curl http://localhost:8080/api/v1/health`
3. **确认前端 dev server 可访问**：浏览器打开 `http://localhost:5173`（Web）或 `http://localhost:1420`（Desktop Vite）
4. **查看终端日志**：前端、后端、Tauri 各有独立日志输出
5. **清理重来**：
   ```bash
   pnpm clean && pnpm install && pnpm build
   ```
