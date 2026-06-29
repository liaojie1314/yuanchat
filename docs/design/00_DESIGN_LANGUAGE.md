# 元聊 YuanChat — 设计语言规范

> 本文档定义元聊的完整视觉语言，是所有界面设计的唯一真实来源。
> 所有设计稿、组件实现、平台适配均须遵循此规范。

---

## 一、品牌标识

| 项目      | 规格                                                  |
| --------- | ----------------------------------------------------- |
| 产品名    | 元聊 / YuanChat                                       |
| 标语      | 企业级即时通讯                                        |
| Logo 图标 | MessageCircle（Lucide Icons）                         |
| Logo 形态 | 图标置于圆角方形（28px 圆角）品牌渐变背景内，白色图标 |
| Logo 尺寸 | 标准 80×80px，小号 40×40px                            |

### 品牌渐变（Brand Gradient）

```
主渐变（135° 对角）:
  #5B9BD5  →  #7EC8E3  →  #A8CFFF
  0%           50%          100%

导航侧边栏渐变（180° 纵向）:
  #5B9BD5  →  #4A8BC5
  0%           100%

认证页背景光晕:
  Aurora Orb 1:  #7EC8E3  (左上，500×500px，blur 80px，opacity 40%)
  Aurora Orb 2:  #A8CFFF  (右中，400×400px，blur 80px，opacity 40%)
  Aurora Orb 3:  #B8D8F0  (左下，350×350px，blur 80px，opacity 40%)
```

---

## 二、颜色系统

基于 Material Design 3 动态颜色方案，通过 CSS 变量 `--md-sys-color-*-rgb` 实现运行时主题切换。

### 2.1 亮色主题（Light Theme）

| Token                  | CSS 变量                                | Hex 值    | 用途说明                   |
| ---------------------- | --------------------------------------- | --------- | -------------------------- |
| Primary                | `--md-sys-color-primary`                | `#5B9BD5` | 主按钮、活跃态、链接、进度 |
| On Primary             | `--md-sys-color-on-primary`             | `#FFFFFF` | 主色上的文字/图标          |
| Primary Container      | `--md-sys-color-primary-container`      | `#D6EAFF` | 主色浅容器背景             |
| On Primary Container   | `--md-sys-color-on-primary-container`   | `#001D33` | 容器内文字                 |
| Secondary              | `--md-sys-color-secondary`              | `#5A6D82` | 次要按钮、辅助图标         |
| On Secondary           | `--md-sys-color-on-secondary`           | `#FFFFFF` | 次色上文字                 |
| Secondary Container    | `--md-sys-color-secondary-container`    | `#DEE8F5` | 次色浅容器                 |
| Tertiary               | `--md-sys-color-tertiary`               | `#5B8A8A` | 第三色，强调元素           |
| Error                  | `--md-sys-color-error`                  | `#BA1A1A` | 错误、危险操作             |
| Error Container        | `--md-sys-color-error-container`        | `#FFDAD6` | 错误提示背景               |
| Background             | `--md-sys-color-background`             | `#F0F7FF` | 全局页面背景               |
| Surface                | `--md-sys-color-surface`                | `#F0F7FF` | 卡片、面板背景             |
| On Surface             | `--md-sys-color-on-surface`             | `#171C24` | 主要正文文字               |
| Surface Variant        | `--md-sys-color-surface-variant`        | `#DEE7F2` | 输入框、次要表面           |
| On Surface Variant     | `--md-sys-color-on-surface-variant`     | `#424853` | 次要文字、图标             |
| Outline                | `--md-sys-color-outline`                | `#727883` | 可见边框                   |
| Outline Variant        | `--md-sys-color-outline-variant`        | `#C2C8D3` | 分隔线、轻边框             |
| Surface Container Low  | `--md-sys-color-surface-container-low`  | `#EBF2FC` | 输入框背景                 |
| Surface Container      | `--md-sys-color-surface-container`      | `#E5ECF6` | 卡片内层背景               |
| Surface Container High | `--md-sys-color-surface-container-high` | `#DFE6F0` | 悬浮态背景                 |
| Inverse Surface        | `--md-sys-color-inverse-surface`        | `#2C3138` | Toast 背景                 |
| Inverse On Surface     | `--md-sys-color-inverse-on-surface`     | `#EFF3F9` | Toast 文字                 |

