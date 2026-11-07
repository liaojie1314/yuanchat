# 桌面托盘 / 命令面板 / OTA 分发 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在一个分支上交付六条工作流 —— 手机号完全移除、应用内文件下载进度条、命令面板与搜索重做、桌面托盘与系统未读角标、自建 OTA 分发（含 Android 自动更新）、Web 端下载入口。

**Architecture:** 共用件先立后用。Stage B 的下载器（`downloadStore` + `fileSink` 注入抽象 + Rust `open_local_file`）被 Stage E 的 Android OTA 复用；Stage F 查询 catalog 后直接交浏览器下载安装包。Stage A（手机号移除）与其余工作流零耦合。前端新代码一律落在 `packages/shared` / `packages/ui` 的领域子目录里，三端 app 只做注入与接线。

**Tech Stack:** Go 1.25.7（Gin + GORM + goose 迁移）、PostgreSQL 16（`pg_trgm`）、React 19 + TypeScript + Zustand、Tauri 2.11.2（`@tauri-apps/api` 的 tray / window / image + `plugin-fs`）、react-i18next、Vitest、Playwright。

**Spec:** [`docs/superpowers/specs/2026-10-11-tray-palette-ota-design.md`](../specs/2026-10-11-tray-palette-ota-design.md)

## 执行进度

### 2026-11-07 功能核对与验收记录

MASTER_PLAN 已按证据勾选 K3/K12/K18/K19、手机号移除与 Web 客户端下载入口，清单只写
功能本身，验证结果与平台边界独立记录。O1 已完成 Android 模拟器真实安装验证并勾选，
对应系统安装证据、设备范围与夹具清理见下方记录。

2026-11-07 新增缺陷已有真实修复证据：

- `97ab133` 将原生文件读写 IPC 限制为单次 1 MiB。43,866,277 字节坏 SHA APK 完成
  下载、保存与读回后拒装并删除，应用保持运行，退出记录无新增 OOM；JS 仍保留完整文件
  缓冲，不能据此声称总内存恒定。
- `e0181c7` 在附件上传前保存原生副本、IDB 草稿与原 MIME；未上传草稿 `payload=null`
  不自动发 WS。Android force-stop 后恢复失败文件气泡和 `image/png` MIME，点重试收到
  `seq=19` 的真实 ACK，该出站行与原生副本均清空。
- 证据在本地 `final-acceptance-20261107/`：`ota-bad-sha-green.json`、
  `ota-exit-info-{before,after}.txt`、`outbox-green-{before,after-restart,ack}.json`。
- `95f0b95` 的普通附件 MIME 修订已验证：重启后已有 PNG 下载由 Google Photos 打开，
  原生 Intent 为 `image/png`、`content://` FileProvider URI，临时 `readUriPermissions`
  存在。同目录 `android-file-open-green.xml`、`android-file-open-green-activities.txt`
  和 `android-file-open-check.py`（assert PASS）记录结果。
- 合法 OTA 安装已验证：在首处系统未知来源安装提示点 Cancel 后回到应用，仍显示
  0.6.0 与“已打开系统安装器；若取消安装，可再次点击更新。”；再次立即更新、允许本应用
  来源后，由系统安装器完成升级。取消证据只包含首处未知来源提示，不含第二处安装确认取消。
  `package-after-upgrade.txt` 记录 0.6.1 / versionCode 6001、安装器
  `com.google.android.packageinstaller`、来源 `com.yuanchat.desktop.debug`、更新时间
  2026-11-07 01:31:15；`exit-info-after-upgrade.txt` 为 `PACKAGE UPDATED`，无新增 OOM。
  重开运行打包资源 `assets/index-Cd-MyGbC.js`，`ota-installed-about.xml/txt` 显示 0.6.1
  且再次检查为“已是最新版本”。首处取消后的应用状态见 `ota-permission-cancel.xml`。
- 目标 APK 为同 debug 签名、43,866,277 字节，SHA-256 为
  `a83eed0f10d19147f7d957930bf20b47b8547c2d9176f107dc0b1979d14ebb56`。设备是 Android 35 /
  x86_64 模拟器，更新目录使用 `android/aarch64` 测试槽，不证明 ARM 实机通过。
  Windows/macOS 无硬件验证；测试版本不算正式发版，设备范围不作为产品技术债。
- 统一证据索引为 `final-acceptance-20261107/native-acceptance.json`。五条本地 QA release
  已全部 rolled_back（含旧 0.99.0 Android 和 0.8.1-test.1 Linux），0.6.0 查询返回 204，
  两个本轮 MinIO APK 对象已删除；模拟器恢复 0.6.0 / 6000、关闭来源安装权限后停机。
  本轮 APK 与生成 icon 已清理，编译缓存保留；用户 `/home/liaojie1314/test` 未修改。
- `03cd4cb` 修复托盘唤回绕过会话列表清未读的问题，`tray.activate` 复用共享
  `clearUnread`；菜单/左键新增 2 项回归与原 9 项共 11 项通过，全包类型门禁通过。
  最新源码完整重启后未再修改源文件：记住最小化选择跨重启保持，隐藏时收取真实
  `seq=22` 消息，托盘未读 1、Unity `count=1`；实际“打开”菜单唤回目标会话后，
  托盘无未读、Unity `count=0/count-visible=false`，REST 回读
  `my_last_read_seq=22/unread_count=0`。托盘退出移除原生进程和 SNI 项。
  `final-acceptance-20261107/linux-acceptance.json` 索引所有关联证据；本机
  GNOME/libayatana 无 Activate 方法，因此原生实测覆盖菜单唤回，左键路径由回归验证。
  本次未把 HMR 运行状态作为验收，也不外推 Windows/macOS 或 dev/远端 CI 结果。

用户已明确授权：完成验收与文档后合入 `dev`，在 `dev` 执行完整本地 CI，全绿后推送远端
`dev` 并确认远端 CI，无需再次询问。`main`、tag 和正式发版不在本次授权范围。

**Git 与 CI 记录**：文档与截图提交为 `ea127b8`，追加修复提交见上方验证条目。合并、
`dev` 完整本地 CI 和远端 CI 以对应提交和独立运行记录登记；下方 2026-11-06 的 feature
测试数只作为历史证据，不代表后续提交或分支门禁已通过。

用户追加的小改进只在 MASTER_PLAN“未做清单总览”按等级登记，不进入核心功能清单，
本次不实施。当前切目录只影响后续下载，旧文件保留原位，Android SAF 另存为仍未实现。

### 2026-11-06 已验证快照：截图、修复与本地检查

用户已确认文件下载实测没有问题，本轮沿用该验证结果；核心页面截图、已知问题修复与
本地检查已完成。已有本地提交 `3d09993`（文档与此前六张新图）、
`7afdb27`（部署）、`b555894`（后端）、`dba9be6`（同步视口高度）及 `7d8e72c`（原生 IME
动画）及 `a21c63d`（其余客户端修订）；本轮源码已完整提交，手机核心页面图已齐。

- 桌面全局 Ctrl/Cmd+K 命令面板在主窗口内弹出，仅会话内搜索开独立窗口；手机仍走
  `/search`，Web 大屏使用弹窗。本文下方原任务代码与旧进度仅作历史记录，以本段和 spec
  §1.2 / §4.4 的最新入口分工为准。
- 通用设置中的搜索快捷键仅非手机布局展示，复用 `isMobile` 隐藏手机入口，桌面/平板
  保留，手机隐藏及桌面保留回归 10 / 10 通过，已保存组合不变。手机入口副文案四语使用
  `settings.generalDescMobile`（中文「外观与下载」），桌面原描述保留。
- fresh Linux Tauri 已复核暗色首次开会话搜索、已有窗 light/dark 同步、全窗背景和
  会话范围切换；相关回归 19 / 19 通过。移除临时诊断后再次完整重启并确认主题正常。
  上轮主题异常未复现；HMR 曾未重新执行已挂载 effect，只能作为候选原因，不能认定
  历史根因。证据在本地 `.superpowers/sdd/2026-10-11-tray-palette-ota/theme-fix-20261106/REPORT.md`。
- 桌面下载目录选择/持久化/恢复默认、打开所在文件夹已落地；用户已选择本机 `test`
  目录并确认下载实测通过。Web 授权目录提供单“关闭”按钮的查看位置弹窗，默认浏览器
  下载因无法获知位置仍可重复下载。完成记录按账号/服务端持久化，按实际路径与 SHA-256
  保留历史候选：内容修改或原路径丢失可重下，切回旧目录可复用内容一致的副本；不追踪
  任意重命名，不删除用户修改的文件。本轮未重复用户已确认的下载破坏性用例，也未新增
  Android SAF 或公共目录另存功能。
- README 保留既有图片，统一同端展示宽度与原始比例，已加入 Web 命令面板/通用设置/
  文件下载/客户端下载、管理端版本分发及 Linux 会话内搜索图。最新桌面通用设置、
  文件下载结果、主窗命令面板三张 1200×800 真图已加入 README；Android 搜索与通用设置
  两张 1080×2400 核心页面图已定稿并加入，按 240px 与既有手机图等宽展示。通用设置图仅有
  主题、语言与下载目录，无快捷键。保存位置等小弹窗不单独作为展示截图。
- Android 35 模拟器真实链路已验证：全局搜索结果进入目标聊天且文件消息可见；
  「更多 → 搜索聊天记录」进入带正确 `conversation_id` 的独立路由，返回链路和通用设置
  正常；命令「检查更新」自动触发并消费 `checkUpdate=1`，本机测试版本 `0.99.0` 出现。
  该结果仅证明更新检查入口，本轮未重跑最新 APK 的 OTA 下载/安装流程，不声称升级已验。
- Android 切页/键盘闪动追加修复：共享视口 resize 同步写高度，设置首屏按断点与
  `section=about` 初始化；15 项回归通过，Profiler 错误 profile 首挂由 1 次降为 0。
  初轮真实 JS 4 次开合、8 次 resize 的滞后帧由 8 降为 0，3600 帧高度同步。
  原生 `WindowInsetsAnimationCompat` 阻止提前应用终态 padding 并跟随 IME 动画，
  新 `pnpm dev:android` 构建并安装后覆盖 4 轮正常开合及 2 轮 150ms 中断：144 次 resize、
  3595 个 rAF 帧高度差为 0；原生录屏实际解码 325 帧，下部纯白帧为 0（修复前 4 轮、
  186 帧中有 8 帧），抽帧目视确认旧整块白区消失。范围限本机 Android 35 模拟器。
  本地证据位于 `android/qa-20261105/` 的 `native-layout-after-20261106.json`、
  `native-insets-{before,after}-20261106.json/mp4`。
- 手机快捷键隐藏修订后重跑 `LANG=C.UTF-8 pnpm test`：148 文件、1368 测试全通过；
  原生目录 3 项 Rust 测试也通过。Go vet、全量 atomic 覆盖率测试、40% 门禁
  （49.58%，3440/6938）与 WS race 均 exit 0；coverage 模式 146 文件、1358 测试通过。
  随后仅调整手机入口副文案，`pnpm check`、i18n 888 keys、相关 UI 11 项及全 6 包类型检查
  通过；palette 夹具补齐 `shortId` 后 40 项测试通过。最终 Chromium E2E 119 / 119
  全绿，耗时 3.7 分钟、无重试；运行环境与模拟器均已关闭，开发端口已清。
- 本轮工作已收口，不等于整套正式发版验收完成：最新 APK 的完整 OTA 安装本轮未重跑，
  Windows/macOS 无实机验收，SAF 另存为未实现。未合并、推送、打 tag 或发版；后续合
  `dev` 的授权已于 2026-11-07 更新，以上方当前状态为准。

### 2026-11-05 历史暂停快照

用户最新确认：**桌面全局命令面板使用主窗口内弹窗，只有会话内搜索使用独立窗口**；
手机继续使用 `/search` 路由。该约定覆盖下文旧版「全局/会话内都开桌面独立窗口」描述。
入口修订已经落地，相关 31 项回归通过，Linux Ctrl+K 已确认主窗口内弹窗。

搜索子窗口的主题同步**仍未完成**：已尝试通过现有范围事件同步 `skinId`，并把宿主
改为 `app-screen` 铺满窗口；19 项桥接回归通过，但用户随后真实截图仍显示主窗暗色、
搜索窗亮色。不得凭单测标记修复，恢复后优先复现并检查真实跨窗口同步链路。

本轮已按用户要求关停开发链路并保留未提交改动。`.playwright-cli/` 已加入 `.gitignore`；
README 同端截图等宽及新增截图、Linux/Android 剩余验收、最终 CI 与文档一致性仍待完成。
未提交、合并、推送、打 tag 或发版；合 `dev` 仍须当次确认。

### 2026-11-05 此前状态（历史验收快照）

分支仍为 `feature/tray-palette-ota`；下方旧日期的进度、测试数与暂停清单仅是当时快照。
本段记录 2026-11-05 当时修订，原任务步骤与代码示例保留，不逐条补勾。

- 设置分组已按用户追加意见调整：移除独立「文件下载」导航，「外观」改为「通用设置」，
  主题、语言、下载目录、搜索快捷键同页；目录卡复用 `Button`，显示目录名与授权状态，四语同步。
- 全局/会话内搜索均已接三端承载：桌面独立窗口、手机 `/search` 路由页、Web 大屏弹窗；
  旧会话内条已删除。独立窗口切范围、登出/换号清理与旧账号迟到导航拒绝已补回归；
  IME Enter 选字不触发结果。
- Web 默认目录通过 File System Access API 与独立 IDB 保存授权句柄，Web Locks 避让
  同名，写入并 close 后才完成。无目录/不支持时保留浏览器保存；权限失效提示到
  「设置 → 通用设置 → 文件下载」重新授权。等待 IDB 期间取消也不会落回 `<a download>`。
- Web 部分真实验收已完成：用户在 Chrome 原生目录框手动完成首次授权，确认附件保存到
  所选 `test` 目录，刷新后目录持久化已验证。随后确认进度条显隐会推动下方消息；固定
  进度空间的修复与全状态回归正在进行，尚不能声明零 CLS。真实 RED：同一文件消息列
  高度 `85.75 → 117.25 → 85.75 px`，出现/取消进度时位移 `31.5 px`；GREEN 待回填。
- 托盘异步同步已加代次，拒绝图标/菜单迟到结果回写旧未读数；Android「检查更新」已消费
  `checkUpdate=1` 并自动检查，沿用忙碌锁防重入。回归证据在工作目录的
  `frontend-review-20261105/REPORT.md`，不代替原生验收。
- 已跑通一次覆盖率、i18n、Web/桌面/管理端 tsc 与新增回归；覆盖率早于后续修复，本轮真实 Web/Linux/Android
  验收、完整 Chromium E2E 与最终 CI **仍在进行**，最终数值、日志与 README 图清单待回填。
  CI E2E 须新启 MSW 实例，不能复用真实 `:5173`；每次切端先停前一条 dev 链路。
- 本批尚未完成。收尾仍需汇总真实验收和截图、清理临时测试产物与 coverage provider 改动，
  再做完整工作点的 Conventional Commit。全绿后须当次询问合 `dev`；尚未合并、推送、
  合 `main`、打 tag 或发版，Windows/macOS 不宣称真机通过。

### 历史进度快照（2026-10-14）

截至 2026-10-14，分支 `feature/tray-palette-ota`。工作区干净，本地已验：
`go vet ./...` / `go build ./...` / `node scripts/check-i18n.mjs`（803 key × 4 语）全绿，
OTA 与搜索相关的 service / handler / repository 测试全绿。

| Task | 状态      | Commit                                                                 |
| ---- | --------- | ---------------------------------------------------------------------- |
| 1    | ✅        | `37225ea` + `5ecb922` + `1a33f81`（研究文档，另见下方「Task 1 结论」） |
| 2    | ✅        | `352f7c8`                                                              |
| 3    | ✅        | `6af4fe1`                                                              |
| 9    | ✅        | `10826ff`                                                              |
| 10   | ✅        | `dddf29c`                                                              |
| 16   | ✅        | `90e1fcf`                                                              |
| 17   | ✅        | `cd218de`                                                              |
| 18   | ✅        | `e3d9fb2`                                                              |
| 其余 | ⬜ 未开始 | Task 4-8、11-15、19-21                                                 |

另有 `200ed6c`：预先画好 Task 14 要用的 Windows 叠加角标红点图标
（`icons/badge-dot-16.png` / `badge-dot-32.png`）。

**下次从 Task 4 继续**（Stage B 应用内下载），前端系列为 Task 4-8、11-15、19-20，
收口为 Task 21。

### 2026-11-02 审查后继续执行

旧进度表是 2026-10-14 的快照，不代表当前实现状态；六条工作流已有实现，当前在同一 feature 分支补缺陷与验收，不重复搭建。

- [x] 下载/落盘回归：并发同名与超过一百份不覆盖；写盘取消后清理产物；file/image/voice 副本完成后才发帧。新增 6 个回归先 RED 后 GREEN，整套前端测试 1195 项通过。
- [x] 命令面板回归：导航关闭、建群入口、旧请求作废、本地数据异步到达后的刷新。建群复用 ChatScreen 的 CreateGroupModal，导航指令改为 `/chat?new=group`，关闭时消费 query；跨窗口桥与测试同步维护。
- [x] 自定义搜索快捷键与持久化、保留键/冲突提示（仅搜索组合，不宣称完整 J3）。
- [x] OTA/后端审查问题与 Web 推荐架构修复，补回归；Go vet/test/coverage/race 已独立通过。
- [x] Windows 窗口尺寸/右侧白边代码适配与策略/资源测试；Win/macOS 无实机，未声明真机通过。
- [ ] 全量本地 CI、真实后端与设备验收、文档/README 截图收尾。

### 2026-11-03 用户反馈补齐（历史快照）

- [x] 下载推荐改紧凑行，四个平台完整列出，无包标不可用；固定高度与内部滚动；真实后端浏览器 RED→GREEN 和完整前端回归通过。
- [ ] 搜索全局与会话内统一承载：桌面独立原生窗口、手机独立路由页、Web 桌面弹窗；当前旧会话内条不能算完成。
- [ ] 完整 CI 最终复跑、Linux 桌面与 Android 实测，以及文档/README 真图收尾。

Web 默认目录已补浏览器授权流程，详见下方暂停记录；支持的浏览器直接写入所选目录，未设置目录或不支持时使用浏览器保存方式。真实浏览器验收尚未完成。

E2EE 本地安全存储只登记到 MASTER_PLAN，尚未修复，不纳入本次产品重构。合 dev、推送、合 main、tag/发版仍须当次征询；当前没有执行这些操作。

### 2026-11-05 用户要求暂停：历史续接检查点

用户明确要求「先停止，明天继续」。子 agent 已停止，`pnpm dev:stop` 已完成；开发端口和应用进程已清零。既有本机 registry 与全局 Claude 转发服务保留。分支仍为 `feature/tray-palette-ota`，HEAD `26517f2`；遗留改动与本次改动均保留，尚未提交、合并、推送或发版。

原 Claude 会话为 `/home/liaojie1314/.claude/projects/-home-liaojie1314-code-project-yuanchat/1c9ed62d-a180-4a62-88dd-21065cafa14b.jsonl`；记忆在同目录 `memory/`。方案已确认，无需重做 brainstorming；继续遵守本计划 Global Constraints 及用户后续修订。

- [x] Web 默认目录实现与回归：`packages/shared/src/download/browserDirectory.ts` 持久化授权句柄；`fileSink.ts` 直接写盘、Web Locks 避让同名、关闭后完成、写盘失败或取消清理；授权失效明确提示重新授权。设置页新增「文件下载」，可选择、重新授权和恢复默认；四语齐全。原生端继续直接保存默认目录。
- [x] `LANG=C.UTF-8 pnpm test`：1294 项通过，8 个 Turbo 任务成功；日志 `.superpowers/sdd/2026-10-11-tray-palette-ota/codex-frontend-test.log`。目录保存与权限撤销等回归已确认 RED→GREEN；不据此替代浏览器/设备实测。
- [x] i18n 门禁通过（882 keys）；Web 类型检查已通过，但其后还有极小错误分支调整，最终类型检查仍需复跑。
- [x] 后端补齐软删作用域：解散会话不可搜，软删消息或会话撤销媒体签名授权；GC 仍保留版本包引用。OTA 登记拒绝非法 SemVer，返回 400 且不落库，保留短版本/v 前缀兼容。`go.mod` 无意外降级，仅新增现有依赖图版本 `x/mod v0.37.0`。
- [x] 后端完整 CI：build/vet、完整 atomic coverage 测试、40% 覆盖率门禁（实际 49.53%）、WS race、部署脚本自检均退出 0；737 项执行，736 项通过，唯一 SMTP live 用例缺外部凭据跳过，PG/MinIO 用例均实际执行。日志在 `.superpowers/sdd/2026-10-11-tray-palette-ota/codex-backend-20261104/`；隔离 Go 根为 `/home/liaojie1314/env/go-ci-1.25.7.JZqu3p`，运行必须同时设置 PATH/GOROOT/GOPATH，避免 covdata 子进程找不到 go。
- [x] Claude API 400 的本机恢复层已修并重载：仅上游明确拒绝 Azure 资源绑定推理项且尚未交付内容时，清理本次请求副本中的绑定推理块后重试一次。32 项离线测试及语法检查通过；未发付费模型探针。代码与恢复文档在 `/home/liaojie1314/env/claude-api-retry/`，全局地址保护仍为 15722。
- [x] Playwright CLI 已安装在 `/home/liaojie1314/env/playwright-cli/npm-cache`，帮助输出在工作日志 `playwright-cli-help.log`；尚未启动真实浏览器验收。
- [x] Android 工具预检完成：AVD `Medium_Phone`、Android 35/x86_64、1080×2400、KVM、JDK17/NDK29/Gradle/Rust targets 可用；尚未启动模拟器。证据捕获脚本在工作目录 `android/capture.py`。旧 OTA 夹具 `android/ota-fixture.apk` 已核 SHA256 与 debug 签名，但登记 0.99.0、包内实际 0.6.0，只能证明下载/校验/安装器取消重试，不能声称版本升级成功。

暂停时留下的续接清单（进展以上方「当前状态」为准）：

1. 用真实后端与 Playwright CLI 验证 Web 目录首次授权、刷新持久化、写盘进度、同名避让、取消及权限失效；补对应可复跑浏览器回归。
2. 完成全局/会话内搜索、快捷键、下载入口的真实 Web 验收，再依次 Linux Tauri 与 Android 模拟器验收搜索/下载/打开/OTA；切端必须先停前一条 dev 链路。无 Windows/macOS 硬件，不能标真机通过。
3. 完成被暂停的前端/桌面整体只读 review；可复用 `/root/backend_gate`，Android 可复用 `/root/relay_recovery`，最多两个子 agent，避免重复实施。
4. 完成剩余本地 CI：coverage、最终各端 tsc、完整 Playwright Chromium E2E。CI E2E 必须新起 MSW 实例，不能复用真实 5173。根 `package.json`/`pnpm-lock.yaml` 仍有此前临时 coverage provider 改动，跑完后仅撤回这部分，不覆盖其他工作。
5. 同步 spec/MASTER_PLAN/ARCHITECTURE/DEVELOPMENT/CHAT_API/README 等文档与真实截图，清理测试产物，再完成完整工作点的 Conventional Commit。全绿后按用户要求当次询问合 dev；不可自动 merge/push/tag/release。

当前任务尚未完成，真实三端验收、最终前端 CI 与文档收尾均未结束。

### Task 1 结论对后续任务的修正（务必先读研究文档）

[`docs/superpowers/research/2026-10-11-android-fileprovider-preflight.md`](../research/2026-10-11-android-fileprovider-preflight.md)

- **Task 6**：`capabilities/desktop.json` **也**要加 fs 落盘权限（`fs:default` 是只读的，
  本计划原先只写了 `mobile.json`，是疏漏）；`gen/android` 的清单与 `file_paths.xml`
  都已被 git 跟踪，直接改即可；需补 `REQUEST_INSTALL_PACKAGES` 权限。
- **Task 14**：`Cargo.toml` 的 tauri features 要加 **`image-png`**，否则 Windows
  `setOverlayIcon` 运行时失败。角标按平台分支：`setBadgeCount` Windows 不支持、
  `setBadgeLabel` 仅 macOS、`setOverlayIcon` 仅 Windows。
- **Task 19**：Android 的 `BaseDirectory.Download` 落在 app 私有外部存储
  （`Android/data/<pkg>/files/Download`），零权限但文件管理器不可见；
  updater 自建端点返 **204 会让它直接停下、不再试 GitHub 兜底**，
  只有 5xx 才回落。
- **Task 21**：`/usr/share/applications/yuanchat.desktop` 已安装，Linux 角标不必重打 `.deb`；
  安卓实测有现成 AVD `Medium_Phone`，不必连 USB。

## Global Constraints

- **分支**：`feature/tray-palette-ota`，自 `dev` 切出，完成后 `--no-ff` 合回 `dev`。禁止 squash。
- **Commit**：Conventional Commits `<type>(<scope>): <subject>`，subject 用中文。**禁止版本号前缀，禁止 `Co-Authored-By`**。一个 commit 装一个完整工作点，禁止逐点提交。
- **迁移号**：**021** 删 phone、**022** 文件名 trgm 索引、**023** `app_releases`。不得占用其他号。
- **i18n**：所有用户可见文案禁止硬编码，走 `useTranslation` / `t()`，并在 `packages/design-system/src/i18n/locales/` 的 **zh-CN / en-US / ja-JP / ko-KR 四份**同步补齐。插值占位符是 `%{var}`（Rails 风格），**不是** `{{var}}`。`node scripts/check-i18n.mjs` 是 CI 门禁。
- **WebView 兼容**：`vite.config.ts` 的 `build.target` 必须保持 `es2019`。新增 JS 语法/Web API 前确认目标 WebView 支持或已被转译。`navigator.userAgentData` 等新 API 必须有回落。
- **圆角上限 `rounded-lg`**（本仓 `lg` = 16px），禁用 `rounded-xl` / `rounded-2xl`。
- **rem 刻度**：html 根字号 **14px**，`rem` 刻度缩水 14/16。要精确 px 用方括号值（如 `h-[38px]`）。
- **注释**：全部用中文。所有导出函数/组件/Store/Hook 写 JSDoc，Go 导出函数/包写 godoc。关键并发/事务/错误分支必须注释。**先写注释再写代码。** 注释里禁止写进度/批次号。
- **骨架屏**：所有图片用 Skeleton 占位（固定宽高），列表加载有骨架屏，**CLS 必须为零**。
- **MSW**：所有前端 API 调用必须有 Mock 覆盖**正常/空/错误/加载**四种状态。
- **权限说明与操作入口应用内自绘**；Web 目录选择/重新授权与 Android 安装器使用平台安全流程，由用户动作触发。
- **Tauri 权限标识符禁猜**：从 `apps/desktop/src-tauri/gen/schemas/desktop-schema.json`（或 `mobile-schema.json`）核实，并按平台放进正确的 capability 文件。
- **源码目录禁平铺**：新增前端文件按领域放进子目录（`packages/shared/src/download/`、`packages/ui/src/palette/` 等）。
- **测试门禁**：测试未通过 = 功能未完成。不允许在未通过测试时开始下一个 Task。
- **测试禁止依赖宿主语言环境**：本地跑 `LANG=C.UTF-8 pnpm test` 对齐 CI runner。要固定语言就在 `vi.hoisted()` 里打 `navigator` 桩。
- **新增自定义请求头必须同步 CORS**：`server/internal/middleware/cors.go` 的 `Allow-Headers` 要逐个列出，浏览器预检不接受通配。
- **WS 帧演进**：新字段尾部追加指针 + `omitempty`；新增服务端帧必须同时登记进 `contracts/server-frames.golden.json` 与 `ws/golden_server_frames_test.go` 的 `payloadPrototypes`。（本批预期不新增 WS 帧，若新增则照此办。）
- **推送前本地 CI 全绿**（见 AGENTS 第 13 条及 Stage G，Task 21，含前后端覆盖率）。禁止「先推上去让 CI 跑」。

