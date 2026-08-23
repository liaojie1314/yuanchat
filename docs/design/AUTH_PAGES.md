# 01 — 认证页面设计规范（Auth Pages）

> 涵盖：登录 / 注册 / 忘记密码 / 扫码登录 / 生物识别 / 二次验证
> 视觉基调：Aurora 极光 —— 三层装饰（光球 + 微尘网格 + 流光扫描）营造"专业但温暖"的第一印象
> 依赖：`DESIGN_LANGUAGE.md`

---

## 一、设计目标（Design Goals）

### 1.1 认证页要解决的三件事

1. **降低摩擦**：让用户在 15 秒内完成登录（老用户）或 90 秒内完成注册（新用户）
2. **建立信任**：第一屏就传达品牌可靠性 —— Aurora 视觉 + 明确的"企业级"标语
3. **减少焦虑**：错误就地校验、密码强度实时提示、进度可视化

### 1.2 与竞品差异化

| 竞品痛点                     | 元聊解法                                       |
| ---------------------------- | ---------------------------------------------- |
| 微信登录页极简但缺乏品牌辨识 | Aurora 视觉建立独特品牌记忆点                  |
| QQ 登录页营销广告过多        | 认证页面绝对纯净，无任何营销                   |
| Telegram 只支持手机号        | 同时支持元聊号 / 手机 / 邮箱 / 扫码 / 生物识别 |
| 多数 IM 忘记密码流程长且模糊 | 明确 3 步 + 进度条 + 每步耗时预估              |

### 1.3 核心原则

- **一致的沉浸感**：三个页面共享完全相同的背景装饰层，用户在跳转时背景不闪烁
- **逐步披露**：注册和找回密码拆分为步骤流，每步只问最少信息
- **即时反馈**：每个输入框失焦时校验，错误就地提示，不等到提交
- **快速聚焦**：进入页面自动聚焦第一个输入框
- **意图明确**：Sign In / Sign Up / Reset 语义与视觉区分清晰
- **安全优先**：密码永不明文回显、复制、日志

---

## 二、登录页（LoginPage） `/login`

### 2.1 布局结构

```
┌─────────────────────────────────────────────────────────────────────────┐
│  [Tauri TitleBar 40px — 桌面端]                                          │
│  [背景装饰层：Aurora 光球 + 微尘网格 + 流光扫描 + 鼠标光晕]                │
│                                                                         │
│                    ┌──────────────────────────────────┐                 │
│                    │           [Logo 区]               │                 │
│                    │   [品牌渐变圆角方形 80×80px]      │                 │
│                    │        ✉ MessageCircle 40px       │                 │
│                    │           元    聊               │  Headline Large  │
│                    │      Chat, Reimagined.           │  Body Large      │
│                    ├──────────────────────────────────┤                 │
│                    │       [登录方式 Tab 切换]          │                 │
│                    │  [账号密码] [手机验证码] [扫码]   │                 │
│                    ├──────────────────────────────────┤                 │
│                    │     — 账号密码 Tab 内容 —         │                 │
│                    │   ┌──────────────────────────┐   │                 │
│                    │   │  🔍 元聊号 / 手机号         │   │  Input 48px    │
│                    │   └──────────────────────────┘   │                 │
│                    │   ┌──────────────────────────┐   │                 │
│                    │   │  🔒 密码          [Eye]   │   │  Input 48px    │
│                    │   └──────────────────────────┘   │                 │
│                    │   [记住我 ○]          [忘记密码?] │                 │
│                    │   ┌──────────────────────────┐   │                 │
│                    │   │          登  录             │   │  Button Filled │
│                    │   └──────────────────────────┘   │                 │
│                    │   ─ 或使用 ─                     │                 │
│                    │   [🔑 生物识别] [🔒 SSO]          │  次要登录方式   │
│                    │   还没有账号？[立即注册 →]         │                 │
│                    └──────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 组件详细规格

#### Logo 区

```
容器:         text-center, margin-bottom 40px
Logo 盒:      80×80px, brand-gradient, radius 28px (xl), glow-brand 阴影
Logo 图标:    MessageCircle, 40px, #FFFFFF, strokeWidth 2
标题:         "元聊", Headline Large (2rem/28px), 600, on-surface
副标题:       "Chat, Reimagined." / "企业级即时通讯"
             Body Large, 400, on-surface-variant
