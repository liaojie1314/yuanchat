# 消息编辑（K1）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让文本消息可在发出后 5 分钟内就地编辑，保留完整编辑历史，编辑结果经 `message.edited` WS 帧实时同步到会话全体成员；同时收口四项已登记债务。

**Architecture:** 后端在 `messages` 加 `edited_at`/`edit_count` 两列、新建 `message_edits` 表存旧版本（迁移 017）；`MessageService.Edit` 走七道闸门后由 `MessageRepository.EditWithHistory` 在单事务内写历史 + CAS 更新正文；handler 广播新帧 `message.edited`。前端不做乐观翻转，统一等帧到达再更新气泡；编辑态复用底部 Composer 而非气泡内嵌 textarea（避开虚拟滚动行高重算与移动端软键盘）。

**Tech Stack:** Go 1.25（Gin + GORM + goose + gorilla/websocket）· PostgreSQL 17 · React 19 + TypeScript + Zustand + react-i18next · Vitest · Playwright · MSW

**Spec:** [`docs/superpowers/specs/2026-09-05-message-edit-design.md`](../specs/2026-09-05-message-edit-design.md)

## Global Constraints

以下为 spec §全局约束 与 AGENTS.md 核心约束的逐条抄录，**每个 Task 的要求都隐含包含本节**：

- **GitFlow**：本计划全程在 `feature/message-edit` 分支（已自 dev @ `3985bfc` 切出）。禁直提 `dev`/`main`。完成后 `--no-ff` 合回 dev，**禁 squash**。
- **Commit**：Conventional Commits `<type>(<scope>): <subject>`，**不带版本号前缀**（不写 `feat(v0.4/K1):`）。完成一个完整工作单元再提交，禁逐点提交。
- **i18n**：用户可见文案禁硬编码，走 `react-i18next` 的 `t()`。四语必须同步：`packages/design-system/src/i18n/locales/{zh-CN,en-US,ja-JP,ko-KR}.json`。**插值用 `%{var}`（Rails 风格），不是 `{{var}}`**。`node scripts/check-i18n.mjs` 是 CI 门禁，会挡漏翻/错 key/死键。
- **浏览器兼容**：`build.target=es2019`。**禁用 `?.` 和 `??`**（旧 Android WebView Chrome 74 解析期 SyntaxError → 白屏）。新增 Web API 前确认 Chrome 74+ 支持。
- **UI 圆角**：上限 `rounded-lg`（8px），禁 `rounded-xl`/`rounded-2xl`（`rounded-full` 圆形除外）。
- **注释**：只用中文。导出函数/组件/Store/Hook 必须 JSDoc，Go 导出函数/包必须 godoc。禁在注释里写进度/批次号。
- **MSW**：新增 API 调用须 Mock 覆盖正常/空/错误/加载四态。错误态用 query 参数触发（`?error=1`），加载态用 `await delay(300)`。
- **骨架屏**：列表加载必须骨架屏，图片固定宽高，CLS 为 0。
- **测试门禁**：测试未过 = 功能未完成。本地跑前端测试必须 `LANG=C.UTF-8 pnpm test`（对齐 GitHub runner 的 `en-US` locale；中文机器上 `navigator.language` 报 `zh-CN` 会导致「本地绿、远程红」）。
- **推送前门禁**：推 `dev` 前本地 CI 必须全绿，见 Task 16。
- **命令走 scripts**：启动/打包一律 `pnpm dev:*` / `pnpm build:pkg`，禁手敲底层命令。
- **业务码**：新增 4032（编辑窗口过期）、4033（编辑次数超限）、4004（不可编辑/无变化/空文本）。已占用的是 4000/4001/4002/4003/4030/4031/40301，勿复用。
- **常量**：`EditWindow = 5 * time.Minute`（Go）、复用既有 `RE_EDIT_WINDOW_MS`（TS，`messageStore.ts:289`，值 5 分钟），**不新造前端常量**。`MaxEditCount = 20`。

---

## 文件结构

### 后端新建

| 文件                                                       | 职责                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| `server/internal/database/migrations/017_message_edit.sql` | 迁移：`messages` 加两列 + `message_edits` 表                 |
| `server/internal/model/message_edit.go`                    | `MessageEdit` GORM 模型 + `TableName()`                      |
| `server/internal/service/message_edit.go`                  | `Edit` / `EditHistory` / `EditHistoryForAdmin` / `flagIfHit` |
| `server/internal/service/message_edit_test.go`             | Service 层全部闸门与历史用例                                 |
| `server/internal/handler/message_edit_test.go`             | HTTP 状态 + 业务码断言                                       |
| `server/internal/ws/golden_server_frames_test.go`          | 服务端→客户端帧 golden 断言                                  |
| `server/internal/storage/public_endpoint_test.go`          | 对外端点改写单测                                             |
| `server/internal/service/qr_login_cancel_test.go`          | 扫码 canceled 终态用例                                       |
| `contracts/server-frames.golden.json`                      | 服务端→客户端帧契约（新骨架）                                |

### 后端修改

| 文件                                                 | 改动                                             |
| ---------------------------------------------------- | ------------------------------------------------ |
| `server/internal/model/message.go:12-28`             | `Message` 加 `EditedAt`/`EditCount`              |
| `server/internal/repository/message_repo.go`         | 加 `EditWithHistory` / `ListEdits`               |
| `server/internal/service/message_service.go:221-231` | 审核打标抽成 `flagIfHit` 供两处调用              |
| `server/internal/handler/message.go`                 | 加 `Edit` / `EditHistory` handler                |
| `server/internal/handler/admin.go`                   | 加 admin 历史端点                                |
| `server/internal/ws/protocol.go:29-45,107-114`       | 加 `TypeMessageEdited` + `MessageEditedPayload`  |
| `server/internal/router/router.go:288`               | 注册两条新路由 + admin 路由 + qr cancel          |
| `server/internal/config/config.go:148-154`           | `MinIOConfig` 加 `PublicEndpoint`/`PublicUseSSL` |
| `server/internal/storage/minio.go:142-148`           | `PublicURL`/`PresignGet`/`PresignPut` 走对外端点 |
| `server/internal/service/qr_login_service.go:26-30`  | 加 `QRCanceled` + `CancelQRSession`              |
| `server/internal/handler/qr_login.go`                | 加 cancel handler                                |

### 前端新建

| 文件                                                          | 职责                           |
| ------------------------------------------------------------- | ------------------------------ |
| `packages/ui/src/MessageEditHistoryDialog.tsx`                | 编辑历史弹层（三端共用，四态） |
| `packages/ui/src/__tests__/MessageEditHistoryDialog.test.tsx` | 弹层四态渲染测试               |
| `packages/shared/src/__tests__/messageEdit.test.ts`           | `applyEdited` + `canEdit` 测试 |
| `packages/shared/src/__tests__/serverFramesGolden.test.ts`    | golden 帧前端消费断言          |
| `packages/shared/tsconfig.json`                               | 补 tsconfig（债收口）          |
| `packages/ui/tsconfig.json`                                   | 补 tsconfig（债收口）          |
| `apps/web/e2e/message-edit.spec.ts`                           | E2E                            |

### 前端修改

| 文件                                                            | 改动                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------- |
| `packages/shared/src/store/messageStore.ts:148,163-258,799-818` | 加 `editCount` 字段 + `applyEdited` 声明与实现             |
| `packages/shared/src/utils/messageActions.ts`                   | 加 `canEdit`                                               |
| `packages/shared/src/ws/chatSocket.ts:140-146`                  | `ServerFrames` 加 `message.edited`                         |
| `packages/shared/src/hooks/useChatBootstrap.ts:278-292`         | 加 `message.edited` handler                                |
| `packages/shared/src/api/chat.ts:619-628`                       | 加 `editMessage`/`fetchMessageEdits` + `mapMessage` 补映射 |
| `packages/shared/src/mocks/handlers.ts:758-763`                 | 补三端点 mock + 修 download-url 按后缀分派                 |
| `packages/ui/src/MessageBubble.tsx:174-181,570-641,688`         | 菜单加编辑项 + 角标改可点                                  |
| `packages/ui/src/ChatWindow.tsx:437-520`                        | 编辑态编排 + `onEdit`/`onShowEditHistory` 闸门             |
| `packages/ui/src/Composer.tsx:132-138`                          | 编辑态提示条 + 保存语义                                    |
| 四份 locale                                                     | 新增 11 个 key                                             |
| `deploy/nginx/nginx.conf.template`                              | 加 `${DOMAIN_STORAGE}` server 块                           |
| `deploy/docker-compose.prod.yml:57,91`                          | 加对外端点环境变量                                         |
| `deploy/install.sh:42,72,73,87,99`                              | 域名清单加 `DOMAIN_STORAGE`（**5 处**）                    |
| `docs/deploy/env.md:112`                                        | 补新变量                                                   |
| `turbo.json`                                                    | typecheck 任务纳入 shared/ui                               |

---

## Task 1：迁移 017 + 模型

**Files:**

- Create: `server/internal/database/migrations/017_message_edit.sql`
- Create: `server/internal/model/message_edit.go`
- Modify: `server/internal/model/message.go:12-28`

**Interfaces:**

- Consumes: 无（首个 Task）
- Produces: `model.MessageEdit{ID, MessageID uuid.UUID, OldContent string, Version int16, EditedAt, CreatedAt time.Time}`；`model.Message` 新增字段 `EditedAt *time.Time`、`EditCount int16`

- [ ] **Step 1: 写迁移文件**

创建 `server/internal/database/migrations/017_message_edit.sql`。**注意**：不能用 `CREATE INDEX CONCURRENTLY`（那需要文件首行 `-- +goose NO TRANSACTION`，本迁移含建表故必须在事务内）：

```sql
-- +goose Up
-- +goose StatementBegin
-- 消息编辑：edited_at 非空即「已编辑」（前端角标判据）；
-- edit_count 冗余计数，让「列历史前先知道有几版」不必 JOIN message_edits。
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at  TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edit_count SMALLINT NOT NULL DEFAULT 0;

-- 编辑历史：只存被替换掉的旧版本，当前版本始终在 messages.content。
-- version 从 1 起（1 = 最初发出的那一版），故 messages.edit_count = COUNT(message_edits)。
-- 不加外键到 messages：消息是软删（deleted_at），硬外键在 admin 硬删场景会打架，
-- 且既有 favorites / flagged_ugc 同样是裸 UUID 引用。
CREATE TABLE IF NOT EXISTS message_edits (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id  UUID        NOT NULL,
    old_content JSONB       NOT NULL,
    version     SMALLINT    NOT NULL,
    edited_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 唯一索引兼作并发护栏：并发编辑抢到同一 version 时其中一方插入失败。
CREATE UNIQUE INDEX IF NOT EXISTS idx_message_edits_msg_ver ON message_edits(message_id, version);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS message_edits;
ALTER TABLE messages DROP COLUMN IF EXISTS edit_count;
ALTER TABLE messages DROP COLUMN IF EXISTS edited_at;
-- +goose StatementEnd
```

- [ ] **Step 2: 写模型**

创建 `server/internal/model/message_edit.go`：

```go
package model

import (
	"time"

	"github.com/google/uuid"
)

// MessageEdit 消息编辑历史的一个旧版本。
//
// 只存被替换掉的版本，当前版本始终在 messages.content —— 因此一条编辑过
// N 次的消息有 N 条历史行（version 1..N）与 messages 里的第 N+1 版。
type MessageEdit struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	MessageID  uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_message_edits_msg_ver,priority:1" json:"message_id"`
	OldContent string    `gorm:"type:jsonb;not null" json:"old_content"`
	Version    int16     `gorm:"not null;uniqueIndex:idx_message_edits_msg_ver,priority:2" json:"version"`
	EditedAt   time.Time `json:"edited_at"`
	CreatedAt  time.Time `json:"created_at"`
}

// TableName 指定表名。
func (MessageEdit) TableName() string {
	return "message_edits"
}
```

- [ ] **Step 3: 给 Message 加两个字段**

在 `server/internal/model/message.go` 的 `Message` struct 里，`ClientMsgID` 之后、`CreatedAt` 之前插入：

```go
	// EditedAt 最后一次编辑时间；非 nil 即「已编辑」，前端据此显示角标。
	EditedAt *time.Time `json:"edited_at,omitempty"`
	// EditCount 累计编辑次数，等于 message_edits 中该消息的历史行数。
	EditCount int16 `gorm:"not null;default:0" json:"edit_count"`
```

- [ ] **Step 4: 验证迁移能跑通**

Run: `cd server && go build ./... && go run ./cmd/migrate up`
Expected: 编译通过；迁移输出含 `OK   017_message_edit.sql`

若 dev 数据库未启动，先 `pnpm dev:server`（会拉起 compose 依赖）或单独 `docker compose -f deploy/docker-compose.yml up -d postgres`。

- [ ] **Step 5: 验证回滚可用**

Run: `cd server && go run ./cmd/migrate down && go run ./cmd/migrate up`
Expected: down 删表删列成功，up 重建成功（证明 Down 段正确，未来出问题能退）

- [ ] **Step 6: Commit**

```bash
git add server/internal/database/migrations/017_message_edit.sql \
        server/internal/model/message_edit.go \
        server/internal/model/message.go
git commit -m "feat(message): 迁移 017 增加编辑历史表与 messages 编辑标记列"
```

---

## Task 2：Repository 层 EditWithHistory + ListEdits

**Files:**

- Modify: `server/internal/repository/message_repo.go`（`Recall` 方法 :134-139 之后追加）
- Test: `server/internal/repository/message_edit_repo_test.go`

**Interfaces:**

- Consumes: Task 1 的 `model.MessageEdit`、`model.Message.EditedAt`/`EditCount`
- Produces:
  - `func (r *MessageRepository) EditWithHistory(ctx context.Context, id uuid.UUID, oldContent, newContent string, expectCount int16, flagged bool, editedAt time.Time) (bool, error)`
  - `func (r *MessageRepository) ListEdits(ctx context.Context, messageID uuid.UUID) ([]model.MessageEdit, error)`

- [ ] **Step 1: 写失败测试**

创建 `server/internal/repository/message_edit_repo_test.go`。参考既有 `message_repo_test.go` 的夹具用法（`testutil.NewDB(t)`）：

```go
package repository

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/testutil"
)

// seedEditableMessage 建一条可编辑的文本消息，返回其 id。
// 会话与用户走 testutil 的既有播种路径（见 message_repo_test.go 同名 helper 用法）。
func seedEditableMessage(t *testing.T, repo *MessageRepository, convID, senderID uuid.UUID) uuid.UUID {
	t.Helper()
	msg := &model.Message{
		ConversationID: convID,
		SenderID:       senderID,
		MessageType:    model.MessageTypeText,
		Content:        `{"text":"原始文本"}`,
		Status:         model.MessageStatusNormal,
	}
	if err := repo.CreateWithSeq(context.Background(), msg); err != nil {
		t.Fatalf("seed message: %v", err)
	}
	return msg.ID
}

func TestEditWithHistoryWritesVersionAndBumpsCount(t *testing.T) {
	db := testutil.NewDB(t)
	repo := NewMessageRepository(db)
	convID, senderID := seedConvAndUser(t, db)
	msgID := seedEditableMessage(t, repo, convID, senderID)

	editedAt := time.Now().UTC().Truncate(time.Second)
	ok, err := repo.EditWithHistory(context.Background(), msgID,
		`{"text":"原始文本"}`, `{"text":"改后文本"}`, 0, false, editedAt)
	if err != nil {
		t.Fatalf("EditWithHistory: %v", err)
	}
	if !ok {
		t.Fatal("EditWithHistory ok = false, want true")
	}

	got, err := repo.FindByID(context.Background(), msgID)
	if err != nil || got == nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got.Content != `{"text":"改后文本"}` {
		t.Errorf("content = %q, want 改后文本", got.Content)
	}
	if got.EditCount != 1 {
		t.Errorf("EditCount = %d, want 1", got.EditCount)
	}
	if got.EditedAt == nil {
		t.Error("EditedAt = nil, want non-nil")
	}

	edits, err := repo.ListEdits(context.Background(), msgID)
	if err != nil {
		t.Fatalf("ListEdits: %v", err)
	}
	if len(edits) != 1 {
		t.Fatalf("len(edits) = %d, want 1", len(edits))
	}
	if edits[0].Version != 1 {
		t.Errorf("version = %d, want 1", edits[0].Version)
	}
	if edits[0].OldContent != `{"text":"原始文本"}` {
		t.Errorf("old_content = %q, want 原始文本", edits[0].OldContent)
	}
}

// TestEditWithHistoryCASRejectsStaleCount 证明 CAS 条件生效：
// 传入过期的 expectCount 时不写库、不留脏历史行。
func TestEditWithHistoryCASRejectsStaleCount(t *testing.T) {
	db := testutil.NewDB(t)
	repo := NewMessageRepository(db)
	convID, senderID := seedConvAndUser(t, db)
	msgID := seedEditableMessage(t, repo, convID, senderID)
	ctx := context.Background()

	// 第一次编辑成功，edit_count 变 1
	if _, err := repo.EditWithHistory(ctx, msgID,
		`{"text":"原始文本"}`, `{"text":"第二版"}`, 0, false, time.Now()); err != nil {
		t.Fatalf("first edit: %v", err)
	}

	// 再用 expectCount=0 提交（模拟并发下的过期读）→ 必须失败
	ok, err := repo.EditWithHistory(ctx, msgID,
		`{"text":"第二版"}`, `{"text":"第三版"}`, 0, false, time.Now())
	if err != nil {
		t.Fatalf("stale edit returned error: %v", err)
	}
	if ok {
		t.Fatal("stale expectCount ok = true, want false")
	}

	// 关键：整事务回滚，历史表不能留下 version=1 之外的行
	edits, err := repo.ListEdits(ctx, msgID)
	if err != nil {
		t.Fatalf("ListEdits: %v", err)
	}
	if len(edits) != 1 {
		t.Errorf("len(edits) = %d, want 1 (stale edit must not leave a row)", len(edits))
	}
}

