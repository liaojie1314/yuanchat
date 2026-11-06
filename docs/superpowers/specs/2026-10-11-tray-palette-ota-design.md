# 桌面托盘 / 命令面板 / OTA 分发 —— 设计

| 项       | 值                                                                          |
| -------- | --------------------------------------------------------------------------- |
| 日期     | 2026-10-11                                                                  |
| 批次     | K12 + K3 + K18 + K19 + O1 + 手机号移除 + Web 下载入口                       |
| 分支     | `feature/tray-palette-ota`（自 `dev` 切出，`--no-ff` 合回）                 |
| 迁移号   | **021**（删 phone）、**022**（文件名 trgm 索引）、**023**（`app_releases`） |
| 目标版本 | 本批不发版；全绿后当次询问合 `dev`。K12 从 v0.8.0、O1 从 v1.0.0 提前到本批  |
| 执行计划 | `docs/superpowers/plans/2026-10-11-tray-palette-ota.md`                     |

## 0. 背景与范围

六条工作流，一个分支，按依赖串行。W5 的 Android 更新复用 W2 的下载器与文件能力；
W6 查询 catalog 后直接交浏览器下载安装包，不使用聊天文件的默认目录。

**2026-11-06 状态**：本轮指定链路修订、核心页面截图与本地检查已完成，源码已提交至
`a21c63d`，最终 Chromium E2E 119 / 119 全绿（3.7 分钟、无重试），运行环境已关闭。
尚未合并或发版；本轮未重跑最新 APK 完整 OTA 安装、无 Windows/macOS 实机验收，
SAF 另存为未实现。测量范围与具体结果见实施计划当前状态。
本批尚未合并、推送或发版，最新证据见实施计划头部。

| 代号 | 工作流                                      | 来源                                         |
| ---- | ------------------------------------------- | -------------------------------------------- |
| W1   | 手机号完全移除（破坏性）                    | MASTER_PLAN §3 债表 🟡，用户 2026-10-11 决定 |
| W2   | K19 应用内文件下载 + 进度条                 | MASTER_PLAN §13，用户真机实测首要诉求        |
| W3   | K3 命令面板 + K18 搜索体验重做              | MASTER_PLAN §10，立项结论要求两者合并        |
| W4   | K12 桌面托盘 + 系统未读角标                 | MASTER_PLAN K 泳道                           |
| W5   | O1 自建 OTA 更新服务（含 Android 自动更新） | MASTER_PLAN §11                              |
| W6   | Web 端侧边下载入口                          | 用户 2026-10-11 新提，清单原本未登记         |

**不在本批范围**：阅后即焚、远程操控、无障碍泳道、性能批次、本地库离线搜索、
贴纸 DIY、定时发送、消息翻译。

## 1. 决策记录（本次定案，不要重开讨论）

| 编号 | 决策                                                                                                    | 理由                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| T1   | K3 与 K18 **合并实现**，含后端类型过滤与文件名检索                                                      | 立项结论原话：两者都要改同一个组件，分两次做第二次得先拆掉第一次的结构                                                                  |
| T2   | O1 做**全量**：桌面 + Android 自动更新 + 渠道/灰度/回滚                                                 | 灰度是一个按设备稳定哈希取模的 WHERE，回滚是改一个 status 字段 —— 相对前两步几乎零增量                                                  |
| T3   | 迁移 **直接 DROP** `users.phone` 与 `idx_users_phone`                                                   | 生产库已核实（见 §1.1），零锁死风险                                                                                                     |
| T4   | 桌面关窗 → 自绘弹窗二选一「最小化到托盘 / 退出应用」+「记住我的选择」                                   | 用户选定。每次都弹会变骚扰，故带记忆 + 设置页可改回                                                                                     |
| T5   | 安卓下载落**应用私有 Download 目录**，不做「另存到」公共目录                                            | 零权限、零原生弹窗（符合 `no-native-permission-dialogs` 约定）。`ACTION_CREATE_DOCUMENT` 虽非权限弹窗，但本批已有六条工作流，要做另立项 |
| T6   | 下载产物**不进** L1 的媒体 LRU 配额                                                                     | 缓存可重签 URL 取回，下载产物不可再生；用户显式要求保留的文件被 LRU 清掉很意外                                                          |
| T7   | W6 下载入口的数据源是 `app_releases`，**不硬编码 GitHub Releases**                                      | 否则同一份版本信息两处维护，迟早漂                                                                                                      |
| T8   | 桌面全局面板用主窗内弹窗，仅会话内搜索用原生窗口；手机路由页、Web 大屏弹窗                              | 见 §1.2；2026-11-05 用户最新确认，覆盖此前桌面全局/会话内都开独立窗的方案                                                               |
| T9   | 未读角标**不生成数字图标**：`setBadgeCount` 交系统画，Windows 用静态红点 PNG，数字走托盘 tooltip 与菜单 | 见 §1.3                                                                                                                                 |
| T10  | 本批**不发版**；全绿后当次询问合 `dev`，push / main / tag / release 未执行                              | 用户本批明确要求；不可凭旧授权自动收口                                                                                                  |
| T11  | OTA 对外端点收敛成**两条**：`/updates/catalog`（静态段）+ `/updates/:platform/:arch`（两段，安卓共用）  | 原构想的 `/updates/android` 与 `/updates/downloads` 都是单段路径，在 Gin 里同层注册静态段与通配段会打架                                 |

### 1.1 T3 的事实依据（2026-10-11 查生产库 `yuanyuan.blog`）

查之前：5 个用户，其中 2 个「只有手机号、无邮箱」—— `10000 部署冒烟`、
`10006 管理员`（bootstrap 建的）。两者均为 0 消息 / 0 会话 / 0 动态 /
0 贴纸包 / 0 审计日志，完全空。

**关键发现**：`user_service.go:266-274` 的登录在非 `@` 分支里是「先查手机号，
查不到再查元聊号」。因此删掉手机号分支后，这两个账号**仍可用元聊号 + 原密码登录**
—— MASTER_PLAN 原先担心的「存量用户被锁死在门外」这道前置并不存在。

按用户 2026-10-11 指示已处置（事务内完成，已验证）：

```sql
DELETE FROM users WHERE short_id = 10000;                                  -- 冒烟测试号
UPDATE users SET email = 'admin@yuanyuan.blog' WHERE short_id = 10006;     -- 管理员补邮箱
```

2026-10-11 处置后：4 个用户，**全部有邮箱，零手机号专属账号**，据此执行迁移删列；此处是当时快照。

