# 元聊 YuanChat — 设计语言规范（Design Language）

> 本文档是元聊所有界面设计的**唯一真实来源（Single Source of Truth）**。
> 所有原型图、组件实现、插画绘制、图标补齐、平台适配都必须以此为准。
> 对应设计工具：Figma / OpenDesign 组件库 `YuanChat DS v1`。

---

## 一、设计哲学（Design Philosophy）

### 1.1 我们要做什么样的 IM

元聊不是"又一个微信"。它是一款**面向新一代企业与专业用户**的即时通讯工具：

- **克制、清晰**：屏幕上没有任何多余像素，每一个元素都在为"完成一次沟通"服务
- **温度、可信**：Aurora 蓝的品牌基调传达可靠感，但通过渐变、光晕保留温度
- **专业、可扩展**：既能承载 1v1 私聊，也能承载 500 人协作型群聊、频道、机器人

### 1.2 三条根本设计原则（Design Principles）

| 原则                          | 表述                                                                 | 落地检查                                                             |
| ----------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **P1 Message First**          | 一切让位于消息本身。装饰、导航、次要信息都必须为"消息可读"服务       | 消息气泡区域始终保持最高信息密度；周边元素颜色对比更低               |
| **P2 Progressive Disclosure** | 渐进披露。用户第一屏只看到关键功能，高级功能藏在长按 / 命令 / 设置里 | 首屏功能 ≤ 5 个；`⋮` / 右键 / `/` 命令承载扩展能力                   |
| **P3 Motion with Meaning**    | 每一个动效都必须回答"你从哪来、到哪去、和谁相关"                     | 无纯装饰动画；动效时长遵循 §11 表；`prefers-reduced-motion` 完全绕开 |

### 1.3 与主流 IM 的差异化定位（Competitive Positioning）

站在 UI/UX 视角，元聊从竞品中吸收精华并明确超越点：

| 维度     | 微信             | QQ                 | Telegram                | **元聊（目标）**                       |
| -------- | ---------------- | ------------------ | ----------------------- | -------------------------------------- |
| 视觉基调 | 极简克制、偏冷灰 | 年轻、多彩、装饰重 | 深蓝极客风              | **温感 Aurora + 克制留白**             |
| 消息反应 | 无（仅"拍一拍"） | 抖动/涂鸦          | Emoji Reactions（顶级） | **Reactions + AI 建议反应**            |
| 消息编辑 | 不支持           | 不支持             | 无时限编辑              | **48 小时内编辑 + 明确"已编辑"标识**   |
| 消息线程 | 无（只有引用）   | 无                 | 频道内 Comments         | **群聊 Thread（子话题）**              |
| 定时消息 | 无               | 无                 | 有                      | **有 + 时区智能识别**                  |
| 消息搜索 | 弱（仅本地）     | 一般               | 极强（云端全文）        | **本地即时 + 云端全文 + AI 语义搜索**  |
| 快捷命令 | 无               | 无                 | Bot `/command`          | **系统级 `/` 命令面板**                |
| AI 能力  | 无               | 无                 | 有限                    | **内建 AI 助手、翻译、摘要、智能回复** |
| 多端同步 | 弱（切端需登录） | 中                 | 顶级（云端）            | **顶级 + 端到端加密可选**              |
| 可访问性 | 弱               | 弱                 | 中                      | **WCAG 2.1 AA 全线达标**               |
| 密度可调 | 无               | 无                 | 有（Compact）           | **舒适 / 标准 / 紧凑 三档**            |

**元聊的"必须超越"清单**：

1. Message Reactions（消息表情反应）—— Telegram 是天花板，元聊要超越（加 AI 建议、组合反应）
2. 命令面板（Command Palette，`Cmd/Ctrl+K`）—— IM 领域几乎空白
3. AI 原生集成 —— 智能回复、翻译、摘要、情绪分析
4. 可访问性 —— IM 领域普遍不合格，元聊要成为标杆

### 1.4 情感基调（Emotional Tone）

- **信任**：Aurora 蓝主色 + 干净的白/暗背景
- **专注**：低饱和辅助色，避免抢夺注意力
- **温度**：气泡渐变、光晕、微动效保留人性温度
- **专业**：字体、间距、栅格严谨；不使用卡通/夸张元素

---

## 二、品牌标识（Brand Identity）

| 项目       | 规格                                                                         |
| ---------- | ---------------------------------------------------------------------------- |
| 产品名     | 元聊 / YuanChat                                                              |
| 中英文并列 | 中文优先，英文小字（Body Small）副标题                                       |
| 标语       | 企业级即时通讯 / _Chat, Reimagined._                                         |
| Logo 图标  | `MessageCircle`（Lucide Icons，`strokeWidth=2`）                             |
| Logo 形态  | 图标置于圆角方形（28px 圆角）品牌渐变背景内，白色图标                        |
| Logo 尺寸  | 标准 80×80px / 中号 40×40px / 小号 24×24px（favicon） / 巨型 128px（欢迎屏） |
| Logo 净空  | 四周至少留 Logo 尺寸的 25% 作为净空                                          |
| Logo 禁止  | 不允许旋转、拉伸、纯色反色、加边框、加投影（Aurora 发光除外）                |

### 2.1 品牌渐变（Brand Gradient）

```
主渐变（135° 对角）— 用于主按钮、气泡、Logo 背景：
  #5B9BD5  →  #7EC8E3  →  #A8CFFF
  0%           50%          100%

导航侧边栏渐变（180° 纵向）：
  #5B9BD5  →  #4A8BC5
  0%           100%

Aurora 认证背景光晕（3 光球）：
  Orb 1: #7EC8E3, 500×500px, blur 80px, opacity 40%
  Orb 2: #A8CFFF, 400×400px, blur 80px, opacity 40%
  Orb 3: #B8D8F0, 350×350px, blur 80px, opacity 40%

品牌发光（Logo Glow）：
  box-shadow: 0 0 30px rgba(91,155,213,0.25), 0 0 60px rgba(91,155,213,0.08)
```

### 2.2 品牌应用示意

