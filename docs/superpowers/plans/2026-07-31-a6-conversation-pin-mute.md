# A6 会话置顶 + 免打扰完善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 会话可置顶排序（member 维度持久化 + 多端同步）；免打扰全链路补完（REST 写端点 + 服务端离线 Web Push 过滤）。

**Architecture:** 后端加迁移 009（`conversation_members` + `is_pinned`/`pinned_at`）与 `PUT /conversations/:id/settings` 端点，复用 `conversation.updated` WS 帧只推本人实现多端同步；离线 Web Push 在 router 装配层按 muted 成员过滤。前端走「乐观更新 + 失败回滚」的共享 helper，ConversationList 加 pinnedAt 排序与右键/长按菜单（照 MessageBubble 模式）。

**Tech Stack:** Go (gin + gorm + goose + gorilla/websocket) / React + Zustand + react-i18next / vitest + Playwright。

## Global Constraints

- GitFlow：本计划全部工作在 `feature/conversation-pin-mute` 分支（自 dev 新建）；每任务本地 commit；**未经用户当次允许禁止合并回 dev**。
- Commit message 不写版本号前缀（如 `feat(v0.4/A6):` 禁止），用 `feat(server): ...` 风格。
- i18n：UI 文案零硬编码；新 key 四语言（zh-CN/en-US/ja-JP/ko-KR）同步加；`node scripts/check-i18n.mjs` 必须过。
- `build.target=es2019`（源代码可用 `?.`/`??`，vite 转译；不引入 es2020+ 运行时 API）。
- UI 圆角上限 `rounded-lg`（菜单/弹层沿用现有 `rounded-lg`）。
- 幽灵依赖：`packages/shared` **不得** import `lucide-react`/`react-i18next`（未声明）；图标与组件层文案放 `packages/ui`；shared 内用 `i18n.t`（经已声明的 `@yuanchat/design-system`）。
- 数据库改动走 goose 迁移 `server/internal/database/migrations/009_*.sql`，语句幂等（IF NOT EXISTS / IF EXISTS）。
- 测试通过才能继续下一任务；服务端集成测试连 dev 库（`make docker-up` 起 postgres:5434），连不上自动 Skip。
- 启动/打包命令无变更 → `docs/DEVELOPMENT.md` 不动；API 变更同步 `docs/02_CHAT_API.md`（Task 3）。

## File Structure（全景）

**后端（server/）**

- Create: `internal/database/migrations/009_a6_conversation_settings.sql` — 迁移
- Modify: `internal/model/conversation.go` — ConversationMember 加 IsPinned/PinnedAt
- Modify: `internal/repository/conversation_repo.go` — 投影字段、GetMember、UpdateMemberSettings、MutedMemberIDs
- Modify: `internal/service/conversation_service.go` — DTO 字段 + UpdateSettings
- Modify: `internal/handler/conversation.go` — UpdateSettings handler
- Modify: `internal/router/router.go` — 路由 + 离线推送 muted 过滤
- Modify: `internal/ws/protocol.go` — ConversationUpdatedPayload 扩展
- Create: `internal/service/conversation_settings_test.go`、Modify: `internal/ws/protocol_test.go`

**前端（packages/）**

- Modify: `shared/src/api/chat.ts` — DTO 字段、mapConversation、updateConversationSettings、conversationUpdatePatch
- Modify: `shared/src/store/conversationStore.ts` — Conversation 加 pinnedAt
- Create: `shared/src/conversationSettings.ts` — applyConversationSetting（乐观 + 回滚）
- Modify: `shared/src/ws/chatSocket.ts` — ServerFrames 扩展
- Modify: `shared/src/hooks/useChatBootstrap.ts` — conversation.updated handler 换用 conversationUpdatePatch
- Modify: `shared/src/index.ts`、`shared/src/mocks/demoData.ts`
- Modify: `ui/src/ChatDetail.tsx` — 开关接 helper
- Modify: `ui/src/ConversationList.tsx` — pinnedAt 排序 + 右键/长按菜单
- Modify: `design-system/src/i18n/locales/{zh-CN,en-US,ja-JP,ko-KR}.json` — 5 个新 key
- 测试：`shared/src/__tests__/{chatApi,conversationSettings}.test.ts`、`ui/src/__tests__/{ChatDetail,ConversationList}.test.tsx`、`apps/web/e2e/conversation-settings.spec.ts`

---

### Task 0: 建分支

- [ ] **Step 1: 从 dev 新建 feature 分支**

```bash
cd /home/liaojie1314/code/project/yuanchat
git checkout dev && git pull origin dev
git checkout -b feature/conversation-pin-mute
```

---

### Task 1: 迁移 009 + 模型字段 + 列表 DTO 透出

**Files:**

- Create: `server/internal/database/migrations/009_a6_conversation_settings.sql`
- Modify: `server/internal/model/conversation.go`（ConversationMember，36-51 行附近）
- Modify: `server/internal/repository/conversation_repo.go`（ConversationListItem 12-20 行、ListByUserID 41 行 SELECT）
- Modify: `server/internal/service/conversation_service.go`（ConversationDTO 25-39 行、List 装配 90-101 行）
- Test: `server/internal/service/conversation_settings_test.go`（新建）

**Interfaces:**

- Produces: `model.ConversationMember.IsPinned bool` / `.PinnedAt *time.Time`；`repository.ConversationListItem.IsPinned/.PinnedAt`；`service.ConversationDTO.IsPinned bool json:"is_pinned"` / `.PinnedAt *time.Time json:"pinned_at,omitempty"`。后续任务依赖这些确切名字。

- [ ] **Step 1: 写失败测试**（直接置 DB 行，断言 List 透出字段）

新建 `server/internal/service/conversation_settings_test.go`：

```go
package service

import (
	"context"
	"testing"
	"time"

	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
)

// settingsTestEnv 建一个双人单聊 + service（复用包内 testDB/newTestUser 助手）。
func settingsTestEnv(t *testing.T) (svcEnv struct {
	DB   *gorm.DB
	Svc  *ConversationService
	Conv *model.Conversation
	A, B *model.User
}) {
	t.Helper()
	db := testDB(t)
	// dev 库可能尚未跑 goose 009：AutoMigrate 兜底补列（与 contact_service_test.go:39 同范式）
	if err := db.AutoMigrate(&model.ConversationMember{}); err != nil {
		t.Fatalf("automigrate conversation_members: %v", err)
	}
	a := newTestUser(t, db, "甲settings")
	b := newTestUser(t, db, "乙settings")
	conv := &model.Conversation{Type: model.ConversationTypePrivate}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("create conv: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(conv) })
	for _, u := range []*model.User{a, b} {
		m := &model.ConversationMember{ConversationID: conv.ID, UserID: u.ID, JoinedAt: time.Now()}
		if err := db.Create(m).Error; err != nil {
			t.Fatalf("create member: %v", err)
		}
	}
	t.Cleanup(func() {
		db.Where("conversation_id = ?", conv.ID).Delete(&model.ConversationMember{})
	})
	svcEnv.DB = db
	svcEnv.Svc = NewConversationService(
		repository.NewConversationRepository(db), repository.NewMessageRepository(db),
		repository.NewContactRepository(db), repository.NewUserRepository(db), zap.NewNop())
	svcEnv.Conv = conv
	svcEnv.A, svcEnv.B = a, b
	return svcEnv
}

// TestListSurfacesPinnedFields 列表 DTO 透出 is_pinned / pinned_at。
func TestListSurfacesPinnedFields(t *testing.T) {
	env := settingsTestEnv(t)
	now := time.Now()
	if err := env.DB.Model(&model.ConversationMember{}).
		Where("conversation_id = ? AND user_id = ?", env.Conv.ID, env.A.ID).
		Updates(map[string]any{"is_pinned": true, "pinned_at": now}).Error; err != nil {
		t.Fatalf("seed pinned: %v", err)
	}

	dtos, err := env.Svc.List(context.Background(), env.A.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	var found bool
	for _, d := range dtos {
		if d.ID == env.Conv.ID {
			found = true
			if !d.IsPinned || d.PinnedAt == nil {
				t.Fatalf("want pinned dto, got %+v", d)
			}
		}
	}
	if !found {
		t.Fatal("conversation not in list")
	}
}
```