## Review Focus

本计划的任务测试覆盖了各自的正常路径，下面五条是 spec 隐含、但最可能真实咬到用户的输入类别。每条已在对应 Task 里补了钉住它的测试。

1. **搜索关键词含 SQL LIKE 通配符**（`%` / `_`）—— 现状 `message_repo.go:343` 直接拼 `"%"+query+"%"`，用户搜一个 `%` 就等于全表扫；Task 9 给检索条件加了文件名 `OR` 分支后，这个代价还要翻倍。期望行为：通配符按**字面量**搜。→ 测试在 **Task 9**。
2. **下载途中预签名 URL 过期或断网** —— 进度条会静默卡在某个百分比不动，用户分不清是慢还是坏了。期望行为：明确进 `failed` 态并给重试。→ 测试在 **Task 4**。
3. **同名文件重复下载** —— 静默覆盖用户已有的下载是不可逆的。期望行为：`文件名 (2).pdf` 递增。→ 测试在 **Task 5**。
4. **`setBadgeCount` 在不支持的平台抛错** —— Linux 未装 `.desktop` 时会抛，未捕获就会冒泡成 UI 错误；角标是增强，失败了应用必须照常用。期望行为：静默降级 + warn 日志。→ 测试在 **Task 14**。
5. **APK sha256 不匹配** —— 不校验就调安装器，等于把任意字节交给系统 PackageInstaller。期望行为：拒绝安装、删除已落盘文件、如实报错。→ 测试在 **Task 19**。

---

## File Structure

### 新建

| 路径                                                                     | 职责                                                 |
| ------------------------------------------------------------------------ | ---------------------------------------------------- |
| `server/internal/database/migrations/021_drop_user_phone.sql`            | 删 `users.phone` 与唯一索引                          |
| `server/internal/database/migrations/022_message_name_search_index.sql`  | `content->>'name'` 的 trgm GIN 索引                  |
| `server/internal/database/migrations/023_app_releases.sql`               | OTA 版本表                                           |
| `server/internal/model/release.go`                                       | `AppRelease` 模型                                    |
| `server/internal/repository/release_repo.go`                             | 版本表读写                                           |
| `server/internal/service/release_service.go`                             | 灰度判定 + 最新版查询 + 管理端写操作                 |
| `server/internal/handler/update.go`                                      | 对外两个端点（免鉴权）                               |
| `packages/shared/src/download/downloadStore.ts`                          | 下载进度 store（纯逻辑，三端共用）                   |
| `packages/shared/src/download/fileSink.ts`                               | 落盘抽象 + web 默认实现                              |
| `packages/shared/src/api/releases.ts`                                    | OTA 端点客户端                                       |
| `packages/shared/src/store/desktopStore.ts`                              | 桌面端偏好（关窗行为），`persist`                    |
| `packages/shared/src/store/selectors.ts`                                 | `selectTotalUnread` / `selectFirstUnreadId` 唯一来源 |
| `packages/ui/src/palette/CommandPalette.tsx`                             | 命令面板 + 搜索（取代 `SearchModal.tsx`）            |
| `packages/ui/src/palette/paletteActions.ts`                              | 快捷动作注册表                                       |
| `packages/ui/src/palette/CloseBehaviorDialog.tsx`                        | 关窗二选一弹窗                                       |
| `packages/ui/src/download/DownloadPanel.tsx`                             | Web 端下载页                                         |
| `packages/ui/src/chat/FileProgressBar.tsx`                               | 文件气泡下方进度条                                   |
| `apps/desktop/src/tray.ts`                                               | 托盘 + 角标接线                                      |
| `apps/desktop/src/fileSink.ts`                                           | `fileSink` 的 Tauri 实现                             |
| `apps/desktop/src/android/otaUpdater.ts`                                 | Android 自动更新流程                                 |
| `apps/desktop/src-tauri/src/local_file.rs`                               | `open_local_file` / `install_apk` 命令               |
| `apps/desktop/src-tauri/icons/badge-dot.png`                             | Windows overlay 红点（16×16 与 32×32）               |
| `apps/admin/src/pages/Releases.tsx`                                      | 管理端版本分发页                                     |
| `docs/superpowers/research/2026-10-11-android-fileprovider-preflight.md` | Task 1 的核实结论                                    |

### 修改

| 路径                                                                                                                                                                                                                                    | 改动                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `server/internal/model/user.go:13`                                                                                                                                                                                                      | 删 `Phone`                                                 |
| `server/internal/repository/user_repo.go:48-52,78-84`                                                                                                                                                                                   | 删 `FindByPhone`，`ExistsByPhoneOrEmail` → `ExistsByEmail` |
| `server/internal/repository/admin_repo.go:31`                                                                                                                                                                                           | 搜索去 phone                                               |
| `server/internal/repository/message_repo.go:313-355`                                                                                                                                                                                    | `Search` 加 `types`、加文件名条件、转义 LIKE 通配符        |
| `server/internal/service/user_service.go:24,143-144,180-181,262-274`                                                                                                                                                                    | 登录去手机号                                               |
| `server/internal/service/auth_service.go:91`                                                                                                                                                                                            | 只查邮箱                                                   |
| `server/internal/service/contact_service.go:81`                                                                                                                                                                                         | 好友搜索去手机号                                           |
| `server/internal/service/message_service.go`                                                                                                                                                                                            | `Search` 透传 `types`                                      |
| `server/internal/handler/auth.go:33-59`                                                                                                                                                                                                 | 删 `Phone` 兼容字段                                        |
| `server/internal/handler/user.go:285`                                                                                                                                                                                                   | 失真注释改写                                               |
| `server/internal/handler/message.go:387-435`                                                                                                                                                                                            | `types` 查询参数                                           |
| `server/internal/handler/admin.go`                                                                                                                                                                                                      | 新增 releases 五端点                                       |
| `server/internal/router/router.go`                                                                                                                                                                                                      | 注册新路由                                                 |
| `server/cmd/bootstrapadmin/main.go`                                                                                                                                                                                                     | 改邮箱引导                                                 |
| `server/cmd/seed/main.go`                                                                                                                                                                                                               | seed 用户改邮箱                                            |
| `packages/shared/src/store/authStore.ts:42,61,108`                                                                                                                                                                                      | 删 `phone`                                                 |
| `packages/shared/src/types/index.ts:23`                                                                                                                                                                                                 | 删 `phone`                                                 |
| `packages/shared/src/api/search.ts`                                                                                                                                                                                                     | `searchMessages` 加 `types`                                |
| `packages/shared/src/api/files.ts`                                                                                                                                                                                                      | 导出 `getDownloadUrl` 供下载器复用（已导出，无需改）       |
| `packages/shared/src/mocks/handlers.ts:24,33,1235-1258`                                                                                                                                                                                 | 删 phone + 新端点 mock                                     |
| `packages/shared/src/index.ts`                                                                                                                                                                                                          | 导出新模块                                                 |
| `packages/ui/src/layout/MainLayout.tsx:42,73-85,91-93,153,211`                                                                                                                                                                          | 换 `CommandPalette`、未读走 selector、加下载入口           |
| `packages/ui/src/layout/SearchModal.tsx`                                                                                                                                                                                                | **删除**                                                   |
| `packages/ui/src/chat/MessageBubble.tsx:546-570`                                                                                                                                                                                        | 下载按钮接 `downloadStore` + 进度条                        |
| `packages/ui/src/chat/ConversationMediaView.tsx:199`                                                                                                                                                                                    | 同上                                                       |
| `packages/ui/src/index.ts`                                                                                                                                                                                                              | 导出新组件                                                 |
| `apps/desktop/src/App.tsx:180`                                                                                                                                                                                                          | `<TitleBar onClose>` + 托盘初始化                          |
| `apps/desktop/src/main.tsx:34`                                                                                                                                                                                                          | 注入 `fileSink`                                            |
| `apps/desktop/src/components/TitleBar.tsx`                                                                                                                                                                                              | 无需改（已有 `onClose`）                                   |
| `apps/desktop/src-tauri/src/lib.rs:87-167`                                                                                                                                                                                              | 注册新命令与模块                                           |
| `apps/desktop/src-tauri/Cargo.toml`                                                                                                                                                                                                     | 按 Task 1 结论增依赖（若需要）                             |
| `apps/desktop/src-tauri/capabilities/desktop.json`                                                                                                                                                                                      | tray / badge / overlay / image / menu 权限                 |
| `apps/desktop/src-tauri/capabilities/mobile.json`                                                                                                                                                                                       | fs 写盘权限                                                |
| `apps/desktop/src-tauri/tauri.conf.json`                                                                                                                                                                                                | updater endpoints 两条 + bundle icon 加 badge-dot          |
| `apps/admin/src/pages/Users.tsx:66`                                                                                                                                                                                                     | `u.phone` → `u.email`                                      |
| `apps/admin/src/App.tsx` + `components/AdminLayout.tsx`                                                                                                                                                                                 | Releases 路由与侧栏入口                                    |
| `deploy/.env.prod.example:23` / `install.sh` / `docker-compose.prod.yml:135`                                                                                                                                                            | `ADMIN_PHONE` → `ADMIN_EMAIL`                              |
| `packages/design-system/src/i18n/locales/{zh-CN,en-US,ja-JP,ko-KR}.json`                                                                                                                                                                | 四语新增与改写                                             |
| `docs/DB_SCHEMA.md` / `docs/CHAT_API.md` / `docs/DEVELOPMENT.md` / `docs/ARCHITECTURE.md` / `docs/deploy/self-hosted.md` / `docs/deploy/my-deployment.local.md` / `README.md` / `AGENTS.md` / `docs/MASTER_PLAN.md` / `docs/ROADMAP.md` | 文档同步（Task 21）                                        |

---

## Stage 0 — Pre-flight（必须先做，结论会改写后续任务）

### Task 1: 核实三个平台未知并落档

spec §6.5 点名本批最大未知在 Android 侧。这个 Task 不写产品代码，只**核实并落档**
—— 猜错的代价是 Stage B / E 整段返工（`tauri-permission-naming` 那条教训就是猜出来的）。

**Files:**

- Create: `docs/superpowers/research/2026-10-11-android-fileprovider-preflight.md`

**Interfaces:**

- Consumes: 无
- Produces: 三条结论，Task 6 / Task 19 直接引用。若任一结论为「不可行」，
  在本 Task 内把降级方案写进该文档，并在 Task 21 登记进 MASTER_PLAN。

- [ ] **Step 1: 核实 Android 的 `BaseDirectory.Download` 落在哪**

```bash
# plugin-fs 的 Rust 侧如何解析 BaseDirectory::Download
grep -rn "Download" ~/.cargo/registry/src/*/tauri-plugin-fs-2*/src/lib.rs | head -20
grep -rn "fn resolve_path\|BaseDirectory::Download" ~/.cargo/registry/src/*/tauri-*/src/path/*.rs | head -20
# Android 侧的 path 解析实现
grep -rn "Download\|getExternalFilesDir" ~/.cargo/registry/src/*/tauri-2.11*/src/path/android.rs 2>/dev/null | head
```

记录：解析到的绝对路径形态、是否需要权限、目录是否自动创建。

- [ ] **Step 2: 核实 Tauri 的 `gen/android` 是否已带 FileProvider**

```bash
grep -rn "FileProvider\|provider" apps/desktop/src-tauri/gen/android/app/src/main/AndroidManifest.xml
ls apps/desktop/src-tauri/gen/android/app/src/main/res/xml/ 2>/dev/null
# 模板来源（gen/ 是生成目录，改它会被覆盖，必须找到模板或注入点）
grep -rn "AndroidManifest" ~/.cargo/registry/src/*/tauri-cli-2*/ 2>/dev/null | head -5
find apps/desktop/src-tauri -name "*.xml" -not -path "*/gen/*" | head
```

记录：FileProvider 是否已声明、`authorities` 的值、`file_paths.xml` 在不在、
**不被 `tauri android init` 覆盖的注入点在哪**。

- [ ] **Step 3: 核实 tauri-plugin-updater 的动态端点响应格式与 204 语义**

```bash
grep -rn "struct RemoteRelease\|serde(untagged)\|NO_CONTENT\|204" \
  ~/.cargo/registry/src/*/tauri-plugin-updater-2*/src/updater.rs | head -20
grep -rn "pub struct RemoteReleaseInner\|Dynamic\|Static" \
  ~/.cargo/registry/src/*/tauri-plugin-updater-2*/src/updater.rs | head -20
```

记录：扁平（dynamic）格式的**确切字段名**、`platforms` map 是否可省、
无更新时返 204 还是返同版本号、`{{target}}` / `{{arch}}` 占位符的实际取值。

- [ ] **Step 4: 把三条结论写进研究文档**

文档结构：每条一节，含「核实命令」「实际输出摘要」「结论」「对 plan 的影响」。
任一条为「不可行」时必须写出降级方案。已知的降级底线：

- `BaseDirectory.Download` 安卓不可用 → 退 `BaseDirectory.AppCache`，
  下载完只提供「打开」不提供「文件管理器可见」
- FileProvider 无注入点 → `install_apk` 降级为「下载完提示用户手动点通知栏打开」，
  并把「Android 自动安装」登记为债
- updater 动态格式与预期不符 → 对外端点改返完整 `platforms` map（static 格式），
  多写一层映射但功能等价

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/research/2026-10-11-android-fileprovider-preflight.md
git commit -m "docs(research): 核实安卓 FileProvider / fs 落盘目录 / updater 动态端点格式"
```

---

## Stage A — W1 手机号完全移除（与其余工作流零耦合，先合进去）

### Task 2: 后端去手机号 + 迁移 021

**Files:**

- Create: `server/internal/database/migrations/021_drop_user_phone.sql`
- Modify: `server/internal/model/user.go:13`
- Modify: `server/internal/repository/user_repo.go:48-52,78-84`
- Modify: `server/internal/repository/admin_repo.go:31`
- Modify: `server/internal/service/user_service.go:24,143-144,180-181,262-274`
- Modify: `server/internal/service/auth_service.go:91`
- Modify: `server/internal/service/contact_service.go:81`
- Modify: `server/internal/handler/auth.go:33-59`
- Modify: `server/internal/handler/user.go:285`
- Test: `server/internal/service/user_service_test.go`、`server/internal/service/contact_service_test.go`

**Interfaces:**

- Consumes: 无
- Produces: `UserRepository.ExistsByEmail(ctx, email string) (bool, error)`
  —— 取代 `ExistsByPhoneOrEmail`。`model.User` 不再有 `Phone` 字段。

- [ ] **Step 1: 写失败的测试 —— 登录只认邮箱与元聊号**

在 `server/internal/service/user_service_test.go` 追加：

```go
// 手机号登录必须失败：本批已把手机号彻底移除，留一条回归测试钉住，
// 否则日后有人「顺手」把 FindByPhone 加回来不会被发现。
func TestLogin_PhoneNumberNoLongerAccepted(t *testing.T) {
	db := testutil.NewDB(t)
	rdb, _ := testutil.NewRedis(t)
	svc := newTestUserService(t, db, rdb)
	ctx := context.Background()

	u := seedTestUser(t, db, "phone-gone@example.com", "Abcdef12")

	// 11 位数字串既不是邮箱也不可能撞上 short_id（short_id 从 10000 起递增）
	_, err := svc.Login(ctx, &service.LoginRequest{Account: "13800138000", Password: "Abcdef12"})
	require.ErrorIs(t, err, service.ErrUserNotFound)

	// 邮箱与元聊号两条路径仍然通
	got, err := svc.Login(ctx, &service.LoginRequest{Account: "phone-gone@example.com", Password: "Abcdef12"})
	require.NoError(t, err)
	require.Equal(t, u.ID, got.User.ID)

	got, err = svc.Login(ctx, &service.LoginRequest{
		Account:  strconv.FormatInt(u.ShortID, 10),
		Password: "Abcdef12",
	})
	require.NoError(t, err)
	require.Equal(t, u.ID, got.User.ID)
}
```

> `newTestUserService` / `seedTestUser` 如果现有测试文件里还没有同名辅助，
> 照该文件已有的构造方式就地补一个，不要新建 helper 文件。

- [ ] **Step 2: 运行测试确认失败**

```bash
cd server && go test ./internal/service/ -run TestLogin_PhoneNumberNoLongerAccepted -v
```

Expected: 编译通过但断言失败 —— `Account: "13800138000"` 当前走
`FindByPhone` 返回 `nil, nil` 再回落 short_id 解析，`13800138000` 能被
`ParseInt` 解析成功但查不到，恰好也返 `ErrUserNotFound`。**所以这一条可能意外通过**。
若通过，改为断言「`FindByPhone` 不再被调用」—— 用一个计数 mock repo，
或直接跳到 Step 3 后用 `grep` 证明符号已不存在（见 Step 6）。

- [ ] **Step 3: 删迁移以外的后端手机号引用**

`server/internal/model/user.go` 删第 13 行：

```go
// 删掉这一行（整行）：
Phone        *string        `gorm:"type:varchar(20);uniqueIndex" json:"phone,omitempty"`
```

`server/internal/repository/user_repo.go` 删 `FindByPhone` 整个函数（48-52 行），
并把 `ExistsByPhoneOrEmail` 换成：

```go
// ExistsByEmail 判断邮箱是否已被注册。
//
// 签名从 ExistsByPhoneOrEmail(phone, email) 收窄而来：手机号已彻底移除，
// 留一个恒传空串的参数位就是留个坑 —— 下一个人会以为它还有用。
func (r *UserRepository) ExistsByEmail(ctx context.Context, email string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&model.User{}).
		Where("email = ?", email).
		Count(&count).Error
	return count > 0, err
}
```

`server/internal/repository/admin_repo.go:31`：

```go
// 改前：tx = tx.Where("nickname ILIKE ? OR phone LIKE ? OR email ILIKE ?", like, like, like)
tx = tx.Where("nickname ILIKE ? OR email ILIKE ?", like, like)
```

`server/internal/service/user_service.go`：

```go
// :24 文案
ErrDuplicateUser   = errors.New("email already registered")

// :181 调用点
exists, err := s.repo.ExistsByEmail(ctx, req.Email)

// :262-274 登录分支整段替换
	// 按邮箱或元聊号查用户。手机号已彻底移除（见迁移 021）：
	// 含 @ 即邮箱，否则按元聊号解析 —— 登录框标的就是「邮箱 / 元聊号」。
	var user *model.User

	if strings.Contains(req.Account, "@") {
		user, err = s.repo.FindByEmail(ctx, req.Account)
	} else if shortID, convErr := strconv.ParseInt(req.Account, 10, 64); convErr == nil {
		user, err = s.repo.FindByShortID(ctx, shortID)
	}
	// 既不含 @ 又不是数字 → user 与 err 均为零值，下面统一按「用户不存在」处理，
	// 并照既有口径计入失败计数（不计数的话「格式错」与「不存在」就成了枚举探针）
```

同时改写 `:143-144`、`:180` 两处已失真的注释（它们在说「users.phone 列与按手机号
登录都保留，仅供老账号使用」）。

`server/internal/service/auth_service.go:91`：

```go
// 改前：return s.repo.FindByPhone(ctx, target)
// 忘记密码只认邮箱 —— 验证码要发到一个能收的地方，元聊号不是联系方式
return s.repo.FindByEmail(ctx, target)
```

`server/internal/service/contact_service.go:81`：删掉 `FindByPhone` 那一支，
好友精确搜索剩「邮箱 + 元聊号」两种形态（上下文照原有 if/else 结构收拢）。

`server/internal/handler/auth.go:33-59`：删 `SendResetCodeRequest.Phone` 与
`VerifyResetCodeRequest.Phone` 字段、删两个 `target()` 里的 `return r.Phone` 回落，
并删掉 `:33` 那条「保留 Phone 只为兼容已发布的旧客户端」的注释。

`server/internal/handler/user.go:285`：注释「老账号库里仍有 phone 列与按手机号登录，
那是登录的事，与注册无关」已失真，改为「注册与登录都只认邮箱，手机号已于迁移 021 移除」。

- [ ] **Step 4: 写迁移 021**

`server/internal/database/migrations/021_drop_user_phone.sql`：

```sql
-- +goose Up
-- +goose StatementBegin
-- 手机号彻底移除，不再兼容。
--
-- 为什么可以直接删列而不先让存量用户补邮箱：登录的非 @ 分支会回落元聊号
-- （user_service.go 的 Login），所以「只有手机号、没有邮箱」的账号删列后
-- 仍可用元聊号 + 原密码登录，不存在被锁死在门外的账号。
-- 2026-10-11 实查生产库亦已确认全员有邮箱。
DROP INDEX IF EXISTS idx_users_phone;
ALTER TABLE users DROP COLUMN IF EXISTS phone;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- 只恢复结构，不恢复数据 —— 列删掉号码就没了，Down 回来的是一整列 NULL。
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone varchar(20);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users (phone);
-- +goose StatementEnd
```

- [ ] **Step 5: 改既有测试并全绿**

```bash
cd server && go build ./... 2>&1 | head -30
```

编译错误会逐个指出还在用 `Phone` / `FindByPhone` / `ExistsByPhoneOrEmail` 的地方
（含 `_test.go`），逐处改掉。然后：

```bash
cd server && go vet ./... && go test ./... 2>&1 | tail -30
```

Expected: 全绿，0 FAIL。

- [ ] **Step 6: 证明符号已彻底消失**

```bash
cd server && grep -rn "FindByPhone\|ExistsByPhoneOrEmail\|\.Phone\b" --include=*.go . \
  | grep -v "qrConfirmOnPhone"
```

Expected: 无输出。有输出就是还没删干净。

- [ ] **Step 7: Commit**

```bash
git add server/
git commit -m "feat(auth)!: 后端彻底移除手机号，登录只认邮箱与元聊号

迁移 021 删 users.phone 列与唯一索引。删列不需要前置「让存量用户补邮箱」：
登录的非 @ 分支回落元聊号，无邮箱账号仍可用元聊号加原密码登录。

ExistsByPhoneOrEmail 收窄为 ExistsByEmail —— 留一个恒传空串的参数位
只会让下一个人以为它还有用。好友精确搜索、忘记密码、管理端用户搜索
三处的手机号分支一并删除。"
```

### Task 3: bootstrap-admin 改邮箱引导 + 前端与部署同步

**Files:**

- Modify: `server/cmd/bootstrapadmin/main.go:37-106`
- Modify: `server/cmd/seed/main.go:40,164,177,195-197`
- Modify: `packages/shared/src/store/authStore.ts:42,61,108`
- Modify: `packages/shared/src/types/index.ts:23`
- Modify: `packages/shared/src/mocks/handlers.ts:24,33,1235-1258`
- Modify: `apps/admin/src/pages/Users.tsx:66`
- Modify: `deploy/.env.prod.example:23`、`deploy/install.sh:45,141,241,252,254`、`deploy/docker-compose.prod.yml:135`
- Modify: `packages/design-system/src/i18n/locales/{zh-CN,en-US,ja-JP,ko-KR}.json`

**Interfaces:**

- Consumes: Task 2 的 `model.User`（无 `Phone`）
- Produces: 环境变量契约 `YUANCHAT_BOOTSTRAP_ADMIN_EMAIL`（取代 `_PHONE`）

- [ ] **Step 1: 改 bootstrap-admin**

```go
// main.go:37 起
email := strings.TrimSpace(os.Getenv("YUANCHAT_BOOTSTRAP_ADMIN_EMAIL"))
pass := strings.TrimSpace(os.Getenv("YUANCHAT_BOOTSTRAP_ADMIN_PASSWORD"))
if email == "" || pass == "" {
	// 两者缺一即跳过：install.sh 允许不填，届时由用户自行注册后手工提权
	fmt.Println("未设置 YUANCHAT_BOOTSTRAP_ADMIN_EMAIL / _PASSWORD，跳过管理员引导")
	return
}

// :78 去重键改 email —— 原本查 phone，列已不存在
err = db.WithContext(ctx).Where("email = ?", email).First(&existing).Error

// :84 / :106 输出文案
fmt.Printf("已将既有账号 %s 提权为管理员（密码保持原样，未改动）\n", email)
fmt.Printf("已创建管理员账号：邮箱 %s，元聊号 %d\n", email, shortID)

// :96 建号时写 Email 而非 Phone
Email:        email,
```

> ⚠️ 去重键从 phone 改成 email 之后，生产服务器 `deploy/.env` 里的
> `ADMIN_PHONE=13900000001` 必须同步换成 `ADMIN_EMAIL=admin@yuanyuan.blog`
> （该邮箱已于 2026-10-11 写入生产库的 `short_id=10006` 账号）。
> 两者不一致会让下次 `install.sh` **再建一个管理员**。此事写进 Task 21 的部署文档。

- [ ] **Step 2: 改 seed**

`server/cmd/seed/main.go` 的 `seedUsers` 结构体字段 `phone` → `email`，
值改成 `alice@example.com` 一类；`:177` 的去重查询与 `:195-197` 的建号同步；
`:164` 的输出 `phone=%s` → `email=%s`。

- [ ] **Step 3: 删前端 phone**

```ts
// packages/shared/src/store/authStore.ts — 三处全删
// :42  UserDto 的 phone?: string;
// :61  User 的 phone?: string | null;
// :108 映射里的 phone: dto.phone ?? undefined,