func TestListEditsOrdersByVersionAsc(t *testing.T) {
	db := testutil.NewDB(t)
	repo := NewMessageRepository(db)
	convID, senderID := seedConvAndUser(t, db)
	msgID := seedEditableMessage(t, repo, convID, senderID)
	ctx := context.Background()

	texts := []string{`{"text":"v2"}`, `{"text":"v3"}`, `{"text":"v4"}`}
	prev := `{"text":"原始文本"}`
	for i, next := range texts {
		if _, err := repo.EditWithHistory(ctx, msgID, prev, next, int16(i), false, time.Now()); err != nil {
			t.Fatalf("edit %d: %v", i, err)
		}
		prev = next
	}

	edits, err := repo.ListEdits(ctx, msgID)
	if err != nil {
		t.Fatalf("ListEdits: %v", err)
	}
	if len(edits) != 3 {
		t.Fatalf("len(edits) = %d, want 3", len(edits))
	}
	for i, e := range edits {
		if e.Version != int16(i+1) {
			t.Errorf("edits[%d].Version = %d, want %d", i, e.Version, i+1)
		}
	}
}
```

**注意**：`seedConvAndUser` 是既有 helper —— 先 `grep -n "func seedConvAndUser" server/internal/repository/*_test.go` 确认其确切签名与返回值顺序；若不存在，照 `message_repo_test.go` 里现有的播种方式改写本测试的前置部分。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && go test ./internal/repository/ -run TestEditWithHistory -v`
Expected: FAIL，编译错误 `repo.EditWithHistory undefined`

- [ ] **Step 3: 实现两个方法**

在 `server/internal/repository/message_repo.go` 的 `Recall`（:134-139）之后插入：

```go
// EditWithHistory 在单事务内写入编辑历史并更新正文。
//
// 两步一体：先把旧 content 插入 message_edits（version = expectCount+1），
// 再 CAS 更新 messages。CAS 条件带 edit_count —— 并发双写时只有一方成功，
// 另一方 RowsAffected=0 返回 false 且整事务回滚，历史表不留脏版本。
// flagged 只在命中敏感词时置 true，不会把已有的 true 改回 false
// （清标是 admin 的动作，用户不能自助洗白）。
func (r *MessageRepository) EditWithHistory(
	ctx context.Context,
	id uuid.UUID,
	oldContent, newContent string,
	expectCount int16,
	flagged bool,
	editedAt time.Time,
) (bool, error) {
	var flipped bool
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		hist := &model.MessageEdit{
			MessageID:  id,
			OldContent: oldContent,
			Version:    expectCount + 1,
			EditedAt:   editedAt,
		}
		if err := tx.Create(hist).Error; err != nil {
			return err
		}

		updates := map[string]any{
			"content":    newContent,
			"edited_at":  editedAt,
			"edit_count": expectCount + 1,
		}
		if flagged {
			updates["flagged"] = true
		}
		res := tx.Model(&model.Message{}).
			Where("id = ? AND status = ? AND edit_count = ?", id, model.MessageStatusNormal, expectCount).
			Updates(updates)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			// CAS 失败：回滚以撤销刚插入的历史行
			flipped = false
			return gorm.ErrRecordNotFound
		}
		flipped = true
		return nil
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// CAS 失败是预期分支，不是错误
		return false, nil
	}
	return flipped, err
}

// ListEdits 取一条消息的全部历史版本，按 version 升序。
func (r *MessageRepository) ListEdits(ctx context.Context, messageID uuid.UUID) ([]model.MessageEdit, error) {
	var edits []model.MessageEdit
	err := r.db.WithContext(ctx).
		Where("message_id = ?", messageID).
		Order("version ASC").
		Find(&edits).Error
	return edits, err
}
```

确认文件头 import 已含 `time`（`Search` 方法用到 `*time.Time`，应已存在）。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && go test ./internal/repository/ -run "TestEditWithHistory|TestListEdits" -v`
Expected: 三个用例全 PASS

- [ ] **Step 5: 让历史消息带上编辑信息**

`MessageWithSender`（`message_repo.go:14-20`）嵌入了 `model.Message`，故 `EditedAt`/`EditCount` **自动包含**，无需改投影。但要确认 `ListBefore`（:63）的 SELECT 是否显式列字段：

Run: `cd server && sed -n '63,92p' internal/repository/message_repo.go`

若是 `SELECT m.*` 则无需改动；若显式列了字段清单，则补上 `m.edited_at, m.edit_count`。

- [ ] **Step 6: 全量 repository 测试确认无回归**

Run: `cd server && go test ./internal/repository/`
Expected: ok（含既有用例）

- [ ] **Step 7: Commit**

```bash
git add server/internal/repository/message_repo.go \
        server/internal/repository/message_edit_repo_test.go
git commit -m "feat(message): repository 层编辑历史写入与查询"
```

---

## Task 3：Service 层 Edit + flagIfHit 抽取

**Files:**

- Create: `server/internal/service/message_edit.go`
- Create: `server/internal/service/message_edit_test.go`
- Modify: `server/internal/service/message_service.go:221-231`（审核打标抽取）

**Interfaces:**

- Consumes: Task 2 的 `EditWithHistory` / `ListEdits`
- Produces:
  - `service.EditResult{Message *model.Message, Text string, MemberIDs []uuid.UUID}`
  - `service.EditVersion{Version int16, Text string, EditedAt time.Time, Current bool}`
  - `func (s *MessageService) Edit(ctx, userID, messageID uuid.UUID, text string) (*EditResult, error)`
  - `func (s *MessageService) EditHistory(ctx, userID, messageID uuid.UUID) ([]EditVersion, error)`
  - `func (s *MessageService) EditHistoryForAdmin(ctx, messageID uuid.UUID) ([]EditVersion, error)`
  - 错误：`ErrEditWindowExpired`、`ErrEditLimitExceeded`、`ErrNotEditable`、`ErrEditNoChange`
  - 常量：`EditWindow = 5 * time.Minute`、`MaxEditCount int16 = 20`

- [ ] **Step 1: 写失败测试（闸门矩阵）**

创建 `server/internal/service/message_edit_test.go`。参考既有 `message_recall_test.go` 的夹具搭建方式（先 `grep -n "func newTestMessageService\|testutil.NewDB" server/internal/service/message_recall_test.go` 看现有 helper）：

```go
package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/yuanchat/server/internal/model"
)

func TestEditUpdatesContentAndWritesHistory(t *testing.T) {
	f := newEditFixture(t)
	res, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, "改后文本")
	if err != nil {
		t.Fatalf("Edit: %v", err)
	}
	if res.Text != "改后文本" {
		t.Errorf("res.Text = %q, want 改后文本", res.Text)
	}
	if res.Message.EditCount != 1 {
		t.Errorf("EditCount = %d, want 1", res.Message.EditCount)
	}
	if res.Message.EditedAt == nil {
		t.Error("EditedAt = nil, want non-nil")
	}
	if len(res.MemberIDs) == 0 {
		t.Error("MemberIDs empty, want conversation members for broadcast")
	}

	versions, err := f.svc.EditHistory(context.Background(), f.senderID, f.msgID)
	if err != nil {
		t.Fatalf("EditHistory: %v", err)
	}
	if len(versions) != 2 {
		t.Fatalf("len(versions) = %d, want 2 (1 history + current)", len(versions))
	}
	if versions[0].Text != "原始文本" || versions[0].Version != 1 {
		t.Errorf("versions[0] = %+v, want v1 原始文本", versions[0])
	}
	if versions[1].Text != "改后文本" || !versions[1].Current {
		t.Errorf("versions[1] = %+v, want current 改后文本", versions[1])
	}
}

func TestEditRejectsNonSender(t *testing.T) {
	f := newEditFixture(t)
	_, err := f.svc.Edit(context.Background(), f.otherID, f.msgID, "别人改")
	if !errors.Is(err, ErrNotSender) {
		t.Errorf("err = %v, want ErrNotSender", err)
	}
}

func TestEditRejectsExpiredWindow(t *testing.T) {
	f := newEditFixture(t)
	// 把 created_at 推回窗口之外
	f.backdateMessage(t, EditWindow+time.Minute)
	_, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, "太晚了")
	if !errors.Is(err, ErrEditWindowExpired) {
		t.Errorf("err = %v, want ErrEditWindowExpired", err)
	}
}

func TestEditRejectsOverLimit(t *testing.T) {
	f := newEditFixture(t)
	f.setEditCount(t, MaxEditCount)
	_, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, "第 21 次")
	if !errors.Is(err, ErrEditLimitExceeded) {
		t.Errorf("err = %v, want ErrEditLimitExceeded", err)
	}
}

// TestEditRejectsNonTextTypes 逐类型验证不可编辑闸门。
// image/file/voice/video 无 caption 字段可改，sticker 无文字，
// system 非用户产出，E2EE 服务端无明文。
func TestEditRejectsNonTextTypes(t *testing.T) {
	types := map[string]int16{
		"image":   model.MessageTypeImage,
		"file":    model.MessageTypeFile,
		"voice":   model.MessageTypeVoice,
		"video":   model.MessageTypeVideo,
		"system":  model.MessageTypeSystem,
		"e2ee":    model.MessageTypeE2EE,
		"sticker": model.MessageTypeSticker,
	}
	for name, mt := range types {
		t.Run(name, func(t *testing.T) {
			f := newEditFixture(t)
			f.setMessageType(t, mt)
			_, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, "试图编辑")
			if !errors.Is(err, ErrNotEditable) {
				t.Errorf("%s: err = %v, want ErrNotEditable", name, err)
			}
		})
	}
}

func TestEditRejectsRecalledMessage(t *testing.T) {
	f := newEditFixture(t)
	if _, err := f.svc.Recall(context.Background(), f.senderID, f.msgID); err != nil {
		t.Fatalf("Recall: %v", err)
	}
	_, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, "撤回后改")
	if !errors.Is(err, ErrNotEditable) {
		t.Errorf("err = %v, want ErrNotEditable", err)
	}
}

// TestEditRejectsUnchangedText 相同文本直接拒绝，且不留历史、不改计数 ——
// 否则用户反复保存会刷出一串无意义版本。
func TestEditRejectsUnchangedText(t *testing.T) {
	f := newEditFixture(t)
	_, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, "原始文本")
	if !errors.Is(err, ErrEditNoChange) {
		t.Fatalf("err = %v, want ErrEditNoChange", err)
	}
	versions, err := f.svc.EditHistory(context.Background(), f.senderID, f.msgID)
	if err != nil {
		t.Fatalf("EditHistory: %v", err)
	}
	if len(versions) != 1 {
		t.Errorf("len(versions) = %d, want 1 (current only, no history row)", len(versions))
	}
}

func TestEditRejectsEmptyText(t *testing.T) {
	f := newEditFixture(t)
	for _, empty := range []string{"", "   ", "\n\t"} {
		if _, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, empty); err == nil {
			t.Errorf("Edit(%q) err = nil, want rejection", empty)
		}
	}
}

// TestEditFlagsModeratedText 是本批最关键的一条：
// 若编辑不走审核，「先发干净文本 → 编辑成敏感词」可完全绕过内容审核。
func TestEditFlagsModeratedText(t *testing.T) {
	f := newEditFixture(t)
	f.svc.SetModeration(NewModerationService([]string{"违规词"}))

	res, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, "这里有违规词出现")
	if err != nil {
		t.Fatalf("Edit: %v", err)
	}
	if !res.Message.Flagged {
		t.Error("Flagged = false, want true — 编辑成敏感词必须进审核队列")
	}
}

// TestEditKeepsFlaggedWhenCleaned 编辑成干净文本不清除既有 flagged：
// 清标是 admin 的动作，用户不能自助洗白。
func TestEditKeepsFlaggedWhenCleaned(t *testing.T) {
	f := newEditFixture(t)
	f.svc.SetModeration(NewModerationService([]string{"违规词"}))

	if _, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, "含违规词的版本"); err != nil {
		t.Fatalf("first edit: %v", err)
	}
	res, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, "洗白成干净文本")
	if err != nil {
		t.Fatalf("second edit: %v", err)
	}
	if !res.Message.Flagged {
		t.Error("Flagged = false, want true — 用户不能通过再编辑自助清标")
	}
}

func TestEditHistoryRejectsNonMember(t *testing.T) {
	f := newEditFixture(t)
	if _, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, "改一版"); err != nil {
		t.Fatalf("Edit: %v", err)
	}
	_, err := f.svc.EditHistory(context.Background(), f.strangerID, f.msgID)
	if !errors.Is(err, ErrNotMember) {
		t.Errorf("err = %v, want ErrNotMember", err)
	}
}

// TestEditHistoryRespectsClearedWatermark 清空聊天记录后水位以下的消息
// 历史同样不可见（与 GetHistory 完全一致的可见性口径）。
func TestEditHistoryRespectsClearedWatermark(t *testing.T) {
	f := newEditFixture(t)
	if _, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, "改一版"); err != nil {
		t.Fatalf("Edit: %v", err)
	}
	f.clearHistoryFor(t, f.senderID)
	_, err := f.svc.EditHistory(context.Background(), f.senderID, f.msgID)
	if err == nil {
		t.Error("err = nil, want rejection for message below cleared watermark")
	}
}

// TestEditHistoryForAdminSkipsMembership admin 取证不受成员身份限制。
func TestEditHistoryForAdminSkipsMembership(t *testing.T) {
	f := newEditFixture(t)
	if _, err := f.svc.Edit(context.Background(), f.senderID, f.msgID, "改一版"); err != nil {
		t.Fatalf("Edit: %v", err)
	}
	versions, err := f.svc.EditHistoryForAdmin(context.Background(), f.msgID)
	if err != nil {
		t.Fatalf("EditHistoryForAdmin: %v", err)
	}
	if len(versions) != 2 {
		t.Errorf("len(versions) = %d, want 2", len(versions))
	}
}
```

夹具 `newEditFixture` 也在本文件里实现，字段 `svc`、`msgID`、`senderID`、`otherID`（同会话另一成员）、`strangerID`（非成员）、方法 `backdateMessage`/`setEditCount`/`setMessageType`/`clearHistoryFor` 直接用 `testutil.NewDB(t)` 拿到的 `*gorm.DB` 做 UPDATE。**先读 `server/internal/service/message_recall_test.go` 照抄它的夹具骨架**，避免重复造播种逻辑。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && go test ./internal/service/ -run TestEdit -v`
Expected: FAIL，编译错误 `f.svc.Edit undefined`、`ErrNotEditable undefined`

- [ ] **Step 3: 先抽取 flagIfHit（改既有代码）**

把 `server/internal/service/message_service.go:221-231` 的审核块替换为方法调用。原代码：

```go
	// 敏感词审核：命中标记 flagged 进审核队列，消息正常发送（不阻塞）
	if s.moderation != nil && messageType == model.MessageTypeText {
		var tc model.MessageContentText
		if err := json.Unmarshal([]byte(contentJSON), &tc); err == nil {
			if hit := s.moderation.Check(tc.Text); hit != "" {
				msg.Flagged = true
				s.logger.Info("message flagged by moderation",
					zap.String("word", hit), zap.String("sender", senderID.String()))
			}
		}
	}
```

改为：

```go
	// 敏感词审核：命中标记 flagged 进审核队列，消息正常发送（不阻塞）
	if s.textHitsModeration(messageType, contentJSON, senderID) {
		msg.Flagged = true
	}
```

并在同文件新增（放在 `SendContent` 之后）：

```go
// textHitsModeration 判定文本是否命中敏感词并记日志，命中返回 true。
//
// 发送与编辑两条路径共用：若编辑不走这里，「先发干净文本 → 编辑成敏感词」
// 就能完全绕过内容审核。命中只打标不拦截，沿用既有「打标不阻塞」范式。
func (s *MessageService) textHitsModeration(messageType int16, contentJSON string, actorID uuid.UUID) bool {
	if s.moderation == nil || messageType != model.MessageTypeText {
		return false
	}
	var tc model.MessageContentText
	if err := json.Unmarshal([]byte(contentJSON), &tc); err != nil {
		return false
	}
	hit := s.moderation.Check(tc.Text)
	if hit == "" {
		return false
	}
	s.logger.Info("message flagged by moderation",
		zap.String("word", hit), zap.String("actor", actorID.String()))
	return true
}
```

- [ ] **Step 4: 确认抽取未破坏既有发送审核**

Run: `cd server && go test ./internal/service/ -run "TestSend|TestModeration" -v`
Expected: 既有发送与审核用例全 PASS（证明重构等价）

- [ ] **Step 5: 实现 Edit / EditHistory**

创建 `server/internal/service/message_edit.go`：

```go
package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
)

// EditWindow 消息可编辑的时间窗口（自发送起 5 分钟）。
//
// 与 RecallWindow（2 分钟）刻意不对齐：编辑不改变「对方已看到过什么」的事实，
// 危害面小于撤回，可以给更宽的窗口。5 分钟取自仓内既有先例
// （前端撤回后「重新编辑」窗口 RE_EDIT_WINDOW_MS）。
const EditWindow = 5 * time.Minute

// MaxEditCount 单条消息累计可编辑次数上限（防滥用软护栏）。
const MaxEditCount int16 = 20

var (
	// ErrEditWindowExpired 已超出可编辑时间窗口。
	ErrEditWindowExpired = errors.New("edit window expired")
	// ErrEditLimitExceeded 累计编辑次数已达上限。
	ErrEditLimitExceeded = errors.New("edit limit exceeded")
	// ErrNotEditable 消息类型或状态不允许编辑。
	ErrNotEditable = errors.New("message not editable")
	// ErrEditNoChange 新文本与当前文本相同，无需编辑。
	ErrEditNoChange = errors.New("text unchanged")
	// ErrEditEmptyText 新文本为空。
	ErrEditEmptyText = errors.New("text must not be empty")
)

// EditResult 编辑结果，供 handler 构造 message.edited 推送。
type EditResult struct {
	Message   *model.Message
	Text      string
	MemberIDs []uuid.UUID
}

// EditVersion 编辑历史的一个版本；Current 为 true 表示当前生效版本。
type EditVersion struct {
	Version  int16     `json:"version"`
	Text     string    `json:"text"`
	EditedAt time.Time `json:"edited_at"`
	Current  bool      `json:"current,omitempty"`
}

// Edit 编辑一条文本消息的正文。
//
// 七道闸门（顺序即失败优先级）：消息存在 → 本人发送 → 类型为文本 →
// 状态为 normal → 在 EditWindow 内 → 未达 MaxEditCount → 新文本非空且有变化。
// 通过后在单事务内写历史 + CAS 更新正文，并对新文本重跑敏感词审核。
func (s *MessageService) Edit(
	ctx context.Context,
	userID, messageID uuid.UUID,
	text string,
) (*EditResult, error) {
	if strings.TrimSpace(text) == "" {
		return nil, ErrEditEmptyText
	}

	msg, err := s.msgRepo.FindByID(ctx, messageID)
	if err != nil {
		return nil, fmt.Errorf("find message: %w", err)
	}
	if msg == nil {
		return nil, ErrMessageNotFound
	}
	if msg.SenderID != userID {
		return nil, ErrNotSender
	}
	// 仅纯文本可编辑：媒体 content 无 caption 字段可改、且 content->>'key'
	// 是对象授权与 GC 的凭据；E2EE 服务端无明文；system 非用户产出。
	if msg.MessageType != model.MessageTypeText {
		return nil, ErrNotEditable
	}
	if msg.Status != model.MessageStatusNormal {
		return nil, ErrNotEditable
	}
	if time.Since(msg.CreatedAt) > EditWindow {
		return nil, ErrEditWindowExpired
	}
	if msg.EditCount >= MaxEditCount {
		return nil, ErrEditLimitExceeded
	}

	var old model.MessageContentText
	if err := json.Unmarshal([]byte(msg.Content), &old); err != nil {
		return nil, fmt.Errorf("unmarshal current content: %w", err)
	}
	if old.Text == text {
		return nil, ErrEditNoChange
	}

	newContent, err := json.Marshal(model.MessageContentText{Text: text})
	if err != nil {
		return nil, fmt.Errorf("marshal new content: %w", err)
	}

	flagged := s.textHitsModeration(msg.MessageType, string(newContent), userID)
	editedAt := time.Now().UTC()

	ok, err := s.msgRepo.EditWithHistory(ctx, messageID,
		msg.Content, string(newContent), msg.EditCount, flagged, editedAt)
	if err != nil {
		return nil, fmt.Errorf("edit message: %w", err)
	}
	// CAS 失败＝并发下已被另一次编辑推进，让调用方重试而非静默成功
	if !ok {
		return nil, ErrEditNoChange
	}

	// 同步内存副本供 handler 组帧（DB 已由 repo 更新）
	msg.Content = string(newContent)
	msg.EditedAt = &editedAt
	msg.EditCount = msg.EditCount + 1
	if flagged {
		msg.Flagged = true
	}

	memberIDs, err := s.convRepo.GetMemberIDs(ctx, msg.ConversationID)
	if err != nil {
		return nil, fmt.Errorf("load members: %w", err)
	}

	return &EditResult{Message: msg, Text: text, MemberIDs: memberIDs}, nil
}

// EditHistory 取一条消息的全部版本（升序，末项为当前版本）。
//
// 可见性口径与 GetHistory 完全一致：成员校验 + cleared_before_seq 水位，
// 不另立标准。
func (s *MessageService) EditHistory(
	ctx context.Context,
	userID, messageID uuid.UUID,
) ([]EditVersion, error) {
	msg, err := s.msgRepo.FindByID(ctx, messageID)
	if err != nil {
		return nil, fmt.Errorf("find message: %w", err)
	}
	if msg == nil {
		return nil, ErrMessageNotFound
	}

	member, ok, err := s.convRepo.GetMember(ctx, msg.ConversationID, userID)
	if err != nil {
		return nil, fmt.Errorf("check membership: %w", err)
	}
	if !ok {
		return nil, ErrNotMember
	}
	// 本人清空记录后，水位以下的消息历史同步失效
	if msg.Seq <= member.ClearedBeforeSeq {
		return nil, ErrMessageNotFound
	}

	return s.buildVersions(ctx, msg)
}

// EditHistoryForAdmin 取编辑历史，跳过成员与水位校验（admin 取证用）。
func (s *MessageService) EditHistoryForAdmin(
	ctx context.Context,
	messageID uuid.UUID,
) ([]EditVersion, error) {
	msg, err := s.msgRepo.FindByID(ctx, messageID)
	if err != nil {
		return nil, fmt.Errorf("find message: %w", err)
	}
	if msg == nil {
		return nil, ErrMessageNotFound
	}
	return s.buildVersions(ctx, msg)
}

// buildVersions 把历史行与当前正文拼成升序版本列表。
//
// 当前版本不存在 message_edits 里（历史表只存被替换掉的版本），
// 故在末尾按 edit_count+1 追加。
func (s *MessageService) buildVersions(
	ctx context.Context,
	msg *model.Message,
) ([]EditVersion, error) {
	edits, err := s.msgRepo.ListEdits(ctx, msg.ID)
	if err != nil {
		return nil, fmt.Errorf("list edits: %w", err)
	}

	versions := make([]EditVersion, 0, len(edits)+1)
	for _, e := range edits {
		var tc model.MessageContentText
		if err := json.Unmarshal([]byte(e.OldContent), &tc); err != nil {
			// 单条坏数据不使整个历史失败（同相册的「跳过脏 content」取舍）
			s.logger.Warn("unmarshal edit history content failed")
			continue
		}
		versions = append(versions, EditVersion{
			Version:  e.Version,
			Text:     tc.Text,
			EditedAt: e.EditedAt,
		})
	}

	var cur model.MessageContentText
	if err := json.Unmarshal([]byte(msg.Content), &cur); err != nil {
		return nil, fmt.Errorf("unmarshal current content: %w", err)
	}
	curEditedAt := msg.CreatedAt
	if msg.EditedAt != nil {
		curEditedAt = *msg.EditedAt
	}
	versions = append(versions, EditVersion{
		Version:  msg.EditCount + 1,
		Text:     cur.Text,
		EditedAt: curEditedAt,
		Current:  true,
	})

	return versions, nil
}
```

**注意**：`NewModerationService` 的确切构造签名要先核对 —— Run `grep -n "func NewModerationService" server/internal/service/moderation_service.go`，按实际签名调整 Step 1 测试里的调用。

- [ ] **Step 6: 运行测试确认通过**

Run: `cd server && go test ./internal/service/ -run TestEdit -v`
Expected: 全部 PASS（含 `TestEditFlagsModeratedText` —— 审核绕过回归）

- [ ] **Step 7: 编辑后全文检索验证**

在 `message_edit_test.go` 追加一条，验证表达式索引自动跟随（spec §2.3 的结论必须有测试兜住）：

```go
// TestEditUpdatesSearchIndex 编辑后新文本可搜到、旧文本搜不到。
// idx_messages_text_trgm 是表达式 + partial 索引，UPDATE content 时
// Postgres 自动重算 GIN 条目 —— 本测试钉住这个前提，避免将来
// 有人误加「编辑后需 REINDEX」的多余逻辑。
func TestEditUpdatesSearchIndex(t *testing.T) {
	f := newEditFixture(t)
	ctx := context.Background()
	if _, err := f.svc.Edit(ctx, f.senderID, f.msgID, "编辑后的独特关键词"); err != nil {
		t.Fatalf("Edit: %v", err)
	}

	hits, err := f.svc.Search(ctx, f.senderID, "独特关键词", nil, nil, 10)
	if err != nil {
		t.Fatalf("Search new text: %v", err)
	}
	if len(hits) == 0 {
		t.Error("搜新文本命中 0 条，want ≥1")
	}

	stale, err := f.svc.Search(ctx, f.senderID, "原始文本", nil, nil, 10)
	if err != nil {
		t.Fatalf("Search old text: %v", err)
	}
	for _, h := range stale {
		if h.ID == f.msgID {
			t.Error("旧文本仍能搜到被编辑的消息，索引未跟随")
		}
	}
}
```

**先核对 `Search` 的确切签名**：Run `grep -n "func (s \*MessageService) Search" -A 8 server/internal/service/message_service.go`，按实际参数调整。

Run: `cd server && go test ./internal/service/ -run TestEditUpdatesSearchIndex -v`
Expected: PASS

- [ ] **Step 8: 全量后端测试**

Run: `cd server && go vet ./... && go test ./...`
Expected: 全绿

- [ ] **Step 9: Commit**

```bash
git add server/internal/service/message_edit.go \
        server/internal/service/message_edit_test.go \
        server/internal/service/message_service.go
git commit -m "feat(message): service 层消息编辑与编辑历史，审核打标供发送与编辑共用"
```

---

## Task 4：WS 帧 + golden 契约新骨架

**Files:**

- Modify: `server/internal/ws/protocol.go:29-45`（常量）、`:107-114` 之后（payload）
- Create: `contracts/server-frames.golden.json`
- Create: `server/internal/ws/golden_server_frames_test.go`

**Interfaces:**

- Consumes: 无（协议层独立）
- Produces:
  - `ws.TypeMessageEdited = "message.edited"`
  - `ws.MessageEditedPayload{MessageID, ConversationID uuid.UUID, Seq int64, Text string, EditedAt time.Time, EditCount int16}`
  - `contracts/server-frames.golden.json` 供前端 Task 8 消费

- [ ] **Step 1: 写 golden 契约文件**

创建 `contracts/server-frames.golden.json`。结构沿用 `contracts/message-send.golden.json` 的组织（顶层 `$comment` 字符串数组 + `cases[]`）：

```json
{
  "$comment": [
    "服务端 → 客户端 WS 帧的黄金契约。",
    "与 message-send.golden.json（客户端 → 服务端）方向相反、骨架独立：",
    "后者绑定 SendPayload + buildContent，塞不进 S→C 帧。",
    "Go 侧 server/internal/ws/golden_server_frames_test.go 用 DisallowUnknownFields",
    "反序列化每个 payload，证明服务端 struct 能完整表达契约、且无契约未声明的字段。",
    "前端 packages/shared/src/__tests__/serverFramesGolden.test.ts 把同一份 payload",
    "喂进 chatSocket 的 handler 表，断言 store 状态按预期变化。",
    "改动本文件必须双端同时通过。"
  ],
  "cases": [
    {
      "name": "message.edited 文本消息编辑",
      "frame": {
        "type": "message.edited",
        "payload": {
          "message_id": "11111111-1111-4111-8111-111111111111",
          "conversation_id": "22222222-2222-4222-8222-222222222222",
          "seq": 42,
          "text": "编辑后的正文",
          "edited_at": "2026-09-05T10:00:00Z",
          "edit_count": 1
        }
      }
    },
    {
      "name": "message.recalled 消息撤回",
      "frame": {
        "type": "message.recalled",
        "payload": {
          "message_id": "33333333-3333-4333-8333-333333333333",
          "conversation_id": "22222222-2222-4222-8222-222222222222",
          "seq": 41,
          "operator_id": "44444444-4444-4444-8444-444444444444",
          "operator_nickname": "Alice"
        }
      }
    }
  ]
}
```

- [ ] **Step 2: 写失败测试**

创建 `server/internal/ws/golden_server_frames_test.go`。参考既有 `golden_contract_test.go:32` 的路径上溯写法：

```go
package ws

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// serverFrameGolden 是 contracts/server-frames.golden.json 的顶层结构。
type serverFrameGolden struct {
	Cases []struct {
		Name  string `json:"name"`
		Frame struct {
			Type    string          `json:"type"`
			Payload json.RawMessage `json:"payload"`
		} `json:"frame"`
	} `json:"cases"`
}

func loadServerFrameGolden(t *testing.T) serverFrameGolden {
	t.Helper()
	// 上溯四级到仓库根：internal/ws → internal → server → 仓库根
	path := filepath.Join("..", "..", "..", "contracts", "server-frames.golden.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read golden: %v", err)
	}
	var g serverFrameGolden
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatalf("unmarshal golden: %v", err)
	}
	return g
}

// TestGoldenServerFramesDecodeIntoPayloadStructs 逐个 case 把契约 payload
// 以 DisallowUnknownFields 反序列化进对应 struct：既证明 struct 能完整表达
// 契约，也挡下契约里出现 struct 未声明的字段（双向钉死）。
func TestGoldenServerFramesDecodeIntoPayloadStructs(t *testing.T) {
	g := loadServerFrameGolden(t)
	if len(g.Cases) == 0 {
		t.Fatal("golden 没有任何用例")
	}

	for _, c := range g.Cases {
		t.Run(c.Name, func(t *testing.T) {
			dec := json.NewDecoder(bytes.NewReader(c.Frame.Payload))
			dec.DisallowUnknownFields()

			switch c.Frame.Type {
			case TypeMessageEdited:
				var p MessageEditedPayload
				if err := dec.Decode(&p); err != nil {
					t.Fatalf("decode into MessageEditedPayload: %v", err)
				}
				if p.Text == "" {
					t.Error("Text 为空，契约样本应带正文")
				}
				if p.EditCount == 0 {
					t.Error("EditCount 为 0，契约样本应 ≥1")
				}
			case TypeMessageRecalled:
				var p MessageRecalledPayload
				if err := dec.Decode(&p); err != nil {
					t.Fatalf("decode into MessageRecalledPayload: %v", err)
				}
				if p.OperatorNickname == "" {
					t.Error("OperatorNickname 为空，契约样本应带昵称")
				}
			default:
				t.Fatalf("契约含未知帧类型 %q —— 新增帧须同时在本 switch 注册", c.Frame.Type)
			}
		})
	}
}

// TestGoldenServerFramesRoundTripThroughEncode 证明 Encode 产出的信封
// 与契约声明的 type 一致（Envelope 双层序列化不会改写 type）。
func TestGoldenServerFramesRoundTripThroughEncode(t *testing.T) {
	g := loadServerFrameGolden(t)
	for _, c := range g.Cases {
		t.Run(c.Name, func(t *testing.T) {
			frame, err := Encode(c.Frame.Type, json.RawMessage(c.Frame.Payload))
			if err != nil {
				t.Fatalf("Encode: %v", err)
			}
			var env struct {
				Type    string          `json:"type"`
				Payload json.RawMessage `json:"payload"`
			}
			if err := json.Unmarshal(frame, &env); err != nil {
				t.Fatalf("unmarshal envelope: %v", err)
			}
			if env.Type != c.Frame.Type {
				t.Errorf("envelope type = %q, want %q", env.Type, c.Frame.Type)
			}
		})
	}
}
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd server && go test ./internal/ws/ -run TestGoldenServerFrames -v`
Expected: FAIL，编译错误 `undefined: TypeMessageEdited`

- [ ] **Step 4: 加常量与 payload**

在 `server/internal/ws/protocol.go` 的服务端帧常量区（`TypeMessageRecalled` 那行附近，:37）追加：

```go
	TypeMessageEdited = "message.edited"
```

在 `MessageRecalledPayload`（:107-114）之后追加：

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

确认文件头 import 含 `time`（若无则加）。

- [ ] **Step 5: 运行测试确认通过**

Run: `cd server && go test ./internal/ws/ -run TestGoldenServerFrames -v`
Expected: 两个测试各 2 个子用例全 PASS

- [ ] **Step 6: 确认既有 golden 未被破坏**

Run: `cd server && go test ./internal/ws/`
Expected: ok（含既有 `TestGoldenMessageSendFrames` 与 `TestGoldenCoversEveryContentType`）

- [ ] **Step 7: Commit**

```bash
git add server/internal/ws/protocol.go \
        server/internal/ws/golden_server_frames_test.go \
        contracts/server-frames.golden.json
git commit -m "feat(ws): message.edited 帧与服务端帧黄金契约骨架"
```

---

## Task 5：Handler + 路由 + admin 端点

**Files:**

- Modify: `server/internal/handler/message.go`（`Recall` :178 之后追加）
- Modify: `server/internal/handler/admin.go`
- Modify: `server/internal/router/router.go:288`
- Test: `server/internal/handler/message_edit_test.go`

**Interfaces:**

- Consumes: Task 3 的 `svc.Edit`/`EditHistory`/`EditHistoryForAdmin` 与四个错误；Task 4 的 `ws.TypeMessageEdited`/`MessageEditedPayload`
- Produces:
  - `PATCH /api/v1/messages/:id` → `{code:0, data:{edited_at, edit_count}}`
  - `GET /api/v1/messages/:id/edits` → `{code:0, data:{versions:[...]}}`
  - `GET /api/v1/admin/messages/:id/edits`
  - 业务码 4032 / 4033 / 4004

- [ ] **Step 1: 写失败测试**

创建 `server/internal/handler/message_edit_test.go`。参考既有 `message_test.go` 的 router 搭建与断言方式（先读它的 helper）：

```go
package handler

import (
	"net/http"
	"testing"
)

func TestEditEndpointSuccess(t *testing.T) {
	env := newEditEnv(t)
	resp, status := env.patch(t, "/api/v1/messages/"+env.msgID.String(),
		map[string]any{"text": "改后文本"}, env.senderToken)

	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if code, _ := resp["code"].(float64); code != 0 {
		t.Errorf("code = %v, want 0", resp["code"])
	}
	data, _ := resp["data"].(map[string]any)
	if data == nil {
		t.Fatal("data 缺失")
	}
	if cnt, _ := data["edit_count"].(float64); cnt != 1 {
		t.Errorf("edit_count = %v, want 1", data["edit_count"])
	}
	if _, ok := data["edited_at"].(string); !ok {
		t.Error("edited_at 缺失或非字符串")
	}
}

// TestEditEndpointWindowExpired 超窗 → 403 + 业务码 4032
// （紧邻 recall 的 4031，前端按 code 而非 message 识别）。
func TestEditEndpointWindowExpired(t *testing.T) {
	env := newEditEnv(t)
	env.backdateMessage(t)
	resp, status := env.patch(t, "/api/v1/messages/"+env.msgID.String(),
		map[string]any{"text": "太晚了"}, env.senderToken)

	if status != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", status)
	}
	if code, _ := resp["code"].(float64); code != 4032 {
		t.Errorf("code = %v, want 4032", resp["code"])
	}
}

// TestEditEndpointLimitExceeded 超次数 → 400 + 业务码 4033。
func TestEditEndpointLimitExceeded(t *testing.T) {
	env := newEditEnv(t)
	env.setEditCount(t, 20)
	resp, status := env.patch(t, "/api/v1/messages/"+env.msgID.String(),
		map[string]any{"text": "第 21 次"}, env.senderToken)

	if status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", status)
	}
	if code, _ := resp["code"].(float64); code != 4033 {
		t.Errorf("code = %v, want 4033", resp["code"])
	}
}

// TestEditEndpointNotEditable 非文本类型 → 400 + 业务码 4004。
func TestEditEndpointNotEditable(t *testing.T) {
	env := newEditEnv(t)
	env.setMessageTypeImage(t)
	resp, status := env.patch(t, "/api/v1/messages/"+env.msgID.String(),
		map[string]any{"text": "试图编辑图片"}, env.senderToken)

	if status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", status)
	}
	if code, _ := resp["code"].(float64); code != 4004 {
		t.Errorf("code = %v, want 4004", resp["code"])
	}
}

func TestEditEndpointNotSender(t *testing.T) {
	env := newEditEnv(t)
	_, status := env.patch(t, "/api/v1/messages/"+env.msgID.String(),
		map[string]any{"text": "别人改"}, env.otherToken)
	if status != http.StatusForbidden {
		t.Errorf("status = %d, want 403", status)
	}
}

func TestEditEndpointNotFound(t *testing.T) {
	env := newEditEnv(t)
	_, status := env.patch(t, "/api/v1/messages/11111111-1111-4111-8111-111111111111",
		map[string]any{"text": "不存在"}, env.senderToken)
	if status != http.StatusNotFound {
		t.Errorf("status = %d, want 404", status)
	}
}

func TestEditHistoryEndpointReturnsVersions(t *testing.T) {
	env := newEditEnv(t)
	if _, status := env.patch(t, "/api/v1/messages/"+env.msgID.String(),
		map[string]any{"text": "改后文本"}, env.senderToken); status != http.StatusOK {
		t.Fatalf("edit failed with %d", status)
	}

	resp, status := env.get(t, "/api/v1/messages/"+env.msgID.String()+"/edits", env.senderToken)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	data, _ := resp["data"].(map[string]any)
	versions, _ := data["versions"].([]any)
	if len(versions) != 2 {
		t.Fatalf("len(versions) = %d, want 2", len(versions))
	}
	last, _ := versions[1].(map[string]any)
	if cur, _ := last["current"].(bool); !cur {
		t.Error("末项 current != true")
	}
}
```

`newEditEnv` 夹具在本文件实现，字段 `msgID`、`senderToken`、`otherToken`，方法 `patch`/`get`/`backdateMessage`/`setEditCount`/`setMessageTypeImage`。**先读 `server/internal/handler/message_test.go` 照抄它的 router + token 搭建骨架**。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && go test ./internal/handler/ -run TestEditEndpoint -v`
Expected: FAIL（404，因为路由未注册）

- [ ] **Step 3: 实现 handler**

在 `server/internal/handler/message.go` 的 `Recall`（:178）之后追加：

```go
// EditBody 编辑消息请求体。
type EditBody struct {
	Text string `json:"text" binding:"required"`
}

// Edit 编辑一条文本消息（发送者本人、5 分钟窗口内、累计不超 20 次）。
//
//	@Summary		编辑消息
//	@Tags			chat
//	@Security		BearerAuth
//	@Param			id		path	string		true	"消息 id"
//	@Param			body	body	EditBody	true	"新正文"
//	@Success		200		{object}	Response
//	@Router			/api/v1/messages/{id} [patch]
func (h *MessageHandler) Edit(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	msgID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid message id")
		return
	}
	var body EditBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, "text is required")
		return
	}

	result, err := h.svc.Edit(c.Request.Context(), userID, msgID, body.Text)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrMessageNotFound):
			NotFound(c, "message not found")
		case errors.Is(err, service.ErrNotSender):
			Error(c, http.StatusForbidden, 403, "only the sender can edit")
		case errors.Is(err, service.ErrEditWindowExpired):
			// 业务码 4032：紧邻 recall 的 4031，前端按 code 识别并提示窗口过期
			Error(c, http.StatusForbidden, 4032, "edit window expired")
		case errors.Is(err, service.ErrEditLimitExceeded):
			Error(c, http.StatusBadRequest, 4033, "edit limit exceeded")
		case errors.Is(err, service.ErrNotEditable),
			errors.Is(err, service.ErrEditNoChange),
			errors.Is(err, service.ErrEditEmptyText):
			Error(c, http.StatusBadRequest, 4004, "message not editable")
		default:
			h.logger.Error("edit failed", zap.Error(err))
			InternalError(c, "edit failed")
		}
		return
	}

	if frame, err := ws.Encode(ws.TypeMessageEdited, ws.MessageEditedPayload{
		MessageID:      result.Message.ID,
		ConversationID: result.Message.ConversationID,
		Seq:            result.Message.Seq,
		Text:           result.Text,
		EditedAt:       *result.Message.EditedAt,
		EditCount:      result.Message.EditCount,
	}); err == nil {
		h.dispatcher.SendToUsers(result.MemberIDs, frame)
	} else {
		h.logger.Error("encode message.edited failed", zap.Error(err))
	}

	Success(c, gin.H{
		"edited_at":  result.Message.EditedAt,
		"edit_count": result.Message.EditCount,
	})
}

// EditHistory 取一条消息的编辑历史（会话成员可见）。
//
//	@Summary		消息编辑历史
//	@Tags			chat
//	@Security		BearerAuth
//	@Param			id	path	string	true	"消息 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/messages/{id}/edits [get]
func (h *MessageHandler) EditHistory(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	msgID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid message id")
		return
	}

	versions, err := h.svc.EditHistory(c.Request.Context(), userID, msgID)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrMessageNotFound):
			NotFound(c, "message not found")
		case errors.Is(err, service.ErrNotMember):
			Error(c, http.StatusForbidden, 403, "not a conversation member")
		default:
			h.logger.Error("load edit history failed", zap.Error(err))
			InternalError(c, "load edit history failed")
		}
		return
	}
	Success(c, gin.H{"versions": versions})
}
```

- [ ] **Step 4: 注册路由**

在 `server/internal/router/router.go:288`（`chat.POST("/messages/:id/recall", msgH.Recall)`）之后插入：

```go
		chat.PATCH("/messages/:id", msgH.Edit)
		chat.GET("/messages/:id/edits", msgH.EditHistory)
```

**注意 Gin 路由冲突**：`chat.GET("/messages/search", ...)`（:291）与 `/messages/:id/edits` 不冲突（前者是 `/messages/search` 两段，后者三段）。但要确认没有既有 `chat.GET("/messages/:id")` 与 PATCH 同路径产生 wildcard 冲突 —— Run `grep -n '"/messages' server/internal/router/router.go` 核对全部消息路由后再改。

- [ ] **Step 5: 运行测试确认通过**

Run: `cd server && go test ./internal/handler/ -run TestEdit -v`
Expected: 全部 PASS

- [ ] **Step 6: 加 admin 端点**

**先核对过的约束**：`AdminHandler` 持有 `*service.AdminService` + `*ws.Hub` + `*storage.Storage` + logger（`admin.go:19-30`），**不持有 `MessageService`**。但它已有「直接注入非 AdminService 依赖」的先例（`st *storage.Storage` 用于媒体预览签发），故这里**注入 `*service.MessageService` 复用 Task 3 的 `EditHistoryForAdmin`**，而不是在 AdminService 里重写一份版本拼装逻辑（那会与 `buildVersions` 重复且易漂移）。

改 `AdminHandler` 结构体与构造函数：

```go
type AdminHandler struct {
	svc        *service.AdminService
	hub        *ws.Hub
	dispatcher ws.Dispatcher
	// st 对象存储句柄：管理端媒体预览签发预签名 GET 用，可能为 nil（MinIO 不可达时降级 503）。
	st *storage.Storage
	// msgSvc 消息服务：编辑历史取证复用其 EditHistoryForAdmin，
	// 避免在 AdminService 里重写一份版本拼装（与 buildVersions 重复且易漂移）。
	msgSvc *service.MessageService
	logger *zap.Logger
}

func NewAdminHandler(
	svc *service.AdminService,
	hub *ws.Hub,
	st *storage.Storage,
	msgSvc *service.MessageService,
	logger *zap.Logger,
) *AdminHandler {
	return &AdminHandler{svc: svc, hub: hub, dispatcher: hub, st: st, msgSvc: msgSvc, logger: logger}
}
```

同步改 `router.Setup` 里的 `NewAdminHandler(...)` 调用（Run `grep -n "NewAdminHandler" server/internal/router/router.go` 定位；`MessageService` 实例在该函数里应已存在，用于构造 `MessageHandler`）。

新增审计动作常量 —— 在 `AdminActionDeleteMessage` 的定义处（Run `grep -rn "AdminActionDeleteMessage" server/internal/model/`）追加：

```go
	// AdminActionViewMessageEdits 管理员查看消息编辑历史（取证动作，须留痕）
	AdminActionViewMessageEdits = "view_message_edits"
```

在 `AdminService` 加一个只写审计的薄方法（`DeleteMessage` :123-134 之后）：

```go
// AuditMessageEditsView 记录「管理员查看消息编辑历史」这一取证动作。
//
// 历史内容本身由 MessageService.EditHistoryForAdmin 提供，本方法只负责留痕 ——
// 审计写入统一收在 AdminService，不散到 handler 里。
func (s *AdminService) AuditMessageEditsView(ctx context.Context, actorID, messageID uuid.UUID) {
	s.audit(ctx, actorID, model.AdminActionViewMessageEdits, "message", messageID.String(), nil)
}
```

在 `server/internal/handler/admin.go` 加 handler（照 `DeleteMessage` :240-257 的形状）：

```go
// MessageEditHistory 取消息编辑历史（管理端取证，跳过成员与水位校验）。
//
//	@Summary		消息编辑历史（管理端）
//	@Tags			admin
//	@Security		BearerAuth
//	@Param			id	path	string	true	"消息 id"
//	@Success		200	{object}	Response
//	@Router			/api/v1/admin/messages/{id}/edits [get]
func (h *AdminHandler) MessageEditHistory(c *gin.Context) {
	actorID, _ := middleware.GetUserID(c)
	messageID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid message id")
		return
	}
	versions, err := h.msgSvc.EditHistoryForAdmin(c.Request.Context(), messageID)
	if err != nil {
		if errors.Is(err, service.ErrMessageNotFound) {
			NotFound(c, "message not found")
			return
		}
		h.logger.Error("admin load edit history failed", zap.Error(err))
		InternalError(c, "load edit history failed")
		return
	}
	h.svc.AuditMessageEditsView(c.Request.Context(), actorID, messageID)
	Success(c, gin.H{"versions": versions})
}
```

路由注册在 admin 组（Run `grep -n 'admin.GET("/messages' server/internal/router/router.go` 找到 `ListMessages` 那行，在其后加）：

```go
		admin.GET("/messages/:id/edits", adminH.MessageEditHistory)
```

**Gin 路由冲突检查**：admin 组若已有 `admin.DELETE("/messages/:id", ...)`，wildcard 参数名必须与新路由一致（Gin 同层级参数名不同会 panic）。Run `grep -n '"/messages' server/internal/router/router.go` 核对全部消息路由的参数名后再改。

- [ ] **Step 7: 全量后端测试**

Run: `cd server && go vet ./... && go test ./...`
Expected: 全绿

- [ ] **Step 8: 用 curl 打真后端冒烟**

启动：`pnpm dev:server`。用种子账号（Alice）登录拿 token，发一条文本消息，然后：

```bash
# 编辑成功
curl -s -X PATCH "http://localhost:8085/api/v1/messages/$MSG_ID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"curl 改后文本"}'
# 期望 {"code":0,...,"data":{"edit_count":1,...}}

# 历史
curl -s "http://localhost:8085/api/v1/messages/$MSG_ID/edits" \
  -H "Authorization: Bearer $TOKEN"
# 期望 versions 两项，末项 current=true

# 相同文本 → 4004
curl -s -X PATCH "http://localhost:8085/api/v1/messages/$MSG_ID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"curl 改后文本"}'
# 期望 {"code":4004,...}
```

Expected: 三条响应与注释一致

- [ ] **Step 9: 停掉后端**

Run: `pnpm dev:stop`

- [ ] **Step 10: Commit**

```bash
git add server/internal/handler/message.go \
        server/internal/handler/message_edit_test.go \
        server/internal/handler/admin.go \
        server/internal/router/router.go
git commit -m "feat(message): 编辑与编辑历史 REST 端点，含管理端取证入口"
```

---

## Task 6：前端 store + 闸门 + API

**Files:**

- Modify: `packages/shared/src/store/messageStore.ts:148,163-258,799-818`
- Modify: `packages/shared/src/utils/messageActions.ts`
- Modify: `packages/shared/src/ws/chatSocket.ts:140-146`
- Modify: `packages/shared/src/hooks/useChatBootstrap.ts:278-292`
- Modify: `packages/shared/src/api/chat.ts:619-628` 与 `mapMessage`
- Test: `packages/shared/src/__tests__/messageEdit.test.ts`

**Interfaces:**

- Consumes: Task 4 的帧字段名（`message_id`/`conversation_id`/`seq`/`text`/`edited_at`/`edit_count`）；Task 5 的端点与业务码
- Produces:
  - `ChatMessage.editCount?: number`
  - `applyEdited(convId: string, messageId: string, text: string, editCount: number): void`
  - `canEdit(msg: ActionableMessage & {isSelf?: boolean; createdAtMs?: number}, nowMs: number): boolean`
  - `editMessage(messageId: string, text: string): Promise<{editedAt: string; editCount: number}>`
  - `fetchMessageEdits(messageId: string): Promise<EditVersion[]>`
  - `EditVersion{version: number; text: string; editedAt: string; current?: boolean}`

- [ ] **Step 1: 写失败测试**

创建 `packages/shared/src/__tests__/messageEdit.test.ts`：

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useMessageStore, RE_EDIT_WINDOW_MS } from "../store/messageStore";
import { canEdit } from "../utils/messageActions";

describe("applyEdited", () => {
  beforeEach(() => {
    useMessageStore.setState({
      messagesByConv: {
        c1: [
          { id: "m1", kind: "text", text: "原文", isSelf: true, seq: 10, status: "sent" },
          { id: "m2", kind: "text", text: "别人的", isSelf: false, seq: 11, status: "sent" },
        ],
      },
    } as never);
  });

  it("就地替换正文并置 edited 与 editCount", () => {
    useMessageStore.getState().applyEdited("c1", "m1", "改后", 1);
    const list = useMessageStore.getState().messagesByConv.c1;
    const m1 = list.find((m) => m.id === "m1");
    expect(m1?.text).toBe("改后");
    expect(m1?.edited).toBe(true);
    expect(m1?.editCount).toBe(1);
  });

  it("不影响同会话其他消息", () => {
    useMessageStore.getState().applyEdited("c1", "m1", "改后", 1);
    const m2 = useMessageStore.getState().messagesByConv.c1.find((m) => m.id === "m2");
    expect(m2?.text).toBe("别人的");
    expect(m2?.edited).toBeUndefined();
  });

  it("未命中的 id 原样返回，不产生新引用", () => {
    const before = useMessageStore.getState().messagesByConv;
    useMessageStore.getState().applyEdited("c1", "不存在", "改后", 1);
    expect(useMessageStore.getState().messagesByConv).toBe(before);
  });

  it("未知会话不抛错", () => {
    expect(() => useMessageStore.getState().applyEdited("no-such", "m1", "x", 1)).not.toThrow();
  });
});

describe("canEdit", () => {
  const base = { id: "m1", kind: "text", isSelf: true, seq: 10, createdAtMs: 1_000_000 };
  const now = base.createdAtMs + 1000;

  it("本人的服务端已确认文本消息在窗口内可编辑", () => {
    expect(canEdit(base, now)).toBe(true);
  });

  it("别人的消息不可编辑", () => {
    expect(canEdit({ ...base, isSelf: false }, now)).toBe(false);
  });

  it("非文本消息不可编辑", () => {
    for (const kind of ["image", "file", "voice", "video", "sticker", "system"]) {
      expect(canEdit({ ...base, kind }, now)).toBe(false);
    }
  });

  it("已撤回不可编辑", () => {
    expect(canEdit({ ...base, recalled: true }, now)).toBe(false);
  });

  it("无 seq（未经服务端确认）不可编辑", () => {
    expect(canEdit({ ...base, seq: undefined }, now)).toBe(false);
  });

  it("超出 5 分钟窗口不可编辑", () => {
    expect(canEdit(base, base.createdAtMs + RE_EDIT_WINDOW_MS + 1)).toBe(false);
  });

  it("恰好在窗口边界仍可编辑", () => {
    expect(canEdit(base, base.createdAtMs + RE_EDIT_WINDOW_MS)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /home/liaojie1314/code/project/yuanchat && LANG=C.UTF-8 pnpm --filter @yuanchat/shared test -- messageEdit`
Expected: FAIL，`applyEdited is not a function` / `canEdit` 导入失败

- [ ] **Step 3: 加 editCount 字段与 applyEdited**

`messageStore.ts` 的 `ChatMessage` 里，`edited?: boolean`（:148）之后追加：

```ts
  /** 累计编辑次数：>0 时「已编辑」角标可点开历史 */
  editCount?: number;