（import 需含 `"gorm.io/gorm"`。）

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/liaojie1314/code/project/yuanchat/server && make docker-up
go test ./internal/service/ -run TestListSurfacesPinnedFields -v
```

预期：编译失败（`d.IsPinned` / `model.ConversationMember` 无 `IsPinned` 字段）。

- [ ] **Step 3: 写迁移 009**

`server/internal/database/migrations/009_a6_conversation_settings.sql`：

```sql
-- +goose Up
-- +goose StatementBegin
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE conversation_members DROP COLUMN IF EXISTS pinned_at;
ALTER TABLE conversation_members DROP COLUMN IF EXISTS is_pinned;
-- +goose StatementEnd
```

- [ ] **Step 4: 模型 + 投影 + DTO 三处加字段**

`server/internal/model/conversation.go` — ConversationMember 的 `IsMuted` 行后加：

```go
	IsPinned bool       `gorm:"default:false" json:"is_pinned"`
	PinnedAt *time.Time `json:"pinned_at,omitempty"`
```

`server/internal/repository/conversation_repo.go` — ConversationListItem（12-20 行）加：

```go
	IsPinned bool       `json:"is_pinned"`
	PinnedAt *time.Time `json:"pinned_at"`
```

同文件 ListByUserID 的 SELECT（41 行）改为：

```go
		Select(`c.*, cm.role, cm.last_read_seq, cm.is_muted, cm.mention_unread, cm.is_pinned, cm.pinned_at,
			(SELECT count(*) FROM conversation_members m2 WHERE m2.conversation_id = c.id) AS member_count`).
```

`server/internal/service/conversation_service.go` — ConversationDTO 的 `IsMuted` 行后加：

```go
	IsPinned bool       `json:"is_pinned"`
	PinnedAt *time.Time `json:"pinned_at,omitempty"`
```

List 装配（`IsMuted: item.IsMuted,` 行后）加：

```go
			IsPinned:      item.IsPinned,
			PinnedAt:      item.PinnedAt,
```

- [ ] **Step 5: 应用迁移 + 跑测试确认通过**

```bash
cd /home/liaojie1314/code/project/yuanchat/server
go run ./cmd/migrate up
go test ./internal/service/ -run TestListSurfacesPinnedFields -v
```

预期：PASS（dev 库连不上则 Skip——此时须先 `make docker-up`，Skip 不算通过）。

- [ ] **Step 6: 全量回归 + commit**

```bash
go vet ./... && go test -short ./...
git add internal/database/migrations/009_a6_conversation_settings.sql internal/model/conversation.go internal/repository/conversation_repo.go internal/service/conversation_service.go internal/service/conversation_settings_test.go
git commit -m "feat(server): 会话置顶字段迁移 009 + 列表 DTO 透出 is_pinned/pinned_at"
```

---

### Task 2: 仓储写方法 + Service UpdateSettings

**Files:**

- Modify: `server/internal/repository/conversation_repo.go`（追加 GetMember / UpdateMemberSettings / MutedMemberIDs）
- Modify: `server/internal/service/conversation_service.go`（追加 UpdateSettings 及输入/输出类型）
- Test: `server/internal/service/conversation_settings_test.go`（追加用例）

**Interfaces:**

- Consumes: Task 1 的 `model.ConversationMember.IsPinned/.PinnedAt`。
- Produces:
  - `(*ConversationRepository) GetMember(ctx, convID, userID uuid.UUID) (*model.ConversationMember, bool, error)`（found 标志，照 GetMemberRole 惯例）
  - `(*ConversationRepository) UpdateMemberSettings(ctx, convID, userID uuid.UUID, updates map[string]any) error`
  - `(*ConversationRepository) MutedMemberIDs(ctx, convID uuid.UUID) ([]uuid.UUID, error)`
  - `service.ConversationSettingsInput{IsPinned *bool; IsMuted *bool}`
  - `service.ConversationSettingsResult{IsPinned bool; PinnedAt *time.Time; IsMuted bool}`
  - `(*ConversationService) UpdateSettings(ctx, userID, convID uuid.UUID, in ConversationSettingsInput) (*ConversationSettingsResult, error)`——非成员返回 `ErrNotMember`。

- [ ] **Step 1: 写失败测试**（追加到 conversation_settings_test.go）

```go
// boolPtr 测试辅助。
func boolPtr(v bool) *bool { return &v }

// TestUpdateSettingsPinMuteRoundTrip 置顶/免打扰开关全流程 + pinned_at 语义。
func TestUpdateSettingsPinMuteRoundTrip(t *testing.T) {
	env := settingsTestEnv(t)
	ctx := context.Background()

	// 置顶：is_pinned=true 且 pinned_at 落时间
	res, err := env.Svc.UpdateSettings(ctx, env.A.ID, env.Conv.ID,
		ConversationSettingsInput{IsPinned: boolPtr(true)})
	if err != nil {
		t.Fatalf("pin: %v", err)
	}
	if !res.IsPinned || res.PinnedAt == nil {
		t.Fatalf("want pinned with time, got %+v", res)
	}
	firstPinnedAt := *res.PinnedAt

	// 重复置顶幂等：pinned_at 不刷新（置顶顺序稳定）
	res, err = env.Svc.UpdateSettings(ctx, env.A.ID, env.Conv.ID,
		ConversationSettingsInput{IsPinned: boolPtr(true)})
	if err != nil {
		t.Fatalf("re-pin: %v", err)
	}
	if res.PinnedAt == nil || !res.PinnedAt.Equal(firstPinnedAt) {
		t.Fatalf("re-pin should keep pinned_at, want %v got %v", firstPinnedAt, res.PinnedAt)
	}

	// 免打扰
	res, err = env.Svc.UpdateSettings(ctx, env.A.ID, env.Conv.ID,
		ConversationSettingsInput{IsMuted: boolPtr(true)})
	if err != nil || !res.IsMuted {
		t.Fatalf("mute: err=%v res=%+v", err, res)
	}
	// 未动 pin 字段：保持置顶
	if !res.IsPinned {
		t.Fatalf("mute must not clear pin, got %+v", res)
	}

	// 取消置顶：pinned_at 清空
	res, err = env.Svc.UpdateSettings(ctx, env.A.ID, env.Conv.ID,
		ConversationSettingsInput{IsPinned: boolPtr(false)})
	if err != nil {
		t.Fatalf("unpin: %v", err)
	}
	if res.IsPinned || res.PinnedAt != nil {
		t.Fatalf("want unpinned nil pinned_at, got %+v", res)
	}

	// 对方视角不受影响（member 维度隔离）
	dtos, err := env.Svc.List(ctx, env.B.ID)
	if err != nil {
		t.Fatalf("list b: %v", err)
	}
	for _, d := range dtos {
		if d.ID == env.Conv.ID && (d.IsPinned || d.IsMuted) {
			t.Fatalf("peer settings leaked: %+v", d)
		}
	}
}

// TestUpdateSettingsNonMember 非成员 → ErrNotMember（handler 层映射 403）。
func TestUpdateSettingsNonMember(t *testing.T) {
	env := settingsTestEnv(t)
	outsider := newTestUser(t, env.DB, "丙outsider")
	_, err := env.Svc.UpdateSettings(context.Background(), outsider.ID, env.Conv.ID,
		ConversationSettingsInput{IsMuted: boolPtr(true)})
	if !errors.Is(err, ErrNotMember) {
		t.Fatalf("want ErrNotMember, got %v", err)
	}
}