Logo 与标题间距: 20px
标题与副标题间距: 8px
入场动画:    Logo 盒 0.9→1 scale + fade, 400ms decelerate, delay 100ms
```

#### 登录方式 Tab

```
容器:         宽度 100%, display: flex, border-bottom 1px outline-variant
Tab 项:       flex-1, 高度 40px, 居中文字
             字体: Label Large (0.875rem, 500)
             默认: on-surface-variant
             激活: primary 色, 底部 2px primary 色下划线
             切换动画: 下划线 translateX + width, 200ms standard

Tab 选项:
  - 账号密码 (默认)
  - 手机验证码
  - 扫码登录

支持键盘: ← → 切换 Tab，Enter 激活
移动端:   横向可滑动（若增加更多方式如 SSO）
```

#### 账号密码 Tab 内容

**输入框 1 — 账号**

```
placeholder: "元聊号 / 手机号 / 邮箱"
type: text
inputmode: text（含数字/字母）
autocomplete: username
maxLength: 64
自动去除前后空格
键入时: 清除账号错误
失焦校验: 若不符合任何格式（元聊号 Y+8数字 / 11位手机 / 邮箱），提示 "请输入正确的账号"
```

**输入框 2 — 密码**

```
placeholder: "密码"
type: password (可切换 text 显示)
autocomplete: current-password
maxLength: 64
右侧: Eye/EyeOff 图标按钮 (32×32px)
     切换按钮 aria-pressed 状态
Enter 键: 触发登录
禁用剪贴板: onCopy/onCut 阻止复制密码
```

**辅助行**

```
布局: flex, justify-between, align-center, margin-top 8px

左侧 — 记住我:
  Checkbox 16×16px + "保持登录状态" Label Medium
  Hover: Checkbox 出现淡蓝背景
  移动端: 默认开启（因为已开锁屏 = 已具备设备保护）
  桌面端: 默认关闭（公共设备可能性高）

右侧 — 忘记密码:
  链接文字，Label Medium，primary 色
  Hover: 下划线
  路由: /forgot-password（传递已输入的账号作为 hint）
```

**主按钮**

```
文字: "登 录"（中文字间加空格，视觉均衡）
宽度: 100%
高度: 48px
变体: Filled (brand-gradient)
禁用条件: 账号/密码任一为空
Loading 态:
  文字替换为 "登录中…"
  左侧插入 16px Spinner
  按钮 pointer-events: none
  超时 (>15s): 变为 "网络似乎较慢，正在重试…"

Focus Ring: outline 2px primary + 2px offset
```

**次要登录方式（新增）**

```
分隔:   flex align-center 的 "─ 或使用 ─" (Label Medium, on-surface-variant)
        左右 1px outline-variant 线条延伸

选项容器: flex justify-center gap 12px, margin-top 16px

生物识别按钮:
  40×40px 圆角 12px Outlined，图标 Fingerprint 20px
  仅当设备支持 WebAuthn 且已注册过 Passkey 时显示
  Tooltip: "使用生物识别登录"

SSO 按钮:
  40×40px 圆角 12px Outlined，图标 Building2 20px
  仅企业版显示
  Tooltip: "企业单点登录"

QR 快速切换:
  已在移动端登录时，桌面显示 "使用手机快速登录 →"，一键跳到扫码 Tab
```

**注册引导**

```
字体: Label Medium, on-surface-variant
"还没有账号？" + "立即注册" (primary, 悬浮下划线, 路由 /register)
margin-top: 24px, text-center
```

#### 手机验证码 Tab 内容

**输入框 1 — 手机号**

```
placeholder: "请输入手机号"
type: tel
inputmode: numeric
autocomplete: tel
左侧: 国旗+区号选择器按钮 "+86 🇨🇳 ▾"（高 48px，宽 96px，border-right 1px）
   点击: 弹出国家/地区搜索列表（Bottom Sheet 移动 / Popover 桌面）
   默认: 根据浏览器 language 或 IP 推断
```

**发送验证码行**

```
布局: flex gap 8px
  左: 手机号输入框 flex-1
  右: 获取验证码按钮 (Outlined, min-width 120px, high 48px)

获取验证码交互:
  1. 点击 → 按钮 loading + 请求 SMS
  2. 成功 → Toast "验证码已发送" + 按钮 disabled 显示 "60s"
  3. 每秒 -1，倒计时期间禁用
  4. 结束 → 恢复"重新获取"
  5. 失败 → Toast error，按钮立即恢复
  防抖:   连续 3 次内点击视为一次
  上限:   同手机号 10 分钟最多 5 次