> ⚠️ 部署时必须同步把服务器 `deploy/.env` 的 `ADMIN_PHONE=13900000001` 换成
> `ADMIN_EMAIL=admin@yuanyuan.blog` —— `bootstrap-admin` 的去重键改成 email 之后，
> 两者不一致会让下次 `install.sh` **再建一个管理员账号**。
> 证书联系邮箱另用 `LE_EMAIL`，已有部署重跑安装脚本前手工补齐；`ADMIN_EMAIL` 只保留一条账号键。

### 1.2 搜索与设置承载修订（2026-11-05 确认，2026-11-06 复核）

以 2026-11-05 用户最后确认的入口分工为准，覆盖早期承载方案：

- 桌面客户端：全局 Ctrl/Cmd+K 命令面板在主窗口内弹出；只有会话内搜索使用独立 Tauri
  原生窗口，已存在窗口须能切换会话范围。
- 手机端（Android 与手机 Web）：独立路由搜索页面；返回回到原页面，选结果直接落到目标会话。
- Web 桌面端：居中弹窗。

全局搜索与聊天标题栏的会话内搜索共用 `CommandPalette` 内容，按上述入口分工承载，
旧内嵌搜索条不再保留。
会话内查询始终传 `conversation_id`，不混入全局动作、好友和其他会话结果。
独立窗口只拉自己的本地检索源，不另建 WS；导航与消息定位经已有桥交主窗口执行，
`search:ready` / `search:scope` 同步范围与 `skinId`，宿主 `app-screen` 铺满背景。
上述三条路径均已实现；开窗串行去重，登出/换号关闭旧窗并拒绝旧账号迟到导航。
2026-11-06 fresh Linux 已验证暗色首次开窗、已有窗主题切换、全窗背景与会话范围切换，
19 项相关回归通过。上轮主题异常没有复现；HMR 未重跑既有 effect 是候选解释，历史
根因尚未确认。本轮各链路的实测范围与限制见实施计划当前状态。

设置按 2026-11-05 用户意见合并为「通用设置」：主题、语言、文件下载目录与搜索快捷键
同页，不保留独立「文件下载」导航；2026-11-06 追加：快捷键设置只在非手机布局展示，
复用 `SettingsScreen` 的 `isMobile` 隐藏手机入口，桌面/平板保留，已保存组合不变。
手机入口副文案四语使用 `settings.generalDescMobile`（中文「外观与下载」），桌面保留原描述。
共享目录卡显示目录名/授权状态，操作复用 `Button`；
目录选择和重新授权由用户点击后调用浏览器安全流程。

### 1.3 T9 为什么不画数字角标

原始构想是写一个 `badgeIcon(n)` 用 canvas 画数字转 RGBA，供托盘图标、
Windows overlay icon 两处复用。放弃，因为：

- Windows 与 macOS 本项目**没有测试设备**（见 `project-charter`），该代码路径永远测不到
- `setOverlayIcon` 的 JS 签名是 `string | Image | Uint8Array | ArrayBuffer | number[]`，
  而 Rust 侧收的是裸 RGBA 的 `Image<'_>` —— `Uint8Array` 到底是 PNG 字节流还是裸 RGBA，
  文档没讲清

在永远测不到的平台上押一个不确定的编码格式，等于写了行不通也不会被发现的代码。
改为：

| 平台          | 角标实现                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| macOS / Linux | `getCurrentWindow().setBadgeCount(n)` —— 数字由系统绘制                                                     |
| Windows       | `resolveResource` → `Image.fromPath` → `setOverlayIcon(image)`；静态红点两态，图标作为 bundle resource 分发 |
| 托盘图标      | 静态，不随未读变化                                                                                          |
| 数字信息      | 托盘 tooltip（`元聊 — 未读 12 条`）+ 托盘菜单首项                                                           |

数字信息零损失，不确定的编码路径被完全移除。

> Linux 实测边界（已核实本机）：`libayatana-appindicator3` 与 GNOME
> `ubuntu-appindicators` 扩展都在 → **托盘可真机实测**。但 `setBadgeCount` 在 Linux
> 走 Unity LauncherEntry DBus，需要 `yuanchat.desktop` 已安装（Tauri 传的是
> `{package_name}.desktop`）。本机已有 `/usr/share/applications/yuanchat.desktop`，
> 可直接复验；缺少该条目的环境先安装桌面入口，无需为已有条目重打 `.deb`。

---

## 2. W1 — 手机号完全移除（破坏性变更）

### 2.1 迁移 021

```sql
-- +goose Up
DROP INDEX IF EXISTS idx_users_phone;
ALTER TABLE users DROP COLUMN IF EXISTS phone;

-- +goose Down
-- 只恢复结构，不恢复数据：列删掉之后号码就没了，Down 回来的是一列 NULL。
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone varchar(20);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users (phone);
```

不加「存在无邮箱用户则 RAISE 中止」的护栏 —— §1.1 已核实生产库全员有邮箱，
且删列后元聊号登录仍可用，护栏没有要防的东西。

### 2.2 后端改点（逐处）

| 文件                                       | 改动                                                                                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `internal/model/user.go:13`                | 删 `Phone *string` 字段                                                                                                                                   |
| `internal/repository/user_repo.go:48-52`   | 删 `FindByPhone`                                                                                                                                          |
| `internal/repository/user_repo.go:78-84`   | `ExistsByPhoneOrEmail(phone, email)` → `ExistsByEmail(email)`。签名一并收窄 —— 留着空串位就是留个坑（当前唯一调用方 `user_service.go:181` 已经在传 `""`） |
| `internal/repository/admin_repo.go:31`     | 搜索条件去掉 `phone LIKE ?`，剩 `nickname ILIKE OR email ILIKE`                                                                                           |
| `internal/service/user_service.go:262-274` | 非 `@` 分支直接走 `FindByShortID`，省掉白查一次手机号；`:143-144`、`:180` 的注释同步改写                                                                  |
| `internal/service/user_service.go:24`      | `ErrDuplicateUser` 文案 `phone or email` → `email`                                                                                                        |
| `internal/service/auth_service.go:91`      | 删 `FindByPhone` 回落，只查邮箱                                                                                                                           |
| `internal/service/contact_service.go:81`   | 删手机号搜索分支（好友搜索剩邮箱 + 元聊号）                                                                                                               |
| `internal/handler/auth.go:33-59`           | 删 `SendResetCodeRequest.Phone` / `VerifyResetCodeRequest.Phone` 与两处 `target()` 的回落                                                                 |
| `internal/handler/user.go:285`             | 注释里「老账号库里仍有 phone 列与按手机号登录」已失真，改写                                                                                               |
| `cmd/bootstrapadmin/main.go`               | env `YUANCHAT_BOOTSTRAP_ADMIN_PHONE` → `_EMAIL`；去重查询 `WHERE phone = ?` → `WHERE email = ?`；`Phone: &phone` → `Email: email`；输出文案改「邮箱」     |
| `cmd/seed/main.go`                         | `seedUsers` 的 `phone` 字段改 `email`，去重键同步                                                                                                         |

