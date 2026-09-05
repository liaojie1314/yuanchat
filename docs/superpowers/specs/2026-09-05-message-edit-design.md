# 设计文档：消息编辑 + 生产对象存储对外端点（批次 K1）

> 日期：2026-09-05
> 批次：**K1 主功能**（消息编辑：就地编辑 + 「已编辑」角标 + 完整编辑历史），附带四项债收口 ——
> 🔴 生产 MinIO 对外端点、🟡 mock 媒体播放失败、扫码登录 `canceled` 终态、`packages/shared` 与 `packages/ui` 补 tsconfig
> 迁移号：**017**（`messages` 加两列 + 新建 `message_edits` 表）
> 单一真源：本 spec 依据 `docs/MASTER_PLAN.md` 未做清单（§8 K 泳道表 K1、§1 A8 留债表、§2.6 K7 债表）

### 分支与基线

| 项       | 值                                                        |
| -------- | --------------------------------------------------------- |
| 基线     | **`dev`**（当前 HEAD `3985bfc`）                          |
| 工作分支 | `feature/message-edit`，自 dev 切出                       |
| 收口     | 完成后 `--no-ff` 合回 `dev`（保留独立 commit，禁 squash） |

### 全局约束（沿用项目既定规范，不逐条重述）

- GitFlow：禁直提 dev/main；feature→dev 必须 `--no-ff`；commit 用 Conventional Commits、不带版本号前缀、完成完整工作再提交
- 三端复用：Web（`apps/web`）/ Desktop（`apps/desktop`）/ Mobile（Tauri Android），共享代码放 `packages/ui`、`packages/shared`
- i18n：所有用户可见文案走 `react-i18next`，四语（zh-CN/en-US/ja-JP/ko-KR）同步，`node scripts/check-i18n.mjs` 门禁；插值用 `%{var}`（Rails 风格）而非 `{{var}}`
- 浏览器兼容：`build.target=es2019`，不用 `?.`/`??` 等 ES2020+ 语法及未在 Chrome 74+ WebView 验证过的 Web API
- 测试门禁：单元/集成/E2E 通过才算完成；推送远端 dev 前本地 CI 全绿（含 `LANG=C.UTF-8 pnpm test` 对齐 runner locale）
- MSW：前端 API 调用须有 Mock 覆盖正常/空/错误/加载四态
- 骨架屏：图片固定宽高 + 列表加载骨架，CLS 为 0
- 注释：导出组件/函数/Store 写 JSDoc，Go 导出函数写 godoc；注释只用中文，不写进度/批次
- 设计语言：北欧简约，圆角 ≤ `rounded-lg`，参照 `docs/design/DESIGN_LANGUAGE.md`

---

## 一、背景与目标

### 1.1 K1 的真实起点：资产已备，链路未通

测绘查明本仓**已经写好了编辑功能的三处显示资产**，但没有任何生产链路会触发它们：

| 位置                                            | 既存内容                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| `packages/ui/src/MessageBubble.tsx:688`         | `{msg.edited && <span className="opacity-65">· {t("chat.message.edited")}</span>}` |
| `packages/shared/src/store/messageStore.ts:148` | `edited?: boolean` 字段声明                                                        |
| 四份 locale `:326`                              | `chat.message.edited`（"已编辑" / "Edited" / "編集済み" / "편집됨"）               |
| `packages/shared/src/mocks/demoData.ts:177`     | `edited: true` 的 demo 样本                                                        |

后端不下发该字段、`mapMessage` 不映射、WS 帧无此字段。**这意味着有人可能误以为该功能已实现** —— 本批的实质是把链路接通，不是从零建 UI。

### 1.2 现有「重新编辑」不是编辑

`ChatWindow.tsx:459-469` 的「重新编辑」是**撤回后把原文回填输入框、重新发一条新消息**（新 id、新 seq、新时间）。对方看到的是「撤回了一条消息」+ 一条新消息，上下文断裂。这是撤回体验的半残状态，K1 补完它。

### 1.3 目标

交付「文本消息就地编辑（5 分钟窗口）+ 已编辑角标 + 完整编辑历史（用户与 admin 均可查）+ `message.edited` WS 帧 + 服务端→客户端帧的 golden 契约骨架」，并收口四项已登记债务。

**规模判定**：1 次迁移（加两列 + 一张表）+ 2 个新端点 + 1 个新 WS 帧 + 前端编辑态与历史弹层 + 4 项债。规模 M（4-5 天），比原 K 泳道表估的 M 略重 —— 因为「存完整编辑历史」的裁决引入了新表、历史端点与历史弹层。

---

## 二、后端设计

### 2.1 可编辑范围（硬闸门）

**只有 `MessageTypeText(1)` 可编辑。** 每类拒绝都有仓库层面的具体理由，不是保守起见：

| 类型                        | 拒绝理由                                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| image/file/voice/video(2-5) | 本仓 content 结构**根本没有 caption 字段**（`model/message.go:60-95`），没有可编辑的文字。且 `content->>'key'` 是对象授权与 GC 的唯一凭据（`object_acl_repo.go:53,107,109`），改 key 会让旧对象立刻失授权并在宽限期后被 GC 当孤儿删掉 |
| system(6)                   | 非用户产出内容                                                                                                                                                                                                                        |
| E2EE(7)                     | 服务端只存密文、拿不到明文；客户端重新加密会污染当前双棘轮状态 —— 与 `ErrForwardEncrypted`（`message_service.go:44-50`）完全同型的问题                                                                                                |
| sticker(8)                  | 无文字内容                                                                                                                                                                                                                            |