```

`MessageState` 接口里 `applyRecall` 声明（:224）附近追加：

```ts
  /**
   * 就地替换一条消息的正文（服务端 message.edited 帧驱动）。
   *
   * @param convId - 会话 id
   * @param messageId - 服务端消息 id
   * @param text - 编辑后正文
   * @param editCount - 服务端累计编辑次数，供角标判断能否点开历史
   * @remarks 不做乐观翻转 —— 与 applyRecall 同姿态：本端保存后也等帧回来才更新，
   *   保证多端与收件人看到的时序一致。未命中的 id 原样返回，不产生新引用。
   */
  applyEdited: (convId: string, messageId: string, text: string, editCount: number) => void;
```

实现放在 `applyRecall`（:799-818）之后：

```ts
  applyEdited: (convId, messageId, text, editCount) =>
    set((s) => {
      const list = s.messagesByConv[convId];
      if (!list || !list.some((m) => m.id === messageId)) return s;
      return {
        messagesByConv: {
          ...s.messagesByConv,
          [convId]: list.map((m) =>
            m.id === messageId ? { ...m, text: text, edited: true, editCount: editCount } : m,
          ),
        },
      };
    }),
```

- [ ] **Step 4: 加 canEdit**

`packages/shared/src/utils/messageActions.ts` 里，`ActionableMessage` 接口扩展两个可选字段：

```ts
  /** 是否本人发出（编辑判定用） */
  isSelf?: boolean;
  /** 发送时间戳毫秒（编辑窗口判定用） */
  createdAtMs?: number;