### 2.3 前端改点

| 文件                                               | 改动                                                     |
| -------------------------------------------------- | -------------------------------------------------------- |
| `packages/shared/src/store/authStore.ts:42,61,108` | `UserDto.phone` / `User.phone` / 映射全删                |
| `packages/shared/src/types/index.ts:23`            | 删 `phone`                                               |
| `packages/shared/src/mocks/handlers.ts:24,33`      | mock 用户删 `phone`                                      |
| `packages/shared/src/mocks/handlers.ts:1235-1258`  | login / reset handler 去掉 `body.phone` 回落与那条注释   |
| `apps/admin/src/pages/Users.tsx:66`                | `{u.phone \|\| u.email \|\| "—"}` → `{u.email \|\| "—"}` |

**i18n（四语同步）**：`admin.users.searchPlaceholder` 当前是
`昵称 / 手机号 / 邮箱 / 用户ID`，改为 `昵称 / 邮箱 / 用户ID`。

> `auth.accountPlaceholder` 已经是「邮箱 / 元聊号」，无需改动 —— 前端文案先前已改过，
> 只有后端还在接手机号。
>
> `auth.qrConfirmOnPhone` / `auth.qrCanceled` 说的是「手机这台设备」，**不在本条范围**。

### 2.4 部署侧

| 文件                                             | 改动                                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `deploy/.env.prod.example:23`                    | `ADMIN_PHONE=` → `ADMIN_EMAIL=`                                                                                          |
| `deploy/install.sh:45,141,241,252,254`           | 变量名与四处提示文案                                                                                                     |
| `deploy/docker-compose.prod.yml:135`             | `YUANCHAT_BOOTSTRAP_ADMIN_PHONE` → `_EMAIL`                                                                              |
| `docs/deploy/self-hosted.md:335,351,359,401-407` | 示例值改邮箱；**删掉 `:401-407` 那段「ADMIN_PHONE 这一项为什么还是手机号」的说明**（本批正是它说的那个「计划完全移除」） |
| `docs/deploy/my-deployment.local.md:71`          | 账号来源改 `ADMIN_EMAIL`                                                                                                 |
| `docs/DB_SCHEMA.md`                              | users 表去掉 phone 列与索引                                                                                              |

### 2.5 兼容姿态

**不做兼容。** 旧客户端拿手机号登录将收到「用户不存在」。前后端同版发布，
与既有先例（`/auth/*` 前缀收敛、`/users/login` 迁移）同一姿态。

与 W5 的协同：`app_releases.min_version` 可把低于本版的客户端判为**强制更新**，
这正是「破坏性变更 + 自建 OTA」应有的配合 —— 旧客户端会被推着升上来，
而不是停在一个登录不了的版本上。

### 2.6 测试

- `user_service` 登录用例：邮箱命中、元聊号命中、两者都不命中计失败计数（既有用例改签名）
- `contact_service` 搜索用例：手机号串**不再**命中（防回归）
- `bootstrapadmin`：已存在同邮箱账号 → 提权不改密；不存在 → 建号
- 迁移 021 的 up/down 在 `testutil` 的临时库上各跑一遍

---

## 3. W2 — K19 应用内文件下载 + 进度条

### 3.1 立项时的现状与根因（2026-10-11）

`MessageBubble.tsx:546-560` 签出预签名 URL 后交给 `openExternal`：桌面与安卓跳出应用
到系统浏览器/下载管理器，Web 端在新标签页里预览。用户要的是「点下载 → 气泡下方
出现进度条 → 落到应用自己的下载目录」。

**已证明可行的前置**（不必在 plan 阶段重新验）：`resolveObjectUrl`
（`files.ts:602-632`）早就在 `fetch(预签名URL)` → `arrayBuffer()`，
且 L1 批次在真实后端实测通过（IDB 落了 `media:2`）。所以：

- MinIO 预签名 URL 的**跨域 GET 读 body 的 CORS 已可用**
- `Content-Length` 属 CORS 安全列表响应头，无需 `Expose-Headers` 即可读 → 确定性进度条成立
- 桌面 CSP 的 `connect-src` 已登记 `http://localhost:9002` 与
  `https://storage.yuanyuan.blog` → `fetch` 不会被 CSP 拦（原先走原生 shell，CSP 不参与）

### 3.2 新增 `packages/shared/src/download/`

下载状态、落盘与浏览器目录偏好按 `frontend-src-foldering` 约定独立成目录。

**`downloadStore.ts`** — Zustand store，按 `messageId` 建条目：

```ts
type DownloadPhase = "downloading" | "saving" | "done" | "failed" | "canceled";
interface DownloadEntry {
  phase: DownloadPhase;
  received: number;
  /** 0 表示服务端未给 content-length → 进度条走不确定态 */
  total: number;
  savedPath?: string;
  error?: string;
}
```

- `startDownload(messageId, objectKey, fileName)`：`getDownloadUrl(key, name)` →
  `fetch(url, { signal })` → `res.body.getReader()` 循环累计
- **进度更新按 100ms 节流**。不节流的话 100MB 文件每个 chunk 推一次 `setState`，
  会把 React 打爆（这是确定性进度条的实现成本，不是可选优化）
- `res.body` 为空（老 WebView / 响应无体）→ 退回 `res.blob()` 走不确定态，不报错
- `cancelDownload(messageId)`：`AbortController.abort()`，条目进 `canceled`
- 已有 active 条目时重复调用 `startDownload` **直接返回**（重复点击 no-op）
- 字节齐了交给注入的 `fileSink`，phase 进 `saving` → `done`

**`fileSink.ts`** — 落盘抽象，与 `openExternal.ts` / `notify.ts` 同一套注入模式
（UI 层不能直接 `import @tauri-apps/*`，否则 web 构建把桌面依赖拖进去）：

