# 设计文档：界面焕新 + 功能丰富（群聊/撤回/图片消息）

> 日期：2026-07-17
> 分支：`feature/ui-and-features`（单分支，三批次各一次完整提交，全部完成后合并 dev）
> 前置：聊天核心闭环、token 静默刷新、好友核心闭环均已合入 dev

## 背景与目标

当前问题：① 部分界面「素」——`/settings` 仍是聊天页占位、ContactDetail 只有头像+昵称+一个按钮、空状态无插画、消息区无日期分隔；② 功能单薄——只有文本消息，无群创建入口、无撤回、无图片。

本轮目标（用户确认的范围）：

| 批次            | 内容                                                                 | 性质                  |
| --------------- | -------------------------------------------------------------------- | --------------------- |
| 1. 视觉焕新     | 设置页 + 个人资料编辑、好友/会话资料页丰富、聊天细节打磨、Emoji 面板 | 前端为主 + 2 个小端点 |
| 2. 群聊与撤回   | 建群流程、群成员查看、消息撤回                                       | 后端小改 + 前端       |
| 3. 文件基础设施 | MinIO 启用、预签名上传、图片消息、头像上传                           | 基础设施              |

不做（YAGNI，留后续）：设备管理、快捷键、通知粒度设置、改密码、邀请成员进已有群、管理员撤回他人消息、语音/视频/普通文件消息、朋友圈。

## 批次 1：视觉焕新

### 1.1 设置页（`/settings` 从占位变真页面）

- 新建 `packages/ui/src/SettingsScreen.tsx` 三端响应式（对齐 `docs/design/SETTINGS_PAGE.md` 的已可支撑子集）：
  - desktop/tablet：双栏——导航列表 240px + 内容区
  - mobile：全屏分组列表 → 点击进子页（栈式）
- 分组与内容：
  - **个人资料**：头像 + 昵称 + 元聊号卡片 → 点击进编辑视图（见 1.2）
  - **账号与安全**：手机号 / 邮箱 / 元聊号只读展示（脱敏：手机号中间 4 位星号）
  - **外观**：亮/暗主题切换（把 MainLayout 现有主题逻辑收敛到这里，MainLayout 保留快捷按钮）、语言 zh-CN / en-US 切换（i18next `changeLanguage` + localStorage 持久化）
  - **关于**：版本号（读 package.json version，构建时注入）
  - **退出登录**：error 色按钮，二次确认
- `apps/web` 与 `apps/desktop` 的 `/settings` 路由换成 `SettingsPage`（`return <SettingsScreen />`）

### 1.2 个人资料编辑

- SettingsScreen 内嵌编辑视图（非独立路由）：昵称（≤50）、签名 bio（≤500，多行）、性别（0 保密 / 1 男 / 2 女）
- 保存走已有 `PUT /users/me`（`UpdateProfileRequest` 已支持 nickname/bio/gender/avatar_url），成功后同步 authStore.user
- 元聊号带复制按钮（`navigator.clipboard`，降级 `document.execCommand`——es2019/旧 WebView 兼容）
- 头像位置展示 + 相机角标，点击提示「批次 3 后可用」→ 批次 3 激活真上传

### 1.3 好友/会话资料页丰富（含 2 个小端点）

后端：

- `GET /api/v1/users/:id`——公开资料：`{id, nickname, avatar_url, short_id, bio, gender}`（不返回 phone/email）
- `GET /api/v1/conversations/:id/members`——群成员列表：`[{user_id, nickname, avatar_url, role}]`，非成员 403

前端：

- `ContactDetail.tsx`（现 59 行）：挂载时拉 `GET /users/:id` 补 bio/gender，加信息卡（签名 / 性别 / 元聊号+复制）
- `ChatDetail.tsx`：删除 `DEMO_MEMBERS`，改由 `GET /conversations/:id/members` 驱动头像墙；conversationStore 或局部 state 缓存成员列表

### 1.4 聊天界面细节

- **空状态插画**：未选会话 / 无消息 / 无好友 / 无申请，统一风格轻量 SVG 插画，放 `packages/design-system/src/icons/`（`?react` 导入，遵守 SVG 规范）
- **日期分隔线**：消息流中相邻消息跨天时插入「今天 / 昨天 / M月D日」胶囊分隔
- **连续消息合并**：同发送者 1 分钟内的连续消息省略头像与昵称（仅群聊显示昵称的场景生效），气泡间距收紧
- **骨架屏**：会话列表与消息历史首次加载显示骨架（遵守既有 CLS 规范：固定行高、shimmer 动画）