### 2.2 暗色主题（Dark Theme）

| Token                  | Hex 值    |
| ---------------------- | --------- |
| Primary                | `#A8CFFF` |
| On Primary             | `#003354` |
| Primary Container      | `#1B4B6F` |
| Background             | `#0E141B` |
| Surface                | `#0E141B` |
| On Surface             | `#DEE5EE` |
| Surface Container Low  | `#161C24` |
| Surface Container      | `#1A2028` |
| Surface Container High | `#252B33` |
| On Surface Variant     | `#C2C8D3` |
| Outline Variant        | `#424853` |

### 2.3 语义颜色

| 用途           | 亮色 Hex  | 暗色 Hex  | 用途说明           |
| -------------- | --------- | --------- | ------------------ |
| 成功 Success   | `#2D7D46` | `#6DD08E` | 操作成功、在线状态 |
| 警告 Warning   | `#B45309` | `#FCD34D` | 警告提示           |
| 信息 Info      | `#5B9BD5` | `#A8CFFF` | 信息提示           |
| 在线 Online    | `#22C55E` | `#4ADE80` | 用户在线状态绿点   |
| 离线 Offline   | `#9CA3AF` | `#6B7280` | 用户离线状态       |
| 未读角标 Badge | `#E53935` | `#EF5350` | 未读消息计数       |

### 2.4 内置主题/皮肤

| 皮肤 ID        | 名称           | 主色      | 模式 |
| -------------- | -------------- | --------- | ---- |
| `yuan-light`   | 元聊蓝（默认） | `#5B9BD5` | 亮色 |
| `yuan-dark`    | 元聊暗         | `#A8CFFF` | 暗色 |
| `ocean-light`  | 海洋蓝         | `#00658A` | 亮色 |
| `ocean-dark`   | 海洋暗         | `#8BCEF1` | 暗色 |
| `forest-light` | 森林绿         | `#386A20` | 亮色 |
| `forest-dark`  | 森林暗         | `#9DD67B` | 暗色 |

---

## 三、字体排版

基础字号：**14px**（`html { font-size: 14px }`）
字体族：`-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif`

### 3.1 M3 字体层级

| 等级            | Tailwind 类        | rem      | px (≈)  | 字重 | 行高 | 用途                   |
| --------------- | ------------------ | -------- | ------- | ---- | ---- | ---------------------- |
| Headline Large  | `text-headline-lg` | 2rem     | 28px    | 600  | 1.25 | 认证页标题、弹窗主标题 |
| Headline Medium | `text-headline-md` | 1.75rem  | 24.5px  | 600  | 1.25 | 区块主标题             |
| Headline Small  | `text-headline-sm` | 1.5rem   | 21px    | 600  | 1.3  | 次级标题               |
| Title Large     | `text-title-lg`    | 1.375rem | 19.25px | 500  | 1.3  | 会话名称、面板标题     |
| Title Medium    | `text-title-md`    | 1rem     | 14px    | 600  | 1.4  | 列表项标题、导航标签   |
| Title Small     | `text-title-sm`    | 0.875rem | 12.25px | 500  | 1.4  | 小标题                 |
| Body Large      | `text-body-lg`     | 1rem     | 14px    | 400  | 1.5  | 正文、输入框文字       |
| Body Medium     | `text-body-md`     | 0.875rem | 12.25px | 400  | 1.5  | 消息预览、辅助文字     |
| Body Small      | `text-body-sm`     | 0.75rem  | 10.5px  | 400  | 1.5  | 错误提示、注释         |
| Label Large     | `text-label-lg`    | 0.875rem | 12.25px | 500  | 1.4  | 按钮文字、标签         |
| Label Medium    | `text-label-md`    | 0.75rem  | 10.5px  | 500  | 1.4  | 时间戳、辅助标签       |
| Label Small     | `text-label-sm`    | 0.688rem | 9.6px   | 500  | 1.3  | 角标数字、最小注释     |

