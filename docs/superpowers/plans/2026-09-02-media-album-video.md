# 会话媒体相册 + 视频消息 + 语音倍速 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 K7 会话媒体相册（聚合图片/文件/语音/视频/贴纸）、K6 视频消息（文件选择发送 + 气泡 + 播放）、K8 语音倍速播放，并补上 husky pre-commit 的 tsc 门禁。

**Architecture:** 后端新增 1 个只读媒体分页端点（复用 History 的 seq 游标与成员/水位语义，无迁移）；视频消息复用既有 WS `message.send` 骨架与 `MessageTypeVideo=5`，仅新增 content 结构与上传白名单；前端新增相册视图（共享组件，三端复用）、视频发送路径（对齐图片/语音既有骨架）与语音速率状态。视频缩略图客户端 canvas 生成（JPEG → `images/` 前缀）。

**Tech Stack:** Go (Gin + GORM + gorilla/websocket) · React 19 + TypeScript + Vite · Tailwind · Zustand · react-i18next · MSW · Playwright · husky

**Spec:** [docs/superpowers/specs/2026-09-02-media-album-video-design.md](../specs/2026-09-02-media-album-video-design.md) — 裁决 M1-M7、接口与口径均以 spec 为准。

## Global Constraints

- GitFlow：禁直提 dev/main；feature→dev 必须 `--no-ff`；完成完整功能再提交，禁止逐点提交；commit 格式 `<type>(<scope>): <subject>`，不带版本号前缀
- `build.target=es2019`：禁止 `?.`/`??` 等 ES2020+ 语法与未被 Chrome 74+ WebView 支持的 Web API
- i18n：所有用户可见文案走 `react-i18next`，四语（`packages/design-system/src/i18n/locales/{zh-CN,en-US,ja-JP,ko-KR}.json`）同步，`pnpm check:i18n` 门禁；占位符是 `%{var}` 不是 `{{var}}`
- MSW：新增前端 API 调用必须有 normal/empty/error/loading 四态 Mock
- 骨架屏：图片固定宽高（`aspect-square`），列表加载骨架屏，CLS=0
- Go 导出函数 godoc；前端导出组件/函数 JSDoc；注释一律中文
- 关键测试命令：`LANG=C.UTF-8 pnpm test`（对齐 CI locale）、`go test ./...`、`go vet ./...`、`go test -race ./internal/ws/`、`pnpm --filter @yuanchat/web test:e2e`
- 推送远端 dev 前必须本地 CI 全绿；发版前必须本地打包通过（`pnpm build:pkg`）
- 新增视频发送必须同时更新 `contracts/message-send.golden.json`（前后端 golden 测试共用同一份）
- 本批**无数据库迁移**（不新表、不改表）

## 文件结构

**后端（server/）**

- `internal/repository/message_repo.go` — 新增 `ListMedia`（媒体分页查询）；`MediaItem` 扫描结构
- `internal/service/message_service.go` — 新增 `GetMedia`（成员校验 + type 映射 + 归一化）
- `internal/handler/message.go` — 新增 `Media` 端点（query 校验 + 错误映射）
- `internal/router/router.go` — 注册 `GET /conversations/:id/media`
- `internal/model/message.go` — 新增 `MessageContentVideo`
- `internal/ws/protocol.go` — `ContentPayload` 增加 `ThumbKey` 字段
- `internal/ws/handler.go` — `buildContent` 新增 `case "video"`
- `internal/repository/object_acl_repo.go` — `CanRead` / `ReferencedKeys` 覆盖 `thumb_key`
- `config/config.yaml` — `allowed_types` 增加 video MIME
- 测试：`message_repo_test.go` / `message_service_test.go` / `handler/message_test.go`（新增 media 用例）/ `ws/handler_test.go` / `ws/golden_contract_test.go` / `object_acl_repo_test.go`

**前端（packages/）**

- `packages/shared/src/ws/chatSocket.ts` — `ClientContent` 新增 video 判别成员
- `packages/shared/src/api/chat.ts` — `parseVideoContent`、`mapMessage` kind 5、`fetchConversationMedia`、`MediaItem` 类型
- `packages/shared/src/store/messageStore.ts` — `ChatMessageKind` 加 `"video"`、`ChatVideo` 载荷、`sendVideo` / `dispatchVideoSend`
- `packages/shared/src/mocks/handlers.ts` + `demoData.ts` — media 端点四态 Mock + 视频消息样本
- `packages/ui/src/ConversationMediaView.tsx` — 相册视图（新建）
- `packages/ui/src/MessageBubble.tsx` — video 气泡渲染、语音行倍速按钮
- `packages/ui/src/Composer.tsx` — 视频按钮 + file input（`accept="video/*"`）
- `packages/ui/src/voicePlayer.ts` — rate 状态 + `setVoiceRate`
- `packages/design-system/src/i18n/locales/*.json` — 四语新 key
- `contracts/message-send.golden.json` — video 样本
- `apps/web/e2e/` — 相册/视频 E2E spec
- 测试：`packages/shared/src/__tests__/messageSendGolden.test.ts`（video case 已由 golden 驱动）、`packages/ui/src/__tests__/ConversationMediaView.test.tsx`、`MessageBubble.test.tsx`、`voicePlayer` 相关

**工具链**

- `.husky/pre-commit` — staged 含 ts/tsx 时跑两 app typecheck

**阶段划分（本 plan 的执行顺序即交付顺序）**

- **Stage A — 契约层（wire contract，基础搭建）**：Task 1。含 TS 判别联合、Go ContentPayload、golden JSON、golden 双端测试。**本批「基础搭建」的交付边界即 Stage A。**
- **Stage B — 后端媒体端点 + 视频发送链路**：Task 2-4
- **Stage C — 前端相册视图 + 视频发送**：Task 5-7
- **Stage D — 语音倍速**：Task 8
- **Stage E — husky tsc + 全量验证与收尾**：Task 9-10

---

## Task 1: 契约层 —— video 帧与控制面类型贯通（Stage A）

**Files:**

- Modify: `contracts/message-send.golden.json`
- Modify: `server/internal/ws/protocol.go`
- Modify: `server/internal/model/message.go`（`MessageContentVideo`）
- Modify: `packages/shared/src/ws/chatSocket.ts`
- Test: `server/internal/ws/golden_contract_test.go`（无改动，随 golden JSON 生效）、`packages/shared/src/__tests__/messageSendGolden.test.ts`（无改动，随 golden JSON 生效）

**Interfaces:**

- Consumes: 无（本批第一批）
- Produces（后续任务依赖）:
  - `ws.ContentPayload.ThumbKey string \`json:"thumb_key,omitempty"\``
  - `model.MessageContentVideo{Key, ThumbKey, Name string; Size int64; Duration, Width, Height int}`
  - TS `ClientContent` 新增成员 `{ type: "video"; key: string; thumb_key: string; name: string; size: number; duration: number; width: number; height: number }`
  - golden 新增 case `"video"`（`expected_message_type: 5`）

- [ ] **Step 1: 扩展 golden JSON —— 新增 video 用例**

在 `contracts/message-send.golden.json` 的 `cases` 数组（`sticker` 用例之后）新增：

```json
{
  "name": "video",
  "expected_message_type": 5,
  "frame": {
    "type": "message.send",
    "payload": {
      "conversation_id": "11111111-1111-4111-8111-111111111111",
      "content": {
        "type": "video",
        "key": "files/2026/08/0f5a1c00-0005.mp4",
        "thumb_key": "images/2026/08/0f5a1c00-0006.jpg",
        "name": "demo.mp4",
        "size": 2048000,
        "duration": 15,
        "width": 1280,
        "height": 720
      },
      "client_msg_id": "<client_msg_id>"
    }
  }
}
```

- [ ] **Step 2: Go —— ContentPayload 加 thumb_key 字段**

`server/internal/ws/protocol.go` 的 `ContentPayload` 结构体（`StickerID` 字段之后、e2ee 注释块之前）加：