// TestMutedMemberIDs 免打扰成员过滤查询（离线推送用）。
func TestMutedMemberIDs(t *testing.T) {
	env := settingsTestEnv(t)
	ctx := context.Background()
	if _, err := env.Svc.UpdateSettings(ctx, env.A.ID, env.Conv.ID,
		ConversationSettingsInput{IsMuted: boolPtr(true)}); err != nil {
		t.Fatalf("mute a: %v", err)
	}
	repo := repository.NewConversationRepository(env.DB)
	ids, err := repo.MutedMemberIDs(ctx, env.Conv.ID)
	if err != nil {
		t.Fatalf("muted ids: %v", err)
	}
	if len(ids) != 1 || ids[0] != env.A.ID {
		t.Fatalf("want [A], got %v", ids)
	}
}
```

test 文件需补 import：`"errors"`。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/liaojie1314/code/project/yuanchat/server
go test ./internal/service/ -run 'TestUpdateSettings|TestMutedMemberIDs' -v
```

预期：编译失败（`ConversationSettingsInput` 未定义）。

- [ ] **Step 3: 实现仓储三方法**（conversation_repo.go 末尾追加）

```go
// GetMember 返回成员行；非成员返回 (nil, false, nil)。
func (r *ConversationRepository) GetMember(ctx context.Context, convID, userID uuid.UUID) (*model.ConversationMember, bool, error) {
	var m model.ConversationMember
	err := r.db.WithContext(ctx).
		Where("conversation_id = ? AND user_id = ?", convID, userID).First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return &m, true, nil
}

// UpdateMemberSettings 更新成员行的个人设置字段（is_pinned/pinned_at/is_muted）。
func (r *ConversationRepository) UpdateMemberSettings(ctx context.Context, convID, userID uuid.UUID, updates map[string]any) error {
	return r.db.WithContext(ctx).
		Model(&model.ConversationMember{}).
		Where("conversation_id = ? AND user_id = ?", convID, userID).
		Updates(updates).Error
}

// MutedMemberIDs 返回会话中开启免打扰的成员 ID（离线推送过滤用）。
func (r *ConversationRepository) MutedMemberIDs(ctx context.Context, convID uuid.UUID) ([]uuid.UUID, error) {
	var ids []uuid.UUID
	err := r.db.WithContext(ctx).
		Model(&model.ConversationMember{}).
		Where("conversation_id = ? AND is_muted = TRUE", convID).
		Pluck("user_id", &ids).Error
	return ids, err
}
```

- [ ] **Step 4: 实现 Service UpdateSettings**（conversation_service.go 末尾追加；文件需 import `"time"`——已有则跳过）

```go
// ConversationSettingsInput 会话个人设置变更（nil 字段表示不修改）。
type ConversationSettingsInput struct {
	IsPinned *bool
	IsMuted  *bool
}

// ConversationSettingsResult 变更后的最新设置值（含未变更字段的当前值）。
type ConversationSettingsResult struct {
	IsPinned bool
	PinnedAt *time.Time
	IsMuted  bool
}

// UpdateSettings 更新本人在会话中的置顶/免打扰设置（member 维度）。
//
// 置顶语义：false→true 时落 pinned_at=now；重复置顶不刷新（置顶顺序稳定）；
// 取消置顶清空 pinned_at。非成员返回 ErrNotMember（handler 映射 403）。
func (s *ConversationService) UpdateSettings(
	ctx context.Context, userID, convID uuid.UUID, in ConversationSettingsInput,
) (*ConversationSettingsResult, error) {
	member, found, err := s.convRepo.GetMember(ctx, convID, userID)
	if err != nil {
		return nil, fmt.Errorf("load member: %w", err)
	}
	if !found {
		return nil, ErrNotMember
	}

	res := &ConversationSettingsResult{
		IsPinned: member.IsPinned, PinnedAt: member.PinnedAt, IsMuted: member.IsMuted,
	}
	updates := map[string]any{}
	if in.IsPinned != nil && *in.IsPinned != member.IsPinned {
		updates["is_pinned"] = *in.IsPinned
		if *in.IsPinned {
			now := time.Now()
			updates["pinned_at"] = now
			res.PinnedAt = &now
		} else {
			updates["pinned_at"] = nil
			res.PinnedAt = nil
		}
		res.IsPinned = *in.IsPinned
	}
	if in.IsMuted != nil && *in.IsMuted != member.IsMuted {
		updates["is_muted"] = *in.IsMuted
		res.IsMuted = *in.IsMuted
	}
	if len(updates) == 0 {
		return res, nil // 幂等：无实际变化不写库
	}
	if err := s.convRepo.UpdateMemberSettings(ctx, convID, userID, updates); err != nil {
		return nil, fmt.Errorf("update settings: %w", err)
	}
	return res, nil
}
```

- [ ] **Step 5: 跑测试确认通过 + 回归 + commit**

```bash
go test ./internal/service/ -run 'TestUpdateSettings|TestMutedMemberIDs|TestListSurfacesPinnedFields' -v
go vet ./... && go test -short ./...
git add internal/repository/conversation_repo.go internal/service/conversation_service.go internal/service/conversation_settings_test.go
git commit -m "feat(server): 会话置顶/免打扰设置服务层（member 维度 + pinned_at 稳定语义）"
```

---

### Task 3: REST 端点 + WS 帧扩展 + API 文档

**Files:**

- Modify: `server/internal/ws/protocol.go`（ConversationUpdatedPayload 78-82 行；import 加 `"time"`）
- Modify: `server/internal/handler/conversation.go`（追加 UpdateSettings；如未 import `ws` 则加）
- Modify: `server/internal/router/router.go`（163-174 行路由组加一行）
- Modify: `docs/02_CHAT_API.md`
- Test: `server/internal/ws/protocol_test.go`（追加用例）

**Interfaces:**

- Consumes: Task 2 的 `svc.UpdateSettings` / `ConversationSettingsInput` / `ConversationSettingsResult`；现有 `h.pushUpdated(memberIDs, payload)`（conversation_manage.go:53）、`h.groupErr`（ErrNotMember→403）。
- Produces: `PUT /api/v1/conversations/:id/settings`，body `{"is_pinned"?: bool, "is_muted"?: bool}`（至少一个），响应 data `{is_pinned, pinned_at, is_muted}`；`conversation.updated` 帧新增可选字段 `is_pinned`/`pinned_at`/`is_muted`（仅推本人全部设备）。

- [ ] **Step 1: 写失败测试**（protocol_test.go 追加——断言新字段序列化与 omitempty）

```go
// TestConversationUpdatedPayloadSettings 设置字段存在时序列化、缺省时省略。
func TestConversationUpdatedPayloadSettings(t *testing.T) {
	pinned := true
	now := time.Now()
	data, err := Encode(TypeConversationUpdated, ConversationUpdatedPayload{
		ConversationID: uuid.New(), IsPinned: &pinned, PinnedAt: &now,
	})
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	s := string(data)
	if !strings.Contains(s, `"is_pinned":true`) || !strings.Contains(s, `"pinned_at"`) {
		t.Fatalf("want settings fields, got %s", s)
	}
	if strings.Contains(s, `"is_muted"`) || strings.Contains(s, `"name"`) {
		t.Fatalf("nil/empty fields must be omitted, got %s", s)
	}
}
```