```

**输入框 2 — 验证码**

```
组件: 6 位分离式 OTP 输入框（见 §4.3.3 OTP 规格）
自动填充: autocomplete="one-time-code" (iOS Safari 会显示键盘上方 SMS 建议)
自动验证: 填满 6 位后自动提交（无需点按钮）
错误后自动清空并聚焦第一格
```

**主按钮**: 输入满 6 位后自动触发，也可点击"登 录"

#### 扫码登录 Tab 内容

```
说明文字:
  "使用手机端元聊扫描二维码登录"
  Body Medium, on-surface-variant, text-center

二维码区:
  尺寸: 200×200px
  背景: surface-container-lowest, radius 12px, border 1px outline-variant
  内边距: 16px
  中心 Logo: 32×32px 元聊 Logo（白色圆角方形）
  容错级别: M（可容忍中心 Logo 覆盖）

生成规则:
  URL: yuanchat://login/qr?token=<uuid>
  有效期: 90s，剩余 <15s 时倒计时红色显示

状态机:
  waiting        默认，展示二维码 + Spinner "等待扫描…"
  scanned        手机端扫到 → 顶部条 "已扫描，请在手机确认"
                二维码遮罩浅绿 + CheckCircle2 覆盖
  confirmed      手机确认 → 二维码淡出 + "登录成功" 大绿勾
                800ms 后自动路由 /chat
  expired        90s 过期 → 灰色蒙版 + "二维码已过期" + [刷新] 按钮
  rejected       手机端拒绝 → 灰色蒙版 + "已在手机取消登录"

底部提示:
  "尚未安装元聊？" + "立即下载" (primary link, 跳外链)
```

### 2.3 表单校验规则

**校验时机**：

- 用户输入时：clear 之前的错误
- 用户失焦（blur）时：静默校验，显示错误
- 提交时：所有字段校验

| 字段     | 规则                | 错误提示                             | Live announce |
| -------- | ------------------- | ------------------------------------ | ------------- |
| 账号     | 不能为空            | "请输入账号"                         | polite        |
| 账号     | 长度 ≥ 3            | "账号至少 3 个字符"                  | polite        |
| 密码     | 不能为空            | "请输入密码"                         | polite        |
| 密码     | ≥ 8 位              | "密码至少 8 位"                      | polite        |
| 密码     | 含字母+数字         | "密码需包含字母和数字"               | polite        |
| 手机号   | 11 位数字，1 开头   | "请输入有效的手机号"                 | polite        |
| 验证码   | 6 位数字            | "验证码为 6 位数字"                  | polite        |
| 后端错误 | 账号不存在/密码错误 | "账号或密码错误，请重新输入"         | assertive     |
| 后端错误 | 账号被锁            | "多次错误已被锁定，请 15 分钟后重试" | assertive     |
| 后端错误 | 账号被注销          | "账号已注销，无法登录"               | assertive     |

**错误显示**：

```
位置: 输入框正下方 4px
字体: Body Small, error 色
图标: AlertCircle 12px（可选）
入场: opacity 0→1 + translateY(-4px→0), 150ms
输入框描边: 变为 error 2px
```

### 2.4 微交互（Micro-interactions）

| 场景           | 交互                                                          |
| -------------- | ------------------------------------------------------------- |
| 输入框获得焦点 | 描边变蓝 + 3px 蓝色光晕，100ms                                |
| 密码可见性切换 | Eye ↔ EyeOff 图标 200ms fade                                  |
| 记住我勾选     | Checkbox 描边→填充，Check 图标从 0.5 scale 弹出，200ms bounce |
| 主按钮 Loading | 文字左移 4px 为 Spinner 让位，200ms                           |
| 忘记密码点击   | 下划线从左往右扫描 200ms                                      |
| Tab 切换       | 底部下划线滑动到新 Tab，200ms standard                        |
| 提交失败       | 主按钮 shake 300ms（`translateX ±4px`）                       |
| 提交成功       | 主按钮 fade + 页面淡出 300ms 到目标页                         |
| Aurora 光球    | 12s 缓慢漂移，`prefers-reduced-motion` 时静止                 |

### 2.5 多端适配

| 平台       | 差异                                                                  |
| ---------- | --------------------------------------------------------------------- |
| 桌面浏览器 | 卡片 max-width 400px，垂直水平居中；Aurora 全屏                       |
| 桌面 Tauri | 顶部保留 40px TitleBar 拖拽区，Aurora 从 TitleBar 下开始              |
| 平板       | 卡片 max-width 480px，Aurora 光球半径缩小到 400px                     |
| 移动端     | 卡片占满宽度，padding 24px；Aurora 光球 opacity 30%（避免影响可读性） |
| 移动横屏   | 布局改为水平：Logo 区 40% + 表单区 60%                                |

### 2.6 空/加载/错误/离线状态矩阵

| 状态                   | 视觉                                       | 交互                              |
| ---------------------- | ------------------------------------------ | --------------------------------- |
| Idle 空闲              | 默认布局                                   | 全部可点                          |
| Loading 加载中         | 主按钮 Spinner                             | 表单 pointer-events: none         |
| Success 成功           | 按钮变绿 + Check                           | 300ms 后路由跳转                  |
| Error 失败             | 按钮 shake + 错误 Toast                    | 主按钮恢复可点                    |
| Offline 离线           | 顶部 Warning Bar "无网络连接"              | 主按钮 disabled，onClick 时 Toast |
| Rate-Limited 限流      | 顶部 Warning Bar "尝试过多，请 X 秒后重试" | 主按钮 disabled + 倒计时          |
| Server-Down 服务不可用 | 主按钮下方错误块 "服务暂时不可用"          | 显示 [重试]                       |

### 2.7 安全交互（Security UX）

- **密码字段**：`autocomplete="current-password"`，浏览器可管理
- **明文切换**：Eye 图标切换后 8 秒自动恢复隐藏（防肩窥）
- **防截屏**（Tauri Android）：密码字段激活时开启 FLAG_SECURE
- **登录频率**：同一账号 5 次失败后强制冷却 15 分钟
- **登录环境异常**：陌生 IP / 陌生设备登录时，登录后强制二次验证（SMS/OTP/Passkey）
- **登录活动通知**：登录成功后向已登录设备推送 "新设备登录: MacBook Pro, 深圳"

---

## 三、注册页（RegisterPage） `/register`

### 3.1 流程概览

```
[步骤 1: 手机验证] ─► [步骤 2: 完善资料] ─► [注册成功]
   ~15s                  ~30s                欢迎动画 + 进入应用
