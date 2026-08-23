# 02 — 主界面设计规范（Main Interface）

> 涵盖：主布局 / 侧边导航 / 会话列表 / 聊天窗口 / 详情面板 / 命令面板 / AI 助手
> 依赖：`DESIGN_LANGUAGE.md`

---

## 一、整体布局架构

### 1.1 桌面端三栏布局（≥ 1024px）

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  [TitleBar 40px — 仅 Tauri，可拖拽，nav-gradient 背景]                       │
├──────┬──────────────────────┬────────────────────────────┬──────────────────┤
│      │                      │                            │                  │
│  左  │    会话列表面板         │    聊天窗口                  │  详情面板（可选）  │
│  侧  │    260-360px          │    flex:1, min 400px        │  240-280px       │
│  导  │                      │                            │                  │
│  航  │  [搜索 + 操作区]       │  [顶部标题栏 60px]          │  [详情内容]       │
│  栏  │  [过滤 Chips]         │  [置顶消息条]               │                  │
│  64  │  [会话列表滚动区]      │  [消息滚动区 flex:1]        │                  │
│  px  │                      │                            │                  │
│      │                      │  [底部输入区 88-200px]      │                  │
│      │                      │                            │                  │
└──────┴──────────────────────┴────────────────────────────┴──────────────────┘
```

宽度分配：`64px 固定 + 260-360px 可拖拽 + flex:1 + 0-280px 可切换`

### 1.2 平板端双栏布局（640px – 1023px）

```
┌──────┬──────────────────────────────────────────────────────────┐
│      │                                                          │
│  导  │    主区（会话列表 ↔ 聊天窗口 切换显示，同一区域）            │
│  航  │                                                          │
│  栏  │    768px+ → 并排双栏（列表 240px + 聊天 flex:1）          │
│  48  │    640-767px → 单列切换                                  │
│  px  │                                                          │
└──────┴──────────────────────────────────────────────────────────┘
```

### 1.3 移动端全屏布局（< 640px）

```
┌────────────────────────────────────────┐
│  [系统状态栏 — 颜色跟随主题]             │
├────────────────────────────────────────┤
│  [当前页面内容]                         │
│   /chat        → 会话列表全屏           │
│   /chat/:id    → 聊天窗口全屏           │
│   /contacts    → 通讯录全屏             │
│   /settings    → 设置全屏              │
├────────────────────────────────────────┤
│  [底部 TabBar]                          │
│  消息[●] · 通讯录 · 设置                │
│  高度: 56px + env(safe-area-inset-bottom) │
└────────────────────────────────────────┘
```

### 1.4 空状态（无选中会话，桌面端）

```
聊天窗口区域居中显示：
  MessageCircle 64px, on-surface-variant/50%
  "开始一段对话"  Body Large, on-surface-variant
  "选择左侧会话，或创建新会话"  Body Medium, on-surface-variant/70%
  [新建会话]  Button Outlined, 48px, margin-top 24px
```

---

## 二、侧边导航栏（LeftNav）

### 2.1 桌面端导航栏（64px 宽）

```
┌──────────┐
│          │
│ [Avatar] │  ← 当前用户，40px 圆形，在线状态点
│          │    点击：跳转 /profile/me
│          │    长按：切换在线状态（下拉菜单）
│          │
├──────────┤  1px rgba(white,0.15) 分隔线
│          │
│  💬  ●  │  ← 消息（激活态）+ 未读 Dot
│  消息   │    激活：白色 bg/25%, blur(4px), rounded-2xl
│          │
│  👥      │  ← 通讯录
│  通讯录  │
│          │
│  ⚙️      │  ← 设置
│  设置   │
│          │
├──────────┤  flex-1 占位
│          │
│  [⌘K]   │  ← 命令面板快捷键提示，Label Small，白色/60%
│          │    点击也可触发
│          │
│  ☀️/🌙  │  ← 主题切换，20px
│          │
│  ↩️      │  ← 登出，20px
│          │
└──────────┘