| 场景            | 主色使用                                   |
| --------------- | ------------------------------------------ |
| Logo            | 品牌渐变                                   |
| 主按钮 (Filled) | 品牌渐变                                   |
| 发送方气泡      | 品牌渐变                                   |
| 激活导航项      | 品牌渐变（暗色基底上）                     |
| 品牌链接        | Primary 单色（不用渐变，避免文字阅读干扰） |
| 焦点环          | Primary 30% 透明度                         |

---

## 三、颜色系统（Color System）

采用 **Material Design 3 Tonal Palette** 方法：所有颜色通过 CSS 变量 `--md-sys-color-*` 定义，运行时通过更改 `:root` 上 class（`.dark` / `.theme-ocean` / `.theme-forest`）切换。

### 3.1 亮色主题（Light Theme）

| Token                  | CSS 变量                                | Hex       | 对比背景     | 对比度 | WCAG      |
| ---------------------- | --------------------------------------- | --------- | ------------ | ------ | --------- |
| Primary                | `--md-sys-color-primary`                | `#5B9BD5` | on `#F0F7FF` | 3.05:1 | AA 大文字 |
| On Primary             | `--md-sys-color-on-primary`             | `#FFFFFF` | on Primary   | 4.72:1 | AA 正文   |
| Primary Container      | `--md-sys-color-primary-container`      | `#D6EAFF` | on `#F0F7FF` | 1.11:1 | 容器色    |
| On Primary Container   | `--md-sys-color-on-primary-container`   | `#001D33` | on `#D6EAFF` | 15.8:1 | AAA       |
| Secondary              | `--md-sys-color-secondary`              | `#5A6D82` | on `#F0F7FF` | 4.79:1 | AA 正文   |
| Tertiary               | `--md-sys-color-tertiary`               | `#5B8A8A` | on `#F0F7FF` | 3.62:1 | AA 大文字 |
| Error                  | `--md-sys-color-error`                  | `#BA1A1A` | on `#F0F7FF` | 5.68:1 | AA 正文   |
| Error Container        | `--md-sys-color-error-container`        | `#FFDAD6` | on `#F0F7FF` | 1.03:1 | 容器色    |
| Background             | `--md-sys-color-background`             | `#F0F7FF` | —            | —      | —         |
| Surface                | `--md-sys-color-surface`                | `#F0F7FF` | —            | —      | —         |
| On Surface             | `--md-sys-color-on-surface`             | `#171C24` | on `#F0F7FF` | 15.6:1 | AAA 正文  |
| On Surface Variant     | `--md-sys-color-on-surface-variant`     | `#424853` | on `#F0F7FF` | 9.20:1 | AAA 正文  |
| Outline                | `--md-sys-color-outline`                | `#727883` | on `#F0F7FF` | 3.75:1 | AA 大文字 |
| Outline Variant        | `--md-sys-color-outline-variant`        | `#C2C8D3` | 分隔线专用   | —      | 3:1       |
| Surface Container Low  | `--md-sys-color-surface-container-low`  | `#EBF2FC` | —            | —      | 输入框    |
| Surface Container      | `--md-sys-color-surface-container`      | `#E5ECF6` | —            | —      | 卡片      |
| Surface Container High | `--md-sys-color-surface-container-high` | `#DFE6F0` | —            | —      | 悬浮      |
| Inverse Surface        | `--md-sys-color-inverse-surface`        | `#2C3138` | Toast 背景   | —      | —         |
| Inverse On Surface     | `--md-sys-color-inverse-on-surface`     | `#EFF3F9` | on Inverse   | 11.8:1 | AAA       |

### 3.2 暗色主题（Dark Theme）

| Token                  | Hex       | 对比                  | WCAG   |
| ---------------------- | --------- | --------------------- | ------ |
| Primary                | `#A8CFFF` | on `#0E141B` = 11.4:1 | AAA    |
| On Primary             | `#003354` | on `#A8CFFF` = 8.6:1  | AAA    |
| Primary Container      | `#1B4B6F` | —                     | —      |
| Background             | `#0E141B` | —                     | —      |
| Surface                | `#0E141B` | —                     | —      |
| On Surface             | `#DEE5EE` | 12.1:1                | AAA    |
| On Surface Variant     | `#C2C8D3` | 9.2:1                 | AAA    |
| Outline Variant        | `#424853` | —                     | 分隔线 |
| Surface Container Low  | `#161C24` | —                     | —      |
| Surface Container      | `#1A2028` | —                     | —      |
| Surface Container High | `#252B33` | —                     | —      |
| Error                  | `#FFB4AB` | 9.4:1                 | AAA    |

### 3.3 语义颜色（Semantic Colors）

| 用途              | 亮色      | 暗色      | 用途说明           |
| ----------------- | --------- | --------- | ------------------ |
| Success           | `#2D7D46` | `#6DD08E` | 操作成功、连接稳定 |
| Warning           | `#B45309` | `#FCD34D` | 弱网、临期提示     |
| Info              | `#5B9BD5` | `#A8CFFF` | 中性信息           |
| Online            | `#22C55E` | `#4ADE80` | 在线状态点         |
| Away              | `#F59E0B` | `#FBBF24` | 离开               |
| Busy              | `#EF4444` | `#F87171` | 请勿打扰           |
| Offline           | `#9CA3AF` | `#6B7280` | 离线               |
| Unread Badge      | `#E53935` | `#EF5350` | 未读计数           |
| Mention Highlight | `#FEF08A` | `#854D0E` | @提及关键词高亮    |
| Search Highlight  | `#FDE68A` | `#78350F` | 搜索命中高亮       |

### 3.4 色盲友好（Color Blindness Safety）

- 不能只依赖颜色传达状态，必须辅以图标 / 位置 / 文字：
  - 在线绿点 → 位置固定（右下）+ 圆点形状
  - 未读红点 → 位置固定 + 数字
  - 错误红 → 附 `AlertCircle` 图标
  - 成功绿 → 附 `CheckCircle2` 图标
- 关键状态经 Coblis 三色盲（Protanopia/Deuteranopia/Tritanopia）模拟验证可辨识

### 3.5 内置主题皮肤