```

每步顶部显示"预计耗时"，减少放弃率。

### 3.2 进度指示器（Steps Indicator）

```
─────────────────────────────────────────────
  ① ─────────── ② ─────────── ✓
  手机验证     完善资料    完成
─────────────────────────────────────────────

已完成 step: filled primary 圆 24px + 数字，白色文字
当前 step:   border 2px primary 圆 24px，primary 数字
未到达 step: surface-container-high 圆，on-surface-variant 数字
连接线:      已完成段 = primary；待完成段 = outline-variant
高度:        40px
label:       Label Medium, on-surface (当前) / on-surface-variant (其他)
margin-bottom: 32px

微交互:
  切换到下一步时，圆环从当前 step 的 border → filled 转场 300ms
  连接线从左到右填充 primary 色 400ms
```

### 3.3 步骤 1 — 手机验证

**布局**：见原图（同 §2.2 手机验证码 Tab）

**差异化**：

- 手机号输入后额外校验"该号码是否已注册"（防止用户误注册重复账号）
- 若已注册 → 提示"该号码已注册，直接登录？[登录 →]"
- 验证码验证成功后，静默创建临时 token，进入步骤 2

### 3.4 步骤 2 — 完善资料

```
┌──────────────────────────────────────┐
│  [进度指示器 — 步骤 2 激活]           │
├──────────────────────────────────────┤
│         [头像上传区]                  │
│      ┌─────────────────┐             │
│      │  [Avatar 96px]  │             │
│      │  [相机图标覆盖] │  点击上传    │
│      └─────────────────┘             │
│           选填，可跳过                │
│                                      │
│  昵称 *                              │
│  ┌──────────────────────────────┐    │
│  │  输入昵称（2-20 字符）        │[?/20]│
│  └──────────────────────────────┘    │
│  💡 提示: 可以是真名，也可以是艺名     │
│                                      │
│  密码 *                              │
│  ┌──────────────────────────────┐    │
│  │  设置密码（≥8 位）      [Eye] │    │
│  └──────────────────────────────┘    │
│  ▓▓▓▓▓▓░░░░░ 强度: 中等 (65 分)     │
│  ● 至少 8 位  ● 含字母  ● 含数字     │
│                                      │
│  确认密码 *                           │
│  ┌──────────────────────────────┐    │
│  │  再次输入密码           [Eye] │    │
│  └──────────────────────────────┘    │
│                                      │
│  ☐ 我已阅读并同意[用户协议]和[隐私政策]│
│                                      │
│  ┌──────────────────────────────┐    │
│  │         完成注册               │    │
│  └──────────────────────────────┘    │
│                                      │
│  [← 返回上一步]                      │
└──────────────────────────────────────┘
```

**头像上传区规格**

```
默认态:
  96×96px 圆形，brand-gradient
  中心 Camera 图标 24px + "上传头像" Label Small（白色）
  边缘: 白色 4px 半透明 halo（invite 感）