另需同时满足：

- **本人发送**（`msg.SenderID == userID`），否则 403
- **`status = MessageStatusNormal`**（已撤回的不能编辑）
- **`time.Since(msg.CreatedAt) <= EditWindow`**，`EditWindow = 5 * time.Minute`
- **`edit_count < MaxEditCount`**，`MaxEditCount = 20`
- **新文本非空、且与当前文本不同**

「与原文相同直接拒绝」是有意设计：不产生历史版本、不推帧、不写库，避免用户反复保存刷出一串无意义版本。

### 2.2 迁移 017

`server/internal/database/migrations/017_message_edit.sql`，沿用 016 的写法惯例（Up/Down 成对、`StatementBegin/End` 包裹、全部 `IF [NOT] EXISTS` 幂等）：

```sql
-- +goose Up
-- +goose StatementBegin
-- 消息编辑：edited_at 非空即「已编辑」（前端角标判据），edit_count 冗余计数
-- 让「列历史前先知道有几版」不必 JOIN message_edits。
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at  TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edit_count SMALLINT NOT NULL DEFAULT 0;

-- 编辑历史：只存被替换掉的旧版本，当前版本始终在 messages.content。
-- version 从 1 起（1 = 最初发出的那一版），故 messages.edit_count = COUNT(message_edits)。
CREATE TABLE IF NOT EXISTS message_edits (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id  UUID        NOT NULL,
    old_content JSONB       NOT NULL,
    version     SMALLINT    NOT NULL,
    edited_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_message_edits_msg_ver ON message_edits(message_id, version);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS message_edits;
ALTER TABLE messages DROP COLUMN IF EXISTS edit_count;
ALTER TABLE messages DROP COLUMN IF EXISTS edited_at;
-- +goose StatementEnd
```

`message_edits` **不加外键**到 `messages`：本仓消息是软删（`deleted_at`），硬外键在 admin 硬删场景会打架，且既有表（`favorites`、`flagged_ugc`）也都是裸 UUID 引用 —— 沿用既有姿态。`(message_id, version)` 唯一索引同时防并发编辑写出重复版本号。

`model/message.go` 的 `Message` struct 加两个字段：

```go
EditedAt  *time.Time `json:"edited_at,omitempty"`
EditCount int16      `gorm:"not null;default:0" json:"edit_count"`
```

新增 `model/message_edit.go` 承载 `MessageEdit` 模型 + `TableName()`。

### 2.3 全文检索索引：零动作（已核实）

`idx_messages_text_trgm`（`003_message_search_index.sql:5-7`）是**表达式索引 + partial index**：

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_text_trgm
    ON messages USING gin ((content->>'text') gin_trgm_ops)
    WHERE deleted_at IS NULL AND status = 1;
```

`UPDATE messages SET content = ...` 时 Postgres 自动重算 `content->>'text'` 并维护 GIN 条目。partial 谓词含 `status = 1`，而编辑**不改 status**，故记录始终在索引内。**无需 REINDEX、无需额外迁移、无需应用层动作。** 编辑后立即可按新文本搜到、旧文本搜不到。

### 2.4 审核绕过洞（必修，否则 K1 自带后门）

`message_service.go:221-231` 是敏感词打标的**唯一调用点**，位于 `SendContent` 内部，条件是 `s.moderation != nil && messageType == model.MessageTypeText`。

**不补重审，「先发干净文本 → 编辑成敏感词」可完全绕过内容审核。** 且与 admin 侧形成完整绕过链：admin 消息检索是实时读 `content->>'text'`（`admin_repo.go:113`），编辑掉敏感词即从审核检索里消失。

修法：把 :221-231 抽成私有方法

```go
// flagIfHit 命中敏感词则打标 flagged，不阻塞写入（同既有「打标不拦截」范式）。
// 发送与编辑两条路径共用，否则编辑会成为审核绕过通道。
func (s *MessageService) flagIfHit(msg *model.Message, messageType int16, text string) { ... }
```

`SendContent` 与 `Edit` 两处调用。编辑命中时置 `flagged = true` 并 `logger.Info` 留痕（不阻塞编辑，与既有打标范式一致）。**编辑成干净文本时不清除既有 flagged** —— 清标是 admin 的动作（`admin_service.go:217-229`），用户不能自助洗白。

### 2.5 Service 层

`message_service.go` 新增常量与错误：

```go
// EditWindow 消息可编辑的时间窗口（自发送起 5 分钟）。
// 取值与既有「撤回后重新编辑」窗口（前端 RE_EDIT_WINDOW_MS）一致，
// 不与 RecallWindow（2 分钟）对齐 —— 编辑不改变「对方已看到过什么」的事实，
// 危害面小于撤回，可以给更宽的窗口。
const EditWindow = 5 * time.Minute

// MaxEditCount 单条消息累计可编辑次数上限（防滥用软护栏）。
const MaxEditCount = 20