（文件已有 import 按需补 `"strings"` / `"time"`。）

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/liaojie1314/code/project/yuanchat/server && go test ./internal/ws/ -run TestConversationUpdatedPayloadSettings -v
```

预期：编译失败（Payload 无 IsPinned 字段）。

- [ ] **Step 3: 扩展 WS payload**（protocol.go；import 块加 `"time"`）

```go
// ConversationUpdatedPayload 群资料/成员数变更推送（改名/邀请/踢人/退群后刷新列表态）。
// 置顶/免打扰设置变更复用本帧（is_pinned/pinned_at/is_muted 指针字段，仅推本人全部设备）。
type ConversationUpdatedPayload struct {
	ConversationID uuid.UUID  `json:"conversation_id"`
	Name           string     `json:"name,omitempty"`
	MemberCount    int64      `json:"member_count,omitempty"`
	IsPinned       *bool      `json:"is_pinned,omitempty"`
	PinnedAt       *time.Time `json:"pinned_at,omitempty"`
	IsMuted        *bool      `json:"is_muted,omitempty"`
}
```

- [ ] **Step 4: Handler + 路由**

`server/internal/handler/conversation.go` 末尾追加（该文件若未 import `github.com/yuanchat/server/internal/ws` 则添加）：

```go
// ConversationSettingsBody 会话个人设置请求体（至少携带一个字段）。
type ConversationSettingsBody struct {
	IsPinned *bool `json:"is_pinned"`
	IsMuted  *bool `json:"is_muted"`
}

// UpdateSettings 更新本人会话设置（PUT /conversations/:id/settings，member 维度）。
//
// 多端同步：变更成功后向本人全部设备推 conversation.updated
//（仅推本人，照 Leave 的 pushRemoved 模式；其他成员不感知）。
func (h *ConversationHandler) UpdateSettings(c *gin.Context) {
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
	var body ConversationSettingsBody
	if err := c.ShouldBindJSON(&body); err != nil {
		BadRequest(c, err.Error())
		return
	}
	if body.IsPinned == nil && body.IsMuted == nil {
		BadRequest(c, "at least one of is_pinned / is_muted required")
		return
	}

	res, err := h.svc.UpdateSettings(c.Request.Context(), userID, convID,
		service.ConversationSettingsInput{IsPinned: body.IsPinned, IsMuted: body.IsMuted})
	if err != nil {
		h.groupErr(c, err)
		return
	}

	h.pushUpdated([]uuid.UUID{userID}, ws.ConversationUpdatedPayload{
		ConversationID: convID,
		IsPinned:       &res.IsPinned,
		PinnedAt:       res.PinnedAt,
		IsMuted:        &res.IsMuted,
	})
	Success(c, gin.H{"is_pinned": res.IsPinned, "pinned_at": res.PinnedAt, "is_muted": res.IsMuted})
}
```

`server/internal/router/router.go` 的 chat 组（`chat.PATCH("/conversations/:id", convH.Rename)` 行后）加：

```go
	chat.PUT("/conversations/:id/settings", convH.UpdateSettings)
```

- [ ] **Step 5: 跑测试 + 编译确认**

```bash
go test ./internal/ws/ -run TestConversationUpdatedPayloadSettings -v
go build ./... && go vet ./...
```

预期：全 PASS。多端扇出已由 `TestHubMultiDeviceDelivery`（hub_test.go:36）覆盖，无需新测。

- [ ] **Step 6: 更新 docs/02_CHAT_API.md**

三处：

1. `GET /api/v1/conversations` 响应样例（54 行 `"is_muted": false,` 后）加 `"is_pinned": false,`、`"pinned_at": null,`，并在字段说明列表补一行：`- is_pinned / pinned_at（v0.4 A6）：本人置顶态；列表排序置顶优先、组内按 pinned_at 倒序（前端实现）。`
2. 群管理五操作表格之后新增小节：

```markdown
### PUT /api/v1/conversations/:id/settings

更新本人在该会话的个人设置（member 维度，单聊/群聊通用）。body 至少携带一个字段：

\`\`\`json
// 请求
{ "is_pinned": true, "is_muted": false }

// 响应（data 为变更后的完整设置值）
{ "code": 0, "message": "ok", "data": { "is_pinned": true, "pinned_at": "2026-07-31T12:00:00+08:00", "is_muted": false } }
\`\`\`

- 置顶语义：首次置顶落 `pinned_at`；重复置顶不刷新（置顶顺序稳定）；取消置顶清空。
- 非成员 `403`；两字段均缺 `400`。
- 成功后向**本人全部设备**推 `conversation.updated`（含 `is_pinned/pinned_at/is_muted`），其他成员不感知。
- 免打扰生效面：在线设备前端不弹系统通知；服务端离线 Web Push 同样跳过（见 WS 帧表说明）。
  \`\`\`
```

（写入时去掉外层代码块转义。）3. WS 帧表 `conversation.updated` 行（574 行）payload 更新为 `{conversation_id, name?, member_count?, is_pinned?, pinned_at?, is_muted?}`，说明补「置顶/免打扰变更仅推本人多端」。

- [ ] **Step 7: Commit**

```bash
git add internal/ws/protocol.go internal/ws/protocol_test.go internal/handler/conversation.go internal/router/router.go ../docs/02_CHAT_API.md
git commit -m "feat(server): PUT /conversations/:id/settings 端点 + conversation.updated 帧多端同步"
```

---

### Task 4: 离线 Web Push 过滤免打扰会话

**Files:**

- Modify: `server/internal/router/router.go`（SetOfflinePush 闭包 84-102 行）

**Interfaces:**

- Consumes: Task 2 的 `convRepo.MutedMemberIDs(ctx, convID)`（router.go:41 已有 convRepo 变量）；`ws.OfflineMsgInfo.ConversationID`。
- Produces: 行为变更——muted 成员不再收离线 Web Push（测试已在 Task 2 的 TestMutedMemberIDs 覆盖查询正确性；闭包内为纯集合减法）。

- [ ] **Step 1: 修改 SetOfflinePush 闭包**

router.go 84-102 行整段替换为：

```go
	wsH.SetOfflinePush(func(recipients []uuid.UUID, info ws.OfflineMsgInfo) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		// 免打扰成员不推离线通知；查询失败时放行全部（宁多推不漏推）
		if muted, err := convRepo.MutedMemberIDs(ctx, info.ConversationID); err != nil {
			logger.Warn("muted filter failed, push to all", zap.Error(err))
		} else if len(muted) > 0 {
			mutedSet := make(map[uuid.UUID]struct{}, len(muted))
			for _, id := range muted {
				mutedSet[id] = struct{}{}
			}
			filtered := make([]uuid.UUID, 0, len(recipients))
			for _, id := range recipients {
				if _, m := mutedSet[id]; !m {
					filtered = append(filtered, id)
				}
			}
			recipients = filtered
		}
		if len(recipients) == 0 {
			return
		}
		body := info.Text
		switch info.ContentType {
		case "image":
			body = "[图片]"
		case "file":
			body = "[文件]"
		case "voice":
			body = "[语音]"
		}
		pushSvc.NotifyUsers(ctx, recipients, service.PushPayload{
			Title:          info.SenderNickname,
			Body:           body,
			ConversationID: info.ConversationID.String(),
			MessageID:      info.MessageID.String(),
		})
	})
```

- [ ] **Step 2: 编译 + 回归 + commit**

```bash
cd /home/liaojie1314/code/project/yuanchat/server
go build ./... && go vet ./... && go test -short ./...
git add internal/router/router.go
git commit -m "feat(server): 离线 Web Push 跳过免打扰会话成员"
```

---

### Task 5: 前端 DTO/映射 + settings API + 帧 patch 纯函数

**Files:**

- Modify: `packages/shared/src/store/conversationStore.ts`（Conversation 类型 `isPinned?: boolean` 行后）
- Modify: `packages/shared/src/api/chat.ts`（ConversationDTO 29-44 行、mapConversation 128-150 行、末尾追加两个函数）
- Modify: `packages/shared/src/ws/chatSocket.ts`（ServerFrames 87 行）
- Test: `packages/shared/src/__tests__/chatApi.test.ts`（追加用例）

**Interfaces:**

