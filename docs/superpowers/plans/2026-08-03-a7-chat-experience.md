# A7 聊天体验补全 Implementation Plan（清空聊天记录 + 群公告 + 群内昵称）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给会话补齐三项体验能力——单侧清空聊天记录（本人拉不到、对方不受影响）、群公告（管理员编辑 + 顶部横幅 + 未读提示）、群内昵称 alias（群消息署名与成员列表优先显示 alias）。

**Architecture:** 三项均落在既有 `conversations` / `conversation_members` 表 + 会话 REST/WS 分层上。清空记录用 per-member `cleared_before_seq` 水位，拉历史时 `seq > cleared_before_seq` 过滤（软清空，不删消息行，对方无感）。群公告加在 `conversations` 表，走「仅管理员」权限模板（照 RenameGroup），变更发系统消息 + `conversation.updated` 帧。alias 加在 `conversation_members`，**后端在群会话拉历史/实时发送/成员列表时用 `COALESCE(NULLIF(alias,''), nickname)` 替换 sender_nickname**（已与用户确认：前端零改动方案）。

**Tech Stack:** Go 1.25 + gin + gorm + goose 迁移；PostgreSQL；WebSocket 自研信令；前端 React + zustand + react-i18next；Vitest + Playwright。

## Global Constraints

以下为项目级强制约束，每个 task 的要求隐含包含本节（值均逐字照抄自记忆/规范）：

- **GitFlow**：`feature/chat-experience` 分支开发；合并 dev 用 `git merge --no-ff`（**禁止 squash**，保留每个独立 commit）；dev→main 与合并 dev 均须当次征询用户。
- **commit message**：不写版本号前缀（如 `feat(v0.4/A7):`）；**不加 `Co-Authored-By` trailer**；完成完整批次再提交，内部按 task 逐个 commit。
- **i18n**：UI 文案零硬编码，走 react-i18next；四语言 `zh-CN / en-US / ja-JP / ko-KR` 全量 key；过 `node scripts/check-i18n.mjs`（以 zh-CN.json 为基准，缺/多/占位符不一致均 fail）。
- **浏览器兼容**：`build.target=es2019`（Chrome 74 WebView）；禁用 es2020+ 运行时 API（`Object.fromEntries` / `.flat` / `.replaceAll` / `Promise.allSettled` / `globalThis` / `String.matchAll` / `.at()`）；`?.` / `??` 是语法由 vite 转译，可用。
- **UI 圆角**：上限 `rounded-lg`(8px)，禁 `xl`/`2xl`（`rounded-full` 圆形除外）。
- **幽灵依赖**：app/包内 import 的包必须在该 app/包自己的 package.json 声明；`packages/shared` 不得 import `lucide-react`/`react-i18next`（经 `@yuanchat/design-system` 间接用 i18n 实例）。
- **数据库**：改动走 goose 迁移，下一个编号 `010`；语句幂等（`ADD COLUMN IF NOT EXISTS` / `DROP COLUMN IF EXISTS`），Up/Down 配对且 Down 逆序。
- **测试**：集成测连 dev 库（`localhost:5434`，不可达 `t.Skip`），setup 里 `db.AutoMigrate` 兜底 010 新列；测试通过才能继续；E2E 用 playwright 浏览器实测。
- **注释**：JSDoc + Go godoc 企业级规范，解释 why 而非 what。

## 决策点（已定）

- **alias 署名生效方式**：后端替换 `sender_nickname`（用户已选）。前端 MessageBubble/DTO/帧/store **零改动**。
- **清空历史语义**：软清空（`cleared_before_seq` 水位过滤），非物理删除。对方不受影响。水位只前进（`cleared_before_seq < ?` 防回退）。
- **公告未读态**：前端 localStorage 存每会话已读时间戳（`announcement-read:{convId}`），横幅比对 `announcement_updated_at`；不进 store（跨设备无意义、刷新即丢无所谓）。
- **公告权限**：`role >= Admin`（管理员+群主），照 RenameGroup。
- **alias 权限**：任意成员改自己的 alias，无角色守卫。

## File Structure

**后端（server/）：**

- Create: `server/internal/database/migrations/010_a7_chat_experience.sql` — 迁移四列
- Modify: `server/internal/model/conversation.go` — `ConversationMember` 加 `ClearedBeforeSeq int64` / `Alias *string`；`Conversation` 加 `Announcement *string` / `AnnouncementUpdatedAt *time.Time`
- Modify: `server/internal/repository/message_repo.go` — `ListBefore` 加 `minSeq` 参 + LEFT JOIN alias 替换 sender_nickname；`GetLastMessage` 传 minSeq
- Modify: `server/internal/repository/conversation_repo.go` — `ConversationListItem` 加 `ClearedBeforeSeq`；`ListByUserID` 投影加列；`MemberWithUser`/`ListMembers` alias 替换 nickname；`ListByUserID` 投影带 announcement（`c.*` 已含）
- Modify: `server/internal/service/message_service.go` — `GetHistory` 取成员 `cleared_before_seq` 传 `ListBefore`；`SendContent` 群会话 alias 替换发送者署名
- Create: `server/internal/service/conversation_experience.go` — `ClearHistory` / `UpdateAnnouncement` / `UpdateMyAlias` 三个 service 方法（新文件，避免 conversation_manage.go 膨胀）
- Modify: `server/internal/service/conversation_service.go` — `ConversationDTO` 加 `Announcement`/`AnnouncementUpdatedAt`；`List` 装配；错误哨兵 `ErrInvalidAlias`
- Modify: `server/internal/handler/conversation_experience.go` — 新建，三个 handler（clear/announcement/alias）
- Modify: `server/internal/ws/protocol.go` — `ConversationUpdatedPayload` 加 `Announcement *string` + `AnnouncementUpdatedAt *time.Time`
- Modify: `server/internal/router/router.go` — 注册三个新路由
- Modify: `docs/02_CHAT_API.md` — 三端点文档 + 字段说明
- Test: `server/internal/service/conversation_experience_test.go`、`message_history_clear_test.go`

**前端：**

