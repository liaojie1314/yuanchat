# 06 — 多端适配设计规范（Platform Adaptation）

> 元聊支持 Web / 桌面应用 (Tauri 2) / 移动端 (Tauri Android)
> 全端共用同一套 React + Tailwind CSS 代码，通过响应式断点和平台检测 Hook 实现差异化
> 依赖：`00_DESIGN_LANGUAGE.md`

---

## 一、设计目标

### 1.1 多端适配要解决的核心问题

1. **感觉原生**：不同平台用户用到的交互模式、导航范式与系统期望一致
2. **代码最大复用**：同一 React 组件在三端运行，平台差异由 Hook + CSS 处理
3. **功能一致性**：核心功能（发消息、通话、通讯录）在全平台可用，高级功能可按平台裁剪
4. **性能达标**：移动端 TTI < 2s，桌面端 TTI < 1s；不因兼容层降低帧率

### 1.2 三端定位

| 平台                          | 核心场景                   | 差异化功能                             |
| ----------------------------- | -------------------------- | -------------------------------------- |
| 移动端（Android）             | 随时随地接收消息、快速回复 | 推送通知、相机发图、语音消息、指纹解锁 |
| 桌面端（Tauri Mac/Win/Linux） | 工作时高效沟通、多任务并行 | 快捷键、多会话并排、文件拖放、系统托盘 |
| Web 端（浏览器）              | 临时登录、分享链接访问     | 无需安装、URL 分享、跨设备登录         |

---

## 二、断点系统与布局策略

### 2.1 断点定义

| 断点名   | 最小宽度 | 典型设备              | 主要布局模式               |
| -------- | -------- | --------------------- | -------------------------- |
| `(base)` | 0px      | 手机竖屏              | 单列全屏，底部导航         |
| `sm`     | 640px    | 手机横屏 / 折叠屏展开 | 单列，侧边图标导航         |
| `md`     | 768px    | 平板竖屏              | 双栏（列表 + 内容）        |
| `lg`     | 1024px   | 平板横屏 / 笔记本     | 三栏（导航 + 列表 + 内容） |
| `xl`     | 1280px   | 宽屏桌面              | 三栏 + 详情面板            |
| `2xl`    | 1536px   | 超宽屏                | 内容区加 max-w 限制        |

### 2.2 主界面三栏结构（桌面 ≥ 1024px）

```
总宽度: max-w-[1600px], margin auto（超宽屏居中）
最小可用宽度: 960px（三栏不再压缩）

Column A: 侧边导航   64px 固定
Column B: 列表面板   260px（可拖拽 200-360px）
Column C: 主内容区   flex:1，min-w 400px
Column D: 详情面板   0 or 260px（按需显示）

ResizeHandle（B/C 之间）:
  宽度: 4px，含 8px 透明扩展热区
  cursor: col-resize
  颜色: transparent，hover→outline-variant
  双击: 重置为 260px
  拖拽中: 蓝色 2px 竖线指示当前宽度
  松手: 过渡到最终宽度 150ms
  宽度持久化: Zustand 存储，下次打开恢复

分隔符:
  Column A 右侧: 1px outline-variant（无阴影）
  Column B 右侧: 1px outline-variant
```

### 2.3 主界面双栏结构（平板 768-1023px）

```
Column A: 侧边导航   48px 固定（图标条，无文字）
Column B: 会话列表   240px 固定
Column C: 聊天区     flex:1

注意: 无 Column D 详情面板（屏幕不够宽）
     详情通过 Modal 或全屏子页面展示
```

### 2.4 主界面单列结构（移动端 < 640px）

```
顶部: 状态栏（系统管控）
内容区: flex:1，当前页面内容
底部: TabBar 56px + safe-area-inset-bottom

页面切换: 同一时刻只显示一个页面
  会话列表 / 聊天页面 / 通讯录 / 设置
导航返回: AppBar 左侧 ArrowLeft 按钮
```

---

## 三、导航组件适配

### 3.1 三端导航对比

