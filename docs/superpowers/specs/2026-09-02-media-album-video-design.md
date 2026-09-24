# 设计文档：会话媒体相册 + 视频消息 + 语音倍速（批次 K7/K6/K8）

> 日期：2026-09-02
> 批次：**K7 主功能**（会话媒体相册），附带 **K6 视频消息（仅文件选择）**、**K8 语音倍速播放**、husky tsc 门禁
> 迁移号：**无**。本批不新增表、不改表 —— 媒体相册是纯读查询，视频消息复用既有 `messages.message_type=5`（MessageTypeVideo 已存在）与 jsonb content，不需要新迁移
> 单一真源：本 spec 依据 `docs/MASTER_PLAN.md` 未做清单（§5 阶段三 + §8 K 泳道表）

### 分支与基线

| 项       | 值                                                        |
| -------- | --------------------------------------------------------- |
| 基线     | **`dev`**（当前 HEAD `69f0558`）                          |
| 工作分支 | `feature/media-album-and-video`，自 dev 切出              |
| 收口     | 完成后 `--no-ff` 合回 `dev`（保留独立 commit，禁 squash） |

### 全局约束（沿用项目既定规范，不逐条重述）

- GitFlow：禁直提 dev/main；feature→dev 必须 `--no-ff`；commit 用 Conventional Commits、不带版本号前缀、完成完整工作再提交
- 三端复用：Web（`apps/web`）/ Desktop（`apps/desktop`）/ Mobile（Tauri Android），共享代码放 `packages/ui`、`packages/shared`
- i18n：所有用户可见文案走 `react-i18next`，四语（zh-CN/en-US/ja-JP/ko-KR）同步，`node scripts/check-i18n.mjs` 门禁
- 浏览器兼容：`build.target=es2019`，不用 `?.`/`??` 等 ES2020+ 语法及未在 Chrome 74+ WebView 验证过的 Web API
- 测试门禁：单元/集成/测试通过才算完成；推送远端 dev 前本地 CI 全绿
- MSW：前端 API 调用须有 Mock 覆盖正常/空/错误/加载四态
- 骨架屏：图片固定宽高 + 列表加载骨架，CLS 为 0
- 注释：导出组件/函数/Store JSDoc，Go 导出函数 godoc
- 设计语言：北欧简约，圆角 ≤ rounded-lg，参照 `docs/design/DESIGN_LANGUAGE.md`

---

## 一、背景与目标

当前聊天体验有三块缺口（均为未做清单登记项）：

1. **K7 会话媒体相册**：图片/文件/语音散落在超长消息流里，翻历史截图、找录音是高频痛点；移动端尤甚。
2. **K6 视频消息**：消息类型枚举（`MessageTypeVideo=5`）与前端 `MessageType` 联合类型早已就位（`packages/shared/src/types/index.ts`），但发送链路、content 结构、渲染气泡全部缺失，是「类型预埋、功能未做」的状态。
3. **K8 语音倍速播放**：`voicePlayer` 单例已收敛，只差速率切换。

目标：本批交付「会话内媒体聚合视图 + 视频消息端到端发送/播放 + 语音 1x/1.5x/2x」，并补上 `.husky/pre-commit` 的 tsc 门禁（B 类债：幽灵依赖/类型错误此前只在 CI 暴露）。

**规模判定**：新增 1 个查询端点 + 1 个前端视图 + 1 条发送链路（复用既有骨架），无迁移、无协议级破坏（`message.send` 的 `content` 是向后兼容的判别联合，新增 `video` 分支不影响既有帧）。规模 M（3-5 天）。

---

## 二、后端设计

### 2.1 媒体列表端点（新增）

```
GET /api/v1/conversations/:id/media?type=all|image|file|voice|video|sticker&before_seq=0&limit=30
```

- **归属**：`MessageHandler` 新增 `Media` 方法，路由注册在 `router.go` 的 chat 组（与 `History` 同组），签名与 History 相同的鉴权中间件链。
- **type 参数**：服务端白名单映射，非法值回 400；`all`（默认）→ `[2,3,4,5,8]`（image/file/voice/video/sticker），单类型 → 对应枚举。**不包含** text(1)/system(6)/e2ee(7)。
- **分页**：沿用 History 的 `before_seq` 游标语义（seq 降序，`seq < before_seq`；`before_seq=0` 表示最新页），`limit` 默认 30、上限 100，满页返回 `has_more=true`。
- **权限与可见性**（与 `ListBefore`/`GetHistory` 完全一致，不另立口径）：
  - 调用者必须是会话成员，否则 403 `not a conversation member`；
  - `m.status=1`（撤回消息不进相册）；
  - `m.seq > cm.cleared_before_seq`（本人清空记录后，水位以下内容相册同步失效 —— 与历史消息、对象 ACL 三重口径一致）；
  - `m.deleted_at IS NULL`（软删排除）。