点击:
  Bottom Sheet（移动）/ Popover（桌面）:
    - 拍照（仅移动端相机权限）
    - 从相册选择
    - 使用默认头像
上传流程:
  1. 选中图片 → 打开圆形裁剪 Modal
  2. 拖动/缩放调整 → [确认] → 上传
  3. 上传中: Avatar 上叠加圆形进度环
  4. 成功: 平滑替换预览
文件限制: JPG/PNG/WebP, ≤5MB, 建议 ≥256×256
失败: Toast error + 保持默认头像
```

**昵称输入**

```
placeholder: "输入昵称（2-20 字符）"
校验:
  长度 2-20
  不含特殊字符 (仅允许中英文数字下划线)
  不能全空格
字符计数: 右上角 Label Small "[?/20]"，接近上限时橙色
建议:     下方 "💡 提示: 可以是真名，也可以是艺名" Label Small
```

**密码强度条**

```
容器:       宽度 100%，高度 4px，radius full，margin-top 6px
背景:       outline-variant
评分算法（0-100）:
  长度 ≥ 8      +20
  含小写字母    +15
  含大写字母    +15
  含数字        +20
  含特殊字符    +20
  长度 ≥ 12     +10
分档:
  0-40   弱    红 (#BA1A1A), width 33%
  41-70  中等  橙 (#B45309), width 66%
  71-100 强    绿 (#2D7D46), width 100%
文字:       右侧显示 "弱 / 中等 / 强"，同色 Label Small
过渡:       宽度 300ms standard, 颜色 200ms standard

检查清单（新增，可视化）:
  ● 至少 8 位   ● 含字母   ● 含数字   ● 含特殊字符（选填）
  未满足: outline-variant 圆点；满足: green 圆点+CheckCircle2
```

**确认密码**

- 失焦时校验与密码一致，不一致提示 "两次输入的密码不一致"
- 一致时输入框右侧显示绿色 CheckCircle2 12px

**协议勾选**

```
必选 Checkbox + Body Small
"我已阅读并同意 [用户服务协议] 和 [隐私政策]"
链接: 打开新窗口 or Modal 内展示
未勾选: [完成注册] 按钮 disabled，Tooltip "请先同意协议"
```

**返回上一步**

```
Text 按钮 + ArrowLeft 图标
点击: 返回步骤 1，保留已填手机号
携带的表单数据: 不清除（用户仍可编辑）
```

### 3.5 注册成功状态

```
┌──────────────────────────────────────┐
│                                      │
│       ✨ CheckCircle2 (64px)          │  #22C55E, scale(0.5→1.1→1) bounce
│                                      │
│       欢迎加入元聊！                  │  Headline Medium, 600
│                                      │
│    你的元聊号                        │  Label Medium, on-surface-variant
│  ┌─────────────────────────────┐     │
│  │  Y 2 0 2 6 X X X X    [复制]  │     │  Title Large, tabular-nums, letter-spacing 2px
│  └─────────────────────────────┘     │
│                                      │
│    ┌──────────────────────────┐       │
│    │   开始使用元聊  →         │       │  Button Filled
│    └──────────────────────────┘       │
│                                      │
│    ⏱ 3 秒后自动进入…                 │  Label Medium
└──────────────────────────────────────┘

元聊号说明: "Y + 8 位数字，是你在元聊的唯一标识（无法更改）"
自动跳转: 3s 后跳 /chat；用户手动点按钮可提前
彩蛋: 首次进入 /chat 显示欢迎气泡引导（详见 §07 待创建的 Onboarding）
```

### 3.6 表单校验规则

| 字段     | 规则                          | 错误提示                            |
| -------- | ----------------------------- | ----------------------------------- |
| 手机号   | 11 位，1 开头，仅数字         | "请输入有效的 11 位手机号"          |
| 手机号   | 未被注册                      | "该号码已注册，[直接登录](#)"       |
| 验证码   | 6 位数字，5 分钟内有效        | "验证码错误或已过期"                |
| 昵称     | 2-20 字符，仅中英文数字下划线 | "昵称需 2-20 个字符"                |
| 密码     | ≥8 位，含字母+数字            | "密码至少 8 位，且需包含字母和数字" |
| 确认密码 | 与密码一致                    | "两次输入的密码不一致"              |
| 协议     | 必须勾选                      | "请先同意用户协议和隐私政策"        |

### 3.7 微交互清单

| 场景         | 交互                                                           |
| ------------ | -------------------------------------------------------------- |
| 步骤切换     | 表单卡片向左 slide out + 新卡片从右 slide in，300ms emphasized |
| 头像上传中   | 圆形进度环从 0→100% 描边动画                                   |
| 头像替换     | 旧头像 fade out + 新头像 scale(0.9→1) fade in，300ms           |
| 密码强度变化 | 宽度 300ms + 颜色 200ms 平滑过渡                               |
| 密码检查项   | 满足瞬间圆点从灰→绿，CheckCircle 弹入 200ms bounce             |
| 成功页       | CheckCircle 缩放弹出 500ms bounce，元聊号打字机效果显示        |
| 元聊号复制   | 复制成功后图标从 Copy → Check 300ms，Toast "已复制"            |

---

## 四、忘记密码页（ForgotPasswordPage） `/forgot-password`

### 4.1 流程概览

```
[步骤 1: 填写账号] ─► [步骤 2: 验证身份] ─► [步骤 3: 设置新密码] ─► [重置成功]
    手机 or 邮箱          6 位 OTP                新密码 + 确认        3s 后跳登录
```

### 4.2 步骤 1 — 填写账号

```
┌──────────────────────────────────────┐
│                                      │
│         找回密码                      │  Headline Large
│   通过手机号或邮箱验证身份             │  Body Medium, on-surface-variant
│                                      │
├──────────────────────────────────────┤
│                                      │
│   [方式 Tab: 手机号 / 邮箱]           │
│                                      │
│   ┌──────────────────────────────┐   │
│   │  +86 🇨🇳  │  手机号            │   │
│   └──────────────────────────────┘   │
│    or                                │
│   ┌──────────────────────────────┐   │
│   │  邮箱地址                     │   │
│   └──────────────────────────────┘   │
│                                      │
│   ┌──────────────────────────────┐   │
│   │        下一步 →                │   │
│   └──────────────────────────────┘   │
│                                      │
│   想起密码了？[返回登录]               │
└──────────────────────────────────────┘
```

**账号 hint**：如果从登录页跳过来且账号已填，自动预填 + 焦点到 [下一步] 按钮。

### 4.3 步骤 2 — 验证身份

```
┌──────────────────────────────────────┐
│                                      │
│   ✉ 验证码已发送                      │  Icon + Title Large
│                                      │
│   验证码已发送至                       │
│   ┌──────────────────────────────┐   │
│   │  138****8888                  │   │  Body Medium, on-surface-variant
│   └──────────────────────────────┘   │  背景 surface-container，radius 8px
│                                      │
│   请输入 6 位验证码                    │
│                                      │
│   ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐    │  OTP 输入框
│   │  │ │  │ │  │ │  │ │  │ │  │    │
│   └──┘ └──┘ └──┘ └──┘ └──┘ └──┘    │
│                                      │
│   05:00 后可重新获取                  │  倒计时, Label Medium
│                                      │
│   [← 换个方式]                       │
└──────────────────────────────────────┘
```

#### OTP 输入框规格

```
容器:       flex gap 8px, justify-center
单个框:     48×56px，radius 12px
默认边框:   1px outline-variant
焦点边框:   2px primary + 3px focus ring
已填充:     2px on-surface-variant，字色 on-surface
错误态:     2px error + shake 300ms
字体:       Title Large (19.25px)，居中，tabular-nums

交互:
  自动跳焦: 输入 1 位后跳到下一个框
  退格: 当前框清空后跳回上一框
  粘贴: 粘贴 6 位数字自动分配到各框
  自动提交: 6 位填满后 200ms 后自动提交
  移动端: keyboard type = "number"

自动验证 UX:
  提交时 → 全部框 loading pulse (opacity 0.6→1 循环 300ms)
  成功 → 全部框变绿 + CheckCircle 覆盖 200ms 后进入下一步
  失败 → 全部框变红 + shake 300ms + 清空 + 聚焦第 1 位
```

### 4.4 步骤 3 — 设置新密码

（结构同注册步骤 2 的密码部分，包含密码强度条和检查清单）

**额外规则**：

- 新密码不能与近 3 次使用的密码相同（后端校验，前端不能提前检测）
- 输入框内嵌 "🔒 新密码不能与旧密码相同" 提示

### 4.5 重置成功状态

```
┌──────────────────────────────────────┐
│                                      │
│         ✨ CheckCircle2 64px          │  #22C55E
│       密码已重置                      │  Headline Medium
│   新密码设置成功，请使用新密码登录     │  Body Medium
│                                      │
│   🔒 安全提醒:                        │  Callout box
│   已强制退出所有其他设备               │
│                                      │
│   ┌──────────────────────────────┐   │
│   │     返回登录  →               │   │  Button Filled
│   └──────────────────────────────┘   │
│                                      │
│   3 秒后自动跳转登录页…               │
└──────────────────────────────────────┘
```

### 4.6 安全提示

重置成功后：

- 所有其他设备的会话强制退出（token 失效）
- 系统消息推送到用户的所有历史设备："你的密码已在 2026-07-06 14:20 被修改"
- 若开启邮箱绑定，同步发送邮件通知
- 若开启二次验证，重置流程强制走二次验证

---

## 五、扫码登录页（QRLoginPage）— 桌面/Web 专属

**路由**：`/login/qr`
**触发**：桌面登录 Tab "扫码登录" 或 URL 直达

**移动端不显示**：手机端无扫码登录入口，仅提供 "使用其他手机扫码" 时的辅助（相机扫码工具）。

（详见 §2.2 扫码 Tab，此处不重复）

**手机端扫码相机 UI**（当在通讯录/其他入口触发扫码时）：

```
全屏黑色背景
中间: 相机预览区，4 角有品牌色扫描框角标（40×40px L 型）
扫描线: 从上到下循环的 primary/60% 3px 横线
底部: [从相册选取] + [× 关闭]
顶部: "扫描登录二维码"
识别: 300ms 内自动识别，成功后短震动 + 跳转确认页
```

---

## 六、生物识别登录（Passkey / WebAuthn）— 新增

### 6.1 触发条件

- 设备支持 WebAuthn API
- 用户已在该设备注册 Passkey（首次登录成功后引导注册）
- 登录页 [生物识别] 按钮显示

### 6.2 首次注册 Passkey（登录后引导）

```
Bottom Sheet / Modal:
  标题: "启用生物识别登录"
  副: "下次登录无需输入密码"
  图示: Fingerprint / Face 大图标 48px
  说明: "此功能仅在当前设备可用，数据不上传服务器"
  按钮: [启用] Filled / [稍后] Text
```

### 6.3 使用 Passkey 登录

```
点击 [生物识别] 按钮 →
  系统 WebAuthn UI 弹出（指纹/面部识别）→
  成功 → 直接进入 /chat
  失败 → Toast "识别失败，请使用密码登录"
  超时 → 恢复登录页
```

---

## 七、二次验证（Two-Factor Auth, 2FA）— 新增

### 7.1 触发场景

- 用户账号开启 2FA
- 陌生环境登录（新 IP / 新设备）
- 敏感操作（改密码、绑定手机、注销账号）

### 7.2 UI 布局

```
密码登录成功后跳转此页（不跳 /chat）:

┌──────────────────────────────────────┐
│                                      │
│   🛡 安全验证                         │  Shield 图标 48px + Headline Medium
│   为保护账号安全，请完成二次验证        │  Body Medium
│                                      │
│   方式 (Radio 或 Tab):                │
│   ● 手机短信                          │
│   ○ 邮箱验证码                        │
│   ○ 认证器 App (TOTP)                │
│   ○ 备用码                            │
│                                      │
│   [6 位 OTP 输入]                     │
│                                      │
│   ┌──────────────────────────────┐   │
│   │        验 证                   │   │
│   └──────────────────────────────┘   │
│                                      │
│   ☐ 30 天内不再询问此设备             │
│                                      │
│   [使用备用码登录 →]                  │
└──────────────────────────────────────┘
```

**TOTP** 使用同一 OTP 组件，但无倒计时（30s 循环，不显示"重新发送"）

**备用码**：10 位一次性代码（在 Settings 中生成），输入后即失效

---

## 八、认证页公共布局规格

```
外层容器:
  min-height: var(--app-height, 100vh)
  display: flex, flex-direction: column
  overflow-y: auto
  padding: 32px 0

背景层（z-base）:
  position: relative
  背景渐变: surface-gradient
  Aurora 光球: pointer-events: none, absolute
  网格: pointer-events: none, absolute
  流光: pointer-events: none, absolute

内容卡片（z-base + 1）:
  position: relative
  width: 100%, max-width: 400px (桌面) / 480px (平板) / 100% (移动)
  margin: auto
  padding: 32px (桌面) / 24px (移动)

Logo 区:
  margin-bottom: 40px
  text-align: center

表单区:
  space-y: 16px (表单项间距)

底部引导:
  margin-top: 24px
  text-align: center

暗色模式:
  Aurora 光球 opacity 25%（不干扰暗色氛围）
  卡片背景可选 surface-container-low 提升对比
```

---

## 九、页面跳转关系

```
/login
  ├── [立即注册] ─────────────► /register
  ├── [忘记密码?] ────────────► /forgot-password (账号预填)
  ├── [生物识别] ─────────────► /chat (WebAuthn 成功后)
  ├── [SSO 登录] ─────────────► SSO Provider → callback
  ├── [登录成功] ─────────────► /chat (replace history)
  └── [需二次验证] ────────────► /login/2fa

/register
  ├── [步骤 1 完成] ──────────► /register (step2 同页切换)
  ├── [已存在账号] ────────────► /login (预填手机号)
  ├── [注册成功] ─────────────► /chat
  └── [已有账号] ─────────────► /login

/forgot-password
  ├── [步骤 1 完成] ──────────► /forgot-password/verify
  ├── [步骤 2 完成] ──────────► /forgot-password/reset
  ├── [重置成功] ─────────────► /login (3s 或点击)
  └── [返回登录] ─────────────► /login

已登录用户访问 /login, /register, /forgot-password:
  → 自动重定向到 /chat
```

---

## 十、状态矩阵总览（State Matrix）

| 页面            | Idle   | Loading     | Success          | Error         | Offline | Rate-Limited             |
| --------------- | ------ | ----------- | ---------------- | ------------- | ------- | ------------------------ |
| Login           | 表单   | Btn Spinner | Btn Green + 跳转 | Toast + shake | Top Bar | Btn Disabled + Countdown |
| Register-Step1  | 表单   | Btn Spinner | 进入 Step2       | 就地错误      | Top Bar | 验证码倒计时             |
| Register-Step2  | 表单   | Btn Spinner | 成功页           | 就地错误      | Top Bar | —                        |
| ForgotPwd-Step1 | 表单   | Btn Spinner | 进入 Step2       | 就地错误      | Top Bar | —                        |
| ForgotPwd-Step2 | OTP    | OTP pulse   | 进入 Step3       | OTP shake     | Top Bar | 倒计时                   |
| ForgotPwd-Step3 | 表单   | Btn Spinner | 成功页           | 就地错误      | Top Bar | —                        |
| QR Login        | 二维码 | Spinner     | 大绿勾+跳转      | 过期蒙版      | Top Bar | —                        |

---

## 十一、OpenDesign 页面帧清单

```
Auth/Login-Password           — 账号密码 Tab（默认）
Auth/Login-Password-Focused   — 输入框聚焦态
Auth/Login-Password-Error     — 错误提示态
Auth/Login-Password-Loading   — 主按钮加载中
Auth/Login-Password-Offline   — 顶部离线提示
Auth/Login-Phone              — 手机验证码 Tab
Auth/Login-Phone-Countdown    — 验证码发送后倒计时
Auth/Login-QR                 — 扫码 Tab（等待）
Auth/Login-QR-Scanned         — 已扫描待确认
Auth/Login-QR-Confirmed       — 成功登录
Auth/Login-QR-Expired         — 二维码过期
Auth/Login-Biometric-Prompt   — Passkey 系统 UI 触发
Auth/Login-2FA                — 二次验证页

Auth/Register-Step1           — 手机验证
Auth/Register-Step2           — 完善资料
Auth/Register-Step2-Uploading — 头像上传中
Auth/Register-Success         — 注册成功

Auth/ForgotPwd-Step1          — 填写账号
Auth/ForgotPwd-Step2          — OTP 验证
Auth/ForgotPwd-Step3          — 设置新密码
Auth/ForgotPwd-Success        — 重置成功

Auth/Mobile-*                 — 移动端全部页面
Auth/Tablet-*                 — 平板端全部页面
Auth/Dark-*                   — 暗色模式抽样帧
```

---

## 十二、变更日志

| 版本 | 日期       | 变更                                                                                            |
| ---- | ---------- | ----------------------------------------------------------------------------------------------- |
| v1.0 | 2026-06-29 | 初版                                                                                            |
| v1.1 | 2026-07-06 | 新增：设计目标 / 差异化 / 微交互清单 / 状态矩阵 / 生物识别 / 2FA / 安全交互 / OpenDesign 帧清单 |