接口以 `packages/shared/src/download/fileSink.ts` 导出的 `FileSink` 为准：`save` 返回
原生绝对路径、Web 授权文件引用或 `null`（默认浏览器下载）；`read` / `exists` /
`isCurrentDirectory` 支持核验完成记录，`remove` 清理本次产物或 outbox 副本。
`revealTarget` 区分文件夹、文件和保存位置，`reveal` 执行原生打开或返回 Web 可读位置，
`describe` 将 Web 内部引用转成目录名与文件名。桌面额外注入 `downloadDirectory` 的
`get` / `choose` / `reset`，移动端不暴露选择目录能力。Web 的 `appdata` 保存/删除仍为
no-op、读取仍拒绝，不能因新增下载读回能力而触发 outbox 附件下载。

- **Web 默认实现**（无需注入）：优先加载 `browserDirectory.ts` 在独立 IDB 中保存的
  目录句柄，检查已有写权限 → Web Locks 占名 → 写入 → close → 完成。失败/取消清理本次
  产物；失权提示到「设置 → 通用设置 → 文件下载」重新授权，不静默换保存位置。
  安全上下文、目录选择 API、IDB、Web Locks 齐备才提供选目录入口；无目录时使用 Blob +
  `<a download>` 浏览器保存，不能确认浏览器最终落盘。两条路径都在读取 IDB 后检查取消。
  Web 不持有绝对路径；授权目录保存成功返回内部文件引用，目录/文件句柄及实际文件名
  存账号本地库的 meta 并按服务器隔离。恢复默认只清目录偏好，不删除文件。
- **桌面 / 安卓实现**（`apps/desktop/src/main.tsx` 注入，与既有 `setUrlOpener` /
  `setNotifier` 并列）：`@tauri-apps/plugin-fs` 的
  创建文件并循环写入，处理短写、并发占名与失败/取消清理。
  安卓上 `BaseDirectory.Download` 落在应用私有 external files 目录，**无需任何权限**
  （决策 T5）。桌面由原生选择器设置下载目录，原生 JSON 持久化当前目录及历史授权；
  重启先恢复文件系统范围，恢复默认仍保留历史授权。`reveal` 走 §8.1 的 `open_local_file`

同名文件处理：`文件名 (2).pdf` 递增，不静默覆盖 —— 覆盖用户已有的下载是不可逆的。

**2026-11-06 完成记录与复用**：已落盘结果在账号本地库中按服务器隔离，保存原始字节的
SHA-256 和实际路径（含同名后缀）历史候选。登录恢复、目录切换以及点击完成操作时核验
当前目录身份、原路径存在及内容；A→B→A 切回可复用旧目录中的有效副本。原路径改名、
丢失或内容修改时重新下载并避让现有文件，不扫描任意重命名、不删除用户修改的文件；
失权或读取错误须提示处理，不能误判成文件丢失。默认浏览器下载没有可核验路径，不保留
完成记录；登出清内存并中止在途下载，不删除已下载文件。用户已确认下载实测没有问题，
本轮指定 Android 链路与本地检查已完成，未重跑最新 APK 的完整 OTA 安装流程。

### 3.3 UI

`MessageBubble` 文件气泡**下方**加一条进度条：

- 所有状态预留同一固定进度空间，idle/done/canceled 也不移除占位；2026-11-05 真实使用
  发现旧实现显隐会推动下方消息，不能把 `return null` 当作零 CLS
- 放气泡**外**而不是气泡内：气泡内会再踩一次 MASTER_PLAN §2.12 那个 `min-content` 顶穿
  （进度条有最小宽度诉求，会向上贡献 min-content）。进度条行用 `w-full`，
  宽度由父列正推为定值
- 样式语言复用 `UpdateChecker.tsx:117-124` 的既有进度条
  （`h-1.5 rounded-full bg-surface-container-highest` + `bg-primary` 填充），
  不另造一套
- `downloading` 态下载按钮变 `X`（取消）；`failed` 态变重试；有效 `done` 态按能力显示
  桌面「打开所在文件夹」、Android「打开文件」、Web「查看保存位置」。Web 位置弹窗复用
  `ConfirmDialog`，仅有一个关闭按钮；默认浏览器下载仍显示下载入口
- `total === 0` 时进度条走不确定态动画（无 `width` 百分比）

`ConversationMediaView.tsx:199` 的下载同步接上同一套 store。

### 3.4 顺带收掉的债（MASTER_PLAN §2.12 ⚪）

> 安卓上用文件选择器发出的消息，blob 在应用重启后必然失效，此时「重试」只能
> 如实报「本地文件已失效」。

正解：发送前把字节写 `BaseDirectory.AppLocalData` 下 `outbox/<clientMsgId>`，
重试从磁盘读而非失效 blob。**清理策略：发送成功即删**，不引入 LRU 配额
—— outbox 条目本来就短命，给它配一套配额账本是无谓的基建。
复用 §3.2 的 `fileSink`，走 `dir: "appdata"` 分支（`save` / `read` / `remove` 三个方法）。

### 3.5 决策 T6 的落点

下载产物**不进** L1 的媒体 LRU（`localdb/media.ts` 的配额账本）。
媒体缓存可以随时重签 URL 取回，下载产物不可再生；用户显式按了「下载」的文件
被 LRU 后台清掉会非常意外。两者是不同性质的字节，不该共用一套回收策略。

### 3.6 测试

- `downloadStore` 单测：喂一个假 `ReadableStream`，断言进度单调递增、节流后更新次数
  有上界、abort 后 phase 进 `canceled`、重复 start 不起第二条请求、
  无 `content-length` 时 `total === 0`
- `fileSink` Web 回归：授权句柄持久化、失权、同名避让、close 失败、写盘/IDB 等待期间取消；无目录时验证浏览器保存回落
- 完成记录回归：刷新恢复、账号/服务器隔离、同大小内容修改、原路径丢失、带后缀文件、
  A→B→A 目录切回；目录选择取消/恢复默认保留已有文件，Web `appdata` 保持原 no-op 行为
- **E2E 量真实尺寸**：按 MASTER_PLAN §2.12 的测试教训（「凡宽度/溢出/换行类缺陷一律在 E2E 量真实
  `getBoundingClientRect()`，不要只断言类名」），在 412px 视口断言进度条宽度不超过
  气泡列宽

---

## 4. W3 — K3 命令面板 + K18 搜索体验重做

### 4.1 「搜不到文件」的立项根因（2026-10-11）