| 属性      | 移动端（< 640px） | 平板（640-1023px） | 桌面（≥ 1024px） |
| --------- | ----------------- | ------------------ | ---------------- |
| 导航位置  | 底部 TabBar       | 左侧图标条         | 左侧图标+标签    |
| 宽度/高度 | 56px 高           | 48px 宽            | 64px 宽          |
| 文字标签  | 是（Tab 下方）    | 否（仅图标）       | 是（图标下方）   |
| 用户头像  | 设置 Tab 图标替换 | 底部 40px 头像     | 顶部 40px 头像   |
| 通知角标  | 图标右上角        | 同左               | 同左             |

### 3.2 桌面侧边导航栏

```
┌────────────────────┐
│  Logo + "元聊"      │  40×40px Logo + Title Small white (740)
│  (Tauri TitleBar)  │  高度: 40px (TitleBar 集成)
├────────────────────┤
│  [Avatar 40px]     │  用户头像，点击→ /profile/me
│                    │  底部: 在线状态点（green/yellow/red）
├────────────────────┤
│                    │
│  [Chat bubble 24px]│  消息 · Tooltip "消息 (Ctrl+1)"
│                    │
│  [Users 24px]      │  通讯录 · Tooltip "通讯录 (Ctrl+2)"
│                    │
│  [Compass 24px]    │  发现（如有）
│                    │
├────────────────────┤（中间伸缩间距）
│                    │
│  [Bell 24px]       │  通知 · Tooltip "通知"
│  [Settings 24px]   │  设置 · Tooltip "设置 (Ctrl+,)"
│                    │
└────────────────────┘

每个导航项:
  容器: 48×48px, radius 12px
  图标: 24px, on-surface-variant（默认）/ on-primary（激活）
  激活背景: primary-container (亮色) / tertiary-container (暗色)
  Tooltip: Body Small, inverse-surface bg, 向右显示, 延迟 600ms
  角标: 16px 红色圆（数字≤99，超出显示"99+"）
    位置: 图标右上 -4px -4px
    无数字时: 8px 圆点

标签文字（图标下方）:
  Label Small, 600
  激活: primary
  非激活: on-surface-variant
```

### 3.3 移动端底部 TabBar

```
高度: 56px（内容区）+ safe-area-inset-bottom（系统安全区）
背景: surface / 亮色毛玻璃效果（backdrop-blur 可选）
顶部边框: 1px outline-variant

每个 Tab:
  宽度: flex:1（4 个 Tab 均分）
  高度: 56px
  图标: 24px
  文字: Label Small（12px）
  gap: 4px
  激活: primary 色图标 + primary 色文字
  非激活: on-surface-variant

  激活动画: 图标 scale(1→1.1) 150ms bounce
  切换: 无转场动画（Tab 级别直接切换）

角标位置: 图标右上角（同桌面端）

隐藏条件: 子页面（如聊天窗口、联系人详情）显示时，TabBar 隐藏
  使用 CSS: translateY(100%) + transition 隐藏，避免 DOM 移除
```

---

## 四、Tauri 桌面应用特有规格

### 4.1 自定义标题栏（TitleBar）

```
高度: 40px（Windows/Linux）/ 28px（macOS 紧凑模式，可选）
背景: nav-gradient（与左侧导航栏一致）
data-tauri-drag-region: 覆盖整个 TitleBar（可拖拽移动窗口）

布局:
  左: 应用 Logo 20px + "元聊" Label Large, white, 600
  中: flex:1 可拖拽区域
  右: 窗口控制按钮（最小化/最大化/关闭）

窗口控制按钮（Windows 风格）:
  每个: 46×40px 热区，鼠标 hover 浅色背景
  关闭按钮 hover: #E81123（红色）
  图标: 10px，白色线条风格

macOS 流量灯（macOS 版本）:
  使用 tauri-plugin-window-state 保留系统原生按钮
  TitleBar 中不渲染自定义控制按钮
  流量灯位置: 左上角，macOS 系统管控

TitleBar 与侧边导航整体感:
  TitleBar 背景渐变与导航栏一体，形成左侧 "L 型" 品牌色区域
  视觉连续，无明显边界
```

### 4.2 布局尺寸补偿

```
TitleBar 存在时，全局内容 padding-top += 40px
用 CSS 变量: --titlebar-height: 40px（Tauri）/ 0px（Web/Mobile）
内容区使用: padding-top: var(--titlebar-height)

Tauri 检测: typeof window.__TAURI__ !== 'undefined'
平台 Hook: usePlatform() → { isTauri, isMobile, isDesktop }
```