| 皮肤 ID                                    | 名称   | Primary 亮            | Primary 暗 | 场景     |
| ------------------------------------------ | ------ | --------------------- | ---------- | -------- |
| `yuan-light`                               | 元聊蓝 | `#5B9BD5`             | —          | 默认亮色 |
| `yuan-dark`                                | 元聊暗 | `#A8CFFF`             | —          | 默认暗色 |
| `ocean-light` / `ocean-dark`               | 海洋   | `#00658A` / `#8BCEF1` | 蓝绿爱好者 |
| `forest-light` / `forest-dark`             | 森林   | `#386A20` / `#9DD67B` | 护眼绿意   |
| `sunset-light` / `sunset-dark`（预留）     | 日落   | `#B45309` / `#FCD34D` | 温暖橙     |
| `graphite-light` / `graphite-dark`（预留） | 墨石   | `#4B5563` / `#9CA3AF` | 极简中性   |

**皮肤对话框预览规格**：见 `04_SETTINGS_PAGE.md#外观设置`。

### 3.6 颜色使用铁律

- ❌ 禁止在 `.tsx` 组件内硬编码 Hex（除装饰性 Aurora 光晕）
- ❌ 禁止直接使用 Tailwind 内置调色板 `bg-blue-500`（脱离主题系统）
- ✅ 所有颜色通过 `bg-primary` / `text-on-surface` 等 Token 类名调用
- ✅ 主题切换必须整站原子生效（用 CSS 变量，不用 JS 遍历）

---

## 四、字体排版（Typography）

### 4.1 字体族

```
Sans-Serif (默认):
  -apple-system, BlinkMacSystemFont, "Segoe UI Variable",
  "PingFang SC", "Microsoft YaHei", "Noto Sans SC",
  "Helvetica Neue", sans-serif

Monospace (代码 / 时间戳):
  "JetBrains Mono", "Fira Code", "SFMono-Regular",
  Consolas, "Liberation Mono", monospace

Emoji (强制系统渲染，不用第三方字体族):
  "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"
```

基础字号：**14px**（`html { font-size: 14px }`），移动端最小可读字号 12px。

### 4.2 M3 字体层级

| 等级            | Tailwind 类        | rem      | px      | 字重 | 行高 | 用途                       |
| --------------- | ------------------ | -------- | ------- | ---- | ---- | -------------------------- |
| Display Large   | `text-display-lg`  | 3rem     | 42px    | 700  | 1.15 | 欢迎屏、大型营销页         |
| Display Medium  | `text-display-md`  | 2.5rem   | 35px    | 700  | 1.2  | 大型标题                   |
| Headline Large  | `text-headline-lg` | 2rem     | 28px    | 600  | 1.25 | 认证页标题、Modal 主标题   |
| Headline Medium | `text-headline-md` | 1.75rem  | 24.5px  | 600  | 1.25 | 区块主标题                 |
| Headline Small  | `text-headline-sm` | 1.5rem   | 21px    | 600  | 1.3  | 次级标题、个人资料昵称     |
| Title Large     | `text-title-lg`    | 1.375rem | 19.25px | 500  | 1.3  | 会话名称、面板标题         |
| Title Medium    | `text-title-md`    | 1rem     | 14px    | 600  | 1.4  | 列表项标题、导航标签       |
| Title Small     | `text-title-sm`    | 0.875rem | 12.25px | 500  | 1.4  | 小标题                     |
| Body Large      | `text-body-lg`     | 1rem     | 14px    | 400  | 1.5  | 正文、输入框文字、消息内容 |
| Body Medium     | `text-body-md`     | 0.875rem | 12.25px | 400  | 1.5  | 消息预览、辅助文字         |
| Body Small      | `text-body-sm`     | 0.75rem  | 10.5px  | 400  | 1.5  | 错误提示、脚注             |
| Label Large     | `text-label-lg`    | 0.875rem | 12.25px | 500  | 1.4  | 按钮文字、Chip 文字        |
| Label Medium    | `text-label-md`    | 0.75rem  | 10.5px  | 500  | 1.4  | 时间戳、辅助标签           |
| Label Small     | `text-label-sm`    | 0.688rem | 9.6px   | 500  | 1.3  | 角标数字、最小注释         |

### 4.3 排版细则

| 规则       | 说明                                                          |
| ---------- | ------------------------------------------------------------- |
| 数字表格化 | 时间/计数使用 `font-variant-numeric: tabular-nums`，防跳动    |
| 连字符     | 中英文混排自动 `word-break: normal; overflow-wrap: anywhere;` |
| 中文引号   | `""` `''` 优先，非直引                                        |
| 换行       | 消息气泡内 `white-space: pre-wrap` 保留换行                   |
| 段落间距   | 消息文本连续段落间距 = 6px                                    |
| 链接下划线 | 悬浮才出现（`hover:underline`），减少视觉噪音                 |
| 强调       | 使用 `<strong>` 加粗 600；不用斜体（中文可读性差）            |
| 引用文本   | 引用块左侧 3px Primary 竖条 + 内文轻灰                        |

### 4.4 字号动态缩放（Font Scale）

用户可在设置中选择 4 档：

| 档位         | scale | body-lg 实际 |
| ------------ | ----- | ------------ |
| 小           | 0.85  | 11.9px       |
| 标准（默认） | 1.00  | 14px         |
| 大           | 1.15  | 16.1px       |
| 超大         | 1.30  | 18.2px       |

实现：`html { font-size: calc(14px * var(--font-scale)); }`，所有 rem 单位自动跟随。

---

## 五、间距系统（Spacing）

基于 **4pt Grid**（Tailwind 默认 `spacing: 1 = 4px`）

| Token       | px   | 用途                         |
| ----------- | ---- | ---------------------------- |
| `space-0.5` | 2px  | 微小间隙、图标与文字微调     |
| `space-1`   | 4px  | 图标与文字间距、角标偏移     |
| `space-2`   | 8px  | 行内小间距、按钮内 icon+text |
| `space-3`   | 12px | 组件内部间距、Chip padding   |
| `space-4`   | 16px | 标准内边距（卡片、列表项）   |
| `space-5`   | 20px | 中等内边距                   |
| `space-6`   | 24px | 大区块内边距                 |
| `space-8`   | 32px | 区块间距                     |
| `space-10`  | 40px | 大区块间距                   |
| `space-12`  | 48px | 超大间距（认证 Logo 下方）   |
| `space-16`  | 64px | 页面区隔                     |