- Modify: `packages/shared/src/api/groups.ts` — `clearHistory` / `updateAnnouncement` / `updateMyAlias`
- Modify: `packages/shared/src/api/chat.ts` — `ConversationDTO`/`Conversation`-map 加 `announcement`/`announcementUpdatedAt`；`MemberDTO`/`ConversationMember` 加 `alias`；`conversationUpdatePatch` 加 announcement
- Modify: `packages/shared/src/store/conversationStore.ts` — `Conversation` 加 `announcement?`/`announcementUpdatedAt?`
- Modify: `packages/shared/src/store/messageStore.ts` — 加 `clearConversation(convId)` action
- Modify: `packages/shared/src/ws/chatSocket.ts` — `conversation.updated` 帧加 `announcement?`/`announcement_updated_at?`
- Modify: `packages/shared/src/hooks/useChatBootstrap.ts` — `conversation.updated` handler patch announcement
- Modify: `packages/ui/src/ChatDetail.tsx` — 清空按钮接线 + 确认弹窗；群公告编辑（管理员）；alias 编辑（任意成员）
- Modify: `packages/ui/src/ChatWindow.tsx` — 公告横幅（localStorage 未读态）+ 全文弹层
- Create: `packages/ui/src/AnnouncementDialog.tsx` — 公告全文只读弹层（照 ConfirmDialog 结构）
- Modify: `packages/design-system/src/i18n/locales/{zh-CN,en-US,ja-JP,ko-KR}.json` — 新 key
- Test: `packages/ui/src/__tests__/ChatDetail.test.tsx`、`packages/shared/src/__tests__/messageStore.test.ts`、`apps/web/e2e/chat-experience.spec.ts`

---

## Task 1: 迁移 010 + 模型字段

**Files:**

- Create: `server/internal/database/migrations/010_a7_chat_experience.sql`
- Modify: `server/internal/model/conversation.go`
- Test: `server/internal/service/conversation_experience_test.go`（建 setup + 首个占位断言）

**Interfaces:**

- Produces: `model.ConversationMember.ClearedBeforeSeq int64`（`gorm:"default:0" json:"cleared_before_seq"`）、`.Alias *string`（`gorm:"type:varchar(30)" json:"alias,omitempty"`）；`model.Conversation.Announcement *string`（`gorm:"type:text" json:"announcement,omitempty"`）、`.AnnouncementUpdatedAt *time.Time`（`json:"announcement_updated_at,omitempty"`）

- [ ] **Step 1: 写迁移文件**

`server/internal/database/migrations/010_a7_chat_experience.sql`：

```sql
-- +goose Up
-- +goose StatementBegin
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS cleared_before_seq BIGINT NOT NULL DEFAULT 0;
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS alias VARCHAR(30);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS announcement TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS announcement_updated_at TIMESTAMPTZ;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE conversations DROP COLUMN IF EXISTS announcement_updated_at;
ALTER TABLE conversations DROP COLUMN IF EXISTS announcement;
ALTER TABLE conversation_members DROP COLUMN IF EXISTS alias;
ALTER TABLE conversation_members DROP COLUMN IF EXISTS cleared_before_seq;
-- +goose StatementEnd
```

- [ ] **Step 2: 模型加字段**

`model/conversation.go` `ConversationMember` struct 尾部（`MentionUnread` 后）加：

```go
	ClearedBeforeSeq int64      `gorm:"default:0" json:"cleared_before_seq"`
	Alias            *string    `gorm:"type:varchar(30)" json:"alias,omitempty"`
```

`Conversation` struct（`UpdatedAt` 前）加：

```go
	Announcement          *string    `gorm:"type:text" json:"announcement,omitempty"`
	AnnouncementUpdatedAt *time.Time `json:"announcement_updated_at,omitempty"`
```

注意：新增字段的对齐会影响 gofmt——对**整个 struct 块**跑 `gofmt -w` 保证列对齐，不要只对齐新行（A6 吃过 gofmt 亏）。

- [ ] **Step 3: 应用迁移 + 建测试 setup**

Run: `cd server && go run ./cmd/migrate up && go run ./cmd/migrate status`
Expected: 版本推进到 10，四列存在。

`conversation_experience_test.go` 建 setup（照 `conversation_settings_test.go` 的 `testDB` + `AutoMigrate` 兜底）：

```go
package service

import (
	"testing"
	"github.com/yuanchat/server/internal/model"
)

// TestA7ColumnsExist 兜底确认 010 新列可用（AutoMigrate 补列）。
func TestA7ColumnsExist(t *testing.T) {
	db := testDB(t)
	if err := db.AutoMigrate(&model.ConversationMember{}, &model.Conversation{}); err != nil {
		t.Fatalf("automigrate a7 columns: %v", err)
	}
}
```

- [ ] **Step 4: 跑测试**

Run: `cd server && go test ./internal/service/ -run TestA7ColumnsExist -v`
Expected: PASS（连库；不可达则 SKIP）。

- [ ] **Step 5: Commit**

```bash
git add server/internal/database/migrations/010_a7_chat_experience.sql server/internal/model/conversation.go server/internal/service/conversation_experience_test.go
git commit -m "feat(server): 迁移 010 聊天体验字段（cleared_before_seq/alias/announcement）"
```

---

## Task 2: 清空聊天记录（service + repo 过滤）

**Files:**

- Modify: `server/internal/repository/message_repo.go`
- Modify: `server/internal/repository/conversation_repo.go`
- Modify: `server/internal/service/message_service.go`
- Create/Modify: `server/internal/service/conversation_experience.go`
- Test: `server/internal/service/message_history_clear_test.go`

**Interfaces:**

- Consumes: `model.ConversationMember.ClearedBeforeSeq`（Task 1）；`ConversationRepository.GetMember`（现有 `conversation_repo.go:156`）；`ConversationRepository.UpdateMemberSettings(ctx, convID, userID, map[string]any)`（现有 `:169`，map 泛化可复用）；`ConversationRepository.FindByID`
- Produces: `MessageRepository.ListBefore(ctx, convID, beforeSeq, minSeq int64, limit int)`（**签名变更：加 minSeq**）；`MessageService.ClearHistory(ctx, userID, convID uuid.UUID) error`

- [ ] **Step 1: 写失败测试**

`message_history_clear_test.go`：