### 4.3 窗口管理

```
启动尺寸: 1280×820px
最小尺寸: 900×600px
记忆上次窗口: tauri-plugin-window-state（位置 + 尺寸）

窗口关闭行为（可设置）:
  默认: 关闭按钮 → 最小化到系统托盘
  设置 → 通用 → "关闭窗口时": [最小化到托盘] / [退出程序]

完全退出:
  Cmd+Q（macOS）/ 系统托盘菜单"退出"
  提示确认（如有未读通知）

窗口最小化到托盘:
  系统托盘图标：元聊 Logo（16px / 22px 高 DPI）
  右键托盘菜单:
    ─ 张三丰（昵称）
    ─ ● 在线 ▾（展开状态选择）
    ───────────
    打开元聊
    ───────────
    退出
  双击托盘图标: 显示主窗口
  有新消息时: 托盘图标角标数字 + Windows 任务栏闪烁
```

### 4.4 原生菜单（macOS）

```
菜单栏:
  元聊 App 菜单:
    关于元聊
    偏好设置... Cmd+,
    ──────────
    退出元聊  Cmd+Q

  编辑:
    撤销  Cmd+Z
    重做  Shift+Cmd+Z
    ──────────
    剪切  Cmd+X
    复制  Cmd+C
    粘贴  Cmd+V
    全选  Cmd+A

  视图:
    深色模式 / 浅色模式
    放大  Cmd+=
    缩小  Cmd+-
    重置缩放  Cmd+0
    ──────────
    全屏  Ctrl+Cmd+F

  窗口:
    最小化  Cmd+M
    关闭   Cmd+W
```

### 4.5 文件拖放

```
触发: 用户拖动文件到聊天窗口上方

拖入区域激活（dragover）:
  覆盖层: rgba(primary, 0.12) 全聊天区
  中心虚线框: 2px dashed primary, radius 12px
  图标: Upload 40px, primary
  文字: "松开发送文件"  Headline Small, primary
  动画: fade in + scale(0.95→1) 200ms

拖出/取消: 覆盖层 fade out 150ms

松开（drop）:
  单文件: 直接进入发送确认（缩略图 + 文件名 + 大小）
  多文件: 列表预览，支持逐项移除
  不支持的类型: Toast "不支持此文件类型"
  超大文件（> 500MB）: 提示 "文件过大，最大支持 500MB"

类型限制（默认，可配置）:
  图片: jpg/png/gif/webp/heic
  视频: mp4/mov/avi/mkv
  文档: pdf/doc/docx/xls/xlsx/ppt/pptx/txt
  代码: js/ts/go/py/java/c/cpp/h/json/yaml/toml...
  无限制: Zip/RAR（需警告未知内容）
```

---

## 五、移动端（Android）特有规格

### 5.1 系统安全区域适配

```
CSS 变量:
  --safe-area-top:    env(safe-area-inset-top)
  --safe-area-bottom: env(safe-area-inset-bottom)
  --safe-area-left:   env(safe-area-inset-left)
  --safe-area-right:  env(safe-area-inset-right)

关键区域:
  TabBar: padding-bottom: max(8px, var(--safe-area-bottom))
  输入区: padding-bottom: var(--safe-area-bottom)（键盘弹出时动态调整）
  状态栏区: 刘海/动态岛区域留出 var(--safe-area-top) 间距

主题色同步（Android 状态栏）:
  亮色模式: 状态栏白底深色图标
  暗色模式: 状态栏黑底浅色图标
  Tauri Android: 通过 StatusBar API 设置颜色 + style
```

### 5.2 软键盘处理

```
问题: Android edge-to-edge 模式下，web 的 window.innerHeight 变化不可靠

解法（同 memory: android-keyboard-push-content-up）:
  原生侧（Kotlin）: 监听 WindowInsets.Ime，通过 JS 注入更新
    js: `window.dispatchEvent(new CustomEvent('keyboard-height', { detail: { height: keyboardHeight } }))`

  前端侧:
    Hook: useKeyboardAwareViewport()
      监听 'keyboard-height' 事件
      更新 --app-height: calc(100dvh - keyboardHeight px)
    聊天输入区: height = var(--app-height) - fixed header

  输入框 focus 时:
    整个页面不上移（防止 viewport resize 抖动）
    仅输入区 + 消息列表滑到最新消息
    消息列表 scroll-padding-bottom = 软键盘高度

  键盘类型:
    文本输入: inputmode="text"
    数字（手机号）: inputmode="numeric"
    邮箱: inputmode="email"
```