```go
ThumbKey string `json:"thumb_key,omitempty"` // video: 缩略图对象键
```

并更新 `ContentPayload` 的 doc comment（`text / image / file / voice` → `text / image / file / voice / video`）。

- [ ] **Step 3: Go —— MessageContentVideo 结构体**

`server/internal/model/message.go`（`MessageContentVoice` 附近）加：

```go
// MessageContentVideo 视频消息内容 JSON 结构
// ThumbKey 指向客户端生成的 JPEG 缩略图（images/ 前缀，随消息引用共存亡）。
type MessageContentVideo struct {
	Key      string `json:"key"`
	ThumbKey string `json:"thumb_key"`
	Name     string `json:"name"`
	Size     int64  `json:"size"`
	Duration int    `json:"duration"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
}
```

- [ ] **Step 4: TS —— ClientContent 加 video 判别成员**

`packages/shared/src/ws/chatSocket.ts` 的 `ClientContent` 联合（`voice` 成员之后）加：

```ts
| { type: "video"; key: string; thumb_key: string; name: string; size: number; duration: number; width: number; height: number }
```

并更新 `ServerFrames["message.receive"].content` 注释（`voice 帧带 key/duration/size` 一行后补 `video 帧带 key/thumb_key/name/duration/width/height/size`）。

- [ ] **Step 5: 跑双端 golden 测试 —— 预期双双失败**

Run: `cd server && go test ./internal/ws/ -run Golden`
Expected: FAIL（golden JSON 反序列化后 `buildContent` 对 video 落 default → `unsupported content type`）

Run: `LANG=C.UTF-8 pnpm --filter @yuanchat/shared test -- --run messageSendGolden`
Expected: FAIL（payload 深比较不匹配 / store 无 video 发送路径，语法错误则先见类型错）

- [ ] **Step 6: 提交**

```bash
git add contracts/message-send.golden.json server/internal/ws/protocol.go server/internal/model/message.go packages/shared/src/ws/chatSocket.ts
git commit -m "feat(contracts): message.send 帧新增 video 类型（golden 双端契约）"
```

> 说明：Step 5 的双失败是**预期状态**（TDD 红灯）。`buildContent` 的 video case 在 Task 2 实现后才转绿；golden 测试红灯不能阻塞提交——本任务交付的是契约本身的变更，Task 2 完成时统一转绿。若 reviewer 不接受红灯提交，可将本任务与 Task 2 合并为一个 commit 再提交。

## Task 2: 后端 —— buildContent video case + 上传白名单（Stage B）

**Files:**

- Modify: `server/internal/ws/handler.go`（buildContent）
- Modify: `server/config/config.yaml`
- Modify: `server/internal/handler/file.go`（resolveCategory 显式 video 分支）
- Test: `server/internal/ws/handler_test.go`、`server/internal/handler/file_test.go`

**Interfaces:**

- Consumes: `model.MessageContentVideo`（Task 1）、`ContentPayload.ThumbKey`（Task 1）
- Produces: `buildContent` 对 `type=video` 返回 `(model.MessageTypeVideo, contentJSON, true)`；上传白名单含 3 个 video MIME

- [ ] **Step 1: 写 buildContent video 用例（先红）**

`server/internal/ws/handler_test.go` 的 `TestBuildContentUnsupported`（现有 `Type:"video"` 应被移除/改写）之后加：

```go
func TestBuildContentVideoValid(t *testing.T) {
	c := newTestClient(uuid.Nil)
	p := &SendPayload{Content: ContentPayload{
		Type: "video", Key: "files/2026/09/v.mp4", ThumbKey: "images/2026/09/t.jpg",
		Name: "v.mp4", Size: 1024, Duration: 12, Width: 1280, Height: 720,
	}, ClientMsgID: "c-video-1"}

	mt, contentJSON, ok := new(Handler).buildContent(c, p)
	if !ok {
		t.Fatal("valid video should pass")
	}
	if mt != model.MessageTypeVideo {
		t.Fatalf("expected MessageTypeVideo, got %d", mt)
	}
	var stored model.MessageContentVideo
	if err := json.Unmarshal([]byte(contentJSON), &stored); err != nil {
		t.Fatalf("content is not MessageContentVideo json: %v", err)
	}
	if stored.ThumbKey != "images/2026/09/t.jpg" || stored.Duration != 12 {
		t.Fatalf("thumbnail/duration not preserved: %+v", stored)
	}
	assertNoFrame(t, c)
}

func TestBuildContentVideoInvalid(t *testing.T) {
	cases := map[string]ContentPayload{
		"missing thumb": {Type: "video", Key: "files/k.mp4", Name: "k.mp4", Size: 1, Duration: 3, Width: 1, Height: 1},
		"zero duration": {Type: "video", Key: "files/k.mp4", ThumbKey: "images/t.jpg", Name: "k.mp4", Size: 1, Width: 1, Height: 1},
		"over 120s":     {Type: "video", Key: "files/k.mp4", ThumbKey: "images/t.jpg", Name: "k.mp4", Size: 1, Duration: 121, Width: 1, Height: 1},
		"empty name":    {Type: "video", Key: "files/k.mp4", ThumbKey: "images/t.jpg", Size: 1, Duration: 3, Width: 1, Height: 1},
	}
	for name, content := range cases {
		c := newTestClient(uuid.Nil)
		p := &SendPayload{Content: content, ClientMsgID: "c-video-bad"}
		if _, _, ok := new(Handler).buildContent(c, p); ok {
			t.Fatalf("%s: expected rejection", name)
		}
		decodeErr(t, c)
	}
}
```

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `cd server && go test ./internal/ws/ -run 'TestBuildContentVideo'`
Expected: FAIL（`unsupported content type`）

- [ ] **Step 3: 实现 buildContent video case**

`server/internal/ws/handler.go` `buildContent` 的 `case "voice"` 之后加：

```go
case "video":
	// 视频消息：与 image/file/voice 同构，key 为主视频对象键，thumb_key 为客户端
	// 生成的 JPEG 缩略图键。时长上限 120s（spec M2），大小上限由上传白名单
	// （max_file_size=100MB）在上传阶段拦截，此处不再重复。
	if p.Content.Key == "" || p.Content.ThumbKey == "" || p.Content.Name == "" ||
		p.Content.Size <= 0 || p.Content.Duration <= 0 || p.Content.Duration > 120 ||
		p.Content.Width <= 0 || p.Content.Height <= 0 {
		c.sendError(400, "video content requires key/thumb_key/name/size(1-120s)/width/height", p.ClientMsgID)
		return 0, "", false
	}
	if len([]rune(p.Content.Name)) > 255 {
		c.sendError(400, "video name too long", p.ClientMsgID)
		return 0, "", false
	}
	raw, err := json.Marshal(model.MessageContentVideo{
		Key: p.Content.Key, ThumbKey: p.Content.ThumbKey, Name: p.Content.Name,
		Size: p.Content.Size, Duration: p.Content.Duration,
		Width: p.Content.Width, Height: p.Content.Height,
	})
	if err != nil {
		c.sendError(400, "invalid video content", p.ClientMsgID)
		return 0, "", false
	}
	return model.MessageTypeVideo, string(raw), true
```

同时删除/改写 `TestBuildContentUnsupported` 中 `ContentPayload{Type: "video"}` 的旧断言（该用例原先把 video 当 unsupported 样本）。

- [ ] **Step 4: 跑测试转绿**

Run: `cd server && go test ./internal/ws/ -run 'TestBuildContentVideo|TestBuildContentUnsupported' && go test ./internal/ws/`
Expected: PASS（含 golden 测试——Task 1 的 video 样本现在被正确接受）

- [ ] **Step 5: 上传白名单 + resolveCategory**

`server/config/config.yaml` `allowed_types` 追加（缩进 4 空格，与既有条目一致）：

```yaml
- video/mp4
- video/webm
- video/quicktime
```

`server/internal/handler/file.go` `resolveCategory` 加显式分支（默认分支已覆盖，显式化 + 注释说明意图，防未来重构把 video 意外并入 images）：

```go
// video/* 归属 files：视频不进 images 前缀（免与图片缩略图混淆），
// 下载侧同样走私有 + 预签名（与 file/voice 同口径）。
if strings.HasPrefix(contentType, "video/") {
	return "files"
}
```

`file_test.go` 补一条：`resolveCategory("video/mp4", "") == "files"`。

- [ ] **Step 6: 跑全绿**

Run: `cd server && go vet ./... && go test ./...`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add server/internal/ws/handler.go server/internal/ws/handler_test.go server/config/config.yaml server/internal/handler/file.go server/internal/handler/file_test.go
git commit -m "feat(ws): message.send 支持 video 类型并开放视频上传白名单"
```