### 3.2 特殊字体规则

- 数字时间：等宽字体 `font-variant-numeric: tabular-nums`（防时间跳动）
- 代码片段：`"JetBrains Mono", "Fira Code", monospace`
- Emoji 字符：不限字体，保留系统 Emoji 渲染

---

## 四、间距系统

基于 **4pt 网格**（Tailwind 默认 `spacing: 1 = 4px`）

| Token       | px   | 用途                         |
| ----------- | ---- | ---------------------------- |
| `space-0.5` | 2px  | 微小间隙                     |
| `space-1`   | 4px  | 图标与文字间距、角标偏移     |
| `space-2`   | 8px  | 行内小间距                   |
| `space-3`   | 12px | 组件内部间距                 |
| `space-4`   | 16px | 标准内边距（卡片、列表项）   |
| `space-5`   | 20px | 中等内边距                   |
| `space-6`   | 24px | 大区块内边距                 |
| `space-8`   | 32px | 区块间距                     |
| `space-10`  | 40px | 大区块间距                   |
| `space-12`  | 48px | 超大间距（认证页 Logo 下方） |

---

## 五、圆角系统

| 名称 | px     | Tailwind         | 用途                    |
| ---- | ------ | ---------------- | ----------------------- |
| none | 0      | `rounded-none`   | 分隔线、全出血区        |
| xs   | 4px    | `rounded-[4px]`  | 角标、进度条端点        |
| sm   | 8px    | `rounded-lg`     | 小按钮、Chip            |
| md   | 12px   | `rounded-xl`     | 输入框、卡片            |
| lg   | 16px   | `rounded-2xl`    | 导航激活态、气泡、Modal |
| xl   | 28px   | `rounded-[28px]` | Logo 背景、FAB          |
| full | 9999px | `rounded-full`   | 头像、圆形按钮、徽章    |

---

## 六、阴影系统

| 等级        | 变量               | 阴影值                                                   | 用途              |
| ----------- | ------------------ | -------------------------------------------------------- | ----------------- |
| Elevation 0 | —                  | `none`                                                   | 平面元素、背景    |
| Elevation 1 | `--md-elevation-1` | `0 1px 2px rgba(0,0,0,0.3), 0 1px 3px rgba(0,0,0,0.15)`  | 卡片、列表项悬浮  |
| Elevation 2 | `--md-elevation-2` | `0 1px 2px rgba(0,0,0,0.3), 0 2px 6px rgba(0,0,0,0.15)`  | 导航栏、FAB       |
| Elevation 3 | `--md-elevation-3` | `0 4px 8px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.3)`  | 弹出菜单、Tooltip |
| Elevation 4 | `--md-elevation-4` | `0 6px 10px rgba(0,0,0,0.15), 0 2px 3px rgba(0,0,0,0.3)` | 模态框            |
| Elevation 5 | `--md-elevation-5` | `0 8px 12px rgba(0,0,0,0.15), 0 4px 4px rgba(0,0,0,0.3)` | 全屏对话框        |

Logo/品牌发光效果：`box-shadow: 0 0 30px rgba(#5B9BD5, 25%), 0 0 60px rgba(#5B9BD5, 8%)`

---

## 七、图标系统

图标库：**Lucide Icons**（`lucide-react`，MIT 协议）
默认笔画粗细：激活态 `strokeWidth=2.5`，默认 `strokeWidth=1.5`

| 尺寸规格 | px   | 使用场景                |
| -------- | ---- | ----------------------- |
| 标准     | 24px | 导航、主要操作按钮      |
| 小号     | 20px | 主题切换、登出          |
| 紧凑     | 18px | 工具栏、输入框内嵌图标  |
| 内联     | 16px | 状态点前置、Chip 内图标 |

### 7.1 核心图标清单