```

文件尾追加：

```ts
/** 可编辑窗口：5 分钟。与撤回后「重新编辑」窗口同值，复用同一常量避免两处漂移。 */
export const EDIT_WINDOW_MS = 5 * 60_000;

/**
 * 该消息能否编辑。
 *
 * @param msg - 待判定消息
 * @param nowMs - 当前时间戳毫秒，由调用方在事件回调里传入
 * @returns 本人发出、服务端已确认、未撤回的纯文本且在 5 分钟窗口内时为 true
 * @remarks 判定含时间比较，结果随时间变化，**不能在 render 期缓存** ——
 *   必须在事件回调（右键 / 长按）里现算，同 MessageBubble 的 recallStillOpen。
 *   仅纯文本可编辑：媒体消息 content 无 caption 字段，E2EE 服务端无明文。
 */
export function canEdit(msg: ActionableMessage, nowMs: number): boolean {
  if (!isServerConfirmed(msg)) return false;
  if (!msg.isSelf) return false;
  if (msg.kind !== "text") return false;
  const created = msg.createdAtMs;
  if (!created) return false;
  return nowMs - created <= EDIT_WINDOW_MS;
}
```

**注意**：`EDIT_WINDOW_MS` 定义在 `messageActions.ts` 而非从 `messageStore` 导入 —— utils 不应依赖 store（该文件头注释的既定分层）。值必须与 `RE_EDIT_WINDOW_MS` 保持一致，在两处都写注释互指。

- [ ] **Step 5: 运行测试确认通过**

Run: `LANG=C.UTF-8 pnpm --filter @yuanchat/shared test -- messageEdit`
Expected: 全部 PASS

- [ ] **Step 6: 加 WS 帧类型**

`packages/shared/src/ws/chatSocket.ts` 的 `ServerFrames` 里，`"message.recalled"`（:140-146）之后追加：

```ts
  /** 消息被编辑：就地替换正文，带服务端累计编辑次数 */
  "message.edited": {
    message_id: string;
    conversation_id: string;
    seq: number;
    text: string;
    edited_at: string;
    edit_count: number;
  };