// packages/shared/src/types/index.ts:23 — 删 phone?: string;
```

`packages/shared/src/mocks/handlers.ts`：

```ts
// :24 mock 用户类型删 phone: string;
// :33 mock 数据删 phone: "13800138000",

// :1235-1258 login / reset handler：去掉 phone 回落与那条注释
const body = (await request.json()) as { account?: string };
const account = body.account;
```

`apps/admin/src/pages/Users.tsx:66`：

```tsx
{
  /* 改前：{u.phone || u.email || "—"} */
}
{
  u.email || "—";
}
```

- [ ] **Step 4: 四语 i18n 同步**

`admin.users.searchPlaceholder` 去掉「手机号」：

| locale | 新值                                 |
| ------ | ------------------------------------ |
| zh-CN  | `昵称 / 邮箱 / 用户ID`               |
| en-US  | `Nickname / Email / User ID`         |
| ja-JP  | `ニックネーム / メール / ユーザーID` |
| ko-KR  | `닉네임 / 이메일 / 사용자 ID`        |

> `auth.accountPlaceholder` 已经是「邮箱 / 元聊号」，**不要改**。
> `auth.qrConfirmOnPhone` / `auth.qrCanceled` 说的是「手机这台设备」，**不在范围内**。

- [ ] **Step 5: 改部署配置**

```bash
# deploy/.env.prod.example:23
-ADMIN_PHONE=
+ADMIN_EMAIL=

# deploy/docker-compose.prod.yml:135
-      YUANCHAT_BOOTSTRAP_ADMIN_PHONE: ${ADMIN_PHONE:-}
+      YUANCHAT_BOOTSTRAP_ADMIN_EMAIL: ${ADMIN_EMAIL:-}
```

`deploy/install.sh` 五处（`:45` 的 `REQUIRED_VARS` 行、`:141-142` 的告警、
`:241`、`:252`、`:254` 的提示文案）把 `ADMIN_PHONE` 全换成 `ADMIN_EMAIL`，
`:254` 的「管理后台登录：账号 ${ADMIN_EMAIL}」文案同步。

- [ ] **Step 6: 跑门禁**

```bash
node scripts/check-i18n.mjs
LANG=C.UTF-8 pnpm test
cd apps/web && npx tsc --noEmit && cd ../desktop && npx tsc --noEmit && cd ../..
cd server && go vet ./... && go test ./... && cd ..
bash -n deploy/install.sh
```

Expected: 全绿。`check-i18n` 尤其要绿 —— 改了四语文案。

- [ ] **Step 7: Commit**

```bash
git add server/cmd deploy packages apps/admin
git commit -m "feat(auth)!: 管理员引导与前端去手机号，ADMIN_PHONE 改 ADMIN_EMAIL

bootstrap-admin 的去重键从 phone 改 email，引导出的管理员从此自带邮箱、
走得通忘记密码（原先 ADMIN_PHONE 引导出来的账号没有邮箱，找回密码无路可走）。

部署侧 .env.prod.example / install.sh / docker-compose.prod.yml 同步改名。
既有部署升级时必须把 .env 的 ADMIN_PHONE 换成 ADMIN_EMAIL 并填同一个邮箱，
否则下次 install.sh 会再建一个管理员账号。"
```

---

## Stage B — W2 应用内下载 + 进度条（共用件，Stage E / F 依赖）

### Task 4: `downloadStore` 纯逻辑与进度节流

**Files:**

- Create: `packages/shared/src/download/downloadStore.ts`
- Create: `packages/shared/src/download/__tests__/downloadStore.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**

- Consumes: `getDownloadUrl(key, attachmentName?)` from `packages/shared/src/api/files.ts`（已导出）
- Produces:
  - `useDownloadStore` —— Zustand store，`entries: Record<string, DownloadEntry>`（键是 messageId）
  - `startDownload(messageId: string, objectKey: string, fileName: string): Promise<void>`
  - `cancelDownload(messageId: string): void`
  - `clearDownload(messageId: string): void`
  - `type DownloadPhase = "downloading" | "saving" | "done" | "failed" | "canceled"`
  - `interface DownloadEntry { phase: DownloadPhase; received: number; total: number; savedPath?: string; errorKey?: string }`

- [ ] **Step 1: 写失败的测试**

`packages/shared/src/download/__tests__/downloadStore.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useDownloadStore, startDownload, cancelDownload } from "../downloadStore";
import { setFileSink, __resetFileSink } from "../fileSink";

/** 造一个按节奏吐 chunk 的 ReadableStream，用来驱动进度 */
function streamOf(chunks: Uint8Array[], opts?: { failAt?: number }) {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (opts?.failAt !== undefined && i === opts.failAt) {
        controller.error(new TypeError("network error"));
        return;
      }
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[i]);
      i += 1;
    },
  });
}

function mockFetch(body: ReadableStream<Uint8Array> | null, contentLength?: string) {
  const headers = new Headers();
  if (contentLength !== undefined) headers.set("content-length", contentLength);
  return vi.fn().mockResolvedValue({ ok: true, status: 200, body, headers });
}

beforeEach(() => {
  useDownloadStore.setState({ entries: {} });
  vi.mock("../../api/files", () => ({
    getDownloadUrl: vi.fn().mockResolvedValue("https://x/obj"),
  }));
  setFileSink({ save: vi.fn().mockResolvedValue("/tmp/a.pdf") });
});
afterEach(() => {
  __resetFileSink();
  vi.restoreAllMocks();
});

it("进度单调递增，完成后 phase 为 done 且带落盘路径", async () => {
  const chunks = [new Uint8Array(40), new Uint8Array(60)];
  vi.stubGlobal("fetch", mockFetch(streamOf(chunks), "100"));

  await startDownload("m1", "obj/a", "a.pdf");

  const e = useDownloadStore.getState().entries["m1"];
  expect(e.phase).toBe("done");
  expect(e.total).toBe(100);
  expect(e.received).toBe(100);
  expect(e.savedPath).toBe("/tmp/a.pdf");
});

it("服务端未给 content-length 时 total 为 0（进度条走不确定态）", async () => {
  vi.stubGlobal("fetch", mockFetch(streamOf([new Uint8Array(10)])));
  await startDownload("m2", "obj/b", "b.bin");
  expect(useDownloadStore.getState().entries["m2"].total).toBe(0);
});

// Review Focus #2：下载途中断网 / 预签名 URL 过期
it("流中途出错时进 failed 态并带可本地化的错误 key，不是静默卡住", async () => {
  vi.stubGlobal(
    "fetch",
    mockFetch(streamOf([new Uint8Array(10), new Uint8Array(10)], { failAt: 1 }), "20"),
  );

  await startDownload("m3", "obj/c", "c.pdf");

  const e = useDownloadStore.getState().entries["m3"];
  expect(e.phase).toBe("failed");
  expect(e.errorKey).toBe("chat.file.downloadFailed");
  // 已收到的字节数要留着，UI 才能显示「在 50% 处失败」而不是回到 0
  expect(e.received).toBe(10);
});

it("预签名 URL 返非 2xx 时进 failed，不把错误页当文件存下来", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      body: null,
      headers: new Headers(),
    }),
  );
  await startDownload("m4", "obj/d", "d.pdf");
  expect(useDownloadStore.getState().entries["m4"].phase).toBe("failed");
});

it("重复点击不起第二条请求", async () => {
  const f = mockFetch(streamOf([new Uint8Array(10)]), "10");
  vi.stubGlobal("fetch", f);
  const p1 = startDownload("m5", "obj/e", "e.pdf");
  const p2 = startDownload("m5", "obj/e", "e.pdf");
  await Promise.all([p1, p2]);
  expect(f).toHaveBeenCalledTimes(1);
});

it("取消后进 canceled 态且不落盘", async () => {
  const save = vi.fn();
  setFileSink({ save });
  // 永不结束的流，给 cancel 留出时间窗
  vi.stubGlobal("fetch", mockFetch(new ReadableStream({ pull() {} }), "999"));
  const p = startDownload("m6", "obj/f", "f.pdf");
  cancelDownload("m6");
  await p;
  expect(useDownloadStore.getState().entries["m6"].phase).toBe("canceled");
  expect(save).not.toHaveBeenCalled();
});

it("进度更新按 100ms 节流，大量 chunk 不会每个都 setState", async () => {
  const many = Array.from({ length: 500 }, () => new Uint8Array(2));
  vi.stubGlobal("fetch", mockFetch(streamOf(many), "1000"));

  let writes = 0;
  const unsub = useDownloadStore.subscribe(() => {
    writes += 1;
  });
  await startDownload("m7", "obj/g", "g.bin");
  unsub();

  // 500 个 chunk 若每个都写一次就是 500+ 次。节流后应远小于它
  // （阈值取 50：含起始、若干节流点、saving、done 几次状态跃迁）
  expect(writes).toBeLessThan(50);
  expect(useDownloadStore.getState().entries["m7"].received).toBe(1000);
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
LANG=C.UTF-8 pnpm --filter @yuanchat/shared test -- downloadStore
```

Expected: FAIL —— `Cannot find module '../downloadStore'`。

- [ ] **Step 3: 实现 `downloadStore.ts`**

```ts
/**
 * 文件下载进度 store —— 应用内下载的唯一真源，三端共用。
 *
 * @description
 * 为什么不直接把预签名 URL 交给浏览器/系统下载管理器（改之前的做法）：
 * 桌面与安卓会跳出应用，Web 端在新标签页里预览，用户看不到进度也不知道文件去哪了。
 * 这里改为 `fetch` 预签名 URL、读 `Response.body` 流自己累计进度，
 * 落盘交给注入的 {@link FileSink}（平台差异收在那一层）。
 *
 * `Content-Length` 属 CORS 安全列表响应头，跨域也读得到，所以进度是**确定性**的；
 * 服务端没给的话退化为不确定态（`total === 0`），不报错。
 */
import { create } from "zustand";
import { getDownloadUrl } from "../api/files";
import { getFileSink } from "./fileSink";
import { captureException } from "../observability";

/** 下载阶段。`saving` 是字节已收齐、正在写盘的窗口（大文件写盘也要时间） */
export type DownloadPhase = "downloading" | "saving" | "done" | "failed" | "canceled";

/** 单条下载的进度与结果 */
export interface DownloadEntry {
  phase: DownloadPhase;
  /** 已收字节数。失败时保留，UI 才能显示「在 50% 处失败」而不是回到 0 */
  received: number;
  /** 总字节数；0 表示服务端未给 content-length，进度条走不确定态 */
  total: number;
  /** 落盘位置描述；web 实现返回 null，此处即为 undefined */
  savedPath?: string;
  /** 失败原因的 i18n key —— store 在 UI 层之外，不能自己 t() */
  errorKey?: string;
}

interface DownloadState {
  entries: Record<string, DownloadEntry>;
}

export const useDownloadStore = create<DownloadState>()(() => ({ entries: {} }));

/** messageId → AbortController，取消与「重复点击去重」共用这张表 */
const inflight = new Map<string, AbortController>();

/** 进度写入的最小间隔。不节流的话 100MB 文件每个 chunk 一次 setState 会把 React 打爆 */
const PROGRESS_THROTTLE_MS = 100;

function patch(messageId: string, next: Partial<DownloadEntry>): void {
  useDownloadStore.setState((s) => {
    const prev = s.entries[messageId] ?? {
      phase: "downloading" as DownloadPhase,
      received: 0,
      total: 0,
    };
    return { entries: { ...s.entries, [messageId]: { ...prev, ...next } } };
  });
}

/**
 * 开始下载一个对象并落盘。
 *
 * @param messageId 进度条挂在哪条消息下（也是去重与取消的键）
 * @param objectKey 对象键
 * @param fileName 原始文件名；会传给签名接口换取 `Content-Disposition: attachment`
 * @remarks 同一 messageId 已在下载中时**直接返回**，不起第二条请求 ——
 *   文件气泡的下载按钮很容易被连点。
 */
export async function startDownload(
  messageId: string,
  objectKey: string,
  fileName: string,
): Promise<void> {
  if (inflight.has(messageId)) return;

  const ctrl = new AbortController();
  inflight.set(messageId, ctrl);
  patch(messageId, {
    phase: "downloading",
    received: 0,
    total: 0,
    savedPath: undefined,
    errorKey: undefined,
  });

  try {
    const url = await getDownloadUrl(objectKey, fileName);
    const res = await fetch(url, { signal: ctrl.signal });
    // 非 2xx 的响应体是 XML 错误页，存下来等于给用户一个坏文件
    if (!res.ok) throw new Error("http " + res.status);

    const total = Number(res.headers.get("content-length") ?? 0) || 0;
    const mime = res.headers.get("content-type") ?? "application/octet-stream";
    patch(messageId, { total });

    const chunks: Uint8Array[] = [];
    let received = 0;

    if (res.body) {
      const reader = res.body.getReader();
      let lastWrite = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        const now = Date.now();
        if (now - lastWrite >= PROGRESS_THROTTLE_MS) {
          lastWrite = now;
          patch(messageId, { received });
        }
      }
    } else {
      // 老 WebView 没有 ReadableStream 的 body：退 blob，进度走不确定态
      const buf = new Uint8Array(await res.arrayBuffer());
      chunks.push(buf);
      received = buf.byteLength;
    }
    patch(messageId, { received });

    // 取消是在 read 之间生效的，收齐后再查一次，避免「已 abort 仍落盘」
    if (ctrl.signal.aborted) {
      patch(messageId, { phase: "canceled" });
      return;
    }

    patch(messageId, { phase: "saving" });
    const bytes = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.byteLength;
    }
    const savedPath = await getFileSink().save(bytes, fileName, mime);
    patch(messageId, { phase: "done", savedPath: savedPath ?? undefined });
  } catch (err) {
    if (ctrl.signal.aborted) {
      patch(messageId, { phase: "canceled" });
      return;
    }
    // 断网与预签名 URL 过期都落在这里。必须给出明确的失败态 ——
    // 静默卡在 60% 不动的话，用户分不清是慢还是坏了
    captureException(err, { context: "startDownload" });
    patch(messageId, { phase: "failed", errorKey: "chat.file.downloadFailed" });
  } finally {
    inflight.delete(messageId);
  }
}

/** 取消下载。已完成或不存在的条目调用无副作用 */
export function cancelDownload(messageId: string): void {
  inflight.get(messageId)?.abort();
}

/** 清掉一条进度记录（用户点掉提示、或离开会话时） */
export function clearDownload(messageId: string): void {
  useDownloadStore.setState((s) => {
    const next = { ...s.entries };
    delete next[messageId];
    return { entries: next };
  });
}
```

- [ ] **Step 4: 从 `packages/shared/src/index.ts` 导出**

```ts
export {
  useDownloadStore,
  startDownload,
  cancelDownload,
  clearDownload,
  type DownloadEntry,
  type DownloadPhase,
} from "./download/downloadStore";
```

- [ ] **Step 5: 运行测试确认通过**

```bash
LANG=C.UTF-8 pnpm --filter @yuanchat/shared test -- downloadStore
```

Expected: PASS，7 条全过。

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/download packages/shared/src/index.ts
git commit -m "feat(download): 新增下载进度 store，读 Response.body 流累计确定性进度

进度更新按 100ms 节流 —— 不节流的话 100MB 文件每个 chunk 一次 setState
会把 React 打爆，这是确定性进度条的实现成本而非可选优化。

断网与预签名 URL 过期统一进 failed 态并保留已收字节数，
好让 UI 显示「在 50% 处失败」而不是悄悄卡住。非 2xx 响应直接判失败，
否则会把 MinIO 的 XML 错误页当文件存给用户。"
```

### Task 5: `fileSink` 落盘抽象与 Web 实现

**Files:**

- Create: `packages/shared/src/download/fileSink.ts`
- Create: `packages/shared/src/download/__tests__/fileSink.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**

- Consumes: 无
- Produces:
  - `type SinkDir = "downloads" | "appdata"`
  - `interface FileSink { save(bytes, fileName, mime, dir?): Promise<string | null>; read?(fileName, dir): Promise<Uint8Array>; remove?(fileName, dir): Promise<void>; reveal?(path): Promise<void> }`
  - `setFileSink(sink: FileSink): void` / `getFileSink(): FileSink` / `__resetFileSink(): void`
  - `uniqueFileName(name: string, taken: (n: string) => boolean): string`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { getFileSink, setFileSink, __resetFileSink, uniqueFileName } from "../fileSink";

afterEach(() => __resetFileSink());

// Review Focus #3：同名文件重复下载不得静默覆盖
describe("uniqueFileName", () => {
  it("名字没被占用时原样返回", () => {
    expect(uniqueFileName("a.pdf", () => false)).toBe("a.pdf");
  });

  it("被占用时在后缀前递增，不碰扩展名", () => {
    const taken = new Set(["a.pdf", "a (2).pdf"]);
    expect(uniqueFileName("a.pdf", (n) => taken.has(n))).toBe("a (3).pdf");
  });

  it("无扩展名的文件也能递增", () => {
    const taken = new Set(["README"]);
    expect(uniqueFileName("README", (n) => taken.has(n))).toBe("README (2)");
  });

  it("多重扩展名只认最后一段", () => {
    const taken = new Set(["x.tar.gz"]);
    expect(uniqueFileName("x.tar.gz", (n) => taken.has(n))).toBe("x.tar (2).gz");
  });
});

describe("web 默认实现", () => {
  it("未注入时走 <a download> 并回收 blob URL", async () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:fake");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

    const clicked: HTMLAnchorElement[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreate(tag) as HTMLAnchorElement;
      if (tag === "a") {
        el.click = () => {
          clicked.push(el);
        };
      }
      return el;
    });

    const path = await getFileSink().save(
      new Uint8Array([1, 2, 3]),
      "report.pdf",
      "application/pdf",
    );

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe("report.pdf");
    expect(clicked[0].href).toContain("blob:fake");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    // web 端不知道浏览器把文件放哪了，如实返 null
    expect(path).toBeNull();
  });

  it("注入后 getFileSink 返回注入的实现", async () => {
    const save = vi.fn().mockResolvedValue("/data/a.pdf");
    setFileSink({ save });
    const path = await getFileSink().save(new Uint8Array(), "a.pdf", "application/pdf");
    expect(path).toBe("/data/a.pdf");
    expect(save).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
LANG=C.UTF-8 pnpm --filter @yuanchat/shared test -- fileSink
```

Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 `fileSink.ts`**

```ts
/**
 * 落盘抽象：平台在启动时注入实现（桌面/安卓走 Tauri plugin-fs，web 不注册=用 <a download>）。
 *
 * @description
 * 与 {@link setUrlOpener} / {@link setNotifier} 同一套注入模式：
 * UI 层与 store 层不直接 import `@tauri-apps/*`，否则 web 构建会把桌面端依赖
 * 一起拖进包里。
 */

/** 落盘目标目录。下载产物进 downloads，发送前的 outbox 副本进 appdata */
export type SinkDir = "downloads" | "appdata";

export interface FileSink {
  /**
   * 写入字节。
   * @returns 可展示给用户的落盘位置；web 实现返回 `null`（浏览器不告诉我们放哪了）
   */
  save(bytes: Uint8Array, fileName: string, mime: string, dir?: SinkDir): Promise<string | null>;
  /** 读回已落盘的字节（outbox 重试用）。web 实现没有这个能力 */
  read?(fileName: string, dir: SinkDir): Promise<Uint8Array>;
  /** 删除已落盘的文件（outbox 发送成功后清理）。web 实现没有这个能力 */
  remove?(fileName: string, dir: SinkDir): Promise<void>;
  /** 用系统默认应用打开已落盘的文件。web 实现没有这个能力 */
  reveal?(path: string): Promise<void>;
}

/**
 * Web 默认实现：Blob + `<a download>`。
 *
 * 不用 `window.open(blobUrl)` —— 那会在新标签页里内联渲染 PDF/图片，
 * 又回到了「点下载却只打开了预览」那个老问题上。
 */
const webSink: FileSink = {
  async save(bytes, fileName, mime) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.rel = "noopener";
      a.click();
    } finally {
      // 必须回收：blob 一直被引用的话这份字节在标签页关闭前都不会释放
      URL.revokeObjectURL(url);
    }
    return null;
  },
};

let sink: FileSink | null = null;

/** 注入平台实现（在 app 入口调用一次） */
export function setFileSink(impl: FileSink): void {
  sink = impl;
}

/** 测试辅助：还原未注册态 */
export function __resetFileSink(): void {
  sink = null;
}

/** 取当前生效的实现；未注入时为 web 默认实现 */
export function getFileSink(): FileSink {
  return sink ?? webSink;
}

/**
 * 同名避让：`a.pdf` 已存在则返回 `a (2).pdf`，依次递增。
 *
 * 静默覆盖用户已有的下载是不可逆的 —— 覆盖掉的那份字节找不回来，
 * 所以这里宁可多留一个文件。只认**最后一段**扩展名，
 * 故 `x.tar.gz` 变 `x.tar (2).gz`（够用，不值得为多重扩展名另写一套解析）。
 *
 * @param name 期望的文件名
 * @param taken 判断某个名字是否已被占用
 */