var (
	ErrEditWindowExpired = errors.New("edit window expired")
	ErrEditLimitExceeded = errors.New("edit limit exceeded")
	ErrNotEditable       = errors.New("message type not editable")
	ErrEditNoChange      = errors.New("text unchanged")
)
```

`EditResult` 供 handler 构造推送（照 `RecallResult:69-74` 的形状）：

```go
type EditResult struct {
	Message   *model.Message
	Text      string
	MemberIDs []uuid.UUID
}
```

`Edit(ctx, userID, messageID uuid.UUID, text string) (*EditResult, error)` 流程：

1. `msgRepo.FindByID` → nil → `ErrMessageNotFound`
2. `msg.SenderID != userID` → `ErrNotSender`
3. `msg.MessageType != MessageTypeText` → `ErrNotEditable`
4. `msg.Status != MessageStatusNormal` → `ErrNotEditable`
5. `time.Since(msg.CreatedAt) > EditWindow` → `ErrEditWindowExpired`
6. `msg.EditCount >= MaxEditCount` → `ErrEditLimitExceeded`
7. 反序列化旧 content 取 `text`；与新文本相同 → `ErrEditNoChange`
8. `flagIfHit` 判定新文本
9. `msgRepo.EditWithHistory`（**单事务**，见 2.6）
10. `convRepo.GetMemberIDs` 取收件人，返回 `EditResult`

`EditHistory(ctx, userID, messageID) ([]EditVersion, error)`：成员校验 + `cleared_before_seq` 水位校验（与 `GetHistory` 完全一致的可见性口径，不另立），返回升序版本列表，**最后一项是当前版本**（从 `messages` 拼出，不存进 `message_edits`）。

`EditHistoryForAdmin(ctx, messageID)` 跳过成员校验，供 admin 取证复用同一投影。

### 2.6 Repository 层

`message_repo.go` 新增：

```go
// EditWithHistory 在单事务内：把旧 content 写入 message_edits（version = edit_count+1），
// 再 CAS 更新 messages 的 content / edited_at / edit_count / flagged。
//
// CAS 条件带 edit_count：并发双写时只有一方成功，另一方 RowsAffected=0 返回 false，
// 避免两次编辑抢到同一 version 号（唯一索引亦会兜底）。
func (r *MessageRepository) EditWithHistory(
	ctx context.Context, id uuid.UUID, oldContent, newContent string,
	expectCount int16, flagged bool, editedAt time.Time,
) (bool, error)
```

事务内两步：`INSERT INTO message_edits` → `UPDATE messages ... WHERE id = ? AND status = 1 AND edit_count = ?`。CAS 失败则整事务回滚，历史表不留脏版本。

```go
// ListEdits 取一条消息的全部历史版本，按 version 升序。
func (r *MessageRepository) ListEdits(ctx context.Context, messageID uuid.UUID) ([]model.MessageEdit, error)
```

`ListBefore`（:63）与 `GetLastMessage` 的投影 `MessageWithSender` 加 `EditedAt`/`EditCount` 两列，让历史消息带上「已编辑」信息。

### 2.7 REST 端点

#### 端点 1：编辑

```
PATCH /api/v1/messages/:id     body: {"text": "新正文"}
```

用 `PATCH` 而非 `POST /edit`：语义是部分更新既有资源，且前端 `client.ts:109-127` 已有 `apiPatch` 可直接用。注册在 `router.go:288`（`recall` 那行）相邻位置，同 chat 组、同鉴权中间件链。

响应 **200 + 信封**（沿用 recall 的 `Success(c, gin.H{...})` 口径，`handler/message.go:177`，**不是 204**）：

```json
{ "code": 0, "message": "ok", "data": { "edited_at": "2026-09-05T10:00:00Z", "edit_count": 1 } }
```

错误映射（前端按 code 而非 message 识别，沿用 `sticker_pack.go:31-33` 的惯例）：

| 情况                  | HTTP | 业务码   | 说明                                       |
| --------------------- | ---- | -------- | ------------------------------------------ |
| 消息不存在            | 404  | 404      | 同 recall                                  |
| 非发送者              | 403  | 403      | 同 recall                                  |
| 超 5 分钟窗口         | 403  | **4032** | 紧邻 recall 的 4031（4031 = 撤回窗口过期） |
| 编辑次数超 20         | 400  | **4033** | 新增业务码                                 |
| 类型不可编辑 / 已撤回 | 400  | 4004     | 新增业务码（现用 4000-4003）               |
| 文本为空 / 与原文相同 | 400  | 4004     | 同上，幂等无操作也归此类                   |

业务码 4032/4033/4004 均为本批新增，与既有 4000/4001/4002/4003/4030/4031/40301 无冲突（已核对全量 handler）。

#### 端点 2：编辑历史

```
GET /api/v1/messages/:id/edits
```

会话成员鉴权 + `cleared_before_seq` 水位（与 `GetHistory` 同口径）。响应：

```json
{
  "code": 0,
  "data": {
    "versions": [
      { "version": 1, "text": "原始文本", "edited_at": "..." },
      { "version": 2, "text": "当前文本", "edited_at": "...", "current": true }
    ]
  }
}
```

版本升序，最后一项 `current: true`。admin 侧新增 `GET /api/v1/admin/messages/:id/edits` 走 `role=admin` 校验、复用 `EditHistoryForAdmin`，并写审计日志（取证动作应留痕）。

### 2.8 WS 帧 `message.edited`

`ws/protocol.go:29-45` 常量区加 `TypeMessageEdited = "message.edited"`，payload 照 `MessageRecalledPayload:107-114` 的形状：

```go
// MessageEditedPayload 消息编辑推送，推给会话全部成员（含操作者自己，实现多端同步）。
//
// 带上编辑后正文而非只给 message_id：省掉收件人一次回查往返，与 message.receive
// 直接下发内容的既有做法一致。E2EE 消息永不进这条路径（Edit 入口已拒）。
type MessageEditedPayload struct {
	MessageID      uuid.UUID `json:"message_id"`
	ConversationID uuid.UUID `json:"conversation_id"`
	Seq            int64     `json:"seq"`
	Text           string    `json:"text"`
	EditedAt       time.Time `json:"edited_at"`
	EditCount      int16     `json:"edit_count"`
}
```

Handler 广播照 `Recall:164-175`：`ws.Encode` → `dispatcher.SendToUsers(result.MemberIDs, frame)`，encode 失败只 `logger.Error` 不影响 HTTP 200。

### 2.9 golden 契约：新建服务端帧骨架

测绘查明现有 `contracts/message-send.golden.json` 的骨架**强绑客户端→服务端方向**：Go 侧 `golden_contract_test.go:61` 用 `DisallowUnknownFields` 反序列化进 `SendPayload` 再跑 `buildContent`；`TestGoldenCoversEveryContentType:112` 与前端 `messageSendGolden.test.ts:226-237` 都是硬编码期望列表。`message.recalled` 这类服务端→客户端帧**从来没有 golden 契约**，只靠 `chatSocket.ts:140-146` 的 TS 类型与 Go struct 手工对照。

所以**新建** `contracts/server-frames.golden.json`（不改动现有 message-send 契约的两处硬编码列表），本批覆盖两帧：

- `message.edited`（本批新增）
- `message.recalled`（顺手补上既有空白 —— 同族帧一起钉住才有意义）

结构沿用 message-send 的组织（顶层 `$comment` 字符串数组 + `cases[]`），每 case 给 `name` / `frame{type, payload}`。Go 侧新建 `ws/golden_server_frames_test.go`：按 `frame.type` 分派到对应 payload struct，`DisallowUnknownFields` 反序列化通过即证明「服务端 struct 能完整表达契约、且没有契约未声明的字段」。前端新建 `packages/shared/src/__tests__/serverFramesGolden.test.ts`：喂进 `chatSocket` 的 handler 表，断言 store 状态按预期变化。

---

## 三、前端设计

### 3.1 共享契约（`packages/shared`）

`store/messageStore.ts`：

- `ChatMessage` 加 `editCount?: number`（`edited?: boolean` 已存在于 :148）
- `MessageState` 加 action 声明与实现：

```ts
/**
 * 就地替换一条消息的正文（服务端 message.edited 帧驱动）。
 *
 * @remarks 不做乐观翻转 —— 与 applyRecall 同姿态：本端保存后也等帧回来才更新，
 *   保证多端与收件人看到的时序一致。未命中的 id 原样返回，不产生新引用。
 */