### 1.5 Emoji 面板

- 新建 `packages/ui/src/EmojiPicker.tsx`：自建组件（无第三方库）
  - 原生 emoji 字符静态分类表（笑脸/手势/动物/食物/活动/物品/符号，每类 30-60 个，常量文件）
  - 「最近使用」行：localStorage 持久化，最多 24 个
  - 点击插入 Composer 光标处（`selectionStart` 拼接，保持光标位置）
- Composer 加 Smile 图标按钮（lucide-react），弹出面板（点击外部关闭）；mobile 全宽底部弹出，desktop 锚定按钮上方
- es2019 注意：不用 `String.prototype.at` 等新 API

## 批次 2：群聊与撤回

### 2.1 建群

后端 `POST /api/v1/conversations`：

- 请求：`{name?: string(≤100), member_ids: uuid[]（1-100）}`
- 校验：member_ids 全部是发起者好友（防拉陌生人），否则 400
- 事务：建 type=2 会话（发起者 role=owner，其余 normal）→ 全员写 conversation_members → 插入系统消息「XX 创建了群聊」（message_type=6, seq=1, 更新 last_message）
- 群名缺省：前 3 位成员昵称逗号拼接（含发起者），超长截断
- 响应：完整会话 DTO（与 GET /conversations 单项同构）
- 推送：新 WS 帧 `conversation.created {conversation: <DTO>}` 给全部成员所有设备（发起者除当前连接外的设备也收）

前端：

- `CreateGroupModal.tsx`：好友多选（复用字母分组列表 + checkbox）、已选头像横排（可点删）、可选群名输入 → 创建成功关弹窗 + `setActive(新群id)` 留在 /chat
- 入口：ChatScreen 会话列表头部「+」下拉菜单（「发起群聊」/「添加好友」两项；添加好友复用 AddContactModal）
- chatSocket 处理 `conversation.created` → conversationStore 插入并置顶

### 2.2 群成员查看

- ChatDetail 头像墙「查看全部」→ 成员全列表（复用面板区域内切换视图，非新路由）：头像 + 昵称 + owner/admin 徽标（Crown/Shield 图标 + label）
- 数据即 1.3 的 members 端点，无新后端

### 2.3 消息撤回

后端 `POST /api/v1/messages/:id/recall`：

- 校验：消息存在且 sender 是本人（否则 403）、`now - created_at ≤ 2min`（超时 403，code 区分）、status=normal（已撤回幂等返回 ok）
- 更新：`status=2`（`MessageStatusRevoked` 枚举已有）+ content 置 `{}`；若该消息是会话 last_message，同步刷新预览
- 推送：新 WS 帧 `message.recalled {message_id, conversation_id, seq, operator_id, operator_nickname}` 给会话全员

前端：

- MessageBubble：自己的消息且 `now - createdAt < 2min` 时，hover 菜单/长按菜单加「撤回」项（倒计时不开 timer，点击时再校验，被 403 则 toast 提示超时）
- `messageStore.applyRecall(messageId)`：气泡原位变灰字占位「你撤回了一条消息 / XX 撤回了一条消息」（复用系统消息样式）
- 历史分页拉到 status=2 的消息 → 同样渲染占位
- 会话列表 last_message 预览同步变「[撤回了一条消息]」

## 批次 3：文件基础设施 + 图片消息

### 3.1 MinIO 启用

- `deploy/docker-compose.yml` 取消 minio 注释（:9000 API / :9001 Console）
- `go get github.com/minio/minio-go/v7`
- config.yaml 加 `minio:` 段：`endpoint / access_key / secret_key / bucket: yuanchat / use_ssl: false`（环境变量 MINIO\_\* 可覆盖）
- 启动时 ensure bucket：不存在则创建；对 `avatars/` 前缀设 public-read policy（头像免签名）

### 3.2 上传端点（预签名 URL 方案）

- `POST /api/v1/files/upload-url`：`{filename, content_type, size}` → 白名单（config.upload.allowed_types）+ ≤100MB 校验 → 返回 `{upload_url（15min 预签名 PUT）, object_key, expires_in}`
  - object_key 规则：`{类别}/{yyyy/mm}/{uuid}.{ext}`，类别 = images / avatars / files