## Task 3: 后端 —— 媒体分页端点 GET /conversations/:id/media（Stage B）

**Files:**

- Modify: `server/internal/repository/message_repo.go`
- Modify: `server/internal/service/message_service.go`
- Modify: `server/internal/handler/message.go`
- Modify: `server/internal/router/router.go`
- Test: `server/internal/repository/message_repo_test.go`、`server/internal/service/message_service_test.go`、`server/internal/handler/message_test.go`

**Interfaces:**

- Consumes: `repository.MessageWithSender`（既有）、`GetMember`（既有）、`ErrNotMember`（既有）
- Produces:
  - `repo.(*MessageRepository) ListMedia(ctx, convID uuid.UUID, types []int16, beforeSeq, minSeq int64, limit int) ([]MediaItemWithSender, error)`
  - `repo.MediaItemWithSender{ model.Message; SenderNickname string }`
  - `svc.(*MessageService) GetMedia(ctx, userID, convID uuid.UUID, filter string, beforeSeq int64, limit int) ([]MediaItemView, error)`
  - `svc.MediaItemView{ MessageID, Seq, MessageType, SenderNickname, CreatedAt, Key, ThumbKey, Name, Size, Duration, Width, Height, StickerID }`
  - HTTP `GET /api/v1/conversations/:id/media?type=&before_seq=&limit=` → `{items, has_more}`；非法 type → 400；非成员 → 403

- [ ] **Step 1: 写 repo 层测试（先红）**

`server/internal/repository/message_repo_test.go` 加（沿用既有测试的 fixture 构造方式）：

```go
func TestListMediaFiltersByType(t *testing.T) {
	// fixture：一个会话 5 条消息 text(1)/image(2)/voice(4)/video(5)/sticker(8)，
	// 其中 voice 一条 status=2（撤回），sticker 一条 seq 低于会员 cleared_before_seq。
	// 断言：types=[2,4,5,8] 时只返回 image/video/sticker（撤回与水位以下被排除），seq 降序。
}

func TestListMediaEmptyForNoMatch(t *testing.T) {
	// types=[2] 但会话内无 image → len==0（不 panic）
}
```

- [ ] **Step 2: 跑测试 FAIL**

Run: `cd server && go test ./internal/repository/ -run TestListMedia`
Expected: FAIL（`ListMedia` undefined）

- [ ] **Step 3: 实现 ListMedia**

`server/internal/repository/message_repo.go`（`ListBefore` 之后）加：

```go
// MediaItemWithSender 媒体相册条目：完整消息 + 发送者昵称（群聊取群昵称，与 ListBefore 同口径）。
type MediaItemWithSender struct {
	model.Message
	SenderNickname string `gorm:"column:sender_nickname"`
}

// ListMedia 拉取会话内指定类型的媒体消息（seq 降序，游标 beforeSeq）。
// types 为空表示"无媒体"（返回空）；minSeq 为调用方 cleared_before_seq 水位（0 不过滤）。
// 与 ListBefore 共用成员署名投影（COALESCE 群昵称），且只回 status=1 的未撤回消息。
func (r *MessageRepository) ListMedia(ctx context.Context, convID uuid.UUID, types []int16, beforeSeq, minSeq int64, limit int) ([]MediaItemWithSender, error) {
	if len(types) == 0 {
		return nil, nil
	}
	q := r.db.WithContext(ctx).
		Table("messages m").
		Select(`m.*, COALESCE(NULLIF(cm.alias, ''), u.nickname) AS sender_nickname`).
		Joins("JOIN users u ON u.id = m.sender_id").
		Joins("LEFT JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = m.sender_id").
		Where("m.conversation_id = ? AND m.deleted_at IS NULL AND m.status = ? AND m.message_type IN ?",
			convID, model.MessageStatusNormal, types)
	if beforeSeq > 0 {
		q = q.Where("m.seq < ?", beforeSeq)
	}
	if minSeq > 0 {
		q = q.Where("m.seq > ?", minSeq)
	}
	var rows []MediaItemWithSender
	err := q.Order("m.seq DESC").Limit(limit).Scan(&rows).Error
	return rows, err
}
```

- [ ] **Step 4: repo 测试转绿**

Run: `cd server && go test ./internal/repository/ -run TestListMedia`
Expected: PASS

- [ ] **Step 5: 写 service 测试（先红）**

`server/internal/service/message_service_test.go` 加（成员校验 + 映射逻辑，用既有 service 测试的 fake repo 模式）：

```go
func TestGetMediaTypeMapping(t *testing.T) {
	// GetMedia(ctx, user, conv, "all", 0, 30) → repo 收到 types=[2,3,4,5,8]
	// GetMedia(ctx, user, conv, "video", 0, 30) → types=[5]
	// GetMedia(ctx, user, conv, "nonsense", 0, 30) → error（ErrInvalidMediaType）
	// 非成员 → ErrNotMember（复用 GetHistory 的 fake 返回）
}
```

- [ ] **Step 6: 实现 GetMedia + 错误类型**

`server/internal/service/message_service.go` 加（`GetHistory` 之后）：

```go
// ErrInvalidMediaType 相册 type 参数不在白名单内。
var ErrInvalidMediaType = errors.New("invalid media type")

// mediaTypeGroups 相册 type 参数 → 消息类型集合（不含 text/system/e2ee）。
var mediaTypeGroups = map[string][]int16{
	"all":   {model.MessageTypeImage, model.MessageTypeFile, model.MessageTypeVoice, model.MessageTypeVideo, model.MessageTypeSticker},
	"image": {model.MessageTypeImage},
	"file":  {model.MessageTypeFile},
	"voice": {model.MessageTypeVoice},
	"video": {model.MessageTypeVideo},
	"sticker": {model.MessageTypeSticker},
}

// MediaItemView 相册条目（handler 序列化形状，omitempty 字段按类型填充）。
type MediaItemView struct {
	MessageID      uuid.UUID `json:"message_id"`
	Seq            int64     `json:"seq"`
	MessageType    int16     `json:"message_type"`
	SenderNickname string    `json:"sender_nickname"`
	CreatedAt      time.Time `json:"created_at"`
	Key            string    `json:"key"`
	ThumbKey       string    `json:"thumb_key,omitempty"`
	Name           string    `json:"name,omitempty"`
	Size           int64     `json:"size,omitempty"`
	Duration       int       `json:"duration,omitempty"`
	Width          int       `json:"width,omitempty"`
	Height         int       `json:"height,omitempty"`
	StickerID      string    `json:"sticker_id,omitempty"`
}

// GetMedia 拉取会话媒体相册：校验成员 + type 参数，按 seq 游标分页。
func (s *MessageService) GetMedia(ctx context.Context, userID, convID uuid.UUID, filter string, beforeSeq int64, limit int) ([]MediaItemView, error) {
	member, ok, err := s.convRepo.GetMember(ctx, convID, userID)
	if err != nil {
		return nil, fmt.Errorf("check membership: %w", err)
	}
	if !ok {
		return nil, ErrNotMember
	}
	types, ok := mediaTypeGroups[filter]
	if !ok {
		return nil, ErrInvalidMediaType
	}
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	rows, err := s.msgRepo.ListMedia(ctx, convID, types, beforeSeq, member.ClearedBeforeSeq, limit)
	if err != nil {
		return nil, err
	}
	items := make([]MediaItemView, 0, len(rows))
	for _, r := range rows {
		item := MediaItemView{
			MessageID: r.ID, Seq: r.Seq, MessageType: r.MessageType,
			SenderNickname: r.SenderNickname, CreatedAt: r.CreatedAt,
		}
		var content map[string]any
		if err := json.Unmarshal([]byte(r.Content), &content); err != nil {
			s.logger.Warn("media item has invalid content json", zap.String("message_id", r.ID.String()))
			continue // 脏数据跳过：相册是浏览视图，不因单条坏数据整页失败
		}
		if k, _ := content["key"].(string); k != "" {
			item.Key = k
		}
		if t, _ := content["thumb_key"].(string); t != "" {
			item.ThumbKey = t
		}
		if n, _ := content["name"].(string); n != "" {
			item.Name = n
		}
		if sz, _ := content["size"].(float64); sz > 0 {
			item.Size = int64(sz)
		}
		if d, _ := content["duration"].(float64); d > 0 {
			item.Duration = int(d)
		}
		if w, _ := content["width"].(float64); w > 0 {
			item.Width = int(w)
		}
		if h, _ := content["height"].(float64); h > 0 {
			item.Height = int(h)
		}
		if s, _ := content["sticker_id"].(string); s != "" {
			item.StickerID = s
		}
		items = append(items, item)
	}
	return items, nil
}
```