applyEdited: (convId: string, messageId: string, text: string, editCount: number) => void;
```

实现照 `applyRecall:799-818` 的形状（`list.some` 未命中即 `return s`）。

- `EDIT_WINDOW_MS`：**复用既有 `RE_EDIT_WINDOW_MS`（:289，值 5 分钟）**，不新造常量。编辑态本身用 `editingMessageId` 局部 state（在 `ChatWindow`），不进全局 store —— 与 K7 相册的 M5 裁决同理，临时交互态无跨会话共享需求。

`ws/chatSocket.ts`：`ServerFrames` 加 `"message.edited"` 条目（:140-146 的 `message.recalled` 旁）。

`hooks/useChatBootstrap.ts`：加 handler，照 `"message.recalled":278-292`：

```ts
"message.edited": (p) => {
  applyEdited(p.conversation_id, p.message_id, p.text, p.edit_count);
  // 编辑最后一条时会话列表预览必须同步，否则实时下预览停在旧文本
  const conv = useConversationStore.getState().conversations.find((c) => c.id === p.conversation_id);
  if (conv && conv.lastSeq === p.seq) updateConversation(p.conversation_id, { lastMessage: p.text });
},
```

`api/chat.ts` 加两个函数（字符串拼接、`@throws` 标业务码，沿用该文件惯例）：

```ts
export async function editMessage(messageId: string, text: string): Promise<EditAck>;
export async function fetchMessageEdits(messageId: string): Promise<EditVersion[]>;
```

`mapMessage`（`api/chat.ts:~418`）补映射 `edited` / `editCount`，让 REST 历史路径也带上角标信息 —— 否则刷新后角标消失。

### 3.2 就地编辑交互（复用 Composer，不在气泡内嵌）

**裁决 N1：编辑态复用底部 `Composer`，不在气泡内嵌 textarea。**

理由：`ChatWindow.tsx:115` 用 `useVirtualizer` 做虚拟滚动，气泡内嵌 textarea 会让行高在输入过程中突变，必须持续 `measureElement` 重算，长文本编辑时列表会跳动；移动端还要与软键盘顶起（`--app-height` 原生联动）二次搏斗。复用 Composer 完全绕开这两个问题，且「编辑时输入区在原地」符合用户对输入框位置的既有肌肉记忆。

交互流：

1. 菜单点「编辑」→ `ChatWindow` 置 `editingMessageId`，通过既有 `composerInsert` 通道把原文填进输入框（`Composer.tsx:132-138` 已实现消费 + 聚焦 + 清空）
2. Composer 上方出现「正在编辑」提示条（含原文摘要 + 取消按钮），发送按钮语义变「保存」
3. Esc 键或点取消 → 退出编辑态、清空输入框；移动端需注册返回键拦截器
4. 保存 → `editMessage()` → **不做乐观翻转**，等 `message.edited` 帧到达再更新气泡（与 `recallMessage` 的既有约定一致，见 `api/chat.ts:619-628` 的 `@remarks`）
5. 窗口过期（4032）/ 次数超限（4033）→ toast 对应文案，退出编辑态

被编辑的气泡在编辑态期间加视觉标记（轻微高亮描边），让用户明确「正在改哪一条」。

### 3.3 菜单项与闸门集中

`utils/messageActions.ts` 加 `canEdit(msg, nowMs)`。该文件头 :1-15 的注释明确要求闸门集中（此前在 ChatWindow 手抄 5 遍、`onReply` 漏抄过），故不在组件里散写条件：

```ts
/**
 * 能否编辑：仅本人发出的、服务端已确认的、未撤回的纯文本，且在 5 分钟窗口内。
 *
 * @remarks 含 Date.now() 比较，结果随时间变化，故只能在事件回调里求值，
 *   不能在 render 期缓存（同 MessageBubble 的 recallStillOpen）。
 */