| 功能          | 图标名                   |
| ------------- | ------------------------ |
| 消息/聊天     | `MessageCircle`          |
| 通讯录        | `Users`                  |
| 设置          | `Settings`               |
| 搜索          | `Search`                 |
| 新增/创建     | `Plus`                   |
| 发送          | `Send`                   |
| 图片          | `Image`                  |
| 文件/附件     | `Paperclip`              |
| 表情          | `Smile`                  |
| 语音输入      | `Mic`                    |
| 视频通话      | `Video`                  |
| 语音通话      | `Phone`                  |
| 更多选项      | `MoreHorizontal`         |
| 通知开        | `Bell`                   |
| 通知关        | `BellOff`                |
| 登出          | `LogOut`                 |
| 返回          | `ArrowLeft`              |
| 关闭/取消     | `X`                      |
| 编辑          | `Pencil`                 |
| 删除          | `Trash2`                 |
| 复制          | `Copy`                   |
| 二维码        | `QrCode`                 |
| 相机/头像     | `Camera`                 |
| 确认          | `Check` / `CheckCircle2` |
| 警告/错误     | `AlertCircle`            |
| 眼睛/密码显示 | `Eye` / `EyeOff`         |
| 亮色模式      | `Sun`                    |
| 暗色模式      | `Moon`                   |
| 回复          | `Reply`                  |
| 转发          | `Forward`                |
| 收藏          | `Bookmark`               |
| 已读双勾      | `CheckCheck`             |
| 用户添加      | `UserPlus`               |
| 用户卡片      | `Contact`                |
| 刷新          | `RefreshCw`              |
| 链接          | `Link`                   |
| 下载          | `Download`               |
| 上传          | `Upload`                 |
| 皮肤/外观     | `Palette`                |
| 设备          | `Monitor` / `Smartphone` |
| 帮助          | `HelpCircle`             |
| 关于/信息     | `Info`                   |
| 语言          | `Globe`                  |
| 字体大小      | `Type`                   |
| 隐私          | `Shield`                 |
| 退出/离开     | `DoorOpen`               |

---

## 八、核心组件规范

### 8.1 Button（按钮）

四种变体，统一高度 **48px**，圆角 **12px（md）**，字体 Label Large（500/0.875rem）。

#### Filled（填充主按钮）

```
背景:   brand-gradient (135°: #5B9BD5 → #7EC8E3 → #A8CFFF)
文字:   #FFFFFF, 字重 600
内边距: 水平 24px
悬浮:   opacity 90%，cursor: pointer
激活:   opacity 80%, scale(0.98)
禁用:   opacity 50%, cursor: not-allowed
加载:   左侧 16px Spinner（圆形动画），文字替换为 "处理中…"
聚焦:   box-shadow: 0 0 0 3px rgba(#5B9BD5, 30%)
```

#### Outlined（轮廓次要按钮）

```
背景:     transparent
边框:     1.5px solid primary
文字:     primary
悬浮:     背景 rgba(primary, 8%)
禁用:     边框/文字 opacity 50%
```

#### Text（文本按钮）

```
背景:   transparent
无边框
文字:   primary
悬浮:   背景 rgba(primary, 8%)
```

#### Icon（图标按钮）

```
尺寸:   40×40px (min-touch-target: 44×44px)
圆角:   full
悬浮:   背景 rgba(on-surface-variant, 8%)
激活:   背景 rgba(on-surface-variant, 12%)
```

---

### 8.2 Input（输入框）

```
高度:       48px
圆角:       12px
内边距:     水平 16px，垂直 12px
背景:       surface-container-low (#EBF2FC / #161C24)
边框:       1px solid outline-variant
字体:       Body Large (1rem/14px)
占位文字:   on-surface-variant 色，不加粗

— 聚焦态 —
边框:       2px solid primary
背景:       surface-container-lowest
发光:       box-shadow: 0 0 0 3px rgba(#5B9BD5, 15%)

— 错误态 —
边框:       2px solid error (#BA1A1A)
错误文字:   Body Small，error 色，位于输入框下方 4px

— 禁用态 —
opacity: 50%, cursor: not-allowed

— 密码框额外规格 —
右侧内嵌图标按钮: 32×32px，Eye/EyeOff，on-surface-variant 色

— 搜索框变体 —
左侧内嵌 Search 图标: 16px，on-surface-variant 色
左内边距调整为: 40px
```