`message_service.go` 顶部 import 确认有 `errors`（无则补）与 `encoding/json`（已有）。

- [ ] **Step 7: service 测试转绿**

Run: `cd server && go test ./internal/service/ -run TestGetMedia`
Expected: PASS

- [ ] **Step 8: handler + 路由**

`server/internal/handler/message.go` 加：

```go
// Media 返回会话媒体相册（按 message_type 过滤，seq 降序游标分页）。
//
//	@Summary		会话媒体相册
//	@Tags			chat
//	@Security		BearerAuth
//	@Param			id			path	string	true	"会话 id"
//	@Param			type		query	string	false	"媒体类型 all|image|file|voice|video|sticker，默认 all"
//	@Param			before_seq	query	int		false	"拉取 seq < before_seq 的媒体；0 表示最新"
//	@Param			limit		query	int		false	"每页条数，默认 30，上限 100"
//	@Success		200	{object}	Response
//	@Router			/api/v1/conversations/{id}/media [get]
func (h *MessageHandler) Media(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	convID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid conversation id")
		return
	}
	typeFilter := c.DefaultQuery("type", "all")
	beforeSeq, _ := strconv.ParseInt(c.DefaultQuery("before_seq", "0"), 10, 64)
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "30"))
	if limit <= 0 || limit > 100 {
		limit = 30
	}

	items, err := h.svc.GetMedia(c.Request.Context(), userID, convID, typeFilter, beforeSeq, limit)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrNotMember):
			Error(c, 403, 403, "not a conversation member")
		case errors.Is(err, service.ErrInvalidMediaType):
			BadRequest(c, "invalid media type")
		default:
			h.logger.Error("get media failed", zap.Error(err))
			InternalError(c, "failed to load media")
		}
		return
	}
	Success(c, gin.H{
		"items":    items,
		"has_more": len(items) == limit,
	})
}
```

`server/internal/router/router.go` 的 chat 组（`chat.GET("/conversations/:id/messages", msgH.History)` 之后）加：

```go
chat.GET("/conversations/:id/media", msgH.Media)
```

`server/internal/handler/message_test.go` 加形状测试（httptest + 假 service，沿用该文件既有模式）：成功响应含 `items`/`has_more`；`type=bogus` → 400；非成员 → 403。

- [ ] **Step 9: 全量 go 测试**

Run: `cd server && go vet ./... && go test ./...`
Expected: PASS

- [ ] **Step 10: 提交**

```bash
git add server/internal/repository/message_repo.go server/internal/repository/message_repo_test.go server/internal/service/message_service.go server/internal/service/message_service_test.go server/internal/handler/message.go server/internal/router/router.go
git commit -m "feat(server): 会话媒体相册端点（type 过滤 + seq 游标分页）"
```

> 注意：`message_service_test.go` 如已有 `GetHistory` 非成员用例的 fake repo，直接复用不新建。

## Task 4: 后端 —— 对象 ACL 与 GC 覆盖 thumb_key（Stage B）

**Files:**

- Modify: `server/internal/repository/object_acl_repo.go`
- Test: `server/internal/repository/object_acl_repo_test.go`

**Interfaces:**

- Consumes: `model.MessageTypeVideo`（本批）、`MessageContentVideo.ThumbKey`
- Produces: `CanRead` 对 `thumb_key` 命中；`ReferencedKeys` 把 `thumb_key` 计入引用

- [ ] **Step 1: 写测试（先红）**

`server/internal/repository/object_acl_repo_test.go` 加（沿用既有 CanRead 用例的 fixture 模式）：

```go
func TestCanReadVideoThumb(t *testing.T) {
	// fixture：会话内一条 video 消息（content 含 key + thumb_key）。
	// 断言：CanRead(thumb_key) == true；撤回该消息后 CanRead(thumb_key) == false。
}

func TestReferencedKeysIncludesThumb(t *testing.T) {
	// fixture：一条 video 消息（thumb_key=T）。
	// 断言：ReferencedKeys([T]) 返回 T；消息撤回后 ReferencedKeys([T]) 不含 T。
}
```

- [ ] **Step 2: 跑测试 FAIL**

Run: `cd server && go test ./internal/repository/ -run 'TestCanReadVideoThumb|TestReferencedKeysIncludesThumb'`
Expected: FAIL（现有 SQL 只匹配 key）

- [ ] **Step 3: 实现**

`object_acl_repo.go` `CanRead` 的 SQL `WHERE m.content ->> 'key' = ?` 改为：

```sql
WHERE (m.content ->> 'key' = ? OR m.content ->> 'thumb_key' = ?)
  AND m.status = 1
  AND m.seq > cm.cleared_before_seq
```

（`Raw` 第 2、3 个实参均为 `objectKey`。）并更新函数注释中「key 出现在某条未撤回消息的 content.key 里」为「key 或 thumb_key 出现在…」。

`ReferencedKeys` 中消息引用查询改为同时收集两字段：

```go
if err := collect(`SELECT DISTINCT content ->> 'key' FROM messages WHERE content ->> 'key' IN ?
UNION
SELECT DISTINCT content ->> 'thumb_key' FROM messages WHERE content ->> 'thumb_key' IN ?`); err != nil {
	return nil, fmt.Errorf("referenced by messages: %w", err)
}
```

调用点保持 `collect(sql)` 不变（两次使用同一 `keys` 变量）。

- [ ] **Step 4: 测试转绿**

Run: `cd server && go test ./internal/repository/ -run 'TestCanRead|TestReferencedKeys'`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/internal/repository/object_acl_repo.go server/internal/repository/object_acl_repo_test.go
git commit -m "fix(object-acl): 视频缩略图 thumb_key 纳入对象授权与 GC 引用判定"
```

## Task 5: 前端 —— 媒体查询 API 与消息类型贯通（Stage C）

**Files:**

- Modify: `packages/shared/src/api/chat.ts`
- Modify: `packages/shared/src/store/messageStore.ts`
- Test: `packages/shared/src/__tests__/messageSendGolden.test.ts`（随 golden 生效）、`packages/ui/src/__tests__/MessageBubble.test.tsx`（后续用例）

**Interfaces:**

- Consumes: `ClientContent` video 成员（Task 1）
- Produces:
  - `MediaItem` 类型：`{ messageId: string; seq: number; messageType: 2|3|4|5|8; senderNickname: string; createdAt: string; key: string; thumbKey?: string; name?: string; size?: number; duration?: number; width?: number; height?: number; stickerId?: string }`
  - `fetchConversationMedia(conversationId: string, type: "all"|"image"|"file"|"voice"|"video"|"sticker", beforeSeq: number, limit: number): Promise<{ items: MediaItem[]; hasMore: boolean }>`
  - `ChatMessageKind` 加 `"video"`；`ChatMessage.video?: ChatVideo`；`ChatVideo { key?: string; thumbKey?: string; name?: string; size?: string; duration: number; width: number; height: number; localUrl?: string }`
  - `sendVideo(conversationId: string, file: File): Promise<void>`

- [ ] **Step 1: MediaItem + fetchConversationMedia**

`packages/shared/src/api/chat.ts`（`fetchMessages` 之后）加：

```ts
/** 媒体相册条目（服务端 MediaItemView 的映射；字段按类型填充） */
export interface MediaItem {
  messageId: string;
  seq: number;
  /** 2=image 3=file 4=voice 5=video 8=sticker（不含 text/system/e2ee） */
  messageType: 2 | 3 | 4 | 5 | 8;
  senderNickname: string;
  createdAt: string;
  key: string;
  thumbKey?: string;
  name?: string;
  size?: number;
  duration?: number;
  width?: number;
  height?: number;
  stickerId?: string;
}