export function canEdit(msg: ChatMessage, nowMs: number): boolean {
  return (
    isServerConfirmed(msg) &&
    !!msg.isSelf &&
    msg.kind === "text" &&
    nowMs - (msg.createdAtMs || 0) <= RE_EDIT_WINDOW_MS
  );
}
```

`isServerConfirmed`（:31-33）已含 `!msg.recalled && kind !== "system" && !!msg.seq`。

`MessageBubble.tsx` 菜单项注册区（:~570-641）插入「编辑」项，位置在**「引用」之后、「转发」之前**（编辑与引用同属"针对这条消息本身"的动作，转发与收藏是"把它送到别处"）。同时 `hasMenuItem`（:174-181）的判定要纳入编辑，否则只有编辑一项可用时菜单不弹。

`ChatWindow.tsx:437-520` 加 `onEdit` prop 闸门，照 `onRecall:452-458` / `onReEdit:459-469` 的三元表达式形状。

### 3.4 「已编辑」角标与历史弹层

`MessageBubble.tsx:688` 现有角标是纯文本 `<span>`，改为：`editCount > 0` 时渲染为可点按钮（`aria-label` 走 i18n），点击回调 `onShowEditHistory(msg.id)`；`editCount` 缺失时退回纯文本（兼容 demo 数据与旧帧）。

新建 `packages/ui/src/MessageEditHistoryDialog.tsx`（三端共用）：

- 复用既有 Dialog 组件（`@radix-ui/react-dialog` 已在 `packages/ui` 依赖里）
- 时间轴列出各版本：版本号、正文、编辑时间；当前版本标注
- 四态：加载骨架 / 正常 / 空（理论上不会空，但错误兜底）/ 错误 + 重试
- 移动端必须 `registerBackInterceptor` 注册返回键拦截器 —— 否则按返回会被当成「已在标签根页面」而触发退出应用（A8 沉淀的注意事项）
- 圆角 ≤ `rounded-lg`

### 3.5 快照定格（裁决 N2）+ 顺手修既有缺陷

**裁决 N2：引用块与收藏项保持编辑前的旧文本，不跟随编辑。**

- 引用：`quote` 是「发送时 UI 快照」（`messageStore.ts:141` 的注释已如此定义），`excerpt` 由 `quoteExcerptOf`（`utils/messagePreview.ts:63-73`）一次性截 40 字
- 收藏：`favorite_service.go:33` 的 godoc 明确写「在服务层建立快照（消息撤回后仍可查看）」，是刻意设计。推翻它等于推翻一个已定语义

**但顺手修掉一个与编辑无关的既有缺陷**：REST 历史路径**根本不产出 `quote`**（`ListBefore` 不 self-join messages，`mapMessage` 不填 quote），导致刷新页面后引用块**整体消失**，`messageStore.ts:141` 注释里说的「惰性拉取」从未实现。修法：`mapMessage` 在本地 store 已有被引用消息时回填 `quote`（纯前端惰性拼装，不改后端投影）。

**必须现在修的理由**：编辑功能上线后，「引用块消失」这个老 bug 会被误当成 K1 引入的回归。

### 3.6 MSW Mock

测绘查明 **`recall` 端点在 MSW 里完全没有 mock**（mock 模式走 `messageStore.ts:265-269` 的 `mockMode` 开关，撤回不发请求也不产生帧）。本批补齐三个端点的四态，沿用 `handlers.ts` 惯例（`apiOk`/`apiError` helper、`?error=1` 触发错误态、`await delay(300)` 让骨架屏可见、handler 上方三行注释块）：

- `PATCH /api/v1/messages/:id` —— 正常回 `{edited_at, edit_count}`；`?error=window` 回 403/4032；`?error=limit` 回 400/4033
- `GET /api/v1/messages/:id/edits` —— 正常回三版本样本；`?error=1` 回 500；带 `delay(300)`
- `POST /api/v1/messages/:id/recall` —— 补上此前缺失的 mock

### 3.7 i18n

四份 locale 插在 revoke 族（`:241`）之后，与既有 `chat.message.*` 命名惯例一致（`<动作>` = 菜单项、`<动作>Expired` = 窗口过期 toast）：

| key                             | zh-CN                  |
| ------------------------------- | ---------------------- |
| `chat.message.edit`             | 编辑                   |
| `chat.message.editing`          | 正在编辑               |
| `chat.message.editCancel`       | 取消编辑               |
| `chat.message.editSave`         | 保存                   |
| `chat.message.editExpired`      | 超过 5 分钟后不能编辑  |
| `chat.message.editLimitReached` | 该消息编辑次数已达上限 |
| `chat.message.editEmpty`        | 内容不能为空           |
| `chat.message.editHistory`      | 编辑记录               |
| `chat.message.editVersion`      | 第 %{n} 版             |
| `chat.message.editCurrent`      | 当前版本               |
| `chat.message.editHistoryError` | 编辑记录加载失败       |

`chat.message.edited`（"已编辑"）四语已存在，不重复添加。

---

## 四、搭车债收口

### 4.1 🔴 生产对象存储不可达（A8 留债）

**根因**：`deploy/docker-compose.prod.yml:91` 的 `YUANCHAT_MINIO_ENDPOINT: minio:9000` 是 compose 内网主机名，而 `PublicURL`（`storage/minio.go:142-148`）与 `PresignGet/PresignPut` 直接用该值拼 URL 下发给客户端 → 浏览器/客户端无法解析 `minio` 这个主机名 → **生产环境头像、图片、语音、视频、贴纸封面全部拿不到**。

**修法**：

1. `config.MinIOConfig` 新增 `PublicEndpoint string`（`mapstructure:"public_endpoint"`，env `YUANCHAT_MINIO_PUBLIC_ENDPOINT`）。**与 `Endpoint` 严格分开**：后者是 SDK 建连地址（内网），前者是下发给客户端的对外地址。空值时回落到 `Endpoint` —— 保证 dev 环境行为零变化。
2. `Storage` 持有 `publicEndpoint` 与 `publicUseSSL`；新增私有方法 `rewriteHost(rawURL string) string` 把生成好的 URL 的 scheme+host 换成对外端点。`PublicURL` 直接用对外端点拼；`PresignGet`/`PresignPut` 在 minio-go 生成签名 URL **之后**改写 host。
   - **签名安全性**：MinIO 预签名用 AWS SigV4，签名覆盖 `host` header。因此对外域名必须由 nginx 反代到 MinIO 并**透传原 Host**，或 MinIO 侧配 `MINIO_SERVER_URL` 与对外域名一致（prod compose :57 已有 `MINIO_SERVER_URL: https://${DOMAIN_API}/s3`，本批改为指向新的存储子域，保持两者一致）。这一点在 spec 里显式记录，因为改错会导致签名校验失败而非静默降级。