```

- [ ] **Step 7: 加帧 handler**

`packages/shared/src/hooks/useChatBootstrap.ts` 的 `"message.recalled"` handler（:278-292）之后追加：

```ts
    "message.edited": (p) => {
      useMessageStore.getState().applyEdited(p.conversation_id, p.message_id, p.text, p.edit_count);
      // 编辑最后一条时会话列表预览必须同步刷新，否则实时下预览停在旧文本
      // （刷新页面后服务端 GetLastMessage 实时查会给出新文本，此处只补实时缺口）
      const convs = useConversationStore.getState().conversations;
      let target = null;
      for (let i = 0; i < convs.length; i++) {
        if (convs[i].id === p.conversation_id) {
          target = convs[i];
          break;
        }
      }
      if (target && target.lastSeq === p.seq) {
        useConversationStore.getState().updateConversation(p.conversation_id, {
          lastMessage: p.text,
        });
      }
    },
```

**注意**：用 `for` 循环而非 `Array.prototype.find`（`find` 在 Chrome 74 可用，但此处用循环与文件内既有风格一致）；**禁用 `?.`**（es2019 门禁），故用显式 `target &&` 判空。核对 `useConversationStore` 的导入是否已在文件顶部，以及 `lastSeq` 字段名与 `updateConversation` 签名（`conversationStore.ts:99`）。

- [ ] **Step 8: 加 API 函数与 mapMessage 映射**

`packages/shared/src/api/chat.ts` 的 `recallMessage`（:619-628）之后追加：

```ts
/** 消息编辑历史的一个版本 */
export interface EditVersion {
  version: number;
  text: string;
  editedAt: string;
  /** 当前生效版本 */
  current?: boolean;
}

/**
 * 编辑一条文本消息（仅发送者、5 分钟内、累计不超 20 次，窗口判定由后端兜底）。
 *
 * @remarks 前端不做乐观翻转：后端广播 `message.edited` 帧后统一在 applyEdited
 *   更新，保证双端一致（同 recallMessage 的姿态）。
 * @throws ApiError code=4032 超过编辑窗口；code=4033 编辑次数超限；
 *   code=4004 类型不可编辑 / 内容未变化 / 内容为空；403 非发送者；404 消息不存在。
 */
export async function editMessage(
  messageId: string,
  text: string,
): Promise<{ editedAt: string; editCount: number }> {
  const data = await apiPatch<{ edited_at: string; edit_count: number }>(
    "/api/v1/messages/" + messageId,
    { text: text },
  );
  return { editedAt: data.edited_at, editCount: data.edit_count };
}

/**
 * 取一条消息的编辑历史（升序，末项为当前版本）。
 *
 * @throws ApiError 403 非会话成员；404 消息不存在或在清空水位以下。
 */
export async function fetchMessageEdits(messageId: string): Promise<EditVersion[]> {
  const data = await apiGet<{
    versions: Array<{ version: number; text: string; edited_at: string; current?: boolean }>;
  }>("/api/v1/messages/" + messageId + "/edits");
  const out: EditVersion[] = [];
  for (let i = 0; i < data.versions.length; i++) {
    const v = data.versions[i];
    out.push({ version: v.version, text: v.text, editedAt: v.edited_at, current: v.current });
  }
  return out;
}
```

在 `mapMessage` 里补映射（先 `grep -n "function mapMessage" -A 40 packages/shared/src/api/chat.ts` 找到构造 `ChatMessage` 的对象字面量），追加：

```ts
    edited: !!raw.edited_at,
    editCount: raw.edit_count || 0,
```

并确认 `mapMessage` 入参的原始类型声明里加上 `edited_at?: string | null; edit_count?: number;`。

- [ ] **Step 9: 跑 shared 全量测试**

Run: `LANG=C.UTF-8 pnpm --filter @yuanchat/shared test`
Expected: 全绿（含既有用例）

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src/store/messageStore.ts \
        packages/shared/src/utils/messageActions.ts \
        packages/shared/src/ws/chatSocket.ts \
        packages/shared/src/hooks/useChatBootstrap.ts \
        packages/shared/src/api/chat.ts \
        packages/shared/src/__tests__/messageEdit.test.ts
git commit -m "feat(message): 共享层编辑 action、闸门判定与 API 客户端"
```

---

## Task 7：i18n 四语 + MSW mock

**Files:**

- Modify: `packages/design-system/src/i18n/locales/{zh-CN,en-US,ja-JP,ko-KR}.json`
- Modify: `packages/shared/src/mocks/handlers.ts:758-763`

**Interfaces:**

- Consumes: Task 5 的端点与业务码；Task 6 的 API 函数
- Produces: 11 个 i18n key；三个端点的 MSW mock

- [ ] **Step 1: 四份 locale 加 key**

在每份文件的 `chat.message.reEditExpired` 之后（约 :241）插入。**四份都要加，缺一个 `check:i18n` 就红**：

zh-CN：

```json
  "chat.message.edit": "编辑",
  "chat.message.editing": "正在编辑",
  "chat.message.editCancel": "取消编辑",
  "chat.message.editSave": "保存",
  "chat.message.editExpired": "超过 5 分钟后不能编辑",
  "chat.message.editLimitReached": "该消息编辑次数已达上限",
  "chat.message.editEmpty": "内容不能为空",
  "chat.message.editHistory": "编辑记录",
  "chat.message.editVersion": "第 %{n} 版",
  "chat.message.editCurrent": "当前版本",
  "chat.message.editHistoryError": "编辑记录加载失败",
```

en-US：

```json
  "chat.message.edit": "Edit",
  "chat.message.editing": "Editing",
  "chat.message.editCancel": "Cancel edit",
  "chat.message.editSave": "Save",
  "chat.message.editExpired": "Cannot edit after 5 minutes",
  "chat.message.editLimitReached": "Edit limit reached for this message",
  "chat.message.editEmpty": "Content cannot be empty",
  "chat.message.editHistory": "Edit history",
  "chat.message.editVersion": "Version %{n}",
  "chat.message.editCurrent": "Current",
  "chat.message.editHistoryError": "Failed to load edit history",
```

ja-JP：

```json
  "chat.message.edit": "編集",
  "chat.message.editing": "編集中",
  "chat.message.editCancel": "編集をキャンセル",
  "chat.message.editSave": "保存",
  "chat.message.editExpired": "5 分を過ぎたため編集できません",
  "chat.message.editLimitReached": "このメッセージの編集回数が上限に達しました",
  "chat.message.editEmpty": "内容を入力してください",
  "chat.message.editHistory": "編集履歴",
  "chat.message.editVersion": "バージョン %{n}",
  "chat.message.editCurrent": "現在のバージョン",
  "chat.message.editHistoryError": "編集履歴の読み込みに失敗しました",
```

ko-KR：

```json
  "chat.message.edit": "편집",
  "chat.message.editing": "편집 중",
  "chat.message.editCancel": "편집 취소",
  "chat.message.editSave": "저장",
  "chat.message.editExpired": "5분이 지나면 편집할 수 없습니다",
  "chat.message.editLimitReached": "이 메시지의 편집 횟수가 한도에 도달했습니다",
  "chat.message.editEmpty": "내용을 입력하세요",
  "chat.message.editHistory": "편집 기록",
  "chat.message.editVersion": "버전 %{n}",
  "chat.message.editCurrent": "현재 버전",
  "chat.message.editHistoryError": "편집 기록을 불러오지 못했습니다",
```

**不要加 `chat.message.edited`** —— 四语已存在（:326）。

- [ ] **Step 2: 跑 i18n 门禁**

Run: `node scripts/check-i18n.mjs`
Expected: 报**死键**（新 key 还没被代码使用）。这是预期的 —— 记下报告内容，Task 9/10 用上这些 key 后必须回来重跑至全绿。

若门禁把死键判为硬失败而阻断，则把本 Step 移到 Task 10 之后执行，Step 1 的 key 先加着不提交。

- [ ] **Step 3: 补三个端点的 MSW mock**

`packages/shared/src/mocks/handlers.ts` 的 `download-url` handler（:758-763）附近插入。沿用该文件的三行注释块 + `apiOk`/`apiError`/`delay` 惯例：

```ts
  // --------------------------------------------------
  // 消息 — 编辑正文（四态：正常 / 窗口过期 / 次数超限 / 延迟）
  // PATCH /api/v1/messages/:id
  // --------------------------------------------------
  http.patch("http://localhost:8085/api/v1/messages/:id", async ({ request }) => {
    await delay(200);
    const url = new URL(request.url);
    // ?error= 仅 mock 支持，供错误态联调（真实后端忽略该参数）
    const err = url.searchParams.get("error");
    if (err === "window") return apiError(4032, "edit window expired");
    if (err === "limit") return apiError(4033, "edit limit exceeded");
    const body = (await request.json()) as { text?: string };
    if (!body.text || body.text.trim() === "") return apiError(4004, "message not editable");
    return apiOk({ edited_at: new Date().toISOString(), edit_count: 1 });
  }),

  // --------------------------------------------------
  // 消息 — 编辑历史（四态：正常 / 空 / 错误 / 延迟）
  // GET /api/v1/messages/:id/edits
  // --------------------------------------------------
  http.get("http://localhost:8085/api/v1/messages/:id/edits", async ({ request }) => {
    // 300ms 延迟：让骨架屏在演示与 E2E 里真的能看见
    await delay(300);
    const url = new URL(request.url);
    if (url.searchParams.get("error") === "1") return apiError(500, "load edit history failed");
    if (url.searchParams.get("empty") === "1") return apiOk({ versions: [] });
    return apiOk({
      versions: [
        { version: 1, text: "最初发出的版本", edited_at: "2026-09-05T09:58:00Z" },
        { version: 2, text: "第一次修改", edited_at: "2026-09-05T09:59:00Z" },
        { version: 3, text: "当前版本", edited_at: "2026-09-05T10:00:00Z", current: true },
      ],
    });
  }),

  // --------------------------------------------------
  // 消息 — 撤回（此前缺失 mock，随编辑功能一并补上）
  // POST /api/v1/messages/:id/recall
  // --------------------------------------------------
  http.post("http://localhost:8085/api/v1/messages/:id/recall", async ({ request }) => {
    await delay(150);
    if (new URL(request.url).searchParams.get("error") === "expired") {
      return apiError(4031, "recall window expired");
    }
    return apiOk({ message: "recalled" });
  }),
```

**注意 handler 顺序**：MSW 按注册顺序匹配，`PATCH /messages/:id` 的 `:id` 通配可能吃掉别的路径。确认 `handlers` 数组里更具体的路径（如 `/messages/search`）注册在它**之前**；`/messages/:id/edits` 是三段路径，与两段的 `/messages/:id` 不冲突。

- [ ] **Step 4: 修 download-url 按后缀分派（🟡 债收口）**

`handlers.ts:760-763` 现在对任何 key 都回 SVG，导致 mock 模式点播 demo 语音/视频报「播放失败」。替换为：

```ts
  http.get("http://localhost:8085/api/v1/files/download-url", ({ request }) => {
    const key = new URL(request.url).searchParams.get("key") ?? "";
    if (!key) return apiError(40010, "key required");
    return apiOk({ url: mockObjectDataUrl(key), expires_in: 3600 });
  }),
```

并在 `stickerDataUrl`（:181）附近新增：

```ts
/**
 * 按对象 key 的后缀给出可用的 data URL。
 *
 * @remarks mock 模式没有 MinIO，此前对任何 key 都回内联 SVG，导致点播 demo
 *   语音/视频时 `<audio>`/`<video>` 拿到图片必然报错、toast「播放失败」。
 *   这里按后缀分派：音频给一段极短的静音 WAV，视频暂时也给静音音频
 *   （只为让播放器不报错，演示中不会有画面），其余仍给 SVG 贴纸。
 *   data URL 均为占位，不是真实媒体内容。
 */
function mockObjectDataUrl(key: string): string {
  const lower = key.toLowerCase();
  const isAudio =
    lower.indexOf(".webm") >= 0 ||
    lower.indexOf(".mp3") >= 0 ||
    lower.indexOf(".m4a") >= 0 ||
    lower.indexOf(".wav") >= 0;
  const isVideo = lower.indexOf(".mp4") >= 0;
  if (isAudio || isVideo) return SILENT_WAV_DATA_URL;
  return stickerDataUrl(key);
}

/**
 * 0.1 秒静音单声道 8kHz WAV 的 data URL（44 字节头 + 极少量样本）。
 * 供 mock 模式的语音/视频占位，使播放器能成功 decode 而不报错。
 */
const SILENT_WAV_DATA_URL =
  "data:audio/wav;base64,UklGRiwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQgAAACAgICAgICAgA==";
```

**注意**：`.webm` 既可能是语音（`files/*.webm`）也可能是视频，都回音频占位即可（播放器不报错优先）。上面的 base64 需实测能被 Chrome decode —— 若不行，用 Node 生成一个最小合法 WAV 再替换。

- [ ] **Step 5: 验证 mock 模式语音可播**

Run: `pnpm dev:web:mock`，浏览器打开 `http://localhost:5173`，登录进第一个会话，点播 demo 语音消息。
Expected: 不再出现「播放失败」toast（可能无声，因为是静音占位）

Run: `pnpm dev:stop`

- [ ] **Step 6: Commit**

```bash
git add packages/design-system/src/i18n/locales/ \
        packages/shared/src/mocks/handlers.ts
git commit -m "feat(i18n): 消息编辑四语文案；fix(mock): download-url 按后缀给可播放占位"
```

---

## Task 8：golden 契约前端消费

**Files:**

- Create: `packages/shared/src/__tests__/serverFramesGolden.test.ts`

**Interfaces:**

- Consumes: Task 4 的 `contracts/server-frames.golden.json`；Task 6 的 `applyEdited`
- Produces: 双端契约一致性保证

- [ ] **Step 1: 写测试**

创建 `packages/shared/src/__tests__/serverFramesGolden.test.ts`。参考既有 `messageSendGolden.test.ts:22-25` 的相对路径写法：

```ts
import { describe, expect, it, beforeEach } from "vitest";
import golden from "../../../../contracts/server-frames.golden.json";
import { useMessageStore } from "../store/messageStore";

/**
 * 服务端 → 客户端帧的契约一致性：把 golden 里的 payload 原样喂给前端消费逻辑，
 * 断言 store 状态按契约语义变化。
 *
 * 与 Go 侧 golden_server_frames_test.go 读同一份文件 —— 任一端改了字段名，
 * 两边有一侧会红。
 */
interface GoldenCase {
  name: string;
  frame: { type: string; payload: Record<string, unknown> };
}

const cases = (golden as { cases: GoldenCase[] }).cases;

describe("server-frames golden 契约", () => {
  it("契约含至少两个用例（message.edited 与 message.recalled）", () => {
    const types = cases.map((c) => c.frame.type);
    expect(types).toContain("message.edited");
    expect(types).toContain("message.recalled");
  });

  describe("message.edited", () => {
    const c = cases.find((x) => x.frame.type === "message.edited");

    beforeEach(() => {
      const p = c!.frame.payload as { conversation_id: string; message_id: string };
      useMessageStore.setState({
        messagesByConv: {
          [p.conversation_id]: [
            {
              id: p.message_id,
              kind: "text",
              text: "编辑前",
              isSelf: true,
              seq: 42,
              status: "sent",
            },
          ],
        },
      } as never);
    });

    it("payload 字段齐全且类型正确", () => {
      const p = c!.frame.payload;
      expect(typeof p.message_id).toBe("string");
      expect(typeof p.conversation_id).toBe("string");
      expect(typeof p.seq).toBe("number");
      expect(typeof p.text).toBe("string");
      expect(typeof p.edited_at).toBe("string");
      expect(typeof p.edit_count).toBe("number");
    });

    it("喂进 applyEdited 后正文被替换、edited 置位", () => {
      const p = c!.frame.payload as {
        conversation_id: string;
        message_id: string;
        text: string;
        edit_count: number;
      };
      useMessageStore.getState().applyEdited(p.conversation_id, p.message_id, p.text, p.edit_count);
      const m = useMessageStore.getState().messagesByConv[p.conversation_id][0];
      expect(m.text).toBe(p.text);
      expect(m.edited).toBe(true);
      expect(m.editCount).toBe(p.edit_count);
    });
  });

  describe("message.recalled", () => {
    const c = cases.find((x) => x.frame.type === "message.recalled");

    it("payload 字段齐全且类型正确", () => {
      const p = c!.frame.payload;
      expect(typeof p.message_id).toBe("string");
      expect(typeof p.conversation_id).toBe("string");
      expect(typeof p.seq).toBe("number");
      expect(typeof p.operator_id).toBe("string");
      expect(typeof p.operator_nickname).toBe("string");
    });

    it("喂进 applyRecall 后 recalled 置位", () => {
      const p = c!.frame.payload as {
        conversation_id: string;
        message_id: string;
        operator_nickname: string;
      };
      useMessageStore.setState({
        messagesByConv: {
          [p.conversation_id]: [
            {
              id: p.message_id,
              kind: "text",
              text: "撤回前",
              isSelf: true,
              seq: 41,
              status: "sent",
            },
          ],
        },
      } as never);
      useMessageStore.getState().applyRecall(p.conversation_id, p.message_id, p.operator_nickname);
      const m = useMessageStore.getState().messagesByConv[p.conversation_id][0];
      expect(m.recalled).toBe(true);
    });
  });
});
```

- [ ] **Step 2: 运行测试**

Run: `LANG=C.UTF-8 pnpm --filter @yuanchat/shared test -- serverFramesGolden`
Expected: 全部 PASS