interface MediaItemDTO {
  message_id: string;
  seq: number;
  message_type: number;
  sender_nickname: string;
  created_at: string;
  key: string;
  thumb_key?: string;
  name?: string;
  size?: number;
  duration?: number;
  width?: number;
  height?: number;
  sticker_id?: string;
}

/**
 * 拉取会话媒体相册（seq 降序游标分页，与 fetchMessages 同构）。
 * @param type - all|image|file|voice|video|sticker
 * @param beforeSeq - 0 表示最新一页；下一页传上一页最小 seq
 */
export async function fetchConversationMedia(
  conversationId: string,
  type: "all" | "image" | "file" | "voice" | "video" | "sticker",
  beforeSeq: number,
  limit: number,
): Promise<{ items: MediaItem[]; hasMore: boolean }> {
  const qs = new URLSearchParams({ type, before_seq: String(beforeSeq), limit: String(limit) });
  const data = await apiGet<{ items: MediaItemDTO[]; has_more: boolean }>(
    "/api/v1/conversations/" + conversationId + "/media?" + qs.toString(),
  );
  const items = (data.items || []).map((dto) => ({
    messageId: dto.message_id,
    seq: dto.seq,
    messageType: dto.message_type as MediaItem["messageType"],
    senderNickname: dto.sender_nickname,
    createdAt: dto.created_at,
    key: dto.key,
    thumbKey: dto.thumb_key,
    name: dto.name,
    size: dto.size,
    duration: dto.duration,
    width: dto.width,
    height: dto.height,
    stickerId: dto.sticker_id,
  }));
  return { items, hasMore: !!data.has_more };
}
```

- [ ] **Step 2: ChatMessageKind + ChatVideo + mapMessage**

`packages/shared/src/store/messageStore.ts`：

```ts
export type ChatMessageKind = "text" | "image" | "file" | "voice" | "system" | "sticker" | "video";
```

```ts
/** 视频消息载荷：thumbKey 为缩略图对象键（点击预览时签下载 URL，不随消息流加载） */
export interface VideoPayload {
  /** 时长（秒） */
  duration: number;
  /** 像素尺寸（卡片占位） */
  width: number;
  height: number;
  /** 对象存储 key（主视频） */
  key?: string;
  /** 缩略图对象 key */
  thumbKey?: string;
  /** 展示用大小文案 */
  size?: string;
  /** 原始文件名 */
  name?: string;
  /** 本地 blob URL，上传期间占位播放 */
  localUrl?: string;
}
```

`ChatMessage` 加 `video?: VideoPayload;`（`voice` 之后）。

`packages/shared/src/api/chat.ts` `mapMessage`：

- `kindMap` 加 `5: "video"`；
- `parseVideoContent`：

```ts
/** content JSON → 视频载荷（key/thumb_key/name/size/duration/width/height，容错同 parseImageContent） */
function parseVideoContent(content: string): {
  key?: string;
  thumbKey?: string;
  name?: string;
  size?: number;
  duration: number;
  width: number;
  height: number;
} {
  try {
    const parsed = JSON.parse(content) as {
      key?: string;
      thumb_key?: string;
      name?: string;
      size?: number;
      duration?: number;
      width?: number;
      height?: number;
    };
    return {
      key: typeof parsed.key === "string" ? parsed.key : undefined,
      thumbKey: typeof parsed.thumb_key === "string" ? parsed.thumb_key : undefined,
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      size: typeof parsed.size === "number" ? parsed.size : undefined,
      duration: typeof parsed.duration === "number" ? parsed.duration : 0,
      width: typeof parsed.width === "number" ? parsed.width : 0,
      height: typeof parsed.height === "number" ? parsed.height : 0,
    };
  } catch {
    return { duration: 0, width: 0, height: 0 };
  }
}
```

- `mapMessage` 中：

```ts
const isVideo = dto.message_type === 5;
let video: ChatMessage["video"];
if (isVideo) {
  const parsed = parseVideoContent(dto.content);
  video = {
    duration: parsed.duration,
    width: parsed.width,
    height: parsed.height,
    key: parsed.key,
    thumbKey: parsed.thumbKey,
    size: parsed.size != null ? formatFileSize(parsed.size) : undefined,
    name: parsed.name,
  };
}
```

`formatFileSize` 若不存在则复用 `formatFileMeta` 的既有实现（`file.ts` 已有导出，确认 import）。

`return` 对象加 `video,`。

- [ ] **Step 3: MSW media handler**

`packages/shared/src/mocks/handlers.ts` 加（`DELETE /api/v1/conversations/:id/messages` 附近；媒体样本从 `DEMO_MESSAGES`（按会话 id 分组的 `ChatMessage[]`）过滤映射）：

```ts
// --------------------------------------------------
// 会话 — 媒体相册
// GET /api/v1/conversations/:id/media?type=&before_seq=
// --------------------------------------------------
http.get("http://localhost:8085/api/v1/conversations/:id/media", async ({ request }) => {
  await delay(300);
  const url = new URL(request.url);
  if (url.searchParams.get("error") === "1") {
    return HttpResponse.json({ code: 500, message: "media load failed" }, { status: 500 });
  }
  const type = url.searchParams.get("type") ?? "all";
  const typeMap: Record<string, { kind: ChatMessageKind; message_type: number }[]> = {
    all: [
      { kind: "image", message_type: 2 },
      { kind: "file", message_type: 3 },
      { kind: "voice", message_type: 4 },
      { kind: "video", message_type: 5 },
      { kind: "sticker", message_type: 8 },
    ],
    image: [{ kind: "image", message_type: 2 }],
    file: [{ kind: "file", message_type: 3 }],
    voice: [{ kind: "voice", message_type: 4 }],
    video: [{ kind: "video", message_type: 5 }],
    sticker: [{ kind: "sticker", message_type: 8 }],
  };
  const allowed = typeMap[type] ?? [];
  const convId = url.pathname.split("/")[3];
  const source = DEMO_MESSAGES[convId] ?? [];
  const items = source
    .filter((m) => allowed.some((a) => a.kind === m.kind))
    .map((m) => {
      const meta = allowed.find((a) => a.kind === m.kind)!;
      const pick = (p?: { key?: string; name?: string; size?: string; seconds?: number; duration?: number; width?: number; height?: number; stickerId?: string; thumbKey?: string }) => ({
        key: p?.key,
        name: p?.name,
        size: p?.size != null ? parseFloat(p.size) : undefined,
        duration: p?.seconds ?? p?.duration,
        width: p?.width,
        height: p?.height,
        sticker_id: p?.stickerId,
        thumb_key: p?.thumbKey,
      });
      const content = pick(
        m.kind === "image" ? m.image : m.kind === "file" ? m.file : m.kind === "voice" ? m.voice : m.kind === "video" ? m.video : m.sticker,
      );
      return {
        message_id: m.id,
        seq: m.seq ?? 0,
        message_type: meta.message_type,
        sender_nickname: m.senderName ?? "自己",
        created_at: new Date(m.createdAtMs ?? Date.now()).toISOString(),
        ...content,
      };
    })
    .filter((i) => i.key)
    .sort((a, b) => b.seq - a.seq);
  return apiOk({ items, has_more: false });
}),
```

同时 `demoData.ts` 在 `DEMO_MESSAGES` 已用到的会话加 1 条 `kind: "video"` 样本（`image?: undefined; file?: undefined; voice?: undefined; video: { duration: 15, width: 1280, height: 720, key: "files/2026/09/video-demo.mp4", thumbKey: "images/2026/09/video-thumb.jpg" }; sticker?: undefined; status: "sent"`），保证「视频」Tab 有数据；其余 tab 复用既有 image/voice/file/sticker 样本。

- [ ] **Step 4: MSW 双端启动 + 类型检查**

Run: `pnpm --filter @yuanchat/web typecheck && pnpm --filter @yuanchat/desktop typecheck && LANG=C.UTF-8 pnpm test`
Expected: PASS（golden 测试此时应已转绿；`TestBuildContent` 相关无碍）

- [ ] **Step 5: 提交**

```bash
git add packages/shared/src/api/chat.ts packages/shared/src/store/messageStore.ts packages/shared/src/mocks/handlers.ts packages/shared/src/mocks/demoData.ts
git commit -m "feat(shared): 媒体相册 API 与视频消息类型贯通（含 MSW mock）"
```

## Task 6: 前端 —— 相册视图 ConversationMediaView（Stage C）

**Files:**

- Create: `packages/ui/src/ConversationMediaView.tsx`
- Modify: `packages/ui/src/ChatWindow.tsx`（入口按钮 + 挂载）
- Modify: `packages/design-system/src/i18n/locales/{zh-CN,en-US,ja-JP,ko-KR}.json`
- Test: `packages/ui/src/__tests__/ConversationMediaView.test.tsx`

**Interfaces:**

- Consumes: `fetchConversationMedia` / `MediaItem`（Task 5）、`ImageLightbox`、`voicePlayer`（Task 8 接入倍速）、`fileIconOf`、`StickerImage`、`getDownloadUrl`
- Produces: `<ConversationMediaView conversationId={string} onClose={fn} />`；i18n key 组 `media.*`

- [ ] **Step 1: i18n 四语 key**

四份 locale 各加（key 命名沿用既有 `chat.*` 分组；四语都要，漏了 check:i18n 会挡）：

```json
"media": {
  "title": "媒体相册",
  "tabAll": "全部",
  "tabImage": "图片",
  "tabFile": "文件",
  "tabVoice": "语音",
  "tabVideo": "视频",
  "tabSticker": "贴纸",
  "empty": "这里还没有媒体",
  "loadFailed": "媒体加载失败",
  "retry": "重试",
  "videoPlay": "播放视频",
  "fileDownload": "下载文件"
}
```

en-US/ja-JP/ko-KR 对应翻译（ja/ko 由惯例机翻 + 母语校对另立债项，本批同步 key 集合即可）。

- [ ] **Step 2: 写组件测试（先红）**

`packages/ui/src/__tests__/ConversationMediaView.test.tsx`（参照 `StickerMarketView.test.tsx` 的 MSW mock 模式，`beforeEach` 用 `server.use(...)` 覆盖四态）：

```tsx
// 1. normal：渲染 Tab 条 + 网格卡片（image 3 个 → 3 个 img 占位）；
// 2. 切换 Tab「视频」→ 只渲染 video 卡片（含时长角标）；
// 3. error（?error=1）→ 显示重试按钮，点重试 → 恢复列表；
// 4. empty（type=video 无数据）→ 显示 media.empty；
// 5. 点图片卡片 → 打开 ImageLightbox（role=dialog 出现）。
```

- [ ] **Step 3: 跑测试 FAIL**

Run: `LANG=C.UTF-8 pnpm --filter @yuanchat/ui test -- --run ConversationMediaView`
Expected: FAIL（组件不存在）

- [ ] **Step 4: 实现组件**

`packages/ui/src/ConversationMediaView.tsx`（新文件，结构要点）：

```tsx
/**
 * ConversationMediaView — 会话媒体相册
 * ...
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchConversationMedia, getDownloadUrl } from "@yuanchat/shared";
import type { MediaItem } from "@yuanchat/shared";
import { X } from "lucide-react";
import { ImageLightbox } from "./ImageLightbox";
import { fileIconOf } from "./fileIcon";
import { StickerImage } from "./StickerImage";

const PAGE_SIZE = 30;
const TABS = ["all", "image", "file", "voice", "video", "sticker"] as const;
type MediaTab = (typeof TABS)[number];

export function ConversationMediaView({
  conversationId,
  onClose,
}: {
  conversationId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<MediaTab>("all");
  const [items, setItems] = useState<MediaItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const minSeqRef = useRef<number>(Infinity); // 已加载最小 seq（下一页游标）

  const load = useCallback(
    (type: MediaTab, beforeSeq: number, append: boolean) => {
      setLoading(true);
      setFailed(false);
      fetchConversationMedia(conversationId, type, beforeSeq, PAGE_SIZE)
        .then((res) => {
          if (res.items.length > 0) {
            minSeqRef.current = Math.min(minSeqRef.current, res.items[res.items.length - 1].seq);
          }
          setItems((prev) => (append ? [...prev, ...res.items] : res.items));
          setHasMore(res.hasMore);
        })
        .catch(() => setFailed(true))
        .finally(() => setLoading(false));
    },
    [conversationId],
  );

  useEffect(() => {
    minSeqRef.current = Infinity;
    load(tab, 0, false);
  }, [tab, load]);
  // …… Tab 切换、滚动触底（scrollRef scrollTop+clientHeight 距底 <200px → load(tab, minSeqRef.current, true)）、
  // 图片/视频/文件/语音/贴纸卡片渲染（视频卡：thumbKey ? <img src={…下载URL}> : 骨架；时长角标）
  return (
    <div className="bg-surface fixed inset-0 z-50 flex flex-col" role="dialog" aria-modal="true">
      {/* 头部：返回按钮 + 标题 + 关闭 */}
      {/* Tab 条 */}
      {/* 滚动容器（网格 / 行列表） */}
      {failed && <button onClick={() => load(tab, 0, false)}>{t("media.retry")}</button>}
      {loading && <div className="grid grid-cols-3 gap-2 p-3">{/* 六宫格骨架 */}</div>}
      {!loading && !failed && items.length === 0 && <p>{t("media.empty")}</p>}
      {lightboxUrl && <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </div>
  );
}
```

实现要点（全部在渲染细节，测试锚点）：

- 图片卡：`<button data-testid="media-image-{seq}">` 内 `<img>`（下载 URL 由 `getDownloadUrl(item.key)` 解析，建议 `useMediaUrl(key)` 小 hook：useEffect + state，卸载忽略竞态）；
- 视频卡：`<img src={thumbUrl}>` + `${duration}s` 角标 + 播放钮 → 点击开 `<div role="dialog" aria-label={t("media.videoPlay")}>` 内 `<video controls preload="metadata" src={getDownloadUrl(key)}>`；
- 文件/语音行：`data-testid="media-row-{seq}"`，语音行含播放按钮（调用 `playVoice`，成功后 `voicePlayingId` 高亮）与时长；
- 贴纸卡：`<StickerImage sticker={{ key: item.key, width: item.width, height: item.height }} />`；
- 骨架：`aspect-square bg-surface-container-low animate-pulse`，不要用会改尺寸的容器。

- [ ] **Step 5: 测试转绿 + 入口接线**

Run: `LANG=C.UTF-8 pnpm --filter @yuanchat/ui test -- --run ConversationMediaView`
Expected: PASS

`ChatWindow.tsx`：header 右侧（`ChatDetail` 打开按钮附近）加：

```tsx
const [showMedia, setShowMedia] = useState(false);
// 按钮：<button aria-label={t("media.title")} data-testid="open-media" onClick={() => setShowMedia(true)}>
// 挂载：{showMedia && (
//   <ConversationMediaView conversationId={activeConversationId} onClose={() => setShowMedia(false)} />
// )}
```

（activeConversationId 取当前会话；移动端样式与现有 header 按钮对齐。）

- [ ] **Step 6: 组件测试与 lint**

Run: `pnpm --filter @yuanchat/ui test && pnpm lint && pnpm check:i18n`
Expected: PASS（check:i18n 会盯漏翻 key）

- [ ] **Step 7: 提交**

```bash
git add packages/ui/src/ConversationMediaView.tsx packages/ui/src/ChatWindow.tsx packages/ui/src/__tests__/ConversationMediaView.test.tsx packages/design-system/src/i18n/locales/zh-CN.json packages/design-system/src/i18n/locales/en-US.json packages/design-system/src/i18n/locales/ja-JP.json packages/design-system/src/i18n/locales/ko-KR.json
git commit -m "feat(ui): 会话媒体相册视图（类型筛选 + 游标分页 + Lightbox 复用）"
```

## Task 7: 前端 —— 视频消息发送与气泡（Stage C）

**Files:**

- Modify: `packages/shared/src/store/messageStore.ts`（`sendVideo` / `dispatchVideoSend`）
- Modify: `packages/ui/src/Composer.tsx`（视频按钮）
- Modify: `packages/ui/src/MessageBubble.tsx`（video 气泡 + 播放弹层）
- Test: `packages/ui/src/__tests__/MessageBubble.test.tsx`、`apps/web/e2e/chat-experience.spec.ts`（或新增 `media.spec.ts`）

**Interfaces:**

- Consumes: `ClientContent` video（Task 1）、`VideoPayload`（Task 5）、`getUploadUrl/uploadToTicket`（既有）
- Produces: `useMessageStore.getState().sendVideo(conversationId, file)`；`data-testid="send-video"` 按钮

- [ ] **Step 1: store sendVideo（先写测试驱动）**

`packages/ui/src/__tests__/MessageBubble.test.tsx` 补 video 气泡用例（fixture：`kind:"video"`，duration/width/height/thumbKey 齐全 → 断言渲染缩略图 + 时长角标 + 点击出现 video 弹层）。

- [ ] **Step 2: 实现 sendVideo**

`packages/shared/src/store/messageStore.ts`（`sendVoice` 之后）加：

```ts
sendVideo: async (conversationId, file) => {
  const clientMsgId = crypto.randomUUID();
  // 乐观消息：本地 URL 预览
  const localUrl = URL.createObjectURL(file);
  addLocalMessage(conversationId, {
    id: clientMsgId,
    conversationId,
    kind: "video",
    isSelf: true,
    video: { duration: 0, width: 0, height: 0, localUrl, name: file.name },
    time: nowLabel(),
    status: "sending",
    clientMsgId,
  });
  void dispatchVideoSend(conversationId, file, clientMsgId, get);
},
```

`dispatchVideoSend`（复刻 `dispatchVoiceSend` 骨架 + 元数据读取）：

```ts
async function dispatchVideoSend(
  conversationId: string,
  file: File,
  clientMsgId: string,
  get: () => MessageState,
) {
  // 1. 读元数据（duration/width/height）：video 元素 + URL.createObjectURL，loadedmetadata 后取；
  //    超时 10s 视为不可读 → toast + failed。
  // 2. 校验：duration > 120 → toast「视频不超过 2 分钟」+ failed；size > 100MB → toast + failed。
  // 3. 缩略图：video currentTime=min(0.5, duration/2) → seeked → canvas.drawImage → toBlob("image/jpeg", 0.75)
  //    ；seeked 事件缺失（个别 WebView）→ 尝试 loadeddata 兜底；均失败 → 仍可发（thumbKey 缺省，气泡显示灰色占位）。
  // 4. 上传：video → getUploadUrl(file.name, file.type || "video/mp4", file.size) → uploadToTicket → key；
  //    thumb → getUploadUrl("thumb.jpg", "image/jpeg", thumbBlob.size) → uploadToTicket → thumbKey。
  // 5. 回填：map 消息 video { key, thumbKey, duration, width, height, size: formatFileSize(file.size) }。
  // 6. chatSocket.send("message.send", { conversation_id, content: { type: "video", key, thumb_key: thumbKey, name: file.name, size: file.size, duration, width, height }, client_msg_id: clientMsgId });
  // 7. armAckTimeout(conversationId, clientMsgId, get);
  // 任一上传失败 → setStatus(failed) + toast（与 dispatchFileSend 同路径）。
}
```

注意：`formatFileSize` 已在 `files.ts` 有实现（`formatFileMeta` 内部用），确认导出后复用。

- [ ] **Step 3: Composer 视频按钮**

`packages/ui/src/Composer.tsx`：

- import 加 `Clapperboard`（lucide）或复用 `Video`；
- 隐藏 input 加（`accept="video/*"`）：

```tsx
<input
  ref={videoInputRef}
  type="file"
  accept="video/*"
  className="hidden"
  onChange={handleVideoPick}