- Consumes: Task 3 的接口契约（`is_pinned`/`pinned_at`/`is_muted` JSON 字段名、PUT 路径）。
- Produces:
  - `Conversation.pinnedAt?: string`
  - `ConversationDTO.is_pinned?: boolean` / `.pinned_at?: string | null`
  - `updateConversationSettings(convId: string, body: {is_pinned?: boolean; is_muted?: boolean}): Promise<ConversationSettingsDTO>`，`ConversationSettingsDTO = {is_pinned: boolean; pinned_at?: string | null; is_muted: boolean}`
  - `conversationUpdatePatch(p: {conversation_id: string; name?: string; member_count?: number; is_pinned?: boolean; pinned_at?: string | null; is_muted?: boolean}): Partial<Conversation>`
  - `ServerFrames["conversation.updated"]` 加同名可选字段

- [ ] **Step 1: 写失败测试**（chatApi.test.ts 追加；沿用该文件现有 base DTO 构造惯例）

```ts
describe("mapConversation pinned fields", () => {
  const base: ConversationDTO = {
    id: "c1",
    type: 1,
    name: "张三",
    member_count: 2,
    unread_count: 0,
    is_muted: false,
    last_seq: 0,
    my_last_read_seq: 0,
    updated_at: "2026-07-31T10:00:00+08:00",
  };

  it("maps is_pinned and pinned_at", () => {
    const conv = mapConversation({
      ...base,
      is_pinned: true,
      pinned_at: "2026-07-31T09:00:00+08:00",
    });
    expect(conv.isPinned).toBe(true);
    expect(conv.pinnedAt).toBe("2026-07-31T09:00:00+08:00");
  });

  it("defaults to unpinned when fields absent", () => {
    const conv = mapConversation(base);
    expect(conv.isPinned).toBe(false);
    expect(conv.pinnedAt).toBeUndefined();
  });
});

describe("conversationUpdatePatch", () => {
  it("patches settings fields when present", () => {
    expect(
      conversationUpdatePatch({
        conversation_id: "c1",
        is_pinned: true,
        pinned_at: "2026-07-31T09:00:00+08:00",
        is_muted: true,
      }),
    ).toEqual({
      isPinned: true,
      pinnedAt: "2026-07-31T09:00:00+08:00",
      isMuted: true,
    });
  });

  it("clears pinnedAt on unpin and skips absent fields", () => {
    expect(conversationUpdatePatch({ conversation_id: "c1", is_pinned: false })).toEqual({
      isPinned: false,
      pinnedAt: undefined,
    });
    // 群改名帧不携带设置字段：不误触 isPinned/isMuted
    expect(conversationUpdatePatch({ conversation_id: "c1", name: "新群名" })).toEqual({
      name: "新群名",
    });
  });
});
```

测试文件顶部 import 补 `conversationUpdatePatch`（自 `../api/chat`）。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/liaojie1314/code/project/yuanchat/packages/shared && pnpm vitest run src/__tests__/chatApi.test.ts
```

预期：FAIL（conversationUpdatePatch 未导出、isPinned 映射缺失）。

- [ ] **Step 3: 实现**

`conversationStore.ts` — Conversation 的 `isPinned?: boolean;` 行后加：

```ts
  /** 置顶时间（ISO 字符串，服务端 pinned_at；置顶组内按此倒序） */
  pinnedAt?: string;
```

`api/chat.ts` — ConversationDTO 的 `is_muted: boolean;` 行后加：

```ts
  is_pinned?: boolean;
  pinned_at?: string | null;
```

mapConversation 返回对象 `isMuted: dto.is_muted,` 行后加：

```ts
    isPinned: dto.is_pinned ?? false,
    pinnedAt: dto.pinned_at ?? undefined,
```

`api/chat.ts` 末尾追加：

```ts
/** 会话个人设置（置顶/免打扰）响应 */
export interface ConversationSettingsDTO {
  is_pinned: boolean;
  pinned_at?: string | null;
  is_muted: boolean;
}

/** 更新本人会话设置（置顶/免打扰，member 维度） */
export async function updateConversationSettings(
  convId: string,
  body: { is_pinned?: boolean; is_muted?: boolean },
): Promise<ConversationSettingsDTO> {
  return apiPut<ConversationSettingsDTO>("/api/v1/conversations/" + convId + "/settings", body);
}

/** conversation.updated 帧 → store patch（纯函数，供 wireSocket 与单测复用） */
export function conversationUpdatePatch(p: {
  conversation_id: string;
  name?: string;
  member_count?: number;
  is_pinned?: boolean;
  pinned_at?: string | null;
  is_muted?: boolean;
}): Partial<Conversation> {
  const patch: Partial<Conversation> = {};
  if (p.name) patch.name = p.name;
  if (p.member_count) patch.memberCount = p.member_count;
  if (p.is_pinned !== undefined) {
    patch.isPinned = p.is_pinned;
    patch.pinnedAt = p.pinned_at ?? undefined;
  }
  if (p.is_muted !== undefined) patch.isMuted = p.is_muted;
  return patch;
}
```

（chat.ts 顶部 import 需含 `apiPut`——现有 import 自 `./client`，按需补；`Conversation` 类型已 import。）

`ws/chatSocket.ts` — ServerFrames 的 `"conversation.updated"` 行改为：

```ts
  "conversation.updated": {
    conversation_id: string;
    name?: string;
    member_count?: number;
    is_pinned?: boolean;
    pinned_at?: string | null;
    is_muted?: boolean;
  };
```

- [ ] **Step 4: 跑测试确认通过 + commit**

```bash
pnpm vitest run src/__tests__/chatApi.test.ts
git add src/store/conversationStore.ts src/api/chat.ts src/ws/chatSocket.ts src/__tests__/chatApi.test.ts
git commit -m "feat(shared): 会话设置 API + DTO 置顶字段映射 + 帧 patch 纯函数"
```

---

### Task 6: applyConversationSetting 乐观更新助手 + i18n 错误文案

**Files:**

- Create: `packages/shared/src/conversationSettings.ts`
- Modify: `packages/shared/src/index.ts`（export）
- Modify: `packages/design-system/src/i18n/locales/{zh-CN,en-US,ja-JP,ko-KR}.json`（`detail.settingsFailed`）
- Test: `packages/shared/src/__tests__/conversationSettings.test.ts`（新建）

**Interfaces:**

- Consumes: Task 5 的 `updateConversationSettings`；现有 `useConversationStore.getState().updateConversation(id, partial)`、`showToast(kind, text)`（toastStore.ts:24）、`isMockEnabled()`（useChatBootstrap.ts:50）、`i18n`（`@yuanchat/design-system/i18n`，useChatBootstrap.ts:15 同款 import）。
- Produces: `applyConversationSetting(convId: string, partial: {isPinned?: boolean; isMuted?: boolean}): Promise<void>` —— 乐观更新本地 store（置顶时本地临时 pinnedAt=now ISO，帧到达后校正）；mock 模式跳过 API；失败回滚 + error toast。

- [ ] **Step 1: 写失败测试**

新建 `packages/shared/src/__tests__/conversationSettings.test.ts`：

```ts
/**
 * applyConversationSetting 单测：乐观更新 / 失败回滚 / mock 跳过
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyConversationSetting } from "../conversationSettings";
import { useConversationStore } from "../store/conversationStore";
import { useToastStore } from "../store/toastStore";

vi.mock("../api/chat", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../api/chat")>();
  return { ...mod, updateConversationSettings: vi.fn() };
});
vi.mock("../hooks/useChatBootstrap", () => ({ isMockEnabled: vi.fn(() => false) }));

import { updateConversationSettings } from "../api/chat";
import { isMockEnabled } from "../hooks/useChatBootstrap";

const CONV = {
  id: "c1",
  type: "private" as const,
  name: "张三",
  unreadCount: 0,
  isMuted: false,
  isPinned: false,
};

beforeEach(() => {
  vi.mocked(updateConversationSettings).mockReset();
  vi.mocked(isMockEnabled).mockReturnValue(false);
  useConversationStore.setState({ conversations: [{ ...CONV }], activeId: null });
  useToastStore.setState({ toasts: [] });
});

describe("applyConversationSetting", () => {
  it("optimistically pins with local pinnedAt and calls API", async () => {
    vi.mocked(updateConversationSettings).mockResolvedValue({
      is_pinned: true,
      pinned_at: "2026-07-31T09:00:00+08:00",
      is_muted: false,
    });
    const p = applyConversationSetting("c1", { isPinned: true });
    // 乐观：await 前已生效
    const conv = useConversationStore.getState().conversations[0];
    expect(conv.isPinned).toBe(true);
    expect(conv.pinnedAt).toBeTruthy();
    await p;
    expect(updateConversationSettings).toHaveBeenCalledWith("c1", { is_pinned: true });
  });

  it("reverts and toasts on API failure", async () => {
    vi.mocked(updateConversationSettings).mockRejectedValue(new Error("boom"));
    await applyConversationSetting("c1", { isMuted: true });
    const conv = useConversationStore.getState().conversations[0];
    expect(conv.isMuted).toBe(false); // 已回滚
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].kind).toBe("error");
  });

  it("skips API entirely in mock mode", async () => {
    vi.mocked(isMockEnabled).mockReturnValue(true);
    await applyConversationSetting("c1", { isPinned: true });
    expect(useConversationStore.getState().conversations[0].isPinned).toBe(true);
    expect(updateConversationSettings).not.toHaveBeenCalled();
  });

  it("no-ops on unknown conversation", async () => {
    await applyConversationSetting("nope", { isPinned: true });
    expect(updateConversationSettings).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/liaojie1314/code/project/yuanchat/packages/shared && pnpm vitest run src/__tests__/conversationSettings.test.ts
```

预期：FAIL（模块不存在）。

- [ ] **Step 3: 实现 helper**

新建 `packages/shared/src/conversationSettings.ts`：

```ts
/**
 * 会话个人设置（置顶/免打扰）变更协调器
 *
 * 策略：乐观更新本地 store → 调 REST；失败回滚 + error toast。
 * 与群管理「帧驱动」不同：设置开关要求即时反馈，服务端
 * conversation.updated 帧（推本人多端）到达时以服务端值校正
 *（本端幂等覆盖，其他端首次生效）。mock 模式只改本地。
 */