---

### 8.3 Avatar（头像）

| 尺寸名 | px   | 使用场景               |
| ------ | ---- | ---------------------- |
| `xs`   | 24px | 消息引用预览           |
| `sm`   | 32px | 紧凑列表               |
| `md`   | 40px | 会话列表、消息气泡旁   |
| `lg`   | 56px | 聊天窗口顶栏           |
| `xl`   | 80px | 登录 Logo 区（非人像） |
| `2xl`  | 96px | 个人资料页大头像       |

```
形状:     圆形 (border-radius: full)
无头像:   基于用户 ID 哈希的品牌渐变背景 + 昵称首字（白色，字重 700）
在线状态: 右下角 10×10px 圆形绿点（#22C55E），白色 2px 边框
离线:     状态点隐藏或灰色 (#9CA3AF)
勿扰:     状态点为橙色 (#F59E0B) + DND 图标
群组头像: 可显示最多 4 个成员头像的 2×2 拼接网格
```

---

### 8.4 消息气泡（Message Bubble）

#### 发送方气泡（自己）

```
背景:     brand-gradient (135°: #5B9BD5 → #7EC8E3)
文字:     #FFFFFF
圆角:     16px，右下角改为 4px（尾角）
最大宽度: 70%
位置:     靠右，margin-left: auto
发光:     box-shadow: 0 2px 12px rgba(#5B9BD5, 30%)
暗色模式: gradient 加深 (#3D7AB8 → #5B9BD5)
```

#### 接收方气泡（他人）

```
背景:     #FFFFFF（暗色: #1E293B）
文字:     #171C24（暗色: #DEE5EE）
边框:     1px solid #E5E7EB（暗色: #334155）
圆角:     16px，左下角改为 4px（尾角）
最大宽度: 70%
阴影:     box-shadow: 0 1px 3px rgba(0,0,0,6%)
```

#### 气泡内容类型支持

```
文本:   换行，支持链接高亮（primary 色，下划线悬浮）
图片:   圆角 8px，最大宽 240px，点击全屏预览
文件:   文件图标 + 文件名 + 文件大小，下载按钮
语音:   波形图 + 时长 + 播放按钮，播放进度动画
视频:   缩略图 + 播放按钮图标覆盖层
引用回复: 气泡内顶部浅色引用区，左侧 3px primary 色条
代码块: monospace，surface-container-high 背景
```

---

### 8.5 徽章/角标（Badge）

```
未读消息数:
  形状:     1-2 位数字时圆形 18×18px；≥3 位时胶囊形（高 18px，宽自适应+8px 内边距）
  背景:     #E53935
  文字:     #FFFFFF，Label Small，字重 700
  超限:     >99 显示 "99+"
  位置:     右上角偏移 (-4px, -4px)

状态点（无数字）:
  直径:  8px（带边框时算外径）
  颜色:  error、online-green 等语义色
  边框:  2px solid surface（防与背景粘连）
```

---

### 8.6 对话框/Modal（Dialog）

```
遮罩:       rgba(0, 0, 0, 0.5)，全屏铺满，blur 可选
容器:       surface-container-high 背景，圆角 16px，elevation-4 阴影
最大宽度:   480px（桌面）/ 92vw（移动）
内边距:     24px
标题:       Title Large，600 字重
内容:       Body Large，on-surface-variant 色
按钮区:     右对齐，间距 8px，次要按钮在左
进入动画:   scale(0.9)→scale(1) + opacity(0)→(1)，200ms decelerate
退出动画:   scale(1)→scale(0.95) + opacity(1)→(0)，150ms accelerate
```

---

### 8.7 底部抽屉（Bottom Sheet）—— 仅移动端

```
激活区域:   全屏高度，顶部显示手柄
手柄:       32×4px，圆角，surface-container-high，居中，上方 8px
容器:       surface-container-low 背景，顶部圆角 16px，elevation-2 阴影
进入动画:   translateY(100%)→(0)，300ms decelerate
退出动画:   translateY(0)→(100%)，250ms accelerate
遮罩:       rgba(0,0,0,0.4)
可拖动关闭: 向下拖超过 120px 触发关闭
```