export function uniqueFileName(name: string, taken: (n: string) => boolean): string {
  if (!taken(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 2; ; i += 1) {
    const candidate = `${stem} (${i})${ext}`;
    if (!taken(candidate)) return candidate;
  }
}
```

- [ ] **Step 4: 从 `index.ts` 导出**

```ts
export {
  setFileSink,
  getFileSink,
  __resetFileSink,
  uniqueFileName,
  type FileSink,
  type SinkDir,
} from "./download/fileSink";
```

- [ ] **Step 5: 运行测试确认通过**

```bash
LANG=C.UTF-8 pnpm --filter @yuanchat/shared test -- fileSink
```

Expected: PASS，6 条全过。

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/download packages/shared/src/index.ts
git commit -m "feat(download): 新增 fileSink 落盘抽象与 Web 的 <a download> 实现

与 setUrlOpener / setNotifier 同一套注入模式，UI 与 store 层不碰 @tauri-apps/*，
否则 web 构建会把桌面端依赖拖进包里。

同名避让按「后缀前递增」而非静默覆盖 —— 覆盖掉的那份字节找不回来。"
```

### Task 6: Tauri 侧 `fileSink` 实现 + `open_local_file` / `install_apk` 命令

> **前置**：Task 1 的三条结论。若 `BaseDirectory.Download` 在安卓不可用，
> 本 Task 按 Task 1 文档里的降级方案改用 `BaseDirectory.AppCache`。

**Files:**

- Create: `apps/desktop/src-tauri/src/local_file.rs`
- Create: `apps/desktop/src/fileSink.ts`
- Modify: `apps/desktop/src-tauri/src/lib.rs:87-128`（注册模块与命令）
- Modify: `apps/desktop/src/main.tsx`（注入）
- Modify: `apps/desktop/src-tauri/capabilities/default.json`、`capabilities/mobile.json`
- Test: `apps/desktop/src/__tests__/fileSink.test.ts`

**Interfaces:**

- Consumes: Task 5 的 `FileSink` / `SinkDir` / `setFileSink` / `uniqueFileName`
- Produces:
  - Rust 命令 `open_local_file(path: String, mime: Option<String>) -> Result<(), String>`
  - Rust 命令 `install_apk(path: String) -> Result<(), String>`（Task 19 消费）
  - `installFileSink(): void`

- [ ] **Step 1: 写 Rust 命令**

`apps/desktop/src-tauri/src/local_file.rs`：

```rust
//! 打开应用自有目录下的本地文件。
//!
//! 为什么需要这个命令：下载落在应用私有目录后，用户在文件管理器里**看不见它** ——
//! 对用户来说文件等于消失了。桌面端交给系统默认应用打开，安卓端走
//! `Intent.ACTION_VIEW` + FileProvider（私有目录的 `file://` URI 从
//! Android 7 起不允许跨应用传递，必须经 content:// 授权）。
//!
//! `install_apk` 是同一个 Intent，只是把 mime 固定成
//! `application/vnd.android.package-archive` —— 两者合成一处，
//! 一份 FileProvider 配置两处受益。

use std::path::{Path, PathBuf};
use tauri::Manager;

/// 把前端给的路径限制在应用自有目录之下。
///
/// 这个命令对 WebView 里的代码完全开放，不卡目录等于把「打开任意本地文件」
/// 的能力交出去 —— 与 `open_external` 把 scheme 卡死在 http(s) 是同一个顾虑。
/// 只放行 app_data / app_cache / download 三处，且用 canonicalize 之后再比，
/// 否则 `../../` 能走出去。
fn ensure_app_owned(app: &tauri::AppHandle, path: &str) -> Result<PathBuf, String> {
    let resolver = app.path();
    let mut roots: Vec<PathBuf> = Vec::new();
    for r in [resolver.app_data_dir(), resolver.app_cache_dir(), resolver.download_dir()] {
        if let Ok(p) = r {
            if let Ok(c) = p.canonicalize() {
                roots.push(c);
            }
        }
    }
    let target = Path::new(path)
        .canonicalize()
        .map_err(|e| format!("path not accessible: {e}"))?;
    if roots.iter().any(|root| target.starts_with(root)) {
        Ok(target)
    } else {
        Err("path outside app-owned directories".into())
    }
}

/// 用系统默认应用打开本地文件。
///
/// @param path - 绝对路径，必须落在应用自有目录下
/// @param mime - 安卓 Intent 需要；桌面端忽略
#[tauri::command]
pub fn open_local_file(
    app: tauri::AppHandle,
    path: String,
    mime: Option<String>,
) -> Result<(), String> {
    let target = ensure_app_owned(&app, &path)?;
    let _ = &mime;
    #[cfg(desktop)]
    {
        use tauri_plugin_shell::ShellExt;
        #[allow(deprecated)]
        app.shell()
            .open(target.to_string_lossy().to_string(), None)
            .map_err(|e| e.to_string())
    }
    #[cfg(mobile)]
    {
        // 按 Task 1 的核实结论填入：FileProvider authority 与 Intent 发起方式。
        // 若该结论为「无可用注入点」，本分支按降级方案返回 Err 并由前端提示
        // 用户去通知栏/文件管理器手动打开。
        android_open(&app, &target, mime.as_deref())
    }
}

/// 调系统安装器安装 APK（Android 自动更新用）。
///
/// 调用方**必须先校验 sha256**：这里一旦发出 Intent，字节就交给系统
/// PackageInstaller 了，本函数无法再做任何把关。
#[tauri::command]
pub fn install_apk(app: tauri::AppHandle, path: String) -> Result<(), String> {
    open_local_file(app, path, Some("application/vnd.android.package-archive".into()))
}
```

> `android_open` 的具体实现照 Task 1 Step 2 的结论写（FileProvider authority
> 与 `run_mobile_plugin` / JNI 的选择取决于那一步查到什么）。
> **不要凭记忆写 Intent 代码** —— `lib.rs:59-71` 记着的那条教训就是
> 「以为插件 JS API 会走安卓分支，结果它在所有平台都走 `open` crate」。

- [ ] **Step 2: 在 `lib.rs` 注册**

```rust
// 文件头，与 native_rtc 并列
mod local_file;

// invoke_handler 的两个分支都要带上新命令
// （:111 的 linux 分支与 :128 的 not(linux) 分支，invoke_handler 只认最后一次调用）
#[cfg(target_os = "linux")]
let builder = builder.invoke_handler(tauri::generate_handler![
    open_external,
    local_file::open_local_file,
    local_file::install_apk,
    native_rtc::native_rtc_available,
    // …其余 native_rtc 命令原样保留
]);

#[cfg(not(target_os = "linux"))]
let builder = builder.invoke_handler(tauri::generate_handler![
    open_external,
    local_file::open_local_file,
    local_file::install_apk
]);
```

- [ ] **Step 3: 写前端 `fileSink` 实现**

`apps/desktop/src/fileSink.ts`：

```ts
/**
 * fileSink 的 Tauri 实现（桌面 + 安卓共用）。
 *
 * 落盘位置：下载产物进系统/应用的 Download 目录，outbox 副本进 AppLocalData。
 * 安卓上 Download 解析到应用私有的 external files 目录，**无需任何权限**
 * （项目约定权限申请须应用内自绘，能不申请就不申请）。
 */
import { BaseDirectory, writeFile, readFile, remove, exists, mkdir } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { setFileSink, uniqueFileName, type SinkDir } from "@yuanchat/shared";

/** 下载产物与 outbox 副本分目录放，清理策略不同（下载不清，outbox 发完即清） */
const DIRS: Record<SinkDir, { base: BaseDirectory; sub: string }> = {
  downloads: { base: BaseDirectory.Download, sub: "" },
  appdata: { base: BaseDirectory.AppLocalData, sub: "outbox" },
};

function pathOf(dir: SinkDir, fileName: string): string {
  const { sub } = DIRS[dir];
  return sub ? `${sub}/${fileName}` : fileName;
}

/** 在 app 入口调用一次，把 Tauri 实现装进 shared 的注入点 */
export function installFileSink(): void {
  setFileSink({
    async save(bytes, fileName, _mime, dir = "downloads") {
      const { base, sub } = DIRS[dir];
      if (sub) await mkdir(sub, { baseDir: base, recursive: true });

      // 同名避让：静默覆盖用户已有的下载是不可逆的
      let finalName = fileName;
      if (dir === "downloads") {
        const takenCache = new Map<string, boolean>();
        for (let probe = fileName, i = 0; i < 100; i += 1) {
          const hit = await exists(pathOf(dir, probe), { baseDir: base });
          takenCache.set(probe, hit);
          if (!hit) break;
          probe = uniqueFileName(fileName, (n) => takenCache.get(n) ?? n === probe);
        }
        finalName = uniqueFileName(fileName, (n) => takenCache.get(n) === true);
      }

      await writeFile(pathOf(dir, finalName), bytes, { baseDir: base });
      return finalName;
    },

    async read(fileName, dir) {
      const { base } = DIRS[dir];
      return readFile(pathOf(dir, fileName), { baseDir: base });
    },

    async remove(fileName, dir) {
      const { base } = DIRS[dir];
      await remove(pathOf(dir, fileName), { baseDir: base });
    },

    async reveal(path) {
      // 由 Rust 侧转一手：安卓的私有目录 file:// URI 不能跨应用传，
      // 必须经 FileProvider 换成 content:// 并授读权限
      await invoke("open_local_file", { path });
    },
  });
}
```

> **简化点**：`save` 里的同名探测是「最多探 100 次」的朴素循环。
> `// ponytail: 线性探测上限 100，同名文件真超过 100 个再说` 这类注释按需加。

- [ ] **Step 4: 在 `main.tsx` 注入**

```ts
// 紧跟既有的 __TAURI_INTERNALS__ 判断块（:34 附近），与 setUrlOpener / setNotifier 并列
if ("__TAURI_INTERNALS__" in window) {
  const { installFileSink } = await import("./fileSink");
  installFileSink();
}
```

- [ ] **Step 5: 补 capabilities（标识符从 schema 核实，不猜）**

```bash
# 先核实 fs 的权限标识符与作用域写法
python3 -I -c "
import json,re
d=json.load(open('apps/desktop/src-tauri/gen/schemas/desktop-schema.json'))
s=json.dumps(d)
print(sorted(set(re.findall(r'\"(fs:allow-[a-z\-]*(?:write|read|exists|mkdir|remove)[a-z\-]*)\"', s)))[:30])
print([i for i in sorted(set(re.findall(r'\"(fs:[a-z\-]*(?:download|appdata|applocaldata)[a-z\-]*)\"', s)))][:30])
"
```

把核实到的标识符加进 `capabilities/default.json`（fs 在桌面与移动端都要）
与 `capabilities/mobile.json`。`core:` 前缀的命令权限（`open_local_file`
是自定义命令，不需要 capability）无需登记。

- [ ] **Step 6: 跑类型检查与现有测试**

```bash
cd apps/desktop && npx tsc --noEmit && cd ../..
cd apps/desktop/src-tauri && cargo check 2>&1 | tail -20 && cd ../../..
LANG=C.UTF-8 pnpm test
```

Expected: 全绿。`cargo check` 的错误多半来自 `ensure_app_owned` 里
`app.path()` 各方法的返回类型，按编译器提示修。

- [ ] **Step 7: Commit**

```bash
git add apps/desktop
git commit -m "feat(download): 桌面与安卓的 fileSink 落盘实现，新增 open_local_file 命令

下载落应用 Download 目录（安卓解析到私有 external files，零权限），
outbox 副本落 AppLocalData。

open_local_file 把路径卡死在应用自有目录之下并经 canonicalize 比对 ——
不卡等于把「打开任意本地文件」交给 WebView 里的代码，
与 open_external 把 scheme 卡死在 http(s) 是同一个顾虑。
install_apk 复用同一个 Intent，只换 mime type。"
```

### Task 7: 文件气泡进度条 UI + 相册页接线

**Files:**

- Create: `packages/ui/src/chat/FileProgressBar.tsx`
- Modify: `packages/ui/src/chat/MessageBubble.tsx:546-570`
- Modify: `packages/ui/src/chat/ConversationMediaView.tsx:199`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/design-system/src/i18n/locales/{zh-CN,en-US,ja-JP,ko-KR}.json`
- Test: `packages/ui/src/__tests__/FileProgressBar.test.tsx`、`apps/web/e2e/download-progress.spec.ts`

**Interfaces:**

- Consumes: Task 4 的 `useDownloadStore` / `startDownload` / `cancelDownload`、Task 5 的 `getFileSink`
- Produces: `<FileProgressBar messageId={string} />` —— 全状态保留固定进度空间

**2026-11-05 修订**：以下 Step 1 / Step 3 是旧实现蓝本，空态/完成态返回 `null` 的方案
已作废；它会在下载开始和结束时改变消息行高。当前修复须让 idle、downloading、saving、
failed、canceled、done 共用固定占位，并在真实浏览器比较后续消息的位置，不以空 DOM 断言零 CLS。
实际行为以当前 `FileProgressBar.tsx`、`FileProgressBar.test.tsx` 与 `download-progress.spec.ts` 回归为准。

- [ ] **Step 1: 写组件单测**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useDownloadStore } from "@yuanchat/shared";
import { FileProgressBar } from "../chat/FileProgressBar";

function seed(id: string, e: Partial<ReturnType<typeof entry>>) {
  useDownloadStore.setState({ entries: { [id]: entry(e) } });
}
function entry(e: Partial<{ phase: string; received: number; total: number }>) {
  return { phase: "downloading", received: 0, total: 0, ...e } as never;
}

it("历史空态示例（已由 2026-11-05 固定占位修订替代）", () => {
  useDownloadStore.setState({ entries: {} });
  const { container } = render(<FileProgressBar messageId="none" />);
  expect(container).toBeEmptyDOMElement();
});

it("有 total 时按百分比给出 aria-valuenow", () => {
  seed("m1", { phase: "downloading", received: 30, total: 120 });
  render(<FileProgressBar messageId="m1" />);
  const bar = screen.getByRole("progressbar");
  expect(bar).toHaveAttribute("aria-valuenow", "25");
});

it("total 为 0 时是不确定态，不给 aria-valuenow", () => {
  seed("m2", { phase: "downloading", received: 999, total: 0 });
  render(<FileProgressBar messageId="m2" />);
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
});

it("failed 态显示错误文案", () => {
  useDownloadStore.setState({
    entries: {
      m3: {
        phase: "failed",
        received: 10,
        total: 20,
        errorKey: "chat.file.downloadFailed",
      } as never,
    },
  });
  render(<FileProgressBar messageId="m3" />);
  expect(screen.getByText(/下载失败|download/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行确认失败**

```bash
LANG=C.UTF-8 pnpm --filter @yuanchat/ui test -- FileProgressBar
```

Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 `FileProgressBar.tsx`**

```tsx
/**
 * FileProgressBar — 文件气泡下方的下载进度条。
 *
 * @description
 * 刻意放在**气泡之外**：进度条有最小宽度诉求，放气泡内会向上贡献 min-content，
 * 再踩一次「气泡顶穿父列」那个坑（min-width:0 只解除本元素的最小尺寸，
 * 压不住子孙贡献上来的 min-content）。本行用 `w-full`，宽度由父列正推为定值。
 *
 * 样式语言与桌面端更新进度条（UpdateChecker）一致，不另造一套。
 */
import { useTranslation } from "react-i18next";
import { useDownloadStore } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";

/** 把字节数格式化成 1.2 MB 这样的短标签 */
function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function FileProgressBar({ messageId }: { messageId: string }) {
  const { t } = useTranslation();
  const entry = useDownloadStore((s) => s.entries[messageId]);

  // 历史示例已作废：这些 return null 会改变行高，当前实现须保留同一固定占位。
  if (!entry) return null;
  if (entry.phase === "done" || entry.phase === "canceled") return null;

  const determinate = entry.total > 0;
  const percent = determinate ? Math.min(100, Math.round((entry.received / entry.total) * 100)) : 0;
  const failed = entry.phase === "failed";

  return (
    <div className="mt-1 w-full">
      <div
        role="progressbar"
        aria-label={t("chat.file.downloading")}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(determinate ? { "aria-valuenow": percent } : {})}
        className="bg-surface-container-highest h-1.5 overflow-hidden rounded-full"
      >
        <div
          className={cn(
            "h-full transition-all duration-200",
            failed ? "bg-error" : "bg-primary",
            !determinate && !failed && "animate-pulse",
          )}
          style={{
            width: determinate || failed ? `${Math.max(percent, failed ? 100 : 0)}%` : "40%",
          }}
        />
      </div>
      <p className="text-label-xs text-on-surface-variant mt-0.5">
        {failed
          ? t(entry.errorKey ?? "chat.file.downloadFailed")
          : entry.phase === "saving"
            ? t("chat.file.saving")
            : determinate
              ? `${percent}% · ${humanSize(entry.received)} / ${humanSize(entry.total)}`
              : humanSize(entry.received)}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: 接 `MessageBubble` 的下载按钮**

把 `:546-570` 的 `onClick` 从「签 URL → openExternal」换成按阶段分流：

```tsx
// 文件气泡的按钮区（原来只有一个 Download 按钮）
{
  (() => {
    const entry = downloadEntries[msg.id];
    const phase = entry?.phase;
    const key = msg.file?.key;
    const name = msg.file?.name;

    // downloading / saving → 取消；failed → 重试；done 且有路径 → 打开；其余 → 下载
    const onClick = () => {
      if (!key || !name) return;
      if (phase === "downloading" || phase === "saving") {
        cancelDownload(msg.id);
        return;
      }
      if (phase === "done" && entry?.savedPath) {
        const reveal = getFileSink().reveal;
        // web 实现没有 reveal：浏览器自己的下载目录不由我们管，按钮也不会是这个态
        if (reveal)
          void reveal(entry.savedPath).catch(() => showToast("error", t("chat.file.openFailed")));
        return;
      }
      void startDownload(msg.id, key, name);
    };

    const Icon =
      phase === "downloading" || phase === "saving"
        ? X
        : phase === "failed"
          ? RefreshCw
          : phase === "done" && entry?.savedPath
            ? FolderOpen
            : Download;

    return (
      <button
        aria-label={t(
          phase === "downloading" || phase === "saving"
            ? "common.cancel"
            : phase === "failed"
              ? "common.retry"
              : phase === "done"
                ? "chat.file.open"
                : "file.download",
        )}
        onClick={onClick}
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
          isSelf
            ? "bg-white/15 text-white hover:bg-white/25"
            : "bg-primary-container text-primary-on-container hover:opacity-85",
        )}
      >
        <Icon size={15} />
      </button>
    );
  })();
}
```

`downloadEntries` 在组件顶部取一次：
`const downloadEntries = useDownloadStore((s) => s.entries);`

进度条挂在气泡**外层**（与气泡同级、在它下面）：

```tsx
{
  /* 气泡行之后 */
}
{
  msg.kind === "file" && <FileProgressBar messageId={msg.id} />;
}
```

`X` / `RefreshCw` / `FolderOpen` 加进该文件顶部的 lucide import。

- [ ] **Step 5: 接 `ConversationMediaView.tsx:199`**

同一套：把 `.then((url) => openExternal(url))` 换成
`void startDownload(item.messageId, item.key, item.name)`，
并在条目下方渲染 `<FileProgressBar messageId={item.messageId} />`。

- [ ] **Step 6: 四语新增文案**

| key                     | zh-CN            | en-US            | ja-JP                  | ko-KR                    |
| ----------------------- | ---------------- | ---------------- | ---------------------- | ------------------------ |
| `chat.file.downloading` | 正在下载         | Downloading      | ダウンロード中         | 다운로드 중              |
| `chat.file.saving`      | 正在保存         | Saving           | 保存中                 | 저장 중                  |
| `chat.file.open`        | 打开文件         | Open file        | ファイルを開く         | 파일 열기                |
| `chat.file.openFailed`  | 打开失败         | Failed to open   | 開けませんでした       | 열기 실패                |
| `chat.file.savedTo`     | 已保存到 %{path} | Saved to %{path} | %{path} に保存しました | %{path}에 저장되었습니다 |

> `chat.file.downloadFailed`、`common.cancel`、`common.retry`、`file.download`
> 都已存在，**先 grep 确认再决定要不要新增**，重复定义会被 `check-i18n` 判重。
> 占位符是 `%{path}`，不是 `{{path}}`。

- [ ] **Step 7: 写 E2E 量真实尺寸**

`apps/web/e2e/download-progress.spec.ts`：

```ts
import { test, expect } from "@playwright/test";

// 按 MASTER_PLAN §2.12 的教训：宽度/溢出类断言一律量真实 getBoundingClientRect，
// 不要只断言类名 —— JSDOM 不做布局，offsetWidth 恒为 0，气泡宽度那个 bug
// 就是「单测全绿、真机照穿」三次。
test.describe("文件下载进度条", () => {
  test.use({ viewport: { width: 412, height: 915 } });

  test("进度条不超出气泡所在列的宽度", async ({ page }) => {
    await page.goto("/chat");
    // 走到一条文件消息（mock 数据里应有；没有则先发一条）
    const bubble = page.locator('[data-testid="file-bubble"]').first();
    await expect(bubble).toBeVisible();

    await bubble.getByRole("button", { name: /下载|download/i }).click();

    const bar = page.getByRole("progressbar").first();
    await expect(bar).toBeVisible();

    const barBox = await bar.boundingBox();
    const colBox = await bubble.locator("xpath=..").boundingBox();
    expect(barBox).not.toBeNull();
    expect(colBox).not.toBeNull();
    expect(barBox!.width).toBeLessThanOrEqual(colBox!.width + 1);
  });
});
```

> `data-testid="file-bubble"` 若 `MessageBubble` 还没有，在 Step 4 顺手加上
> —— E2E 靠类名定位会随样式漂移。

- [ ] **Step 8: 跑全部测试**

```bash
node scripts/check-i18n.mjs
LANG=C.UTF-8 pnpm test
cd apps/web && npx tsc --noEmit && cd ../desktop && npx tsc --noEmit && cd ../..
pnpm --filter @yuanchat/web test:e2e -- download-progress
```

Expected: 全绿。

- [ ] **Step 9: 变异验证（确认 E2E 真的能挡住回归）**

临时把 `FileProgressBar` 外层的 `w-full` 删掉并给进度条一个
`min-w-[500px]`，重跑 E2E，确认那条用例**变红**，然后改回来。
测不出失败的测试等于没有测试。

- [ ] **Step 10: Commit**

```bash
git add packages apps/web/e2e
git commit -m "feat(chat): 文件下载改为应用内完成并在气泡下方显示确定性进度条

点下载不再跳出应用：桌面与安卓落到应用自己的下载目录并可一键打开，
Web 端走 <a download>。按钮按阶段分流为 下载/取消/重试/打开。

进度条放在气泡外层并用 w-full：放气泡内会向上贡献 min-content，
再踩一次「气泡顶穿父列」那个坑。E2E 在 412px 视口量真实
getBoundingClientRect 钉死这一点，已做变异验证。"
```

### Task 8: outbox 落盘，收掉「安卓重启后重试报本地文件已失效」

**Files:**

- Modify: `packages/shared/src/store/outboxSync.ts`
- Modify: `packages/shared/src/api/files.ts`（发送前落盘的挂钩点）
- Test: `packages/shared/src/__tests__/outboxSync.test.ts`

**Interfaces:**

- Consumes: Task 5 的 `getFileSink()`（`save` / `read` / `remove` 的 `appdata` 分支）
- Produces: 无新对外接口

- [ ] **Step 1: 读清现状**

```bash
grep -n "localUrl\|blob\|失效\|revoke" packages/shared/src/store/outboxSync.ts packages/shared/src/store/messageStore.ts | head -30
grep -rn "本地文件已失效\|localFileGone" packages/shared/src packages/design-system/src/i18n/locales/zh-CN.json
```

把「blob 从哪来、重试时从哪读」这条链路先理清再动手 —— 这是本 Task 唯一的难点。

- [ ] **Step 2: 写失败的测试**

```ts
it("应用重启后 blob 失效，重试仍能从磁盘副本读回字节", async () => {
  const disk = new Map<string, Uint8Array>();
  setFileSink({
    save: async (bytes, name, _m, dir) => {
      disk.set(`${dir}/${name}`, bytes);
      return name;
    },
    read: async (name, dir) => {
      const hit = disk.get(`${dir}/${name}`);
      if (!hit) throw new Error("ENOENT");
      return hit;
    },
    remove: async (name, dir) => {
      disk.delete(`${dir}/${name}`);
    },
  });

  // 发送：字节应同时落盘
  const clientMsgId = "c-1";
  await stageOutboxFile(clientMsgId, new Uint8Array([7, 8, 9]), "a.pdf", "application/pdf");
  expect(disk.has(`appdata/a.pdf`)).toBe(true);

  // 模拟重启：blob URL 全失效，只剩磁盘副本
  const bytes = await readStagedOutboxFile(clientMsgId, "a.pdf");
  expect(Array.from(bytes)).toEqual([7, 8, 9]);

  // 发送成功后清理
  await clearStagedOutboxFile(clientMsgId, "a.pdf");
  expect(disk.has(`appdata/a.pdf`)).toBe(false);
});
```

- [ ] **Step 3: 实现三个辅助并接进发送路径**

在 `packages/shared/src/download/fileSink.ts` 旁新增（或放进 `outboxSync.ts`，
取决于 Step 1 读到的现有结构）：

```ts
/**
 * 发送前把字节落到应用私有目录，重试从那里读。
 *
 * 为什么必须落盘：安卓用文件选择器选出来的 blob 在应用重启后**必然失效**，
 * 此时「重试」只能如实报「本地文件已失效」—— 对用户就是消息永久卡住。
 *
 * 清理策略：发送成功即删，不引入 LRU 配额。outbox 条目本来就短命，
 * 给它配一套配额账本是无谓的基建。web 端 sink 没有 save 之外的方法，
 * 这三个函数在 web 上是 no-op（web 不会遇到 blob 失效：页面活着 blob 就活着）。
 */
export async function stageOutboxFile(
  clientMsgId: string,
  bytes: Uint8Array,
  fileName: string,
  mime: string,
): Promise<void> {
  const sink = getFileSink();
  if (!sink.read) return; // web：没有磁盘，不落
  await sink.save(bytes, `${clientMsgId}-${fileName}`, mime, "appdata");
}

export async function readStagedOutboxFile(
  clientMsgId: string,
  fileName: string,
): Promise<Uint8Array> {
  const sink = getFileSink();
  if (!sink.read) throw new Error("no disk sink");
  return sink.read(`${clientMsgId}-${fileName}`, "appdata");
}

export async function clearStagedOutboxFile(clientMsgId: string, fileName: string): Promise<void> {
  const sink = getFileSink();
  if (!sink.remove) return;
  // 清理失败不能让「发送成功」回退成失败：最坏结果只是多占一点私有目录空间
  await sink.remove(`${clientMsgId}-${fileName}`, "appdata").catch(() => {});
}
```

接线三处：发送文件/图片/语音时调 `stageOutboxFile`；重试时 blob 读失败则回落
`readStagedOutboxFile`；收到服务端 ack 后调 `clearStagedOutboxFile`。
三处的确切位置按 Step 1 读到的结构定。

- [ ] **Step 4: 运行测试**

```bash
LANG=C.UTF-8 pnpm --filter @yuanchat/shared test -- outbox
cd apps/web && npx tsc --noEmit && cd ../desktop && npx tsc --noEmit && cd ../..
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "fix(chat): 发送前把文件字节落应用私有目录，重试不再死在失效的 blob 上

安卓用文件选择器选出来的 blob 在应用重启后必然失效，此时重试只能如实报
「本地文件已失效」—— 对用户就是消息永久卡住。改为发送前落盘、
重试从磁盘读、收到 ack 即删。不引 LRU 配额：outbox 条目本来就短命。"
```

---

## Stage C — W3 命令面板 + 搜索体验重做

### Task 9: 后端加类型过滤与文件名检索 + 转义 LIKE 通配符

**Files:**

- Create: `server/internal/database/migrations/022_message_name_search_index.sql`
- Modify: `server/internal/repository/message_repo.go:313-355`
- Test: `server/internal/repository/message_repo_test.go`

**Interfaces:**

- Consumes: 无
- Produces: `MessageRepository.Search(ctx, userID, query, convID *uuid.UUID, types []int, beforeTime *time.Time, limit int) ([]SearchResult, error)`
  —— **`types` 插在 `convID` 之后**。调用方（`message_service.go`）同步改。

- [ ] **Step 1: 写失败的测试**

```go
// Review Focus #1：LIKE 通配符必须按字面量搜。
// 现状 message_repo.go:343 直接拼 "%"+query+"%"，用户搜一个 % 就等于全表扫；
// 本 Task 给检索条件加了文件名 OR 分支后这个代价还要翻倍。
func TestSearch_LikeWildcardsAreLiteral(t *testing.T) {
	db := testutil.NewDB(t)
	repo := repository.NewMessageRepository(db)
	ctx := context.Background()

	u, conv := seedSearchFixture(t, db)
	seedTextMessage(t, db, conv, u, "季度报告 100% 完成")
	seedTextMessage(t, db, conv, u, "无关消息甲")
	seedTextMessage(t, db, conv, u, "无关消息乙")

	// 搜 "%" 字面量：只应命中那条真含百分号的
	got, err := repo.Search(ctx, u.ID, "100%", nil, nil, nil, 20)
	require.NoError(t, err)
	require.Len(t, got, 1)
	require.Contains(t, got[0].Content, "100%")

	// 单独搜一个 "%" 不应该把全部消息都捞出来
	got, err = repo.Search(ctx, u.ID, "%%%", nil, nil, nil, 20)
	require.NoError(t, err)
	require.Empty(t, got, "通配符被当成模式解释了，三条消息全被捞出来")

	// 下划线同理（LIKE 里 _ 匹配任意单字符）
	seedTextMessage(t, db, conv, u, "a_b 的配置")
	got, err = repo.Search(ctx, u.ID, "a_b", nil, nil, nil, 20)
	require.NoError(t, err)
	require.Len(t, got, 1)
}

func TestSearch_MatchesFileName(t *testing.T) {
	db := testutil.NewDB(t)
	repo := repository.NewMessageRepository(db)
	ctx := context.Background()

	u, conv := seedSearchFixture(t, db)
	seedFileMessage(t, db, conv, u, "季度财报.xlsx")
	seedTextMessage(t, db, conv, u, "纯文本消息")

	// 文件名此前压根没进 WHERE —— 这是「搜不到文件」的根因
	got, err := repo.Search(ctx, u.ID, "财报", nil, nil, nil, 20)
	require.NoError(t, err)
	require.Len(t, got, 1)
	require.Equal(t, model.MessageTypeFile, got[0].MessageType)
}

func TestSearch_TypeFilter(t *testing.T) {
	db := testutil.NewDB(t)
	repo := repository.NewMessageRepository(db)
	ctx := context.Background()

	u, conv := seedSearchFixture(t, db)
	seedFileMessage(t, db, conv, u, "报告.pdf")
	seedTextMessage(t, db, conv, u, "报告写完了")

	onlyFiles, err := repo.Search(ctx, u.ID, "报告", nil, []int{int(model.MessageTypeFile)}, nil, 20)
	require.NoError(t, err)
	require.Len(t, onlyFiles, 1)
	require.Equal(t, model.MessageTypeFile, onlyFiles[0].MessageType)

	// 空 types 表示不过滤
	all, err := repo.Search(ctx, u.ID, "报告", nil, nil, nil, 20)
	require.NoError(t, err)
	require.Len(t, all, 2)
}

func TestSearch_E2EEStillExcludedWithTypeFilter(t *testing.T) {
	db := testutil.NewDB(t)
	repo := repository.NewMessageRepository(db)
	ctx := context.Background()

	u, conv := seedSearchFixture(t, db)
	seedE2EEMessage(t, db, conv, u)

	// 加过滤不能顺手放宽可见性口径
	got, err := repo.Search(ctx, u.ID, "a", nil, []int{int(model.MessageTypeE2EE)}, nil, 20)
	require.NoError(t, err)
	require.Empty(t, got)
}
```

> `seedSearchFixture` / `seedTextMessage` / `seedFileMessage` / `seedE2EEMessage`
> 照该测试文件已有的夹具写法补；**夹具必须自清理**（`t.Cleanup`），
> 这个包的测试直连 dev Postgres，不清理会像 H1b 那次一样把测试数据泄进真实列表。

- [ ] **Step 2: 运行确认失败**

```bash
cd server && go test ./internal/repository/ -run "TestSearch_" -v 2>&1 | tail -30
```

Expected: 编译失败（`Search` 签名少一个参数）。补上参数后 `LikeWildcards`
与 `MatchesFileName` 两条断言失败。

- [ ] **Step 3: 写迁移 022**

```sql
-- +goose NO TRANSACTION

-- +goose Up
-- +goose StatementBegin
-- 文件名检索：图片/文件/视频的原始名字存在 content->>'name'，
-- 而 003 的 trgm 索引只建在 content->>'text' 上 —— 这就是「搜不到文件」的根因。
-- partial 条件与 003 保持一致，否则 planner 合并两个索引时会走到不同的可见性口径。
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_name_trgm
    ON messages USING gin ((content->>'name') gin_trgm_ops)
    WHERE deleted_at IS NULL AND status = 1;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX CONCURRENTLY IF EXISTS idx_messages_name_trgm;
-- +goose StatementEnd
```

- [ ] **Step 4: 改 `message_repo.go`**

```go
// escapeLike 转义 LIKE/ILIKE 的模式元字符，让用户输入按字面量匹配。
//
// 不转义的话用户搜一个 "%" 就等于 "ILIKE '%%%'"，把整张表捞出来；
// "_" 同理（LIKE 里它匹配任意单字符）。PostgreSQL 的 LIKE 默认转义符就是反斜杠，
// 所以只需在三个元字符前加反斜杠，无需额外的 ESCAPE 子句。
func escapeLike(s string) string {
	var b strings.Builder
	b.Grow(len(s) + 8)
	for _, r := range s {
		if r == '\\' || r == '%' || r == '_' {
			b.WriteRune('\\')
		}
		b.WriteRune(r)
	}
	return b.String()
}

// Search 按关键词搜索当前用户有权访问的消息（pg_trgm GIN 加速）。
//
// 检索范围是正文（content->>'text'）**与文件名**（content->>'name'）——
// 图片/文件/视频的名字在后者，先前只查正文，故「搜不到文件」。
// 两个 ILIKE 走 OR，planner 以 BitmapOr 合并 003 与 022 两个 GIN 索引。
//
// types 非空时限定消息类型（对应前端的「文件/图片/视频/语音」筛选器）；
// 为空表示不过滤。E2EE 消息无论如何都排除 —— 服务端读不了密文，
// 加过滤不能顺手放宽这条口径。
//
// convID 非 nil 时限定单个会话；beforeTime 是翻页游标；
// 最少 3 个字符才命中 GIN 索引，更短由 service 层拒绝。
func (r *MessageRepository) Search(
	ctx context.Context,
	userID uuid.UUID,
	query string,
	convID *uuid.UUID,
	types []int,
	beforeTime *time.Time,
	limit int,
) ([]SearchResult, error) {
	pattern := "%" + escapeLike(query) + "%"

	q := r.db.WithContext(ctx).
		Table("messages m").
		Select("m.*, u.nickname AS sender_nickname, u.avatar_url AS sender_avatar_url, c.name AS conv_name").
		Joins("JOIN users u ON u.id = m.sender_id").
		Joins("JOIN conversations c ON c.id = m.conversation_id").
		Joins("JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?", userID).
		Where("m.deleted_at IS NULL AND m.status = ?", model.MessageStatusNormal).
		Where("m.message_type != ?", model.MessageTypeE2EE).
		Where(
			"((m.content->>'text') ILIKE ? OR (m.content->>'name') ILIKE ?)",
			pattern, pattern,
		)

	if convID != nil {
		q = q.Where("m.conversation_id = ?", *convID)
	}
	if len(types) > 0 {
		q = q.Where("m.message_type IN ?", types)
	}
	if beforeTime != nil {
		q = q.Where("m.created_at < ?", beforeTime)
	}

	var rows []SearchResult
	err := q.Order("m.created_at DESC").Limit(limit).Scan(&rows).Error
	for i := range rows {
		rows[i].EditedAt = utcTimePtr(rows[i].EditedAt)
	}
	return rows, err
}
```

- [ ] **Step 5: 改调用方并跑测试**

```bash
cd server && go build ./... 2>&1 | head   # 会指出 message_service.go 的调用点
```

`message_service.go` 的 `Search` 加 `types []int` 参数并透传。然后：

```bash
cd server && go vet ./... && go test ./internal/repository/ -run "TestSearch_" -v 2>&1 | tail -20
```

Expected: 四条全 PASS。

- [ ] **Step 6: 跑全量后端测试**

```bash
cd server && go test ./... 2>&1 | tail -20
```

Expected: 全绿。

- [ ] **Step 7: Commit**

```bash
git add server/
git commit -m "feat(search): 检索范围扩到文件名并加类型过滤，LIKE 通配符按字面量匹配

「搜不到文件」的根因：检索条件只有 content->>'text'，而图片/文件/视频的
原始名字在 content->>'name'，压根没进 WHERE，003 的 trgm 索引也只建在正文上。
迁移 022 给文件名补一个同形状的 GIN 索引，两个 ILIKE 走 OR 让 planner BitmapOr。

顺手修掉一个既有缺陷：用户输入直接拼进 LIKE 模式，搜一个 % 就是全表扫。
加了文件名 OR 分支后这个代价会翻倍，所以必须同批转义。"
```

### Task 10: 搜索 API 接类型参数 + MSW 四态

**Files:**

- Modify: `server/internal/handler/message.go:387-435`
- Modify: `packages/shared/src/api/search.ts`
- Modify: `packages/shared/src/mocks/handlers.ts`
- Test: `server/internal/handler/message_test.go`

**Interfaces:**

- Consumes: Task 9 的 `Search(..., types []int, ...)`
- Produces:
  - HTTP：`GET /api/v1/messages/search?q=&conversation_id=&types=file,image&before=&limit=`
  - TS：`searchMessages({ q, conversation_id?, types?: SearchType[], before?, limit? })`，
    `type SearchType = "text" | "image" | "file" | "voice" | "video" | "sticker"`
  - TS：`MessageSearchResult` 新增 `message_type: number` 与可选 `file_name?: string`

- [ ] **Step 1: 写 handler 测试**

```go
func TestSearch_RejectsUnknownType(t *testing.T) {
	// 未知类型必须 400 而非静默忽略 —— 静默忽略会让前端以为筛选生效了，
	// 用户看到的是「筛了文件却还是混着文本」
	w := doGet(t, "/api/v1/messages/search?q=abc&types=file,banana", tokenOf(t, u))
	require.Equal(t, http.StatusBadRequest, w.Code)
}

func TestSearch_AcceptsKnownTypes(t *testing.T) {
	w := doGet(t, "/api/v1/messages/search?q=abc&types=file,image,video", tokenOf(t, u))
	require.Equal(t, http.StatusOK, w.Code)
}

func TestSearch_EmptyTypesMeansNoFilter(t *testing.T) {
	w := doGet(t, "/api/v1/messages/search?q=abc", tokenOf(t, u))
	require.Equal(t, http.StatusOK, w.Code)
}
```

> `doGet` / `tokenOf` 照该 handler 测试文件已有的冒烟辅助写法用，不新建。

- [ ] **Step 2: 运行确认失败**

```bash
cd server && go test ./internal/handler/ -run "TestSearch_" -v
```

Expected: `RejectsUnknownType` 失败（当前返 200，`types` 参数压根没读）。

- [ ] **Step 3: 改 handler**

```go
// searchTypeNames 把对外的类型名映射到内部 message_type。
//
// 对外用名字而不是裸数字：数字是内部实现细节，写进 URL 就固化成了契约，
// 以后插一个新类型会把客户端的 URL 全打乱。
var searchTypeNames = map[string]model.MessageType{
	"text":    model.MessageTypeText,
	"image":   model.MessageTypeImage,
	"file":    model.MessageTypeFile,
	"voice":   model.MessageTypeVoice,
	"video":   model.MessageTypeVideo,
	"sticker": model.MessageTypeSticker,
}

// 在 Search() 里，紧随 q 的校验之后：
	var types []int
	if raw := strings.TrimSpace(c.Query("types")); raw != "" {
		for _, name := range strings.Split(raw, ",") {
			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}
			mt, ok := searchTypeNames[name]
			if !ok {
				// 不静默忽略：前端会以为筛选生效了
				BadRequest(c, "unknown message type: "+name)
				return
			}
			types = append(types, int(mt))
		}
	}
```

并把 `types` 透传进 `h.svc.Search(...)`。
`@Param types query string false "类型过滤（逗号分隔：text,image,file,voice,video,sticker）"`
加进该 handler 的注解注释（本仓既有约定，允许写注解禁止引 swaggo 依赖）。

- [ ] **Step 4: 改 TS API**

```ts
/** 搜索类型筛选，与后端 searchTypeNames 一一对应 */
export type SearchType = "text" | "image" | "file" | "voice" | "video" | "sticker";

export interface MessageSearchResult {
  message_id: string;
  conversation_id: string;
  conv_name: string;
  sender_nickname: string;
  excerpt: string;
  created_at: string;
  seq: number;
  /** 消息类型（对应 model.MessageType），前端据此分组与选图标 */
  message_type: number;
  /** 文件/图片/视频的原始文件名；文本消息为空 */
  file_name?: string;
  /** 对象键，用于出缩略图；文本消息为空 */
  object_key?: string;
}

export async function searchMessages(params: {
  q: string;
  conversation_id?: string;
  types?: SearchType[];
  before?: string;
  limit?: number;
}): Promise<MessageSearchResponse> {
  const qs = new URLSearchParams({ q: params.q });
  if (params.conversation_id) qs.set("conversation_id", params.conversation_id);
  if (params.types?.length) qs.set("types", params.types.join(","));
  if (params.before) qs.set("before", params.before);
  if (params.limit) qs.set("limit", String(params.limit));
  return apiGet<MessageSearchResponse>("/api/v1/messages/search?" + qs.toString());
}
```

> 后端的 `SearchResult` 投影要带上 `message_type`、`file_name`、`object_key`
> 三个字段（前两个从 `content` 里取，`SELECT` 加
> `m.content->>'name' AS file_name, m.content->>'key' AS object_key`）。
> **先 grep 确认 `content` 里存的键名是 `key` 还是 `object_key`**，不要猜。

- [ ] **Step 5: MSW 覆盖四态**

`packages/shared/src/mocks/handlers.ts` 的 `/messages/search` handler：

```ts
// 正常：按 types 过滤 mock 数据并带上 message_type / file_name / object_key
// 空：q 含 "nomatch" 时返 { results: [], has_more: false }
// 错误：q 含 "boom" 时返 500
// 加载：q 含 "slow" 时 await delay(1500) 再返
http.get("http://localhost:8085/api/v1/messages/search", async ({ request }) => {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const types = (url.searchParams.get("types") ?? "").split(",").filter(Boolean);

  if (q.includes("boom")) return new HttpResponse(null, { status: 500 });
  if (q.includes("slow")) await delay(1500);
  if (q.includes("nomatch")) return HttpResponse.json({ data: { results: [], has_more: false } });

  const all = mockSearchResults;
  const filtered = types.length
    ? all.filter((r) => types.includes(typeNameOf(r.message_type)))
    : all;
  return HttpResponse.json({ data: { results: filtered, has_more: false } });
});
```

`mockSearchResults` 至少含一条 text、一条 file、一条 image（image 带 `object_key`
以便缩略图路径也被 mock 覆盖）。`typeNameOf` 是本地小函数，与后端映射表同构。

- [ ] **Step 6: 跑测试**

```bash
cd server && go vet ./... && go test ./... && cd ..
LANG=C.UTF-8 pnpm test
cd apps/web && npx tsc --noEmit && cd ../desktop && npx tsc --noEmit && cd ../..
```

Expected: 全绿。

- [ ] **Step 7: Commit**

```bash
git add server packages/shared
git commit -m "feat(search): 搜索端点接类型筛选，响应带消息类型与文件名

对外用类型名而非裸数字：数字是内部实现细节，写进 URL 就固化成契约，
以后插一个新类型会把客户端 URL 全打乱。未知类型返 400 而非静默忽略 ——
静默忽略会让前端以为筛选生效了。MSW 补齐正常/空/错误/加载四态。"
```

### Task 11: `CommandPalette` 组件（一个组件两种模式）

**Files:**

- Create: `packages/ui/src/palette/CommandPalette.tsx`
- Create: `packages/ui/src/palette/paletteActions.ts`
- Create: `packages/ui/src/palette/__tests__/CommandPalette.test.tsx`
- Delete: `packages/ui/src/layout/SearchModal.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/design-system/src/i18n/locales/{zh-CN,en-US,ja-JP,ko-KR}.json`

**Interfaces:**

- Consumes: Task 10 的 `searchMessages` / `SearchType` / `MessageSearchResult`
- Produces:
  - `<CommandPalette show onClose />`
  - `interface PaletteAction { id: string; labelKey: string; icon: LucideIcon; keywords: string[]; run: (ctx: PaletteContext) => void }`
  - `interface PaletteContext { navigate: (to: string) => void; toggleTheme: () => void; logout: () => void; isDesktopApp: boolean }`
  - `buildPaletteActions(ctx: PaletteContext): PaletteAction[]`
  - `filterActions(actions: PaletteAction[], q: string, t: (k: string) => string): PaletteAction[]`

- [ ] **Step 1: 写失败的测试**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { buildPaletteActions, filterActions } from "../paletteActions";
import { CommandPalette } from "../CommandPalette";

const ctx = { navigate: vi.fn(), toggleTheme: vi.fn(), logout: vi.fn(), isDesktopApp: false };

describe("paletteActions", () => {
  it("web 端不包含「检查更新」（没有 updater）", () => {
    const ids = buildPaletteActions(ctx).map((a) => a.id);
    expect(ids).not.toContain("check-update");
  });

  it("桌面端包含「检查更新」", () => {
    const ids = buildPaletteActions({ ...ctx, isDesktopApp: true }).map((a) => a.id);
    expect(ids).toContain("check-update");
  });

  it("按 keywords 匹配，不只按显示文案", () => {
    const actions = buildPaletteActions(ctx);
    const t = (k: string) => k;
    // "theme" 是 keywords 里的词，显示文案是中文「切换主题」
    const hit = filterActions(actions, "theme", t);
    expect(hit.map((a) => a.id)).toContain("toggle-theme");
  });

  it("空查询返回全部动作", () => {
    const actions = buildPaletteActions(ctx);
    expect(filterActions(actions, "", (k) => k)).toHaveLength(actions.length);
  });
});

describe("CommandPalette", () => {
  beforeEach(() => vi.clearAllMocks());

  const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

  it("空输入时渲染动作列表而不是搜索结果", () => {
    wrap(<CommandPalette show onClose={vi.fn()} />);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
  });

  it("↑↓ 移动选中项，aria-selected 跟随", async () => {
    wrap(<CommandPalette show onClose={vi.fn()} />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "{ArrowDown}");
    const opts = screen.getAllByRole("option");
    expect(opts[1]).toHaveAttribute("aria-selected", "true");
    await userEvent.type(input, "{ArrowUp}");
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
  });

  it("Escape 调 onClose", async () => {
    const onClose = vi.fn();
    wrap(<CommandPalette show onClose={onClose} />);
    await userEvent.type(screen.getByRole("combobox"), "{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("输入后进搜索模式并按类别分组渲染", async () => {
    wrap(<CommandPalette show onClose={vi.fn()} />);
    await userEvent.type(screen.getByRole("combobox"), "报告");
    // MSW 的 mockSearchResults 含 text 与 file 两类
    await waitFor(() => {
      expect(screen.getByRole("group", { name: /消息|Messages/i })).toBeInTheDocument();
      expect(screen.getByRole("group", { name: /文件|Files/i })).toBeInTheDocument();
    });
  });

  it("点类型筛选器后请求带上 types 参数", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    wrap(<CommandPalette show onClose={vi.fn()} />);
    await userEvent.type(screen.getByRole("combobox"), "报告");
    await userEvent.click(screen.getByRole("button", { name: /文件|Files/i }));
    await waitFor(() => {
      const urls = spy.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("types=file"))).toBe(true);
    });
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
LANG=C.UTF-8 pnpm --filter @yuanchat/ui test -- CommandPalette
```

Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 `paletteActions.ts`**

```ts
/**
 * 命令面板的动作注册表。
 *
 * @description
 * 单独成文件而不是留在 CommandPalette.tsx 里：组件文件导出非组件会触发
 * eslint `react-refresh/only-export-components`，与 navItems.ts 同一种拆法。
 *
 * 每个动作带一组 `keywords` 供匹配 —— 只按显示文案匹配的话，
 * 中文界面下输入 "theme" 什么都搜不到。刻意**不做**拼音首字母匹配：
 * 中文模糊匹配是个独立课题，不值得在本批里自造一套。
 */
import {
  MessageCircle,
  Users,
  Settings,
  Camera,
  Sticker,
  Star,
  SunMoon,
  LogOut,
  UserPlus,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";

/** 执行动作时需要的宿主能力（面板自己不持有路由与 store） */
export interface PaletteContext {
  navigate: (to: string) => void;
  toggleTheme: () => void;
  logout: () => void;
  /** 桌面 app 内为 true —— 决定「检查更新」这类仅桌面可用的动作是否出现 */
  isDesktopApp: boolean;
  /** 打开桌面端更新检查（仅 isDesktopApp 为 true 时提供） */
  checkUpdate?: () => void;
}

/** 一个可执行的快捷动作 */
export interface PaletteAction {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  /** 额外匹配词（英文/别名），与 labelKey 的译文一起参与匹配 */
  keywords: string[];
  run: (ctx: PaletteContext) => void;
}

/** 按宿主能力构造动作列表 */
export function buildPaletteActions(ctx: PaletteContext): PaletteAction[] {
  const actions: PaletteAction[] = [
    {
      id: "new-group",
      labelKey: "chat.group.create",
      icon: UserPlus,
      keywords: ["group", "qun", "新建群聊"],
      run: (c) => c.navigate("/chat?new=group"),
    },
    {
      id: "go-chat",
      labelKey: "chat.title",
      icon: MessageCircle,
      keywords: ["chat", "message"],
      run: (c) => c.navigate("/chat"),
    },
    {
      id: "go-contacts",
      labelKey: "contacts.title",
      icon: Users,
      keywords: ["contacts", "friends"],
      run: (c) => c.navigate("/contacts"),
    },
    {
      id: "go-moments",
      labelKey: "moments.title",
      icon: Camera,
      keywords: ["moments", "feed"],
      run: (c) => c.navigate("/moments"),
    },
    {
      id: "go-favorites",
      labelKey: "favorites.title",
      icon: Star,
      keywords: ["favorites", "saved"],
      run: (c) => c.navigate("/favorites"),
    },
    {
      id: "go-stickers",
      labelKey: "sticker.market.title",
      icon: Sticker,
      keywords: ["stickers", "emoji", "market"],
      run: (c) => c.navigate("/stickers"),
    },
    {
      id: "go-settings",
      labelKey: "settings.title",
      icon: Settings,
      keywords: ["settings", "preferences"],
      run: (c) => c.navigate("/settings"),
    },
    {
      id: "toggle-theme",
      labelKey: "palette.toggleTheme",
      icon: SunMoon,
      keywords: ["theme", "dark", "light"],
      run: (c) => c.toggleTheme(),
    },
    {
      id: "logout",
      labelKey: "settings.logout",
      icon: LogOut,
      keywords: ["logout", "signout"],
      run: (c) => c.logout(),
    },
  ];

  // 更新检查只有桌面端有（移动端无 updater 插件，web 端无从谈起）
  if (ctx.isDesktopApp && ctx.checkUpdate) {
    actions.push({
      id: "check-update",
      labelKey: "update.check",
      icon: RefreshCw,
      keywords: ["update", "upgrade", "version"],
      run: (c) => c.checkUpdate?.(),
    });
  }
  return actions;
}

/**
 * 按查询词过滤动作。空查询返回全部。
 *
 * @param t 译函数 —— 匹配要同时看译文与 keywords，否则中文界面下输入英文搜不到
 */
export function filterActions(
  actions: PaletteAction[],
  q: string,
  t: (key: string) => string,
): PaletteAction[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return actions;
  return actions.filter(
    (a) =>
      t(a.labelKey).toLowerCase().includes(needle) ||
      a.keywords.some((k) => k.toLowerCase().includes(needle)),
  );
}
```

- [ ] **Step 4: 实现 `CommandPalette.tsx`**

结构要点（完整实现照这个骨架写，不是伪代码）：

```tsx
/**
 * CommandPalette — 命令面板与全局搜索（Cmd/Ctrl+K）。
 *
 * @description
 * **一个组件两种模式**：输入为空时是命令面板（动作注册表 + 最近会话），
 * 一旦输入就进搜索（三源并发 + 分组结果 + 类型筛选）。
 * K3 与 K18 合并实现 —— 两者都要改这个组件，分两次做第二次得先拆掉第一次的结构。
 *
 * 当前承载按设计文档 §1.2：桌面全局主窗弹窗、会话内原生窗口，手机路由页、Web 大屏弹窗。
 * 原生窗口自行拉本地源并经主窗事件桥执行动作，不另建 WS。
 *
 * 断点形态：mobile 全屏 / tablet 560px / desktop 720×560。
 * 断点一律内部 useBreakpoint() 推导，不接 isDesktop prop（沿用裁决 D1）。
 */
```

必须落地的行为：

1. **三源并发**：`Promise.allSettled([联系人内存过滤, 会话内存过滤, searchMessages(...)])`
   —— 用 `allSettled` 而非 `all`：服务端挂了不该把本地结果一起丢掉
2. **防抖 300ms**，查询 `< 2` 字符只搜本地（联系人/会话），`>= 3` 字符才打服务端
   （后端 3 字符下限是 GIN 索引的要求）
3. **分组**：`联系人 / 群聊 / 消息 / 文件与媒体`。空分组不渲染标题。
   每组用 `role="group"` + `aria-label`
4. **类型筛选条**：`全部 / 消息 / 文件 / 图片 / 视频 / 语音` → 映射到 `SearchType[]`；
   选「全部」时不传 `types`
5. **缩略图**：`message_type` 为图片/视频且有 `object_key` 时走
   `resolveObjectUrl(key)`。容器**固定 40×40 并先渲染 Skeleton**，
   图片 `onLoad` 后才替换 —— 零 CLS 是硬要求
6. **键盘**：`ArrowDown` / `ArrowUp` 在扁平化后的可选项序列上移动（跨分组连续），
   `Enter` 执行当前项，`Escape` 调 `onClose`。选中项 `aria-selected` + `scrollIntoView({ block: "nearest" })`
7. **ARIA**：输入框 `role="combobox"` + `aria-expanded` + `aria-controls`，
   列表 `role="listbox"`，项 `role="option"`
8. **骨架屏**：加载中渲染 3 条骨架行（固定高度），不是 spinner —— 列表加载必须有骨架屏
9. **错误态**：服务端失败时在「消息」分组位置显示一行可重试提示，
   本地结果照常展示
10. **打开时重置**：`show` 由 false→true 时清空 query/results、聚焦输入框
    （沿用 `SearchModal.tsx:34-40` 的既有行为）

- [ ] **Step 5: 删掉 `SearchModal.tsx` 并改导出**

```bash
git rm packages/ui/src/layout/SearchModal.tsx
```

`packages/ui/src/index.ts`：删 `SearchModal` 导出，加
`export { CommandPalette } from "./palette/CommandPalette";` 与
`export { buildPaletteActions, filterActions, type PaletteAction, type PaletteContext } from "./palette/paletteActions";`。

- [ ] **Step 6: 四语新增文案**

| key                      | zh-CN              | en-US                       | ja-JP                      | ko-KR                |
| ------------------------ | ------------------ | --------------------------- | -------------------------- | -------------------- |
| `palette.placeholder`    | 搜索或输入命令…    | Search or type a command…   | 検索またはコマンド入力…    | 검색 또는 명령 입력… |
| `palette.toggleTheme`    | 切换主题           | Toggle theme                | テーマ切り替え             | 테마 전환            |
| `palette.actions`        | 快捷操作           | Actions                     | クイック操作               | 빠른 작업            |
| `palette.recent`         | 最近会话           | Recent                      | 最近のチャット             | 최근 대화            |
| `palette.groupContacts`  | 联系人             | Contacts                    | 連絡先                     | 연락처               |
| `palette.groupGroups`    | 群聊               | Groups                      | グループ                   | 그룹                 |
| `palette.groupMessages`  | 消息               | Messages                    | メッセージ                 | 메시지               |
| `palette.groupFiles`     | 文件与媒体         | Files & media               | ファイルとメディア         | 파일 및 미디어       |
| `palette.filterAll`      | 全部               | All                         | すべて                     | 전체                 |
| `palette.filterMessages` | 消息               | Messages                    | メッセージ                 | 메시지               |
| `palette.filterFiles`    | 文件               | Files                       | ファイル                   | 파일                 |
| `palette.filterImages`   | 图片               | Images                      | 画像                       | 이미지               |
| `palette.filterVideos`   | 视频               | Videos                      | 動画                       | 동영상               |
| `palette.filterVoice`    | 语音               | Voice                       | 音声                       | 음성                 |
| `palette.empty`          | 没有找到相关结果   | No results                  | 該当する結果がありません   | 결과가 없습니다      |
| `palette.searchFailed`   | 搜索失败，点击重试 | Search failed, tap to retry | 検索に失敗しました。再試行 | 검색 실패, 다시 시도 |

> 先 grep `search.` 开头的既有 key，能复用的不要新增；
> `SearchModal` 用过的 key 若已无引用会被 `check-i18n` 判死键，**必须删掉**。

- [ ] **Step 7: 跑测试**

```bash
node scripts/check-i18n.mjs
LANG=C.UTF-8 pnpm --filter @yuanchat/ui test -- CommandPalette
LANG=C.UTF-8 pnpm test
```

Expected: 全绿，10 条 palette 用例全过。

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/palette packages/ui/src/index.ts packages/design-system
git rm --cached packages/ui/src/layout/SearchModal.tsx 2>/dev/null || true
git commit -m "feat(palette): SearchModal 升维为命令面板，空输入走动作注册表、有输入走分组搜索

K3 与 K18 合并实现：两者都要改同一个组件，分两次做第二次得先拆掉第一次的结构。
结果按 联系人/群聊/消息/文件与媒体 分组，带类型筛选器与媒体缩略图
（固定 40×40 + Skeleton，零 CLS）。三源用 allSettled 并发 ——
服务端挂了不该把本地联系人结果也一起丢掉。

全局与会话内复用同一组件；三端承载及窗口事件桥见设计文档 §1.2。"
```

### Task 12: 面板接入三端 + 桌面断点形态 + E2E

**Files:**

- Modify: `packages/ui/src/layout/MainLayout.tsx:42,73-85,153,211`
- Test: `apps/web/e2e/command-palette.spec.ts`

**Interfaces:**

- Consumes: Task 11 的 `CommandPalette`
- Produces: 无新对外接口

- [ ] **Step 1: 换掉 MainLayout 里的 SearchModal**

```tsx
// :42 import
import { CommandPalette } from "../palette/CommandPalette";

// :153 与 :211 两处挂载点（手机分支与桌面分支各一处）
<CommandPalette show={showSearch} onClose={() => setShowSearch(false)} />;
```

`:73-85` 的键盘监听保留不动（Ctrl/Cmd+K 切换、Escape 关闭的行为已对）。

- [ ] **Step 2: 写 E2E**

`apps/web/e2e/command-palette.spec.ts`：

```ts
import { test, expect } from "@playwright/test";

test.describe("命令面板", () => {
  test("Ctrl+K 打开，空输入时列出快捷动作", async ({ page }) => {
    await page.goto("/chat");
    await page.keyboard.press("Control+k");
    const box = page.getByRole("combobox");
    await expect(box).toBeFocused();
    await expect(page.getByRole("option").first()).toBeVisible();
  });

  test("输入后按类别分组，点文件筛选器只剩文件组", async ({ page }) => {
    await page.goto("/chat");
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox").fill("报告");
    await expect(page.getByRole("group", { name: /文件与媒体|Files/i })).toBeVisible();

    await page.getByRole("button", { name: /^文件$|^Files$/ }).click();
    await expect(page.getByRole("group", { name: /消息$|Messages$/ })).toHaveCount(0);
  });

  test("Enter 执行选中的消息结果并落到目标会话", async ({ page }) => {
    await page.goto("/chat");
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox").fill("报告");
    await page.getByRole("option").first().waitFor();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    // 面板关闭且落到某个会话
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await expect(page).toHaveURL(/\/chat\/.+/);
  });

  test("Escape 关闭面板", async ({ page }) => {
    await page.goto("/chat");
    await page.keyboard.press("Control+k");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("combobox")).toHaveCount(0);
  });

  test("桌面视口下面板明显宽于手机视口（K18 的「窄弹窗」抱怨）", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/chat");
    await page.keyboard.press("Control+k");
    const wide = (await page.getByRole("listbox").boundingBox())!.width;

    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 412, height: 915 });
    await page.keyboard.press("Control+k");
    const narrow = (await page.getByRole("listbox").boundingBox())!.width;

    expect(wide).toBeGreaterThan(narrow * 1.5);
  });
});
```

- [ ] **Step 3: 跑 E2E**

```bash
# 先确认 5173 没有残留 dev server：Playwright 的 reuseExistingServer 会接管它，
# 若那个进程是 VITE_ENABLE_MOCK=false 起的，用例会齐刷刷 30s 超时，看着像代码全坏
pnpm dev:stop || true
pnpm --filter @yuanchat/web test:e2e -- command-palette
```

Expected: 5 条全 PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/layout/MainLayout.tsx apps/web/e2e/command-palette.spec.ts
git commit -m "feat(palette): 命令面板接入三端布局，E2E 钉住分组/筛选/键盘与桌面宽度"
```

---

## Stage D — W4 桌面托盘 + 系统未读角标

### Task 13: 未读选择器唯一来源

**Files:**

- Create: `packages/shared/src/store/selectors.ts`
- Create: `packages/shared/src/__tests__/selectors.test.ts`
- Modify: `packages/ui/src/layout/MainLayout.tsx:91-93`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**

- Consumes: `Conversation`（`unreadCount: number`、`isMuted: boolean`、`id: string`）
- Produces:
  - `selectTotalUnread(convs: Conversation[]): number`
  - `selectFirstUnreadId(convs: Conversation[]): string | null`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect } from "vitest";
import { selectTotalUnread, selectFirstUnreadId } from "../store/selectors";
import type { Conversation } from "../types";

function conv(p: Partial<Conversation>): Conversation {
  return {
    id: "c",
    type: "private",
    name: "n",
    unreadCount: 0,
    isMuted: false,
    ...p,
  } as Conversation;
}

describe("selectTotalUnread", () => {
  it("累加未读，免打扰会话不计入", () => {
    expect(
      selectTotalUnread([
        conv({ id: "a", unreadCount: 3 }),
        conv({ id: "b", unreadCount: 5, isMuted: true }),
        conv({ id: "c", unreadCount: 2 }),
      ]),
    ).toBe(5);
  });

  it("空列表为 0", () => {
    expect(selectTotalUnread([])).toBe(0);
  });

  it("全部免打扰时为 0（托盘不该因免打扰会话亮角标）", () => {
    expect(selectTotalUnread([conv({ unreadCount: 9, isMuted: true })])).toBe(0);
  });
});

describe("selectFirstUnreadId", () => {
  it("返回列表顺序里第一个有未读且非免打扰的会话", () => {
    expect(
      selectFirstUnreadId([
        conv({ id: "a", unreadCount: 0 }),
        conv({ id: "b", unreadCount: 1, isMuted: true }),
        conv({ id: "c", unreadCount: 4 }),
        conv({ id: "d", unreadCount: 7 }),
      ]),
    ).toBe("c");
  });

  it("没有未读时返回 null —— 点托盘只聚焦窗口，不能把用户正在看的位置顶掉", () => {
    expect(selectFirstUnreadId([conv({ unreadCount: 0 })])).toBeNull();
    expect(selectFirstUnreadId([])).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
LANG=C.UTF-8 pnpm --filter @yuanchat/shared test -- selectors
```

Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

```ts
/**
 * 会话列表的派生选择器。
 *
 * @description
 * 单独成文件是为了让「未读总数怎么算」只有一份实现：侧栏角标、底栏角标、
 * 桌面托盘与系统角标全从这里取。两处各算一遍必然漂移 ——
 * navItems.ts 那条注释记的就是同一个形状的事故（底栏清单先前两处各写一份，
 * 换成朋友圈时有一处没跟上）。
 */
import type { Conversation } from "../types";

/**
 * 未读消息总数。免打扰会话**不计入** —— 用户把它静音就是表示不想被它提醒，
 * 托盘角标为它亮起来等于绕过了免打扰。
 */
export function selectTotalUnread(convs: Conversation[]): number {
  return convs.reduce((sum, c) => sum + (c.isMuted ? 0 : c.unreadCount), 0);
}

/**
 * 列表顺序里第一个「有未读且非免打扰」的会话 id。
 *
 * 供托盘左键「直达未读」用。没有未读时返回 null，调用方应当只聚焦窗口
 * 而不做跳转 —— 强行跳到一个已读会话会把用户正在看的位置顶掉。
 */
export function selectFirstUnreadId(convs: Conversation[]): string | null {
  const hit = convs.find((c) => !c.isMuted && c.unreadCount > 0);
  return hit ? hit.id : null;
}
```

- [ ] **Step 4: 把 MainLayout 换成用它**

```tsx
// :91-93 改前是就地 reduce
const totalUnread = useConversationStore((s) => selectTotalUnread(s.conversations));
```

并从 `packages/shared/src/index.ts` 导出两个选择器。

- [ ] **Step 5: 跑测试**

```bash
LANG=C.UTF-8 pnpm test
cd apps/web && npx tsc --noEmit && cd ../desktop && npx tsc --noEmit && cd ../..
```

Expected: 全绿（`MainLayout` 的既有测试不应受影响 —— 口径没变，只是搬了家）。

- [ ] **Step 6: Commit**

```bash
git add packages/shared packages/ui/src/layout/MainLayout.tsx
git commit -m "refactor(store): 未读总数与首个未读会话抽成选择器，侧栏与托盘共用一份口径

托盘角标马上要用同一个算法，两处各算一遍必然漂移 —— navItems.ts 那条
注释记的就是同一形状的事故。免打扰会话不计入：用户静音就是不想被提醒，
角标为它亮起来等于绕过免打扰。"
```

### Task 14: 托盘图标 + 系统角标

**Files:**

- Create: `apps/desktop/src/tray.ts`
- Create: `apps/desktop/src-tauri/icons/badge-dot.png`（16×16 与 32×32 各一张，纯色圆点）
- Create: `apps/desktop/src/__tests__/tray.test.ts`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src-tauri/capabilities/desktop.json`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`（bundle icon 清单加 badge-dot）
- Modify: `packages/design-system/src/i18n/locales/{zh-CN,en-US,ja-JP,ko-KR}.json`

**Interfaces:**

- Consumes: Task 13 的 `selectTotalUnread` / `selectFirstUnreadId`
- Produces:
  - `installTray(opts: { onOpenConversation: (id: string | null) => void }): Promise<() => void>`
    —— 返回卸载函数（登出时调用）
  - `applyBadge(count: number): Promise<void>`（导出供单测）

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const setBadgeCount = vi.fn();
const setOverlayIcon = vi.fn();
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setBadgeCount,
    setOverlayIcon,
    show: vi.fn(),
    setFocus: vi.fn(),
    unminimize: vi.fn(),
  }),
}));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => "linux" }));