3. `deploy/nginx/nginx.conf.template` 新增 `${DOMAIN_STORAGE}` server 块：443 + TLS + `proxy_pass http://minio:9000`，`client_max_body_size` 放大到 100m（预签名直传要过它），`proxy_set_header Host $host` 保持签名一致。80 端口的 `server_name`（:15）加上该域名以支持 ACME。
4. `docker-compose.prod.yml` 补 `YUANCHAT_MINIO_PUBLIC_ENDPOINT: ${DOMAIN_STORAGE}` + `YUANCHAT_MINIO_PUBLIC_USE_SSL: "true"`；`MINIO_SERVER_URL` 改为 `https://${DOMAIN_STORAGE}`。
5. `deploy/env.md` 补新变量说明；`install.sh` 的域名清单加 `DOMAIN_STORAGE` —— **共 5 处**（:42 必填校验、:72 export、:73 envsubst 白名单、:87 certbot 域名列表、:99 证书循环），漏掉 :73 会让 nginx 模板里的 `${DOMAIN_STORAGE}` 原样留在生成的配置里。
6. 桌面端 CSP（`apps/desktop/src-tauri/tauri.conf.json`）的 `img-src` / `media-src` / `connect-src` 加该域名占位说明 —— A8 刻意只列真实可达主机、不用 `https:` 通配掩盖，本批延续这一姿态：在配置注释里写明生产部署需替换的域名。

**诚实边界（必须写进交付报告）**：本地无真实生产环境（无域名、无证书、无公网 MinIO），本项**只能做到配置层改动 + Go 单测**（验证 host 改写正确、空值回落、scheme 按 `publicUseSSL` 切换、签名 query 参数未被破坏）。**真机/真生产无法验证**，不谎称已验证。

### 4.2 🟡 mock 模式媒体播放失败（K7 留债）

`handlers.ts:760-763` 的 `/files/download-url` 对**任何** key 都回 `stickerDataUrl()`（内联 SVG），语音/视频拿到 SVG 自然播放失败并 toast。修法：按 key 后缀分派 —— 音频（`.webm`/`.mp3`/`.m4a`）回一段极小的静音 WAV data URL，视频（`.mp4`/`.webm` 视频）回一个最小可解码的视频 data URL 或保持 SVG 但让调用方降级为「演示不可播」而非报错，图片/贴纸仍回 SVG。选定后在 mock 注释里写明「data URL 仅为演示可播，非真实媒体」。

### 4.3 扫码登录 `canceled` 终态（A8 留债）

`qr_login_service.go:26-30` 状态机加 `QRCanceled QRStatus = "canceled"`。新增 `POST /api/v1/auth/qr/:token/cancel`（需 Bearer，即已扫码的手机端才能取消；状态须为 `scanned`，用 Lua 原子迁移，与既有 `scan`/`confirm` 同姿态）。轮询端拿到 `canceled` 即停止轮询、显示「已在手机上取消」并提供「重新生成二维码」。手机端确认页加「取消」按钮 + 返回键拦截（返回即取消）。i18n 四语补对应文案。

### 4.4 `packages/shared` 与 `packages/ui` 补 tsconfig（A8 留债）