### 5.1 密度模式（Density）

用户可切换 3 档密度，影响列表项 / 消息气泡的垂直 padding：

| 模式                  | ConversationItem 高 | Message 气泡 padding-y | Settings row 高 |
| --------------------- | ------------------- | ---------------------- | --------------- |
| 紧凑 Compact          | 56px                | 6px                    | 44px            |
| 标准 Standard（默认） | 68px                | 10px                   | 52px            |
| 舒适 Comfortable      | 80px                | 14px                   | 60px            |

---

## 六、圆角系统（Radius）

| 名称 | px   | Tailwind         | 用途                         |
| ---- | ---- | ---------------- | ---------------------------- |
| none | 0    | `rounded-none`   | 分隔线、全出血区             |
| xs   | 4    | `rounded-[4px]`  | 角标、进度端点、代码内联     |
| sm   | 8    | `rounded-lg`     | 小按钮、Chip、缩略图         |
| md   | 12   | `rounded-xl`     | 输入框、卡片、气泡           |
| lg   | 16   | `rounded-2xl`    | 大卡片、Modal、气泡最外层    |
| xl   | 28   | `rounded-[28px]` | Logo 背景、FAB               |
| full | 9999 | `rounded-full`   | 头像、圆形按钮、徽章、状态点 |

**圆角语义**：越是"交互频繁 / 亲近用户"的元素圆角越大（气泡 16px、按钮 12px、卡片 16px、Modal 16px），系统级容器可较方正。

---

## 七、阴影与层次（Elevation & Z-Index）

### 7.1 Elevation 阴影

| Level | Token              | 阴影值                                                  | 使用                   |
| ----- | ------------------ | ------------------------------------------------------- | ---------------------- |
| 0     | —                  | `none`                                                  | 平面元素、背景         |
| 1     | `--md-elevation-1` | `0 1px 2px rgba(0,0,0,.30), 0 1px 3px rgba(0,0,0,.15)`  | 卡片、列表项悬浮       |
| 2     | `--md-elevation-2` | `0 1px 2px rgba(0,0,0,.30), 0 2px 6px rgba(0,0,0,.15)`  | 导航栏、FAB            |
| 3     | `--md-elevation-3` | `0 4px 8px rgba(0,0,0,.15), 0 1px 3px rgba(0,0,0,.30)`  | 弹出菜单、Tooltip      |
| 4     | `--md-elevation-4` | `0 6px 10px rgba(0,0,0,.15), 0 2px 3px rgba(0,0,0,.30)` | Modal                  |
| 5     | `--md-elevation-5` | `0 8px 12px rgba(0,0,0,.15), 0 4px 4px rgba(0,0,0,.30)` | 全屏对话框、图片查看器 |

暗色主题阴影透明度 ×1.5（暗背景阴影不易察觉）。

### 7.2 Z-Index 层级规范

必须使用 Tailwind 语义 z-index，禁止随手写 `z-[9999]`：

| Token        | 值  | 层次     | 用途                         |
| ------------ | --- | -------- | ---------------------------- |
| `z-base`     | 0   | Base     | 页面主内容                   |
| `z-sticky`   | 10  | Sticky   | 吸顶栏、消息置顶条           |
| `z-fixed`    | 20  | Fixed    | 导航栏、AppBar、TabBar       |
| `z-drawer`   | 30  | Drawer   | 侧滑抽屉、详情面板           |
| `z-overlay`  | 40  | Overlay  | 遮罩层（Modal 后面）         |
| `z-modal`    | 50  | Modal    | Dialog / Bottom Sheet 内容   |
| `z-popover`  | 60  | Popover  | Dropdown / ContextMenu       |
| `z-tooltip`  | 70  | Tooltip  | 悬浮提示                     |
| `z-toast`    | 80  | Toast    | 全局提示                     |
| `z-titlebar` | 100 | TitleBar | Tauri 桌面标题栏（永远置顶） |

---

## 八、图标系统（Iconography）

- **图标库**：`lucide-react`（MIT，已引入）
- **补齐规则**：无对应图标时在 `packages/design-system/src/icons/` 新建独立 SVG，通过 `?react` 导入，禁止内联 `<svg>`
- **默认笔画**：`strokeWidth=1.5`；激活/选中态 `strokeWidth=2.5`
- **线端**：`stroke-linecap: round; stroke-linejoin: round`
- **网格**：24×24px 视图框、2px 内边距（保证圆角图标不裁切）

### 8.1 尺寸规格

| 名称    | px  | 使用场景                     |
| ------- | --- | ---------------------------- |
| tiny    | 12  | 消息气泡状态、Chip 内前置    |
| xs      | 14  | 输入框状态、行内提示         |
| sm      | 16  | Chip、状态点前置、气泡工具栏 |
| md      | 18  | 工具栏、输入框内嵌           |
| default | 20  | 副操作、设置项               |
| lg      | 24  | 主导航、主要操作             |
| xl      | 32  | 空态、大按钮                 |
| 2xl     | 48  | 空态图                       |
| 3xl     | 64  | 欢迎屏、超大空态             |

### 8.2 核心图标清单（≈ 60 个，按功能分组）

**导航与结构**  
`MessageCircle` `Users` `Settings` `Search` `Bell` `BellOff` `Home` `LayoutGrid` `Menu`

**消息操作**  
`Send` `Paperclip` `Image` `Smile` `Mic` `MicOff` `Video` `Phone` `PhoneOff` `Reply` `Forward` `Bookmark` `Copy` `Pin` `PinOff` `Trash2` `Edit3` `MoreHorizontal` `Sparkles`（AI 建议）`AtSign`（@提及）`Hash`（频道）`Slash`（命令）`Clock`（定时）

**消息状态**  
`Check` `CheckCheck` `AlertCircle` `Loader2` `Eye` `EyeOff` `Lock` `Unlock`（加密）

**内容类型**  
`FileText` `FileImage` `FileVideo` `FileAudio` `FileCode` `FileArchive` `Play` `Pause` `Download` `Upload` `Link` `MapPin`（位置）`Contact`（名片）`Calendar`（日程）`ListTodo`（待办）`Vote`（投票）

**用户**  
`User` `UserPlus` `UserMinus` `UserCheck` `UserX` `Shield` `ShieldCheck` `ShieldAlert` `Crown`（群主）`Award`