- **响应**（归一化 `MediaItem`，字段按类型填充，未用字段 `omitempty`）：

```json
{
  "items": [
    {
      "message_id": "uuid",
      "seq": 42,
      "message_type": 2,
      "sender_nickname": "张伟",
      "created_at": "2026-09-02T10:00:00+08:00",
      "key": "images/2026/09/xxx.jpg", // 主对象键
      "thumb_key": "images/2026/09/yyy.jpg", // 仅 video：缩略图对象键
      "name": "voice.webm", // file/video：原始文件名
      "size": 1024, // 字节
      "duration": 4, // voice/video：秒
      "width": 640,
      "height": 480, // image/video：像素
      "sticker_id": "uuid" // 仅 sticker
    }
  ],
  "has_more": true
}
```

- **实现分层**：
  - `repository.MessageRepository.ListMedia(ctx, convID, types []int16, beforeSeq, minSeq, limit)`（`minSeq` = 调用方从 membership 取到的 `cleared_before_seq`），SQL 与 `ListBefore` 同构，仅把 `message_type IN (?)` 附加进 WHERE，投影复用 `COALESCE(NULLIF(cm.alias,''), u.nickname)` 分组署名逻辑；
  - `service.MessageService.GetMedia(ctx, userID, convID, typeFilter, beforeSeq, limit)`：成员校验（复用 `GetMember`）→ 归一化返回；`typeFilter` 映射在 service 层完成（handler 只透传字符串）；
  - 错误映射：非成员 `ErrNotMember` → 403；非法 type → handler 直接 400（不经 service）。
- **不做**：reaction 聚合（相册是内容视图不是消息列表）、按时间范围过滤（seq 游标足够）、服务端媒体类型识别枚举扩展。

### 2.2 视频消息发送链路（复用既有骨架）

**通道**：仍然走 `message.send` WS 帧（与 image/file/voice 同构，REST 无发送端点）。

**服务端**（`server/internal/ws/`）：

1. `protocol.go` `ContentPayload` 增加字段（全部 `omitempty`，不影响既有帧解析）：
   `ThumbKey string \`json:"thumb_key,omitempty"\``；`Width/Height/Name/Duration` 复用既有字段（image 已用 width/height，file 已用 name，voice 已用 duration —— 语义一致，不新增字段）。
2. `handler.go` `buildContent` 新增 `case "video"`：
   - 必填校验：`key`、`thumb_key`、`name`、`size>0`、`duration>0`、`width>0`、`height>0`；`name` 长度 ≤255（与 file 同）；
   - 时长上限 120s；大小上限交给上传白名单（`max_file_size` 100MB）；
   - 落库 `model.MessageTypeVideo` + 结构体 `model.MessageContentVideo{Key, ThumbKey, Name, Size, Duration, Width, Height}`，与既有 `MessageContentImage/File/Voice` 同构。
3. **`buildContent` 不做 key 前缀校验**（与 image/file/voice 现状一致）：上传白名单与 `objectKeyPattern` 已在 UploadURL 端点守住只生成合法键。

**上传白名单**（`server/config/config.yaml` + `internal/config/config.go` 无改动，仅 yaml）：

```yaml
allowed_types:
  - video/mp4
  - video/webm
  - video/quicktime
```

- `resolveCategory`：`video/*` 与 `image/*` 之外一样落 `files/` 前缀（现有默认分支已覆盖，补显式 case + 单测钉住「video 不会误入 images」）。
- `objectKeyPattern` **不变**：`(images|avatars|files|sticker-covers)/...` 已涵盖 `files/xxx.mp4`。

**缩略图**：

- 由**客户端**生成（`<video>` 元素 seek 0.5s → canvas → JPEG blob），走既有 `getUploadUrl(filename, "image/jpeg", size)` → 落 `images/` 前缀 → 内容为 `MessageContentVideo.ThumbKey`。服务端对缩略图的**唯一感知**是 `thumb_key` 字段透传，无新端点。
- 缩略图名字沿用 `getUploadUrl` 的 filename-only-extract：`xx.jpg`，UUID 文件名，键 `images/2026/09/<uuid>.jpg`。

**ACL 与 GC 适配（必做，否则产生两处真实缺陷）**：

1. `repository/object_acl_repo.go` `CanRead`：现有 SQL 只匹配 `m.content->>'key'=?`，**视频缩略图（thumb_key）将签不出下载 URL**。改为：