beforeEach(() => vi.clearAllMocks());

// Review Focus #4：不支持的平台会抛，角标是增强，失败了应用必须照常用
it("setBadgeCount 抛错时不向外传播", async () => {
  setBadgeCount.mockRejectedValueOnce(new Error("Unity LauncherEntry unavailable"));
  const { applyBadge } = await import("../tray");
  await expect(applyBadge(3)).resolves.toBeUndefined();
});

it("未读为 0 时清角标（传 undefined 而非 0）", async () => {
  const { applyBadge } = await import("../tray");
  await applyBadge(0);
  expect(setBadgeCount).toHaveBeenCalledWith(undefined);
});

it("未读大于 0 时传计数", async () => {
  const { applyBadge } = await import("../tray");
  await applyBadge(7);
  expect(setBadgeCount).toHaveBeenCalledWith(7);
});

it("Windows 上走 setOverlayIcon 而不是 setBadgeCount（平台不支持后者）", async () => {
  vi.doMock("@tauri-apps/plugin-os", () => ({ platform: () => "windows" }));
  vi.resetModules();
  const { applyBadge } = await import("../tray");
  await applyBadge(4);
  expect(setOverlayIcon).toHaveBeenCalled();
  expect(setBadgeCount).not.toHaveBeenCalled();
});