import i18n from "@yuanchat/design-system/i18n";
import { updateConversationSettings } from "./api/chat";
import { isMockEnabled } from "./hooks/useChatBootstrap";
import type { Conversation } from "./store/conversationStore";
import { useConversationStore } from "./store/conversationStore";
import { showToast } from "./store/toastStore";

/** 更新本人会话置顶/免打扰（乐观 + 失败回滚） */
export async function applyConversationSetting(
  convId: string,
  partial: { isPinned?: boolean; isMuted?: boolean },
): Promise<void> {
  const store = useConversationStore.getState();
  const conv = store.conversations.find((c) => c.id === convId);
  if (!conv) return;

  const prev: Partial<Conversation> = {
    isPinned: conv.isPinned,
    pinnedAt: conv.pinnedAt,
    isMuted: conv.isMuted,
  };
  const optimistic: Partial<Conversation> = { ...partial };
  if (partial.isPinned !== undefined) {
    // 本地临时 pinned_at；服务端帧到达后校正为权威值
    optimistic.pinnedAt = partial.isPinned ? new Date().toISOString() : undefined;
  }
  store.updateConversation(convId, optimistic);

  if (isMockEnabled()) return;
  try {
    await updateConversationSettings(convId, {
      is_pinned: partial.isPinned,
      is_muted: partial.isMuted,
    });
  } catch {
    useConversationStore.getState().updateConversation(convId, prev);
    showToast("error", i18n.t("detail.settingsFailed"));
  }
}
```

`packages/shared/src/index.ts` 加一行（notify export 附近）：

```ts
export { applyConversationSetting } from "./conversationSettings";
```

- [ ] **Step 4: 四语言加 `detail.settingsFailed`**

在四个 locale 文件的 `"detail.mute"` 行前后（detail.\* 区块内，四文件同位置）各加：

- `zh-CN.json`: `"detail.settingsFailed": "设置失败，请重试",`
- `en-US.json`: `"detail.settingsFailed": "Failed to update settings, please retry",`
- `ja-JP.json`: `"detail.settingsFailed": "設定に失敗しました。再試行してください",`
- `ko-KR.json`: `"detail.settingsFailed": "설정에 실패했습니다. 다시 시도해 주세요",`

- [ ] **Step 5: 跑测试 + i18n 校验 + commit**

```bash
pnpm vitest run src/__tests__/conversationSettings.test.ts
node /home/liaojie1314/code/project/yuanchat/scripts/check-i18n.mjs
git add src/conversationSettings.ts src/index.ts src/__tests__/conversationSettings.test.ts ../design-system/src/i18n/locales/
git commit -m "feat(shared): applyConversationSetting 乐观更新助手 + 失败回滚 toast"
```

---

### Task 7: wireSocket 帧处理接入 patch 函数

**Files:**

- Modify: `packages/shared/src/hooks/useChatBootstrap.ts`（conversation.updated handler，295-300 行）

**Interfaces:**

- Consumes: Task 5 的 `conversationUpdatePatch`（`./api/chat`）。
- Produces: 行为——`conversation.updated` 帧携带 `is_pinned/pinned_at/is_muted` 时 patch 进 store（多端同步落地；纯函数已在 Task 5 测过，此处仅接线）。

- [ ] **Step 1: 替换 handler**

useChatBootstrap.ts 的 `"conversation.updated"` handler（295-300 行）整体替换为：

```ts
    "conversation.updated": (p) => {
      useConversationStore.getState().updateConversation(p.conversation_id, conversationUpdatePatch(p));
    },
```

文件顶部自 `../api/chat` 的 import 中补 `conversationUpdatePatch`。

- [ ] **Step 2: 回归 shared 全部测试 + commit**

```bash
cd /home/liaojie1314/code/project/yuanchat/packages/shared && pnpm vitest run
git add src/hooks/useChatBootstrap.ts
git commit -m "feat(shared): conversation.updated 帧同步置顶/免打扰到本地 store"
```

---

### Task 8: ChatDetail 开关接后端

**Files:**

- Modify: `packages/ui/src/ChatDetail.tsx`（设置行 246-258 行；imports）
- Test: `packages/ui/src/__tests__/ChatDetail.test.tsx`（改两个现有 toggle 用例）

**Interfaces:**

- Consumes: Task 6 的 `applyConversationSetting`（`@yuanchat/shared` barrel）。

- [ ] **Step 1: 改测试为断言 helper 调用**（先改测试——现有两个用例断言纯本地 store，行为将变）

ChatDetail.test.tsx 顶部 vi.mock（13-20 行）的返回对象加一行 `applyConversationSetting: vi.fn(),`；文件 import 区补 `import { applyConversationSetting } from "@yuanchat/shared";`。将现有 mute/pin 两个用例替换为：

```tsx
it("delegates mute toggle to applyConversationSetting", () => {
  render(<ChatDetail />);
  fireEvent.click(screen.getByText("Mute notifications"));
  expect(applyConversationSetting).toHaveBeenCalledWith("1", { isMuted: true });
});

it("delegates pin toggle to applyConversationSetting", () => {
  render(<ChatDetail />);
  fireEvent.click(screen.getByText("Pin conversation"));
  expect(applyConversationSetting).toHaveBeenCalledWith("1", { isPinned: true });
});
```

（沿用该文件 beforeEach 里 store 会话 id 为 "1"、初始 isMuted:false/isPinned 未置的现状；若 beforeEach 数据不同按实际 id/初值调整期望参数。测试间用 `vi.mocked(applyConversationSetting).mockClear()`——加进现有 beforeEach。）

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/liaojie1314/code/project/yuanchat/packages/ui && pnpm vitest run src/__tests__/ChatDetail.test.tsx
```