### 5.3 手势交互

```
滑动返回（左边缘右滑）:
  触发区域: 屏幕左 20px 以内的触摸起始点
  最小位移: 100px
  角速度阈值: 快速右滑即可（不需要超过 100px）
  触感: light impact（振动）
  动画: 当前页面随手指移动（translateX），背后页面 scale(0.97→1)
  取消（滑回）: 弹回动画 200ms bounce

下拉刷新（会话列表 / 通讯录）:
  触发: 距顶部 < 5px 时继续下拉
  最小触发位移: 80px
  指示器: 品牌色 Spinner，translate 跟随手指，松手后居中 + 旋转
  完成: 列表数据更新，Spinner fade out + 列表向下弹入

长按触发菜单:
  延迟: 400ms 无移动触发
  触感: medium impact（振动）
  动画: 被长按项微缩 scale(0.97)，菜单从触按点弹出
  菜单: Bottom Sheet

双指缩放（图片查看 Lightbox）:
  支持标准双指缩放手势
  范围: 0.5x - 4x
  单指: 超出范围后弹性回弹

上滑显示更多选项（输入区）:
  输入工具栏上滑: 展开完整工具栏（移动端输入区扩展）
```

### 5.4 原生能力映射（Tauri Android）

| 功能         | Tauri 插件 / API                     | 备注             |
| ------------ | ------------------------------------ | ---------------- |
| 推送通知     | tauri-plugin-notification + FCM      | 后台消息唤醒     |
| 相机         | tauri-plugin-camera                  | 头像上传、发图   |
| 图库         | tauri-plugin-fs + FileChooser        | 选取图片/文件    |
| 文件下载     | tauri-plugin-fs                      | 保存到 Downloads |
| 状态栏颜色   | tauri-plugin-statusbar（Android）    | 跟随主题色       |
| 触感反馈     | navigator.vibrate()                  | 振动模式         |
| 剪贴板       | navigator.clipboard + tauri fallback | 复制             |
| 分享         | tauri-plugin-share                   | 分享二维码       |
| 网络检测     | navigator.onLine + Network API       | 离线检测         |
| 生物识别     | tauri-plugin-biometric               | 指纹/面部解锁    |
| 深链接       | tauri-plugin-deep-link               | yuanchat:// 协议 |
| 应用内浏览器 | tauri-plugin-shell                   | 打开外部链接     |

---

## 六、Web 端（浏览器）特有规格

### 6.1 Web 独有场景

```
分享链接访问:
  URL: https://app.yuanchat.com/invite/:code
  未登录: 显示 Landing 页（邀请介绍）+ [下载 App] [网页登录]
  已登录: 直接跳转到加好友页面

无推送通知（非 HTTPS / 未授权）:
  Web Push API（需用户授权）
  降级: 页面内的通知 Badge + 页面 title "[3] 元聊"

无相机直接调用:
  使用 input[type=file][accept=image/*][capture=environment]
  移动端浏览器触发系统相机选择

文件操作:
  下载: a[href][download] 触发
  无法访问本地路径（沙箱限制）
```

### 6.2 Web 端登录持久化

```
Token 存储:
  localStorage: accessToken（短期 7d）
  IndexedDB（可选）: 离线数据缓存

刷新策略:
  accessToken 过期前 5 分钟自动续期
  refreshToken 过期: 回到登录页

记住登录状态: 默认 7 天，可选"保持登录 30 天"
隐私模式（Incognito）: 会话级别，关闭浏览器即失效
```

---

## 七、弹窗与操作表单适配规则

### 7.1 弹窗类型对应规则