it("Windows 上未读为 0 时清 overlay（传 undefined）", async () => {
  vi.doMock("@tauri-apps/plugin-os", () => ({ platform: () => "windows" }));
  vi.resetModules();
  const { applyBadge } = await import("../tray");
  await applyBadge(0);
  expect(setOverlayIcon).toHaveBeenCalledWith(undefined);
});
```

- [ ] **Step 2: 运行确认失败**

```bash
LANG=C.UTF-8 pnpm --filter @yuanchat/desktop test -- tray
```

Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 `tray.ts`**

```ts
/**
 * 桌面托盘与系统未读角标。
 *
 * @description
 * 零新依赖：Cargo.toml 的 tauri 已开 `tray-icon` feature，
 * JS 侧 `@tauri-apps/api/tray` 与 `window.setBadgeCount` / `setOverlayIcon`
 * 全是现成的，只需补 capability 权限。
 *
 * **刻意不生成带数字的图标。** Windows 与 macOS 本项目没有测试设备，
 * 而 `setOverlayIcon(Uint8Array)` 收 PNG 字节还是裸 RGBA 文档没讲清
 * （Rust 侧是裸 RGBA 的 Image，JS 签名却含 string | Image | Uint8Array）——
 * 在永远测不到的平台上押一个不确定的编码格式，等于写了行不通也不会被发现的代码。
 * 改为：macOS/Linux 用 setBadgeCount 让系统自己画数字，Windows 喂一张静态红点
 * PNG（走 allow-from-path，语义无歧义），**数字信息走托盘 tooltip 与菜单项**。
 * 详见设计文档 §1.3。
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";
import { TrayIcon, type TrayIconEvent } from "@tauri-apps/api/tray";
import { Menu } from "@tauri-apps/api/menu";
import { defaultWindowIcon } from "@tauri-apps/api/app";
import { exit } from "@tauri-apps/plugin-process";
import i18next from "i18next";
import { useConversationStore, selectTotalUnread, selectFirstUnreadId } from "@yuanchat/shared";

const TRAY_ID = "main";

/**
 * 把未读数反映到系统角标上。
 *
 * 所有调用都裹 try/catch 并只记 warn：Linux 的 setBadgeCount 走 Unity
 * LauncherEntry DBus，未装 `.desktop` 时会抛；角标是增强，失败了应用照常用。
 */
export async function applyBadge(count: number): Promise<void> {
  const win = getCurrentWindow();
  try {
    if (platform() === "windows") {
      // Windows 不支持 setBadgeCount，只能用任务栏 overlay 图标。
      // 静态红点两态：有未读/无未读，计数在 tooltip 与菜单里
      await win.setOverlayIcon(count > 0 ? "icons/badge-dot.png" : undefined);
      return;
    }
    // 0 要传 undefined 而不是 0 —— Tauri 用 None 表示「移除角标」
    await win.setBadgeCount(count > 0 ? count : undefined);
  } catch (e) {
    console.warn("[tray] 系统角标不可用，已跳过", e);
  }
}

/** 托盘 tooltip 与菜单里的未读文案 */
function unreadLabel(count: number): string {
  return count > 0 ? i18next.t("tray.unread", { count }) : i18next.t("tray.noUnread");
}

/**
 * 装上托盘图标并订阅未读变化。
 *
 * @param opts.onOpenConversation 左键点托盘时的跳转回调；参数为 null 表示
 *   没有未读，调用方应只聚焦窗口不做跳转
 * @returns 卸载函数（登出时调用，否则登出后托盘还挂着旧账号的未读数）
 */
export async function installTray(opts: {
  onOpenConversation: (id: string | null) => void;
}): Promise<() => void> {
  const win = getCurrentWindow();

  const activate = async () => {
    try {
      await win.unminimize();
      await win.show();
      await win.setFocus();
    } catch (e) {
      console.warn("[tray] 激活窗口失败", e);
    }
    opts.onOpenConversation(selectFirstUnreadId(useConversationStore.getState().conversations));
  };

  const menu = await Menu.new({
    items: [
      { id: "tray-unread", text: unreadLabel(0), enabled: false },
      { id: "tray-open", text: i18next.t("tray.open"), action: () => void activate() },
      { id: "tray-quit", text: i18next.t("tray.quit"), action: () => void exit(0) },
    ],
  });

  const tray = await TrayIcon.new({
    id: TRAY_ID,
    icon: (await defaultWindowIcon()) ?? undefined,
    tooltip: i18next.t("tray.tooltip"),
    menu,
    // 左键直接激活窗口，不弹菜单 —— 菜单留给右键
    showMenuOnLeftClick: false,
    action: (event: TrayIconEvent) => {
      if (event.type === "Click" && event.button === "Left" && event.buttonState === "Down") {
        void activate();
      }
    },
  });

  let last = -1;
  const sync = async (count: number) => {
    if (count === last) return;
    last = count;
    await applyBadge(count);
    try {
      await tray.setTooltip(
        count > 0
          ? `${i18next.t("tray.tooltip")} — ${unreadLabel(count)}`
          : i18next.t("tray.tooltip"),
      );
      const item = await menu.get("tray-unread");
      // Menu.get 返回的是基类，带 setText 的是 MenuItem；取不到就跳过
      if (item && "setText" in item)
        await (item as { setText(t: string): Promise<void> }).setText(unreadLabel(count));
    } catch (e) {
      console.warn("[tray] 更新托盘文案失败", e);
    }
  };

  void sync(selectTotalUnread(useConversationStore.getState().conversations));
  const unsub = useConversationStore.subscribe(
    (s) => void sync(selectTotalUnread(s.conversations)),
  );

  return () => {
    unsub();
    void applyBadge(0);
    void TrayIcon.removeById(TRAY_ID);
  };
}
```

- [ ] **Step 4: 在 `App.tsx` 接线**

仅桌面 app（非移动、非 web）装托盘，登出时卸载：

```tsx
// 在已登录分支里
useEffect(() => {
  if (!isDesktop || isMobile) return;
  let dispose: (() => void) | undefined;
  void import("./tray").then(({ installTray }) =>
    installTray({
      onOpenConversation: (id) => {
        // null 表示没有未读：只聚焦窗口，不跳转 —— 否则会把用户正在看的位置顶掉
        if (id) navigate(`/chat/${id}`);
      },
    }).then((d) => {
      dispose = d;
    }),
  );
  return () => dispose?.();
}, [isDesktop, isMobile, navigate]);
```

- [ ] **Step 5: 画 badge-dot.png 并登记进 bundle**

```bash
# 纯红圆点，透明底。没有 ImageMagick 就用任意工具产出同样两张
convert -size 32x32 xc:none -fill '#DC2626' -draw 'circle 16,16 16,4' \
  apps/desktop/src-tauri/icons/badge-dot.png
convert apps/desktop/src-tauri/icons/badge-dot.png -resize 16x16 \
  apps/desktop/src-tauri/icons/badge-dot-16.png
file apps/desktop/src-tauri/icons/badge-dot.png
```

`tauri.conf.json` 的 `bundle.icon` 数组追加 `"icons/badge-dot.png"`
—— 不登记的话它不会被打进资源包，`setOverlayIcon("icons/badge-dot.png")` 会找不到文件。

- [ ] **Step 6: 补 capabilities**

`apps/desktop/src-tauri/capabilities/desktop.json` 的 `permissions` 追加
（标识符已于设计阶段从 `gen/schemas/desktop-schema.json` 核实存在）：

```json
"core:tray:default",
"core:menu:allow-new",
"core:menu:allow-append",
"core:menu:allow-set-text",
"core:menu:allow-set-enabled",
"core:window:allow-set-badge-count",
"core:window:allow-set-overlay-icon",
"core:image:allow-from-path"
```

放 `desktop.json` 而非 `default.json`：它已有 `platforms: ["macOS","windows","linux"]`
的壳，托盘与角标在安卓上无意义（Rust 文档明写 Android 不支持 badge）。

- [ ] **Step 7: 四语新增文案**

| key             | zh-CN            | en-US              | ja-JP            | ko-KR                 |
| --------------- | ---------------- | ------------------ | ---------------- | --------------------- |
| `tray.tooltip`  | 元聊             | YuanChat           | 元聊             | 위안챗                |
| `tray.unread`   | 未读 %{count} 条 | %{count} unread    | 未読 %{count} 件 | 읽지 않음 %{count}개  |
| `tray.noUnread` | 没有未读消息     | No unread messages | 未読はありません | 읽지 않은 메시지 없음 |
| `tray.open`     | 打开元聊         | Open YuanChat      | 元聊を開く       | 위안챗 열기           |
| `tray.quit`     | 退出             | Quit               | 終了             | 종료                  |

- [ ] **Step 8: 跑测试与门禁**

```bash
node scripts/check-i18n.mjs
LANG=C.UTF-8 pnpm --filter @yuanchat/desktop test -- tray
cd apps/desktop && npx tsc --noEmit && cd ../..
cd apps/desktop/src-tauri && cargo check 2>&1 | tail -10 && cd ../../..
```

Expected: 5 条 tray 用例全 PASS，其余全绿。

- [ ] **Step 9: Commit**

```bash
git add apps/desktop packages/design-system
git commit -m "feat(desktop): 系统托盘与未读角标，左键直达第一个未读会话

零新依赖：tray-icon feature 早已开启，tray/badge/overlay 的 JS API 全现成，
只补了 capability 权限（标识符从 gen/schemas 核实，不猜）。

刻意不生成带数字的图标：Win/macOS 无测试设备，而 setOverlayIcon 收 PNG 字节
还是裸 RGBA 文档没讲清 —— 在永远测不到的平台上押一个不确定的编码格式，
等于写了行不通也不会被发现的代码。改为 macOS/Linux 交系统画数字、
Windows 喂静态红点、数字走 tooltip 与菜单。角标调用全裹 try/catch：
Linux 未装 .desktop 时 setBadgeCount 会抛，而角标只是增强。"
```

### Task 15: 关窗二选一弹窗 + 偏好持久化 + 设置项

**Files:**

- Create: `packages/shared/src/store/desktopStore.ts`
- Create: `packages/ui/src/palette/CloseBehaviorDialog.tsx`
- Create: `packages/shared/src/__tests__/desktopStore.test.ts`
- Modify: `apps/desktop/src/App.tsx:180`
- Modify: `packages/ui/src/settings/SettingsScreen.tsx`（桌面分组加开关）
- Modify: `packages/shared/src/index.ts`、`packages/ui/src/index.ts`
- Modify: `packages/design-system/src/i18n/locales/{zh-CN,en-US,ja-JP,ko-KR}.json`

**Interfaces:**

- Consumes: 无
- Produces:
  - `useDesktopStore` —— `{ closeBehavior: "ask" | "tray" | "quit"; setCloseBehavior(b): void }`，`persist` 到 localStorage（key `yuanchat-desktop`）
  - `<CloseBehaviorDialog open onPick={(b: "tray" | "quit", remember: boolean) => void} onCancel />`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useDesktopStore } from "../store/desktopStore";

beforeEach(() => {
  localStorage.clear();
  useDesktopStore.setState({ closeBehavior: "ask" });
});

it("默认是 ask —— 第一次关窗必须问，不能擅自替用户决定", () => {
  expect(useDesktopStore.getState().closeBehavior).toBe("ask");
});

it("设置后持久化到 localStorage", () => {
  useDesktopStore.getState().setCloseBehavior("tray");
  expect(useDesktopStore.getState().closeBehavior).toBe("tray");
  expect(localStorage.getItem("yuanchat-desktop")).toContain("tray");
});

it("可以改回 ask（设置页要给得出回头路，否则勾了「记住」就再也改不了）", () => {
  useDesktopStore.getState().setCloseBehavior("quit");
  useDesktopStore.getState().setCloseBehavior("ask");
  expect(useDesktopStore.getState().closeBehavior).toBe("ask");
});
```

- [ ] **Step 2: 运行确认失败**

```bash
LANG=C.UTF-8 pnpm --filter @yuanchat/shared test -- desktopStore
```

Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 `desktopStore.ts`**

```ts
/**
 * 桌面端本机偏好（不上云，换台机器重新问一次）。
 *
 * @description
 * 目前只有「点关闭按钮怎么办」一项。用 persist 与 themeStore / authStore
 * 同一套范式。默认 `ask`：第一次关窗必须问，不能擅自替用户决定 ——
 * 直接最小化到托盘会让人以为应用没关掉，直接退出会让人丢消息。
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** 关闭按钮的行为。`ask` 表示弹窗询问（默认） */
export type CloseBehavior = "ask" | "tray" | "quit";

interface DesktopState {
  closeBehavior: CloseBehavior;
  setCloseBehavior: (b: CloseBehavior) => void;
}

export const useDesktopStore = create<DesktopState>()(
  persist(
    (set) => ({
      closeBehavior: "ask",
      setCloseBehavior: (b) => set({ closeBehavior: b }),
    }),
    { name: "yuanchat-desktop" },
  ),
);
```

- [ ] **Step 4: 实现 `CloseBehaviorDialog.tsx`**

基于 `packages/ui/src/primitives/ConfirmDialog.tsx`（已有 `role` /
`aria-modal` / `aria-labelledby` / Esc / Tab 焦点陷阱）包一层：两个主按钮
「最小化到托盘」「退出应用」+ 一个「记住我的选择」复选框。

**不用原生弹窗** —— 项目约定确认与授权一律应用内自绘。

要点：

- 复选框状态由组件自持，`onPick(behavior, remember)` 一次性回传
- 默认焦点落在「最小化到托盘」（破坏性较小的那个）
- Esc 等价于 `onCancel`（既不最小化也不退出）

- [ ] **Step 5: 在 `App.tsx` 挂上**

```tsx
// :180 附近
const [askClose, setAskClose] = useState(false);
const closeBehavior = useDesktopStore((s) => s.closeBehavior);
const setCloseBehavior = useDesktopStore((s) => s.setCloseBehavior);

const doClose = async (b: "tray" | "quit") => {
  const win = getCurrentWindow();
  // 最小化到托盘要用 hide 而非 minimize：minimize 仍在任务栏占位，
  // 而「最小化到托盘」的本意是从任务栏消失、只留托盘图标
  if (b === "tray") await win.hide();
  else await exit(0);
};

const handleClose = () => {
  if (closeBehavior === "ask") { setAskClose(true); return; }
  void doClose(closeBehavior);
};

// …
titleBar={isMobile ? undefined : <TitleBar onClose={handleClose} />}

<CloseBehaviorDialog
  open={askClose}
  onCancel={() => setAskClose(false)}
  onPick={(b, remember) => {
    setAskClose(false);
    if (remember) setCloseBehavior(b);
    void doClose(b);
  }}
/>
```

- [ ] **Step 6: 设置页加回头路**

`SettingsScreen.tsx` 在桌面可见的分组里加一项三选（询问 / 最小化到托盘 / 退出应用），
写 `setCloseBehavior`。**必须有** —— 勾了「记住我的选择」之后没有这个开关
就再也改不回来了。仅桌面 app 显示（`useIsDesktop()` 且非移动）。

- [ ] **Step 7: 四语新增文案**

| key                        | zh-CN                        | en-US                                            | ja-JP                                            | ko-KR                                       |
| -------------------------- | ---------------------------- | ------------------------------------------------ | ------------------------------------------------ | ------------------------------------------- |
| `desktop.closeTitle`       | 关闭窗口                     | Close window                                     | ウィンドウを閉じる                               | 창 닫기                                     |
| `desktop.closeBody`        | 最小化到托盘可继续接收消息。 | Minimizing to the tray keeps receiving messages. | トレイに最小化するとメッセージを受信し続けます。 | 트레이로 최소화하면 메시지를 계속 받습니다. |
| `desktop.closeToTray`      | 最小化到托盘                 | Minimize to tray                                 | トレイに最小化                                   | 트레이로 최소화                             |
| `desktop.closeQuit`        | 退出应用                     | Quit app                                         | アプリを終了                                     | 앱 종료                                     |
| `desktop.rememberChoice`   | 记住我的选择                 | Remember my choice                               | 選択を記憶する                                   | 내 선택 기억하기                            |
| `desktop.closeBehavior`    | 点击关闭按钮时               | When closing the window                          | 閉じるボタンを押したとき                         | 닫기 버튼을 누를 때                         |
| `desktop.closeBehaviorAsk` | 每次询问                     | Ask every time                                   | 毎回確認                                         | 매번 확인                                   |