**外观 / 系统**  
`Sun` `Moon` `Monitor` `Smartphone` `Laptop` `Palette` `Type` `Globe` `HelpCircle` `Info` `RefreshCw` `LogOut` `LogIn` `QrCode` `Camera` `X` `ArrowLeft` `ArrowRight` `ChevronDown` `ChevronRight` `ChevronLeft` `Plus` `Minus`

### 8.3 图标使用铁律

- ❌ 禁止在业务组件内写 `<svg>...</svg>`
- ❌ 禁止用 emoji 代替功能图标（emoji 只用于用户内容）
- ✅ 所有 IconButton 必须有 `aria-label`
- ✅ 主导航使用带填充或粗描边的激活态

---

## 九、核心组件规范（Core Components）

### 9.1 Button

四种变体，统一高度 **48px**，圆角 **12px（md）**，字体 Label Large。

| 变体     | 视觉                                           | 使用场景                       |
| -------- | ---------------------------------------------- | ------------------------------ |
| Filled   | Brand Gradient 背景 + 白字                     | 主要操作（登录 / 发送 / 确认） |
| Outlined | 透明底 + 1.5px Primary 描边                    | 次要操作                       |
| Text     | 无底无框，Primary 文字                         | 第三级操作、链接式按钮         |
| Tonal    | Primary Container 底 + On Primary Container 字 | 次强调（新版增）               |
| Icon     | 40×40px 圆形                                   | 图标按钮                       |

**状态矩阵**：

| 状态     | Filled                          | Outlined       | Text           | Icon                      |
| -------- | ------------------------------- | -------------- | -------------- | ------------------------- |
| Default  | Gradient                        | Border 1.5px   | text-primary   | text-on-surface-variant   |
| Hover    | opacity 90%                     | bg primary/8%  | bg primary/8%  | bg on-surface-variant/8%  |
| Pressed  | opacity 80% + scale(.98)        | bg primary/12% | bg primary/12% | bg on-surface-variant/12% |
| Focused  | 3px focus ring                  | 3px focus ring | 3px focus ring | 3px focus ring            |
| Disabled | opacity 38%, cursor not-allowed | opacity 38%    | opacity 38%    | opacity 38%               |
| Loading  | Spinner 左 + "处理中…"          | 同 Filled      | 同 Filled      | Spinner 替换 icon         |

尺寸变体：

| 尺寸       | 高   | padding-x | 字体         |
| ---------- | ---- | --------- | ------------ |
| xs         | 28px | 12px      | Label Medium |
| sm         | 36px | 16px      | Label Large  |
| md（默认） | 48px | 24px      | Label Large  |
| lg         | 56px | 32px      | Title Small  |

### 9.2 Input（输入框）

```
高度:       48px（sm 变体 36px）
圆角:       12px
内边距:     水平 16px，垂直 12px
背景:       surface-container-low
边框:       1px solid outline-variant
字体:       Body Large
占位:       on-surface-variant，不加粗

— 聚焦态 —
边框:       2px solid primary
背景:       surface-container-lowest
发光:       0 0 0 3px rgba(91,155,213,0.15)

— 错误态 —
边框:       2px solid error
错误文字:   Body Small, error 色，输入框下方 4px（附 AlertCircle 12px）

— 禁用态 —
opacity: 50%, cursor: not-allowed, 背景 outline-variant/40%

— 密码框 —
右侧 Eye/EyeOff 32×32px 图标按钮

— 搜索框 —
左侧 Search 16px 图标，左内边距 40px
右侧 清除按钮（有内容时显示）

— 内联标签（Floating Label）—（新增）
默认: 占位文字居中垂直位置
聚焦/有值: 占位缩小上移至上边界，Label Small
```

### 9.3 Avatar（头像）

| 尺寸 | px  | 使用场景               |
| ---- | --- | ---------------------- |
| xs   | 24  | 消息引用预览、名片小图 |
| sm   | 32  | 紧凑列表、@提及内联    |
| md   | 40  | 会话列表、消息气泡旁   |
| lg   | 56  | 聊天窗口顶栏           |
| xl   | 80  | 登录 Logo 位（非人像） |
| 2xl  | 96  | 个人资料大头像         |
| 3xl  | 128 | 欢迎屏                 |

**占位规则**：无头像时使用「基于用户 ID 哈希」的稳定渐变（12 色调色盘）+ 昵称首字（白色，字重 700）。

**状态点**（在线指示）：

| 状态 | 颜色              | 图标覆盖       |
| ---- | ----------------- | -------------- |
| 在线 | `#22C55E`         | 无             |
| 离开 | `#F59E0B`         | 无             |
| 忙碌 | `#EF4444`         | Minus 6px 白色 |
| 勿扰 | `#B45309`         | Moon 6px 白色  |
| 离线 | 隐藏 or `#9CA3AF` | 无             |

状态点尺寸：Avatar sm 6px，md 10px，lg+ 12px，白色 2px 外描边。

**群组头像**：2×2 拼接前 4 位成员头像，若少于 4 位则用品牌渐变填补空格。

### 9.4 消息气泡（Message Bubble）

见 `02_MAIN_INTERFACE.md` 详规。以下为设计系统层面基础规格：

```
公共:
  最大宽度 70%
  圆角 16px（对应"尾角"改为 4px）
  内边距 12px 16px（标准密度）
  文本 Body Large，行高 1.5

发送方（自己）:
  背景 brand-gradient
  文字 #FFFFFF
  尾角 右下 4px
  发光 0 2px 12px rgba(91,155,213,0.30)

接收方:
  背景 surface (亮) / surface-container (暗)
  文字 on-surface
  边框 1px outline-variant/40%
  尾角 左下 4px
  阴影 0 1px 3px rgba(0,0,0,0.06)

引用块（内嵌）:
  背景 surface-container
  左 3px Primary 竖条
  Label Medium 发送人 + Body Small 内容 2 行截断

选中态（多选/复制）:
  背景 primary/12%
  外圈 2px primary
```

### 9.5 Badge