/>
```

- `handleVideoPick`：

```tsx
const handleVideoPick = (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (file && activeId) {
    void useMessageStore.getState().sendVideo(activeId, file);
  }
  e.target.value = "";
};
```

- 工具条（图片按钮旁）加：

```tsx
<button
  onClick={openVideoPicker}
  className="md3-icon-btn text-on-surface-variant"
  aria-label={t("chat.input.video")}
  data-testid="send-video"
>
  <Video size={20} />
</button>
```

- locale 补 `chat.input.video`（四语）。

- [ ] **Step 4: MessageBubble video 气泡**

`packages/ui/src/MessageBubble.tsx`（voice 分支后）加：

```tsx
{
  msg.kind === "video" && msg.video && (
    <div className="min-w-[200px] overflow-hidden rounded-lg">
      <div className="relative aspect-video w-56 bg-black/10">
        {/* thumbKey 解析下载 URL 作 <img src>；无 thumb → 灰色占位 + Play 图标 */}
        <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
        <span className="text-label-sm absolute right-1.5 bottom-1.5 rounded bg-black/60 px-1.5 py-0.5 text-white tabular-nums">
          {formatDuration(msg.video.duration)}
        </span>
        <button
          aria-label={t("media.videoPlay")}
          onClick={() => setVideoOpen(true)}
          className="absolute inset-0 flex items-center justify-center"
          data-testid="video-play"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white">
            <Play size={20} fill="currentColor" />
          </span>
        </button>
      </div>
    </div>
  );
}
```

弹层（组件级 `videoOpen` state + `localUrl ?? getDownloadUrl(key)` 作 `<video controls src>`），与相册视频弹层共用同一渲染块——**抽到 `VideoPlaybackOverlay` 小组件**（`packages/ui/src/VideoPlaybackOverlay.tsx`）供两处复用：

```tsx
/** VideoPlaybackOverlay — 视频全屏播放层（相册与气泡共用） */
export function VideoPlaybackOverlay({ url, onClose }: { url: string; onClose: () => void }) {
  // fixed inset-0 z-50 bg-black/90 flex items-center justify-center；Esc/点击遮罩关闭（对齐 ImageLightbox）
  // <video controls preload="metadata" autoPlay playsInline src={url} className="max-h-full max-w-full" />
}
```

- [ ] **Step 5: 单元测试 + 类型检查**

Run: `LANG=C.UTF-8 pnpm test && pnpm --filter @yuanchat/web typecheck && pnpm --filter @yuanchat/desktop typecheck`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add packages/shared/src/store/messageStore.ts packages/ui/src/Composer.tsx packages/ui/src/MessageBubble.tsx packages/ui/src/VideoPlaybackOverlay.tsx packages/ui/src/__tests__/MessageBubble.test.tsx packages/design-system/src/i18n/locales/*.json
git commit -m "feat(chat): 视频消息发送（文件选择 + 缩略图生成）与气泡播放"
```