预期：FAIL（组件仍直改 store，helper 未被调用）。

- [ ] **Step 3: 改组件**

ChatDetail.tsx：import 区自 `@yuanchat/shared` 的解构中加 `applyConversationSetting`；设置行两个 `onToggle` 改为：

```tsx
          <SettingRow
            label={t("detail.mute")}
            checked={conv.isMuted}
            onToggle={() => void applyConversationSetting(conv.id, { isMuted: !conv.isMuted })}
          />
          <SettingRow
            label={t("detail.pinConversation")}
            checked={!!conv.isPinned}
            onToggle={() => void applyConversationSetting(conv.id, { isPinned: !conv.isPinned })}
          />
```

若 `updateConversation` 在本组件因此不再被引用，同步从 store 解构处移除（保持无未用变量）。

- [ ] **Step 4: 跑测试 + commit**

```bash
pnpm vitest run src/__tests__/ChatDetail.test.tsx && pnpm vitest run
git add src/ChatDetail.tsx src/__tests__/ChatDetail.test.tsx
git commit -m "feat(ui): 会话详情置顶/免打扰开关接后端设置端点"
```

---

### Task 9: ConversationList 置顶排序 + 右键/长按菜单

**Files:**

- Modify: `packages/ui/src/ConversationList.tsx`（useMemo 79-90 行、ConversationItem 289-374 行、imports 22-23 行）
- Modify: `packages/design-system/src/i18n/locales/{zh-CN,en-US,ja-JP,ko-KR}.json`（4 个 menu key）
- Modify: `packages/shared/src/mocks/demoData.ts`（置顶会话补 pinnedAt）
- Test: `packages/ui/src/__tests__/ConversationList.test.tsx`（追加用例）

**Interfaces:**

- Consumes: Task 6 `applyConversationSetting`；Task 5 `Conversation.pinnedAt`；本文件现有 `MenuItem`（244-263 行）。
- Produces: 置顶组按 pinnedAt 倒序；每个会话项支持右键（onContextMenu）与长按（500ms touch）呼出菜单：置顶/取消置顶、免打扰/取消免打扰。

- [ ] **Step 1: 写失败测试**（ConversationList.test.tsx 追加）

文件顶部加 partial mock（保持 store 真实）与 import：

```tsx
vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return { ...mod, applyConversationSetting: vi.fn() };
});
import { applyConversationSetting } from "@yuanchat/shared";
```

追加用例（beforeEach 的三条会话数据基础上）：

```tsx
describe("pinned ordering and context menu", () => {
  beforeEach(() => {
    vi.mocked(applyConversationSetting).mockClear();
    useConversationStore.setState({
      activeId: null,
      conversations: [
        // store 顺序故意与 pinnedAt 倒序相反，验证排序生效
        {
          id: "p1",
          type: "private",
          name: "旧置顶",
          unreadCount: 0,
          isMuted: false,
          isPinned: true,
          pinnedAt: "2026-07-30T10:00:00+08:00",
        },
        {
          id: "p2",
          type: "private",
          name: "新置顶",
          unreadCount: 0,
          isMuted: false,
          isPinned: true,
          pinnedAt: "2026-07-31T10:00:00+08:00",
        },
        { id: "r1", type: "private", name: "普通会话", unreadCount: 0, isMuted: false },
      ],
    });
  });

  it("sorts pinned section by pinnedAt desc", () => {
    render(
      <MemoryRouter>
        <ConversationList />
      </MemoryRouter>,
    );
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    const iNew = names.findIndex((s) => s?.includes("新置顶"));
    const iOld = names.findIndex((s) => s?.includes("旧置顶"));
    expect(iNew).toBeGreaterThan(-1);
    expect(iNew).toBeLessThan(iOld);
  });

  it("opens context menu on right click and toggles pin", () => {
    render(
      <MemoryRouter>
        <ConversationList />
      </MemoryRouter>,
    );
    fireEvent.contextMenu(screen.getByText("普通会话"));
    fireEvent.click(screen.getByRole("menuitem", { name: /pin/i }));
    expect(applyConversationSetting).toHaveBeenCalledWith("r1", { isPinned: true });
  });

  it("shows unpin and unmute labels for pinned/muted conversations", () => {
    useConversationStore.setState((s) => ({
      conversations: s.conversations.map((c) => (c.id === "p2" ? { ...c, isMuted: true } : c)),
    }));
    render(
      <MemoryRouter>
        <ConversationList />
      </MemoryRouter>,
    );
    fireEvent.contextMenu(screen.getByText("新置顶"));
    expect(screen.getByRole("menuitem", { name: /unpin/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /unmute/i }));
    expect(applyConversationSetting).toHaveBeenCalledWith("p2", { isMuted: false });
  });
});
```

（jsdom locale=en-US，menuitem 名称按英文 label 断言。）

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /home/liaojie1314/code/project/yuanchat/packages/ui && pnpm vitest run src/__tests__/ConversationList.test.tsx
```

预期：新用例 FAIL（无排序、无 menu）。

- [ ] **Step 3: 四语言加 menu key**

四个 locale 的 `chat.menu.addContact` 行后各加（保持四文件行对齐）：

- zh-CN: `"chat.menu.pin": "置顶",` `"chat.menu.unpin": "取消置顶",` `"chat.menu.mute": "免打扰",` `"chat.menu.unmute": "取消免打扰",`
- en-US: `"chat.menu.pin": "Pin",` `"chat.menu.unpin": "Unpin",` `"chat.menu.mute": "Mute",` `"chat.menu.unmute": "Unmute",`
- ja-JP: `"chat.menu.pin": "ピン留め",` `"chat.menu.unpin": "ピン留め解除",` `"chat.menu.mute": "ミュート",` `"chat.menu.unmute": "ミュート解除",`
- ko-KR: `"chat.menu.pin": "고정",` `"chat.menu.unpin": "고정 해제",` `"chat.menu.mute": "알림 끄기",` `"chat.menu.unmute": "알림 켜기",`

- [ ] **Step 4: 实现排序**

ConversationList.tsx 的 useMemo（87-88 行）改为：

```tsx
return {
  pinned: visible
    .filter((c) => c.isPinned)
    // 置顶组内按 pinned_at 倒序（ISO 字符串字典序即时间序）；rest 保持 store 序（最新消息在前）
    .sort((a, b) => (b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? "")),
  rest: visible.filter((c) => !c.isPinned),
};
```

- [ ] **Step 5: 实现右键/长按菜单**

imports 更新：

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus, Bell, BellOff, Pin, PinOff, Users, UserPlus } from "lucide-react";
import { applyConversationSetting, useConversationStore } from "@yuanchat/shared";
```

ConversationItem（289-374 行）重构——根节点从 `<button>` 换为 `relative` 包裹层（菜单不能嵌在 button 内），照 MessageBubble 模式（onContextMenu + 500ms 长按 + document mousedown 关闭 + 菜单 `onMouseDown` stopPropagation）：