若 JSON 导入报错，检查 `packages/shared/vitest.config.ts` 是否需要 `resolveJsonModule`（既有 `messageSendGolden.test.ts` 已这么导入，应无需额外配置）。

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/__tests__/serverFramesGolden.test.ts
git commit -m "test(ws): 服务端帧黄金契约前端消费断言"
```

---

## Task 9：编辑历史弹层

**Files:**

- Create: `packages/ui/src/MessageEditHistoryDialog.tsx`
- Create: `packages/ui/src/__tests__/MessageEditHistoryDialog.test.tsx`
- Modify: `packages/ui/src/index.ts`（导出）

**Interfaces:**

- Consumes: Task 6 的 `fetchMessageEdits` / `EditVersion`；Task 7 的 i18n key
- Produces: `<MessageEditHistoryDialog messageId={string} open={boolean} onClose={() => void} />`

- [ ] **Step 1: 写失败测试**

创建 `packages/ui/src/__tests__/MessageEditHistoryDialog.test.tsx`。参考 `packages/ui/src/__tests__/` 里既有组件测试的 mock 方式（该包未引 msw，用 `vi.mock("@yuanchat/shared")`，同相册组件测试的既有取舍）：

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MessageEditHistoryDialog } from "../MessageEditHistoryDialog";

const fetchMessageEdits = vi.fn();

vi.mock("@yuanchat/shared", () => ({
  fetchMessageEdits: (id: string) => fetchMessageEdits(id),
}));

describe("MessageEditHistoryDialog", () => {
  beforeEach(() => {
    fetchMessageEdits.mockReset();
  });

  it("加载态显示骨架屏", () => {
    fetchMessageEdits.mockReturnValue(new Promise(() => {}));
    render(<MessageEditHistoryDialog messageId="m1" open onClose={() => {}} />);
    expect(screen.getByTestId("edit-history-skeleton")).toBeInTheDocument();
  });

  it("正常态按版本升序列出，末项标注当前版本", async () => {
    fetchMessageEdits.mockResolvedValue([
      { version: 1, text: "第一版", editedAt: "2026-09-05T09:58:00Z" },
      { version: 2, text: "当前版", editedAt: "2026-09-05T10:00:00Z", current: true },
    ]);
    render(<MessageEditHistoryDialog messageId="m1" open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("第一版")).toBeInTheDocument());
    expect(screen.getByText("当前版")).toBeInTheDocument();
    expect(screen.getByTestId("edit-history-current")).toBeInTheDocument();
  });

  it("错误态显示错误文案与重试按钮", async () => {
    fetchMessageEdits.mockRejectedValue(new Error("boom"));
    render(<MessageEditHistoryDialog messageId="m1" open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("edit-history-error")).toBeInTheDocument());
    expect(screen.getByTestId("edit-history-retry")).toBeInTheDocument();
  });

  it("空态显示空提示", async () => {
    fetchMessageEdits.mockResolvedValue([]);
    render(<MessageEditHistoryDialog messageId="m1" open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("edit-history-empty")).toBeInTheDocument());
  });

  it("open 为 false 时不请求", () => {
    render(<MessageEditHistoryDialog messageId="m1" open={false} onClose={() => {}} />);
    expect(fetchMessageEdits).not.toHaveBeenCalled();
  });
});
```

**注意**：`vi.mock("@yuanchat/shared")` 会把整个包替换掉，若组件还用到该包的别的导出（如 i18n），mock 工厂里要一并提供。先看组件实际 import 再定 mock 形状。i18n 的 `useTranslation` 通常来自 `react-i18next`，需另行 mock 或用真实 i18n 实例 —— 照 `packages/ui/src/__tests__/` 里既有组件测试的做法。

- [ ] **Step 2: 运行测试确认失败**

Run: `LANG=C.UTF-8 pnpm --filter @yuanchat/ui test -- MessageEditHistoryDialog`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现组件**

创建 `packages/ui/src/MessageEditHistoryDialog.tsx`。**约束**：圆角 ≤ `rounded-lg`、禁 `?.`/`??`、文案全走 `t()`、骨架屏固定高度防 CLS：

```tsx
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchMessageEdits, type EditVersion } from "@yuanchat/shared";

/** 编辑历史弹层的属性 */
export interface MessageEditHistoryDialogProps {
  /** 目标消息的服务端 id */
  messageId: string;
  /** 是否打开；false 时不发请求 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
}

/**
 * 消息编辑历史弹层：按版本升序列出全部版本，末项为当前生效版本。
 *
 * @remarks 四态齐全（加载骨架 / 正常 / 空 / 错误+重试）。骨架条固定高度，
 *   避免加载完成时列表高度跳变（CLS）。
 *   移动端的返回键拦截由调用方在打开时注册 —— 组件本身不碰全局拦截栈，
 *   否则与 ChatWindow 的其他浮层争抢注册顺序。
 */
export function MessageEditHistoryDialog(props: MessageEditHistoryDialogProps) {
  const { messageId, open, onClose } = props;
  const { t } = useTranslation();
  const [versions, setVersions] = useState<EditVersion[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    fetchMessageEdits(messageId)
      .then((list) => {
        setVersions(list);
        setLoading(false);
      })
      .catch(() => {
        setFailed(true);
        setLoading(false);
      });
  }, [messageId]);

  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);

  // Esc 关闭：与仓内其他浮层一致的键盘可达性
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("chat.message.editHistory")}
      onClick={onClose}
    >
      <div
        className="bg-surface w-full max-w-md rounded-lg p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-fg mb-3 text-sm font-medium">{t("chat.message.editHistory")}</h2>

        {loading && (
          <div data-testid="edit-history-skeleton" className="space-y-2">
            <div className="bg-muted h-12 animate-pulse rounded-lg" />
            <div className="bg-muted h-12 animate-pulse rounded-lg" />
          </div>
        )}

        {!loading && failed && (
          <div data-testid="edit-history-error" className="py-6 text-center">
            <p className="text-fg-muted mb-3 text-sm">{t("chat.message.editHistoryError")}</p>
            <button
              data-testid="edit-history-retry"
              type="button"
              onClick={load}
              className="border-border text-fg rounded-lg border px-3 py-1 text-sm"
            >
              {t("common.retry")}
            </button>
          </div>
        )}

        {!loading && !failed && versions !== null && versions.length === 0 && (
          <p data-testid="edit-history-empty" className="text-fg-muted py-6 text-center text-sm">
            {t("common.empty")}
          </p>
        )}

        {!loading && !failed && versions !== null && versions.length > 0 && (
          <ol className="space-y-2">
            {versions.map((v) => (
              <li
                key={v.version}
                data-testid={v.current ? "edit-history-current" : "edit-history-item"}
                className="border-border rounded-lg border p-2"
              >
                <div className="text-fg-muted mb-1 flex items-center gap-2 text-xs">
                  <span>{t("chat.message.editVersion", { n: v.version })}</span>
                  {v.current && (
                    <span className="text-accent">{t("chat.message.editCurrent")}</span>
                  )}
                </div>
                <p className="text-fg text-sm break-words">{v.text}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
```

**注意**：

- `common.retry` / `common.empty` 需确认四语已存在 —— Run `grep -n '"common.retry"\|"common.empty"' packages/design-system/src/i18n/locales/zh-CN.json`。不存在则改用已有的等价 key，或在 Task 7 的 key 列表里补上。
- 颜色工具类必须在色板内（`pnpm check:theme` 门禁）—— 上面的 `bg-surface`/`text-fg`/`text-fg-muted`/`border-border`/`bg-muted`/`text-accent` 需逐个核对是否在 `packages/design-system` 的色板里，不在则换成实际存在的类名。

- [ ] **Step 4: 运行测试确认通过**

Run: `LANG=C.UTF-8 pnpm --filter @yuanchat/ui test -- MessageEditHistoryDialog`
Expected: 五个用例全 PASS

- [ ] **Step 5: 导出组件**

`packages/ui/src/index.ts` 加：

```ts
export { MessageEditHistoryDialog } from "./MessageEditHistoryDialog";
export type { MessageEditHistoryDialogProps } from "./MessageEditHistoryDialog";
```

- [ ] **Step 6: 跑主题门禁**

Run: `pnpm check:theme`
Expected: 通过（颜色类都在色板内）

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/MessageEditHistoryDialog.tsx \
        packages/ui/src/__tests__/MessageEditHistoryDialog.test.tsx \
        packages/ui/src/index.ts
git commit -m "feat(ui): 消息编辑历史弹层（四态 + Esc 关闭）"
```

---

## Task 10：气泡菜单 + 编辑态编排

**Files:**

- Modify: `packages/ui/src/MessageBubble.tsx:174-181,570-641,688`
- Modify: `packages/ui/src/ChatWindow.tsx:437-520`
- Modify: `packages/ui/src/Composer.tsx:132-138`

**Interfaces:**

- Consumes: Task 6 的 `canEdit`/`editMessage`；Task 9 的 `MessageEditHistoryDialog`；Task 7 的 i18n key
- Produces: 用户可见的完整编辑流

- [ ] **Step 1: MessageBubble 加编辑菜单项与可点角标**

`MessageBubble.tsx` 的 props 接口加：

```tsx
  /** 点击编辑菜单项：进入编辑态（父层把原文送进 Composer） */
  onEdit?: (msg: ChatMessage) => void;
  /** 点击「已编辑」角标：打开历史弹层 */
  onShowEditHistory?: (messageId: string) => void;
```

资格判定区（:162-171）加：

```tsx
// 编辑资格含时间比较，必须在事件里现算（同 recallStillOpen）
const editStillOpen = () => !!onEdit && canEdit(msg, Date.now());
```

`hasMenuItem`（:174-181）的判定纳入编辑（照该函数现有形状加一项，确保「只有编辑可用时也能弹菜单」）。

菜单项注册区（:~570-641），在「引用」之后、「转发」之前插入：

```tsx
{
  editStillOpen() && (
    <button
      type="button"
      role="menuitem"
      data-testid="msg-menu-edit"
      className={menuItemClass}
      onClick={() => {
        closeMenu();
        if (onEdit) onEdit(msg);
      }}
    >
      {t("chat.message.edit")}
    </button>
  );
}
```

`menuItemClass` / `closeMenu` 用该区块既有的同名变量或写法 —— **先读 :580-594 的「复制」「引用」两项，照抄其确切结构与类名**。

角标（:688）改为：

```tsx
{
  msg.edited &&
    (msg.editCount && msg.editCount > 0 && onShowEditHistory ? (
      <button
        type="button"
        data-testid="msg-edited-badge"
        className="underline-offset-2 opacity-65 hover:underline"
        aria-label={t("chat.message.editHistory")}
        onClick={() => onShowEditHistory(msg.id)}
      >
        · {t("chat.message.edited")}
      </button>
    ) : (
      <span className="opacity-65">· {t("chat.message.edited")}</span>
    ));
}
```

导入 `canEdit`：`import { canEdit } from "@yuanchat/shared";`（确认该函数已在 shared 的 `index.ts` 导出，若无则补导出）。

- [ ] **Step 2: ChatWindow 编排编辑态**

`ChatWindow.tsx` 加 state 与 handler：

```tsx
/** 正在编辑的消息 id；null 表示非编辑态 */
const [editingId, setEditingId] = useState<string | null>(null);
/** 编辑历史弹层的目标消息 id */
const [historyId, setHistoryId] = useState<string | null>(null);

/**
 * 进入编辑态：把原文送进 Composer，并记住正在编辑哪一条。
 */
const handleEdit = useCallback(
  (msg: ChatMessage) => {
    if (!msg.text) return;
    setEditingId(msg.id);
    setComposerInsert(msg.text);
  },
  [setComposerInsert],
);

/** 退出编辑态并清空输入框 */
const handleCancelEdit = useCallback(() => {
  setEditingId(null);
  setComposerInsert("");
}, [setComposerInsert]);

/**
 * 保存编辑：不做乐观翻转，等 message.edited 帧回来再更新气泡。
 */
const handleSaveEdit = useCallback(
  async (text: string) => {
    if (!editingId) return;
    try {
      await editMessage(editingId, text);
      setEditingId(null);
      setComposerInsert("");
    } catch (e) {
      const code = (e as { code?: number }).code;
      if (code === 4032) toast(t("chat.message.editExpired"));
      else if (code === 4033) toast(t("chat.message.editLimitReached"));
      else if (code === 4004) toast(t("chat.message.editEmpty"));
      else toast(t("common.error"));
      setEditingId(null);
      setComposerInsert("");
    }
  },
  [editingId, setComposerInsert, t],
);
```

**注意**：`setComposerInsert` 与 `toast` 的确切来源与签名要先核对 —— Run `grep -n "setComposerInsert\|toast(" packages/ui/src/ChatWindow.tsx | head -10`，照既有 `handleRecall`（:236-244）的错误处理与 toast 用法写。`ApiError` 的 code 读法照 `handleRecall` 里对 4031 的判断抄。

`<MessageBubble>` 的 props 加（照 :452-458 的三元形状）：

```tsx
              onEdit={handleEdit}
              onShowEditHistory={(id) => setHistoryId(id)}
```

在组件返回的 JSX 末尾（与其他浮层同级）加弹层：

```tsx
{
  historyId && (
    <MessageEditHistoryDialog messageId={historyId} open onClose={() => setHistoryId(null)} />
  );
}
```

**移动端返回键**：弹层打开时注册拦截器。照该文件里其他全屏浮层（如相册视图）的 `registerBackInterceptor` 用法抄 —— Run `grep -n "registerBackInterceptor" packages/ui/src/*.tsx` 找到范例。**不注册的话按返回会被当成「已在标签根页面」而退出应用**。

- [ ] **Step 3: Composer 支持编辑态**

`Composer.tsx` props 加：

```tsx
  /** 非空表示编辑态：显示提示条，发送按钮语义变「保存」 */
  editingMessageId?: string | null;
  /** 取消编辑 */
  onCancelEdit?: () => void;
  /** 保存编辑（编辑态下替代 onSend） */
  onSaveEdit?: (text: string) => void;
```

在输入区上方加提示条：

```tsx
{
  editingMessageId && (
    <div
      data-testid="composer-editing-hint"
      className="border-border text-fg-muted flex items-center justify-between border-b px-3 py-1.5 text-xs"
    >
      <span>{t("chat.message.editing")}</span>
      <button
        type="button"
        data-testid="composer-cancel-edit"
        onClick={onCancelEdit}
        className="hover:text-fg"
      >
        {t("chat.message.editCancel")}
      </button>
    </div>
  );
}
```

提交逻辑分派：编辑态走 `onSaveEdit`，否则走既有 `onSend`。发送按钮文案在编辑态显示 `t("chat.message.editSave")`。Esc 键在编辑态触发 `onCancelEdit`。

**先读 `Composer.tsx` 的 submit 路径**（Enter 键与按钮两处入口），确保两处都分派到 `onSaveEdit`。

- [ ] **Step 4: 跑 ui 全量测试**

Run: `LANG=C.UTF-8 pnpm --filter @yuanchat/ui test`
Expected: 全绿（既有 MessageBubble / ChatWindow / Composer 测试不能被破坏）

- [ ] **Step 5: 跑 i18n 门禁（此时新 key 已被使用）**

Run: `node scripts/check-i18n.mjs`
Expected: **全绿**（Task 7 加的 11 个 key 现在都有代码引用，死键消除）

若仍报死键，说明某个 key 没用上 —— 要么补上用法，要么从四份 locale 删掉。

- [ ] **Step 6: 两端 tsc**

Run: `cd apps/web && npx tsc --noEmit && cd ../desktop && npx tsc --noEmit`
Expected: 零错误

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/MessageBubble.tsx \
        packages/ui/src/ChatWindow.tsx \
        packages/ui/src/Composer.tsx
git commit -m "feat(ui): 消息编辑菜单入口、Composer 编辑态与历史弹层接入"
```

---

## Task 11：引用块 REST 回填（既有缺陷收口）

**Files:**

- Modify: `packages/shared/src/api/chat.ts`（`mapMessage`）
- Test: `packages/shared/src/__tests__/messageEdit.test.ts`（追加）

**Interfaces:**

- Consumes: Task 6 的 `mapMessage` 改动
- Produces: 刷新页面后引用块不再消失

**为什么必须现在做**：`quote` 只在 `sendText` 时由前端填入（发送时 UI 快照），REST 历史路径从不产出 —— 刷新页面后引用块**整体消失**。编辑功能上线后，这个既有 bug 会被误当成 K1 引入的回归。

- [ ] **Step 1: 写失败测试**

在 `packages/shared/src/__tests__/messageEdit.test.ts` 追加：

```ts
describe("mapMessage 引用回填", () => {
  it("本地已有被引用消息时，从 store 回填 quote", () => {
    // 先让 store 里有被引用的原消息
    useMessageStore.setState({
      messagesByConv: {
        c1: [{ id: "src", kind: "text", text: "被引用的原文", isSelf: false, seq: 5 }],
      },
    } as never);

    // 模拟 REST 历史返回一条带 reply_to_id 但无 quote 的消息
    const mapped = mapMessageForTest({
      id: "m9",
      conversation_id: "c1",
      seq: 9,
      message_type: 1,
      content: '{"text":"回复内容"}',
      reply_to_id: "src",
      sender_id: "u2",
      created_at: new Date().toISOString(),
    });

    expect(mapped.replyToId).toBe("src");
    expect(mapped.quote).toBeDefined();
    expect(mapped.quote!.messageId).toBe("src");
  });

  it("被引用消息不在本地时 quote 保持缺省（不编造）", () => {
    useMessageStore.setState({ messagesByConv: { c1: [] } } as never);
    const mapped = mapMessageForTest({
      id: "m9",
      conversation_id: "c1",
      seq: 9,
      message_type: 1,
      content: '{"text":"回复内容"}',
      reply_to_id: "not-local",
      sender_id: "u2",
      created_at: new Date().toISOString(),
    });
    expect(mapped.replyToId).toBe("not-local");
    expect(mapped.quote).toBeUndefined();
  });
});
```

`mapMessageForTest` 是对 `mapMessage` 的导出包装 —— **先确认 `mapMessage` 是否已导出**（Run `grep -n "export function mapMessage\|function mapMessage" packages/shared/src/api/chat.ts`）。若是私有的，为可测性加 `export`（并在 JSDoc 注明「导出仅为测试可见性」），测试直接 import 它，删掉 `mapMessageForTest` 这层包装。原始入参类型按 `mapMessage` 的实际签名调整。

- [ ] **Step 2: 运行测试确认失败**

