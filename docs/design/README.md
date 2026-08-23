# 元聊 YuanChat — UI/UX 设计规范导航

> 本目录包含元聊所有界面的完整设计规范，供 OpenDesign 等设计工具制作原型图。
> 设计基于 **Material Design 3**（Aurora 主题），品牌渐变 `#5B9BD5 → #7EC8E3 → #A8CFFF`，支持亮/暗双色主题。
> 版本: v1.1 / 最后更新: 2026-07-06

---

## 文档目录

| 文件                                               | 内容                                             | 状态    | 版本 |
| -------------------------------------------------- | ------------------------------------------------ | ------- | ---- |
| [DESIGN_LANGUAGE.md](./DESIGN_LANGUAGE.md)         | 设计语言（色彩/字体/间距/组件/动效/A11y）        | ✅ 完成 | v1.1 |
| [AUTH_PAGES.md](./AUTH_PAGES.md)                   | 认证流程（登录/注册/忘记密码/二步验证/生物识别） | ✅ 完成 | v1.1 |
| [MAIN_INTERFACE.md](./MAIN_INTERFACE.md)           | 主界面（三栏布局/会话/聊天/CommandPalette/AI）   | ✅ 完成 | v1.1 |
| [CONTACTS_PAGE.md](./CONTACTS_PAGE.md)             | 通讯录（联系人/添加/群组/企业通讯录）            | ✅ 完成 | v1.1 |
| [SETTINGS_PAGE.md](./SETTINGS_PAGE.md)             | 设置（账号/通知/外观/隐私/快捷键/AI）            | ✅ 完成 | v1.1 |
| [PROFILE_PAGE.md](./PROFILE_PAGE.md)               | 个人资料（我的/编辑/二维码/他人/在线状态）       | ✅ 完成 | v1.1 |
| [PLATFORM_ADAPTATION.md](./PLATFORM_ADAPTATION.md) | 多端适配（移动/桌面 Tauri/Web/手势/性能）        | ✅ 完成 | v1.1 |

---

## 快速参考

### 品牌色

| Token 名称                          | 亮色                                | 暗色      | WCAG 对比          |
| ----------------------------------- | ----------------------------------- | --------- | ------------------ |
| `--md-sys-color-primary`            | `#5B9BD5`                           | `#A8CFFF` | ≥ 3.0:1 on surface |
| 品牌渐变                            | `135°: #5B9BD5 → #7EC8E3 → #A8CFFF` | —         | —                  |
| `--md-sys-color-background`         | `#F0F7FF`                           | `#0E141B` | —                  |
| `--md-sys-color-on-background`      | `#171C24`                           | `#DEE5EE` | 10.5:1             |
| `--md-sys-color-on-surface-variant` | `#424853`                           | `#C2C8D3` | 5.9:1              |
| `--md-sys-color-outline-variant`    | `#C2C8D3`                           | `#424853` | —                  |
| `--md-sys-color-error`              | `#BA1A1A`                           | `#FFB4AB` | ≥ 4.5:1            |

### 关键尺寸

| 元素                    | 桌面                      | 移动                |
| ----------------------- | ------------------------- | ------------------- |
| 侧边导航宽              | 64px                      | 底部 TabBar 56px 高 |
| 会话列表宽              | 260px（可拖拽 200-360px） | 全屏                |
| 详情面板宽              | 0/260px（可切换）         | Modal 全屏          |
| 自定义标题栏高（Tauri） | 40px                      | —                   |
| 消息气泡最大宽          | 60%                       | 75%                 |
| Avatar — 会话列表       | 40px                      | 40px                |
| Avatar — 详情大图       | 96px                      | 96px                |
| 最小点击目标            | 32×32px                   | 44×44px             |

### 字体规模

```
基准: html { font-size: calc(14px * var(--font-scale)) }  (--font-scale 默认 1.0)

Headline Large:  28px / 2rem   — 页面主标题
Title Large:     19px / 1.375rem — 区块标题
Title Medium:    16px / 1.143rem — 卡片标题
Body Large:      14px / 1rem    — 正文（基准）
Body Medium:     12.25px / 0.875rem — 次要正文
Label Medium:    10.5px / 0.75rem — 时间戳、辅助标签
```