```tsx
function ConversationItem({
  conv,
  isActive,
  onClick,
}: {
  conv: Conversation;
  isActive: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const hasDraft = !!conv.draft;
  const [menuOpen, setMenuOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 点击菜单外任意处关闭（菜单根 onMouseDown 阻止冒泡自保）
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const openMenu = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setMenuOpen(true);
  };
  const startLongPress = (e: { preventDefault: () => void }) => {
    longPressTimer.current = setTimeout(() => openMenu(e), 500);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  return (
    <div className="relative">
      <button
        onClick={onClick}
        onContextMenu={openMenu}
        onTouchStart={startLongPress}
        onTouchEnd={cancelLongPress}
        onTouchMove={cancelLongPress}
        aria-current={isActive || undefined}
        className={cn(
          "relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
          isActive
            ? "bg-primary-container"
            : "hover:bg-surface-container-high active:bg-surface-container",
        )}
      >
        {/* ……原有内容（置顶竖条 / Avatar / 名称时间 / 预览 / 徽章三态）原样保留…… */}
      </button>
      {menuOpen && (
        <div
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
          className="bg-surface-container-high shadow-elevation-2 animate-fade-in absolute top-full right-2 z-20 -mt-1 w-36 overflow-hidden rounded-lg py-1"
        >
          <MenuItem
            icon={conv.isPinned ? <PinOff size={17} /> : <Pin size={17} />}
            label={t(conv.isPinned ? "chat.menu.unpin" : "chat.menu.pin")}
            onClick={() => {
              setMenuOpen(false);
              void applyConversationSetting(conv.id, { isPinned: !conv.isPinned });
            }}
          />
          <MenuItem
            icon={conv.isMuted ? <Bell size={17} /> : <BellOff size={17} />}
            label={t(conv.isMuted ? "chat.menu.unmute" : "chat.menu.mute")}
            onClick={() => {
              setMenuOpen(false);
              void applyConversationSetting(conv.id, { isMuted: !conv.isMuted });
            }}
          />
        </div>
      )}
    </div>
  );
}
```

（「原样保留」处为 289-374 行现 JSX 的内层内容，逐行照搬不改动；仅根元素与事件挂载变化。）

- [ ] **Step 6: demoData 补 pinnedAt**

`packages/shared/src/mocks/demoData.ts` — id "1"（isPinned:true，21 行）加 `pinnedAt: "2026-07-31T09:00:00+08:00",`；id "2"（37 行）加 `pinnedAt: "2026-07-30T09:00:00+08:00",`（保证 mock 模式排序确定：产品研发群在前）。

- [ ] **Step 7: 跑测试 + i18n 校验 + commit**

```bash
pnpm vitest run && node /home/liaojie1314/code/project/yuanchat/scripts/check-i18n.mjs
git add src/ConversationList.tsx src/__tests__/ConversationList.test.tsx ../design-system/src/i18n/locales/ ../shared/src/mocks/demoData.ts
git commit -m "feat(ui): 会话列表置顶排序 + 右键/长按设置菜单"
```

---

### Task 10: E2E + 全量本地验证

**Files:**

- Create: `apps/web/e2e/conversation-settings.spec.ts`

**Interfaces:**

- Consumes: mock 模式 demoData（产品研发群/李四已置顶且有 pinnedAt；张伟 unreadCount=1）；`applyConversationSetting` mock 短路（isMockEnabled → 纯本地）；现有 fixtures `setAuth` / `waitForMSW`。

- [ ] **Step 1: 写 E2E**（Playwright locale=zh-CN，断言中文）

```ts
/**
 * 会话置顶/免打扰 E2E（MSW mock 模式：applyConversationSetting 走纯本地分支）
 */
import { test, expect } from "./fixtures/auth.fixture";
import { waitForMSW } from "./utils/msw";

test.beforeEach(async ({ page }) => {
  await waitForMSW(page);
  await page.goto("/chat");
});

test("右键会话呼出菜单并取消置顶", async ({ page }) => {
  const item = page.getByRole("button", { name: /产品研发群/ });
  await item.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "取消置顶" })).toBeVisible();
  await page.getByRole("menuitem", { name: "取消置顶" }).click();
  // 状态翻转：再次右键显示「置顶」
  await item.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "置顶" })).toBeVisible();
});

test("免打扰后未读徽章灰显", async ({ page }) => {
  const item = page.getByRole("button", { name: /张伟/ });
  // 免打扰前徽章红色
  const badge = item.locator("span", { hasText: /^1$/ }).last();
  await expect(badge).toHaveClass(/bg-red-500/);
  await item.click({ button: "right" });
  await page.getByRole("menuitem", { name: "免打扰" }).click();
  await expect(badge).toHaveClass(/bg-outline/);
});
```

（若 `getByRole("button", {name})` 因菜单重构后按钮可访问名变化而失配，改用 `page.getByText("产品研发群").locator("xpath=ancestor::button")` 等价定位；以实际 DOM 为准微调，断言目标不变。）

- [ ] **Step 2: 跑 E2E**

```bash
cd /home/liaojie1314/code/project/yuanchat/apps/web && pnpm test:e2e -- conversation-settings.spec.ts
```

预期：PASS。

- [ ] **Step 3: 全量本地验证（门禁）**

```bash
cd /home/liaojie1314/code/project/yuanchat
pnpm test                              # 全包 vitest（turbo）
node scripts/check-i18n.mjs            # 四语言完整性
pnpm --filter @yuanchat/web build      # web 构建（含 tsc）
pnpm --filter @yuanchat/desktop exec tsc --noEmit   # desktop 类型检查（不做 tauri bundle，本次无 tag/CI）
pnpm --filter @yuanchat/admin exec tsc --noEmit 2>/dev/null || true  # admin 未改动，冒烟即可
cd server && go vet ./... && make test # 后端全量（-race + 集成，需 docker-up）
cd .. && pnpm --filter @yuanchat/web test:e2e
```

预期：全绿。任何失败回到对应任务修复后重跑。

- [ ] **Step 4: 手工验收清单**（真实后端，双浏览器实例）

```bash
# 终端 1：后端
cd server && make docker-up && go run ./cmd/server
# 终端 2：web
pnpm --filter @yuanchat/web dev   # VITE_API_BASE_URL 指向 :8085（默认）
```

1. Alice（13800000001/Test@1234）置顶「Bob」会话 → 列表移入置顶组。
2. 第二个浏览器（隐身窗）登录 Alice → 另一实例列表同步出现置顶（WS conversation.updated 多端）。
3. Alice 对 Bob 会话开免打扰 → Bob 发消息 → Alice 未读数增加、无系统通知（桌面通知守卫）；刷新页面置顶/免打扰仍在（持久化）。
4. 非成员 403：`curl -X PUT localhost:8085/api/v1/conversations/<别人的会话id>/settings -H "Authorization: Bearer <token>" -d '{"is_muted":true}'` → 403。

- [ ] **Step 5: Commit + 停止**

```bash
git add apps/web/e2e/conversation-settings.spec.ts
git commit -m "test(e2e): 会话置顶/免打扰交互用例 + 本地全量验证"
```

**到此停止。** 汇报验证结果，征询用户是否允许 squash 合并回 dev（用 superpowers:finishing-a-development-branch）。**未经当次同意不得合并。**

---

## Self-Review 记录

- **Spec 覆盖**：迁移 009 ✓(T1)；PUT settings + member 校验 403 ✓(T2/T3)；WS 多端同步 ✓(T3/T7)；列表排序 pinned_at 倒序 ✓(T9)；右键/长按菜单 ✓(T9)；设置页开关 ✓(T8);置顶角标/铃铛/灰显——**已存在**（ConversationList.tsx 313-315/360/366-368），E2E 验证灰显 ✓(T10)；免打扰不推通知——前端守卫已存在（notify.ts:19，测试已有），服务端离线 Push 过滤为本批新增 ✓(T4)；用户已确认本批修复 Push 缺口。
- **类型一致性**：`ConversationSettingsInput/Result`（T2→T3）、`conversationUpdatePatch`/`updateConversationSettings`/`ConversationSettingsDTO`（T5→T6/T7）、`applyConversationSetting`（T6→T8/T9）、`pinnedAt?: string`（T5→T9）已交叉核对一致。
- **占位符扫描**：T9 Step 5 有一处「原样保留」指令——指向明确行号区间（289-374 内层 JSX），执行者无需自行设计，不构成 TBD。
- **已知偏差声明**：ChatDetail 群管理走「帧驱动」，本设置走「乐观 + 帧校正」——差异已在 conversationSettings.ts 头注释说明（即时反馈需求）。