- `GET /api/v1/files/download-url?key=…`：返回 24h 预签名 GET URL；前端按 key 缓存换取的 URL（内存 Map，过期重取）
- **选预签名而非 multipart 透传的原因**：大文件不占 Go 应用带宽/内存，客户端直传 MinIO
- **已知取舍**：预签名 GET URL 持有即可读，本轮不做按会话成员的读权限校验（记入 CHAT_API.md）

### 3.3 图片消息

发送链路：

1. Composer 图片按钮（Image 图标）选图 / 粘贴图片（paste 事件）
2. 前端 canvas 压缩：最长边 >2560 等比缩至 2560，输出 jpeg(q=0.85)（gif 不压缩直传）
3. `POST /files/upload-url` → `fetch PUT` 直传 MinIO（带进度即可选，本轮显示转圈）
4. WS `message.send` 复用既有帧：`content: {type:"image", key, width, height, size}`，message_type=2
5. 乐观 UI：本地 blob URL 先渲染缩略图（sending 状态半透明），ack 后落定；上传失败标 failed 可重试

展示：

- 气泡内按 width/height 预置盒子尺寸（最大 280×280 等比缩放，防 CLS），懒加载换取 download-url
- 点击 → 全屏 Lightbox（黑底、原图、点击/Esc 关闭）；新建 `ImageLightbox.tsx`
- 加载失败：占位 + 重试按钮
- 会话列表与 last_message 预览：「[图片]」（i18n key）
- 后端 History/Send 对 message_type=2 无需特殊处理（content 本就是 JSONB 透传）；但 `ws/handler.go` 的 message.send 校验目前**只放行 `type=="text"`**（handler.go:137），需扩展：`type=="image"` 时校验 key 非空、width/height/size 为正数

### 3.4 头像上传（补齐 1.2 占位）

- 设置页头像点击 → 选图 → canvas 裁中心正方形 ≤512px → 直传 `avatars/` 前缀 → 拼公开 URL（`http://<endpoint>/<bucket>/<key>`）→ `PUT /users/me {avatar_url}` → 同步 authStore
- 会话/好友列表处头像自动生效（已有 Avatar src 链路）

## 测试与验收（每批次门禁）

每批次完成即执行，全绿才 commit：

1. `go test ./...`（新 service 各配单测：建群好友校验/系统消息、recall 窗口/权限、upload-url 白名单）
2. `pnpm test`（新组件/store action 单测：EmojiPicker 插入、applyRecall、图片消息映射）
3. web + desktop `npx tsc --noEmit`
4. Playwright E2E 实测该批功能（双账号验证 WS 实时性：建群推送、撤回双端占位、图片双端收发）
5. 文档同步：CHAT_API.md（新端点 + 3 个新 WS 帧）、DEVELOPMENT.md（MinIO 启动步骤）、AGENTS.md（MVP 状态）
6. **环境清理**：kill dev server / go server、docker compose stop、关浏览器 tab

Git：单分支 `feature/ui-and-features`，3 次完整提交（每批次一次）→ 全部完成 merge --no-ff → dev → push → 删分支。

## WS 帧汇总（本轮新增 3 帧，均为服务端→客户端）

| type                                       | payload                                                              | 说明             |
| ------------------------------------------ | -------------------------------------------------------------------- | ---------------- |
| `conversation.created`                     | `{conversation: <会话DTO>}`                                          | 建群推给全员     |
| `message.recalled`                         | `{message_id, conversation_id, seq, operator_id, operator_nickname}` | 撤回推给会话全员 |
| （图片消息复用 `message.receive`，无新帧） |                                                                      |                  |

扩展模式沿用：后端 `ws/protocol.go` + service 推送、前端 `chatSocket ServerFrames` + `useChatBootstrap` handlers 两端同步。

## 风险与依赖

- MinIO 预签名 URL 的 endpoint 需浏览器可达：dev 环境 `localhost:9000` 没问题；移动端真机联调需换局域网 IP（记 DEVELOPMENT.md，本轮只验 web/desktop）
- 图片粘贴的 `ClipboardEvent.clipboardData.files` 在旧 WebView 的兼容性：Chrome 74 支持，无风险
- Emoji 原生字符在不同平台渲染差异：接受（不引入 twemoji 图片方案）