---

### 8.8 Toast（轻提示）

```
位置:       桌面左下角 24px，移动端底部居中，距底 24px（键盘上方）
背景:       inverse-surface (#2C3138 / #DEE5EE)
文字:       inverse-on-surface (#EFF3F9 / #2C3138)，Body Medium
圆角:       12px
内边距:     12px 16px
最小宽度:   280px
最大宽度:   400px
成功图标:   CheckCircle2 绿色 16px，左侧
错误图标:   AlertCircle 红色 16px，左侧
进入动画:   opacity(0)→(1) + translateY(8px)→(0)，250ms decelerate
自动消失:   成功/信息 3s，警告 4s，错误 5s
```

---

## 九、背景装饰效果

认证页（登录/注册/找回密码）专用装饰层：

```
层级从下到上:
  Layer 1 — 页面背景渐变: linear-gradient(180deg, #F0F7FF 0%, #E8F4FD 40%, #E0F0FA 100%)
  Layer 2 — Aurora 光球 (3个): position:absolute, blur 80px, opacity 40%, 缓慢漂移动画
  Layer 3 — 微尘网格: radial-gradient 点阵，32×32px，primary/6% 透明度
  Layer 4 — 流光扫描: 宽120%的光带，从 top:-100% 到 top:150%，10s 循环
  Layer 5 — 鼠标跟随光晕: position:fixed, 400×400px, radial-gradient, primary/8%, JS 跟随

光球动画参数:
  Ball 1: 左上角 (-80px, -80px), 500×500px, 天蓝 #7EC8E3
    animation: auroraFloat 12s ease-in-out infinite
  Ball 2: 右侧中部 (-128px right, 50% top), 400×400px, 淡蓝 #A8CFFF
    animation: auroraFloat 15s ease-in-out infinite, delay -4s
  Ball 3: 左下 (33% left, -80px bottom), 350×350px, 冰蓝 #B8D8F0
    animation: auroraFloat 18s ease-in-out infinite, delay -8s
```

---

## 十、动效规范

| 场景              | 时长  | 缓动曲线              | 说明                            |
| ----------------- | ----- | --------------------- | ------------------------------- |
| 色彩变化          | 150ms | standard              | 按钮/链接悬浮色变               |
| 图标状态切换      | 200ms | standard              | 主题切换、通知开关              |
| 面板展开/收起     | 300ms | decelerate/accelerate | 会话列表、设置项                |
| Modal 进入        | 250ms | decelerate            | 对话框出现                      |
| Modal 退出        | 200ms | accelerate            | 对话框消失                      |
| Bottom Sheet 进入 | 350ms | decelerate            | 移动端底部弹出                  |
| 页面路由切换      | 300ms | emphasized            | 左右滑动                        |
| 消息气泡入场      | 200ms | decelerate            | 新消息出现，translateY(4px)→(0) |
| Toast 进入        | 250ms | decelerate            | 提示条出现                      |

缓动曲线定义：

- `standard`: `cubic-bezier(0.2, 0, 0, 1.0)`
- `decelerate`: `cubic-bezier(0.05, 0.7, 0.1, 1.0)` — 进入动画
- `accelerate`: `cubic-bezier(0.3, 0.0, 0.8, 0.15)` — 退出动画
- `emphasized`: `cubic-bezier(0.2, 0, 0, 1.0)` — 显著变化

---

## 十一、可访问性基线

| 标准         | 要求                                                |
| ------------ | --------------------------------------------------- |
| 色彩对比度   | 正文 ≥ 4.5:1（AA），大标题 ≥ 3:1                    |
| 交互目标尺寸 | 最小 44×44px（移动端）                              |
| 键盘焦点     | 所有可交互元素可焦点，焦点环清晰可见                |
| 减少动效     | 遵循 `prefers-reduced-motion`，跳过装饰动画         |
| 屏幕阅读器   | 关键操作提供 `aria-label`，图标按钮必须有可访问名称 |
| 语言         | `lang="zh-CN"` 或 `lang="en"` 随 i18n 切换          |