```
未读计数:
  1-2 位: 圆形 18×18px
  ≥3 位: 胶囊 18px 高，padding-x 8px
  >99: 显示 "99+"
  背景 #E53935 / #EF5350
  文字 #FFFFFF Label Small (字重 700)

状态点:
  直径 8px（Avatar 上叠加时 10-12px）
  语义色见 3.3

Dot（提示未读但不显示数字）:
  6-8px 圆点，用于会话已开启"仅提醒" or 免打扰

New（新增角标）:
  文字 "NEW" Label Small，橙色 (#F59E0B)
  用于设置新增项
```

### 9.6 Dialog（模态框）

```
遮罩:       rgba(0, 0, 0, 0.5)，可选 backdrop-blur-sm
容器:       surface-container-high 背景，圆角 16px，elevation-4
最大宽:     480px（桌面）/ 92vw（移动）
最大高:     min(560px, 80vh)
内边距:     24px（移动 20px）
标题:       Title Large, 600
描述:       Body Medium, on-surface-variant
按钮区:     右对齐，间距 8px，次要在左，主按钮在右
进入:       scale(.9)→(1) + opacity(0)→(1), 200ms decelerate
退出:       scale(1)→(.95) + opacity(1)→(0), 150ms accelerate
关闭:       右上角 X 按钮 / ESC 键 / 点击遮罩
可访问性:   focus trap，Tab 循环，首个可交互元素自动聚焦
```

### 9.7 Bottom Sheet（移动端）

```
容器:       surface-container-low 背景，顶部圆角 16px，elevation-2
手柄:       32×4px, surface-container-high, 圆角 full, 顶部居中 8px
高度模式:   固定 / 半屏 (50%) / 全屏 (fullscreen)
进入:       translateY(100%)→(0), 350ms decelerate
退出:       translateY(0)→(100%), 250ms accelerate
拖动关闭:   向下拖 >120px 或松手速度 > 500px/s
遮罩:       rgba(0,0,0,0.4)
```

### 9.8 Toast

```
位置:       桌面左下角 24px, 移动端底部居中 24px (键盘上方)
最小宽:     280px；最大宽:  400px
背景:       inverse-surface；文字 inverse-on-surface, Body Medium
圆角:       12px；内边距:  12px 16px
图标（可选）:
  Success: CheckCircle2 绿色 16px
  Error:   AlertCircle 红色 16px
  Info:    Info 蓝色 16px
  Warning: AlertTriangle 橙色 16px
入场:       opacity(0→1) + translateY(8px→0), 250ms decelerate
自动消失:   Success/Info 3s / Warning 4s / Error 5s
可关闭:     右侧 X 图标（Error 必须显示）
可堆叠:     最多 3 个，超出替换最早的（"…还有 N 条提示"折叠）
```

### 9.9 Tooltip

```
背景:       inverse-surface, 圆角 8px, elevation-3
文字:       inverse-on-surface, Label Medium
内边距:     6px 10px
最大宽:     240px
触发:       hover 500ms 后 / focus 100ms 后
消失:       hover 离开 100ms 后
方位:       auto（顶部优先，空间不足降级）
箭头:       6px 三角
移动端:     不显示 Tooltip（改用长按提示或 aria-describedby）
```

### 9.10 Chip / Tag

```
高度:       28px（sm 24px, lg 32px）
圆角:       full
内边距:     水平 12px（有前置图标时左 8px）
字体:       Label Medium
背景:       surface-container-high
文字:       on-surface

变体:
  Filter Chip（可切换）: 选中态 primary-container + on-primary-container
  Assist Chip（辅助）:   带前置图标
  Input Chip（输入）:    右侧 X 移除按钮
  Suggestion Chip:       高亮描边，用于 AI 建议回复
```

### 9.11 Skeleton（骨架屏）

```
颜色:       surface-container-high (亮) / surface-container-high (暗)
形状:       与真实内容一致（圆形、圆角矩形）
动画:       shimmer, 从左到右 1.5s 循环
             mask-image: linear-gradient(90deg, transparent, black 50%, transparent)
             animation: shimmer 1.5s infinite
显示时机:   加载超过 100ms 才显示；小于 100ms 不显示避免闪
```

### 9.12 EmptyState

```
布局: flex column, items-center, gap 12px, padding 32px
图标: 48-64px, on-surface-variant/60%
主文字: Body Large, on-surface-variant
副文字: Body Medium, on-surface-variant/70%
操作: Button Outlined（可选，引导下一步）
```

### 9.13 Switch / Toggle

```
容器: 44px × 26px, 圆角 full
滑块: 22×22px 圆形，white，elevation-1
开:   primary 底 + 滑块右 translateX(18px)
关:   outline 底 + 滑块左 translateX(2px)
过渡: 200ms standard
禁用: opacity 40%
Loading: 滑块内嵌 Spinner 12px
```

### 9.14 Slider

```
轨道:      4px 高, 圆角 full
已选段:    primary
未选段:    outline-variant
滑块:      20×20px 圆形, white, primary 2px 边, elevation-2
悬浮:      滑块外扩 24px 半透明 halo
拖动:      halo 32px + Tooltip 显示当前值
步进/连续: 支持
键盘:      左右方向键 ±step, Home/End 到端点
```

### 9.15 Checkbox / Radio

```
Checkbox:
  18×18px, 圆角 4px
  默认: outline-variant 2px 描边
  选中: primary 背景 + 白 Check 12px
  半选: primary 背景 + 白 Minus 12px

Radio:
  20×20px 圆形，2px 描边
  默认: outline-variant
  选中: primary 描边 + 内 10px primary 圆点
```

### 9.16 Segmented Control（分段控制器）

```
容器:      surface-container-low 底, 圆角 12px, padding 4px
项:        高 32px, padding 12px, 圆角 8px
默认:      transparent
选中:      surface 白底 + elevation-1
文字:      Label Large
动画:      选中态 sliding indicator, 250ms standard
```

### 9.17 CommandPalette（命令面板，新增）

`Cmd/Ctrl + K` 触发的全局命令面板，是元聊超越竞品的关键组件。详见 `02_MAIN_INTERFACE.md`。

---

## 十、装饰效果与视觉资产（Decorative & Assets）

### 10.1 Aurora 认证背景

三层结构，`pointer-events: none`：