| UI 类型              | 移动端（< 640px）          | 平板（640-1023px）  | 桌面（≥ 1024px）  |
| -------------------- | -------------------------- | ------------------- | ----------------- |
| 确认对话框           | Alert Dialog（全宽，底部） | Modal（480px 居中） | Modal（480px）    |
| 选项菜单             | Bottom Sheet               | Dropdown Popover    | Dropdown Popover  |
| 大型表单（编辑资料） | 全屏页面                   | Modal（560px）      | Modal（560px）    |
| Emoji 选择器         | Bottom Sheet 全屏          | Popover 260×320px   | Popover 260×320px |
| 颜色/主题选择        | Bottom Sheet               | Popover             | Popover           |
| 联系人选择           | 全屏                       | Modal               | Modal（560px）    |
| 图片查看（Lightbox） | 全屏                       | 全屏                | Centered Modal    |
| 右键菜单             | 长按 Bottom Sheet          | Context Menu        | Context Menu      |

### 7.2 Bottom Sheet 规格

```
滑入动画: translateY(100%→0) 350ms decelerate
拖拽关闭: 下拉超过 120px 且速度 > 200px/s 自动关闭
          或下拉超过 50% 高度松手关闭
拖拽指示: 顶部 4×32px 灰色拖拽条

高度:
  Small（< 40%）: 圆角 top-left/top-right 20px
  Large（> 40%）: 完全覆盖状态栏下方，圆角消失
  Full（90%+）: 几乎全屏，左右 0，顶部有拖拽条

背景遮罩: rgba(0,0,0,0.4), fade in 200ms
点击遮罩: 关闭 Bottom Sheet

键盘适配:
  Bottom Sheet 含输入框时: margin-bottom = 软键盘高度
```

### 7.3 Modal 规格

```
尺寸:
  Small:  max-w-sm（384px）
  Medium: max-w-lg（512px）
  Large:  max-w-xl（560px）或 2xl（672px）

进入动画: scale(0.95→1) + opacity(0→1) 200ms decelerate
退出动画: scale(1→0.95) + opacity(1→0) 150ms accelerate
背景遮罩: rgba(0,0,0,0.5)，click 关闭（除 Alert Dialog）

z-index: z-modal（see 00_DESIGN_LANGUAGE.md §Z-Index）

居中: fixed inset-0, flex items-center justify-center, p-4

移动端 Modal:
  max-width: calc(100vw - 32px)
  如超过屏幕高度: overflow-y-auto + max-h-[90vh]

Escape 键: 关闭 Modal（桌面端）
```

---

## 八、键盘快捷键体系（桌面端）

### 8.1 全局快捷键

| 快捷键         | 功能                               |
| -------------- | ---------------------------------- |
| `Ctrl/Cmd + K` | 打开命令面板（CommandPalette）     |
| `Ctrl/Cmd + F` | 全局搜索（聚焦搜索框）             |
| `Ctrl/Cmd + 1` | 跳转消息页                         |
| `Ctrl/Cmd + 2` | 跳转通讯录                         |
| `Ctrl/Cmd + 3` | 跳转设置                           |
| `Ctrl/Cmd + ,` | 打开设置                           |
| `Ctrl/Cmd + N` | 新建会话                           |
| `Escape`       | 关闭 Modal / 取消搜索 / 退出选中态 |
| `Alt + ↑`      | 跳转到上一个会话                   |
| `Alt + ↓`      | 跳转到下一个会话                   |

### 8.2 会话操作快捷键

| 快捷键                 | 功能                            | 生效条件           |
| ---------------------- | ------------------------------- | ------------------ |
| `Enter`                | 发送消息                        | 输入框有焦点       |
| `Shift + Enter`        | 输入换行                        | 输入框有焦点       |
| `Ctrl/Cmd + Enter`     | 发送消息（Alt 方式）            | 输入框有焦点       |
| `↑`                    | 编辑上一条消息                  | 输入框为空         |
| `Ctrl/Cmd + Z`         | 撤回上一条发送（5s 内）         | 消息刚发出         |
| `Ctrl/Cmd + E`         | 打开 Emoji 选择器               | 输入框有焦点       |
| `@`                    | 触发 @提及选择                  | 输入框有焦点       |
| `/`                    | 触发命令（/mute /translate 等） | 输入框有焦点，开头 |
| `Ctrl/Cmd + Shift + F` | 会话内搜索                      | 聊天窗口激活       |
| `Ctrl/Cmd + I`         | 切换消息详情面板                | 聊天窗口激活       |

### 8.3 会话列表导航快捷键