- [ ] **Step 8: 跑测试与门禁**

```bash
node scripts/check-i18n.mjs
LANG=C.UTF-8 pnpm test
cd apps/desktop && npx tsc --noEmit && cd ../..
```

Expected: 全绿。

- [ ] **Step 9: Commit**

```bash
git add packages apps/desktop
git commit -m "feat(desktop): 关闭按钮弹窗二选一（最小化到托盘 / 退出），可记住选择

直接最小化会让人以为应用没关掉，直接退出会让人丢消息，所以默认询问。
勾「记住我的选择」后走设置页的三选开关改回 —— 没有那个开关的话
勾完就再也改不了。最小化用 hide 而非 minimize：minimize 仍在任务栏占位，
而「最小化到托盘」的本意是从任务栏消失、只留托盘图标。"
```

---

## Stage E — W5 自建 OTA 更新服务

### Task 16: `app_releases` 表 + 仓储 + 灰度判定

**Files:**

- Create: `server/internal/database/migrations/023_app_releases.sql`
- Create: `server/internal/model/release.go`
- Create: `server/internal/repository/release_repo.go`
- Create: `server/internal/service/release_service.go`
- Create: `server/internal/service/release_service_test.go`

**Interfaces:**

- Consumes: 无
- Produces:
  - `model.AppRelease`（字段见 Step 2）
  - `ReleaseRepository.LatestPublished(ctx, platform, arch, channel string) (*model.AppRelease, error)`
  - `ReleaseRepository.CatalogLatest(ctx, channel string) ([]model.AppRelease, error)`
  - `ReleaseRepository.List / Create / Update / SetStatus`
  - `ReleaseService.Resolve(ctx, platform, arch, channel, currentVersion, deviceKey string) (*ResolveResult, error)`
    —— `ResolveResult{ Release *model.AppRelease; Mandatory bool }`，无更新时返 `(nil, nil)`
  - `service.InRollout(deviceKey string, rollout int) bool`（导出供单测与 handler 复用）

- [ ] **Step 1: 写失败的测试**

```go
// 灰度判定必须对同一设备稳定：不稳定的话用户会在新旧版之间来回跳 ——
// 今天提示升级、明天又说已是最新、后天再提示一次。
func TestInRollout_StableForSameDevice(t *testing.T) {
	const dev = "device-abc-123"
	first := service.InRollout(dev, 50)
	for i := 0; i < 100; i++ {
		require.Equal(t, first, service.InRollout(dev, 50), "同一设备同一比例的判定必须恒定")
	}
}

func TestInRollout_Boundaries(t *testing.T) {
	// 0% 对谁都不放行，100% 对谁都放行 —— 这两个边界是运营的「暂停」与「全量」开关
	for _, dev := range []string{"a", "b", "zzz", ""} {
		require.False(t, service.InRollout(dev, 0), "rollout=0 必须谁都不中")
		require.True(t, service.InRollout(dev, 100), "rollout=100 必须谁都中")
	}
}

func TestInRollout_RoughlyProportional(t *testing.T) {
	// 不要求精确，只要求不是「几乎全中」或「几乎全不中」——
	// 哈希分布坏掉的话灰度就是个假开关
	hit := 0
	const n = 2000
	for i := 0; i < n; i++ {
		if service.InRollout(fmt.Sprintf("device-%d", i), 30) {
			hit++
		}
	}
	require.InDelta(t, 0.30, float64(hit)/float64(n), 0.05)
}

func TestInRollout_MonotonicInRollout(t *testing.T) {
	// 比例调高时已中的设备必须仍然中 —— 否则「扩大灰度」会把一部分人踢回旧版
	const dev = "device-xyz"
	for r := 1; r <= 100; r++ {
		if service.InRollout(dev, r) {
			for bigger := r; bigger <= 100; bigger++ {
				require.True(t, service.InRollout(dev, bigger),
					"rollout 从 %d 调到 %d 时该设备被踢出了灰度", r, bigger)
			}
			return
		}
	}
}

func TestResolve_NoUpdateWhenAlreadyLatest(t *testing.T) {
	db := testutil.NewDB(t)
	svc := newTestReleaseService(t, db)
	seedRelease(t, db, "linux", "x86_64", "0.7.0", "stable", 100, "published")

	res, err := svc.Resolve(context.Background(), "linux", "x86_64", "stable", "0.7.0", "dev-1")
	require.NoError(t, err)
	require.Nil(t, res, "当前已是最新，必须返回无更新")
}

func TestResolve_SkipsDraftAndRolledBack(t *testing.T) {
	db := testutil.NewDB(t)
	svc := newTestReleaseService(t, db)
	seedRelease(t, db, "linux", "x86_64", "0.8.0", "stable", 100, "draft")
	seedRelease(t, db, "linux", "x86_64", "0.9.0", "stable", 100, "rolled_back")
	seedRelease(t, db, "linux", "x86_64", "0.7.0", "stable", 100, "published")

	res, err := svc.Resolve(context.Background(), "linux", "x86_64", "stable", "0.6.0", "dev-1")
	require.NoError(t, err)
	require.NotNil(t, res)
	require.Equal(t, "0.7.0", res.Release.Version, "draft 与 rolled_back 不得下发")
}

func TestResolve_MandatoryWhenBelowMinVersion(t *testing.T) {
	db := testutil.NewDB(t)
	svc := newTestReleaseService(t, db)
	r := seedRelease(t, db, "linux", "x86_64", "0.8.0", "stable", 100, "published")
	setMinVersion(t, db, r.ID, "0.7.0")

	res, err := svc.Resolve(context.Background(), "linux", "x86_64", "stable", "0.6.0", "dev-1")
	require.NoError(t, err)
	require.True(t, res.Mandatory, "低于 min_version 必须判强制更新")

	res, err = svc.Resolve(context.Background(), "linux", "x86_64", "stable", "0.7.5", "dev-1")
	require.NoError(t, err)
	require.False(t, res.Mandatory)
}
```

- [ ] **Step 2: 写迁移 023**

```sql
-- +goose Up
-- +goose StatementBegin
-- OTA 版本分发表。
--
-- 为什么自建而不只靠 GitHub Releases：国内直连 Releases 不稳（更新检查超时、
-- 下载断流，用户永远停在旧版）、没有渠道/灰度/回滚（一发就是全量，
-- 坏版本只能再发一版压过去）、Android 完全没有更新路径（Tauri updater 不支持它）。
--
-- signature 存的是 release 流水线产出的 minisign .sig 文本内容。
-- **签名私钥不入库也不进管理端进程** —— 管理端只做登记。
CREATE TABLE IF NOT EXISTS app_releases (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    platform      varchar(16)  NOT NULL,
    arch          varchar(24)  NOT NULL,
    version       varchar(32)  NOT NULL,
    channel       varchar(16)  NOT NULL DEFAULT 'stable',
    notes         text         NOT NULL DEFAULT '',
    object_key    text         NOT NULL,
    signature     text         NOT NULL DEFAULT '',
    sha256        varchar(64)  NOT NULL DEFAULT '',
    size          bigint       NOT NULL DEFAULT 0,
    min_version   varchar(32),
    mandatory     boolean      NOT NULL DEFAULT false,
    rollout       smallint     NOT NULL DEFAULT 100 CHECK (rollout BETWEEN 0 AND 100),
    status        varchar(16)  NOT NULL DEFAULT 'draft',
    published_at  timestamptz,
    created_by    uuid         REFERENCES users(id) ON DELETE SET NULL,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now()
);

-- 同一平台/架构/渠道下版本号唯一：重复登记同一版是运营误操作，
-- 让数据库挡住比让它产出两条互相覆盖的记录好
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_releases_unique
    ON app_releases (platform, arch, version, channel);

-- 对外查询的热路径：按平台+架构+渠道找最新的 published
CREATE INDEX IF NOT EXISTS idx_app_releases_lookup
    ON app_releases (platform, arch, channel, status, published_at DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS app_releases;
-- +goose StatementEnd
```

`server/internal/model/release.go` 照本仓既有 model 的 gorm 标签风格写
对应结构体，含 `TableName() string { return "app_releases" }`。

- [ ] **Step 3: 实现灰度判定**

```go
// InRollout 判断某设备是否落在灰度范围内。
//
// 按设备键的 FNV-1a 哈希取模 100。两条性质是必须的：
//
//   - **同设备稳定**：同一设备同一比例的判定恒定。不稳定的话用户会在新旧版之间
//     来回跳 —— 今天提示升级、明天说已是最新、后天再提示一次。
//   - **随比例单调**：把 rollout 从 10 调到 30，原先中的设备必须仍然中。
//     用「hash%100 < rollout」天然满足；若改成随机或带 rollout 参与哈希就会破坏它，
//     表现为扩大灰度反而把一部分人踢回旧版。
//
// rollout 为 0 时谁都不中、100 时谁都中 —— 这两个边界是运营的暂停与全量开关。
func InRollout(deviceKey string, rollout int) bool {
	if rollout <= 0 {
		return false
	}
	if rollout >= 100 {
		return true
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(deviceKey))
	return int(h.Sum32()%100) < rollout
}
```

`Resolve` 的逻辑：取 `LatestPublished` → 比较语义化版本（用既有依赖，
`go list -m all | grep -i semver` 先查有没有；没有就写一个三段数字比较的小函数并单测）
→ 当前版本 >= 最新则返 `(nil, nil)` → 否则 `InRollout` 不中也返 `(nil, nil)`
→ 中了则返结果，`Mandatory = release.Mandatory || currentVersion < release.MinVersion`。

- [ ] **Step 4: 跑测试**

```bash
cd server && go test ./internal/service/ -run "TestInRollout|TestResolve" -v 2>&1 | tail -30
```

Expected: 7 条全 PASS。

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "feat(ota): app_releases 表与灰度判定，渠道/最低版本/回滚状态就位

灰度按设备键 FNV-1a 哈希取模，保证两条性质：同设备判定恒定（否则用户在新旧版
之间来回跳）、随 rollout 单调（否则扩大灰度会把一部分人踢回旧版），单测各钉一条。

signature 只存 release 流水线产出的 .sig 文本 —— 签名私钥不入库、
不进管理端进程，管理端只做登记。"
```

### Task 17: 对外更新端点（免鉴权）

**Files:**

- Create: `server/internal/handler/update.go`
- Modify: `server/internal/router/router.go`
- Test: `server/internal/handler/update_test.go`

**Interfaces:**

- Consumes: Task 16 的 `ReleaseService.Resolve` / `CatalogLatest`、Task 1 Step 3 的格式结论
- Produces:
  - `GET /api/v1/updates/catalog?channel=` → `{ "data": [{ platform, arch, version, size, url }] }`
  - `GET /api/v1/updates/:platform/:arch?version=&channel=&device=` → 200 带更新体 / **204 无更新**

- [ ] **Step 1: 写 handler 测试**

```go
func TestUpdates_204WhenNoNewer(t *testing.T) {
	// Tauri updater 的约定：无更新返 204 空体。返 200 带同版本号它会当成「有更新」
	// 然后下载同一个包装一遍，用户看到的是「更新完了还提示更新」
	seedPublished(t, "linux", "x86_64", "0.7.0")
	w := doGetNoAuth(t, "/api/v1/updates/linux/x86_64?version=0.7.0")
	require.Equal(t, http.StatusNoContent, w.Code)
	require.Empty(t, w.Body.String())
}