```go
package service

import (
	"context"
	"testing"

	"github.com/yuanchat/server/internal/model"
)

// TestClearHistoryPerMember 清空后本人拉不到旧消息，对方不受影响。
func TestClearHistoryPerMember(t *testing.T) {
	db := testDB(t)
	db.AutoMigrate(&model.ConversationMember{})
	a := newTestUser(t, db, "甲")
	b := newTestUser(t, db, "乙")
	convID := newSendConv(t, db, a, b)
	msgSvc := newMessageSvc(db)
	ctx := context.Background()

	// a、b 各发 2 条
	for i := 0; i < 2; i++ {
		if _, err := msgSvc.SendText(ctx, a.ID, convID, "a-msg", ""); err != nil {
			t.Fatalf("send a: %v", err)
		}
		if _, err := msgSvc.SendText(ctx, b.ID, convID, "b-msg", ""); err != nil {
			t.Fatalf("send b: %v", err)
		}
	}

	convSvc := newConvSvc(db)
	if err := convSvc.ClearHistory(ctx, a.ID, convID); err != nil {
		t.Fatalf("clear: %v", err)
	}

	aMsgs, _ := msgSvc.GetHistory(ctx, a.ID, convID, 0, 30)
	if len(aMsgs) != 0 {
		t.Fatalf("cleared member should see 0 history, got %d", len(aMsgs))
	}
	bMsgs, _ := msgSvc.GetHistory(ctx, b.ID, convID, 0, 30)
	if len(bMsgs) != 4 {
		t.Fatalf("other member should see all 4, got %d", len(bMsgs))
	}

	// 清空后新发的消息本人可见
	if _, err := msgSvc.SendText(ctx, b.ID, convID, "after-clear", ""); err != nil {
		t.Fatalf("send after clear: %v", err)
	}
	aAfter, _ := msgSvc.GetHistory(ctx, a.ID, convID, 0, 30)
	if len(aAfter) != 1 {
		t.Fatalf("cleared member should see only post-clear msg, got %d", len(aAfter))
	}
}

// TestClearHistoryNonMember 非成员清空返回 ErrNotMember。
func TestClearHistoryNonMember(t *testing.T) {
	db := testDB(t)
	db.AutoMigrate(&model.ConversationMember{})
	a := newTestUser(t, db, "甲")
	b := newTestUser(t, db, "乙")
	outsider := newTestUser(t, db, "丙")
	convID := newSendConv(t, db, a, b)

	if err := newConvSvc(db).ClearHistory(context.Background(), outsider.ID, convID); err == nil {
		t.Fatal("outsider clear should fail")
	}
}
```