| 快捷键                 | 功能                 |
| ---------------------- | -------------------- |
| `↑` / `↓`              | 上/下选择会话        |
| `Enter`                | 打开选中会话         |
| `Delete` / `Backspace` | 删除会话（需确认）   |
| `M`                    | 切换选中会话的免打扰 |

### 8.4 快捷键自定义（设置页）

```
设置 → 快捷键
  列表: 所有可自定义快捷键
  每项: 操作名称 + 当前绑定 + [修改] 按钮
  修改: 点击后监听下一次按键组合（防止与系统快捷键冲突）
  冲突检测: 与已绑定的快捷键提示冲突
  重置: [恢复默认] 按钮（全部/单项）

禁止重绑定:
  Cmd+Q / Alt+F4（系统退出）
  Cmd+W（关闭窗口）
  Cmd+Tab / Alt+Tab（切换应用）
```

---

## 九、深色模式

### 9.1 实现机制

```
CSS 方案:
  亮色: :root { --md-sys-color-primary: #5B9BD5; ... }
  暗色: html.dark { --md-sys-color-primary: #A8CFFF; ... }

Tailwind 配置: darkMode: 'class'

切换流程:
  themeStore.setMode('light' | 'dark' | 'system')
  → 更新 localStorage.getItem('theme')
  → document.documentElement.classList.toggle('dark', isDark)
  → StatusBar / TitleBar 颜色同步

"跟随系统" 实现:
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', e => themeStore.applySystemMode(e.matches))
  App 启动时: 读取 localStorage('theme') → 若 'system' 则读取 mq.matches
```

### 9.2 平台同步

```
Tauri 桌面:
  tauri-plugin-theme 监听系统 dark/light 变化
  TitleBar 颜色: 亮色 nav-gradient / 暗色 #1F2937 渐变
  Windows 任务栏缩略图: 跟随主题（Tauri 自动）

Android:
  StatusBar style:
    亮色: StatusBarStyle.Light（深色图标）
    暗色: StatusBarStyle.Dark（浅色图标）
  NavigationBar（底部）: 跟随 surface 颜色

Web:
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" media="(prefers-color-scheme: light)" content="#5B9BD5">
  <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1A1C1E">
```

### 9.3 过渡动画

```
主题切换动画（可选，性能考量）:
  简单方案（默认）:
    transition: background-color 200ms ease, color 200ms ease
    在 :root 和 html 上全局添加
    图片不受影响（img 标签无 transition）

  全页过渡（高端设备可选）:
    使用 View Transitions API:
    document.startViewTransition(() => document.documentElement.classList.toggle('dark'))
    仅在 Chrome/Chromium WebView 支持时生效，否则 fallback 到简单方案
```

---

## 十、字体与文字渲染

### 10.1 字体缩放

```
html {
  font-size: calc(14px * var(--font-scale));
  --font-scale: 1; /* 默认，可通过设置调整 */
}

字体缩放档位（设置 → 外观 → 字体大小）:
  小 (0.857): 12px base
  正常 (1.0): 14px base（默认）
  大 (1.143): 16px base
  超大 (1.286): 18px base

Android 系统字体缩放:
  禁止: text-size-adjust: none  ← 禁止，让用户通过应用内设置控制
  允许: 若用户未设置应用内大小，读取 window.devicePixelRatio 做参考
```

### 10.2 平台字体栈

```css
font-family:
  /* 中文 */ "PingFang SC" /* macOS / iOS */ "Noto Sans SC" /* Android / Linux */ "Microsoft YaHei"
  /* Windows */ /* 英文 */ "SF Pro Text" /* Apple */ "Segoe UI" /* Windows */ "Roboto" /* Android */
  /* 通用 */ system-ui -apple-system sans-serif;

代码字体（消息中代码块）: "Cascadia Code", "Fira Code", "JetBrains Mono", monospace;
```

### 10.3 文字渲染优化

```css
/* 全局 */
-webkit-font-smoothing: antialiased;
-moz-osx-font-smoothing: grayscale;
text-rendering: optimizeLegibility;

/* 代码块禁止 kerning 优化 */
code,
pre {
  text-rendering: auto;
}
```

---

## 十一、动效与过渡适配

### 11.1 减少动效（Reduce Motion）

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

