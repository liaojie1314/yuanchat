# 06 — 多端适配设计规范

> 元聊支持 Web / 桌面端 (Tauri) / 移动端 (Capacitor Android+iOS) / 平板端
> 全端共用同一套 React + Tailwind CSS 代码，通过响应式断点和平台检测 Hook 实现差异化

---

## 一、断点系统

基于 Tailwind CSS 默认断点，语义化命名：

| 断点名   | 最小宽度 | 平台映射            | 主要布局变化                 |
| -------- | -------- | ------------------- | ---------------------------- |
| `(base)` | 0px      | 移动端竖屏          | 单列，底部导航，全屏视图     |
| `sm`     | 640px    | 移动端横屏 / 大手机 | 两列，或单列保持更多空间     |
| `md`     | 768px    | 平板竖屏            | 双栏布局，侧边导航           |
| `lg`     | 1024px   | 平板横屏 / 桌面     | 三栏布局，完整侧边栏         |
| `xl`     | 1280px   | 宽屏桌面            | 三栏 + 扩展内容              |
| `2xl`    | 1536px   | 超宽屏              | 限制最大内容宽度，添加外边距 |

---

## 二、各平台布局模式

### 2.1 移动端（< 640px）

**布局模式**: 单列全屏 + 底部 Tab 导航

```
页面高度: var(--app-height) — 由 useKeyboardAwareViewport 动态维护
顶部: 状态栏 (系统管控, transparent / colored)
内容区: flex:1, overflow-y auto
底部: Tab 导航 56px + safe-area-inset-bottom

导航模式:
  主导航: 底部 TabBar（消息/通讯录/设置）
  子页面: 全屏 + 顶部自定义 AppBar（[←返回] + 页面标题 + 操作）

AppBar 规格:
  高度: 56px
  背景: surface / brand-gradient (依页面决定)
  布局: flex, items-center
    左: ArrowLeft 40×40px 返回按钮
    中: 页面标题 Title Medium 600（截断）
    右: 操作按钮（1-2个）

页面跳转动画:
  进入子页面: 从右侧滑入 (translateX: 100%→0, 300ms decelerate)
  返回上级: 向右滑出 (translateX: 0→100%, 250ms accelerate)
```

**移动端特有交互：**

```
滑动返回:
  从左边缘（< 20px）右滑：触发返回（iOS 风格，仅 Capacitor）
  最小滑动距离: 100px

下拉刷新:
  下拉超过 80px 松手刷新（会话列表、通讯录）
  指示器: 圆形 Spinner，brand 色

长按:
  会话列表项: 底部菜单（置顶/免打扰/删除）
  消息气泡: 底部菜单（复制/回复/转发/收藏/撤回）
  联系人: 底部菜单（发消息/通话/删除）

键盘处理:
  软键盘弹出时: --app-height 缩小 → 输入区上移到键盘上方
  键盘收起时: --app-height 恢复 → 平滑过渡

安全区域适配:
  bottom padding: env(safe-area-inset-bottom)
  top padding: env(safe-area-inset-top)（刘海屏/动态岛）
```

**移动端字体调整：**

```
正文最小: 16px (Body Large = max(14px, 1rem))
保留系统字体缩放（不禁用 text-size-adjust）
```

---

### 2.2 平板端（640px - 1023px）

**布局模式**: 侧边图标导航（48px）+ 内容主区

```
导航:
  左侧图标 Tab（48px 宽），仅显示图标（无文字标签）
  图标: 24px
  激活态: 48×48px 圆形 primary 背景，白色图标（适配宽度收窄）

内容区:
  sm: 单列（左导航48px + 内容 flex:1）
  md: 可显示双列（会话列表 240px + 聊天窗口 flex:1）

双列切换逻辑:
  >= md (768px): 显示会话列表 + 聊天窗口并列
  < md (640px): 会话列表 / 聊天窗口 切换显示（单列）

详情面板:
  平板不显示独立详情面板（屏幕不够宽）
  详情通过弹窗 Modal 或全屏子页面展示
```

---