（`newMessageSvc`/`newConvSvc`/`newSendConv`/`newTestUser` 均为现有测试 helper；若 `SendText` 签名不符按实际调整——探索确认 `MessageService.SendText(ctx, userID, convID, text, replyToID)`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/service/ -run TestClearHistory -v`
Expected: 编译失败（`convSvc.ClearHistory` undefined、`ListBefore` 参数不符）。

- [ ] **Step 3: 改 ListBefore 加 minSeq**

`message_repo.go` `ListBefore`：

```go
// ListBefore 取会话中 seq < beforeSeq 且 seq > minSeq 的最新 limit 条消息（seq 降序）。
// minSeq 为调用方的 cleared_before_seq 水位（0 表示不过滤）；群会话署名用成员 alias 覆盖 nickname。
func (r *MessageRepository) ListBefore(ctx context.Context, convID uuid.UUID, beforeSeq, minSeq int64, limit int) ([]MessageWithSender, error) {
	q := r.db.WithContext(ctx).
		Table("messages m").
		Select(`m.*, COALESCE(NULLIF(cm.alias, ''), u.nickname) AS sender_nickname, u.avatar_url AS sender_avatar_url`).
		Joins("JOIN users u ON u.id = m.sender_id").
		Joins("LEFT JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = m.sender_id").
		Where("m.conversation_id = ? AND m.deleted_at IS NULL", convID)
	if beforeSeq > 0 {
		q = q.Where("m.seq < ?", beforeSeq)
	}
	if minSeq > 0 {
		q = q.Where("m.seq > ?", minSeq)
	}
	var rows []MessageWithSender
	err := q.Order("m.seq DESC").Limit(limit).Scan(&rows).Error
	return rows, err
}
```

（alias 覆盖对单聊无害：单聊成员 alias 恒为 NULL → COALESCE 回退 nickname。）

- [ ] **Step 4: 改 GetLastMessage 传 minSeq**

`message_repo.go` `GetLastMessage` 增 `minSeq int64` 参：

```go
func (r *MessageRepository) GetLastMessage(ctx context.Context, convID uuid.UUID, minSeq int64) (*MessageWithSender, error) {
	rows, err := r.ListBefore(ctx, convID, 0, minSeq, 1)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return &rows[0], nil
}
```

- [ ] **Step 5: 改 GetHistory 取水位 + 改所有 ListBefore/GetLastMessage 调用点**

`message_service.go` `GetHistory`：成员校验后取成员行水位：

```go
	member, ok, err := s.convRepo.GetMember(ctx, convID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotMember
	}
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	messages, err := s.msgRepo.ListBefore(ctx, convID, beforeSeq, member.ClearedBeforeSeq, limit)
```

`conversation_service.go` `List` 里的 `GetLastMessage(ctx, item.ID)` 改为 `GetLastMessage(ctx, item.ID, item.ClearedBeforeSeq)`（需 Task 中 `ConversationListItem` 加 `ClearedBeforeSeq` 投影，见 Step 6）。全仓 grep `GetLastMessage(` 与 `ListBefore(` 补齐所有调用点新参（传 0 表示不过滤，如撤回/搜索等非清空语义路径）。

- [ ] **Step 6: ConversationListItem 投影加 cleared_before_seq**

`conversation_repo.go` `ConversationListItem` struct 加 `ClearedBeforeSeq int64`；`ListByUserID` 的 Select 追加 `cm.cleared_before_seq`：

```go
		Select(`c.*, cm.role, cm.last_read_seq, cm.is_muted, cm.mention_unread,
			cm.is_pinned, cm.pinned_at, cm.cleared_before_seq,
			(SELECT count(*) FROM conversation_members m2 WHERE m2.conversation_id = c.id) AS member_count`).
```

- [ ] **Step 7: 写 ClearHistory service**

`conversation_experience.go`（新文件）：

```go
package service

import (
	"context"

	"github.com/google/uuid"
)

// ClearHistory 单侧清空聊天记录：把本人的 cleared_before_seq 推进到会话当前 last_seq。
// 软清空——不删消息行，对方不受影响；拉历史时 seq <= cleared_before_seq 被过滤。
// 非成员返回 ErrNotMember。水位只前进（防重复清空回退）。
func (s *ConversationService) ClearHistory(ctx context.Context, userID, convID uuid.UUID) error {
	conv, err := s.convRepo.FindByID(ctx, convID)
	if err != nil {
		return err
	}
	if conv == nil {
		return ErrConversationNotFound
	}
	ok, err := s.convRepo.IsMember(ctx, convID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotMember
	}
	return s.convRepo.DB().WithContext(ctx).
		Model(&model.ConversationMember{}).
		Where("conversation_id = ? AND user_id = ? AND cleared_before_seq < ?", convID, userID, conv.LastSeq).
		Update("cleared_before_seq", conv.LastSeq).Error
}
```

（需 import `model`；`ClearHistory` 放 ConversationService 上。）

- [ ] **Step 8: 跑测试**

Run: `cd server && go test ./internal/service/ -run TestClearHistory -v && go build ./... && go vet ./...`
Expected: 两个测试 PASS，build/vet 干净。

- [ ] **Step 9: Commit**

```bash
git add server/internal/repository/message_repo.go server/internal/repository/conversation_repo.go server/internal/service/message_service.go server/internal/service/conversation_experience.go server/internal/service/message_history_clear_test.go
git commit -m "feat(server): 清空聊天记录（cleared_before_seq 水位过滤 + 群 alias 署名）"
```

---

## Task 3: 群公告（service + handler + WS 帧）

**Files:**

- Modify: `server/internal/service/conversation_experience.go`
- Modify: `server/internal/service/conversation_service.go`（DTO 字段 + List 装配）
- Create: `server/internal/handler/conversation_experience.go`
- Modify: `server/internal/ws/protocol.go`
- Test: `server/internal/service/conversation_experience_test.go`

**Interfaces:**

- Consumes: `loadGroupAndRole`（`conversation_manage.go:51`）；`appendSystemMessage`（`conversation_manage.go:72`）；`nicknameOf`（`conversation_manage.go:89`）；`GroupOpResult`（现有）；`pushSystemReceive`/`pushUpdated`（`conversation_manage.go` handler 辅助）
- Produces: `ConversationService.UpdateAnnouncement(ctx, operatorID, convID uuid.UUID, text string) (*GroupOpResult, *string, *time.Time, error)`（返回 GroupOpResult + 新公告值 + 更新时间）；`ConversationUpdatedPayload.Announcement *string` + `.AnnouncementUpdatedAt *time.Time`

- [ ] **Step 1: 写失败测试**

`conversation_experience_test.go` 追加：

```go
// TestUpdateAnnouncementByAdmin 管理员可更新公告，普通成员 403，非成员 ErrNotMember。
func TestUpdateAnnouncementByAdmin(t *testing.T) {
	db := testDB(t)
	db.AutoMigrate(&model.Conversation{}, &model.ConversationMember{})
	owner := newTestUser(t, db, "群主")
	member := newTestUser(t, db, "普通")
	outsider := newTestUser(t, db, "外人")
	svc := newConvSvc(db)
	makeFriends(t, db, owner, member)
	convID := newManagedGroup(t, svc, owner, member)
	ctx := context.Background()

	res, _, updatedAt, err := svc.UpdateAnnouncement(ctx, owner.ID, convID, "新公告内容")
	if err != nil {
		t.Fatalf("owner update announcement: %v", err)
	}
	if res.SysMsg == nil || res.SysMsg.MessageType != model.MessageTypeSystem {
		t.Fatal("should emit system message")
	}
	if updatedAt == nil {
		t.Fatal("announcement_updated_at should be set")
	}

	if _, _, _, err := svc.UpdateAnnouncement(ctx, member.ID, convID, "x"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("normal member should get ErrForbidden, got %v", err)
	}
	if _, _, _, err := svc.UpdateAnnouncement(ctx, outsider.ID, convID, "x"); !errors.Is(err, ErrNotMember) {
		t.Fatalf("outsider should get ErrNotMember, got %v", err)
	}
}
```

（`makeFriends`/`newManagedGroup` 为现有 helper；`errors` import。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/service/ -run TestUpdateAnnouncement -v`
Expected: 编译失败（`UpdateAnnouncement` undefined）。

- [ ] **Step 3: 写 UpdateAnnouncement service**

`conversation_experience.go` 追加（照 RenameGroup 模板）：

```go
// UpdateAnnouncement 更新群公告（role >= Admin）。空文案 = 清除公告。
// 事务内写 announcement + announcement_updated_at 并落系统消息，返回供 handler 推 WS。
func (s *ConversationService) UpdateAnnouncement(
	ctx context.Context, operatorID, convID uuid.UUID, text string,
) (*GroupOpResult, *string, *time.Time, error) {
	text = strings.TrimSpace(text)
	if len([]rune(text)) > 1000 {
		return nil, nil, nil, ErrInvalidName
	}
	_, role, err := s.loadGroupAndRole(ctx, convID, operatorID)
	if err != nil {
		return nil, nil, nil, err
	}
	if role < model.MemberRoleAdmin {
		return nil, nil, nil, ErrForbidden
	}

	now := time.Now().Truncate(time.Microsecond)
	var announcement *string
	if text != "" {
		announcement = &text
	}
	var sysText string
	if text == "" {
		sysText = fmt.Sprintf("%s 清空了群公告", s.nicknameOf(ctx, operatorID))
	} else {
		sysText = fmt.Sprintf("%s 更新了群公告", s.nicknameOf(ctx, operatorID))
	}

	var sysMsg *model.Message
	err = s.convRepo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.Conversation{}).Where("id = ?", convID).
			Updates(map[string]any{"announcement": announcement, "announcement_updated_at": now}).Error; err != nil {
			return err
		}
		var e error
		sysMsg, e = appendSystemMessage(ctx, tx, convID, operatorID, sysText)
		return e
	})
	if err != nil {
		return nil, nil, nil, err
	}
	memberIDs, err := s.convRepo.GetMemberIDs(ctx, convID)
	if err != nil {
		return nil, nil, nil, err
	}
	return &GroupOpResult{SysMsg: sysMsg, SysText: sysText, MemberIDs: memberIDs}, announcement, &now, nil
}
```

（import `strings`/`fmt`/`time`/`gorm`；`ErrInvalidName` 复用现有哨兵，超长文案报它。）

- [ ] **Step 4: DTO 加字段 + List 装配**

`conversation_service.go` `ConversationDTO` 加：

```go
	Announcement          *string    `json:"announcement,omitempty"`
	AnnouncementUpdatedAt *time.Time `json:"announcement_updated_at,omitempty"`
```

`List` 循环装配（`c.*` 投影已带出这两列到 `item.Conversation`）：

```go
			Announcement:          item.Announcement,
			AnnouncementUpdatedAt: item.AnnouncementUpdatedAt,
```

- [ ] **Step 5: WS payload 加字段**

`ws/protocol.go` `ConversationUpdatedPayload` 加（在 IsMuted 后）：

```go
	Announcement          *string    `json:"announcement,omitempty"`
	AnnouncementUpdatedAt *time.Time `json:"announcement_updated_at,omitempty"`
```

注释补一句：置顶/免打扰/公告变更复用本帧。

- [ ] **Step 6: 写 handler**

`handler/conversation_experience.go`（新文件）：

```go
package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/middleware"
	"github.com/yuanchat/server/internal/ws"
)

// AnnouncementBody 群公告请求体（空串 = 清除公告）。
type AnnouncementBody struct {
	Announcement string `json:"announcement"`
}

// UpdateAnnouncement PATCH /conversations/:id/announcement（role >= Admin）。
func (h *ConversationHandler) UpdateAnnouncement(c *gin.Context) {
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
	var body AnnouncementBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}
	res, announcement, updatedAt, err := h.svc.UpdateAnnouncement(c.Request.Context(), userID, convID, body.Announcement)
	if err != nil {
		h.groupErr(c, err)
		return
	}
	h.pushSystemReceive(res.MemberIDs, res.SysMsg, res.SysText)
	h.pushUpdated(res.MemberIDs, ws.ConversationUpdatedPayload{
		ConversationID:        convID,
		Announcement:          announcement,
		AnnouncementUpdatedAt: updatedAt,
	})
	Success(c, gin.H{"announcement": announcement, "announcement_updated_at": updatedAt})
}
```

- [ ] **Step 7: 跑测试**

Run: `cd server && go test ./internal/service/ -run TestUpdateAnnouncement -v && go build ./... && go vet ./...`
Expected: PASS，build/vet 干净。

- [ ] **Step 8: Commit**

```bash
git add server/internal/service/conversation_experience.go server/internal/service/conversation_service.go server/internal/handler/conversation_experience.go server/internal/ws/protocol.go server/internal/service/conversation_experience_test.go
git commit -m "feat(server): 群公告编辑（管理员权限 + 系统消息 + conversation.updated 帧）"
```

---

## Task 4: 群内昵称 alias（service + handler + 成员列表/实时署名）

**Files:**

- Modify: `server/internal/service/conversation_experience.go`
- Modify: `server/internal/service/conversation_service.go`（`ErrInvalidAlias` 哨兵；`Members` 透出 alias）
- Modify: `server/internal/repository/conversation_repo.go`（`MemberWithUser` 加 alias，`ListMembers` alias 替换 nickname）
- Modify: `server/internal/service/message_service.go`（`SendContent` 群会话署名取 alias）
- Modify: `server/internal/handler/conversation_experience.go`
- Modify: `server/internal/handler/conversation_manage.go`（`groupErr` 加 `ErrInvalidAlias`→400）
- Test: `server/internal/service/conversation_experience_test.go`

**Interfaces:**

- Consumes: `UpdateMemberSettings`（map 泛化，复用写 alias）；`GetMember`
- Produces: `ConversationService.UpdateMyAlias(ctx, userID, convID uuid.UUID, alias string) error`；`ErrInvalidAlias`；`MemberWithUser.Nickname` 在群内变为 `COALESCE(alias, nickname)`

- [ ] **Step 1: 写失败测试**

```go
// TestUpdateMyAlias 任意成员可改自己的群昵称，超 30 字符 ErrInvalidAlias，成员列表署名生效。
func TestUpdateMyAlias(t *testing.T) {
	db := testDB(t)
	db.AutoMigrate(&model.ConversationMember{})
	owner := newTestUser(t, db, "群主")
	member := newTestUser(t, db, "普通成员本名")
	svc := newConvSvc(db)
	makeFriends(t, db, owner, member)
	convID := newManagedGroup(t, svc, owner, member)
	ctx := context.Background()

	if err := svc.UpdateMyAlias(ctx, member.ID, convID, "群里的我"); err != nil {
		t.Fatalf("member set alias: %v", err)
	}
	members, err := svc.Members(ctx, owner.ID, convID)
	if err != nil {
		t.Fatalf("members: %v", err)
	}
	var found bool
	for _, m := range members {
		if m.UserID == member.ID {
			found = true
			if m.Nickname != "群里的我" {
				t.Fatalf("alias should override nickname in member list, got %q", m.Nickname)
			}
		}
	}
	if !found {
		t.Fatal("member not in list")
	}

	// 超长报 ErrInvalidAlias
	long := ""
	for i := 0; i < 31; i++ {
		long += "x"
	}
	if err := svc.UpdateMyAlias(ctx, member.ID, convID, long); !errors.Is(err, ErrInvalidAlias) {
		t.Fatalf("31 chars should be ErrInvalidAlias, got %v", err)
	}

	// 空串 = 清除，署名回退本名
	if err := svc.UpdateMyAlias(ctx, member.ID, convID, ""); err != nil {
		t.Fatalf("clear alias: %v", err)
	}
	members2, _ := svc.Members(ctx, owner.ID, convID)
	for _, m := range members2 {
		if m.UserID == member.ID && m.Nickname != "普通成员本名" {
			t.Fatalf("cleared alias should fall back to nickname, got %q", m.Nickname)
		}
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/service/ -run TestUpdateMyAlias -v`
Expected: 编译失败（`UpdateMyAlias`/`ErrInvalidAlias` undefined）。

- [ ] **Step 3: 加哨兵 + service**

`conversation_service.go` 错误区加：

```go
	// ErrInvalidAlias 群昵称超长（>30 rune）。空串允许（= 清除昵称）。
	ErrInvalidAlias = errors.New("alias too long")
```

`conversation_experience.go` 追加：

```go
// UpdateMyAlias 设置本人在群内的昵称（任意成员）。空串 = 清除（署名回退本名）。
// 上限 30 rune。非成员 ErrNotMember。
func (s *ConversationService) UpdateMyAlias(ctx context.Context, userID, convID uuid.UUID, alias string) error {
	alias = strings.TrimSpace(alias)
	if len([]rune(alias)) > 30 {
		return ErrInvalidAlias
	}
	ok, err := s.convRepo.IsMember(ctx, convID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotMember
	}
	return s.convRepo.UpdateMemberSettings(ctx, convID, userID, map[string]any{"alias": alias})
}
```

（空串写入空串 `""`，配合 `NULLIF(alias,'')` 回退 nickname。）

- [ ] **Step 4: 成员列表 alias 替换**

`conversation_repo.go` `ListMembers` 的 Select 把 `u.nickname` 改为 `COALESCE(NULLIF(cm.alias, ''), u.nickname) AS nickname`；`MemberWithUser` 可选加 `Alias *string`（若前端需要单独展示当前 alias 值——ChatDetail 编辑时要回填，加 `cm.alias AS alias`）：

```go
	Select("cm.user_id, COALESCE(NULLIF(cm.alias, ''), u.nickname) AS nickname, u.avatar_url, cm.role, cm.alias").
```

`MemberWithUser` 加 `Alias *string json:"alias,omitempty"`。

- [ ] **Step 5: 实时发送署名取 alias**

`message_service.go` `SendContent` 装配 `SenderNickname` 处：群会话（`conv.Type == ConversationTypeGroup`）查成员 alias 覆盖。取当前发送者成员行 `GetMember(ctx, convID, senderID)`，`if m.Alias != nil && *m.Alias != "" { senderNickname = *m.Alias }`。放在现有 `sender.Nickname` 赋值之后。

- [ ] **Step 6: handler + 路由错误映射**

`handler/conversation_experience.go` 加：

```go
// AliasBody 群昵称请求体（空串 = 清除）。
type AliasBody struct {
	Alias string `json:"alias"`
}

// UpdateMyAlias PUT /conversations/:id/my-alias（任意成员）。
func (h *ConversationHandler) UpdateMyAlias(c *gin.Context) {
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
	var body AliasBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}
	if err := h.svc.UpdateMyAlias(c.Request.Context(), userID, convID, body.Alias); err != nil {
		h.groupErr(c, err)
		return
	}
	Success(c, gin.H{"alias": body.Alias})
}
```

`conversation_manage.go` `groupErr` 的 BadRequest 分支加 `errors.Is(err, service.ErrInvalidAlias)`。

- [ ] **Step 7: 跑测试**

Run: `cd server && go test ./internal/service/ -run TestUpdateMyAlias -v && go build ./... && go vet ./...`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add -A server/
git commit -m "feat(server): 群内昵称 alias（成员列表/群消息署名 COALESCE 覆盖）"
```

---

## Task 5: 路由注册 + API 文档

**Files:**

- Modify: `server/internal/router/router.go`
- Modify: `docs/02_CHAT_API.md`
- Test: 无新测试（端点经 service 测试覆盖；本 task 是接线 + 文档）

- [ ] **Step 1: 注册路由**

`router.go` chat 组内 `TransferOwner` 行后加：

```go
		chat.DELETE("/conversations/:id/messages", convH.ClearHistory)
		chat.PATCH("/conversations/:id/announcement", convH.UpdateAnnouncement)
		chat.PUT("/conversations/:id/my-alias", convH.UpdateMyAlias)
```

- [ ] **Step 2: 写 ClearHistory handler**

`handler/conversation_experience.go` 加：

```go
// ClearHistory DELETE /conversations/:id/messages（单侧清空，member 维度）。
func (h *ConversationHandler) ClearHistory(c *gin.Context) {
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
	if err := h.svc.ClearHistory(c.Request.Context(), userID, convID); err != nil {
		h.groupErr(c, err)
		return
	}
	Success(c, gin.H{})
}
```

- [ ] **Step 3: 文档**

`docs/02_CHAT_API.md`：GET /conversations 响应字段说明加 `announcement`/`announcement_updated_at`；成员列表说明 `nickname` 群内为 alias 覆盖值、新增 `alias` 原始字段；新增三小节：

- `DELETE /conversations/:id/messages`（单侧清空，非成员 403，软清空对方无感）
- `PATCH /conversations/:id/announcement`（role≥Admin，普通成员 403，空串清除，发系统消息 + conversation.updated）
- `PUT /conversations/:id/my-alias`（任意成员，≤30 字符超限 400，空串清除）
  WS 帧表 `conversation.updated` 行补 announcement 字段说明。

- [ ] **Step 4: 编译 + 全量后端测试**

Run: `cd server && go build ./... && go vet ./... && go test -race ./internal/...`
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add server/internal/router/router.go server/internal/handler/conversation_experience.go docs/02_CHAT_API.md
git commit -m "feat(server): A7 三端点路由注册 + API 文档"
```

---

## Task 6: 前端 shared 层（API + DTO + store）

**Files:**

- Modify: `packages/shared/src/api/groups.ts`
- Modify: `packages/shared/src/api/chat.ts`
- Modify: `packages/shared/src/store/conversationStore.ts`
- Modify: `packages/shared/src/ws/chatSocket.ts`
- Modify: `packages/shared/src/hooks/useChatBootstrap.ts`
- Test: `packages/shared/src/__tests__/chatApi.test.ts`

**Interfaces:**

- Produces: `clearHistory(convId)`、`updateAnnouncement(convId, text)`、`updateMyAlias(convId, alias)`；`Conversation.announcement?: string`、`.announcementUpdatedAt?: string`；`ConversationMember.alias?: string`

- [ ] **Step 1: 写失败测试（mapConversation 透出 announcement + member alias）**

`chatApi.test.ts` 加：构造 `ConversationDTO` 带 `announcement`/`announcement_updated_at` → `mapConversation` 断言 `announcement`/`announcementUpdatedAt` 映射；构造 `MemberDTO` 带 `alias` → `fetchMembers` map 断言 `alias` 透传。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @yuanchat/shared test -- chatApi`
Expected: FAIL（字段 undefined）。

- [ ] **Step 3: API 函数**

`api/groups.ts` 加：

```ts
/** 单侧清空聊天记录（软清空，对方不受影响）。 */
export async function clearHistory(convId: string): Promise<void> {
  await apiDelete<Record<string, never>>("/api/v1/conversations/" + convId + "/messages");
}

/** 更新群公告（管理员，空串清除）。成功由 conversation.updated 帧驱动列表态。 */
export async function updateAnnouncement(convId: string, announcement: string): Promise<void> {
  await apiPatch<{ announcement: string | null }>(
    "/api/v1/conversations/" + convId + "/announcement",
    { announcement },
  );
}

/** 设置本人群昵称（空串清除，≤30 字符）。 */
export async function updateMyAlias(convId: string, alias: string): Promise<void> {
  await apiPut<{ alias: string }>("/api/v1/conversations/" + convId + "/my-alias", { alias });
}
```

（`apiPut` 需在 import 里补上。）

- [ ] **Step 4: DTO 字段**

`api/chat.ts`：`ConversationDTO` 加 `announcement?: string | null`、`announcement_updated_at?: string`；`mapConversation` 加 `announcement: dto.announcement ?? undefined`、`announcementUpdatedAt: dto.announcement_updated_at`；`MemberDTO` 加 `alias?: string | null`，`ConversationMember` 加 `alias?: string`，map 里 `alias: m.alias ?? undefined`；`conversationUpdatePatch`（帧 patch）加 `if (p.announcement !== undefined) patch.announcement = p.announcement ?? undefined;` 及 updatedAt。

- [ ] **Step 5: store + 帧类型**

`conversationStore.ts` `Conversation` 加 `announcement?: string`、`announcementUpdatedAt?: string`（注意勿与既有 `pinnedMessage` 混用）。`chatSocket.ts` `conversation.updated` 帧类型加 `announcement?: string | null`、`announcement_updated_at?: string`。`useChatBootstrap.ts` 的 `conversation.updated` handler 已调 `conversationUpdatePatch(p)`（A6 接线），确认 patch 覆盖 announcement 即可，无需重复加。

- [ ] **Step 6: 跑测试**

Run: `pnpm --filter @yuanchat/shared test`
Expected: 全 PASS。

- [ ] **Step 7: Commit**

```bash
git add packages/shared/
git commit -m "feat(shared): A7 API 封装 + 公告/alias DTO 映射 + 帧扩展"
```

---

## Task 7: messageStore clearConversation action

**Files:**

- Modify: `packages/shared/src/store/messageStore.ts`
- Modify: `packages/shared/src/index.ts`（若 action 经 store 导出则无需）
- Test: `packages/shared/src/__tests__/messageStore.test.ts`

**Interfaces:**

- Produces: `useMessageStore` 加 `clearConversation(convId: string): void`

- [ ] **Step 1: 写失败测试**

`messageStore.test.ts` 加：setState 塞入 CONV_A 两条 + CONV_B 一条 → 调 `clearConversation("CONV_A")` → 断言 `messagesByConv["CONV_A"]` 为 `[]`、`hasMoreByConv["CONV_A"]` 为 `false`、CONV_B 不受影响。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @yuanchat/shared test -- messageStore`
Expected: FAIL（action 不存在）。

- [ ] **Step 3: 实现 action**

`messageStore.ts` 接口加 `clearConversation: (convId: string) => void;`，实现（不可变更新）：

```ts
  clearConversation: (convId) =>
    set((s) => ({
      messagesByConv: { ...s.messagesByConv, [convId]: [] },
      hasMoreByConv: { ...s.hasMoreByConv, [convId]: false },
    })),
```

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @yuanchat/shared test -- messageStore`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/store/messageStore.ts packages/shared/src/__tests__/messageStore.test.ts
git commit -m "feat(shared): messageStore 加 clearConversation 单会话清空 action"
```

---

## Task 8: ChatDetail 接线（清空 + 公告编辑 + alias 编辑）

**Files:**

- Modify: `packages/ui/src/ChatDetail.tsx`
- Test: `packages/ui/src/__tests__/ChatDetail.test.tsx`

**Interfaces:**

- Consumes: `clearHistory`/`updateAnnouncement`/`updateMyAlias`（Task 6）；`clearConversation`（Task 7）；`ConfirmDialog`（现有）；`members.find(m => m.userId === selfId)?.alias`（Task 6 DTO）

- [ ] **Step 1: 写失败测试**

`ChatDetail.test.tsx`：mock 加 `clearHistory`/`updateAnnouncement`/`updateMyAlias`/`clearConversation` 为 `vi.fn()`。用例：

- 点「Clear chat history」→ 弹确认 → 点确认 → `clearHistory` + `clearConversation` 被调
- 群聊 + 管理员：编辑公告保存 → `updateAnnouncement` 被调
- 群聊任意成员：编辑 alias 保存 → `updateMyAlias` 被调

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @yuanchat/ui test -- ChatDetail`
Expected: FAIL。

- [ ] **Step 3: 清空记录接线**

`ChatDetail.tsx`：加 `const [confirmClear, setConfirmClear] = useState(false);`。危险操作区 `Trash2` DangerRow 加 `onClick={() => setConfirmClear(true)}`。加 `handleClear`：

```tsx
const handleClear = () => {
  setConfirmClear(false);
  clearHistory(conv.id)
    .then(() => clearConversation(conv.id))
    .catch(() => showToast("error", t("common.opFailed")));
};
```

加对应 `ConfirmDialog`（`open={confirmClear}`、`title={t("detail.clearHistory")}`、`message={t("detail.clearHistoryConfirm")}`、`danger`、`onConfirm={handleClear}`、`onCancel={() => setConfirmClear(false)}`）。

- [ ] **Step 4: 公告编辑（群聊 + 管理员）**

群聊块内加公告展示/编辑区，`{isGroup && (...)}`，编辑触发条件 `myRole >= 1`。仿改名内联模式，但公告多行用 `<textarea>`（复用 Composer 的自适应或固定 rows）。当前值来自 `conv.announcement`，空时显示 `t("detail.notSet")`。保存：

```tsx
const saveAnnouncement = () => {
  const trimmed = announcementDraft.trim();
  setEditingAnnouncement(false);
  if (trimmed === (conv.announcement ?? "")) return;
  updateAnnouncement(conv.id, trimmed).catch(() =>
    showToast("error", t("detail.announcementFailed")),
  );
};
```

（普通成员只读展示公告，不显示编辑按钮。）

- [ ] **Step 5: alias 编辑（群聊 + 任意成员）**

群聊块内加「我在本群的昵称」行（`t("detail.myAlias")`），当前值 `members.find(m => m.userId === selfId)?.alias`（空显示 `t("detail.notSet")`）。仿改名内联单行 input，`maxLength={30}`。保存：

```tsx
const saveAlias = () => {
  const trimmed = aliasDraft.trim();
  setEditingAlias(false);
  updateMyAlias(conv.id, trimmed)
    .then(() =>
      // 触发成员重拉（ChatDetail 的成员 effect 以 memberVersion 为依赖，现有机制）
      updateConversation(conv.id, { memberVersion: (conv.memberVersion ?? 0) + 1 }),
    )
    .catch(() => showToast("error", t("detail.aliasFailed")));
};
```

（成员列表经 memberVersion bump 重拉后反映新 alias；`updateConversation` 从 `useConversationStore` 取。）

- [ ] **Step 6: 跑测试**

Run: `pnpm --filter @yuanchat/ui test -- ChatDetail`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/ChatDetail.tsx packages/ui/src/__tests__/ChatDetail.test.tsx
git commit -m "feat(ui): 会话详情接线清空记录 + 群公告编辑 + 群内昵称编辑"
```

---

## Task 9: 公告横幅 + 全文弹层

**Files:**

- Modify: `packages/ui/src/ChatWindow.tsx`
- Create: `packages/ui/src/AnnouncementDialog.tsx`
- Modify: `packages/ui/src/index.ts`（导出 AnnouncementDialog）
- Test: `packages/ui/src/__tests__/`（ChatWindow 或新建）

**Interfaces:**

- Consumes: `conv.announcement`、`conv.announcementUpdatedAt`（Task 6）
- Produces: `AnnouncementDialog`（只读全文弹层）

- [ ] **Step 1: 写 AnnouncementDialog**

照 ConfirmDialog 结构的只读弹层：遮罩 `fixed inset-0 z-50 grid place-items-center bg-black/40`，卡片 `bg-surface-container-low rounded-lg`，展示标题 + 正文（`whitespace-pre-wrap` 保留换行）+ 关闭按钮。Props `{ open, announcement, onClose }`。

- [ ] **Step 2: 横幅接线（未读态 localStorage）**

`ChatWindow.tsx` header 后加公告横幅（仿 pin-bar 结构，图标用 `Megaphone`/`Bell`）。仅群聊且 `conv.announcement` 非空显示。未读态：

```tsx
const annKey = "announcement-read:" + conv.id;
const isUnread = conv.announcementUpdatedAt
  ? (localStorage.getItem(annKey) ?? "") < conv.announcementUpdatedAt
  : false;
```

点横幅打开 `AnnouncementDialog` 并 `localStorage.setItem(annKey, conv.announcementUpdatedAt ?? "")` 标记已读。未读时横幅加高亮点/加粗。

- [ ] **Step 3: 写测试**

渲染 ChatWindow（群会话带 announcement）→ 断言横幅文本出现；点横幅 → 全文弹层出现。未读态断言可选（localStorage 交互）。

- [ ] **Step 4: 跑测试 + i18n 检查**

Run: `pnpm --filter @yuanchat/ui test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/ChatWindow.tsx packages/ui/src/AnnouncementDialog.tsx packages/ui/src/index.ts packages/ui/src/__tests__/
git commit -m "feat(ui): 群公告顶部横幅 + 未读提示 + 全文弹层"
```

---

## Task 10: i18n 四语言 key + E2E + 全量门禁

**Files:**

- Modify: `packages/design-system/src/i18n/locales/{zh-CN,en-US,ja-JP,ko-KR}.json`
- Create: `apps/web/e2e/chat-experience.spec.ts`
- Test: 全量门禁

**Interfaces:**

- Consumes: 前序所有 task 引用的 i18n key

- [ ] **Step 1: 补 i18n key（四语言同步）**

新增 key（已存在的 `detail.clearHistory`/`detail.myAlias`/`detail.notSet` 不重复加）：

- `detail.clearHistoryConfirm`（清空二次确认）
- `detail.announcement`（群公告标签）、`detail.announcementPlaceholder`、`detail.announcementFailed`
- `detail.aliasPlaceholder`、`detail.aliasFailed`
- `chat.announcementLabel`（横幅标题）、`chat.announcementViewFull`（点开全文）
- `announcement.dialogTitle`（全文弹层标题）
  四语言全加。中文示例：`"detail.clearHistoryConfirm": "确定清空聊天记录？此操作只清除你这一侧，对方不受影响。"`。日韩英对应翻译。

- [ ] **Step 2: i18n 校验**

Run: `node scripts/check-i18n.mjs`
Expected: `passed — 4 locales × N keys`。

- [ ] **Step 3: E2E（playwright 浏览器实测）**

`apps/web/e2e/chat-experience.spec.ts`：`setAuth` + `waitForMSW` + `goto("/chat")`。用例（mock 模式）：

- 进群会话 → 开详情 → 点「清空聊天记录」→ 确认弹窗出现 → 确认 → 消息流清空
- 群公告横幅（demoData 给某会话加 announcement）→ 点开 → 全文弹层
- alias 编辑入口可见并可保存
  （mock 模式清空/公告/alias 需 demoData 本地态或 MSW handler 支持——在 mocks/handlers.ts 加 `DELETE .../messages`、`PATCH .../announcement`、`PUT .../my-alias` 返回 apiOk；demoData 给群会话补 announcement 字段。）
  用 playwright 浏览器实际跑通并观察。

- [ ] **Step 4: 全量门禁**

Run（逐条）：

```bash
pnpm test                                    # vitest 全包
node scripts/check-i18n.mjs                  # i18n
pnpm --filter @yuanchat/web build            # web 构建（es2019）
pnpm --filter @yuanchat/desktop exec tsc --noEmit
pnpm --filter @yuanchat/admin exec tsc --noEmit
cd server && go vet ./... && go test -race ./internal/...
cd apps/web && pnpm test:e2e                 # 或 playwright 浏览器实测
```

Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add packages/design-system/src/i18n/ apps/web/e2e/chat-experience.spec.ts packages/shared/src/mocks/
git commit -m "feat: A7 四语言文案 + E2E 用例 + 全量门禁验证"
```

- [ ] **Step 6: 手工验收清单（真实后端双浏览器）**

1. 清空记录：A 清空与 B 的会话 → A 刷新拉不到旧消息、B 仍能看到全部；A 收到新消息后可见新消息
2. 公告权限：普通成员 PATCH announcement → 403；管理员可编辑 → 群内出系统消息「X 更新了群公告」+ 横幅刷新
3. 公告未读：B 端横幅显示未读高亮，点开后消失，刷新不再高亮
4. alias：成员改群昵称 → 群消息气泡署名 + 成员列表变 alias；单聊不受影响；清空 alias 回退本名

---

## Self-Review

**Spec 覆盖**：迁移 010 四列 ✅（Task 1）；清空 REST + seq 过滤 + 对方无感 ✅（Task 2）；公告管理员编辑 + 系统消息 + WS ✅（Task 3）；alias 群署名 + 成员列表 ✅（Task 4）；路由 + 文档 ✅（Task 5）；前端清空确认弹窗 ✅（Task 8）；公告横幅 + 全文 ✅（Task 9）；alias 编辑 + 气泡署名（后端替换，前端零改动）✅（Task 4 + 8）。

**类型一致性**：`ClearedBeforeSeq int64` 贯穿 model→投影→GetHistory；`ListBefore(convID, beforeSeq, minSeq, limit)` 新签名在 Task 2 全调用点更新；`UpdateAnnouncement` 返回 `(*GroupOpResult, *string, *time.Time, error)` 四元组在 handler 一致解构；`announcement`/`announcementUpdatedAt` 命名前后端一致（Go snake_case JSON ↔ TS camelCase map）。

**决策已定**：alias 后端替换（用户确认）、软清空、localStorage 未读态。