```sql
WHERE (m.content ->> 'key' = ? OR m.content ->> 'thumb_key' = ?)
  AND m.status = 1
  AND m.seq > cm.cleared_before_seq
```

同时更新方法注释（原注释描述「key 出现在某条未撤回消息的 content.key 里」需扩为 key/thumb_key）。2. `ReferencedKeys`（GC）：同上，图片/视频消息的 `thumb_key` 必须计入引用来源。当前实现遍历消息 content 提取 key 的地方要一并提取 `thumb_key`，否则缩略图会在 GC 宽限期后被误删（H1b「封面被 GC 误删」是同一缺陷族，属**必须防**项）。

### 2.3 上传/下载白名单核对

- `video/mp4|webm|quicktime` 加入 `allowed_types` 后，`UploadURL` 的 4001 校验、`objectKeyPattern` 键自洽校验、`PresignPut`/`PresignGet` 全程无需改逻辑。
- 桌面端 CSP 无需改：媒体 URL 走 `https:` 预签名直链（下载 URL 域即 MinIO 对外端点），`connect-src`/`media-src` 已覆盖既有 `files/` 类内容（与 file/voice 相同的取址方式）。

---

## 三、前端设计

### 3.1 共享契约（`packages/shared`）

1. `ws/chatSocket.ts` `ClientContent` 判别联合新增：

```ts
| { type: "video"; key: string; thumb_key: string; name: string;
    size: number; duration: number; width: number; height: number }
```

2. `api/chat.ts`：
   - `parseVideoContent`（解析 `MessageContentVideo` jsonb → `{key, thumbKey, name, size, duration, width, height}`，容错样式与 `parseImageContent` 一致）;
   - `mapMessage`：`kindMap[5] = "video"`，新增 `video` 字段挂到 `ChatMessage`；
   - 新增 `fetchConversationMedia(conversationId, type, beforeSeq, limit)` → `apiGet<MediaItemsResponse>`，返回归一化 `MediaItem[]`（与服务端响应字段一一对应，保持 snake_case 映射风格）。
3. `types/index.ts`：`MessageType` 已含 `"video"`，`ChatMessage["kind"]` 联合类型加 `"video"` 与 `video?: ChatVideo`。

### 3.2 媒体相册视图（`packages/ui`）

新组件 `ConversationMediaView.tsx`：

- **入口**：`ChatWindow` 头部（`ChatWindow.tsx`）新增相册图标按钮（三端共用 header，桌面/移动同一入口；不进 `ChatDetail`——那是资料侧栏，媒体是内容面）。点开渲染为浮层/内嵌面板（对齐 `ImageLightbox` 的遮罩层级，`--safe-area-top` 叠加上一次已沉淀的规则）。
- **结构**：
  - 顶部类型 Tab：`全部 / 图片 / 文件 / 语音 / 视频 / 贴纸`（i18n 四语）；
  - 主体滚动容器（`overflow-y-auto`）：图片/视频/贴纸 → 卡片网格（`grid grid-cols-3 gap-2`，`aspect-square` 固定宽高）；文件/语音 → 行式列表；
  - 无限滚动：滚近底部触发 `fetchConversationMedia(..., beforeSeq=当前最小seq)` 追加；
  - 加载态：六宫格骨架（固定宽高，CLS 0）；空态：居中提示 + 插画级占位（复用既有空态风格）；错误态：重试按钮。
- **交互**：
  - 图片：点开 → 复用 `ImageLightbox`；
  - 视频：卡片显示缩略图 + 时长角标 + 播放钮，点开 → 弹层 `<video controls preload="metadata">`（`getDownloadUrl` 预签名，不自动播放）；`poster` 用 `thumb_key` 的预签名 URL；
  - 文件：行式卡片复用 `fileIconOf` + 文件名 + 大小，点击 `getDownloadUrl` 下载；
  - 语音：行式播放器复用 `voicePlayer` 单例（与气泡同源，正在播放高亮），**内嵌倍速按钮**（K8，见 3.4）；
  - 贴纸：渲染 `StickerImage`（现有组件）。
- **状态管理**：新建轻量 `mediaAlbums` 状态（`useState` + 局部逻辑即可，不进全局 store —— 相册是临时浏览视图，跨会话无需共享状态；如遇多开需要再升 store）。**裁决：本批不引入全局 store，遵循 YAGNI。**

### 3.3 视频消息气泡与发送