## Task 8: 前端 —— 语音倍速播放（Stage D）

**Files:**

- Modify: `packages/ui/src/voicePlayer.ts`
- Modify: `packages/ui/src/MessageBubble.tsx`
- Test: `packages/ui/src/__tests__/MessageBubble.test.tsx`（+ 新增 voicePlayer 单测）

**Interfaces:**

- Consumes: `playVoice` / `subscribeVoicePlayer`（既有）
- Produces: `setVoiceRate(rate: 1 | 1.5 | 2): void`；`getVoiceRate(): 1 | 1.5 | 2`；`subscribeVoicePlayer` 回调参数扩展为 `{ playingId, rate }`

- [ ] **Step 1: 写 voicePlayer 测试**

```tsx
// setVoiceRate(1.5) 后 playVoice → audio.playbackRate === 1.5；
// setVoiceRate(2) 后新播放 → 2；stopVoice 不重置 rate。
// （audio 为内部单例，测试内通过 fake Audio / 暴露的 lastUrl 断言；如不易注入，
//   退而断言 getVoiceRate 状态与 subscribe 回调收到的 rate。）
```

- [ ] **Step 2: 实现**

`packages/ui/src/voicePlayer.ts`：

```ts
export type VoiceRate = 1 | 1.5 | 2;

let rate: VoiceRate = 1;

export function setVoiceRate(next: VoiceRate): void {
  rate = next;
  if (audio) audio.playbackRate = next;
}

export function getVoiceRate(): VoiceRate {
  return rate;
}
```