`message_repo.go:343` 的检索条件只有一句 `(m.content->>'text') ILIKE ?`。
文件名存在 `content->>'name'` 里，**压根没进 WHERE**；迁移 003 的 trgm GIN 索引
也只建在 `(content->>'text')` 上。所以不是「UI 搜不到」，是后端从来没检索过文件名。

### 4.2 后端

**迁移 022**（照 003 的形状，含 `NO TRANSACTION` 与 partial 条件）：

```sql
-- +goose NO TRANSACTION
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_name_trgm
    ON messages USING gin ((content->>'name') gin_trgm_ops)
    WHERE deleted_at IS NULL AND status = 1;
```

**`message_repo.go` 的 `Search`**：

- 文本条件改 `((m.content->>'text') ILIKE ? OR (m.content->>'name') ILIKE ?)`
  —— 两个 GIN 索引由 planner 走 BitmapOr 合并
- 新增 `types []int` 参数 → `m.message_type IN (?)`；空切片表示不过滤
- E2EE 排除与成员校验口径**完全不变**（不能因为加过滤顺手放宽可见性）
- 全局/会话内与类型筛选均排除本人清空水位前的消息、软删消息与已解散会话

**`handler/message.go`**：收 `types=file,image,video,voice` 逗号分隔列表，
映射到 `model.MessageType*` 常量；出现未知值返 400（不静默忽略 —— 静默忽略会让
前端以为筛选生效了）。

### 4.3 前端 `packages/ui/src/palette/`（新目录）

`CommandPalette.tsx` 取代 `SearchModal.tsx`（148 行，删除）。**一个组件两种模式**：

| 输入 | 模式     | 内容                                           |
| ---- | -------- | ---------------------------------------------- |
| 空   | 命令面板 | `paletteActions.ts` 动作注册表 + 最近 5 个会话 |
| 非空 | 搜索     | 三源并发 + 分组结果 + 类型筛选                 |

**`paletteActions.ts`** —— `{ id, labelKey, icon, keywords, run }[]`，
动作：新建群聊 / 打开设置 / 切换主题 / 退出登录 / 表情商城 / 我的收藏 /
朋友圈 / 检查更新（原生桌面与 Android，直达关于页并触发检查）。`keywords` 供模糊匹配（输入 "qh" 命中「切换主题」
这类拼音首字母**不做** —— 中文模糊匹配是个独立课题，YAGNI）。

**搜索三源并发**：

- 联系人：`useContactStore` 内存过滤（零往返）
- 会话：`useConversationStore` 内存过滤（零往返）
- 消息与文件：`searchMessages`（服务端，带 `types`）

**结果分组**：`联系人 / 群聊 / 消息 / 文件与媒体`，空分组不渲染标题。
会话内模式只查当前 `conversation_id` 的消息与文件，不混入全局动作、联系人或其他会话。

**类型筛选条**：全部 / 消息 / 文件 / 图片 / 视频 / 语音 → 映射到后端 `types`。

**媒体缩略图**：图片/视频命中走 `resolveObjectUrl(key)`。**固定宽高 + Skeleton 占位，
CLS 必须为零**（AGENTS 第 9 条）。

**键盘**：`↑` `↓` 移动选中、`Enter` 执行、`Esc` 关闭；IME Enter 选字不执行结果。
默认 Ctrl/Cmd+K 可在非手机布局的「通用设置」自定义，手机不展示该设置；
`shortcutStore` 本机持久化并拒绝保留键/冲突，
忽略 IME 组合和长按重复事件。本批只做搜索组合，不等同完整 J3 快捷键体系。

**`searchSource` 接口层**：按立项结论抽出来，只落服务端实现。
本地库实现（离线可搜）挂后续，届时策略是「本地先出结果、服务端到了再合并」。

### 4.4 三端形态（决策 T8）

全局与会话内共用面板组件，桌面入口分别承载：

| 平台               | 形态                                                       |
| ------------------ | ---------------------------------------------------------- |
| Tauri 桌面全局面板 | 主窗口内居中弹窗                                           |
| Tauri 桌面会话搜索 | 独立 `search` 窗口，880×620；Windows 按逻辑工作区限幅      |
| Android / 手机 Web | `/search` 独立路由页，返回来源页；选择结果后替换到目标会话 |
| Web 大屏           | 居中面板，桌面约 720×560，结果区滚动                       |

桌面会话搜索由 `search:ready` / `search:scope` 同步最新范围与主题，`search:navigate`
把导航交主窗；全局面板直接使用主窗状态。
旧 `InConversationSearch` 已移除；手机返回键由搜索页处理，不退出应用。

### 4.5 测试

- `message_repo.Search` 集成用例：文件名命中、`types` 过滤生效、E2EE 仍被排除、
  非成员会话仍不可见
- handler 用例：`types` 含未知值返 400
- `CommandPalette` 单测：空输入渲染动作列表、输入后分组渲染、↑↓ Enter 键盘导航、
  类型筛选改变请求参数
- E2E：Ctrl+K 打开 → 输入 → 点消息结果 → 落到目标会话并定位该消息

---

## 5. W4 — K12 桌面托盘 + 系统未读角标

### 5.1 零新依赖（已核实）

- `Cargo.toml:49` 的 `tauri = { version = "2.11.2", features = ["tray-icon"] }`
  —— tray feature **已开**
- JS 侧 `@tauri-apps/api/tray`（`TrayIcon.new` / `setTooltip` / `setMenu` / `setIcon`）、
  `window.setBadgeCount`、`window.setOverlayIcon` **全部现成**
- 权限标识符已从 `gen/schemas/desktop-schema.json` 核实存在（**不猜**，
  这条踩过坑 → `tauri-permission-naming`）

### 5.2 `apps/desktop/src/tray.ts`（新）

```
TrayIcon.new({
  id: "main",
  icon: <bundle 里的应用图标>,
  tooltip: "元聊",
  menu: <打开元聊 | 未读 N 条（disabled） | 退出>,
  showMenuOnLeftClick: false,
  action: 左键 → show() + unminimize() + setFocus() + 跳第一个未读会话,
})
```

- 左键「跳第一个未读会话」：按会话列表顺序取第一条 `unreadCount > 0 && !isMuted`，
  没有未读就只聚焦窗口不跳转（强行跳到一个已读会话会把用户正在看的位置顶掉）
- 托盘只在 `#[cfg(desktop)]` 下建；安卓侧不注册（Tauri 的 Android 没有托盘概念）
- 退出项走 `app.exit(0)`，不是 `window.close()` —— 后者在 T4 下会被拦成「最小化」