整体样式:
  背景:     linear-gradient(180deg, #5B9BD5 0%, #4A8BC5 100%)
  宽度:     64px，高度: 100%，overflow: hidden
  阴影:     elevation-2
  内边距:   顶部 12px，底部 16px

用户头像区:
  margin-bottom: 8px，padding-bottom: 12px
  border-bottom: 1px rgba(255,255,255,0.15)

  在线状态点击菜单（长按/右键）:
    ● 在线（Online）
    ● 离开（Away）
    ● 请勿打扰（Do Not Disturb）
    ● 隐身（Invisible）
    以 Popover / Bottom Sheet 展示，各项带颜色圆点

导航图标按钮:
  容器: 56×56px，flex column，items-center，gap 4px，radius 16px
  图标: 24px，strokeWidth 激活 2.5 / 默认 1.5
  标签: Label Small (0.688rem)

  默认：icon/text = rgba(255,255,255,0.7)，bg transparent
  激活：icon/text = #FFFFFF，bg rgba(255,255,255,0.25)，backdrop-blur 4px
  悬浮：bg rgba(255,255,255,0.15)，text #FFFFFF

底部辅助按钮（20px 图标，40×40px 触摸区）:
  主题切换：Sun/Moon 图标，Tooltip "切换主题 (T)"
  登出：LogOut 图标，Tooltip "退出登录"
  命令面板：终端图标 or 搜索图标，Tooltip "命令面板 (⌘K)"
```

### 2.2 移动端底部 TabBar（56px）

```
┌──────────────────────────────────────────────────┐
│  [💬 消息]    [👥 通讯录]    [⚙ 设置]           │
└──────────────────────────────────────────────────┘

样式:
  背景:     surface-container-low，顶部 1px outline-variant
  高度:     56px + safe-area-inset-bottom
  Tab 布局: flex，各占 1/3，flex-col，items-center，gap 4px

Tab 项:
  图标: 24px
  文字: Label Small (0.688rem)
  默认: on-surface-variant
  激活: primary，图标下方圆角 Pill 背景 (32×16px, primary-container)

  激活动画: Pill 从无→有 200ms standard
  未读角标: 红色计数，叠在图标右上角
  切换动画: icon strokeWidth 变化 200ms
```

### 2.3 平板端导航栏（48px 宽）

同桌面端，但宽度 48px，隐藏文字标签，仅显示图标。

---

## 三、会话列表面板（ConversationList）

### 3.1 面板头部

```
┌────────────────────────────────────────┐
│  消息                    [🔍]  [+]     │  高度 56px
├────────────────────────────────────────┤
│  ┌────────────────────────────────┐    │  搜索栏（收起时高度 0）
│  │  🔍 搜索会话、联系人、消息...  │    │  展开动画 300ms
│  └────────────────────────────────┘    │
├────────────────────────────────────────┤
│  [全部] [未读●] [群聊] [单聊] [@我]    │  过滤 Chips
└────────────────────────────────────────┘
```

**面板标题行规格**

```
高度: 56px
内边距: 水平 16px
"消息" Title Large, 600

[🔍] 搜索图标按钮:
  点击: 搜索框 展开/收起（高度 0→44px，300ms decelerate）
  展开后: 自动聚焦

[+] 新建按钮:
  点击: 打开新会话 Modal（搜索用户 / 创建群聊）
  长按: 直接弹出快捷操作 Bottom Sheet
        [发起单聊] [创建群聊] [加入频道]
```

**过滤 Chips**

```
容器: overflow-x auto（移动端可横滑），padding 8px 12px
Chip 高: 28px，radius full，gap 8px

[全部]:       默认选中，surface-container-high
[未读●]:     有未读时才显示红点
[群聊]:       仅显示群组会话
[单聊]:       仅显示 1v1
[@我]:        仅显示有未读 @提及的会话
[置顶]:       仅显示置顶（若存在）

切换动画: 选中 Chip background 200ms，列表 fade 100ms
```

### 3.2 会话列表项（ConversationItem）

```
┌─────────────────────────────────────────────────────────┐
│ [PinIcon 4px] [Avatar 40px]  [名称 + 时间]  [角标 / 铃铛] │
│                              [消息预览]                    │
└─────────────────────────────────────────────────────────┘

高度: 68px（标准密度）/ 56px（紧凑）/ 80px（舒适）
内边距: 垂直 12px，水平 16px
圆角: 12px（激活态高亮背景）
布局: flex，gap 12px，align-center
```

**头像区（宽 40px）**

- Avatar 40px（md），带在线状态点
- 群聊：2×2 拼接头像

**信息区（min-w-0，flex-1）**

```
第一行（flex，justify-between）:
  左: 会话名称 Body Large 600, on-surface, truncate
      未读态: 字重 700, on-surface
      备注名（已设置时）: 显示备注名，括号内原名，Body Small
  右: 时间 Label Medium, on-surface-variant, shrink-0
      格式: 同 §00 Content Voice §15.3

第二行（margin-top 2px）:
  左: 消息预览 Body Medium, on-surface-variant, truncate
      群聊前缀: "[张三]: 内容"
      图片:    "[图片]" + 小相机 emoji
      文件:    "[文件] 文件名"
      语音:    "[语音] 0'15\""
      视频通话: "[视频通话]"
      已撤回:  "消息已撤回"（italic，outline 色）
      AI 摘要: "🤖 3 条消息：项目进度讨论中…"（仅开启 AI 功能）
  右: 未读角标 / BellOff 图标（免打扰）

  @提及未读（新增）:
    显示"[@你]"橙色标签前缀，优先级高于普通预览
```

**交互状态**

```
激活态:    primary-container (#D6EAFF / #1B4B6F)
悬浮态:    surface-container-high
按下态:    scale(0.98) 50ms
置顶态:    左侧 4px primary 色竖条，bg rgba(primary,3%)
免打扰态:  BellOff 12px 图标（替代未读角标）
消息草稿:  预览行前缀 "[草稿]" error 色 Label Medium
```

**右键菜单 / 长按菜单（Context Menu）**

```
触发: 桌面右键 / 移动长按
容器: Popover 200px（桌面）/ Bottom Sheet（移动）

菜单项（每项 44px，图标 16px，Body Medium）:
  📌  置顶 / 取消置顶
  ✅  标记已读 / 标记未读
  🔕  开启 / 关闭免打扰
  📋  复制会话链接
  ─ 分隔线 ─
  🗑  清空聊天记录（二次确认）
  ✕   删除会话（二次确认）
```

### 3.3 会话搜索结果

**触发**：搜索框有内容（防抖 300ms）

```
分组展示（每组有 Label 标题 + 分隔线）:

─ 会话 (3) ─────────────────────────────
  [会话项，关键词黄色高亮]

─ 联系人 (2) ────────────────────────────
  [联系人项：头像 + 昵称 + 元聊号]

─ 消息记录 (5) ──────────────────────────
  [消息摘要：头像 + 会话名 + 消息片段 + 时间]
  消息片段内关键词高亮

无结果:
  Search 48px, on-surface-variant
  "未找到 '关键词'" Body Large
  "试试在通讯录中搜索" Body Medium
  [全网搜索此用户 →] Text 按钮
```

### 3.4 置顶区域

```
若有置顶会话，在普通列表上方显示：
  分组 Label: "置顶" Label Medium, on-surface-variant
  置顶项: 左侧 4px Pin 图标（视觉区分，非竖条）
  置顶数量限制: 最多 5 个（超出提示）
  桌面：置顶区与普通区 1px outline-variant 分隔线
```

### 3.5 空状态

| 场景       | 图标               | 主文字             | 副文字                     | CTA        |
| ---------- | ------------------ | ------------------ | -------------------------- | ---------- |
| 无任何会话 | MessageCircle 48px | 暂无会话           | 通过通讯录找到朋友开始聊天 | 前往通讯录 |
| 搜索无结果 | Search 48px        | 未找到结果         | 换个关键词试试             | —          |
| 过滤无结果 | Filter 48px        | 没有符合条件的会话 | —                          | 查看全部   |

---

## 四、聊天窗口（ChatWindow）

### 4.1 整体布局（flex column）

```
┌────────────────────────────────────────────────────────────────┐
│  [顶部标题栏 60px]                                              │
├────────────────────────────────────────────────────────────────┤
│  [置顶消息条 36px — 有时显示]                                   │
├────────────────────────────────────────────────────────────────┤
│  [消息列表区 flex:1, overflow-y auto]                           │
│  背景: surface (亮) / surface-container (暗)                   │
│  —— 背景可选：纯色 / 轻微纹理 / 用户自定义图片 ——              │
├────────────────────────────────────────────────────────────────┤
│  [引用/回复条 — 有回复时 36px]                                  │
├────────────────────────────────────────────────────────────────┤
│  [消息输入区 min 88px, max 200px]                               │
└────────────────────────────────────────────────────────────────┘
```

### 4.2 顶部标题栏（60px）

```
布局: flex, items-center, gap 12px, px-4
背景: surface-container-low（轻亮感）
border-bottom: 1px outline-variant

左侧:
  移动端：ArrowLeft 40×40px 返回按钮
  Avatar (lg 40px) + 在线状态点
  信息区:
    名称:   Title Large (1.375rem), 600, on-surface, max-w 200px truncate
    副标题: Label Small, on-surface-variant
      单聊: "在线" (green) / "离线 · 最近上线 2 小时前"
      群聊: "28 位成员 · 5 人在线"
      频道: "#公告频道"

右侧操作区（gap 4px）:
  仅桌面/平板:
    [📞 语音] Phone 20px（单聊）
    [📹 视频] Video 20px（单聊）
    [🔍 搜索] Search 20px
    [⋯ 详情] MoreHorizontal 20px（切换详情面板）
  移动端:
    [📞] [📹] [⋯]（缩减数量）

  Tooltip: 每个按钮有 Tooltip（移动端不显示）
  群聊语音通话（新增）: 多方通话图标，仅群聊显示
```

### 4.3 置顶消息条（Pinned Message Bar）

```
存在置顶消息时显示，紧贴标题栏下方：

背景: primary-container，高度 36px
布局: flex, items-center, gap 8px, px-4

Pin 图标: 14px, on-primary-container
"置顶：" Label Small, on-primary-container
内容: Body Small, on-primary-container, 1 行截断（最多 40 字符）
[× 取消置顶]: 右侧 IconButton 16px（仅群主/管理员可见）

点击置顶条: 消息列表滚动定位到该消息，并高亮闪烁 1s
多条置顶: 显示当前/总条数 "1/3" + 点击循环切换
```

### 4.4 消息列表区

#### 时间分隔符

```
触发: 相邻两条消息时间差 > 5 分钟
显示: 居中文字，两侧延伸细线

样式:
  文字: Label Medium, on-surface-variant
  线条: 1px outline-variant
  内边距: 上下 16px
  格式: 今天 · 14:30 / 昨天 / 周三 / 06-29 / 2026-06-29
```

#### 消息条目（MessageItem）

```
发送方 (isSelf=true):  flex-row-reverse，头像在右
接收方 (isSelf=false): flex-row，头像在左
布局: flex, gap 8px, align-end（底部对齐让头像贴消息底部）
margin-y: 2px（同发送人连续消息）/ 8px（不同发送人）
```

**头像区（40px）**

```
仅每段连续消息的第一条显示（avatar 区占位但透明）
连续判断: 同一发送人，相邻消息时间差 ≤ 3 分钟，中间无系统消息
hover 头像: Tooltip 显示昵称，点击进入个人资料
```

**气泡区（max-width 70%）**

```
群聊接收方：气泡上方显示发送人名称
  Label Medium, primary 色，点击跳个人资料

底部状态行（发送方专属）:
  布局: flex, items-end, gap 4px, justify-end
  时间: Label Small (9.6px), tabular-nums, on-surface-variant/70%
  状态图标 (12px):
    Loader2 spin:  发送中
    Check:         已送达
    CheckCheck primary色: 对方已读
  群聊: 读取人数 "已读 3/5"（桌面悬浮详情 Tooltip）
```

**消息工具栏（Hover/长按 显示）**

```
触发: 桌面 hover 气泡 500ms / 移动长按
位置: 气泡上方（空间不足时下方），根据气泡位置决定左右对齐
背景: surface-container-highest, radius full, elevation-3
高度: 40px，内边距: 水平 8px

布局（从左到右）:
  [最多 5 个常用 Reaction 表情]  16px Emoji
  [回复 Reply]        16px
  [转发 Forward]      16px
  [复制 Copy]         16px（文本消息）
  [更多 ···]          16px → 展开完整菜单

完整菜单（Bottom Sheet / Dropdown）:
  💬 回复        → 引用该消息到输入框
  ↩  转发        → 选择会话/联系人转发
  📋 复制        → 复制文本内容
  🔖 收藏        → 收藏到个人收藏夹
  📌 置顶消息    → （群主/管理员可见）
  🔗 复制链接    → yuanchat://msg/{id}
  ✏️  编辑       → （仅自己的消息，48h 内）
  🗑  撤回       → （仅自己，2min 内，群主不限时）
  ⚠️  举报       → （他人消息）
  ─ 分隔线 ─
  删除消息      error 色（仅对自己删除，不通知对方）

手势触发（移动端）:
  左滑气泡: 快速回复（无需长按）
  右滑气泡（自己）: 撤回（确认 Dialog）
```

#### Emoji Reactions（消息表情反应）—— 超越竞品的关键

```
气泡下方 Reaction 区（有反应时显示）:
  每个 Reaction: [Emoji 16px] + [数量 Label Small]
  胶囊形：高 24px, padding 6px 10px, radius full
  背景:
    包含自己的反应: primary-container
    不包含自己: surface-container-high
  border: 1px outline-variant
  gap: 4px

交互:
  点击已有 Reaction → 切换自己的反应（再点取消）
  点击 [+] → 打开 Emoji Picker（Reaction 专用，全量 Emoji）
  长按某个 Reaction → 显示谁表达了这个反应（用户列表 Popover）

Reaction Picker（快捷面板）:
  触发: 消息工具栏首排 5 个常用 Emoji
  数量: 常用 5 个（基于使用频率自动更新）+ [+] 全量选择器
  入场: scale(0.5→1) + fade, 200ms bounce

AI 建议反应（元聊独有）:
  消息内容分析后在 Reaction Picker 首排显示建议 Emoji
  标记: 小星芒图标 ✨
  行为: 与普通 Reaction 完全相同
```

#### 消息类型详细规格

**文本消息**

```
内边距: 12px 16px（标准密度）
字体: Body Large, line-height 1.5
链接: primary 色，hover 下划线，右键菜单 [打开 / 复制链接]
@提及: primary-container 背景 + on-primary-container 文字, radius 4px
  点击: 跳转用户资料
#频道: tertiary 色文字
/命令: monospace + surface-container-high 背景
Emoji 纯文本（1-3 个 Emoji）: 字号放大 2.5rem，无气泡背景（空灵感）
代码内联: monospace, surface-container-high, radius 4px, 水平 4px padding
```

**图片消息**

```
容器: radius 12px, overflow hidden
最大尺寸: 240×240px（等比），最小: 80×80px
未加载: 灰色占位（已知尺寸），shimmer
加载中: 模糊缩略图（blur-up，先 200px 低分辨率后原图）
已加载: 图片，hover 显示操作覆盖层（下载 / 全屏）

图片全屏预览（Lightbox）:
  遮罩: rgba(0,0,0,0.9)，z-modal
  图片: 最大化显示，可拖拽/缩放（桌面 Ctrl+滚轮）
  左右: 同会话中前后图片切换（← →）
  顶部操作: [下载] [复制] [× 关闭]
  移动端: 双指缩放，左右滑动切换

多图消息（同时发多张）:
  ≤3 张: 行排列
  4-9 张: 网格 3 列
  更多: 显示前 9 张，最后一张覆盖 "+N"
```

**文件消息**

```
气泡宽度: min 200px
布局: flex, items-center, gap 12px, padding 12px 16px

文件图标区 (40×48px, radius 8px, 类型色):
  PDF:    红 #E53935
  Word:   蓝 #1976D2
  Excel:  绿 #388E3C
  PPT:    橙 #F57C00
  压缩包: 黄 #F9A825
  代码:   紫 #7B1FA2
  音频:   绿 #2E7D32
  视频:   深蓝 #1565C0
  其他:   灰 #607D8B
  内部显示文件扩展名，Label Small，白色

文件信息区:
  文件名: Body Large, 600, 最多 2 行截断
  大小:   Label Medium, on-surface-variant
  状态:   "点击下载" / "[████░] 23%" / "已下载 ✓"

下载按钮: Download 16px
  未下载: primary 色，点击开始下载
  下载中: 进度条替代底部文字，可取消
  已下载: Check 绿色，再次点击打开文件
```

**语音消息**

```
气泡宽度: 动态 min 120px max 240px
布局: flex, items-center, gap 8px, padding 10px 14px

[Play/Pause 圆形 36px, primary 背景]
波形图 (60×20px): 竖条 40 根，未播放 on-surface-variant/40%
                  播放进度以 primary 色填充（实时动画）
时长: Label Medium, tabular-nums, on-surface-variant

转写文字（新增，元聊独有）:
  语音下方折叠按钮 "查看文字 ▾" Label Small, primary
  点击展开: ASR 转写结果，Body Small, on-surface-variant
  加载中: "正在识别…" + Spinner 12px
```

**视频消息**

```
缩略图: 宽 240px，等比，radius 12px
播放覆盖层: 半透明黑色 + Play 圆形按钮 48px（白色）
时长: 右下角 Label Small，白色，semibold
点击: 全屏视频播放器（WebRTC / 本地）
```

**引用回复消息**

```
气泡内顶部额外区域（与正文连续）:
  左侧竖条: 3px, primary 色
  引用区: surface-container，radius 4px，padding 6px 8px
  发送人: Label Medium, primary 色
  内容: Body Small, on-surface-variant, 1 行截断
  类型: 图片/文件/语音 → 显示类型 + 缩略图 32×32px
  gap 6px 后接正文
  点击引用区: 滚动到被引用消息并高亮闪烁
```

**代码块消息**

```
背景: surface-container-high，radius 8px
字体: monospace, Body Medium
边框: 1px outline-variant
内边距: 12px 16px
顶部: 语言标签 Label Small + [复制] 图标按钮

语法高亮: 使用 highlight.js（懒加载），主题跟随亮/暗
超长代码: 最大高度 300px，overflow-y scroll，右侧滚动条细化为 4px
```

**系统消息（System Message）**

```
居中显示，无头像无气泡
字体: Label Medium, on-surface-variant
背景: 无（纯文字）或 surface-container, radius full, padding 4px 12px
内边距: 上下 8px
示例:
  "你已加入元聊"
  "张三 已退出群聊"
  "你和李四 现在可以互发消息了"
  "会话加密已开启 🔒"
```

**投票消息（Poll，新增）**

```
背景: surface-container，radius 12px，padding 16px
标题: Title Medium, 600
副标题: "投票 · 截止 12月31日" Label Small, on-surface-variant
选项（每项 44px, radius 8px）:
  进度条背景: primary-container/60%
  进度条: primary，高度 100%，z-base
  文字: 选项内容 + 票数/百分比（右对齐）
  已投: 对应选项有 CheckCircle 16px 覆盖
操作: [投票] / [查看结果] / [结束投票（创建者）]
```

**位置消息（Location，新增）**

```
地图缩略图: 200×120px，radius 8px
地址文字: Body Medium, on-surface
"点击查看地图" Label Small, primary
```

**待办消息（Todo，新增）**

```
容器: surface-container，radius 12px，padding 12px 16px
标题: Title Medium + [创建待办 icon]
项目列表（max 5 显示）:
  Checkbox + 内容 + 负责人 Avatar 20px
底部: "共 N 项，已完成 M 项" + [查看全部 →]
```

#### 正在输入指示器（Typing Indicator）

```
位置: 消息列表底部（跟随新消息）
布局: 同接收方消息布局（头像 + 内容）
内容: 3 个圆点（8px，primary 色），错开 400ms pulse 动画
文字: "张三 正在输入…" Label Small, on-surface-variant（群聊显示名字）

多人同时输入（群聊）:
  ≤2 人: "张三 和 李四 正在输入…"
  >2 人: "多人正在输入…"
  超过 5s 无输入：自动隐藏
```

### 4.5 消息输入区

```
┌─────────────────────────────────────────────────────────────┐
│  [工具栏 44px]                                               │
│  [🖼] [📎] [😊] [🎤] [📍] [📅] [✓] [⋯]                   │
├─────────────────────────────────────────────────────────────┤
│  [引用/回复条 36px — 有时显示]                               │
│  ┃  回复 张三: "明天 9 点有空吗？"    [×]                    │
├─────────────────────────────────────────────────────────────┤
│  [AI 建议回复 — 有时显示]                                    │
│  ✨ [是的，没问题] [不好意思要改时间] [好的，稍后确认]        │
├─────────────────────────────────────────────────────────────┤
│  [文本输入框 flex:1]                   [发送按钮 40×40px]    │
│  min 44px, max 120px(移动) / 200px(桌面)  brand-gradient    │
└─────────────────────────────────────────────────────────────┘
```

**工具栏图标按钮规格**

```
容器: padding 水平 8px，flex，gap 4px，overflow-x auto
按钮: 40×40px，radius full，on-surface-variant

[🖼] Image:       发送图片（图库 / 相机）
[📎] Paperclip:   发送文件（文件选择器）
[😊] Smile:       Emoji / 表情包选择器
[🎤] Mic:         语音消息
[📍] MapPin:      发送位置（仅移动端 or 桌面 Tauri）
[📅] Calendar:    创建日程（新增）
[✓] ListTodo:     创建待办（新增）
[⋯] More Plus:    更多：[名片] [红包] [投票] [截图]

Tooltip: 每个图标有 Tooltip（0.5s 后显示）
```

**文本输入框**

```
背景: transparent
字体: Body Large
resize: none
overflow-y: auto（超出高度后滚动）

桌面:
  Enter: 发送消息
  Shift+Enter: 换行
  Ctrl/Cmd+Enter: 发送（可在设置更改快捷键）

移动:
  Enter: 换行（软键盘 return）
  发送按钮: 发送消息

占位: "输入消息… 或 / 使用命令" on-surface-variant
  /: 触发命令面板建议列表（详见 §5）
  @: 弹出 @提及面板

草稿自动保存:
  离开会话时自动保存草稿
  回到会话时自动恢复草稿
  预览列表显示"[草稿] 内容…" error 色
```

**发送按钮**

```
尺寸: 40×40px，radius 12px
有内容: brand-gradient + 白色 Send 图标（激活 strokeWidth 2.5）
无内容: opacity 40%, cursor not-allowed
发送动画: 点击时 scale(0.9→1) 100ms + Send 图标飞出 translateX/Y 动画
```

**AI 建议回复（新增，元聊独有）**

```
触发条件:
  - 接收到对方消息超过 5s 未回复
  - 消息为疑问句或邀请型语句
  - 用户未开始输入

布局: 水平 Chip 列表，overflow-x auto
每个 Chip: Suggestion 样式（见 §00 Chip 规格），最多 3 个
前置: ✨ Sparkles 图标 12px

交互:
  点击 Chip: 填入输入框（可再编辑）而非直接发送
  向右箭头: 刷新建议
  × 关闭: 隐藏本条建议（记忆，不再触发）

隐私: 建议在本地生成（Edge AI），不上传消息内容
```

**引用回复条**

```
有引用时显示，高度 36px，消失时高度 0 过渡 200ms

布局: flex, items-center, gap 8px, px-4
左侧: 3px primary 竖条 + 引用内容（1 行截断）
右侧: × 取消引用按钮
```

**录音模式**

```
进入: 点击麦克风图标切换（非长按，避免误触）
界面（替换整个输入区）:
  [× 取消] ——— 波形动画 ——— 时间 00:00 ——— [🔴 发送]
  麦克风图标大圆（72px，red 背景，pulse 动画）
  上滑: 发送（可配置）
  左滑到 × 区域: 取消（无需松手）

最大录音: 60s，剩余 10s 时 Toast 提示 + 震动
自动增益: 无
```

**Emoji 选择器**

```
容器（桌面）: Popover 320×400px，radius 16px，elevation-3，offset 8px
容器（移动）: Bottom Sheet 80vh

内容:
  搜索框（顶部）
  最近使用（若有）
  按类别展示: 😀 🐱 🍎 ⚽ 🚗 🌞 💡 🔣
  Emoji Grid: 5 列（桌面 8 列），每格 40px，hover 放大 1.2x

GIF / 贴图（新增）:
  单独 Tab，接入 Tenor API
  搜索框实时搜索
  GIF 缩略图瀑布流
```

---

## 五、命令面板（Command Palette）—— 元聊独有

### 5.1 触发方式

- `Cmd/Ctrl + K`（全局）
- 输入框内输入 `/` 前缀（行内触发）
- 左侧导航栏 [⌘K] 按钮

### 5.2 布局

```
遮罩（桌面）: rgba(0,0,0,0.4), z-modal
容器: 居中，宽 600px，max-w 92vw，radius 16px，elevation-5
背景: surface, border 1px outline-variant

┌─────────────────────────────────────────────────────────────┐
│  🔍 搜索命令、会话、联系人、文件…              [ESC 关闭]    │
│     Input 52px，字体 Title Medium                           │
├─────────────────────────────────────────────────────────────┤
│  ─ 最近 ─                                                   │
│  ▶ 打开会话：张三丰（Enter 选中，→ 跳转）                    │
│  ▶ 搜索消息记录                                             │
│  ─ 命令 ─                                                   │
│  ▶ /mute 静音当前会话                                       │
│  ▶ /pin 置顶消息                                            │
│  ▶ /translate 翻译最近消息                                  │
│  ▶ /ai 打开 AI 助手                                         │
│  ─ 联系人 ─                                                 │
│  ▶ 李四（头像 + 名字 + 在线状态）                           │
└─────────────────────────────────────────────────────────────┘

结果列表:
  每项高度 52px，flex，items-center，gap 12px，px-4
  图标: 20px 前置
  标题: Body Large, on-surface
  副标题: Body Medium, on-surface-variant
  快捷键（若有）: Label Medium, on-surface-variant/60%，右对齐
  键盘: ↑↓ 导航，Enter 执行，ESC 关闭
  Hover: surface-container-high 高亮
  匹配高亮: 关键词黄底
```

### 5.3 内建命令列表

| 命令                | 说明                 |
| ------------------- | -------------------- |
| `/new`              | 新建会话/群聊        |
| `/mute [分钟]`      | 静音当前会话         |
| `/unmute`           | 解除静音             |
| `/pin`              | 置顶当前消息         |
| `/unpin`            | 取消置顶             |
| `/translate [语言]` | 翻译最近 10 条消息   |
| `/summary`          | AI 生成会话摘要      |
| `/ai`               | 打开 AI 助手侧边栏   |
| `/schedule [时间]`  | 定时发送消息         |
| `/clear`            | 清空输入框           |
| `/file`             | 打开文件选择器       |
| `/location`         | 发送当前位置         |
| `/settings`         | 跳转设置             |
| `/theme`            | 切换主题             |
| `/logout`           | 退出登录（二次确认） |

### 5.4 输入框行内 `/` 触发

```
当输入框键入 "/" 时:
  在输入框上方弹出命令建议列表（Popover，300px 宽）
  实时过滤匹配的命令
  Enter / Tab: 选中并完成命令（参数自动高亮等待填入）
  ESC: 关闭建议，保留 "/"

样式: 同命令面板结果项，轻量版（最多 5 条）
```

---

## 六、AI 助手侧边栏（AI Assistant Panel）—— 元聊独有

### 6.1 触发方式

- `/ai` 命令
- 顶部标题栏 Sparkles 图标（有时显示）
- 选中文字后出现 "✨ AI" 气泡按钮

### 6.2 布局

```
桌面：在详情面板位置叠加（宽度 280px）
移动：Bottom Sheet 60vh

┌──────────────────────────────────┐
│  ✨ AI 助手                [×]   │  Title Medium
├──────────────────────────────────┤
│  ─ 本次会话 ─                    │
│  [📝] 生成摘要                    │
│  [🌐] 翻译为中文                  │
│  [✅] 列出待办事项                │
│  [🗂] 导出聊天记录                │
├──────────────────────────────────┤
│  ─ 消息撰写 ─                    │
│  [✏️] 改写（正式/轻松/简洁）      │
│  [↩️] 续写                       │
│  [🔍] 语法检查                   │
├──────────────────────────────────┤
│  ─ 智能 ─                        │
│  [🤖] 询问 AI（自由对话）         │
│  [📅] 识别时间安排                │
│  [📊] 总结数据                   │
└──────────────────────────────────┘
```

---

## 七、聊天详情面板（ChatDetail）

### 7.1 单聊详情

```
┌────────────────────────────────────────┐
│  详情                          [← 关闭]│  高度 48px
├────────────────────────────────────────┤
│  Avatar 64px (lg)，居中               │
│  会话名称 Title Large 600             │
│  在线状态 Label Small                  │
│  元聊号: Y12345678 + [复制]            │
│  padding 20px，text-center             │
├────────────────────────────────────────┤
│  [快速操作行]                           │
│  ┌────┐ ┌────┐ ┌────┐                 │
│  │💬  │ │📞  │ │📹  │                 │
│  └────┘ └────┘ └────┘                 │
│  各占 1/3，高 64px，图标+标签         │
├────────────────────────────────────────┤
│  消息免打扰         [Toggle]           │
│  置顶会话           [Toggle]           │
│  消息通知提醒       每条 / 仅@我 [>]   │
│  搜索聊天记录                   [>]   │
│  修改备注                       [>]   │
│  查看共同群组                   [>]   │
├────────────────────────────────────────┤
│  媒体                         [全部>]  │
│  ┌──┐ ┌──┐ ┌──┐ ┌──┐（4 列网格）     │
│  图片缩略图                           │
│  ──────────────────────────────────   │
│  文件                         [全部>] │
│  ┌───────────────────────────────┐    │
│  │ 📄 报告.pdf   3.2MB   06-28   │    │
│  └───────────────────────────────┘    │
├────────────────────────────────────────┤
│  清空聊天记录        error 色          │
│  删除联系人          error 色          │
│  加入黑名单          error 色          │
└────────────────────────────────────────┘
```

### 7.2 群聊详情

```
在单聊基础上差异：
  - 快速操作: 替换通话 → [邀请成员] [群文件] [群二维码]
  - 新增成员列表区:
    ─ 成员 (28) ──────────── [邀请+] ─
    [头像 40px] × 8 + "+N" 更多
    4 列网格，超出 2 行折叠
    点击成员 → 该成员个人资料
  - 群组设置:
    群名称/公告               [>]
    群二维码                  [>]
    全员禁言    [Toggle, 仅管理员]
    我在本群的昵称            [>]
    消息加密    [Toggle]（企业版）
  - 危险操作:
    退出群组    error 色（非群主）
    解散群组    error 色（群主）
```

### 7.3 功能行规格

```
高度: 52px（标准密度）
内边距: 水平 16px
布局: flex, items-center, justify-between, gap 12px

左侧:
  图标（可选）20px, on-surface-variant
  标题 Body Large, on-surface

右侧:
  Toggle Switch（开关类）
  ChevronRight 16px（跳转类）
  当前值 Body Medium, on-surface-variant + ChevronRight
  文字链接 primary（操作类）

分隔线: 1px outline-variant，从左 16px 起（最后一项无）
悬浮: surface-container-high
过渡: 150ms
```

---

## 八、消息多选（Batch Select）

```
进入方式:
  移动: 长按消息 → 底部选择模式工具栏出现
  桌面: 长按或菜单选"选择消息"

选中态:
  消息左侧圆形 Checkbox 出现，尺寸 20px
  已选: primary 背景 + Check 白色
  气泡左侧 primary/15% 背景

工具栏（底部固定，替换输入区）:
  [×] 取消选择    [复制] [转发] [删除]  已选 N 条
  高度 56px，surface-container-low 背景

全选: 标题栏出现"全选"按钮
限制: 最多同时选 100 条（超出提示）
```

---

## 九、消息状态与通知

### 9.1 发送状态

| 状态     | 图标              | 颜色               | 说明         |
| -------- | ----------------- | ------------------ | ------------ |
| 发送中   | Loader2 spin 12px | on-surface-variant | 正在上传     |
| 已送达   | Check 12px        | on-surface-variant | 服务器已接收 |
| 已读     | CheckCheck 12px   | primary            | 对方已读     |
| 发送失败 | AlertCircle 14px  | error              | 点击重试     |

### 9.2 消息发送失败处理

```
失败标识: 气泡右侧 AlertCircle 16px error 色
点击: 展开 Popover
  [重试发送]  RefreshCw 图标
  [删除消息]  Trash2 图标，error 色

失败原因（Toast 1 次展示）:
  网络超时: "网络不稳定，发送失败"
  消息过大: "文件超过 100MB 限制"
  被拉黑:   "无法向该用户发送消息"
```

### 9.3 网络状态提示条

```
网络断开:
  位置: 页面顶部固定，高度 32px
  背景: warning (#B45309)
  文字: "网络已断开，正在尝试重连…" + Spinner 12px
  文字色: #FFFFFF

重连成功:
  背景变: success (#2D7D46)
  文字: "已重新连接" + CheckCircle
  2s 后 slide-up 消失

WebSocket 重连机制: 1s → 2s → 4s → 8s → 16s（最大 30s）指数退避
```

---

## 十、消息搜索（In-Chat Search）

```
触发: 顶部 [🔍 搜索] 按钮
布局:
  标题栏下方展开搜索条（推开内容区，非覆盖）
  输入框 + [↑] [↓] 上下翻 + [×] 关闭
  结果数: "3/8 条"  Label Medium

高亮方式:
  匹配消息: 背景 search-highlight (#FDE68A)，自动滚动定位
  上下翻: 平滑 scrollIntoView, behavior: smooth

移动端:
  替换整个顶部 AppBar，[← 返回] + 搜索框
```

---

## 十一、状态规范

### 11.1 加载骨架屏

**会话列表**

```
每项高度 68px:
  圆形 40px Avatar 占位
  右侧: 100px×14px 名称条 + 40px×12px 时间条 + 160px×12px 预览条
  shimmer 动画，间隔 200ms 错开
```

**消息列表**

```
交替左/右（模拟真实对话）:
  接收: 圆形 40px + 气泡矩形 180px / 120px
  发送: 气泡矩形 200px / 80px，靠右
  3-5 组，随机宽度增加真实感
```

### 11.2 空状态汇总

见 `DESIGN_LANGUAGE.md §14.2`

### 11.3 错误状态

| 场景             | 视觉                      | 操作          |
| ---------------- | ------------------------- | ------------- |
| 会话加载失败     | AlertCircle + "加载失败"  | [重试]        |
| 历史消息加载失败 | 消息列表顶部 error 提示条 | [重试]        |
| 消息发送失败     | 气泡右侧红色感叹号        | 点击重试/删除 |
| 网络断开         | 顶部 Warning Bar          | 自动重连      |
| 服务不可用       | 顶部 Error Bar            | [刷新]        |

---

## 十二、消息编辑功能（新增，超越竞品）

```
触发: 消息工具栏 [编辑]（仅自己的消息，48h 内）

编辑态:
  输入区替换为编辑模式（带黄色 "编辑中" 顶部条）
  输入框预填原消息内容
  [取消] [保存修改]

已编辑消息:
  气泡底部状态行追加 "已编辑" Label Small, on-surface-variant/60%
  hover "已编辑": Tooltip 显示最后编辑时间

编辑历史（可选）:
  右键菜单 [查看编辑历史] → 弹出时间线 Dialog
```

---

## 十三、定时消息（新增，超越竞品）

```
触发: 输入框工具栏 [📅] / 命令 /schedule

DateTimePicker:
  Popover（桌面 320px）/ Bottom Sheet（移动）
  日历选择 + 时间输入（24h 制）
  快捷选项: 明天上午 9 点 / 下午 6 点 / 一小时后

定时消息标识:
  气泡上方显示 Clock 图标 + 计划发送时间 Label Small, primary
  [取消定时] Button Text

到时自动发送（离线时在服务端发送）
```

---

## 十四、OpenDesign 页面帧清单

```
Main/Desktop-Empty           — 桌面三栏，无选中会话
Main/Desktop-Chat            — 桌面三栏，聊天激活
Main/Desktop-Chat-Detail     — 三栏 + 详情面板
Main/Desktop-Chat-AI         — 三栏 + AI 助手面板
Main/Desktop-Search          — 全局搜索激活
Main/Desktop-CommandPalette  — 命令面板叠加
Main/Desktop-Reactions       — 消息表情反应交互
Main/Desktop-MultiSelect     — 消息多选模式
Main/Desktop-Edit            — 消息编辑态

Main/Mobile-List             — 移动端会话列表
Main/Mobile-Chat             — 移动端聊天窗口
Main/Mobile-Chat-Toolbar     — 输入工具栏展开
Main/Mobile-Chat-Emoji       — Emoji 选择器弹出
Main/Mobile-Chat-Record      — 语音录制态
Main/Mobile-Chat-Reply       — 引用回复条
Main/Mobile-Chat-AIChips     — AI 建议回复 Chips

Main/Detail-Single           — 单聊详情面板
Main/Detail-Group            — 群聊详情面板
Main/Detail-Media            — 媒体文件面板

Main/Dark-*                  — 暗色模式抽样帧
Main/Compact-*               — 紧凑密度抽样帧
```

---

## 十五、变更日志

| 版本 | 日期       | 变更                                                                                                                                                                            |
| ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1.0 | 2026-06-29 | 初版                                                                                                                                                                            |
| v1.1 | 2026-07-06 | 新增：命令面板 / AI 助手 / Emoji Reactions / 消息编辑 / 定时消息 / 语音转写 / 投票/位置/待办消息类型 / 消息多选 / AI 建议回复 / 在线状态菜单 / OpenDesign 帧清单 / 状态矩阵完善 |