所有动效类 CSS 必须在 `@media (prefers-reduced-motion: no-preference)` 块内，或检查该媒体查询后动态添加。

### 11.2 平台动效差异

| 动效类型       | 移动端                         | 桌面端                | 降级     |
| -------------- | ------------------------------ | --------------------- | -------- |
| 页面切换       | translateX 滑入（300ms）       | fade + scale（200ms） | 瞬切     |
| Bottom Sheet   | translateY（350ms decelerate） | 无（用 Popover）      | 显/隐    |
| Modal 弹出     | scale + fade（200ms）          | scale + fade（200ms） | 显/隐    |
| 列表 item 删除 | height→0 + opacity→0（300ms）  | 同左                  | 瞬消     |
| Skeleton 动画  | shimmer 1.5s（离屏停止）       | shimmer 1.5s          | 静态灰块 |

### 11.3 触觉反馈（移动端）

| 场景                 | 振动类型             | 时长       |
| -------------------- | -------------------- | ---------- |
| 长按触发             | medium impact        | 50ms       |
| 按钮点击确认         | light impact         | 10ms       |
| 字母索引滑动         | light impact         | 10ms/字母  |
| 错误（表单校验失败） | error（3次连续短振） | 10-10-10ms |
| 消息接收（可选）     | light notification   | 20ms       |
| 录音开始/结束        | medium impact        | 50ms       |

---

## 十二、图片与媒体适配

### 12.1 头像多分辨率

```
服务端提供多尺寸 URL 规则:
  /avatar/:userId?s=40   → 40px（1x）
  /avatar/:userId?s=80   → 80px（2x @ 40dp）
  /avatar/:userId?s=120  → 120px（3x @ 40dp）

前端使用 srcSet:
  <img srcSet="url?s=40 1x, url?s=80 2x, url?s=120 3x" ...>

格式: WebP 优先，JPEG 兜底
  <picture>
    <source type="image/webp" srcSet="url?s=80&f=webp">
    <img src="url?s=80">
  </picture>
```

### 12.2 消息图片优化

```
加载流程:
  1. 显示 16×9 骨架占位（防 CLS）
  2. 加载缩略图（200px, 模糊 blur 20px）
  3. 原图加载完成 → 清晰度过渡（blur: 20px→0, 300ms）

缩略图规格:
  宽度: min(原图宽, 280px)（移动）/ min(原图宽, 360px)（桌面）
  高度: 按比例，max-height 200px
  圆角: radius-8

点击查看原图 → Lightbox:
  背景: rgba(0,0,0,0.9)，全屏
  支持双指缩放（移动）/ 鼠标滚轮缩放（桌面）
  左右箭头（桌面）/ 左右滑动（移动）切换多图
  [下载] [分享] 按钮
  Escape 关闭（桌面）/ 点击背景关闭

视频消息:
  缩略图: 第 1 帧，带 Play 圆形图标覆盖
  点击: 内联播放器（HTMLVideoElement，无第三方）
  支持: 全屏、进度条、音量、暂停
```

---

## 十三、离线与网络状态处理

### 13.1 离线状态 UI

```
检测: navigator.onLine + window.onfline/online

全局指示器（离线时）:
  TopBar 下方: 12px 高 error 色 Banner "无网络连接，部分功能不可用"
  Banner 延迟出现: 3s 后（避免短暂网络中断误报）
  恢复连接: Banner 变 success 色 "已重新连接" + 2s 后消失

会话列表（离线）:
  新消息不更新（灰色 WebSocket 状态图标）
  下拉刷新失败: "离线模式，无法刷新" Toast

聊天窗口（离线）:
  输入框禁用（灰色）或允许输入但发送按钮显示离线提示
  之前的消息仍可查看（本地缓存）
  消息发送失败: 气泡左侧 AlertCircle 图标 + [重试]

输入区提示:
  placeholder 变为 "离线中，消息暂时无法发送"（当断网时）
```

---

## 十四、性能指标与优化

### 14.1 核心指标目标