### 5.3 未读数的唯一来源

`MainLayout.tsx:91-93` 的那个 reduce 抽成 `packages/shared` 的 selector
（如 `selectTotalUnread`），托盘与侧栏/底栏共用同一个口径。

> 两处各算一遍必然漂移 —— 这正是 `single-source-invariants` 记忆里
> `navItems.ts` 派生导航那条债的同一个形状（先前两处各写一份，底栏换成朋友圈时
> 清单没跟上，按返回键会莫名跳回聊天页）。

### 5.4 角标（决策 T9）

| 平台          | 实现                                                                       | 可测性                     |
| ------------- | -------------------------------------------------------------------------- | -------------------------- |
| macOS / Linux | `getCurrentWindow().setBadgeCount(n \|\| undefined)`                       | Linux 需装 .deb（见 §1.3） |
| Windows       | `resolveResource` → `Image.fromPath` → `setOverlayIcon(image)`；无未读清空 | **无设备，不实测**         |
| 托盘 tooltip  | `元聊 — 未读 N 条` / 无未读时 `元聊`                                       | Linux 可测                 |
| 托盘菜单首项  | `未读 N 条`（disabled 信息项，`setText` 更新）                             | Linux 可测                 |

所有角标调用**裹 try/catch 并只记 warn** —— 平台不支持时（如 Linux 未装 .desktop）
抛错不能冒泡到 UI。角标是增强，失败了应用照常用。

需要一张 `icons/badge-dot.png`（纯色圆点，16×16 与 32×32）加进 bundle icon 清单。

### 5.5 关窗行为（决策 T4）

`TitleBar.tsx:11` **已有 `onClose` prop**（当前 `App.tsx:180` 没传，默认走
`getCurrentWindow().close()`），挂点现成，不改组件签名。

- `App.tsx` 给 `<TitleBar onClose={handleClose} />`
- `handleClose`：读持久化偏好 →
  - 未选过 → 弹自绘 `ConfirmDialog`（`packages/ui/src/primitives/ConfirmDialog.tsx`
    已有 role/aria-modal/Esc/焦点陷阱）两按钮「最小化到托盘 / 退出应用」+「记住我的选择」复选框
  - 选过 → 直接按偏好执行
- 偏好存哪：新建 `packages/shared/src/store/desktopStore.ts`，用 `persist`
  （`themeStore.ts` / `authStore.ts` 是现成的 persist 范式）
- 设置页「桌面端」分组加一条可改回的开关（否则勾了「记住」就再也改不了）

**不用原生弹窗**（`no-native-permission-dialogs`：权限与确认一律应用内自绘）。

### 5.6 capabilities

加进 `capabilities/desktop.json`（它已有 `platforms: ["macOS","windows","linux"]` 的壳，
tray/badge 在安卓无意义，不能放 `default.json`）：

```
core:tray:default            （含 new / set-icon / set-menu / set-tooltip / set-visible）
core:menu:allow-new
core:menu:allow-append
core:menu:allow-set-text
core:menu:allow-set-enabled
core:window:allow-set-badge-count
core:window:allow-set-overlay-icon
core:image:allow-from-path
```

`desktop.json` 当前 `"windows": ["main"]`，角标调用在 main 上，无需扩。

### 5.7 测试

- `tray.ts` 的「第一个未读会话」选取逻辑抽成纯函数单测（含全部已读、全部免打扰
  两种边界）
- `selectTotalUnread` selector 单测：免打扰会话不计入
- `handleClose` 单测：未选过 → 弹窗；选过「最小化」→ 不弹直接 hide
- Linux 真机：托盘出现 / 左键聚焦 / 菜单三项 / tooltip 未读数 / 关窗弹窗两条分支 /
  装 .deb 后验 `setBadgeCount`
- Windows 与 macOS：**不实测，文档登记**

---

## 6. W5 — O1 自建 OTA 更新服务

### 6.1 迁移 023 `app_releases`

| 列                                                          | 类型        | 说明                                                       |
| ----------------------------------------------------------- | ----------- | ---------------------------------------------------------- |
| `id`                                                        | uuid pk     |                                                            |
| `platform`                                                  | varchar(16) | `darwin` / `linux` / `windows` / `android`                 |
| `arch`                                                      | varchar(24) | `x86_64` / `aarch64` / `universal` / `armeabi-v7a` / `x86` |
| `version`                                                   | varchar(32) | semver                                                     |
| `channel`                                                   | varchar(16) | `stable` / `beta`                                          |
| `notes`                                                     | text        | 更新说明                                                   |
| `object_key`                                                | text        | MinIO 对象键（`releases/` 前缀）                           |
| `signature`                                                 | text        | minisign `.sig` 内容；Android 为空                         |
| `sha256`                                                    | varchar(64) | Android APK 校验用；桌面可空                               |
| `size`                                                      | bigint      | 字节数，下载页展示                                         |
| `min_version`                                               | varchar(32) | 低于此版本判为强制更新，可空                               |
| `mandatory`                                                 | boolean     | 强制更新标记                                               |
| `rollout`                                                   | smallint    | 0-100 灰度百分比                                           |
| `status`                                                    | varchar(16) | `draft` / `published` / `rolled_back`                      |
| `published_at` / `created_by` / `created_at` / `updated_at` |             |                                                            |

`UNIQUE (platform, arch, version, channel)`；
索引 `(platform, arch, channel, status)` 供对外查询。

### 6.2 对外端点（免鉴权 + `LimitByIP`）

**收敛成一种形状**（决策 T11）—— 原构想的 `/updates/android` 与 `/updates/downloads`
都是单段路径，在 Gin 里同层注册静态段与通配段会打架：

| 端点                                                            | 用途                                                |
| --------------------------------------------------------------- | --------------------------------------------------- |
| `GET /api/v1/updates/catalog`                                   | W6 下载页：各平台最新 published stable 聚合         |
| `GET /api/v1/updates/:platform/:arch?version=&channel=&device=` | 桌面 updater 与安卓共用（安卓传 `android/aarch64`） |

**响应用 Tauri 的「动态端点」扁平格式**，不构造 `platforms` map
—— 端点已从 URL 知道平台了：

```json
{
  "version": "0.7.0",
  "notes": "...",
  "pub_date": "...",
  "url": "<MinIO 预签名 GET>",
  "signature": "<minisign>"
}
```

安卓多带 `sha256` 与 `size`（APK 没有 minisign）。