```
Layer 1 — 页面渐变:
  linear-gradient(180deg, #F0F7FF 0%, #E8F4FD 40%, #E0F0FA 100%)

Layer 2 — Aurora 光球 (3个):
  filter: blur(80px), opacity 40%
  animation: auroraFloat 12-18s ease-in-out infinite

Layer 3 — 微尘网格:
  radial-gradient 点阵 32×32px, primary/6%
  mask-image: radial-gradient(ellipse, black, transparent 70%)

Layer 4 — 流光扫描（可选）:
  linear-gradient 120° 淡光带，10s 循环

Layer 5 — 鼠标跟随光晕（仅桌面 hover 设备）:
  400×400px radial-gradient primary/8%, position fixed
```

### 10.2 空态插画（Empty State Illustration）

- 风格：**线性 + 单色描边**，与图标系统一致
- 主色：`on-surface-variant/40%`
- 尺寸：128×128px（常规）/ 200×200px（欢迎）
- 主题：轻拟人（信封、气泡、星芒），不用具象角色
- 交付：SVG 单文件，通过 `?react` 导入

### 10.3 装饰性动画元素

- Aurora 光晕（认证）
- 消息气泡入场（Y 轴 4px 上移）
- 已读双勾点亮（左右分别 200ms 描边动画）
- 表情反应弹跳（bounce 300ms）
- 打字指示器（三点 pulse 1.2s 循环）

---

## 十一、Motion 动效系统（Motion System）

### 11.1 动效原则（Motion Principles）

| 原则       | 说明                                            |
| ---------- | ----------------------------------------------- |
| **有意义** | 每个动效必须回答"你从哪来、去哪里、和谁相关"    |
| **可跳过** | 遵守 `prefers-reduced-motion`，完全跳过装饰动画 |
| **快**     | 用户操作反馈 ≤ 100ms，界面切换 ≤ 300ms          |
| **不阻塞** | 动效期间输入依然可交互                          |
| **物理感** | 曲线基于弹性/惯性感知，不用线性                 |

### 11.2 曲线（Easing）

| 名称       | Bezier                                   | 用途           |
| ---------- | ---------------------------------------- | -------------- |
| standard   | `cubic-bezier(0.2, 0, 0, 1.0)`           | 通用变化       |
| decelerate | `cubic-bezier(0.05, 0.7, 0.1, 1.0)`      | 进入动画       |
| accelerate | `cubic-bezier(0.3, 0.0, 0.8, 0.15)`      | 退出动画       |
| emphasized | `cubic-bezier(0.2, 0, 0, 1.0)`           | 强调变化       |
| bounce     | `cubic-bezier(0.68, -0.55, 0.265, 1.55)` | Reactions 弹跳 |

### 11.3 时长（Duration）

| 场景             | 时长   | 曲线        |
| ---------------- | ------ | ----------- |
| 色变、Focus      | 100ms  | standard    |
| Hover、图标切换  | 200ms  | standard    |
| Toggle、Chip     | 200ms  | standard    |
| Modal 进入       | 250ms  | decelerate  |
| Modal 退出       | 200ms  | accelerate  |
| BottomSheet 进入 | 350ms  | decelerate  |
| 路由切换         | 300ms  | emphasized  |
| 消息气泡入场     | 200ms  | decelerate  |
| Toast 进入       | 250ms  | decelerate  |
| Skeleton shimmer | 1500ms | linear      |
| Aurora 光球      | 12-18s | ease-in-out |

### 11.4 Haptic Feedback（触觉反馈，移动端）

| 场景         | Impact                 | 时长 |
| ------------ | ---------------------- | ---- |
| 点击主按钮   | light                  | 10ms |
| 消息发送成功 | light                  | 10ms |
| 消息反应触发 | medium                 | 20ms |
| 长按打开菜单 | medium                 | 30ms |
| 消息撤回     | heavy                  | 40ms |
| 语音开始录制 | medium                 | 20ms |
| 语音超时警告 | notification (warning) | —    |
| 收到 @提及   | notification (success) | —    |

---

## 十二、可访问性（Accessibility, A11y）

WCAG 2.1 Level AA 全面达标；关键操作达 AAA。

### 12.1 感知（Perceivable）

| 检查项                      | 标准                                           |
| --------------------------- | ---------------------------------------------- |
| 正文对比度                  | ≥ 4.5:1（AA）/ ≥ 7:1（AAA）                    |
| 大字（≥19px 或 ≥14px+bold） | ≥ 3:1                                          |
| UI 组件 / 图标              | ≥ 3:1                                          |
| 焦点环                      | 与背景对比 ≥ 3:1，宽度 ≥ 2px                   |
| 图像替代                    | 所有装饰图 `alt=""`，功能图必须写 alt          |
| 颜色独立                    | 不能仅用颜色传达信息（辅以图标 / 文字 / 位置） |

### 12.2 可操作（Operable）

| 检查项      | 标准                                              |
| ----------- | ------------------------------------------------- |
| 触摸目标    | ≥ 44×44px（移动）；≥ 32×32px（桌面）              |
| Focus 顺序  | 遵循视觉阅读顺序                                  |
| Focus 可见  | 所有可交互元素在 `:focus-visible` 时显示焦点环    |
| 快捷键      | 全站键盘可达；提供快捷键帮助面板（`?` 键）        |
| 时间限制    | 提供延长选项（如 OTP 倒计时可重发）               |
| Motion 减弱 | `prefers-reduced-motion: reduce` 关闭所有装饰动画 |

### 12.3 可理解（Understandable）

| 检查项   | 标准                                                                           |
| -------- | ------------------------------------------------------------------------------ |
| 语言     | `<html lang="zh-CN">` 随 i18n 切换                                             |
| 一致性   | 相同功能在不同页面视觉与位置一致                                               |
| 错误提示 | 就地显示 + `aria-live="polite"`，语言明确（"手机号需 11 位"而不是 "格式错误"） |
| Labels   | 所有 input 关联 label 或 `aria-label`                                          |

### 12.4 稳健（Robust）

| 检查项      | 标准                                                                  |
| ----------- | --------------------------------------------------------------------- |
| ARIA 角色   | 自定义组件按 W3C ARIA Authoring Practices 实现                        |
| 屏幕阅读器  | 通过 VoiceOver（macOS/iOS）、TalkBack（Android）、NVDA（Windows）测试 |
| Live Region | 新消息到达 → `aria-live="polite"`，紧急通知 → `assertive`             |
| 键盘陷阱    | Modal / Popover 使用 focus trap                                       |