### Z-Index 层级

| 层级       | z-index | 用途                 |
| ---------- | ------- | -------------------- |
| z-base     | 0       | 普通内容流           |
| z-sticky   | 10      | 粘性分组标题、输入区 |
| z-dropdown | 20      | 下拉菜单、Popover    |
| z-sheet    | 30      | Bottom Sheet         |
| z-modal    | 40      | Modal 对话框         |
| z-toast    | 50      | Toast 通知           |
| z-lightbox | 60      | 图片查看器           |
| z-titlebar | 100     | Tauri 自定义标题栏   |

---

## 完整 OpenDesign 帧清单

### 认证流程（Auth）

```
Auth/Login-Password           — 账号密码登录
Auth/Login-Phone              — 手机验证码登录
Auth/Login-QR                 — 二维码登录（Web/桌面）
Auth/Login-QR-Scanned         — 二维码已扫描（手机端确认态）
Auth/Login-QR-Confirmed       — 二维码已确认登录
Auth/Login-QR-Expired         — 二维码已过期
Auth/Login-Biometric          — 生物识别解锁
Auth/Login-SSO                — 企业 SSO 登录

Auth/Register-1               — 注册：手机验证
Auth/Register-2               — 注册：完善资料
Auth/Register-Done            — 注册成功欢迎页

Auth/ForgotPwd-1              — 忘记密码：填写账号
Auth/ForgotPwd-2              — 忘记密码：OTP 验证
Auth/ForgotPwd-3              — 忘记密码：设置新密码
Auth/ForgotPwd-Done           — 重置成功

Auth/2FA-SMS                  — 二步验证：短信 OTP
Auth/2FA-Email                — 二步验证：邮件 OTP
Auth/2FA-TOTP                 — 二步验证：Authenticator App
Auth/2FA-Backup               — 二步验证：备用码

Auth/Security-Error           — 密码错误 / 账号锁定状态
Auth/Dark-Login               — 暗色模式登录页
```

### 主界面（Main）

```
Main/Desktop-Empty            — 桌面三栏，右侧空态引导
Main/Desktop-Chat             — 桌面三栏，聊天窗口激活
Main/Desktop-Detail           — 桌面三栏 + 右侧详情面板
Main/Desktop-CommandPalette   — ⌘K 命令面板弹出（全局模糊覆盖）
Main/Desktop-AIPanel          — AI 助手侧栏展开
Main/Desktop-MultiSelect      — 消息多选操作模式
Main/Desktop-InChatSearch     — 会话内搜索结果

Main/Mobile-ConvList          — 移动端会话列表
Main/Mobile-Chat              — 移动端聊天窗口
Main/Mobile-Toolbar-Collapsed — 输入工具栏（折叠态）
Main/Mobile-Toolbar-Expanded  — 输入工具栏（展开态）
Main/Mobile-EmojiPicker       — Emoji 选择器（Bottom Sheet）
Main/Mobile-VoiceRecord       — 语音录制界面

Main/Message-Types            — 消息类型展示（文本/图片/文件/语音/位置/投票/AI总结）
Main/Message-Reactions        — Emoji Reactions + AI 建议气泡
Main/Message-Editing          — 消息编辑状态
Main/Message-Scheduled        — 定时消息设置

Main/OnlineStatus-Picker      — 在线状态选择器
Main/NewConv-Select           — 新建会话选择联系人

Main/Dark-Chat                — 暗色聊天界面
```

### 通讯录（Contacts）