- **无更新 / 未中灰度 → 204 No Content**（Tauri updater 的约定）
- **灰度**：显式 `device` 的 FNV-1a 哈希桶优先，其次 `X-YuanChat-Update-Cohort: 0..99`，
  最后 IP 哈希桶；以 `bucket < rollout` 放量。客户端只传稳定匿名桶，非法桶回落 IP；桶不作鉴权
- `min_version` 命中 → 响应里带强制更新标记
- 版本/最低版本按 SemVer 比较；非法登记返回 400。macOS 精确架构无已发布包时回落 universal

> plan 的 pre-flight 要对着 `~/.cargo` 里装好的 `tauri-plugin-updater` 源码核实
> 扁平格式的确切字段名与 204 语义，**不照记忆写**。

### 6.3 桌面端

`tauri.conf.json` 的 `plugins.updater.endpoints` 改成两个，按序回退：

```
["https://api.yuanyuan.blog/api/v1/updates/{{target}}/{{arch}}?version={{current_version}}",
 "https://github.com/liaojie1314/yuanchat/releases/latest/download/latest.json"]
```

自有端点在前、GitHub 兜底在后 —— 这正是 O1 立项时点名的「国内直连 GitHub
Releases 不稳，更新检查超时、用户永远停在旧版」。`UpdateChecker.tsx` 发送匿名 cohort 桶，
并消费命令面板传来的检查动作；204 停止回落，服务错误才尝试 GitHub。

### 6.4 管理端

| 端点                                | 说明                                                         |
| ----------------------------------- | ------------------------------------------------------------ |
| `GET /admin/releases`               | 列表，按 platform / channel / status 筛                      |
| `POST /admin/releases`              | 登记：产物上传到 MinIO `releases/` + 粘 `.sig` 文本 + 元信息 |
| `PATCH /admin/releases/:id`         | 改 `rollout` / `mandatory` / `notes`                         |
| `POST /admin/releases/:id/publish`  | `draft` → `published`                                        |
| `POST /admin/releases/:id/rollback` | `published` → `rolled_back`                                  |

全部写 `admin_action_logs`（沿用既有审计约定）。
前端 `apps/admin/src/pages/Releases.tsx` + `AdminLayout` 侧栏入口。
登记校验 SemVer，重复返回 409；编辑只改灰度/强制/说明，不改记录身份与对象。

> 🔴 **签名私钥不入库、不进管理端进程**（O1 立项硬要求）。`.sig` 仍由 release
> 流水线的 `TAURI_SIGNING_PRIVATE_KEY` 产出，管理端**只做登记**。

### 6.5 Android 自动更新

Tauri updater 不支持 Android，自建一条：

1. `GET /updates/android/:arch` 查有无新版
2. 有 → **应用内自绘**说明卡，讲清为什么需要「安装未知应用」权限
   （`no-native-permission-dialogs`：不弹原生对话框）
3. 下载 APK —— **复用 W2 的 `downloadStore`**，进度条同一套
4. `sha256` 校验**通过后**才调安装器（校验不过直接删文件并报错）
5. 走 §8.1 的 `install_apk` → `Intent.ACTION_VIEW` + FileProvider URI +
   `FLAG_GRANT_READ_URI_PERMISSION`
6. `AndroidManifest.xml` 加 `REQUEST_INSTALL_PACKAGES`

FileProvider 的 manifest 与 `file_paths.xml` 已由 pre-flight 核实并纳入版本控制；
安装 APK 前须校验 sha256。真实验收还须核对包内版本与签名，仅把 OTA 登记写成新版
不能证明应用升级成功。

### 6.6 测试

- handler 用例：有更新 200 / 无更新 204 / 未中灰度 204 / 同一 device 多次请求
  判定一致（灰度稳定性）/ `min_version` 命中带强制标记
- `rollout=0` 与 `rollout=100` 两个边界
- 管理端五个端点各自落审计日志
- 真机：安卓模拟器走完「检查 → 说明卡 → 下载进度 → sha256 → 安装器」

---

## 7. W6 — Web 端侧边下载入口

### 7.1 数据源（决策 T7）

`GET /api/v1/updates/catalog` → 各平台最新 `published` + `stable` 聚合：

```json
[
  {
    "platform": "windows",
    "arch": "x86_64",
    "version": "0.7.0",
    "size": 48234567,
    "url": "<预签名>"
  }
]
```

**不硬编码 GitHub Releases** —— 否则同一份版本信息两处维护，迟早漂。

### 7.2 `packages/ui/src/download/DownloadPanel.tsx`（新目录）

- 环境检测：`navigator.userAgentData?.platform` 优先，回落 UA 字符串
  （`userAgentData` 在旧 WebView 不存在，必须有回落）
- 按系统与架构推荐；「当前系统 / 其他平台」两组完整展示 Windows/macOS/Linux/Android，
  同系统其他架构归当前系统。56px 紧凑行，缺包保留不可用行，不折叠；298px 内部列表视口
  与同结构骨架稳定高度，内容超出后内部滚动
- 点击走浏览器原生下载（`<a href download>`），**不走 W2 的应用内下载**
  —— Web 端装包本来就该交给浏览器
- 空态：表里没有 published release 时显示「暂无可用安装包」+ GitHub Releases 兜底链接

### 7.3 入口

- 桌面侧栏：`MainLayout` 沉底区加一个 `Download` 图标（设置之下、主题切换之上），
  **仅 web 构建显示** —— `useIsDesktop()` 取反
- 手机 web：设置页加一条
- 桌面 app / 安卓 app 内**不显示**（用户已经装了，再给下载入口是噪音）

### 7.4 测试

- `DownloadPanel` 单测：UA 三种（Windows / macOS / Linux）各自高亮正确项、
  `userAgentData` 缺失时回落、空列表走空态
- MSW 覆盖 `catalog` 的正常/空/错误/加载四态（AGENTS 第 8 条）
- E2E：web 端侧栏点下载入口 → 面板出现 → 当前系统项高亮

---

## 8. 跨工作流共用件

### 8.1 `open_local_file` / `install_apk`（Rust，W2 与 W5 共用）

Android 的 W2「下载完打开文件」与 W5「调系统安装器装 APK」共用 Intent 实现，
只换 mime type；桌面的下载完成操作打开所在文件夹：

```rust
#[tauri::command]
fn open_local_file(app: AppHandle, path: String, mime: Option<String>) -> Result<(), String>
```