Run: `LANG=C.UTF-8 pnpm --filter @yuanchat/shared test -- messageEdit`
Expected: 引用回填两个用例 FAIL

- [ ] **Step 3: 实现回填**

在 `mapMessage` 里，`replyToId` 赋值之后加：

```ts
// REST 历史路径此前从不产出 quote（quote 只在发送时由前端填入），
// 导致刷新后引用块整体消失。这里在本地 store 已有原消息时惰性拼装快照，
// 兑现 ChatMessage.replyToId 注释里承诺的「惰性拉取」。
// 拿不到原消息时保持 undefined —— 不编造内容。
if (raw.reply_to_id) {
  const local = findLocalMessage(raw.conversation_id, raw.reply_to_id);
  if (local) {
    out.quote = {
      messageId: local.id,
      excerpt: quoteExcerptOf(local),
      senderName: local.senderName,
    };
  }
}
```

`findLocalMessage` 在同文件加私有 helper（从 `useMessageStore.getState().messagesByConv` 里查，用 for 循环不用 `find`/`?.`）。`QuoteRef` 的确切字段（`messageId`/`excerpt`/`senderName`）先核对 `messageStore.ts:41-46`，`quoteExcerptOf` 的签名核对 `utils/messagePreview.ts:63-73`。

**注意循环依赖**：`api/chat.ts` 若尚未 import `messageStore`，加 import 前先确认不会形成循环（store 也 import api）。若有循环，改为在 `mapMessage` 加一个可选参数由调用方注入本地消息查找函数。

- [ ] **Step 4: 运行测试确认通过**

Run: `LANG=C.UTF-8 pnpm --filter @yuanchat/shared test -- messageEdit`
Expected: 全部 PASS

- [ ] **Step 5: 手动验证刷新后引用块保留**

Run: `pnpm dev:web`（真后端）。发一条引用回复，刷新页面。
Expected: 引用块仍在（此前会消失）

Run: `pnpm dev:stop`

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/api/chat.ts \
        packages/shared/src/__tests__/messageEdit.test.ts
git commit -m "fix(chat): REST 历史路径回填引用快照，修刷新后引用块消失"
```

---

## Task 12：E2E

**Files:**

- Create: `apps/web/e2e/message-edit.spec.ts`

**Interfaces:**

- Consumes: Task 7 的 MSW mock；Task 10 的 `data-testid`
- Produces: 编辑流的端到端回归保护

- [ ] **Step 1: 确认没有残留 dev server**

Run: `pnpm dev:stop`

**为什么**：Playwright 的 `reuseExistingServer` 会接管已在 5173 的进程；若那进程是用 `VITE_ENABLE_MOCK=false` 起的，全部用例会齐刷刷 30s 超时，看起来像代码全坏（A8 沉淀的坑）。

- [ ] **Step 2: 写 spec**

创建 `apps/web/e2e/message-edit.spec.ts`，照 `apps/web/e2e/media.spec.ts` 的骨架：

```ts
/**
 * 消息编辑 E2E（mock 模式）。
 *
 * 前提：MSW mock 提供 PATCH /messages/:id 与 GET /messages/:id/edits。
 * locale 固定 zh-CN（playwright.config.ts），故断言用中文文案。
 *
 * 刻意不覆盖：真实 WS 帧驱动的跨端同步（mock 模式无 WS 帧回放，
 * 该路径由真后端手工实测 + shared 包单测覆盖）。
 */
import { test, expect, type Page } from "@playwright/test";
import { setAuth } from "./fixtures/auth.fixture";
import { waitForMSW } from "./utils/msw";

async function openFirstConversation(page: Page) {
  await page.goto("/");
  await waitForMSW(page);
  await page.locator('[data-testid^="conv-item-"]').first().click();
}

/** 右键第一条自己发的文本消息，返回其气泡定位器 */
async function openMenuOnOwnText(page: Page) {
  const bubble = page.locator('[data-kind="text"][data-self="true"]').first();
  await bubble.click({ button: "right" });
  return bubble;
}

test.describe("消息编辑", () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page);
    await openFirstConversation(page);
  });

  test("自己的文本消息菜单里有编辑项", async ({ page }) => {
    await openMenuOnOwnText(page);
    await expect(page.getByTestId("msg-menu-edit")).toBeVisible();
  });

  test("点编辑进入编辑态，原文填入输入框", async ({ page }) => {
    const bubble = await openMenuOnOwnText(page);
    const original = (await bubble.innerText()).trim();
    await page.getByTestId("msg-menu-edit").click();

    await expect(page.getByTestId("composer-editing-hint")).toBeVisible();
    const input = page.locator("textarea").first();
    await expect(input).toHaveValue(new RegExp(original.slice(0, 6)));
  });

  test("取消编辑后提示条消失、输入框清空", async ({ page }) => {
    await openMenuOnOwnText(page);
    await page.getByTestId("msg-menu-edit").click();
    await page.getByTestId("composer-cancel-edit").click();

    await expect(page.getByTestId("composer-editing-hint")).toBeHidden();
    await expect(page.locator("textarea").first()).toHaveValue("");
  });

  test("对方的消息菜单里没有编辑项", async ({ page }) => {
    const peer = page.locator('[data-kind="text"][data-self="false"]').first();
    await peer.click({ button: "right" });
    await expect(page.getByTestId("msg-menu-edit")).toHaveCount(0);
  });

  test("图片消息菜单里没有编辑项", async ({ page }) => {
    const img = page.locator('[data-kind="image"]').first();
    await img.click({ button: "right" });
    await expect(page.getByTestId("msg-menu-edit")).toHaveCount(0);
  });

  test("点已编辑角标打开历史弹层，列出各版本与当前版本标注", async ({ page }) => {
    // demoData 里有 edited: true 的样本消息
    await page.getByTestId("msg-edited-badge").first().click();
    await expect(page.getByRole("dialog", { name: "编辑记录" })).toBeVisible();
    await expect(page.getByTestId("edit-history-current")).toBeVisible();
    await expect(page.getByText("最初发出的版本")).toBeVisible();
  });

  test("历史弹层 Esc 可关闭", async ({ page }) => {
    await page.getByTestId("msg-edited-badge").first().click();
    await expect(page.getByRole("dialog", { name: "编辑记录" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "编辑记录" })).toBeHidden();
  });
});
```

**必须先核对的定位器**：

- `data-testid^="conv-item-"` —— Run `grep -rn 'data-testid' packages/ui/src/ConversationList.tsx | head -5` 看实际命名
- `data-self` 属性 —— `ChatWindow.tsx:421` 现有 `data-kind`/`data-msg-id`，**`data-self` 可能不存在**，若无则在 Task 10 里一并加上，或改用别的方式区分自己/对方
- demoData 里 `edited: true` 的样本（`mocks/demoData.ts:177`）是否带 `editCount > 0` —— 角标要可点必须 `editCount > 0`，若 demo 数据只有 `edited: true`，需在 Task 7 给该样本补 `editCount: 2`

- [ ] **Step 3: 运行 E2E**

Run: `pnpm --filter @yuanchat/web test:e2e -- message-edit`
Expected: 全部 PASS

失败时先看是定位器不匹配还是功能问题 —— 用 `--headed` 或看 trace。

- [ ] **Step 4: 跑全量 E2E 确认无回归**

Run: `pnpm --filter @yuanchat/web test:e2e`
Expected: 全绿（既有 81 条 + 新增 7 条）

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/message-edit.spec.ts
git commit -m "test(e2e): 消息编辑菜单、编辑态与历史弹层"
```

---

## Task 13：🔴 生产对象存储对外端点

**Files:**

- Modify: `server/internal/config/config.go:148-154`
- Modify: `server/internal/storage/minio.go:142-148` 等
- Create: `server/internal/storage/public_endpoint_test.go`
- Modify: `deploy/nginx/nginx.conf.template`、`deploy/docker-compose.prod.yml:57,91`、`deploy/install.sh`（5 处）、`docs/deploy/env.md:112`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`（CSP 注释）

**Interfaces:**

- Consumes: 无
- Produces: `MinIOConfig.PublicEndpoint` / `PublicUseSSL`；`Storage.rewriteHost`

**边界声明**：本地无域名、无证书、无公网 MinIO，本 Task **只能做到配置层 + 单测**。真机/真生产无法验证 —— 交付报告必须如实写明，不谎称已验证。

- [ ] **Step 1: 写失败测试**

创建 `server/internal/storage/public_endpoint_test.go`：

```go
package storage

import (
	"strings"
	"testing"
)

// TestRewriteHostReplacesInternalEndpoint 预签名 URL 的 host 必须换成对外端点，
// 否则客户端拿到 minio:9000 这种内网名根本解析不了（生产图片/语音/头像全废）。
func TestRewriteHostReplacesInternalEndpoint(t *testing.T) {
	s := &Storage{
		endpoint:       "minio:9000",
		publicEndpoint: "storage.example.com",
		publicUseSSL:   true,
		bucket:         "yuanchat",
	}
	in := "http://minio:9000/yuanchat/images/2026/09/x.png?X-Amz-Signature=abc&X-Amz-Expires=3600"
	got := s.rewriteHost(in)

	if !strings.HasPrefix(got, "https://storage.example.com/") {
		t.Errorf("rewriteHost = %q, want https://storage.example.com/ prefix", got)
	}
	// 签名参数必须原样保留，否则 MinIO 校验失败
	if !strings.Contains(got, "X-Amz-Signature=abc") {
		t.Error("签名参数丢失")
	}
	if !strings.Contains(got, "X-Amz-Expires=3600") {
		t.Error("过期参数丢失")
	}
	if !strings.Contains(got, "/yuanchat/images/2026/09/x.png") {
		t.Error("对象路径被破坏")
	}
}

// TestRewriteHostFallsBackWhenUnset 未配对外端点时原样返回 —— dev 环境行为零变化。
func TestRewriteHostFallsBackWhenUnset(t *testing.T) {
	s := &Storage{endpoint: "localhost:9002", bucket: "yuanchat"}
	in := "http://localhost:9002/yuanchat/a.png?sig=1"
	if got := s.rewriteHost(in); got != in {
		t.Errorf("rewriteHost = %q, want unchanged %q", got, in)
	}
}

func TestRewriteHostHonorsPublicSSLFlag(t *testing.T) {
	s := &Storage{endpoint: "minio:9000", publicEndpoint: "storage.local", publicUseSSL: false}
	got := s.rewriteHost("http://minio:9000/yuanchat/a.png")
	if !strings.HasPrefix(got, "http://storage.local/") {
		t.Errorf("rewriteHost = %q, want http scheme when publicUseSSL=false", got)
	}
}

// TestPublicURLUsesPublicEndpoint 头像直链同样要走对外端点。
func TestPublicURLUsesPublicEndpoint(t *testing.T) {
	s := &Storage{
		endpoint:       "minio:9000",
		publicEndpoint: "storage.example.com",
		publicUseSSL:   true,
		bucket:         "yuanchat",
	}
	got := s.PublicURL("avatars/u1.png")
	want := "https://storage.example.com/yuanchat/avatars/u1.png"
	if got != want {
		t.Errorf("PublicURL = %q, want %q", got, want)
	}
}