### 2.3 桌面端浏览器 Web（≥ 1024px）

**布局模式**: 三栏（导航64px + 列表260-360px + 主区flex:1）+ 可选详情面板

```
三栏布局:
  Column 1: 侧边导航栏（64px 固定宽）
  Column 2: 内容列表（默认260px，可拖拽扩展至360px）
  Column 3: 聊天/内容主区（flex:1，最小400px）
  Column 4: 详情面板（可选，0 or 240-280px，按钮切换显示/隐藏）

总宽度限制:
  max-width: 1600px，超出宽度两侧加余白（margin auto）
  min-width: 960px（三栏不再缩小）

会话列表拖拽调整:
  ResizeHandle 组件（4px 宽可拖拽条）
  范围: min 200px, max 360px
  拖拽时: 鼠标改为 col-resize, 蓝色高亮指示线
  双击: 重置为默认宽度 260px

键盘快捷键（桌面特有）:
  Cmd/Ctrl + F: 全局搜索
  Cmd/Ctrl + K: 会话切换器（Spotlight 风格弹窗）
  Escape: 关闭 Modal / 取消搜索
  Cmd/Ctrl + Enter: 发送消息（在输入框焦点时）
  Shift + Enter: 输入换行
  上/下箭头: 在会话列表中导航（焦点在列表时）
  Enter: 打开选中会话（同上条件）
```

---

### 2.4 桌面应用端 (Tauri)

**在 Web 基础上的额外差异：**

```
自定义标题栏 (TitleBar):
  高度: 40px
  背景: nav-gradient（与左侧导航栏颜色一致）
  可拖拽区域: data-tauri-drag-region 属性整个标题栏

  左侧: 应用 Logo (20px) + "元聊" 标题 (Label Large, white)
  中部: (空白，可拖拽区)
  右侧: 窗口控制按钮 (最小化/最大化/关闭)

布局补偿:
  顶部内容偏移 += 40px (TitleBar 高度)
  或通过 env(titlebar-area-height) 自动感知

窗口尺寸:
  最小: 900×600px
  默认: 1200×800px
  记忆上次窗口位置和大小

原生菜单 (Tauri 菜单栏):
  macOS: 系统菜单栏集成
    元聊 > 偏好设置 / 退出
    编辑 > 复制/粘贴/撤销等
    视图 > 深色模式/缩放
    窗口 > 最小化/全屏
  Windows/Linux: 无原生菜单（使用应用内设置）

系统托盘:
  图标: 元聊 Logo
  菜单: 显示/隐藏主窗口, 退出
  右键: 托盘菜单
  双击: 显示主窗口

原生通知:
  使用 Tauri notification API
  通知包含: 发送人头像, 昵称, 消息摘要
  点击通知: 打开对应会话

文件拖放:
  支持拖放文件到聊天窗口直接发送
  拖入时: 聊天区显示拖放提示覆盖层 "松开发送文件"

窗口关闭行为:
  关闭按钮: 最小化到托盘（可在设置中更改）
  Cmd+Q / Alt+F4: 完全退出（提示确认）
```

---

## 三、响应式组件行为汇总

### 3.1 导航组件

| 组件          | 移动 (<640)        | 平板 (640-1023) | 桌面 (≥1024)       |
| ------------- | ------------------ | --------------- | ------------------ |
| 导航位置      | 底部 TabBar        | 左侧图标条 48px | 左侧图标+标签 64px |
| 导航高度/宽度 | 56px 高            | 48px 宽         | 64px 宽            |
| 是否显示文字  | 是（Tab 下方）     | 否（仅图标）    | 是（图标下方）     |
| 用户头像      | 不显示（在设置页） | 不显示          | 顶部显示 40px      |

### 3.2 对话框/弹窗

| 类型         | 移动端                         | 桌面端                       |
| ------------ | ------------------------------ | ---------------------------- |
| 确认对话框   | Alert Dialog（中心弹出，全宽） | Modal Dialog（480px 最大宽） |
| 选项菜单     | Bottom Sheet                   | Dropdown Popover             |
| 大型表单     | 全屏页面                       | Modal（560px）或右侧面板     |
| Emoji 选择器 | Bottom Sheet 全屏              | Popover 260×320px            |
| 文件选择预览 | Bottom Sheet                   | 内联展示                     |