`playVoice` 创建 audio 后加 `audio.playbackRate = rate;`；`subscribeVoicePlayer` 的 `notify` 载荷从 `playingId` 扩展为 `{ playingId, rate }`（`MessageBubble` 的调用点相应解构；保持向后兼容的旧签名调用点同步改）。

- [ ] **Step 3: MessageBubble 倍速按钮（仅活动语音行）**

`packages/ui/src/MessageBubble.tsx` 语音行：`voicePlayingId === msg.id` 时渲染：

```tsx
<button
  aria-label={t("chat.voice.rate")}
  data-testid="voice-rate"
  className="text-label-sm shrink-0 rounded-full px-1.5 py-0.5"
  onClick={() => setVoiceRate(getVoiceRate() === 2 ? 1 : getVoiceRate() === 1.5 ? 2 : 1.5)}
>
  {getVoiceRate()}x
</button>
```

循环序：1 → 1.5 → 2 → 1（用显式 `nextRate` map 而非取模）。locale 补 `chat.voice.rate`（四语）。

- [ ] **Step 4: 测试 + 全量前端**

Run: `LANG=C.UTF-8 pnpm test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/ui/src/voicePlayer.ts packages/ui/src/MessageBubble.tsx packages/ui/src/__tests__/MessageBubble.test.tsx packages/design-system/src/i18n/locales/*.json
git commit -m "feat(chat): 语音消息倍速播放（1x/1.5x/2x）"
```

## Task 9: husky 钩子 tsc 门禁（Stage E）

**Files:**

- Modify: `.husky/pre-commit`

**Interfaces:**

- Consumes: 无
- Produces: staged 含 ts/tsx 时前置类型检查拦截

- [ ] **Step 1: 修改 hook**

`.husky/pre-commit`：

```sh
pnpm lint-staged

# 前端类型检查：staged 含 ts/tsx 时全量 typecheck（turbo 缓存命中后近零耗时）。
# 只跑 lint-staged 文件无法做 tsc：tsc 需要整包工程语义（跨文件类型依赖）。
if git diff --cached --name-only | grep -qE '\.(ts|tsx)$'; then
  pnpm --filter @yuanchat/web typecheck && pnpm --filter @yuanchat/desktop typecheck
fi
```

- [ ] **Step 2: 验收**

- 故意改一处类型错误（如 `App.tsx` 里 `const x: number = "s"`）→ `git add` 后 `git commit`，预期被 hook 挡下（Exit 1）；
- 删掉该错误 → 再次 commit 通过；
- 纯 Go 改动（staged 无 ts/tsx）→ 只跑 lint-staged，不跑 tsc。

- [ ] **Step 3: 提交**

```bash
git add .husky/pre-commit
git commit -m "chore(hooks): pre-commit 增前端 tsc 门禁（staged 含 ts/tsx 时）"
```

## Task 10: 全量验证与真机实测 + 文档收尾（Stage E）

**Files:**

- Modify: `docs/MASTER_PLAN.md`（未做清单状态）
- Modify: `docs/CHAT_API.md`（media 端点 + video content）
- 可能 Modify: `docs/DEVELOPMENT.md`（无命令变更则不改）

- [ ] **Step 1: 本地 CI 全量**

Run: `pnpm check:i18n && pnpm test && pnpm --filter @yuanchat/web typecheck && pnpm --filter @yuanchat/desktop typecheck && pnpm --filter @yuanchat/web test:e2e && (cd server && go vet ./... && go test ./... && go test -race ./internal/ws/)`
Expected: 全绿（E2E 真后端时用 `pnpm dev:*` 启全线，注意残留 dev server 的坑：`reuseExistingServer` 会接管 5173）

- [ ] **Step 2: 真机实测**

- **Web/Desktop**：`playwright-cli` 走查——正常路径发视频消息、相册打开/过滤/滚动/返回、语音倍速、暗色主题切换；桌面 Tauri 实启，CSP 拦截日志 0 行；
- **Android**：模拟器 + adb——相册打开/滚动/返回键（back interceptor 注册，防误退）、视频发/收/播、倍速；
- 生产产物抽查：`apps/web/dist` 的 JS 无 `?.`/`??`（es2019 底线）。

- [ ] **Step 3: 文档收尾**

`docs/MASTER_PLAN.md`：

- 阶段三勾选「会话媒体相册」「视频消息」「语音消息倍速播放」；
- K 泳道表 K6/K7/K8 → ✅（标注 2026-09-02 完成）；
- 债表「husky 不跑 tsc」→ ✅；
- **新发现的债当次登记**：相册无时间过滤/搜索（⚪）、视频无录制/转码（⚪）、无大小预览进度（⚪）、ja/ko 机翻未母语校对（沿用 J10）。

`docs/CHAT_API.md`：补 `GET /conversations/:id/media` 与 `message.send` video content 结构说明。

- [ ] **Step 4: 合回 dev**

Run: `git merge --no-ff feature/media-album-and-video`（在 dev 上执行；合并前确认本地 CI 全绿；推送 dev 前再次确认。）

- [ ] **Step 5: 提交**

```bash
git add docs/MASTER_PLAN.md docs/CHAT_API.md
git commit -m "docs: 媒体相册/视频消息/语音倍速交付回写与 API 文档"
```

---

## Self-Review 记录（计划编写时对照 spec）

- **Spec 覆盖**：§2.1 端点→Task 3；§2.2 帧/白名单/缩略图→Task 1/2/4；§2.3 CSP 核对→Task 10 Step 2（无代码改动）；§3.1 契约→Task 1/5；§3.2 相册视图→Task 6；§3.3 发送与气泡→Task 7；§3.4 倍速→Task 8；§3.5 MSW→Task 5 Step 3；§4 husky→Task 9；§5 测试→各 Task 内 + Task 10；§7 登记债→Task 10 Step 3。无缺口。
- **占位符扫描**：无 TBD/TODO；每个代码步骤含完整实现或可执行测试。
- **类型一致性**：`ModelContentVideo` ↔ `ContentPayload.ThumbKey` ↔ `ClientContent` video ↔ `MessageContentVideo`（Go）字段名逐字对齐（key/thumb_key/name/size/duration/width/height）；`MediaItemView` 响应键与 `MediaItemDTO` 映射一致；`VideoPayload` 与 `parseVideoContent` 字段一致；`setVoiceRate`/`getVoiceRate` 命名在 Task 8 内一致。