| 指标                            | 移动端目标                | 桌面端目标 |
| ------------------------------- | ------------------------- | ---------- |
| 首屏 TTI（Time to Interactive） | < 2.5s（4G）              | < 1.5s     |
| 会话列表首次渲染                | < 500ms                   | < 200ms    |
| 消息发送延迟（UI 反馈）         | < 100ms                   | < 50ms     |
| 图片懒加载首帧                  | < 300ms                   | < 200ms    |
| JS Bundle（初始）               | < 500KB（gzip）           | < 600KB    |
| 内存占用                        | < 200MB（Android 稳定态） | < 500MB    |
| CLS                             | < 0.1                     | < 0.05     |

### 14.2 代码分割策略

```
入口包（立即加载）:
  React + ReactDOM
  React Router v7
  Zustand
  主布局组件
  设计系统核心（CSS 变量、基础组件）

路由级懒加载（React.lazy）:
  /auth: AuthModule（登录/注册）
  /contacts: ContactsModule
  /settings: SettingsModule
  /profile: ProfileModule（延迟）

组件级懒加载（按需触发）:
  EmojiPicker: 首次点击表情按钮后加载
  QuillEditor: 打开富文本模式后加载
  QRCodeGenerator: 打开二维码页后加载
  ImageCropper: 上传图片时加载
  AudioRecorder: 首次录音时加载
  CodeHighlighter: 首次看到代码块时加载（IntersectionObserver）
```

### 14.3 WebView 兼容性要求

```
目标环境:
  Android System WebView ≥ Chrome 74（Android 9 / API 28 自带）
  iOS WebView ≥ Safari 14（iOS 14+）
  桌面 Chrome/Edge/Firefox 最近 2 个大版本

Vite build.target:
  desktop: "es2019"（必须，原因: 旧 Android WebView 不支持 ?./??）
  mobile: "es2019"（同上）
  禁止改成 "chrome105" / "es2020" → 旧 WebView 白屏

禁用的 CSS 特性:
  CSS 嵌套语法（Chrome 112+，旧 WebView 不支持）
  CSS Container Queries（Chrome 105+，谨慎使用）
  :has() 伪类（有限支持，用 JS 替代）

Polyfill（已内置）:
  smoothscroll-polyfill: 平滑滚动
  IntersectionObserver polyfill: 懒加载
  ResizeObserver polyfill: 尺寸监听
```

---

## 十五、OpenDesign 页面帧清单

```
Platform/Breakpoint-Mobile          — 移动端主界面（375px，底部 TabBar）
Platform/Breakpoint-Tablet          — 平板端主界面（768px，双栏）
Platform/Breakpoint-Desktop         — 桌面端主界面（1280px，三栏）
Platform/Breakpoint-Desktop-Detail  — 桌面端 + 详情面板（1440px）

Platform/Tauri-TitleBar             — 自定义标题栏（Windows 风格）
Platform/Tauri-TitleBar-Mac        — 自定义标题栏（macOS 流量灯）
Platform/Tauri-Tray-Menu           — 系统托盘菜单
Platform/Tauri-FileDrop            — 文件拖放覆盖层

Platform/Mobile-SafeArea           — 安全区域适配示意（刘海 + 底部条）
Platform/Mobile-Keyboard           — 软键盘弹出布局示意
Platform/Mobile-GestureBack        — 左滑返回手势（页面位移示意）
Platform/Mobile-BottomSheet        — Bottom Sheet（S/M/L 三尺寸）

Platform/Dark-Mobile               — 暗色模式（移动端）
Platform/Dark-Desktop              — 暗色模式（桌面端）
Platform/Dark-Switch               — 主题切换过渡动画帧

Platform/Offline-Banner            — 离线状态 Banner
Platform/Offline-Chat              — 离线聊天窗口状态

Platform/Responsive-Navigation     — 导航组件三端对比（一帧并排展示）
Platform/Responsive-Modals         — 弹窗类型对比（Bottom Sheet vs Modal）
```

---

## 十六、变更日志

| 版本 | 日期       | 变更                                                                                                                                                                                                                                       |
| ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| v1.0 | 2026-06-29 | 初版                                                                                                                                                                                                                                       |
| v1.1 | 2026-07-06 | 新增：设计目标/三端定位、Tauri 标题栏/系统托盘/文件拖放完整规格、移动端手势体系（返回/下拉/长按）、软键盘处理方案、底部安全区适配、深色模式全平台同步、触觉反馈规格、字体渲染、懒加载策略、性能指标、WebView 兼容性要求、OpenDesign 帧清单 |