两包 `package.json` 都声明了 `"typecheck": "tsc --noEmit"`（`shared:26`、`ui:20`）却无 `tsconfig.json`，脚本一直跑不了 —— 即这两个包**从未被单独类型检查**（靠两端 app 的 tsc 传递覆盖到源码）。

补 `tsconfig.json`：继承仓库既有 app 侧配置的 compilerOptions 口径（`target: es2019` 对齐 build.target、`strict`、`jsx: react-jsx`、`moduleResolution: bundler`、`noEmit`），`include: ["src"]`。接进 `turbo.json` 的 typecheck 任务与 CI。

**已知风险**：补上后可能暴露此前从未被单独检查的类型错误（尤其 `packages/ui` 的 `exports: {"./*": "./src/*.tsx"}` 通配导出）。暴露的错误一并修掉；若发现需要大范围改动的问题，就地记债而非扩大本批范围。**本项与 K1 高度相关** —— K1 的前端主战场正是这两个包。

---

## 五、测试计划

### 5.1 后端（Go）

`service/message_edit_test.go`（用 `internal/testutil.NewDB` 独立库 + 用例级事务回滚）：

| 用例                                                | 断言                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------ |
| 正常编辑                                            | content 更新、`edited_at` 非空、`edit_count=1`、`message_edits` 一条 version=1 |
| 连续编辑两次                                        | version 1/2 齐全、`edit_count=2`、当前 content 是第三版                        |
| 非发送者编辑                                        | `ErrNotSender`                                                                 |
| 超 5 分钟窗口                                       | `ErrEditWindowExpired`                                                         |
| `edit_count` 已达 20                                | `ErrEditLimitExceeded`                                                         |
| 编辑 image/file/voice/video/sticker/system/**E2EE** | 逐类型 `ErrNotEditable`                                                        |
| 编辑已撤回消息                                      | `ErrNotEditable`                                                               |
| 新文本与原文相同                                    | `ErrEditNoChange`，且**不写历史、不改 edit_count**                             |
| 空文本                                              | 拒绝                                                                           |
| **编辑成敏感词 → `flagged=true`**                   | 审核绕过回归测试（本批最关键的一条）                                           |
| 编辑成干净文本                                      | 既有 `flagged` **不被清除**                                                    |
| 并发双写同一消息                                    | 只有一方成功，历史表无重复 version                                             |
| 历史端点：非成员                                    | 403                                                                            |
| 历史端点：`cleared_before_seq` 水位以下             | 不可见                                                                         |
| 编辑后全文检索                                      | 新文本可搜到、旧文本搜不到（验证表达式索引自动跟随）                           |

`handler/message_edit_test.go`：五类错误的 HTTP 状态 + 业务码逐一断言（404 / 403+403 / 403+4032 / 400+4033 / 400+4004）。

`ws/golden_server_frames_test.go`：新 golden 文件双帧反序列化 + `DisallowUnknownFields`。

`storage/public_endpoint_test.go`：host 改写、空值回落、scheme 切换、签名 query 完整性。

`service/qr_login_cancel_test.go`：`scanned → canceled` 成功、`pending → canceled` 拒绝、canceled 后 poll 返回终态。

### 5.2 前端（Vitest）

- `messageStore` 的 `applyEdited`：命中更新 / 未命中原样返回（引用相等）/ `editCount` 递增
- `messageActions.canEdit` 闸门矩阵：非本人 / 非文本 / 已撤回 / 无 seq / 超窗 各自为 false
- `MessageBubble`：`edited && editCount>0` 渲染可点角标、`edited` 无 count 渲染纯文本
- `MessageEditHistoryDialog` 四态渲染
- `serverFramesGolden.test.ts`：golden 帧喂进 handler 表后 store 状态符合预期
- MSW 四态（正常/错误 4032/错误 4033/延迟）

### 5.3 E2E（Playwright，mock 模式 + 真后端各一轮）

新建 `apps/web/e2e/message-edit.spec.ts`，照 `media.spec.ts` 骨架（文件头 JSDoc 说明前提、模块级 helper、不用 POM、`setAuth` → `waitForMSW`）：

1. 右键自己的文本消息 → 菜单有「编辑」→ 点击 → Composer 进入编辑态（提示条可见、原文已填充）
2. 改文本 → 保存 → 气泡正文更新 + 「已编辑」角标出现
3. 点角标 → 历史弹层列出两版本，当前版本有标注
4. 取消编辑 → 输入框清空、提示条消失
5. 右键对方消息 / 图片消息 → 菜单**无**「编辑」项

需给气泡菜单项与角标补 `data-testid`（现有只有 `data-kind` / `data-msg-id`，菜单项只能靠中文文案定位）。

### 5.4 真机（递送前必过）

| 端             | 覆盖                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| Web（真后端）  | 编辑全链路、`message.edited` 帧双端同步（两个浏览器上下文）、历史弹层、窗口过期 4032 toast、暗亮双主题、移动视口 |
| 桌面 Tauri     | 编辑与历史弹层渲染、CSP 无拦截日志                                                                               |
| Android 模拟器 | 长按菜单出「编辑」、软键盘顶起时 Composer 编辑态可用、历史弹层返回键关闭而非退出应用、扫码取消按钮与返回键       |

**合并前门禁**：本地 CI 全绿 —— `node scripts/check-i18n.mjs`、`pnpm format:check`、`pnpm lint`、`pnpm lint:style`、`pnpm check:theme`、`LANG=C.UTF-8 pnpm test`、`apps/web` 与 `apps/desktop` 各自 `npx tsc --noEmit`、**新增的 shared/ui typecheck**、`pnpm --filter @yuanchat/web test:e2e`、`go vet ./...`、`go test ./...`、`go test -race ./internal/ws/`。全绿后 `--no-ff` 合回 dev。

---

## 六、关键裁决（本批已定，不再重开）

| 编号 | 裁决                                                                  | 理由                                                                                                                                        |
| ---- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| N1   | 编辑态**复用底部 Composer**，不在气泡内嵌 textarea                    | 气泡内嵌会与 `useVirtualizer`（`ChatWindow.tsx:115`）的行高测量打架，长文本编辑时列表跳动；移动端还要与软键盘顶起二次搏斗                   |
| N2   | 引用块与收藏项**快照定格**，不跟随编辑                                | `quote` 的定义本就是「发送时 UI 快照」（`messageStore.ts:141`）；收藏快照是 `favorite_service.go:33` 明写的刻意设计。跟随需推翻两个已定语义 |
| N3   | 编辑窗口 **5 分钟**，与 `RecallWindow`（2 分钟）**不对齐**            | 编辑不改变「对方已看到过什么」，危害面小于撤回；且 5 分钟是仓内既有先例（`RE_EDIT_WINDOW_MS`），非凭空造数                                  |
| N4   | 可编辑范围**仅 `MessageTypeText`**                                    | 媒体 content 无 caption 字段可编辑、改 key 会破坏对象授权与 GC；E2EE 服务端无明文且重加密污染棘轮；system 非用户产出                        |
| N5   | 存**完整编辑历史**（新表 `message_edits`），用户与 admin 均可查       | 用户裁决。取证与透明性兼顾，对齐 Telegram/Discord 口径                                                                                      |
| N6   | 「新文本与原文相同」**直接拒绝**（400/4004），不写历史不推帧          | 否则反复保存会刷出一串无意义版本                                                                                                            |
| N7   | 编辑命中敏感词**打标不阻塞**；编辑成干净文本**不清除**既有 flagged    | 打标不拦截是既有范式（`message_service.go:221-231`）；清标是 admin 动作，用户不能自助洗白                                                   |
| N8   | 服务端→客户端帧的 golden **新建独立文件**，不改现有 message-send 契约 | 现有骨架强绑 `SendPayload`/`buildContent` 与两处硬编码列表，硬塞 S→C 帧要改断言骨架，风险大于收益                                           |
| N9   | 编辑不做**乐观翻转**，统一等 `message.edited` 帧                      | 与 `recallMessage` 的既有约定一致（`api/chat.ts:619-628`），保证多端与收件人时序一致                                                        |
| N10  | 生产对象存储对外端点**只交付配置层 + 单测**，不谎称真机验证           | 本地无域名/证书/公网 MinIO，无法真实验证                                                                                                    |

---

## 七、明确不做（记债，本批结束后登记进 MASTER_PLAN 未做清单）

- **媒体消息 caption 编辑**：本仓 `MessageContentImage/File/Video` 无 caption 字段，需先做「带文字说明的媒体消息」这个独立功能，届时编辑范围可扩展
- **E2EE 消息编辑**：服务端无明文 + 客户端重加密污染双棘轮状态（与 `ErrForwardEncrypted` 同型）
- **收藏项跟随编辑**：N2 裁决，快照定格
- **编辑不重建已转发副本**：转发是值拷贝（`message_service.go:324` 原样传 `src.Content`），源消息编辑不影响副本 —— 语义正确，非缺陷
- **编辑历史无分页**：上限 20 版，集合天然小
- **编辑不产生系统消息**：不像「群名被改」那样在消息流插一条系统提示，只靠角标
- **admin 侧无「编辑频繁」告警**：`edit_count` 已落库，需要时再做聚合视图
- **`message_edits` 无 GC**：消息硬删时历史表留孤儿行（软删场景不受影响）。量级小，且与 `favorites` 快照的现状同姿态

---

## 八、交付后同步

1. `docs/MASTER_PLAN.md` 未做清单（单一真源）：
   - K 泳道表 **K1** 状态改 ✅（保留条目，标完成日期 2026-09-05）
   - A8 留债表：**🔴 生产对象存储不可达** 改 ✅（注明「仅配置层+单测，无真机验证」）、**⚪ packages/shared 与 packages/ui 无 tsconfig** 改 ✅、**⚪ 扫码会话缺 canceled 终态** 改 ✅
   - K7 债表：**🟡 mock 模式点播 demo 语音 toast 播放失败** 改 ✅
   - 阶段三功能清单：若有「消息编辑」checkbox 则勾选
   - **本批新发现的债当次登记**（§7 全部条目 + 实施中新发现的）
2. `docs/CHAT_API.md`：补 `PATCH /messages/:id`、`GET /messages/:id/edits`、admin 历史端点、`message.edited` 帧、业务码 4032/4033/4004
3. `docs/DB_SCHEMA.md`：补 017 迁移（`messages` 两列 + `message_edits` 表）
4. `docs/deploy/env.md`：补 `YUANCHAT_MINIO_PUBLIC_ENDPOINT` / `YUANCHAT_MINIO_PUBLIC_USE_SSL` / `DOMAIN_STORAGE`
5. `docs/ROADMAP.md`：K 泳道待排项移除 K1
6. `AGENTS.md` 当前状态：消息操作一节补「编辑（5 分钟窗口 + 完整历史）」
7. `docs/DEVELOPMENT.md`：无启动/打包命令变更，不更新（新增的 shared/ui typecheck 走既有 `turbo typecheck`）