func TestPublicURLFallsBackToEndpoint(t *testing.T) {
	s := &Storage{endpoint: "localhost:9002", bucket: "yuanchat", useSSL: false}
	got := s.PublicURL("avatars/u1.png")
	want := "http://localhost:9002/yuanchat/avatars/u1.png"
	if got != want {
		t.Errorf("PublicURL = %q, want %q", got, want)
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && go test ./internal/storage/ -v`
Expected: FAIL，`s.rewriteHost undefined`、`publicEndpoint` 字段不存在

- [ ] **Step 3: 加配置字段**

`server/internal/config/config.go` 的 `MinIOConfig`（:148-154）加两个字段：

```go
	// PublicEndpoint 下发给客户端的对外地址（不含 scheme），形如 storage.example.com。
	// 与 Endpoint 严格分开：后者是服务端建连用的内网地址（生产是 compose 主机名
	// minio:9000，客户端根本解析不了）。留空时回落到 Endpoint，dev 行为不变。
	PublicEndpoint string `mapstructure:"public_endpoint"`
	// PublicUseSSL 对外地址是否走 HTTPS（生产经 nginx 终止 TLS 时为 true）。
	PublicUseSSL bool `mapstructure:"public_use_ssl"`
```

- [ ] **Step 4: 实现 rewriteHost 并接入三处**

`server/internal/storage/minio.go` 的 `Storage` struct 加字段 `publicEndpoint string` / `publicUseSSL bool`，`New` 里从 cfg 赋值。新增：

```go
// rewriteHost 把 URL 的 scheme 与 host 换成对外端点，其余（路径、查询串）原样保留。
//
// 未配置对外端点时原样返回。注意：预签名 URL 的 SigV4 签名覆盖 Host 头，
// 因此对外域名必须由 nginx 反代到 MinIO 并透传 Host（proxy_set_header Host $host），
// 且 MINIO_SERVER_URL 要与对外域名一致 —— 否则签名校验失败（不是静默降级）。
func (s *Storage) rewriteHost(rawURL string) string {
	if s.publicEndpoint == "" {
		return rawURL
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	u.Host = s.publicEndpoint
	if s.publicUseSSL {
		u.Scheme = "https"
	} else {
		u.Scheme = "http"
	}
	return u.String()
}
```

`PublicURL`（:142-148）改为：

```go
func (s *Storage) PublicURL(objectKey string) string {
	host := s.endpoint
	scheme := "http"
	if s.useSSL {
		scheme = "https"
	}
	if s.publicEndpoint != "" {
		host = s.publicEndpoint
		if s.publicUseSSL {
			scheme = "https"
		} else {
			scheme = "http"
		}
	}
	return fmt.Sprintf("%s://%s/%s/%s", scheme, host, s.bucket, objectKey)
}
```

`PresignGet`（:109）与 `PresignPut`（:100）在返回前套 `s.rewriteHost(...)`。确认 `net/url` 已在 import（文件头已有）。

- [ ] **Step 5: 运行测试确认通过**

Run: `cd server && go test ./internal/storage/ -v`
Expected: 六个用例全 PASS

- [ ] **Step 6: nginx 加存储子域**

`deploy/nginx/nginx.conf.template`：

- upstream 区（:7-10）加 `upstream yuanchat_s3 { server minio:9000; }`
- HTTP server 的 `server_name`（:15）追加 `${DOMAIN_STORAGE}`
- 文件末尾加新 server 块：

```nginx
# ---------- storage：MinIO 对象存储对外端点 ----------
# 预签名 URL 的 SigV4 签名覆盖 Host 头，故必须透传 $host 且
# MINIO_SERVER_URL 与本域名一致，否则签名校验失败。
server {
    listen 443 ssl;
    http2 on;
    server_name ${DOMAIN_STORAGE};

    ssl_certificate     /etc/letsencrypt/live/${DOMAIN_STORAGE}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN_STORAGE}/privkey.pem;
    include /etc/nginx/ssl-params.conf;

    # 图片/语音/视频经预签名 URL 直传，须容纳与 max_file_size 相当的体积
    client_max_body_size 100m;

    location / {
        proxy_pass http://yuanchat_s3;
        include /etc/nginx/proxy-params.conf;
        proxy_set_header Host $host;
    }
}
```

**核对 `proxy-params.conf` 是否已设 Host**：Run `cat deploy/nginx/proxy-params.conf`。若它已设了别的 Host 值，本块的显式覆盖要放在 include 之后（如上）。

- [ ] **Step 7: compose 与 install.sh 与 env.md**

`deploy/docker-compose.prod.yml`：

- :57 `MINIO_SERVER_URL: https://${DOMAIN_API}/s3` 改为 `https://${DOMAIN_STORAGE}`
- :91 附近加：

```yaml
YUANCHAT_MINIO_PUBLIC_ENDPOINT: ${DOMAIN_STORAGE}
YUANCHAT_MINIO_PUBLIC_USE_SSL: "true"
```

`deploy/install.sh` **5 处**都要加 `DOMAIN_STORAGE`：:42（必填校验 for 循环）、:72（export）、:73（envsubst 白名单 —— **漏这处会让 `${DOMAIN_STORAGE}` 原样留在生成的 nginx.conf 里**）、:87（certbot 域名列表）、:99（证书循环）。

`docs/deploy/env.md:112` 那行域名说明改为五个子域，并新增两个环境变量的条目说明（含「为什么必须与 MINIO_SERVER_URL 一致」）。

- [ ] **Step 8: 桌面端 CSP 注释**

`apps/desktop/src-tauri/tauri.conf.json` 的 CSP 里，`img-src`/`media-src`/`connect-src` 旁加注释说明生产部署需加入存储子域。**A8 刻意只列真实可达主机、不用 `https:` 通配掩盖这个洞**，本批延续该姿态 —— 只在配置里写明需替换处，不加通配。

JSON 不支持注释，故改为在 `docs/deploy/self-hosted.md`（或 env.md）里写明这一步，并在 tauri.conf.json 的 CSP 值里保持现状。

- [ ] **Step 9: 验证 dev 环境行为未变**

Run: `pnpm dev:server`，然后发一张图片消息（或直接 curl 打 `/files/download-url`），确认返回的 URL 仍是 `localhost:9002`（未配对外端点时回落）。

Run: `pnpm dev:stop`

- [ ] **Step 10: 全量后端测试**

Run: `cd server && go vet ./... && go test ./...`
Expected: 全绿

- [ ] **Step 11: Commit**

```bash
git add server/internal/config/config.go server/internal/storage/ \
        deploy/nginx/nginx.conf.template deploy/docker-compose.prod.yml \
        deploy/install.sh docs/deploy/env.md
git commit -m "fix(storage): 对象存储分离对外端点，修生产预签名 URL 用内网主机名不可达"
```

---

## Task 14：扫码登录 canceled 终态

**Files:**

- Modify: `server/internal/service/qr_login_service.go:26-30` 等
- Modify: `server/internal/handler/qr_login.go`、`server/internal/router/router.go:243-252`
- Create: `server/internal/service/qr_login_cancel_test.go`
- Modify: 前端扫码确认页与轮询页、四份 locale

**Interfaces:**

- Consumes: 无
- Produces: `QRCanceled QRStatus = "canceled"`；`POST /api/v1/auth/qr/:token/cancel`

- [ ] **Step 1: 写失败测试**

创建 `server/internal/service/qr_login_cancel_test.go`。照既有 `qr_login_service_test.go` 的夹具（`testutil.NewRedis(t)`）：

```go
package service

import (
	"context"
	"testing"
)

func TestCancelQRSessionFromScanned(t *testing.T) {
	svc, _ := newQRFixture(t)
	ctx := context.Background()

	sess, err := svc.CreateQRSession(ctx)
	if err != nil {
		t.Fatalf("CreateQRSession: %v", err)
	}
	if _, err := svc.ScanQRSession(ctx, sess.Token, testUserID); err != nil {
		t.Fatalf("ScanQRSession: %v", err)
	}

	if err := svc.CancelQRSession(ctx, sess.Token, testUserID); err != nil {
		t.Fatalf("CancelQRSession: %v", err)
	}

	res, err := svc.PollQRSession(ctx, sess.Token, sess.PollSecret)
	if err != nil {
		t.Fatalf("PollQRSession: %v", err)
	}
	if res.Status != QRCanceled {
		t.Errorf("status = %q, want canceled", res.Status)
	}
}

// TestCancelQRSessionRejectsPending 未扫码的会话不能被取消 ——
// 取消是「扫码端反悔」，pending 阶段还没有扫码端。
func TestCancelQRSessionRejectsPending(t *testing.T) {
	svc, _ := newQRFixture(t)
	ctx := context.Background()
	sess, err := svc.CreateQRSession(ctx)
	if err != nil {
		t.Fatalf("CreateQRSession: %v", err)
	}
	if err := svc.CancelQRSession(ctx, sess.Token, testUserID); err == nil {
		t.Error("err = nil, want rejection for pending session")
	}
}

// TestCancelQRSessionRejectsOtherUser 只有扫码的那个用户能取消。
func TestCancelQRSessionRejectsOtherUser(t *testing.T) {
	svc, _ := newQRFixture(t)
	ctx := context.Background()
	sess, _ := svc.CreateQRSession(ctx)
	if _, err := svc.ScanQRSession(ctx, sess.Token, testUserID); err != nil {
		t.Fatalf("ScanQRSession: %v", err)
	}
	if err := svc.CancelQRSession(ctx, sess.Token, otherUserID); err == nil {
		t.Error("err = nil, want rejection for non-scanner")
	}
}
```

`newQRFixture`、`testUserID`、`otherUserID`、`sess.PollSecret` 的确切形状**先读 `server/internal/service/qr_login_service_test.go`** 后照抄。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && go test ./internal/service/ -run TestCancelQR -v`
Expected: FAIL，`QRCanceled` / `CancelQRSession` undefined

- [ ] **Step 3: 实现状态与方法**

`qr_login_service.go:26-30` 的状态常量加：

```go
	// QRCanceled 扫码端主动取消，被扫端轮询到此状态即停止并提示重新生成。
	QRCanceled QRStatus = "canceled"
```

新增方法（照既有 `ScanQRSession`/`ConfirmQRSession` 的 Lua 原子迁移写法 —— 先读 :228-260 那两个方法）：

```go
// CancelQRSession 把会话从 scanned 迁到 canceled（仅扫码者本人可取消）。
//
// 用 Lua 原子校验「当前状态是 scanned 且 scanner 是本人」再迁移，
// 与 scan/confirm 同姿态，避免 check-then-act 竞态。
func (s *QRLoginService) CancelQRSession(ctx context.Context, token string, userID uuid.UUID) error {
	// 实现照 transition 私有方法的既有形状（qr_login_service.go:314 附近）
}
```

**先读 `qr_login_service.go:314` 的 `transition(from, to QRStatus, ...)`** —— 若它已支持任意状态迁移，`CancelQRSession` 可直接复用它，只需额外校验 scanner 身份。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && go test ./internal/service/ -run TestCancelQR -v`
Expected: 三个用例全 PASS

- [ ] **Step 5: 加 handler 与路由**

`server/internal/handler/qr_login.go` 加 `CancelQRSession` handler（照该文件 `ScanQRSession` 的形状：`AuthRequired` 已在路由层，handler 里取 userID + parse token + 调 service + 错误映射）。

`router.go:243-252` 的 qr 组加：

```go
		qr.POST("/:token/cancel", middleware.AuthRequired(cfg.JWT), authH.CancelQRSession)
```

- [ ] **Step 6: 前端接入**

扫码确认页（Android 端为主）加「取消」按钮调用新端点；轮询页（`QrLoginPage`）拿到 `canceled` 状态即停止轮询、显示提示 + 「重新生成二维码」按钮。移动端确认页注册返回键拦截器 —— 按返回即取消（而非退出应用）。

**先定位这两个页面**：Run `grep -rln "QrLogin\|qrLogin" packages/ui/src apps/web/src apps/desktop/src | head`。

MSW 补 cancel 端点 mock。四份 locale 补 `auth.qr.cancel` / `auth.qr.canceled` / `auth.qr.regenerate`（**key 名先核对既有 `auth.qr.*` 命名**）。

- [ ] **Step 7: 跑相关测试与门禁**

Run: `cd server && go test ./... && cd .. && node scripts/check-i18n.mjs && LANG=C.UTF-8 pnpm test`
Expected: 全绿

- [ ] **Step 8: Commit**

```bash
git add server/internal/service/qr_login_service.go \
        server/internal/service/qr_login_cancel_test.go \
        server/internal/handler/qr_login.go \
        server/internal/router/router.go \
        packages/ packages/design-system/src/i18n/locales/
git commit -m "feat(auth): 扫码登录支持扫码端主动取消（canceled 终态）"
```

---

## Task 15：shared / ui 补 tsconfig

**Files:**

- Create: `packages/shared/tsconfig.json`
- Create: `packages/ui/tsconfig.json`
- Modify: `turbo.json`

**Interfaces:**

- Consumes: 无
- Produces: 两个包的 `typecheck` 脚本可执行

**已知风险**：这两个包**从未被单独类型检查**（只靠两端 app 的 tsc 传递覆盖）。补上后可能暴露此前隐藏的类型错误 —— 一并修掉；若发现需大范围改动的问题，就地记债而非扩大本批范围。

- [ ] **Step 1: 抄一份 app 侧配置作基线**

Run: `cat apps/web/tsconfig.json && cat apps/web/tsconfig.app.json 2>/dev/null`

记下 `compilerOptions` 的实际取值（尤其 `target`、`lib`、`jsx`、`moduleResolution`、`strict` 相关项）。

- [ ] **Step 2: 写 shared 的 tsconfig**

创建 `packages/shared/tsconfig.json`。**`target` 必须是 `ES2019`**（对齐 `build.target`，否则 tsc 不会报 `?.`/`??` 的兼容问题）：

```json
{
  "compilerOptions": {
    "target": "ES2019",
    "lib": ["ES2019", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["vitest/globals"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 写 ui 的 tsconfig**

创建 `packages/ui/tsconfig.json`，同上但 `types` 加 `@testing-library/jest-dom`：

```json
{
  "compilerOptions": {
    "target": "ES2019",
    "lib": ["ES2019", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: 首次运行，看暴露了什么**

Run: `pnpm --filter @yuanchat/shared typecheck; pnpm --filter @yuanchat/ui typecheck`
Expected: 可能有错误。**逐个记录**。

- [ ] **Step 5: 修掉暴露的类型错误**

按 Step 4 的输出逐个修。原则：

- 真实类型错误 → 修代码
- 缺类型声明 → 补 `@types/*` 到对应包的 devDependencies（**必须声明在该包自己的 package.json** —— pnpm 幽灵依赖会让 CI 挂）
- 配置过严导致的大批噪音（如 `noUnusedLocals` 报出几十处）→ 可先关掉该项并在文件里注释说明「待后续收口」，记债进 MASTER_PLAN

若某类错误需要大范围重构，**不在本批做** —— 关掉对应 compilerOption、注释说明、记债。

- [ ] **Step 6: 接进 turbo**

`turbo.json` 确认 `typecheck` 任务存在且会覆盖 packages。Run `cat turbo.json`，若 `typecheck` 任务未定义则加：

```json
    "typecheck": {
      "dependsOn": ["^typecheck"],
      "outputs": []
    }
```

- [ ] **Step 7: 全仓 typecheck**

Run: `pnpm turbo typecheck`
Expected: 全绿（含两端 app 与两个新接入的包）

- [ ] **Step 8: 确认 husky 钩子覆盖**

Run: `cat .husky/pre-commit`

现有钩子跑 web + desktop 的 typecheck。确认是否要把两个包也纳入 —— 若 `pnpm turbo typecheck` 已因依赖图自动覆盖，则无需改钩子；否则补上。

- [ ] **Step 9: Commit**

```bash
git add packages/shared/tsconfig.json packages/ui/tsconfig.json turbo.json
git commit -m "chore(types): shared 与 ui 补 tsconfig，两包 typecheck 脚本可执行"
```

---

## Task 16：本地 CI 全量 + 真机实测

**Files:** 无代码改动（发现问题则回到对应 Task 修）

**Interfaces:**

- Consumes: Task 1-15 全部产出
- Produces: 可合并的验证证据

- [ ] **Step 1: 停掉所有残留进程**

Run: `pnpm dev:stop`

- [ ] **Step 2: 跑 CI 实际执行的全部检查**

逐条跑，全部要绿：

```bash
node scripts/check-i18n.mjs
pnpm format:check
pnpm lint
pnpm lint:style
pnpm check:theme
LANG=C.UTF-8 pnpm test
cd apps/web && npx tsc --noEmit && cd ../..
cd apps/desktop && npx tsc --noEmit && cd ../..
pnpm turbo typecheck
cd server && go vet ./... && go test ./... && go test -race ./internal/ws/ && cd ..
pnpm --filter @yuanchat/web test:e2e
```

**注意** `LANG=C.UTF-8` 不可省 —— 中文机器上 `navigator.language` 报 `zh-CN`、GitHub runner 报 `en-US`，依赖它的用例会「本地绿、远程红」。

- [ ] **Step 3: 真机实测 — Web 真后端**

Run: `pnpm dev:server`，另一个终端 `pnpm dev:web`。用 Playwright MCP 或手动验证：

- 编辑一条自己刚发的文本消息 → 气泡正文更新 + 「已编辑」角标出现
- 点角标 → 历史弹层列出两版本、当前版本有标注
- **双浏览器上下文**：A 编辑，B 侧实时看到正文变化（验证 `message.edited` 帧真的推到了对端）
- 会话列表预览同步更新（编辑最后一条时）
- 等 5 分钟后再编辑 → toast「超过 5 分钟后不能编辑」（或用 SQL 把 `created_at` 推回去加速）
- 编辑成敏感词 → DB 里 `flagged = true`（`SELECT flagged FROM messages WHERE id=...`）
- 暗色主题 + 移动视口（375×667）走查
- 控制台零报错、Network 零 4xx/5xx（除刻意触发的）

- [ ] **Step 4: 真机实测 — 桌面端**

Run: `pnpm dev:desktop`

- 编辑流与历史弹层渲染正常
- 控制台 CSP 拦截日志 0 行

Run: `pnpm dev:stop`

- [ ] **Step 5: 真机实测 — Android 模拟器**

Run: `pnpm dev:android`

- 长按自己的文本消息 → 菜单出「编辑」
- 进入编辑态，软键盘顶起时 Composer 与提示条都可见可用
- 历史弹层打开后按**系统返回键** → 关闭弹层（**不是退出应用**）
- 编辑态按返回键 → 退出编辑态
- 扫码页「取消」按钮与返回键取消（Task 14）

用 `adb logcat` 看有无异常。

Run: `pnpm dev:stop`

- [ ] **Step 6: 生产构建产物的 es2019 底线核验**

```bash
pnpm --filter @yuanchat/web build
grep -rl '?\.\|??' apps/web/dist/assets/*.js | head
```

Expected: 零命中（若有，说明某处写了 ES2020 语法且未被转译）

- [ ] **Step 7: 记录实测结论**

把 Step 3-6 的结论整理成表，供交付报告与 MASTER_PLAN 回写用。**失败项如实记录**，不美化。

---

## Task 17：文档回写 + 合回 dev

**Files:**

- Modify: `docs/MASTER_PLAN.md`（未做清单）、`docs/CHAT_API.md`、`docs/DB_SCHEMA.md`、`docs/ROADMAP.md`、`AGENTS.md`

**Interfaces:**

- Consumes: Task 16 的实测结论
- Produces: 文档与代码一致

- [ ] **Step 1: MASTER_PLAN 未做清单回写**

`docs/MASTER_PLAN.md`：

- K 泳道表 **K1** 行状态改 ✅，备注列写「✅ 2026-09-05：5 分钟窗口 + 完整编辑历史 + message.edited 帧」
- A8 留债表：
  - 🔴 生产对象存储不可达 → ✅，**注明「仅配置层 + 单测，本地无域名/证书/公网 MinIO，未经真机验证」**
  - ⚪ `packages/shared` 与 `packages/ui` 无 tsconfig → ✅
  - ⚪ 扫码会话缺 `canceled` 终态 → ✅
- K7 债表：🟡 mock 模式点播 demo 语音 toast 播放失败 → ✅
- 阶段三功能清单：若有「消息编辑」checkbox 则勾选
- 新增本批小节 `#### 2.7 K1 — 消息编辑（✅ 已完成，2026-09-05）`，照 §2.6 的形状写：设计/执行文档链接、分支、迁移号、已交付列表、真机实测结论表、本批新登记的债表

- [ ] **Step 2: 新债登记**

把 spec §7「明确不做」全部条目 + Task 15 若有关掉的 compilerOption + 实施中新发现的问题，登记进 §2.7 的债表。**漏登记等于永久丢失。**

- [ ] **Step 3: CHAT_API.md**

补：`PATCH /messages/:id`、`GET /messages/:id/edits`、`GET /admin/messages/:id/edits`、`message.edited` 帧结构、业务码 4032/4033/4004。照该文档既有端点条目的格式。

- [ ] **Step 4: DB_SCHEMA.md**

补 017 迁移：`messages.edited_at`/`edit_count` 两列 + `message_edits` 表（含唯一索引）。

- [ ] **Step 5: ROADMAP.md**

- 文首执行状态段加本批
- 「待排」的 K 泳道剩余项里移除 K1（:33、:72 两处）
- 后续规划表加一行「（未发版）消息编辑 | K1 | ✅ 已在 dev（2026-09-05）」

- [ ] **Step 6: AGENTS.md 当前状态**

「消息操作」一节（:61-63）补「编辑（5 分钟窗口内改文本，保留完整编辑历史，`message.edited` 帧全员推送）」。

- [ ] **Step 7: 提交文档**

```bash
git add docs/ AGENTS.md
git commit -m "docs: 消息编辑与债收口交付回写，未做清单同步"
```

- [ ] **Step 8: 合并前最后一次本地 CI**

重跑 Task 16 Step 2 的全部命令。
Expected: 全绿

- [ ] **Step 9: 合回 dev**

**必须 `--no-ff`，禁 squash**（保留每个独立 commit）：

```bash
git checkout dev
git merge --no-ff feature/message-edit -m "merge: 消息编辑（K1）+ 生产对象存储对外端点等四项债收口合入 dev"
git log --oneline -1
```

- [ ] **Step 10: 推送前确认本地 CI 在 dev 上也绿**

在 dev 分支重跑 Task 16 Step 2 的命令。全绿后才可 `git push`。

**禁止「先推上去让 CI 跑」** —— 失败的 commit 已落在共享分支，别人拉下来就是坏的。

---

## 自审记录

**Spec 覆盖核对**：

| spec 章节                | 对应 Task                                                     |
| ------------------------ | ------------------------------------------------------------- |
| §2.1 可编辑范围硬闸门    | Task 3 Step 1（`TestEditRejectsNonTextTypes` 逐类型）、Step 5 |
| §2.2 迁移 017            | Task 1                                                        |
| §2.3 搜索索引零动作      | Task 3 Step 7（`TestEditUpdatesSearchIndex` 钉住前提）        |
| §2.4 审核绕过洞          | Task 3 Step 3（抽取）+ Step 1（`TestEditFlagsModeratedText`） |
| §2.5 Service 层          | Task 3                                                        |
| §2.6 Repository 层       | Task 2                                                        |
| §2.7 REST 端点           | Task 5                                                        |
| §2.8 WS 帧               | Task 4                                                        |
| §2.9 golden 新骨架       | Task 4（Go 侧）+ Task 8（前端侧）                             |
| §3.1 共享契约            | Task 6                                                        |
| §3.2 编辑态复用 Composer | Task 10                                                       |
| §3.3 菜单项与闸门集中    | Task 6 Step 4（`canEdit`）+ Task 10 Step 1                    |
| §3.4 角标与历史弹层      | Task 9 + Task 10 Step 1                                       |
| §3.5 快照定格 + 引用回填 | Task 11                                                       |
| §3.6 MSW Mock            | Task 7 Step 3                                                 |
| §3.7 i18n                | Task 7 Step 1                                                 |
| §4.1 生产 MinIO 端点     | Task 13                                                       |
| §4.2 mock 媒体播放       | Task 7 Step 4                                                 |
| §4.3 扫码 canceled       | Task 14                                                       |
| §4.4 shared/ui tsconfig  | Task 15                                                       |
| §5 测试计划              | Task 2/3/5/6/8/9/12/13/14 各自的测试步 + Task 16              |
| §8 交付后同步            | Task 17                                                       |

**类型一致性核对**：`applyEdited(convId, messageId, text, editCount)` 在 Task 6 定义、Task 8 与 Task 10 消费，四参数一致。`canEdit(msg, nowMs)` 在 Task 6 定义、Task 10 消费。`EditVersion{version,text,editedAt,current}` 在 Task 6 定义、Task 9 消费。`EditResult{Message,Text,MemberIDs}` 在 Task 3 定义、Task 5 消费。`MessageEditedPayload` 六字段在 Task 4 定义，Task 5 组帧、Task 6 的 `ServerFrames` 声明、`contracts/server-frames.golden.json` 三处字段名一致（`message_id`/`conversation_id`/`seq`/`text`/`edited_at`/`edit_count`）。

**需在实施时现场核对的既有符号**（plan 里已逐处标注「先读/先 grep」）：`seedConvAndUser`、`newTestMessageService` 夹具形状、`NewModerationService` 签名、`Search` 签名、`AdminHandler` 是否持有 MessageService、`setComposerInsert`/`toast` 来源、`menuItemClass`/`closeMenu`、`registerBackInterceptor` 用法、`data-self` 属性是否存在、色板类名、`common.retry`/`common.empty` 是否已有、`transition` 私有方法、conv-item 的 testid、demoData 的 `editCount`。**这些不是占位符，是「本仓真实代码优先于 plan」的落实点** —— A8 的教训是 plan 里凭记忆写符号名会引用不存在的东西。