- **Composer**：新增「视频」按钮 → 隐藏 `<input type=file accept="video/*">`（对齐现有图片按钮模式）：
  - 选择后校验：`duration ≤ 120s`（`<video>` 元数据）、`size ≤ 100MB`；超限 toast 提示；
  - 生成缩略图：`<video muted playsinline>` seek 0.5s → canvas `toBlob("image/jpeg", 0.75)`；
  - 发送顺序：先传视频（`video/<mime>`）拿 `key`，再传缩略图（`image/jpeg`）拿 `thumb_key`，然后 `chatSocket.send("message.send", {content:{type:"video",...}})`；
  - 乐观消息：发送前先在消息流插占位（`kind:"video"` 本地预览，与 sendImage 相同的 pending 模式），失败置 `failed`。
- **MessageBubble**：`kind==="video"` 渲染视频卡片气泡（缩略图 + 时长角标 + 播放按钮，点击弹层播放；自己/对方消息同构）。**不做**：视频内嵌播放、进度拖动、进度回传他人。
- `messageStore`：新增 `sendVideo(conversationId, file)` + `dispatchVideoSend`（对齐 `dispatchVoiceSend` 骨架）。
- 转发路径保持排除视频：`server/internal/handler/forward.go` 的 `contentPayloadFromMessage` 已明确对 `video` 返回 `ok=false`（跳过实时帧推送，刷新后经 REST 历史正确渲染）——这是既有语义，本批不扩展「转发视频即重建」能力。

### 3.4 K8 语音倍速

- `voicePlayer.ts`（`packages/ui`）：增加模块级 `rate` 状态（默认 1）+ `setVoiceRate(rate)` + 播放时应用到 `audio.playbackRate`；订阅函数扩展让 UI 感知当前 rate（`subscribeVoicePlayer` 的 payload 增加 rate 字段或新增订阅）。
- `MessageBubble` 语音行：播放中/可播状态下显示 `1x 1.5x 2x` 循环切换按钮；相册语音行共用同一逻辑（顶部放一次切换按钮，避免每行都占空间——**裁决：切换按钮放播放器行内，只有当前活动语音行显示**）。
- 结束播放（stopVoice/音频 ended）不重置 rate（用户偏好保留到会话结束）。

### 3.5 MSW Mock（`packages/shared/src/mocks/handlers.ts`）

- 新增 `GET /api/v1/conversations/:id/media` handler：按 `type` query 从 `demoData` 取样本消息过滤，支持正常/空（`type=video` 无数据）/分页（`before_seq` 生效）/错误（`?error=1` 返回 500）四态；
- demoData 增加视频样本消息（含 thumb_key）。

---

## 四、husky tsc 门禁（B 类债收口）

- `.husky/pre-commit` 从 `pnpm lint-staged` 改为：

```sh
pnpm lint-staged
# 前端类型检查：staged 含 ts/tsx 时全量 typecheck（turbo 缓存命中后近零耗时）
if git diff --cached --name-only | grep -qE '\.(ts|tsx)$'; then
  pnpm --filter @yuanchat/web typecheck && pnpm --filter @yuanchat/desktop typecheck
fi
```

- **不加** Go vet/go test 到 pre-commit（CI 已覆盖，提交时跑全量 go 测试会显著拖慢；tsc 是「幽灵依赖/类型错误本地不可见」这一具体债务的解药）。
- 两个 app 的 `typecheck` 脚本已存在（`tsc --noEmit`），不需要新脚本。
- **验收**：故意引入一个类型错误 → `git commit` 被挡；修复后通过。

---

## 五、测试计划

### 5.1 后端（Go）

| 层                        | 用例                                               | 断言                                                                   |
| ------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| `message_repo_test.go`    | `ListMedia` 分页/类型集合/水位/撤回排除            | seq 降序、`IN` 过滤、`cleared_before_seq` 生效、status=1               |
| `message_service_test.go` | `GetMedia` 权限/type 映射/非法 type                | 非成员 403、`all` 映射五类型、非法 400                                 |
| `ws/handler_test.go`      | `buildContent` video 校验                          | 缺 thumb_key 400、时长>120 400、合法通过、content JSON 结构正确        |
| `object_acl_repo_test.go` | `CanRead` thumb_key                                | 视频缩略图可签、撤回后不可签、清空水位后不可签                         |
| `gc` 相关测试             | `ReferencedKeys` 含 thumb_key                      | 缩略图不被 GC 判定为无引用                                             |
| `handler_test.go`         | `Media` handler                                    | 参数校验/错误码/成功响应形状                                           |
| golden                    | `contracts/message-send.golden.json` 增 video 样本 | Go `golden_contract_test.go` + TS `messageSendGolden.test.ts` 双端同过 |

### 5.2 前端（Vitest）