- 桌面：`shell` 打开已保存文件的父目录
- 安卓：`Intent.ACTION_VIEW` + FileProvider URI + `FLAG_GRANT_READ_URI_PERMISSION`
- 路径 canonicalize 后必须位于应用目录、默认下载目录或桌面原生选择器授权过的目录，
  防止 `..` / 符号链接绕过边界；前端不能直接传入任意授权根。目录偏好保存在 Tauri
  app config 下的 `download-directory.json`，恢复默认不清历史授权或文件

一份 FileProvider 配置，pre-flight 一次核实两处受益。

### 8.2 `fileSink` 注入点

`apps/desktop/src/main.tsx` 的 `bootstrap` 在 `__TAURI_INTERNALS__` 存在时先等待
`installFileSink` 导入并注入，再挂载 React，确保设置首屏与下载记录恢复看到原生能力。

### 8.3 i18n

六条工作流各自新增文案，**四语（zh-CN / en-US / ja-JP / ko-KR）同步**。
`node scripts/check-i18n.mjs` 是 CI 门禁，会挡下漏翻、写错 key 与死键。
插值占位符是 `%{var}`（Rails 风格），**不是** i18next 默认的 `{{var}}`。

本批要删的死键：`admin.users.searchPlaceholder` 不删但改文案（去掉「手机号」）。

---

## 9. 测试与验收门禁

### 9.1 本地 CI 全量（推远程 dev 前必须全绿）

```
node scripts/check-i18n.mjs
LANG=C.UTF-8 pnpm test            # 必须对齐 runner 的语言环境
LANG=C.UTF-8 pnpm test:coverage   # provider 与阈值见 DEVELOPMENT
npx tsc --noEmit                  # apps/web 与 apps/desktop 各自
pnpm --filter @yuanchat/web test:e2e
(cd server && go vet ./... && go test ./... -coverprofile=coverage.out -covermode=atomic && go test -race ./internal/ws/)
node scripts/check-coverage.mjs 40 server/coverage.out
```

`LANG=C.UTF-8` 不是可选的：Node 21 起 `navigator.language` 取自宿主 ICU 语言环境，
中文机器上报 `zh-CN`、runner 上报 `en-US`，依赖它的用例会「本地全绿、远程报错」。

### 9.2 真实后端实测（非 Mock）

Mock 下的「通过」是假阳性（`real-backend-not-mock-for-verification`）。
全部实测走真实后端 `:8085` / `:8086` + 真实 MinIO。

| 端     | 方式                                             | 覆盖                                                                                  |
| ------ | ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Web    | playwright-cli                                   | 搜索分组/筛选与手机路由、目录授权/持久化/取消/失权、下载进度固定占位、客户端入口      |
| 桌面   | Tauri 原生窗口与 WebView 检查                    | 托盘/关窗/角标（核对已有桌面入口）、主窗全局面板/独立会话搜索窗、主题同步与旧账号清理 |
| 安卓   | 模拟器/真机 + adb（**需要连 USB 时当次叫用户**） | 搜索路由与返回、下载落盘/打开、检查更新动作与 OTA 下载/校验/安装链路                  |
| 管理端 | playwright-cli                                   | Releases 页五个操作 + 审计日志留痕                                                    |

### 9.3 实测后收尾

每段实测结束**立即关停** dev 链路 / 模拟器 / 桌面 app（`test-env-cleanup`）；
打包验证通过后立即清产物（`clean-build-artifacts-after-packaging`）。

---

## 10. 本批主动留债（做完仍留在清单上）

| 级别 | 条目                                                                                                                                                     |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟡   | **正式发版验收边界**：本轮核心截图、修复及本地检查已完成，未合并/发版；完整 OTA 安装本轮未重跑，设备边界见下项                                           |
| ⚪   | **Windows / macOS 的托盘与角标未实测**：无设备（`project-charter`）。`setOverlayIcon` 的静态 PNG 路径与 `setBadgeCount` 在这两个平台上只有代码、没有实测 |
| ⚪   | **安卓「另存到」公共目录**（`ACTION_CREATE_DOCUMENT`）：按 T5 不做，下载只落应用私有目录                                                                 |
| ⚪   | **本地库离线搜索**：按立项结论只抽 `searchSource` 接口层、只落服务端实现                                                                                 |
| ⚪   | **命令面板不做中文拼音首字母匹配**：中文模糊匹配是独立课题                                                                                               |
| ⚪   | **`tauri-plugin-shell` 的 JS `open` 已被上游废弃**（沿用 MASTER_PLAN §2.12 的债）：换 `tauri-plugin-opener` 后 `open_external` 与 §8.1 的命令可一起整理  |

## 11. 已核实的事实清单（plan 阶段不要重新发散）

| 事实                                                                 | 依据                                                             |
| -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| tray feature 已开，tray/badge/overlay 的 JS API 与权限标识符全部存在 | `Cargo.toml:49`、`gen/schemas/desktop-schema.json`               |
| 跨域 fetch 预签名 URL 读 body 的 CORS 可用，`Content-Length` 可读    | `files.ts:627` 的 `resolveObjectUrl` 已在生产实测通过（L1 批次） |
| 桌面 CSP 的 `connect-src` 已含 MinIO 两个来源                        | `tauri.conf.json` 的 security.csp                                |
| `TitleBar` 已有 `onClose` prop                                       | `TitleBar.tsx:11`                                                |
| 独立窗口模板                                                         | `apps/desktop/src/hooks/useCallWindow.ts`                        |
| 进度条样式先例                                                       | `UpdateChecker.tsx:117-124`                                      |
| persist store 范式                                                   | `themeStore.ts`、`authStore.ts`                                  |
| `ConfirmDialog` 已有 role/aria-modal/Esc/焦点陷阱                    | `packages/ui/src/primitives/ConfirmDialog.tsx`（L1 批次补齐）    |
| 搜索只检索 `content->>'text'`，trgm 索引同样只建在它上面             | `message_repo.go:343`、迁移 `003`                                |
| 登录非 `@` 分支仅走元聊号，手机号分支与数据列已移除                  | `user_service.go`、迁移 021                                      |
| 生产库 4 个用户全部有邮箱、零手机号专属账号                          | 2026-10-11 实查并处置，见 §1.1                                   |
| `auth.accountPlaceholder` 已是「邮箱 / 元聊号」                      | `zh-CN.json:176`                                                 |
| 下一个可用迁移号是 **021**                                           | `migrations/` 最大为 `020_idempotent_send.sql`                   |