```
Contacts/Desktop-List         — 桌面端通讯录列表
Contacts/Desktop-Detail       — 桌面端联系人详情（右侧面板）
Contacts/Desktop-Empty        — 空通讯录状态

Contacts/Mobile-List          — 移动端通讯录列表
Contacts/Mobile-Alphabet      — 字母索引触摸气泡
Contacts/Mobile-Detail        — 联系人详情（全屏）

Contacts/AddFriend-Search     — 添加好友：搜索 Tab
Contacts/AddFriend-QR         — 添加好友：扫码 Tab
Contacts/AddFriend-Phone      — 添加好友：手机联系人 Tab
Contacts/AddFriend-NearBy     — 添加好友：附近的人 Tab
Contacts/AddFriend-Result     — 搜索结果用户卡片
Contacts/AddFriend-Request    — 发送申请附言 Dialog

Contacts/Requests-Pending     — 好友申请：有待处理
Contacts/Requests-Accepted    — 申请接受后状态
Contacts/Requests-Empty       — 申请列表空态

Contacts/Note-Edit            — 修改备注名弹窗
Contacts/Tags-Manage          — 联系人标签管理

Contacts/Groups-List          — 群组列表
Contacts/Groups-Create-1      — 创建群聊：选择成员
Contacts/Groups-Create-2      — 创建群聊：设置信息

Contacts/Enterprise-Tree      — 企业通讯录：部门树
Contacts/Enterprise-Search    — 企业通讯录：搜索
Contacts/Enterprise-Card      — 员工详情 Hover 卡片
```

### 设置（Settings）

```
Settings/Desktop-Main         — 桌面主从设置（首页）
Settings/Mobile-List          — 移动端设置列表

Settings/Account              — 账号与安全
Settings/Account-Phone        — 手机号管理
Settings/Account-Email        — 邮箱管理
Settings/Account-Passkey      — 通行密钥（Passkey）管理
Settings/Account-2FA          — 两步验证设置
Settings/Account-Biometric    — 生物识别设置

Settings/Notification         — 消息通知
Settings/Notification-DND     — 免打扰时段设置

Settings/Appearance           — 外观（主题/皮肤/字体/密度/语言）
Settings/Appearance-Density   — 密度选择（含实时预览）
Settings/Appearance-BG        — 聊天背景自定义

Settings/Privacy              — 隐私设置
Settings/Privacy-ReadReceipt  — 已读回执设置
Settings/Privacy-BlockList    — 黑名单管理

Settings/Devices              — 已登录设备列表

Settings/Shortcuts            — 快捷键设置（桌面专属）
Settings/Shortcuts-Edit       — 单个快捷键修改

Settings/AI                   — AI 功能开关
Settings/Storage              — 本地存储管理

Settings/About                — 关于元聊
Settings/Feedback             — 反馈页面

Settings/Dark-Main            — 暗色模式设置页
```

### 个人资料（Profile）

```
Profile/Mine-View             — 我的资料（查看，桌面）
Profile/Mine-View-Mobile      — 我的资料（移动端）
Profile/Mine-Edit-Modal       — 编辑资料（Modal，桌面）
Profile/Mine-Edit-Full        — 编辑资料（全屏，移动）
Profile/Mine-Edit-Crop        — 头像裁剪 Modal
Profile/Mine-QR               — 我的二维码（桌面）
Profile/Mine-QR-Mobile        — 我的二维码（移动）
Profile/Mine-Status           — 自定义状态 Picker

Profile/Other-Friend          — 他人资料（已好友，桌面）
Profile/Other-Friend-Mobile   — 他人资料（已好友，移动）
Profile/Other-Stranger        — 他人资料（非好友）
Profile/Other-Pending         — 他人资料（申请等待中）
Profile/Other-Received        — 他人资料（对方申请我）
Profile/Other-QR              — 他人二维码

Profile/Mutual-Friends        — 共同好友列表
Profile/Mutual-Groups         — 共同群聊列表

Profile/Dark-Mine             — 暗色模式我的资料
```

### 多端适配（Platform）