func TestUpdates_200WithFlatBody(t *testing.T) {
	seedPublished(t, "linux", "x86_64", "0.8.0")
	w := doGetNoAuth(t, "/api/v1/updates/linux/x86_64?version=0.7.0&device=d1")
	require.Equal(t, http.StatusOK, w.Code)

	var body struct {
		Version   string `json:"version"`
		Notes     string `json:"notes"`
		PubDate   string `json:"pub_date"`
		URL       string `json:"url"`
		Signature string `json:"signature"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	require.Equal(t, "0.8.0", body.Version)
	require.NotEmpty(t, body.URL)
	require.NotEmpty(t, body.PubDate)
}

func TestUpdates_204WhenNotInRollout(t *testing.T) {
	seedPublishedRollout(t, "linux", "x86_64", "0.8.0", 0) // 0% = 暂停下发
	w := doGetNoAuth(t, "/api/v1/updates/linux/x86_64?version=0.7.0&device=d1")
	require.Equal(t, http.StatusNoContent, w.Code)
}

func TestUpdates_RolloutStableAcrossRequests(t *testing.T) {
	seedPublishedRollout(t, "linux", "x86_64", "0.8.0", 50)
	first := doGetNoAuth(t, "/api/v1/updates/linux/x86_64?version=0.7.0&device=fixed").Code
	for i := 0; i < 20; i++ {
		require.Equal(t, first,
			doGetNoAuth(t, "/api/v1/updates/linux/x86_64?version=0.7.0&device=fixed").Code,
			"同一设备多次请求拿到了不同结论")
	}
}

func TestUpdates_AndroidCarriesSha256(t *testing.T) {
	// APK 没有 minisign 签名，客户端只能靠 sha256 校验
	seedPublishedAPK(t, "android", "aarch64", "0.8.0", "abc123")
	w := doGetNoAuth(t, "/api/v1/updates/android/aarch64?version=0.7.0&device=d1")
	require.Equal(t, http.StatusOK, w.Code)
	require.Contains(t, w.Body.String(), "abc123")
}

func TestUpdates_UnknownPlatform404(t *testing.T) {
	w := doGetNoAuth(t, "/api/v1/updates/solaris/sparc?version=0.1.0")
	require.Equal(t, http.StatusNoContent, w.Code, "未知平台当成「没有更新」而非报错")
}

func TestCatalog_OnlyPublishedStable(t *testing.T) {
	seedPublished(t, "windows", "x86_64", "0.8.0")
	seedDraft(t, "darwin", "universal", "0.9.0")
	w := doGetNoAuth(t, "/api/v1/updates/catalog")
	require.Equal(t, http.StatusOK, w.Code)
	require.Contains(t, w.Body.String(), "windows")
	require.NotContains(t, w.Body.String(), "darwin", "draft 不得出现在下载页")
}

func TestCatalog_EmptyIsEmptyArrayNotNull(t *testing.T) {
	// 返 null 的话前端 .map 会炸，空态渲染不出来
	w := doGetNoAuth(t, "/api/v1/updates/catalog")
	require.Equal(t, http.StatusOK, w.Code)
	require.Contains(t, w.Body.String(), "[]")
}
```

- [ ] **Step 2: 运行确认失败**

```bash
cd server && go test ./internal/handler/ -run "TestUpdates_|TestCatalog_" -v
```

Expected: 全部 404（路由未注册）。

- [ ] **Step 3: 实现 handler**

要点（按 Task 1 Step 3 的核实结论填准字段名）：

```go
// Check 返回 Tauri updater 期望的更新信息。
//
//	@Summary		检查更新
//	@Tags			updates
//	@Param			platform	path	string	true	"darwin / linux / windows / android"
//	@Param			arch		path	string	true	"x86_64 / aarch64 / universal / ..."
//	@Param			version		query	string	true	"客户端当前版本"
//	@Param			channel		query	string	false	"stable（默认）/ beta"
//	@Param			device		query	string	false	"设备标识，用于稳定灰度"
//	@Success		200	{object}	UpdateResponse
//	@Success		204	"无可用更新"
//	@Router			/api/v1/updates/{platform}/{arch} [get]
func (h *UpdateHandler) Check(c *gin.Context) {
	// 灰度键：优先用客户端给的 device。缺失时回落 ClientIP ——
	// 必须保证同一台机器的判定稳定，否则用户会在新旧版之间来回跳。
	// 回落到 IP 的稳定性弱于 device（换网会变），但远好于随机。
	deviceKey := c.Query("device")
	if deviceKey == "" {
		deviceKey = c.ClientIP()
	}

	channel := c.DefaultQuery("channel", "stable")
	res, err := h.svc.Resolve(c.Request.Context(), c.Param("platform"), c.Param("arch"),
		channel, c.Query("version"), deviceKey)
	if err != nil {
		h.logger.Error("resolve update failed", zap.Error(err))
		InternalError(c, "resolve failed")
		return
	}
	// 无更新 / 未中灰度 / 未知平台 一律 204 空体：
	// 返 200 带同版本号的话 updater 会当成有更新、把同一个包再装一遍
	if res == nil {
		c.Status(http.StatusNoContent)
		return
	}

	url, err := h.storage.PresignGet(c.Request.Context(), res.Release.ObjectKey)
	if err != nil {
		h.logger.Error("presign release failed", zap.Error(err))
		InternalError(c, "presign failed")
		return
	}
	// **注意**：这里不走 Success() 包一层 {data:...}。Tauri updater 直接解析
	// 响应体根对象，包一层它读不到 version 字段。
	c.JSON(http.StatusOK, gin.H{
		"version":   res.Release.Version,
		"notes":     res.Release.Notes,
		"pub_date":  res.Release.PublishedAt,
		"url":       url,
		"signature": res.Release.Signature,
		"sha256":    res.Release.Sha256,
		"size":      res.Release.Size,
		"mandatory": res.Mandatory,
	})
}
```

`Catalog` 走常规 `Success(c, ...)` 包装（它是自家前端消费的，不是 updater）。
**空结果必须是 `[]` 而不是 `null`** —— 前端 `.map` 会炸。

`PresignGet` 用对外端点那个 `presignClient`（见 `storage/minio.go` 的注释说明
为什么两个 client 不可合并），不要用内网 client 签完再替 host —— SigV4 把 host
纳入签名，替换即失效。

- [ ] **Step 4: 注册路由**

```go
// 在 api 组里，与其他免鉴权端点并列。限流必须有 —— 这是免鉴权端点
updates := api.Group("/updates", middleware.LimitByIP(cfg.RateLimit.Updates))
{
	// 静态段 catalog 必须与两段的 :platform/:arch **不同层级**，
	// 否则 Gin 会因同层静态段与通配段冲突而 panic。
	// 故不注册单段的 /updates/:platform
	updates.GET("/catalog", updateH.Catalog)
	updates.GET("/:platform/:arch", updateH.Check)
}
```

- [ ] **Step 5: 跑测试**

```bash
cd server && go vet ./... && go test ./internal/handler/ -run "TestUpdates_|TestCatalog_" -v 2>&1 | tail -20
cd server && go test ./... 2>&1 | tail -10
```

Expected: 8 条全 PASS，全量全绿。

- [ ] **Step 6: Commit**

```bash
git add server/
git commit -m "feat(ota): 对外更新端点，无更新返 204、灰度按设备稳定

端点收敛成两条：静态段 /updates/catalog 与两段 /updates/:platform/:arch
（安卓共用 android/aarch64）。不注册单段的 /updates/:platform ——
Gin 同层注册静态段与通配段会 panic。

无更新/未中灰度/未知平台一律 204 空体：返 200 带同版本号的话 updater
会当成有更新、把同一个包再装一遍。更新体不包 {data:...} 外层 ——
updater 直接解析根对象。预签名走对外端点的 presignClient，
内网 client 签完替 host 会因 SigV4 把 host 纳入签名而失效。"
```

### Task 18: 管理端版本分发（五端点 + 页面）

**Files:**

- Modify: `server/internal/handler/admin.go`、`server/internal/service/admin_service.go`、`server/internal/router/router.go`
- Create: `apps/admin/src/pages/Releases.tsx`
- Modify: `apps/admin/src/App.tsx`、`apps/admin/src/components/AdminLayout.tsx`、`apps/admin/src/api.ts`
- Modify: `packages/design-system/src/i18n/locales/{zh-CN,en-US,ja-JP,ko-KR}.json`
- Test: `server/internal/handler/admin_releases_test.go`

**Interfaces:**

- Consumes: Task 16 的 `ReleaseRepository`
- Produces:
  - `GET /api/v1/admin/releases?platform=&channel=&status=&page=`
  - `POST /api/v1/admin/releases`（body：platform/arch/version/channel/notes/object_key/signature/sha256/size/min_version/mandatory/rollout）
  - `PATCH /api/v1/admin/releases/:id`（rollout / mandatory / notes）
  - `POST /api/v1/admin/releases/:id/publish`
  - `POST /api/v1/admin/releases/:id/rollback`

- [ ] **Step 1: 写测试**

```go
func TestAdminReleases_RequireAdmin(t *testing.T) {
	// 非 admin 一律 403 —— 版本分发能把任意字节推给全部客户端，
	// 它的权限面比封号还大
	w := doPost(t, "/api/v1/admin/releases", `{}`, tokenOf(t, normalUser))
	require.Equal(t, http.StatusForbidden, w.Code)
}

func TestAdminReleases_CreateWritesAuditLog(t *testing.T) {
	before := countAuditLogs(t)
	w := doPost(t, "/api/v1/admin/releases", `{
		"platform":"linux","arch":"x86_64","version":"0.8.0","channel":"stable",
		"object_key":"releases/yuanchat-0.8.0-x86_64.AppImage","signature":"sig","rollout":10
	}`, tokenOf(t, adminUser))
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, before+1, countAuditLogs(t), "写操作必须留审计日志")
}

func TestAdminReleases_PublishThenRollback(t *testing.T) {
	id := createDraft(t, "linux", "x86_64", "0.8.0")

	require.Equal(t, http.StatusOK,
		doPost(t, "/api/v1/admin/releases/"+id+"/publish", "", tokenOf(t, adminUser)).Code)
	require.Equal(t, "published", statusOf(t, id))
	// 发布后对外端点应能查到
	require.Equal(t, http.StatusOK,
		doGetNoAuth(t, "/api/v1/updates/linux/x86_64?version=0.7.0&device=d1").Code)

	require.Equal(t, http.StatusOK,
		doPost(t, "/api/v1/admin/releases/"+id+"/rollback", "", tokenOf(t, adminUser)).Code)
	require.Equal(t, "rolled_back", statusOf(t, id))
	// 回滚后对外端点立刻不再下发 —— 这就是「坏版本的收敛手段」
	require.Equal(t, http.StatusNoContent,
		doGetNoAuth(t, "/api/v1/updates/linux/x86_64?version=0.7.0&device=d1").Code)
}

func TestAdminReleases_RolloutOutOfRange400(t *testing.T) {
	for _, bad := range []string{"-1", "101"} {
		w := doPost(t, "/api/v1/admin/releases", `{
			"platform":"linux","arch":"x86_64","version":"0.9.`+bad+`","channel":"stable",
			"object_key":"k","rollout":`+bad+`}`, tokenOf(t, adminUser))
		require.Equal(t, http.StatusBadRequest, w.Code)
	}
}

func TestAdminReleases_DuplicateVersion409(t *testing.T) {
	createDraft(t, "linux", "x86_64", "0.8.0")
	w := doPost(t, "/api/v1/admin/releases", `{
		"platform":"linux","arch":"x86_64","version":"0.8.0","channel":"stable","object_key":"k"
	}`, tokenOf(t, adminUser))
	require.Equal(t, http.StatusConflict, w.Code, "重复登记同一版是运营误操作，要挡住而非产出两条记录")
}
```

- [ ] **Step 2: 运行确认失败，然后实现**

```bash
cd server && go test ./internal/handler/ -run TestAdminReleases_ -v
```

实现要点：

- 五个端点挂在既有的 `admin` 组上（已带 `AuthRequired` + `RequireAdmin` 双重校验）
- 每个写操作调既有的审计日志写入（照 `admin.go` 里其他写端点的写法）
- `rollout` 用 `binding:"min=0,max=100"`；唯一索引冲突映射成 **409**
- `publish` 同时写 `published_at = now()`
- **不接收签名私钥、不在服务端算签名**：`signature` 字段只接收调用方粘进来的
  `.sig` 文本内容（流水线产物）

- [ ] **Step 3: 写管理端页面**

`apps/admin/src/pages/Releases.tsx`，照 `StickerPacks.tsx` 的页面结构
（`usePagedQuery` + `Table` + `SearchBox`）：

- 列表列：平台 / 架构 / 版本 / 渠道 / 状态 / 灰度 / 强制 / 发布时间
- 行内操作：发布（draft 态）/ 回滚（published 态）/ 改灰度（输入 0-100）
- 顶部「登记新版本」表单：平台、架构、版本、渠道、对象键、`.sig` 文本、sha256、
  最低支持版本、强制更新、灰度比例
- 回滚按钮走 `ConfirmDialog` 二次确认 —— 回滚会让所有客户端立刻停止收到该版本
- `api.ts` 加五个方法

`App.tsx` 加 `/releases` 路由，`AdminLayout.tsx` 侧栏加入口。

- [ ] **Step 4: 四语文案**

至少 15 个 key（`admin.releases.title` / `.platform` / `.arch` / `.version` /
`.channel` / `.status` / `.rollout` / `.mandatory` / `.publish` / `.rollback` /
`.rollbackConfirm` / `.create` / `.signature` / `.minVersion` / `.empty`），四语同步。

- [ ] **Step 5: 跑门禁**

```bash
node scripts/check-i18n.mjs
cd server && go vet ./... && go test ./... && cd ..
LANG=C.UTF-8 pnpm test
cd apps/admin && npx tsc --noEmit && cd ../..
```

Expected: 全绿。

> `apps/admin` 的 tsc 不在 CI 的两端里（CI 只跑 web 与 desktop），
> 但 `pnpm turbo typecheck` 会覆盖它 —— husky pre-commit 跑的就是那条。

- [ ] **Step 6: Commit**

```bash
git add server apps/admin packages/design-system
git commit -m "feat(ota): 管理端版本分发页，登记/发布/回滚/改灰度全留审计日志

回滚就是改一个 status，改完对外端点立刻停止下发 ——
这是坏版本唯一的收敛手段，先前只能再发一版压过去。
重复登记同一版返 409 由唯一索引挡住，而不是产出两条互相覆盖的记录。

服务端不接收签名私钥、不算签名：signature 字段只存 release 流水线产出的
.sig 文本，管理端只做登记。"
```

### Task 19: 桌面 endpoint 切换 + Android 自动更新

> **前置**：Task 1 Step 2（FileProvider）与 Step 3（updater 格式）的结论。
> FileProvider 不可行时按 Task 1 文档的降级方案做，并在 Task 21 登记为债。

**Files:**

- Modify: `apps/desktop/src-tauri/tauri.conf.json`（updater endpoints）
- Create: `apps/desktop/src/android/otaUpdater.ts`
- Create: `packages/shared/src/api/releases.ts`
- Create: `packages/ui/src/settings/AndroidUpdateCard.tsx`
- Modify: `apps/desktop/src/pages/SettingsPage.tsx`（移动端渲染 Android 更新卡）
- Modify: `apps/desktop/src-tauri/gen/android/.../AndroidManifest.xml` 的**模板/注入点**（按 Task 1 结论）
- Modify: `packages/shared/src/mocks/handlers.ts`
- Modify: `packages/design-system/src/i18n/locales/{zh-CN,en-US,ja-JP,ko-KR}.json`
- Test: `apps/desktop/src/__tests__/otaUpdater.test.ts`

**Interfaces:**

- Consumes: Task 4 的 `startDownload` / `useDownloadStore`、Task 6 的 `install_apk`
- Produces:
  - `checkAndroidUpdate(currentVersion: string): Promise<AndroidUpdate | null>`
  - `downloadAndInstall(update: AndroidUpdate): Promise<void>`
  - `sha256Hex(bytes: Uint8Array): Promise<string>`（导出供单测）

- [ ] **Step 1: 切桌面 endpoints**

```json
"updater": {
  "pubkey": "<原值不变>",
  "endpoints": [
    "https://api.yuanyuan.blog/api/v1/updates/{{target}}/{{arch}}?version={{current_version}}",
    "https://github.com/liaojie1314/yuanchat/releases/latest/download/latest.json"
  ],
  "windows": { "installMode": "passive" }
}
```

自有端点在前、GitHub 兜底在后（updater 支持多端点按序回退）——
这正是 O1 立项时点名的「国内直连 GitHub Releases 不稳，用户永远停在旧版」。
`{{current_version}}` 占位符的实际名字按 Task 1 Step 3 的核实结论填，**不要猜**。

`UpdateChecker.tsx` 零改动。

- [ ] **Step 2: 写 sha256 校验的测试**

```ts
import { describe, it, expect, vi } from "vitest";
import { sha256Hex, downloadAndInstall } from "../android/otaUpdater";

it("sha256Hex 产出小写十六进制且长度 64", async () => {
  const hex = await sha256Hex(new TextEncoder().encode("hello"));
  expect(hex).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
});

// Review Focus #5：sha256 不匹配必须拒装并删文件
it("sha256 不匹配时不调安装器，并删掉已落盘的 APK", async () => {
  const invoke = vi.fn();
  const remove = vi.fn();
  vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
  setFileSink({
    save: vi.fn().mockResolvedValue("yuanchat-0.8.0.apk"),
    remove,
    read: vi.fn().mockResolvedValue(new TextEncoder().encode("tampered")),
  });

  await expect(
    downloadAndInstall({
      version: "0.8.0",
      url: "https://x/a.apk",
      sha256: "0".repeat(64), // 故意不匹配
      size: 9,
      notes: "",
      mandatory: false,
    }),
  ).rejects.toThrow(/sha256|校验/i);

  expect(invoke).not.toHaveBeenCalledWith("install_apk", expect.anything());
  expect(remove).toHaveBeenCalled();
});

it("sha256 匹配时才调 install_apk", async () => {
  const invoke = vi.fn().mockResolvedValue(undefined);
  vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
  const bytes = new TextEncoder().encode("hello");
  setFileSink({
    save: vi.fn().mockResolvedValue("a.apk"),
    remove: vi.fn(),
    read: vi.fn().mockResolvedValue(bytes),
  });

  await downloadAndInstall({
    version: "0.8.0",
    url: "https://x/a.apk",
    sha256: await sha256Hex(bytes),
    size: bytes.byteLength,
    notes: "",
    mandatory: false,
  });
  expect(invoke).toHaveBeenCalledWith("install_apk", { path: expect.any(String) });
});

it("服务端没给 sha256 时直接拒绝安装（宁可不更新，不装来源不明的字节）", async () => {
  const invoke = vi.fn();
  vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
  setFileSink({ save: vi.fn().mockResolvedValue("a.apk"), remove: vi.fn(), read: vi.fn() });

  await expect(
    downloadAndInstall({
      version: "0.8.0",
      url: "https://x/a.apk",
      sha256: "",
      size: 1,
      notes: "",
      mandatory: false,
    }),
  ).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: 运行确认失败，然后实现**

```bash
LANG=C.UTF-8 pnpm --filter @yuanchat/desktop test -- otaUpdater
```

`apps/desktop/src/android/otaUpdater.ts` 要点：

```ts
/**
 * Android 自动更新。
 *
 * @description
 * Tauri 的 updater 插件不支持 Android，这里自建一条：
 * 查端点 → 应用内自绘说明 → 下载 APK（复用下载器的进度条）→
 * **sha256 校验** → 调系统安装器。
 *
 * 为什么必须校验：install_apk 一旦发出 Intent，字节就交给系统 PackageInstaller 了，
 * 之后没有任何把关机会。服务端没给 sha256 时宁可不更新 ——
 * 不装来源不明的字节。APK 用 sha256 而非 minisign 是因为 APK 走的是
 * Android 自己的 v2 签名体系，minisign 那套只服务 Tauri updater。
 */

/** 用 WebCrypto 算 sha256，返回小写十六进制 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
```

`downloadAndInstall` 的流程：

1. `startDownload(`ota-${update.version}`, …)` —— 用版本号当 messageId，
   进度条与文件下载共用同一套 store 与 UI
2. 落盘后 `getFileSink().read!(fileName, "downloads")` 读回字节
3. `sha256Hex` 比对；`update.sha256` 为空或不匹配 → `remove` 文件 + `throw`
4. 匹配 → `invoke("install_apk", { path })`

`AndroidUpdateCard.tsx`：**应用内自绘**的说明卡（不弹原生框），
内容讲清「系统会要求允许安装未知应用，这是 Android 的安全机制」+
更新说明 + 进度条 + 「立即更新」按钮。`mandatory` 为 true 时不提供「稍后」。

`packages/shared/src/api/releases.ts`：`checkUpdate(platform, arch, version)`
与 `fetchCatalog()` 两个函数，204 映射成 `null`。

- [ ] **Step 4: 加 manifest 权限（按 Task 1 结论的注入点）**

```xml
<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
```

写进 Task 1 Step 2 查到的**不被覆盖的注入点**。若 Task 1 的结论是「无注入点」，
本步骤跳过并执行降级方案。

- [ ] **Step 5: MSW 覆盖四态**

`/api/v1/updates/:platform/:arch` 与 `/api/v1/updates/catalog` 各覆盖
正常 / 空（204 / `[]`）/ 错误（500）/ 加载（delay）。

- [ ] **Step 6: 四语文案**

`ota.android.title` / `.body` / `.permissionNote` / `.updateNow` / `.later` /
`.downloading` / `.verifying` / `.verifyFailed` / `.installing` / `.upToDate`，四语同步。

- [ ] **Step 7: 跑门禁**

```bash
node scripts/check-i18n.mjs
LANG=C.UTF-8 pnpm test
cd apps/desktop && npx tsc --noEmit && cd ../..
```

Expected: 4 条 otaUpdater 用例全 PASS，其余全绿。

- [ ] **Step 8: Commit**

```bash
git add apps/desktop packages
git commit -m "feat(ota): 桌面 endpoint 指向自有域名，新增 Android 自动更新

桌面 updater 的 endpoints 改为「自有域名在前、GitHub 兜底在后」——
国内直连 Releases 不稳会让用户永远停在旧版，而 updater 本身支持按序回退。

Android 自建更新链路（Tauri updater 不支持它）：查端点 → 应用内自绘说明
→ 下载（复用文件下载器的进度条）→ sha256 校验 → 调系统安装器。
校验不过就删文件并报错；服务端没给 sha256 时直接拒装 ——
install_apk 一旦发出 Intent 就没有任何把关机会了。"
```

---

## Stage F — W6 Web 端下载入口

### Task 20: 下载面板 + 侧栏入口

**Files:**

- Create: `packages/ui/src/download/DownloadPanel.tsx`
- Create: `packages/ui/src/download/detectPlatform.ts`
- Create: `packages/ui/src/download/__tests__/detectPlatform.test.ts`
- Create: `packages/ui/src/download/__tests__/DownloadPanel.test.tsx`
- Modify: `packages/ui/src/layout/MainLayout.tsx`、`packages/ui/src/index.ts`
- Modify: `packages/ui/src/settings/SettingsScreen.tsx`（手机 web 的入口）
- Modify: `packages/design-system/src/i18n/locales/{zh-CN,en-US,ja-JP,ko-KR}.json`
- Test: `apps/web/e2e/download-entry.spec.ts`

**Interfaces:**

- Consumes: Task 17 的 `GET /updates/catalog`、Task 19 的 `fetchCatalog()`
- Produces:
  - `detectPlatform(ua: string, uaDataPlatform?: string): "windows" | "darwin" | "linux" | "android" | "unknown"`
  - `<DownloadPanel />`

- [ ] **Step 1: 写平台识别的测试**

```ts
import { describe, it, expect } from "vitest";
import { detectPlatform } from "../detectPlatform";

const UA = {
  win: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
  weird: "Mozilla/5.0 (PlayStation 5)",
};

it("userAgentData 优先于 UA 字符串", () => {
  // UA 说 Linux，uaData 说 Windows → 听 uaData（UA 可被伪装/冻结）
  expect(detectPlatform(UA.linux, "Windows")).toBe("windows");
});

it("uaData 缺失时回落 UA 字符串（旧 WebView 没有这个 API）", () => {
  expect(detectPlatform(UA.win)).toBe("windows");
  expect(detectPlatform(UA.mac)).toBe("darwin");
  expect(detectPlatform(UA.linux)).toBe("linux");
});

it("Android 必须先于 Linux 判定 —— 安卓 UA 里也含 Linux", () => {
  expect(detectPlatform(UA.android)).toBe("android");
});

it("认不出来时返 unknown，不瞎猜", () => {
  expect(detectPlatform(UA.weird)).toBe("unknown");
  expect(detectPlatform("")).toBe("unknown");
});
```

- [ ] **Step 2: 实现 `detectPlatform.ts`**

```ts
/**
 * 识别当前系统，用于在下载页高亮推荐的安装包。
 *
 * @param ua `navigator.userAgent`
 * @param uaDataPlatform `navigator.userAgentData?.platform`（新 API，优先采信）
 * @remarks `userAgentData` 在旧 WebView 里不存在，必须有 UA 回落 ——
 *   本仓的 build.target 是 es2019，面向的就是旧 WebView。
 *   **Android 必须先于 Linux 判定**：安卓的 UA 里也含 "Linux"。
 */
export type DetectedPlatform = "windows" | "darwin" | "linux" | "android" | "unknown";

export function detectPlatform(ua: string, uaDataPlatform?: string): DetectedPlatform {
  const d = (uaDataPlatform ?? "").toLowerCase();
  if (d.includes("win")) return "windows";
  if (d.includes("mac")) return "darwin";
  if (d.includes("android")) return "android";
  if (d.includes("linux")) return "linux";

  const s = ua.toLowerCase();
  if (s.includes("android")) return "android"; // 必须在 linux 之前
  if (s.includes("windows")) return "windows";
  if (s.includes("mac os") || s.includes("macintosh")) return "darwin";
  if (s.includes("linux") || s.includes("x11")) return "linux";
  return "unknown";
}
```

- [ ] **Step 3: 写 `DownloadPanel` 的测试**

```tsx
it("高亮当前系统的包，其余折叠", async () => {
  vi.stubGlobal("navigator", { ...navigator, userAgent: UA.win, userAgentData: undefined });
  render(<DownloadPanel />);
  await waitFor(() => expect(screen.getByTestId("recommended")).toHaveTextContent(/Windows/i));
  // 其他平台默认收起
  expect(screen.queryByText(/\.AppImage/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /其他平台|Other platforms/i }));
  expect(screen.getByText(/\.AppImage/)).toBeInTheDocument();
});

it("加载中渲染骨架屏（固定高度，零 CLS）", () => {
  render(<DownloadPanel />);
  expect(screen.getByTestId("download-skeleton")).toBeInTheDocument();
});

it("catalog 为空时显示空态与 GitHub 兜底链接", async () => {
  // MSW 的空态开关
  render(<DownloadPanel />);
  await waitFor(() =>
    expect(screen.getByText(/暂无可用安装包|No installers/i)).toBeInTheDocument(),
  );
  expect(screen.getByRole("link", { name: /GitHub/i })).toBeInTheDocument();
});

it("请求失败时显示错误与重试按钮", async () => {
  render(<DownloadPanel />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /重试|Retry/i })).toBeInTheDocument(),
  );
});
```

- [ ] **Step 4: 实现 `DownloadPanel.tsx`**

要点：

- `fetchCatalog()` 拉数据；加载态渲染**固定高度骨架屏**（不是 spinner）
- 推荐区：`detectPlatform` 命中的平台，大按钮 + 版本号 + 包体积
- 「其他平台」默认折叠，展开后列全部
- 下载按钮是 `<a href={url} download>` —— **走浏览器原生下载，不走 W2 的应用内下载**。
  Web 端装包本来就该交给浏览器，没必要先 fetch 进内存再吐出来
- `unknown` 平台：不设推荐区，直接展开全部
- 空态：「暂无可用安装包」+ GitHub Releases 兜底链接
- 错误态：提示 + 重试按钮

- [ ] **Step 5: 加入口**

`MainLayout` 桌面侧栏沉底区，在设置项**之下**、主题切换**之上**插一个
`Download` 图标按钮，点开 `DownloadPanel` 浮层：

```tsx
// 仅 web 构建显示 —— 桌面 app 与安卓 app 内已经装好了，再给下载入口是噪音
const isDesktopApp = useIsDesktop();
// …
{
  !isDesktopApp && (
    <button
      onClick={() => setShowDownload(true)}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white/70 transition-all duration-200 hover:bg-white/15 hover:text-white"
      title={t("download.title")}
    >
      <Download size={20} />
    </button>
  );
}
```

手机 web：`SettingsScreen` 加一条「下载客户端」（同样 `!isDesktopApp` 时才渲染）。

- [ ] **Step 6: 四语文案**

| key                       | zh-CN                | en-US                    | ja-JP                                | ko-KR                       |
| ------------------------- | -------------------- | ------------------------ | ------------------------------------ | --------------------------- |
| `download.title`          | 下载客户端           | Download apps            | アプリをダウンロード                 | 앱 다운로드                 |
| `download.recommended`    | 推荐给你的版本       | Recommended for you      | おすすめのバージョン                 | 추천 버전                   |
| `download.other`          | 其他平台             | Other platforms          | 他のプラットフォーム                 | 다른 플랫폼                 |
| `download.empty`          | 暂无可用安装包       | No installers available  | 利用可能なインストーラーがありません | 사용 가능한 설치 파일 없음  |
| `download.githubFallback` | 前往 GitHub Releases | Go to GitHub Releases    | GitHub Releases へ                   | GitHub Releases로 이동      |
| `download.failed`         | 获取下载列表失败     | Failed to load downloads | ダウンロード一覧の取得に失敗         | 다운로드 목록 불러오기 실패 |
| `download.sizeLabel`      | 大小 %{size}         | Size %{size}             | サイズ %{size}                       | 크기 %{size}                |

- [ ] **Step 7: 写 E2E**

```ts
test("web 端侧栏下载入口：面板打开且当前系统项高亮", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/chat");
  await page.getByTitle(/下载客户端|Download apps/).click();
  await expect(page.getByTestId("recommended")).toBeVisible();
  // Playwright 的 chromium 跑在 Linux runner 上
  await expect(page.getByTestId("recommended")).toContainText(/Linux/i);
});
```

- [ ] **Step 8: 跑门禁**

```bash
node scripts/check-i18n.mjs
LANG=C.UTF-8 pnpm test
cd apps/web && npx tsc --noEmit && cd ../desktop && npx tsc --noEmit && cd ../..
pnpm --filter @yuanchat/web test:e2e -- download-entry
```

Expected: 全绿。

- [ ] **Step 9: Commit**

```bash
git add packages apps/web/e2e
git commit -m "feat(web): 侧栏加客户端下载入口，按当前系统高亮推荐包

数据源是 app_releases（同一张 OTA 表），不硬编码 GitHub Releases ——
否则同一份版本信息两处维护，迟早漂。表里没有 published 版本时
走空态并给 GitHub 兜底链接。

平台识别优先 userAgentData、回落 UA 字符串（旧 WebView 没有前者，
本仓 build.target 就是 es2019）；Android 必须先于 Linux 判定 ——
安卓 UA 里也含 Linux。下载走浏览器原生 <a download>，
不走应用内下载器：web 端装包本来就该交给浏览器。"
```

---

## Stage G — 收口

### Task 21: 本地 CI 全量 + 真机实测 + 文档与清单回写

**Files:**

- Modify: `docs/MASTER_PLAN.md`、`docs/ROADMAP.md`、`README.md`、`AGENTS.md`
- Modify: `docs/DB_SCHEMA.md`、`docs/CHAT_API.md`、`docs/ARCHITECTURE.md`、`docs/DEVELOPMENT.md`
- Modify: `docs/deploy/self-hosted.md`、`docs/deploy/my-deployment.local.md`
- Create: `docs/screenshots/`（四端实测截图）

**Interfaces:**

- Consumes: 前 20 个 Task 的全部产出
- Produces: 无代码

- [ ] **Step 1: 本地 CI 全量跑通（CI 实际执行的那几条，一条不少）**

```bash
pnpm dev:stop || true          # 清掉残留 dev server，否则 E2E 会被它接管
node scripts/check-i18n.mjs
LANG=C.UTF-8 pnpm test
cd apps/web && npx tsc --noEmit && cd ../..
cd apps/desktop && npx tsc --noEmit && cd ../..
pnpm --filter @yuanchat/web test:e2e
cd server && go vet ./... && go test ./... && go test -race ./internal/ws/ && cd ..
```

Expected: 全部零失败。**任一条红就不许进下一步** —— 失败的 commit 落在共享分支上，
别人拉下来就是坏的。

- [ ] **Step 2: 真实后端实测 Web 与桌面**

```bash
# 真实后端（非 Mock）：Mock 下的「通过」是假阳性
pnpm dev:server
VITE_ENABLE_MOCK=false pnpm dev:web
```

用 playwright-cli 走这几条链路并截图落 `docs/screenshots/`：

- 命令面板：Ctrl+K → 空输入见动作 → 输入见分组 → 点文件筛选器 → 点结果跳会话
- 文件下载：点下载 → 进度条 → 完成 → 「打开」
- Web 侧栏下载入口：面板 + 当前系统高亮
- 管理端 Releases：登记 → 发布 → 改灰度 → 回滚
- 登录：用邮箱与元聊号各登录一次（手机号已移除，确认旧路径确实不通）

桌面端另验：

- 托盘图标出现、左键聚焦并跳未读、右键菜单三项、tooltip 未读数
- 关窗弹窗两条分支 + 「记住我的选择」+ 设置页能改回
- 全局面板在主窗内弹出，仅会话内搜索开独立原生窗口；重复唤起更新会话范围与主题，结果交主窗定位

- [ ] **Step 3: 核对桌面入口并验 Linux 角标**

Unity LauncherEntry 需要已安装 `yuanchat.desktop`；本机已有
`/usr/share/applications/yuanchat.desktop`，无需重打/安装 `.deb`，也不要卸载既有应用。
有未读时检查 Ubuntu Dock 数字，桌面环境不支持时如实记录限制；同时验证菜单未读数。

- [ ] **Step 4: Android 真机/模拟器实测**

**连 USB 真机前先叫用户**。链路：

- 命令面板移动形态 + 返回键能关掉它（必须注册 `registerBackInterceptor`，
  否则按返回会被当成「已在标签根页面」而触发退出应用）
- 文件下载 → 进度条 → 落盘 → 「打开」能起系统应用
- 发文件 → 杀进程重启 → 重试能成功（Task 8 收的那条债）
- OTA：检查 → 说明卡 → 下载进度 → sha256 → 系统安装器弹出

实测完立刻关停模拟器与 dev 链路。

- [ ] **Step 5: 回写 MASTER_PLAN「未做清单总览」**

仅在完整测试与真实验收通过后回填下表；当前保留「验收中」，不预先补勾。旧行号仅用于定位。

| 位置                        | 改动                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 阶段三 `:271`               | `- [ ] 桌面托盘 + 系统未读角标` → `- [x]`，括注改为「Tauri tray + setBadgeCount/overlay，左键直达第一个未读；Win/macOS 未实测」 |
| 阶段三 `:272`               | 通过后勾选，括注「一个组件两种模式；桌面全局主窗弹窗、会话内原生窗口 / 手机路由页 / Web 弹窗，见 spec §1.2」                    |
| 阶段三 `:273-274`           | `- [ ] 应用内文件下载 + 进度条` → `- [x]`                                                                                       |
| 阶段三 `:275-276`           | 通过后勾选，记录全局/会话内三端承载与搜索快捷键自定义                                                                           |
| 阶段四 `:299-300`           | `- [ ] 自建 OTA 更新服务` → `- [x]`                                                                                             |
| K 泳道表 `:911,920,926,927` | K3 / K12 / K18 / K19 的「已排 vX」改 ✅ + 日期                                                                                  |
| 版本排布表 `:897-905`       | K12 从 v0.8.0、O1 从 v1.0.0 **移出**；`feature/a11y-ux` 与 `feature/multi-device-ota` 的范围相应缩减（后者剩 K13/K15/K17）      |
| §3 债表 `:796`              | 「手机号要完全移除」🟡 → ✅ + 实施摘要                                                                                          |
| §2.12 债表 `:775`           | 「文件下载应在应用内完成并显示进度」🟡 → ✅                                                                                     |
| §2.12 债表 `:778`           | 「安卓 blob 重启失效」⚪ → ✅（Task 8 收口）                                                                                    |
| 第 10 / 11 / 13 节          | 验收后更新状态 + 实际通过日期 + 分支名 + 实际交付摘要                                                                           |

**新增一个批次小节**记录本批（含 spec/plan 链接、分支、迁移号 021/022/023、
决策表摘要、实测结论），并新登记本批留债：

| 级别 | 条目                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------- |
| ⚪   | **Web 默认下载回落**：无目录/不支持时交浏览器保存，应用不能确认其最终落盘；授权目录直写不受此限制 |
| ⚪   | **安卓「另存到」公共目录**（`ACTION_CREATE_DOCUMENT`）：按 T5 不做                                |
| ⚪   | **本地库离线搜索**：只抽了 `searchSource` 接口层，实现仍只有服务端                                |
| ⚪   | **命令面板无拼音首字母匹配**                                                                      |
| ⚪   | **Web 端下载入口**（本批新增条目，已完成，登记以备日后查范围）                                    |
| +    | Task 1 的 pre-flight 若命中降级方案，把对应降级登记为债                                           |

- [ ] **Step 6: 同步其余文档**

| 文档                                 | 改动                                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/DB_SCHEMA.md`                  | users 去 phone 列与索引；新增 `app_releases` 表；新增 `idx_messages_name_trgm`                                                         |
| `docs/CHAT_API.md`                   | `/messages/search` 的 `types` 参数；`/updates/catalog` 与 `/updates/:platform/:arch`；`/admin/releases` 五端点                         |
| `docs/ARCHITECTURE.md`               | 下载器与 `fileSink` 注入层；OTA 分发链路；托盘与角标                                                                                   |
| `docs/DEVELOPMENT.md`                | 同步浏览器目录能力与回落、三端搜索、托盘资源/桌面入口、OTA 检查及测试环境                                                              |
| `docs/deploy/self-hosted.md`         | `ADMIN_PHONE` → `ADMIN_EMAIL`（含 `:335/351/359`）；**删掉 `:401-407` 那段「为什么还是手机号」**；升级既有部署时要改 `.env` 的那条提示 |
| `docs/deploy/my-deployment.local.md` | `:71` 账号来源改 `ADMIN_EMAIL`                                                                                                         |
| `README.md`                          | 功能清单加托盘/角标、命令面板、应用内下载、OTA、下载入口；换/补四端截图                                                                |
| `AGENTS.md`                          | 「当前状态」已实现清单补这几项；「未做」行删掉已做的                                                                                   |
| `docs/ROADMAP.md`                    | 「待排」里删掉 K3/K12，批次状态同步                                                                                                    |

- [ ] **Step 7: 再跑一次本地 CI 全量**

改文档也可能碰到 i18n 与 markdown lint（husky 的 lint-staged 会跑 prettier）。

```bash
node scripts/check-i18n.mjs && LANG=C.UTF-8 pnpm test
cd server && go vet ./... && go test ./... && cd ..
```

- [ ] **Step 8: Commit**

```bash
git add docs README.md AGENTS.md
git commit -m "docs(tray-palette-ota): 同步本批功能、验收与平台边界

K3/K12/K18/K19/O1 与手机号移除六项全部改为已完成；K12 从 v0.8.0、
O1 从 v1.0.0 移出版本排布表。新增本批小节记录决策与实测结论。

记录三端搜索承载、通用设置和下载目录授权，以及平台限制与真实验收结果。"
```

- [ ] **Step 9: 合回 dev（需用户确认推送）**

```bash
git checkout dev
git merge --no-ff feature/tray-palette-ota
```

**推送到远端前必须确认上面的本地 CI 全量是绿的。** 合 main / 打 tag / 发版
**不在本批范围**，需当次单独征询用户。

---

## Self-Review 结论

| 检查                  | 结果                                                                                                                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spec 覆盖**         | spec 的 §2→Task 2-3、§3→Task 4-8、§4→Task 9-12、§5→Task 13-15、§6→Task 16-19、§7→Task 20、§8 共用件→Task 5/6/21、§9 门禁→Task 21、§10 留债→Task 21 Step 5、§11 已核实事实→散落在各 Task 的「前置」说明。无遗漏。                        |
| **占位符扫描**        | 无 TBD / TODO / 「类似 Task N」。Task 11 Step 4 与 Task 18 Step 3 给的是「骨架 + 必须落地的行为清单」而非完整 JSX —— 这两处是纯排版组件，行为清单已逐条列明（10 条 / 6 条），实现者照单做即可。                                         |
| **类型一致性**        | `FileSink` 四个方法名在 Task 5/6/8/19 一致；`Search` 的 `types []int` 参数位置在 Task 9/10 一致；`selectTotalUnread` / `selectFirstUnreadId` 在 Task 13/14 一致；`DownloadEntry` 字段在 Task 4/7 一致；`InRollout` 在 Task 16/17 一致。 |
| **Review Focus 落点** | #1 LIKE 通配符→Task 9 Step 1；#2 断网/URL 过期→Task 4 Step 1；#3 同名覆盖→Task 5 Step 1；#4 `setBadgeCount` 抛错→Task 14 Step 1；#5 APK sha256→Task 19 Step 2。五条各有测试。                                                           |