### 3.3 消息输入区

| 元素       | 移动端                         | 桌面端                              |
| ---------- | ------------------------------ | ----------------------------------- |
| 发送方式   | 专属发送按钮（Enter换行）      | Enter 发送（Shift+Enter 换行）      |
| 工具栏     | 精简（Image/Clip/Emoji/Voice） | 完整（Image/Clip/Emoji/Voice/More） |
| 录音       | 按住录音按钮                   | 点击切换录音模式                    |
| 输入框高度 | min 44px, max 120px            | min 48px, max 200px                 |

### 3.4 个人资料页

| 元素     | 移动端                  | 桌面端                                |
| -------- | ----------------------- | ------------------------------------- |
| 编辑入口 | 顶部 AppBar 右侧 [编辑] | 页面内 [编辑] 按钮 / 行内 [编辑] 链接 |
| 编辑方式 | 全屏页面                | Modal（560px）                        |
| 二维码   | 全屏页面                | Modal（380px）                        |
| 头像大小 | 96px（横幅出血）        | 96px（横幅出血）                      |
| 横幅高度 | 140px                   | 120px                                 |

### 3.5 设置页

| 元素     | 移动端                   | 桌面端                     |
| -------- | ------------------------ | -------------------------- |
| 布局     | 单列滚动列表（全屏）     | 主从双栏（240px + flex:1） |
| 导航     | 顶部 AppBar（返回+标题） | 左侧导航列表               |
| 子页面   | 全屏跳转                 | 右侧内容区更新             |
| 外观选择 | 底部 Sheet               | 内联 Popover               |

---

## 四、触摸与鼠标交互差异

### 4.1 点击/触摸目标尺寸

```
移动端最小触摸目标: 44×44px（即使视觉上更小也需满足）
桌面端最小点击区域: 32×32px

实现方式:
  移动端使用 min-h-[44px] min-w-[44px] 确保最小尺寸
  或使用伪元素扩展点击区域 (::after { content:''; position:absolute; inset:-4px })
```

### 4.2 悬浮状态

```
移动端: 无 hover 状态（触摸没有 hover）
桌面端: hover 态必须提供清晰视觉反馈

实现: Tailwind md:hover: 前缀限制悬浮效果仅桌面生效
或使用 @media (hover: hover) 媒体查询
```

### 4.3 右键菜单

```
桌面端:
  右键消息气泡: 显示 Context Menu（复制/回复/转发/撤回/更多）
  右键会话项: 置顶/免打扰/删除
  使用 onContextMenu 事件 + Popover

移动端:
  长按触发: 同桌面右键功能，但以 Bottom Sheet 展示
  震动反馈: navigator.vibrate(50)（支持时）
```

---

## 五、Capacitor 原生功能映射

移动端 Capacitor 版本使用以下原生能力：

| 功能      | Capacitor API                    | 备注                       |
| --------- | -------------------------------- | -------------------------- |
| 推送通知  | `@capacitor/push-notifications`  | FCM (Android) / APNs (iOS) |
| 相机/图库 | `@capacitor/camera`              | 头像上传、发送图片         |
| 文件操作  | `@capacitor/filesystem`          | 文件下载保存               |
| 状态栏    | `@capacitor/status-bar`          | 颜色跟随主题               |
| 震动      | `@capacitor/haptics`             | 消息收到、录音             |
| 键盘      | `@capacitor/keyboard`            | 键盘高度感知               |
| 剪贴板    | `@capacitor/clipboard`           | 复制元聊号/消息            |
| 分享      | `@capacitor/share`               | 分享二维码/链接            |
| 网络      | `@capacitor/network`             | 离线检测                   |
| 安全存储  | `@capacitor/preferences`         | Token 安全存储             |
| 深层链接  | `@capacitor/app`                 | yuanchat:// 协议           |
| 生物识别  | `@capacitor-community/biometric` | 可选：指纹/面部解锁        |

