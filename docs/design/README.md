# 元聊 YuanChat — UI/UX 设计规范导航

> 本目录包含元聊所有界面的完整设计规范，供 OpenDesign 等设计工具制作原型图。
> 设计基于 **Material Design 3**，主题色为天蓝渐变（#5B9BD5 → #7EC8E3），支持亮/暗双色主题及多套皮肤。

---

## 文档目录

| 文件                                                     | 内容                                  | 状态    |
| -------------------------------------------------------- | ------------------------------------- | ------- |
| [00_DESIGN_LANGUAGE.md](./00_DESIGN_LANGUAGE.md)         | 设计语言规范（颜色/字体/间距/组件）   | ✅ 完成 |
| [01_AUTH_PAGES.md](./01_AUTH_PAGES.md)                   | 认证页面（登录/注册/忘记密码）        | ✅ 完成 |
| [02_MAIN_INTERFACE.md](./02_MAIN_INTERFACE.md)           | 主界面（布局/导航/会话列表/聊天窗口） | ✅ 完成 |
| [03_CONTACTS_PAGE.md](./03_CONTACTS_PAGE.md)             | 通讯录（联系人列表/添加/好友申请）    | ✅ 完成 |
| [04_SETTINGS_PAGE.md](./04_SETTINGS_PAGE.md)             | 设置（账号/通知/外观/隐私/设备）      | ✅ 完成 |
| [05_PROFILE_PAGE.md](./05_PROFILE_PAGE.md)               | 个人资料（我的/他人/二维码/编辑）     | ✅ 完成 |
| [06_PLATFORM_ADAPTATION.md](./06_PLATFORM_ADAPTATION.md) | 多端适配（移动/平板/桌面/Tauri）      | ✅ 完成 |

---

## 快速参考

### 品牌色

| 名称         | 亮色                                | 暗色      |
| ------------ | ----------------------------------- | --------- |
| 主色 Primary | `#5B9BD5`                           | `#A8CFFF` |
| 品牌渐变     | `135°: #5B9BD5 → #7EC8E3 → #A8CFFF` | 同左加深  |
| 页面背景     | `#F0F7FF`                           | `#0E141B` |
| 主要文字     | `#171C24`                           | `#DEE5EE` |
| 次要文字     | `#424853`                           | `#C2C8D3` |
| 分隔线       | `#C2C8D3`                           | `#424853` |
| 错误色       | `#BA1A1A`                           | `#FFB4AB` |

### 关键尺寸

| 元素                | 尺寸                    |
| ------------------- | ----------------------- |
| 侧边导航宽（桌面）  | 64px                    |
| 会话列表宽（默认）  | 260px（可拖拽至 360px） |
| 详情面板宽          | 240-280px               |
| 底部 Tab 高（移动） | 56px + safe-area        |
| 输入框高度          | 48px                    |
| 标准按钮高度        | 48px                    |
| Avatar（会话列表）  | 40px                    |
| Avatar（详情大图）  | 96px                    |
| 消息气泡最大宽      | 70%                     |

### 字体基准

```
base font-size: 14px  （html 元素设置）
Body Large:    14px   （1rem） — 正文
Title Large:   19px   （1.375rem） — 标题
Headline Large: 28px  （2rem） — 页面标题
Label Medium:  10.5px （0.75rem） — 时间戳/辅助
```

---

## 页面清单（OpenDesign 原型图帧）

### 认证流程

```
Auth/Login         — 登录页（默认：账号密码 Tab）
Auth/Login-Phone   — 登录页（手机验证码 Tab）
Auth/Login-QR      — 登录页（扫码 Tab）
Auth/Register-1    — 注册页步骤1（手机验证）
Auth/Register-2    — 注册页步骤2（完善资料）
Auth/Register-Done — 注册成功
Auth/ForgotPwd-1   — 忘记密码步骤1（填写账号）
Auth/ForgotPwd-2   — 忘记密码步骤2（OTP 验证）
Auth/ForgotPwd-3   — 忘记密码步骤3（设置新密码）
Auth/ForgotPwd-Done — 重置成功
```

### 主界面

```
Main/Desktop-Empty    — 桌面三栏，无选中会话
Main/Desktop-Chat     — 桌面三栏，聊天窗口激活
Main/Desktop-Detail   — 桌面三栏 + 详情面板
Main/Mobile-List      — 移动端会话列表
Main/Mobile-Chat      — 移动端聊天窗口
Main/Mobile-Toolbar   — 移动端输入工具栏展开
```

### 通讯录

```
Contacts/Desktop      — 桌面端通讯录列表
Contacts/Mobile       — 移动端通讯录列表
Contacts/AddFriend    — 添加好友 Modal/页面
Contacts/Requests     — 好友申请列表
Contacts/ContactDetail — 联系人详情
```

### 设置

```
Settings/Desktop        — 桌面主从设置页
Settings/Mobile-List    — 移动端设置列表
Settings/Account        — 账号与安全
Settings/Notification   — 消息与通知
Settings/Appearance     — 外观设置（含主题/皮肤/字体）
Settings/Privacy        — 隐私设置
Settings/Devices        — 设备管理
Settings/About          — 关于元聊
```

### 个人资料

```
Profile/Mine-View     — 我的资料（查看）
Profile/Mine-Edit     — 我的资料（编辑 Modal/页面）
Profile/Mine-QR       — 我的二维码
Profile/Other-Friend  — 他人资料（已是好友）
Profile/Other-Stranger — 他人资料（非好友）
```

---

## 设计系统组件清单（供 OpenDesign 建立组件库）

| 类别     | 组件                                                                                        |
| -------- | ------------------------------------------------------------------------------------------- |
| **基础** | Button (Filled/Outlined/Text/Icon), Input (默认/搜索/密码/OTP), Avatar (xs/sm/md/lg/xl/2xl) |
| **反馈** | Badge（角标）, Toast, Dialog, Loading Spinner, Skeleton                                     |
| **导航** | LeftNav, BottomTabBar, AppBar（移动顶栏）, Breadcrumb                                       |
| **聊天** | ConversationItem, MessageBubble (发送/接收/引用/图片/文件/语音), InputArea, TypingIndicator |
| **表单** | Toggle Switch, Radio Group, Checkbox, Select/Dropdown, Slider, DatePicker                   |
| **容器** | SettingsCard（分组卡片）, ProfileBanner, Modal/Sheet, ContextMenu, Popover                  |
| **状态** | EmptyState（无内容）, ErrorState（加载失败）, OnlineIndicator                               |

---

> **更新说明**: 2026-06-29 初版设计规范创建，覆盖全部核心页面。
> 后续迭代请在各 `docs/design/` 文件中补充，并同步更新本索引。