- `ConversationMediaView.test.tsx`：Tab 切换、空态、错误态、加载态（MSW 四态）、图片点开、视频卡片信息展示；
- `messageStore` video 发送：校验（超时/超大→不发送+toast）、缩略图生成（mock video/canvas）、失败置 failed；
- `voicePlayer` rate：setRate 生效、播放器 playbackRate 跟随；
- `MessageBubble` video 渲染 + `mapMessage` video 解析（固定 fixture）。

### 5.3 E2E（Playwright 真后端 dev）

- 相册：打开相册 → Tab「图片」过滤 → 点开图片 → Lightbox 关闭回到相册 → 滚动加载第二页；
- 视频：选文件发送 → 气泡出现 → 相册「视频」Tab 可见该消息 → 点开播放（video 元素存在且可播放）。

### 5.4 真机（递送前必过）

- **Web/Desktop**：`playwright-cli` 走查（正常路径发视频、相册、倍速、暗色主题）；桌面 Tauri 实启验证 CSP 无拦截日志（新增媒体 URL 未越 CSP 白名单）。
- **Android**：模拟器 + adb 实测 —— 相册打开/滚动/返回键（注册 back interceptor，防「回聊天页」兜底误退）、视频消息发/收/播、语音倍速；安装 APK 后 `build.target=es2019` 产物抽查（无 `?.`/`??`）。
- **iOS**：无开发者账户，本批不测（既有边界，不扩）。

---

## 六、关键裁决（本批已定，不再重开）

| 编号 | 裁决                                                                                                   | 理由                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| M1   | 视频采集**仅文件选择**，不做 MediaRecorder 录制                                                        | Android WebView 的 MediaRecorder 编码兼容不可控（Chrome 74 起 MP4 H.264 支持不齐）；文件选择三端行为一致、无转码依赖 |
| M2   | 视频上限 120s / 100MB                                                                                  | 时长闸在 buildContent（防超长），大小闸复用 `max_file_size`（100MB 现状值）；不等同微信的「1G 大文件」定位，YAGNI    |
| M3   | 相册 `all` = image/file/voice/video/sticker，**不含** text/system/e2ee；贴纸入相册（用户已确认全类型） | 贴纸是表情表达但也是用户「收藏/发送过的图」，入相册成本低；e2ee 服务端不可读、天然排除                               |
| M4   | 缩略图服务端不生成：客户端 canvas 生成 JPEG、走 images/ 前缀                                           | 免新增缩略图处理端点/依赖（ffmpeg 等）；与头像类「客户端压缩」既有范式一致                                           |
| M5   | 相册状态本地 useState，不进全局 store                                                                  | 临时浏览视图，无跨会话共享需求；YAGNI                                                                                |
| M6   | pre-commit 只补前端 tsc，不跑 Go                                                                       | Go 已由 CI gate；预提交全量 go test 拖慢开发循环，收益低                                                             |
| M7   | 转发视频消息不重建（沿用 `forward.go` 的 `contentPayloadFromMessage` 对 video 返回 false 的既有语义）  | 转发「重建实时帧」与「发送新视频」是两件事；重建需把历史 content 反序列化成 ContentPayload，视频通路超出本批范围     |

---

## 七、明确不做（记债，不进本批）

> 全部登记 `docs/MASTER_PLAN.md` 未做清单，本批结束后由收口动作写入状态。

- 视频消息**录制**（MediaRecorder）—— M1 裁决延后；
- 视频**转码/多码率**（服务端 ffmpeg 处理）——等真实存在「大视频发不动」再上；
- 相册 **搜索/排序**（时间/文件大小过滤）——现有游客式「按时间翻」已满足主诉求；
- 语音/视频**通话**（WebRTC）——依然在阶段三未做清单；
- iOS 端实测——无开发者账户；
- **K17 新设备登录通知**：用户本轮已明确「先不做」；继续留在未做清单；
- 发布上限/贴纸商城相关（H1b 债表）不动。

---

## 八、交付后同步

1. `docs/MASTER_PLAN.md` 未做清单：
   - 阶段三勾选「会话媒体相册」「视频消息」「语音消息倍速播放」；
   - K 泳道表 K6/K7/K8 状态改 ✅（保留原条目，标完成日期）；
   - 债务表「husky 不跑 tsc」改 ✅；
   - **新发现的债当次登记**（如「相册无时间过滤」「视频无转码」等）。
2. `docs/CHAT_API.md` 补 `media` 端点与 video content 结构说明。
3. `docs/DEVELOPMENT.md` 无启动命令变更则不更新；如 Composer 有新的依赖（无）则无需。