---

## 六、深色模式适配

```
实现机制:
  Tailwind dark: 前缀 + HTML class="dark" 控制
  切换: themeStore.toggleMode() 更新 class 并存储到 localStorage
  跟随系统: prefers-color-scheme 媒体查询监听（"跟随系统" 选项）

Tauri 桌面端:
  初始化时读取系统主题
  监听系统主题变化（tauri 插件）

Capacitor 移动端:
  @capacitor/status-bar StyleType 随主题切换
  Android: setBackgroundColor 跟随导航栏色

CSS 变量方案:
  亮色变量在 :root {} 定义
  暗色变量在 .dark {} 或 @media (prefers-color-scheme: dark) {} 覆盖
  所有颜色使用 CSS 变量，不硬编码（认证页背景光球颜色除外）

过渡动画:
  主题切换时整页 color-scheme 过渡
  transition: background-color 200ms standard, color 200ms standard
  图片不受影响（避免图片闪烁）
```

---

## 七、性能优化指南

### 7.1 代码分割策略

```
路由级别懒加载:
  /login, /register: 公共入口，随主包加载
  /chat: 首屏功能，优先加载
  /contacts: 次优先
  /settings: 按需加载（lazy import）
  /profile: 按需加载

组件级别懒加载:
  Emoji Picker: 首次点击才加载
  语音录制: 首次点击才加载
  二维码生成: 按需加载
  文件预览器: 按需加载
```

### 7.2 图片优化

```
头像:
  WebP 格式 + JPEG 兜底
  不同 DPI 提供: 40px@1x, 80px@2x, 120px@3x
  CDN 缓存: 永久（URL 含内容 Hash）

消息图片:
  缩略图优先加载: 200px 模糊缩略图（快速显示）
  原图按需加载: 点击时加载全分辨率
  渐进式渲染: blur-up 技术（模糊→清晰）

骨架屏:
  首屏显示骨架屏 < 200ms（比 Spinner 更好）
  骨架屏与真实内容布局一致，防止 CLS > 0.1
```

### 7.3 WebView 兼容性

```
build.target: "es2019" (vite.config.ts)
  转译: ?. ?? 等 ES2020+ 语法
  兼容: Android System WebView ≥ Chrome 74

CSS 兼容:
  不使用 CSS 嵌套语法（未广泛支持）
  不使用 CSS Container Queries（可使用 JS 替代）
  不使用 :has() 伪类（部分旧版本不支持）

Polyfills:
  smoothscroll-polyfill: 平滑滚动
  IntersectionObserver: 下拉加载检测
```

---

## 八、屏幕尺寸适配矩阵

| 设备场景                  | 屏幕宽    | 布局         | 导航          | 特殊处理          |
| ------------------------- | --------- | ------------ | ------------- | ----------------- |
| 小手机竖屏 (iPhone SE)    | 375px     | 单列全屏     | 底部 Tab 56px | 紧凑间距          |
| 标准手机竖屏 (iPhone 14)  | 390px     | 单列全屏     | 底部 Tab 56px | 标准间距          |
| 大手机竖屏 (iPhone 15 PM) | 430px     | 单列全屏     | 底部 Tab 56px | 宽松间距          |
| 手机横屏                  | 667-932px | 单列 or 双列 | 侧边图标 48px | 减少 AppBar 高度  |
| 小平板竖屏 (iPad mini)    | 768px     | 双列         | 侧边图标 48px |                   |
| 标准平板竖屏 (iPad 11")   | 834px     | 双列         | 侧边图标 48px |                   |
| 平板横屏 (iPad 11")       | 1194px    | 三列         | 侧边 64px     | 显示详情面板      |
| 桌面端窄窗口              | 1024px    | 三列         | 侧边 64px     | 隐藏详情面板      |
| 桌面端标准                | 1280px    | 三列 + 详情  | 侧边 64px     |                   |
| 桌面端宽屏                | 1440px+   | 三列 + 详情  | 侧边 64px     | 内容区 max-w 限制 |