### 12.5 键盘完整地图（Full Keyboard Map）

见 `06_PLATFORM_ADAPTATION.md#键盘快捷键`。

---

## 十三、设计令牌命名规范（Design Tokens）

采用 W3C Design Tokens Community Group 语义命名法。

### 13.1 命名结构

```
{category}-{subcategory}-{variant}-{state}
例:
  color-primary
  color-primary-container
  color-on-primary
  color-surface-container-high
  space-4
  radius-md
  elevation-3
  duration-standard
  easing-decelerate
```

### 13.2 分类

| 类别        | 例                                                        |
| ----------- | --------------------------------------------------------- |
| color       | `color-primary`, `color-error`, `color-online`            |
| space       | `space-0.5` ~ `space-16`                                  |
| radius      | `radius-none/xs/sm/md/lg/xl/full`                         |
| elevation   | `elevation-0` ~ `elevation-5`                             |
| duration    | `duration-fast/standard/slow` (100/200/350ms)             |
| easing      | `easing-standard/decelerate/accelerate/emphasized/bounce` |
| font-size   | `font-body-lg`, `font-title-lg`, `font-headline-lg`       |
| font-weight | `font-regular/medium/semibold/bold` (400/500/600/700)     |
| line-height | `leading-tight/normal/relaxed` (1.25/1.5/1.75)            |
| z-index     | `z-base` ~ `z-titlebar`                                   |

### 13.3 Figma / OpenDesign 映射

- Figma Variable Collection 命名与 CSS Token 完全对应
- Figma Component 命名使用 PascalCase：`Button/Filled/Default`, `Avatar/Md/Online`
- Auto Layout gap 使用 `space-*` 引用

---

## 十四、插画与空态视觉（Illustration Style）

### 14.1 风格准则

- **线性 + 极简**：只用 1.5px 单色描边
- **限定色板**：Primary、On Surface Variant，最多两色
- **几何优先**：圆、圆角矩形、简洁曲线；避免复杂纹理
- **人物匿名**：不出现具象人脸，用抽象符号（气泡、光晕、信封）
- **可缩放**：任何尺寸下清晰

### 14.2 空态使用矩阵

| 场景       | 主图                | 主文字             | 副文字                   | CTA        |
| ---------- | ------------------- | ------------------ | ------------------------ | ---------- |
| 无会话     | 消息气泡 + 光芒     | 开始你的第一次对话 | 从通讯录里找到朋友       | 前往通讯录 |
| 无好友     | 人形 + 星芒         | 通讯录空空如也     | 添加第一个朋友或扫码加入 | 加好友     |
| 无消息记录 | 时钟 + 波纹         | 还没有消息         | 发送第一句问候           | —          |
| 搜索无结果 | 放大镜 + 问号       | 未找到相关内容     | 换个关键词试试           | —          |
| 无网络     | Wi-Fi 断线 + 感叹号 | 无法连接到服务器   | 检查网络后重试           | 重试       |
| 无媒体     | 相片框 + 光斑       | 暂无媒体文件       | 发送后自动归档到这里     | —          |
| 404        | 破碎气泡            | 页面走丢了         | 我们把你送回主页         | 返回主页   |
| 500        | 齿轮 + 感叹号       | 服务开小差         | 稍后再试或联系客服       | 反馈问题   |

---

## 十五、内容与文案原则（Content Voice）

### 15.1 语气

- **平实**：像同事说话，不用官话套话
- **准确**：不用暧昧词（"可能"、"或许"），直接说
- **温和**：错误提示不指责用户（❌"你的密码错误" → ✅"密码不正确，请重试"）

### 15.2 关键文案库（Copy Library）

| 场景     | 中文                      | 英文                            |
| -------- | ------------------------- | ------------------------------- |
| 主 CTA   | 登录 / 注册 / 保存 / 发送 | Sign in / Sign up / Save / Send |
| 次 CTA   | 取消 / 返回               | Cancel / Back                   |
| 危险确认 | 确认删除                  | Delete                          |
| 加载中   | 加载中…                   | Loading…                        |
| 保存中   | 保存中…                   | Saving…                         |
| 网络断开 | 网络已断开，正在尝试重连… | You're offline. Reconnecting…   |
| 重连成功 | 已重新连接                | Back online                     |
| 无网络   | 无法连接到网络            | No internet connection          |
| 发送失败 | 发送失败，点按重试        | Send failed. Tap to retry       |
| 撤回消息 | 消息已撤回                | Message unsent                  |
| 已读     | 已读                      | Read                            |
| 送达     | 已送达                    | Delivered                       |
| 输入中   | 对方正在输入…             | Typing…                         |
| 空态     | 见 §14.2                  |                                 |

### 15.3 数字与时间

| 场景       | 格式                                                |
| ---------- | --------------------------------------------------- |
| 会话时间戳 | 今天 14:30 / 昨天 09:12 / 周三 / 06-29 / 2025-06-29 |
| 消息时间戳 | 14:30（24 小时制默认，可切换 12 小时）              |
| 相对时间   | 刚刚 / 3 分钟前 / 1 小时前 / 昨天                   |
| 未读数     | 1-99 / 99+                                          |
| 文件大小   | 1.2 KB / 3.4 MB / 1.2 GB                            |
| 时长       | 0:12 / 1:23 / 10:23 / 1:23:45                       |
| 语音时长   | 0'12"                                               |

---

## 十六、变更日志（Changelog）

| 版本     | 日期           | 变更摘要                                                                                                                                       |
| -------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| v1.0     | 2026-06-29     | 初版设计规范                                                                                                                                   |
| **v1.1** | **2026-07-06** | 新增设计哲学、竞品差异化、Motion Principles、A11y 详规、Design Tokens 命名、Density Modes、CommandPalette、Empty State 插画风格、Content Voice |

---

> **实现映射**：本文档所述的所有 Token 在代码侧对应 `packages/design-system/src/tokens/`；组件对应 `packages/design-system/src/components/`。设计与实现必须双向同步。