```
Platform/Breakpoint-Mobile    — 移动端主界面（375px）
Platform/Breakpoint-Tablet    — 平板主界面（768px，双栏）
Platform/Breakpoint-Desktop   — 桌面主界面（1280px，三栏）
Platform/Breakpoint-Wide      — 宽屏桌面（1440px，三栏+详情）

Platform/Tauri-TitleBar-Win   — Tauri 标题栏（Windows）
Platform/Tauri-TitleBar-Mac   — Tauri 标题栏（macOS）
Platform/Tauri-Tray-Menu      — 系统托盘菜单
Platform/Tauri-FileDrop       — 文件拖放覆盖层

Platform/Mobile-SafeArea      — 安全区域适配示意
Platform/Mobile-Keyboard      — 软键盘弹出状态
Platform/Mobile-GestureBack   — 左滑返回手势
Platform/Mobile-BottomSheet-S — Bottom Sheet 小尺寸
Platform/Mobile-BottomSheet-L — Bottom Sheet 大尺寸

Platform/Dark-Desktop         — 暗色桌面端
Platform/Dark-Mobile          — 暗色移动端
Platform/Offline-Banner       — 离线状态提示
```

---

## 设计系统组件清单（OpenDesign 组件库）

### 基础控件

| 组件   | 变体                                                         |
| ------ | ------------------------------------------------------------ |
| Button | Filled / Outlined / Text / Icon / FAB                        |
| Input  | 默认 / 搜索 / 密码 / OTP / Textarea                          |
| Avatar | xs 20 / sm 32 / md 40 / lg 56 / xl 80 / 2xl 96（带在线状态） |
| Badge  | 数字角标 / 小红点 / 通知气泡                                 |
| Chip   | 选择型 / 输入型 / 过滤型 / 建议型                            |

### 反馈与状态

| 组件       | 变体                                    |
| ---------- | --------------------------------------- |
| Toast      | 成功 / 信息 / 警告 / 错误（带 Undo）    |
| Dialog     | Alert / Confirm / Form                  |
| Skeleton   | 文本行 / 头像圆 / 卡片 / 列表项         |
| Loading    | Spinner / 进度条 / 圆形进度环           |
| EmptyState | 无内容 / 无搜索结果 / 无权限 / 网络错误 |

### 导航

| 组件           | 变体                                   |
| -------------- | -------------------------------------- |
| LeftNav        | 桌面侧边栏（64px）/ 平板图标条（48px） |
| BottomTabBar   | 移动端底部导航（56px）                 |
| AppBar         | 移动顶栏（56px，带返回/操作）          |
| CommandPalette | ⌘K 全局命令面板                        |

### 聊天组件

| 组件             | 变体                                                                 |
| ---------------- | -------------------------------------------------------------------- |
| ConversationItem | 标准 / 置顶 / 免打扰 / 群聊                                          |
| MessageBubble    | 发送/接收 / 文本 / 图片 / 文件 / 语音 / 引用 / 投票 / 位置 / AI 总结 |
| EmojiReaction    | 单个 / 列表 / AI 建议卡                                              |
| InputArea        | 基础 / 展开工具栏 / 录音模式 / 引用回复                              |
| TypingIndicator  | 单人 / 多人（"A、B 正在输入"）                                       |

### 容器与布局

| 组件               | 变体                                            |
| ------------------ | ----------------------------------------------- |
| SettingsCard       | 单行 / 带副标题 / 带开关 / 危险操作             |
| ProfileBanner      | 渐变 / 自定义图片 / 骨架                        |
| Modal              | Small（384px）/ Medium（512px）/ Large（560px） |
| BottomSheet        | Small / Medium / Large / Full                   |
| Popover / Dropdown | 菜单列表 / 复杂内容                             |
| ContextMenu        | 桌面右键菜单                                    |
| Lightbox           | 图片查看器（单图/多图）                         |

---

> **规范维护说明**
>
> - 各页面规范文件位于 `docs/design/`，OpenDesign 原型图以此为准
> - 新增页面/组件需同步更新本索引
> - 版本 v1.1 完成于 2026-07-06，覆盖全部核心页面 + OpenDesign 帧清单
> - 下一轮迭代建议：动态/朋友圈页面（07）、群设置页（08）、文件管理页（09）
