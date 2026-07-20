# 界面焕新 + 群聊/撤回/图片消息 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按已批准 spec（`docs/superpowers/specs/2026-07-17-ui-polish-and-features-design.md`）落地三批次：视觉焕新（设置页/资料页/聊天细节/Emoji）、群聊与撤回、MinIO 图片消息。

**Architecture:** 后端沿用 Gin handler→service→repository 分层 + ws 包帧推送（Dispatcher）；前端沿用 zustand store + api 映射层 + chatSocket 帧处理器（useChatBootstrap 接线）。新增 WS 帧按既有扩展模式两端同步。

**Tech Stack:** Go 1.24 (gin/gorm/gorilla-ws/minio-go v7)、React 19 + zustand v5 + Tailwind、radix-ui（已装 dropdown/context-menu）、vitest。

## Global Constraints

- **单分支 `feature/ui-and-features`**：只在每批次末尾 commit（共 3 次完整提交），**禁止逐任务提交**（用户 commit 纪律覆盖本技能默认）。
- i18n：所有 UI 文案走 `t()`；locale 文件 `packages/design-system/src/i18n/locales/{zh-CN,en-US}.json` 双语同步；插值格式 `%{var}`。
- 图标只用 lucide-react；新插画放 `packages/design-system/src/icons/*.svg` 经 `?react` 导入（本计划将安装 vite-plugin-svgr）。
- es2019 兼容：不用 `?.`/`??` 之外的 ES2020+ API（`?.`/`??` 由 build 转译；`String.prototype.at`、`Array.at`、`Object.hasOwn` 禁用）。`apps/desktop/vite.config.ts build.target=es2019` 不得改。
- tailwind surface 色板只有 `surface-container` / `-low` / `-high`（**无 lowest/highest**）。
- Go 命令前置：`export PATH=/home/liaojie1314/env/go/go/bin:$PATH GOPATH=/home/liaojie1314/env/go/GOPATH`；Go 集成测试需 `docker compose -f deploy/docker-compose.yml up -d`（pg :5433）。
- 后端响应助手（handler 包已有）：`Success/Created/BadRequest/Unauthorized/NotFound/InternalError/Error(c, httpStatus, code, msg)`。
- 前端既有关键接口：`apiGet/apiPost`（client.ts）、`chatSocket.setHandlers/send`（ServerFrames 类型表）、`useChatBootstrap.wireSocket`、`formatListTime/formatMessageTime`（api/chat.ts）。
- 全部测试命令：`cd server && go vet ./... && go test ./...`；根目录 `pnpm test`；`cd apps/web && npx tsc --noEmit`；`cd apps/desktop && npx tsc --noEmit`。

---

# 批次 1：视觉焕新

### Task 1.1: 修复 PUT /users/me 不落库 + UserService.UpdateProfile

现状 bug：`server/internal/handler/user.go:136` UpdateProfile 修改了内存对象但从未持久化。

**Files:**

- Modify: `server/internal/service/user_service.go`（新增方法）
- Modify: `server/internal/handler/user.go:136-169`
- Test: `server/internal/service/user_service_profile_test.go`（新建）

**Interfaces:**

- Produces: `func (s *UserService) UpdateProfile(ctx context.Context, userID uuid.UUID, nickname, avatarURL, bio *string, gender *int16) (*model.User, error)` — 后续任务（头像上传）复用同一端点。
- 端点响应变更为 `Success(c, user)`（完整 user JSON，前端同步 authStore 用）。

- [ ] **Step 1: 写失败的集成测试**（模式照抄 `contact_service_test.go` 的 `testDB`/`newTestUser` 助手——该文件已有这两个助手，同包直接用）

```go
package service

import (
	"context"
	"testing"
)

func TestUpdateProfile_PersistsFields(t *testing.T) {
	db := testDB(t)
	user := newTestUser(t, db, "改名前")
	svc := NewUserService(repository.NewUserRepository(db), nil, nil, zap.NewNop())

	nick := "改名后"
	bio := "新签名"
	gender := int16(1)
	updated, err := svc.UpdateProfile(context.Background(), user.ID, &nick, nil, &bio, &gender)
	if err != nil {
		t.Fatalf("UpdateProfile: %v", err)
	}
	if updated.Nickname != "改名后" || updated.Bio == nil || *updated.Bio != "新签名" || updated.Gender != 1 {
		t.Fatalf("returned user not updated: %+v", updated)
	}

	// 重新查库验证持久化
	reloaded, err := svc.Profile(context.Background(), user.ID)
	if err != nil || reloaded.Nickname != "改名后" {
		t.Fatalf("not persisted: %+v err=%v", reloaded, err)
	}
}
```

（import 补 `"github.com/yuanchat/server/internal/repository"`、`"go.uber.org/zap"`；`NewUserService` 的 jwtGen/sidGen 传 nil——本方法不用它们。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/service/ -run TestUpdateProfile -v`
Expected: FAIL（`s.UpdateProfile undefined`）

- [ ] **Step 3: 实现 service 方法**（加在 `user_service.go` 的 Profile 方法之后）

```go
// UpdateProfile 更新用户资料字段（nil 表示不改），持久化后返回最新 user。
func (s *UserService) UpdateProfile(
	ctx context.Context,
	userID uuid.UUID,
	nickname, avatarURL, bio *string,
	gender *int16,
) (*model.User, error) {
	user, err := s.repo.FindByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("find user: %w", err)
	}
	if user == nil {
		return nil, ErrUserNotFound
	}

	if nickname != nil {
		user.Nickname = *nickname
	}
	if avatarURL != nil {
		user.AvatarURL = avatarURL
	}
	if bio != nil {
		user.Bio = bio
	}
	if gender != nil {
		user.Gender = *gender
	}

	if err := s.repo.Update(ctx, user); err != nil {
		return nil, fmt.Errorf("update user: %w", err)
	}
	return user, nil
}
```

（`s.repo` 字段名以文件内已有 Profile 方法为准；若为其他名照改。）

- [ ] **Step 4: 改 handler**（`user.go` UpdateProfile 函数体第 149 行起整段替换为）

```go
	user, err := h.svc.UpdateProfile(c.Request.Context(), userID, req.Nickname, req.AvatarURL, req.Bio, req.Gender)
	if err != nil {
		h.logger.Error("update profile failed", zap.Error(err))
		InternalError(c, "failed to update profile")
		return
	}

	Success(c, user)
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd server && go test ./internal/service/ -run TestUpdateProfile -v && go vet ./...`
Expected: PASS（DB 不可达则 SKIP——需 docker compose up）

### Task 1.2: 后端 GET /users/:id 公开资料 + GET /conversations/:id/members

**Files:**

- Modify: `server/internal/repository/conversation_repo.go`（新增 ListMembers）
- Modify: `server/internal/service/conversation_service.go`（新增 Members + MemberDTO）
- Modify: `server/internal/handler/user.go`（新增 GetPublicProfile）
- Modify: `server/internal/handler/conversation.go`（新增 Members handler）
- Modify: `server/internal/router/router.go`（两条路由）
- Test: `server/internal/service/conversation_members_test.go`（新建）

**Interfaces:**

- Produces（后续任务 2.x 群成员视图消费）:
  - `GET /api/v1/users/:id` → `{code,data:{id,nickname,avatar_url,short_id,bio,gender}}`（**不含 phone/email**；uuid 非法 400，不存在 404）
  - `GET /api/v1/conversations/:id/members` → `{code,data:{members:[{user_id,nickname,avatar_url,role}]}}`（非成员 403；owner 排最前，其余按昵称）
  - `repository.MemberWithUser{UserID uuid.UUID; Nickname string; AvatarURL *string; Role int16}`
  - `func (s *ConversationService) Members(ctx, userID, convID uuid.UUID) ([]repository.MemberWithUser, error)`（含 IsMember 校验，返 `ErrNotMember`）

- [ ] **Step 1: 写失败测试**

```go
package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
)

func TestConversationMembers(t *testing.T) {
	db := testDB(t)
	a := newTestUser(t, db, "甲owner")
	b := newTestUser(t, db, "乙member")
	c := newTestUser(t, db, "丙outsider")

	conv := &model.Conversation{Type: model.ConversationTypeGroup}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("create conv: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(conv) })
	members := []model.ConversationMember{
		{ConversationID: conv.ID, UserID: a.ID, Role: model.MemberRoleOwner, JoinedAt: time.Now()},
		{ConversationID: conv.ID, UserID: b.ID, Role: model.MemberRoleNormal, JoinedAt: time.Now()},
	}
	for i := range members {
		if err := db.Create(&members[i]).Error; err != nil {
			t.Fatalf("create member: %v", err)
		}
	}
	t.Cleanup(func() { db.Where("conversation_id = ?", conv.ID).Delete(&model.ConversationMember{}) })

	svc := NewConversationService(repository.NewConversationRepository(db), repository.NewMessageRepository(db), zap.NewNop())

	got, err := svc.Members(context.Background(), b.ID, conv.ID)
	if err != nil || len(got) != 2 {
		t.Fatalf("members: %v len=%d", err, len(got))
	}
	if got[0].Role != model.MemberRoleOwner {
		t.Fatalf("owner should be first, got %+v", got[0])
	}

	if _, err := svc.Members(context.Background(), c.ID, conv.ID); !errors.Is(err, ErrNotMember) {
		t.Fatalf("outsider should get ErrNotMember, got %v", err)
	}
}
```

（删除示例中的 placeholder 循环——最终代码只保留 members 切片写入。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/service/ -run TestConversationMembers -v`
Expected: FAIL（`svc.Members undefined`）

- [ ] **Step 3: repo 实现**（conversation_repo.go 末尾追加）

```go
// MemberWithUser 群成员投影：成员行 + 用户资料。
type MemberWithUser struct {
	UserID    uuid.UUID `json:"user_id"`
	Nickname  string    `json:"nickname"`
	AvatarURL *string   `json:"avatar_url"`
	Role      int16     `json:"role"`
}

// ListMembers 查会话全部成员（owner 在前，其余按昵称升序）。
func (r *ConversationRepository) ListMembers(ctx context.Context, convID uuid.UUID) ([]MemberWithUser, error) {
	var items []MemberWithUser
	err := r.db.WithContext(ctx).
		Table("conversation_members cm").
		Select("cm.user_id, u.nickname, u.avatar_url, cm.role").
		Joins("JOIN users u ON u.id = cm.user_id").
		Where("cm.conversation_id = ?", convID).
		Order("cm.role DESC, u.nickname ASC").
		Scan(&items).Error
	return items, err
}
```

- [ ] **Step 4: service 实现**（conversation_service.go 末尾追加）

```go
// Members 校验成员身份后返回会话成员列表（owner 在前）。
func (s *ConversationService) Members(ctx context.Context, userID, convID uuid.UUID) ([]repository.MemberWithUser, error) {
	ok, err := s.convRepo.IsMember(ctx, convID, userID)
	if err != nil {
		return nil, fmt.Errorf("check membership: %w", err)
	}
	if !ok {
		return nil, ErrNotMember
	}
	return s.convRepo.ListMembers(ctx, convID)
}
```

- [ ] **Step 5: handler 实现**

`handler/conversation.go` 追加（照文件内 List 的既有风格，`h.svc`/`h.logger` 字段名以文件为准）：

```go
// Members 群成员列表（仅会话成员可查）。
func (h *ConversationHandler) Members(c *gin.Context) {
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

	members, err := h.svc.Members(c.Request.Context(), userID, convID)
	if err != nil {
		if errors.Is(err, service.ErrNotMember) {
			Error(c, http.StatusForbidden, 403, "not a conversation member")
			return
		}
		h.logger.Error("list members failed", zap.Error(err))
		InternalError(c, "failed to list members")
		return
	}
	Success(c, gin.H{"members": members})
}
```

`handler/user.go` 追加：

```go
// GetPublicProfile 查任意用户的公开资料（好友资料页用，不含手机号/邮箱）。
func (h *UserHandler) GetPublicProfile(c *gin.Context) {
	targetID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		BadRequest(c, "invalid user id")
		return
	}

	user, err := h.svc.Profile(c.Request.Context(), targetID)
	if err != nil {
		if errors.Is(err, service.ErrUserNotFound) {
			NotFound(c, "user not found")
			return
		}
		h.logger.Error("get public profile failed", zap.Error(err))
		InternalError(c, "failed to get profile")
		return
	}

	Success(c, gin.H{
		"id":         user.ID,
		"nickname":   user.Nickname,
		"avatar_url": user.AvatarURL,
		"short_id":   user.ShortID,
		"bio":        user.Bio,
		"gender":     user.Gender,
	})
}
```

（user.go 需补 import `"github.com/google/uuid"`、`"github.com/yuanchat/server/internal/service"` 已有则略。注意确认 `svc.Profile` 对不存在用户返回 `ErrUserNotFound`——若它返回 `(nil, nil)`，则改为 `if user == nil { NotFound(...); return }`，以 user_service.go:132 实际实现为准。）

- [ ] **Step 6: 路由注册**（router.go）

`authUsers` 组内、`GET /search` 之后加：

```go
			authUsers.GET("/:id", userH.GetPublicProfile)
```

`chat` 组内加：

```go
			chat.GET("/conversations/:id/members", convH.Members)
```

（gin 1.12 支持 `/users/me`、`/users/search` 静态路由与 `/users/:id` 共存，静态优先。）

- [ ] **Step 7: 跑测试确认通过**

Run: `cd server && go test ./internal/service/ -run TestConversationMembers -v && go vet ./... && go build ./...`
Expected: PASS

### Task 1.3: 前端 apiPut + users API + authStore.updateProfile + members API

**Files:**

- Modify: `packages/shared/src/api/client.ts`（apiPut）
- Create: `packages/shared/src/api/users.ts`
- Modify: `packages/shared/src/api/chat.ts`（fetchMembers）
- Modify: `packages/shared/src/store/authStore.ts`（updateProfile action）
- Modify: `packages/shared/src/index.ts`（导出）
- Test: `packages/shared/src/__tests__/usersApi.test.ts`（新建）

**Interfaces（Produces，后续 UI 任务消费）:**

```ts
// api/client.ts
export function apiPut<T>(path: string, body: unknown): Promise<T>;

// api/users.ts
export interface PublicProfile {
  id: string;
  nickname: string;
  avatarUrl?: string | null;
  shortId: number;
  bio?: string | null;
  gender: 0 | 1 | 2;
}
export interface ProfilePatch {
  nickname?: string;
  avatarUrl?: string;
  bio?: string;
  gender?: 0 | 1 | 2;
}
export function fetchPublicProfile(userId: string): Promise<PublicProfile>;
export function updateMyProfile(patch: ProfilePatch): Promise<PublicProfile>; // PUT /users/me，返回完整 user

// api/chat.ts
export interface ConversationMember {
  userId: string;
  nickname: string;
  avatarUrl?: string | null;
  role: 0 | 1 | 2;
}
export function fetchMembers(conversationId: string): Promise<ConversationMember[]>;

// authStore
updateProfile: (patch: ProfilePatch) => Promise<void>; // 调 updateMyProfile 后合并进 state.user
```

- [ ] **Step 1: 写失败测试**（vitest，mock fetch，模式照抄 `__tests__/chatApi.test.ts` 的既有做法）

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fetchPublicProfile, updateMyProfile } from "../api/users";

function mockFetchOnce(data: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ json: () => Promise.resolve({ code: 0, message: "ok", data }) }),
  );
}

describe("users api", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("fetchPublicProfile 映射 snake_case → camelCase", async () => {
    mockFetchOnce({
      id: "u1",
      nickname: "Bob",
      avatar_url: null,
      short_id: 10002,
      bio: "hi",
      gender: 1,
    });
    const p = await fetchPublicProfile("u1");
    expect(p).toEqual({
      id: "u1",
      nickname: "Bob",
      avatarUrl: null,
      shortId: 10002,
      bio: "hi",
      gender: 1,
    });
  });

  it("updateMyProfile 发 PUT 且只带出现的字段", async () => {
    mockFetchOnce({
      id: "u1",
      nickname: "新名",
      avatar_url: null,
      short_id: 10001,
      bio: null,
      gender: 0,
    });
    await updateMyProfile({ nickname: "新名" });
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].method).toBe("PUT");
    expect(JSON.parse(call[1].body)).toEqual({ nickname: "新名" });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @yuanchat/shared test -- usersApi`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

client.ts 末尾加：

```ts
export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "PUT", body: JSON.stringify(body) });
}
```

新建 api/users.ts：

```ts
/**
 * 用户资料 REST API — 公开资料查询 / 我的资料更新
 *
 * @description 对应后端 GET /users/:id 与 PUT /users/me。
 */
import { apiGet, apiPut } from "./client";

export interface PublicProfile {
  id: string;
  nickname: string;
  avatarUrl?: string | null;
  shortId: number;
  bio?: string | null;
  gender: 0 | 1 | 2;
}

export interface ProfilePatch {
  nickname?: string;
  avatarUrl?: string;
  bio?: string;
  gender?: 0 | 1 | 2;
}

interface UserProfileDTO {
  id: string;
  nickname: string;
  avatar_url?: string | null;
  short_id: number;
  bio?: string | null;
  gender: number;
}

function mapProfile(dto: UserProfileDTO): PublicProfile {
  return {
    id: dto.id,
    nickname: dto.nickname,
    avatarUrl: dto.avatar_url,
    shortId: dto.short_id,
    bio: dto.bio,
    gender: (dto.gender === 1 || dto.gender === 2 ? dto.gender : 0) as 0 | 1 | 2,
  };
}

export async function fetchPublicProfile(userId: string): Promise<PublicProfile> {
  return mapProfile(await apiGet<UserProfileDTO>("/api/v1/users/" + encodeURIComponent(userId)));
}

export async function updateMyProfile(patch: ProfilePatch): Promise<PublicProfile> {
  const body: Record<string, unknown> = {};
  if (patch.nickname !== undefined) body.nickname = patch.nickname;
  if (patch.avatarUrl !== undefined) body.avatar_url = patch.avatarUrl;
  if (patch.bio !== undefined) body.bio = patch.bio;
  if (patch.gender !== undefined) body.gender = patch.gender;
  return mapProfile(await apiPut<UserProfileDTO>("/api/v1/users/me", body));
}
```

api/chat.ts 末尾加：

```ts
export interface ConversationMember {
  userId: string;
  nickname: string;
  avatarUrl?: string | null;
  role: 0 | 1 | 2;
}

interface MemberDTO {
  user_id: string;
  nickname: string;
  avatar_url?: string | null;
  role: number;
}

/** 群成员列表（ChatDetail 头像墙 / 成员全列表用） */
export async function fetchMembers(conversationId: string): Promise<ConversationMember[]> {
  const data = await apiGet<{ members: MemberDTO[] }>(
    "/api/v1/conversations/" + conversationId + "/members",
  );
  return (data.members || []).map((m) => ({
    userId: m.user_id,
    nickname: m.nickname,
    avatarUrl: m.avatar_url,
    role: (m.role === 1 || m.role === 2 ? m.role : 0) as 0 | 1 | 2,
  }));
}
```

authStore.ts：AuthState 接口加 `updateProfile: (patch: ProfilePatch) => Promise<void>;`（import type 自 `../api/users`，import `updateMyProfile`），store 实现体加：

```ts
      /** 更新我的资料并同步本地 user（设置页保存用） */
      updateProfile: async (patch) => {
        const updated = await updateMyProfile(patch);
        set((s) => ({
          user: s.user
            ? {
                ...s.user,
                nickname: updated.nickname,
                avatarUrl: updated.avatarUrl,
                bio: updated.bio,
                gender: updated.gender,
              }
            : s.user,
        }));
      },
```

同时给 authStore 的 `User` 接口补两个字段：`bio?: string | null;`、`gender?: 0 | 1 | 2;`，`mapUser` 补映射 `bio: dto.bio ?? undefined` 前先给 `UserDTO` 加 `bio?: string | null; gender?: number;`，映射 `gender: (dto.gender === 1 || dto.gender === 2 ? dto.gender : 0) as 0 | 1 | 2`。

index.ts 加一行：`export * from "./api/users";`

- [ ] **Step 4: 跑测试 + 类型检查**

Run: `pnpm --filter @yuanchat/shared test -- usersApi && pnpm --filter @yuanchat/shared typecheck`
Expected: PASS

### Task 1.4: i18n key 批量新增（批次 1 全量）

**Files:**

- Modify: `packages/design-system/src/i18n/locales/zh-CN.json`
- Modify: `packages/design-system/src/i18n/locales/en-US.json`

**Interfaces:** Produces 后续所有 UI 任务引用的 key。已存在勿重复加：`settings.title/general/appearance/language/about/logout/fontSize.*/skin`、`common.save/confirm/cancel/edit`、`chat.message.revoke/revokeConfirm/revoked/image`、`chat.newChat`、`detail.seeAll/members`。

- [ ] **Step 1: 两个 locale 文件同步追加以下 key**（zh-CN 值如下；en-US 对应英文）

```json
{
  "settings.profile": "个人资料",
  "settings.profileHint": "头像、昵称、签名",
  "settings.account": "账号与安全",
  "settings.accountHint": "手机号、邮箱、元聊号",
  "settings.phone": "手机号",
  "settings.email": "邮箱",
  "settings.notBound": "未绑定",
  "settings.theme": "主题",
  "settings.themeLight": "亮色",
  "settings.themeDark": "暗色",
  "settings.version": "版本",
  "settings.logoutConfirm": "确定退出登录？",
  "settings.avatarLater": "头像上传即将支持",
  "settings.saved": "已保存",
  "settings.saveFailed": "保存失败，请重试",
  "profile.nickname": "昵称",
  "profile.bio": "个性签名",
  "profile.bioPlaceholder": "介绍一下自己…",
  "profile.gender": "性别",
  "profile.genderSecret": "保密",
  "profile.genderMale": "男",
  "profile.genderFemale": "女",
  "profile.copy": "复制",
  "profile.copied": "已复制",
  "contacts.loadDetailFailed": "资料加载失败",
  "chat.yesterday": "昨天",
  "chat.emptyMessages": "暂无消息，打个招呼吧",
  "chat.emoji.recent": "最近使用",
  "chat.emoji.smileys": "笑脸",
  "chat.emoji.gestures": "手势",
  "chat.emoji.animals": "动物",
  "chat.emoji.food": "食物",
  "chat.emoji.activities": "活动",
  "chat.emoji.objects": "物品",
  "chat.emoji.symbols": "符号"
}
```

en-US 对应值：`Profile / Avatar, nickname & bio / Account & Security / Phone, email & Yuan ID / Phone / Email / Not bound / Theme / Light / Dark / Version / Sign out of YuanChat? / Avatar upload coming soon / Saved / Save failed, please retry / Nickname / Bio / Tell us about yourself… / Gender / Secret / Male / Female / Copy / Copied / Failed to load profile / Yesterday / No messages yet. Say hi! / Recent / Smileys / Gestures / Animals / Food / Activities / Objects / Symbols`。

注意：locale JSON 是**扁平 key**（`"settings.profile": "..."`，不是嵌套对象）——照文件既有格式插入对应分区。

- [ ] **Step 2: 验证 JSON 合法 + 双语 key 集合一致**

Run: `python3 -c "import json; a=json.load(open('packages/design-system/src/i18n/locales/zh-CN.json')); b=json.load(open('packages/design-system/src/i18n/locales/en-US.json')); print(sorted(set(a)^set(b)) or 'SYNC-OK')"`
Expected: `SYNC-OK`

### Task 1.5: SettingsScreen（三端）+ ProfileEditView + 路由

**Files:**

- Create: `packages/ui/src/SettingsScreen.tsx`
- Create: `packages/ui/src/ProfileEditView.tsx`
- Modify: `packages/ui/src/index.ts`（导出两组件）
- Create: `apps/web/src/pages/SettingsPage.tsx` + `apps/desktop/src/pages/SettingsPage.tsx`
- Modify: `apps/web/src/App.tsx` + `apps/desktop/src/App.tsx`（`/settings` 路由换 SettingsPage）
- Test: `packages/ui/src/__tests__/SettingsScreen.test.tsx`

**Interfaces:**

- Consumes: `useAuthStore`（user/logout/updateProfile）、`useThemeStore`（mode/toggleMode/locale/setLocale）、`useBreakpoint`、i18n `i18n.changeLanguage`（`import i18n from "@yuanchat/design-system/i18n"`）
- Produces: `<SettingsScreen />`（无 props）；`<ProfileEditView onBack: () => void />`
- 版本号：`import { version } from "../../package.json"` 在 ui 包不可行（无 resolveJsonModule 保证）→ 直接硬编码常量 `const APP_VERSION = "0.1.0";`（root package.json version，发版时同步）

**布局（对齐 docs/design/04_SETTINGS_PAGE.md 子集）：**

- `type SettingsView = "index" | "profile" | "account" | "appearance" | "about"`
- desktop/tablet：左列 240px 分组导航（个人资料卡片 + 4 组项 + 底部退出登录）｜右内容区渲染选中 view；默认选 "profile"
- mobile：view==="index" 渲染全屏分组列表（用户卡片 + 分组行 + 退出 + 版本号居中）；选中后栈式推入子页（带返回箭头，复用 `t("chat.back")`）
- 外观组内容：主题行（Sun/Moon 图标 + 当前 mode label + M3 开关，复用 ChatDetail 的 SettingRow 开关样式——直接复制那段 switch JSX，不 import）、语言行（两个 radio 风格按钮 zh-CN/en-US，选中 `bg-primary-container/60`）
- 语言切换动作：`void i18n.changeLanguage(code); setLocale(code);`（themeStore.locale 已持久化；main.tsx 不改——初始 lng 由 detectLocale，本任务在 SettingsScreen 挂载时 `useEffect` 里若 `themeStore.locale !== i18n.language` 则 changeLanguage 对齐）
- 账号与安全：手机号脱敏 `phone.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2")`、邮箱原样、元聊号+复制按钮
- 退出登录：点击弹 confirm 态（行内两按钮「确认/取消」，不做全局 Dialog）→ `void logout()`
- ProfileEditView：Avatar xl + Camera 角标（lucide `Camera`，点击 toast `settings.avatarLater`——toast 用局部 state 文字 2s 消失，不引全局 toast 系统）；昵称 input（maxLength 50）、bio textarea（maxLength 500，rows 3）、性别三选一分段按钮；「保存」Button primary（busy 防重入，成功显示 `settings.saved`，失败 `settings.saveFailed`）
- 复制按钮统一助手（组件内函数）：

```ts
function copyText(text: string): Promise<void> {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // 旧 WebView 降级
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
  return Promise.resolve();
}
```

- [ ] **Step 1: 写失败测试**（模式照抄 `__tests__/MainLayout.test.tsx`：MemoryRouter 包裹 + zustand 直接 setState 预置）

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { useAuthStore } from "@yuanchat/shared";
import { SettingsScreen } from "../SettingsScreen";

vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return { ...mod, useBreakpoint: () => "desktop" };
});

describe("SettingsScreen", () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: "u1", nickname: "Alice", shortId: 10001, phone: "13800000001" },
      isAuthenticated: true,
    });
  });

  it("渲染分组导航与用户卡片", () => {
    render(<SettingsScreen />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("settings.account")).toBeInTheDocument();
    expect(screen.getByText("settings.appearance")).toBeInTheDocument();
  });

  it("账号页手机号脱敏", () => {
    render(<SettingsScreen />);
    fireEvent.click(screen.getByText("settings.account"));
    expect(screen.getByText("138****0001")).toBeInTheDocument();
  });
});
```

（ui 测试环境 i18n 未初始化时 `t()` 返回 key 本身——断言用 key 字符串，与既有测试一致；若 setup.ts 已初始化 i18n 则断言中文值，以既有测试文件实际断言风格为准。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @yuanchat/ui test -- SettingsScreen`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 SettingsScreen.tsx + ProfileEditView.tsx**（按上面布局细则；文件头 JSDoc 说明三端形态；每文件 ≤300 行，超了就把「账号/外观/关于」内容区拆成同文件内小组件或独立 `SettingsSections.tsx`）

- [ ] **Step 4: 页面接线**

`apps/web/src/pages/SettingsPage.tsx`（desktop 同构）：

```tsx
/**
 * SettingsPage — 设置页面（Web 端）
 */
import { SettingsScreen } from "@yuanchat/ui";

export function SettingsPage() {
  return <SettingsScreen />;
}
```

两个 App.tsx：`<Route path="/settings" element={<ChatPage />} />` → `<Route path="/settings" element={<SettingsPage />} />`（补 import）。

ui/index.ts「通讯录组件」节后加「设置组件」节导出 SettingsScreen/ProfileEditView。

- [ ] **Step 5: 跑测试 + 双端 tsc**

Run: `pnpm --filter @yuanchat/ui test -- SettingsScreen && cd apps/web && npx tsc --noEmit && cd ../desktop && npx tsc --noEmit`
Expected: 全 PASS

### Task 1.6: ContactDetail 丰富 + ChatDetail 真实成员

**Files:**

- Modify: `packages/ui/src/ContactDetail.tsx`
- Modify: `packages/ui/src/ChatDetail.tsx`
- Test: `packages/ui/src/__tests__/ChatDetail.test.tsx`（改既有：DEMO_MEMBERS 断言换 mock fetchMembers）

**Interfaces:**

- Consumes: `fetchPublicProfile`（Task 1.3）、`fetchMembers`（Task 1.3）、`isMockEnabled`
- Produces: ChatDetail 新增 props `onShowAllMembers?: () => void`（Task 2.4 群成员全列表接线；本任务先渲染按钮、无 props 时隐藏）

**ContactDetail 改造：**

- 挂载/friend.id 变化时 `useEffect`：`isMockEnabled()` 时跳过，否则 `fetchPublicProfile(friend.id)` 存局部 state `profile`（失败显示 `contacts.loadDetailFailed` 小字，不阻塞既有信息）
- 布局改为：头像+昵称区下方加信息卡 `bg-surface-container rounded-xl`（行式：`profile.bio` 签名（有才显示）、`profile.gender` 性别（1→male 2→female 0 不显示）、元聊号+Copy 图标按钮（copyText 助手同 Task 1.5，抽到 `packages/ui/src/copyText.ts` 导出共用，SettingsScreen 改 import 这里））
- 「发消息」按钮保留原逻辑

**ChatDetail 改造：**

- 删除 `DEMO_MEMBERS` 常量；新增局部 state `members: ConversationMember[]`，`useEffect`（isGroup && !isMockEnabled() 时）`fetchMembers(conv.id)`；mock 模式回退静态数组 `[{userId:"m1",nickname:"张伟",avatarUrl:null,role:2},…]`（放组件外常量 `MOCK_MEMBERS`）
- 头像墙渲染 `members.slice(0, 8)`，`extraMembers = (conv.memberCount ?? members.length) - Math.min(members.length, 8)`
- 「查看全部」按钮 onClick 调 `onShowAllMembers`（props 可选，无则不渲染按钮）

- [ ] **Step 1: 改 ChatDetail.test.tsx 中依赖 DEMO_MEMBERS 的断言**（mock `fetchMembers` 返回固定 3 人，断言头像墙渲染 3 个名字；先改测试跑红）

Run: `pnpm --filter @yuanchat/ui test -- ChatDetail`
Expected: FAIL

- [ ] **Step 2: 实现两组件改造**（按上面细则）

- [ ] **Step 3: 跑测试确认通过**

Run: `pnpm --filter @yuanchat/ui test -- ChatDetail && pnpm --filter @yuanchat/ui typecheck`
Expected: PASS

### Task 1.7: 聊天细节 — 日期分隔线 + 连续消息合并 + 骨架屏 + 空状态

**Files:**

- Modify: `packages/shared/src/store/messageStore.ts`（ChatMessage 加 `dateKey?: string`）
- Modify: `packages/shared/src/api/chat.ts`（mapMessage 产出 dateKey + `formatDateDivider` 导出）
- Modify: `packages/ui/src/ChatWindow.tsx`（分隔线/合并/空状态/骨架）
- Modify: `packages/ui/src/MessageBubble.tsx`（新 prop `compact?: boolean` 省略头像昵称）
- Modify: `packages/ui/src/ConversationList.tsx`（loading 骨架）
- Test: `packages/shared/src/__tests__/chatApi.test.ts`（追加 formatDateDivider 用例）

**Interfaces:**

- Produces: `formatDateDivider(dateKey: string): string`（"2026-07-17" → 今天/昨天/`M月D日`；跨年 `YYYY/M/D`）；`ChatMessage.dateKey`（`YYYY-MM-DD`，由 mapMessage/receive 帧/sendText 统一填 `dateKeyOf(new Date(...))`）
- MessageBubble `compact` 语义：true 时不渲染 Avatar（占位 `w-10` 空 div 保持对齐）与群聊昵称行，外层 `mt-0.5` 代替 `mt-2`

**ChatWindow 渲染逻辑（替换现有 199-208 行 map 与 192-197 静态"今天"分隔线）：**

```tsx
{(messages ?? []).map((msg, i) => {
  const prev = i > 0 ? messages![i - 1] : undefined;
  const showDivider = !!msg.dateKey && msg.dateKey !== prev?.dateKey;
  const compact =
    !showDivider &&
    !!prev &&
    prev.kind !== "system" &&
    msg.kind !== "system" &&
    prev.isSelf === msg.isSelf &&
    prev.senderName === msg.senderName &&
    minutesBetween(prev.time, msg.time) < 1;
  return (
    <Fragment key={msg.id}>
      {showDivider && <DateDivider label={formatDateDivider(msg.dateKey!)} />}
      <MessageBubble msg={msg} compact={compact} onRetry={...} onReply={...} />
    </Fragment>
  );
})}
```

（`minutesBetween` 解析 "HH:mm" 差值的本文件小函数，跨 dateKey 已被 showDivider 拦住；DateDivider 即原胶囊分隔线抽成小组件。onRetry/onReply 保持原逻辑。）

**空状态：** `messages` 已加载（非 undefined）且长度 0 时，消息区中央渲染 `chat.emptyMessages` + MessageSquare 图标（复用 ChatScreen EmptyState 样式，内联小组件）。

**骨架屏：**

- ConversationList：`loading && conversations.length===0` 时渲染 6 行骨架（每行：`animate-pulse` + 头像圆 `h-10 w-10 rounded-full bg-surface-container-high` + 两条宽度不同的圆角条），行高与真实条目一致（防 CLS）
- ChatWindow：`messages === undefined` 时渲染 4 条左右交替的气泡骨架（同 pulse 风格）

（spec 提到"插画化空状态"——鉴于项目未装 svgr，此处用 lucide 图标 + 文案的轻量空状态实现，不引新构建插件；此取舍记入 commit message。）

- [ ] **Step 1: 写失败测试**（chatApi.test.ts 追加）

```ts
import { formatDateDivider } from "../api/chat";

it("formatDateDivider 今天/昨天/日期", () => {
  const today = new Date();
  const key = (d: Date) =>
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0");
  expect(formatDateDivider(key(today))).toBe("今天");
  const y = new Date(today.getTime() - 86400000);
  expect(formatDateDivider(key(y))).toBe("昨天");
  expect(formatDateDivider("2020-03-05")).toBe("2020/3/5");
});
```

（"今天/昨天"经 i18n：实现里用 `i18n.t("chat.today")` / `i18n.t("chat.yesterday")`——shared 包不依赖 react-i18next 组件层，直接 `import i18n from "@yuanchat/design-system/i18n"`。测试环境 i18n 已由该 import 初始化，断言中文值。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @yuanchat/shared test -- chatApi`
Expected: FAIL

- [ ] **Step 3: 实现 shared 侧**（dateKeyOf/formatDateDivider/dateKey 贯通：mapMessage、useChatBootstrap 的 receive 帧构造 msg 处、messageStore.sendText 乐观消息）

- [ ] **Step 4: 实现 UI 侧**（ChatWindow/MessageBubble/ConversationList 按细则）

- [ ] **Step 5: 全量前端测试**

Run: `pnpm test`
Expected: 全 PASS（既有 51+ 测试不回归）

### Task 1.8: EmojiPicker + Composer 接线

**Files:**

- Create: `packages/ui/src/emojiData.ts`（分类常量）
- Create: `packages/ui/src/EmojiPicker.tsx`
- Modify: `packages/ui/src/Composer.tsx`
- Test: `packages/ui/src/__tests__/EmojiPicker.test.tsx`

**Interfaces:**

- Produces: `<EmojiPicker onPick={(emoji: string) => void} onClose={() => void} compact?: boolean />`
- emojiData.ts：`export const EMOJI_CATEGORIES: { key: string; labelKey: string; emojis: string[] }[]`，7 类（labelKey 对应 Task 1.4 的 `chat.emoji.*`），每类 30-40 个原生 emoji 字符
- 最近使用：localStorage key `yuanchat-recent-emojis`（JSON string[]，头插去重截 24）；读写 try/catch 包裹

**Composer 接线（两种模式都改）：**

- `const [showEmoji, setShowEmoji] = useState(false);` Smile 按钮 onClick 切换
- 桌面：面板 absolute 定位于输入卡片上方（外层加 `relative`），`w-80 max-h-72`；mobile：全宽面板渲染在输入行下方（不悬浮，推高布局——安卓键盘 memory 教训避免 fixed 定位）
- onPick 光标处插入：

```ts
const insertEmoji = (emoji: string) => {
  const el = textareaRef.current;
  if (!el) {
    setValue((v) => v + emoji);
    return;
  }
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  const next = value.slice(0, start) + emoji + value.slice(end);
  setValue(next);
  requestAnimationFrame(() => {
    el.focus();
    const pos = start + emoji.length;
    el.setSelectionRange(pos, pos);
  });
};
```

- 点击面板外关闭：EmojiPicker 根元素 `onMouseDown={(e) => e.stopPropagation()}`，Composer 层 `useEffect` 挂 document mousedown 监听 setShowEmoji(false)（showEmoji 为 true 时才挂）

- [ ] **Step 1: 写失败测试**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmojiPicker } from "../EmojiPicker";

describe("EmojiPicker", () => {
  it("点击 emoji 触发 onPick 并写入最近使用", () => {
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} onClose={() => {}} />);
    const first = screen.getAllByRole("button", { name: /😀|😄|😁/ })[0];
    fireEvent.click(first);
    expect(onPick).toHaveBeenCalledTimes(1);
    const recent = JSON.parse(localStorage.getItem("yuanchat-recent-emojis") || "[]");
    expect(recent.length).toBe(1);
  });

  it("分类 tab 切换", () => {
    render(<EmojiPicker onPick={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "chat.emoji.animals" }));
    expect(screen.getByText("🐶")).toBeInTheDocument();
  });
});
```

（每个 emoji 渲染为 `<button aria-label={emoji}>`；分类 tab `role="tab"`。）

- [ ] **Step 2: 跑测试确认失败** → **Step 3: 实现** → **Step 4: 跑测试通过**

Run: `pnpm --filter @yuanchat/ui test -- EmojiPicker`

### Task 1.9: 批次 1 收口 — E2E 验证 + 文档 + Commit

- [ ] **Step 1: 全量测试门禁**

Run:

```bash
export PATH=/home/liaojie1314/env/go/go/bin:$PATH GOPATH=/home/liaojie1314/env/go/GOPATH
docker compose -f deploy/docker-compose.yml up -d
cd server && go vet ./... && go test ./... && cd ..
pnpm test
cd apps/web && npx tsc --noEmit && cd ../desktop && npx tsc --noEmit && cd ../..
```

Expected: 全绿

- [ ] **Step 2: E2E 实测**（`go run ./cmd/server` 后台 + `VITE_ENABLE_MOCK=false pnpm --filter @yuanchat/web dev` 后台；Playwright 登录 Alice 13800000001/Test@1234——登录按钮名'登 录'中间有空格）：
  - /settings：分组导航、改昵称+签名保存 → 刷新后仍在（落库验证，即 Task 1.1 bug 修复的验收）、语言切到 English 全 UI 变英文、主题切换、退出登录确认态
  - /contacts：点好友 → 资料卡显示签名/性别/元聊号复制
  - /chat：群聊详情面板成员来自真实接口；消息流日期分隔线与连续合并；Emoji 面板选表情发送；空会话空状态
  - 手机视口（375×812 emulate）：设置页栈式导航、emoji 面板不遮输入框

- [ ] **Step 3: 文档**：`docs/02_CHAT_API.md` §二追加 `GET /users/:id`、`GET /conversations/:id/members`、`PUT /users/me`（响应改完整 user）三节

- [ ] **Step 4: 环境清理 + 一次完整提交**

```bash
git add -A
git commit -m "feat(ui): 批次1 视觉焕新 — 设置页/资料编辑/资料卡/聊天细节/Emoji 面板

- 修复 PUT /users/me 不落库 bug；新增 GET /users/:id、GET /conversations/:id/members
- SettingsScreen 三端（个人资料编辑/账号脱敏展示/主题+语言切换/关于/退出确认）
- ContactDetail 信息卡（签名/性别/元聊号复制）；ChatDetail 真实群成员
- 聊天细节：日期分隔线、连续消息合并、列表+消息骨架屏、空状态
- EmojiPicker 自建面板（分类 tab/最近使用/光标插入）
- i18n 双语 33 键

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

（服务与 docker 若批次 2 紧接着做可不停；只在整轮结束时统一清理。）

---

# 批次 2：群聊与撤回

### Task 2.1: 后端建群 POST /conversations + conversation.created 帧

**Files:**

- Modify: `server/internal/ws/protocol.go`（帧常量 + payload）
- Modify: `server/internal/service/conversation_service.go`（CreateGroup）
- Modify: `server/internal/handler/conversation.go`（Create handler + 请求体）
- Modify: `server/internal/router/router.go`（路由 + ConversationHandler 注入 contactRepo/userRepo/dispatcher——看下方 wiring）
- Test: `server/internal/service/conversation_create_test.go`

**Interfaces:**

- `POST /api/v1/conversations` body `{name?: string, member_ids: string[]}`（1-100 个；全部须为发起者好友否则 400 code=400 msg="all members must be your friends"）
- 响应 `Created(c, dto)`——dto 与 GET /conversations 单项同构（ConversationDTO）
- WS 新帧 `conversation.created`，payload `{conversation: <ConversationDTO>}`，推给全部成员（含发起者，前端对发起者去重：POST 响应已插入本地则按 id 去重）
- `func (s *ConversationService) CreateGroup(ctx context.Context, creatorID uuid.UUID, name *string, memberIDs []uuid.UUID) (*ConversationDTO, []uuid.UUID, error)`（返回 dto + 全员 ID 供推送；`ErrNotAllFriends = errors.New("some members are not friends")`）

**CreateGroup 事务逻辑：**

1. 去重 memberIDs、剔除 creatorID 自身；空或 >100 返回参数错误（handler 层 binding 拦 + service 兜底）
2. 逐个 `contactRepo.IsFriend(ctx, creatorID, id)`，任一 false 返回 ErrNotAllFriends
3. 群名缺省：查 creator + 前 2 个成员昵称逗号拼接，`len([]rune) > 100` 截断
4. Transaction：Create conversation(type=2, name)→ creator role=owner + 其余 normal 全员 Create member 行 → 系统消息 `fmt.Sprintf("%s 创建了群聊", creatorNickname)`（MessageTypeSystem，经 `repository.NewMessageRepository(tx).CreateWithSeq` 复用 savepoint 模式，SenderID=creatorID）→ creator last_read_seq 推进到 seq（照抄 contact_service.go Accept 第 4 步模式）
5. 事务外组装 ConversationDTO（复用 List 的字段逻辑：member_count=len、last_message=系统消息、unread: creator 0 其余 1——DTO 按"发起者视角"填 UnreadCount=0/MyLastReadSeq=seq 即可，各成员端靠 loadConversations 或帧内 dto+服务端视角，简化：帧内 dto 的 unread_count 填 1、my_last_read_seq 填 0，发起者忽略帧）

**Handler + wiring：**

- `ConversationHandler` 构造函数加参：`NewConversationHandler(svc, contactSvc 不需要——service 层直接持 contactRepo, dispatcher ws.Dispatcher, logger)`；实际改法：`ConversationService` 构造函数追加 `contactRepo *repository.ContactRepository` 与 `userRepo *repository.UserRepository` 两个字段（router.go wiring 同步改 `service.NewConversationService(convRepo, msgRepo, contactRepo, userRepo, logger)`）；handler 追加 dispatcher 字段（`handler.NewConversationHandler(convSvc, hub, logger)`——router.go 中 convH 的创建移到 hub 创建之后）
- handler Create：bind → svc.CreateGroup → `ws.Encode(ws.TypeConversationCreated, ws.ConversationCreatedPayload{Conversation: dto})` → `dispatcher.SendToUsers(memberIDs, frame)` → `Created(c, dto)`

**protocol.go 追加：**

```go
	TypeConversationCreated = "conversation.created"
```

```go
// ConversationCreatedPayload 新会话创建推送（建群），推给全部成员。
// Conversation 字段为 service.ConversationDTO 的 JSON（避免 ws→service 循环导入，用 any）。
type ConversationCreatedPayload struct {
	Conversation any `json:"conversation"`
}
```

- [ ] **Step 1: 写失败测试**

```go
func TestCreateGroup(t *testing.T) {
	db := testDB(t)
	a := newTestUser(t, db, "群主")
	b := newTestUser(t, db, "成员乙")
	c := newTestUser(t, db, "陌生丙")

	// a↔b 建好友（直接插 contacts 双向行）
	for _, pair := range [][2]uuid.UUID{{a.ID, b.ID}, {b.ID, a.ID}} {
		ct := &model.Contact{UserID: pair[0], ContactUserID: pair[1], Status: model.ContactStatusAccepted}
		if err := db.Create(ct).Error; err != nil {
			t.Fatalf("create contact: %v", err)
		}
		t.Cleanup(func() { db.Unscoped().Delete(ct) })
	}

	svc := NewConversationService(
		repository.NewConversationRepository(db), repository.NewMessageRepository(db),
		repository.NewContactRepository(db), repository.NewUserRepository(db), zap.NewNop())

	// 含陌生人 → ErrNotAllFriends
	if _, _, err := svc.CreateGroup(context.Background(), a.ID, nil, []uuid.UUID{b.ID, c.ID}); !errors.Is(err, ErrNotAllFriends) {
		t.Fatalf("want ErrNotAllFriends, got %v", err)
	}

	dto, memberIDs, err := svc.CreateGroup(context.Background(), a.ID, nil, []uuid.UUID{b.ID})
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}
	t.Cleanup(func() {
		db.Where("conversation_id = ?", dto.ID).Delete(&model.ConversationMember{})
		db.Where("conversation_id = ?", dto.ID).Unscoped().Delete(&model.Message{})
		db.Unscoped().Delete(&model.Conversation{}, "id = ?", dto.ID)
	})
	if dto.Type != model.ConversationTypeGroup || dto.MemberCount != 2 || len(memberIDs) != 2 {
		t.Fatalf("bad dto: %+v members=%v", dto, memberIDs)
	}
	if dto.Name == "" || dto.LastMessage == nil {
		t.Fatalf("default name & greeting system message required: %+v", dto)
	}
}
```

- [ ] **Step 2: 确认失败** Run: `cd server && go test ./internal/service/ -run TestCreateGroup -v` → FAIL
- [ ] **Step 3: 按上面逻辑实现 protocol/service/handler/router**
- [ ] **Step 4: 确认通过** Run: 同上 + `go vet ./... && go build ./...` → PASS

### Task 2.2: 后端撤回 POST /messages/:id/recall + message.recalled 帧

**Files:**

- Modify: `server/internal/ws/protocol.go`
- Modify: `server/internal/repository/message_repo.go`（FindByID + Recall）
- Modify: `server/internal/service/message_service.go`（Recall）
- Modify: `server/internal/handler/message.go`（Recall handler）
- Modify: `server/internal/router/router.go`（路由 + msgH 注入 dispatcher）
- Test: `server/internal/service/message_recall_test.go`

**Interfaces:**

- `POST /api/v1/messages/:id/recall`（空 body）→ 成功 `Success(c, gin.H{"message":"recalled"})`；非本人 403 code=403；超 2 分钟 403 code=4031 msg="recall window expired"；已撤回幂等 Success
- WS 帧 `message.recalled` payload `{message_id, conversation_id, seq, operator_id, operator_nickname}` 推会话全员
- `func (s *MessageService) Recall(ctx context.Context, userID, messageID uuid.UUID) (*RecallResult, error)`；`RecallResult{Message *model.Message; OperatorNickname string; MemberIDs []uuid.UUID; Idempotent bool}`；错误：`ErrNotSender`、`ErrRecallWindowExpired`、`ErrMessageNotFound`（`errors.New` 定义在 message_service.go）
- `const RecallWindow = 2 * time.Minute`

**repo 追加：**

```go
// FindByID 按 ID 查消息（含软删过滤），不存在返回 nil。
func (r *MessageRepository) FindByID(ctx context.Context, id uuid.UUID) (*model.Message, error) {
	var msg model.Message
	err := r.db.WithContext(ctx).First(&msg, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &msg, err
}

// Recall 将消息置为已撤回并清空内容（仅 normal 状态可翻转，返回是否翻转成功）。
func (r *MessageRepository) Recall(ctx context.Context, id uuid.UUID) (bool, error) {
	res := r.db.WithContext(ctx).Model(&model.Message{}).
		Where("id = ? AND status = ?", id, model.MessageStatusNormal).
		Updates(map[string]any{"status": model.MessageStatusRevoked, "content": "{}"})
	return res.RowsAffected > 0, res.Error
}
```

（message_repo.go 需补 import `"errors"`。）

**service.Recall 逻辑：** FindByID→nil 则 ErrMessageNotFound；SenderID != userID 则 ErrNotSender；`time.Since(msg.CreatedAt) > RecallWindow` 则 ErrRecallWindowExpired；已 Revoked 则 `Idempotent: true` 直接返回（MemberIDs 空，handler 跳过推送）；Recall repo 翻转（false 即并发已撤，同幂等处理）；查 operator 昵称 + GetMemberIDs 返回。

- [ ] **Step 1: 写失败测试**（testDB + newTestUser + 建单聊 conv/member/消息各一，用例：本人 2 分钟内成功、他人 ErrNotSender、`db.Model(&msg).Update("created_at", time.Now().Add(-3*time.Minute))` 后 ErrRecallWindowExpired、重复撤回 Idempotent=true）
- [ ] **Step 2: 确认失败** → **Step 3: 实现 repo/service/handler/protocol/router**

handler/message.go 追加（msgH 构造函数加 dispatcher，router 同步）：

```go
// Recall 撤回消息（发送者本人、2 分钟窗口内）。
func (h *MessageHandler) Recall(c *gin.Context) {
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

	result, err := h.svc.Recall(c.Request.Context(), userID, msgID)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrMessageNotFound):
			NotFound(c, "message not found")
		case errors.Is(err, service.ErrNotSender):
			Error(c, http.StatusForbidden, 403, "only the sender can recall")
		case errors.Is(err, service.ErrRecallWindowExpired):
			Error(c, http.StatusForbidden, 4031, "recall window expired")
		default:
			h.logger.Error("recall failed", zap.Error(err))
			InternalError(c, "recall failed")
		}
		return
	}

	if !result.Idempotent {
		if frame, err := ws.Encode(ws.TypeMessageRecalled, ws.MessageRecalledPayload{
			MessageID:        result.Message.ID,
			ConversationID:   result.Message.ConversationID,
			Seq:              result.Message.Seq,
			OperatorID:       userID,
			OperatorNickname: result.OperatorNickname,
		}); err == nil {
			h.dispatcher.SendToUsers(result.MemberIDs, frame)
		}
	}
	Success(c, gin.H{"message": "recalled"})
}
```

protocol.go：`TypeMessageRecalled = "message.recalled"` + `MessageRecalledPayload{MessageID, ConversationID uuid.UUID; Seq int64; OperatorID uuid.UUID; OperatorNickname string}`（json tag snake_case）。router：`chat.POST("/messages/:id/recall", msgH.Recall)`。

- [ ] **Step 4: 确认通过** Run: `cd server && go test ./internal/service/ -run TestRecall -v && go vet ./...` → PASS

### Task 2.3: 前端撤回 — api + store.applyRecall + 气泡菜单 + 帧接线

**Files:**

- Modify: `packages/shared/src/api/chat.ts`（recallMessage + mapMessage 处理 status=2）
- Modify: `packages/shared/src/store/messageStore.ts`（applyRecall + ChatMessage.recalled 字段）
- Modify: `packages/shared/src/ws/chatSocket.ts`（ServerFrames 加 message.recalled）
- Modify: `packages/shared/src/hooks/useChatBootstrap.ts`（帧 handler）
- Modify: `packages/ui/src/MessageBubble.tsx`（撤回占位渲染 + 长按/hover 菜单）
- Modify: `packages/ui/src/ChatWindow.tsx`（onRecall 回调传入）
- Test: `packages/shared/src/__tests__/messageStore.test.ts`（追加 applyRecall 用例）

**Interfaces:**

- `ChatMessage` 加 `recalled?: boolean;`（true 时气泡渲染灰字占位，忽略 kind/text）
- `messageStore.applyRecall(convId: string, messageId: string, operatorName: string)`：目标消息 → `{...m, recalled: true, text: undefined}`；若是该会话最后一条，调用方（bootstrap handler）同步 `updateConversation(convId, { lastMessage: t("chat.message.revoked") })`
- `api/chat.ts`：`export async function recallMessage(messageId: string): Promise<void>`（apiPost 空 body）；mapMessage 中 `dto.status === 2` → `recalled: true`
- ServerFrames 追加：`"message.recalled": { message_id: string; conversation_id: string; seq: number; operator_id: string; operator_nickname: string };`
- MessageBubble props 加 `onRecall?: () => void`（仅 isSelf && !recalled && 2 分钟内显示）；2 分钟判定：ChatMessage 加 `createdAtMs?: number`（mapMessage/ack/sendText 填充），Bubble 内 `canRecall = msg.isSelf && !!msg.createdAtMs && Date.now() - msg.createdAtMs < 120_000`
- 菜单交互（无 radix 引入新组件，轻量实现）：气泡 `onContextMenu`（桌面右键）与长按（`onTouchStart/End` 500ms 计时）弹出内联小菜单（absolute 定位 div：撤回/复制两项；复制用 copyText）；点外部关闭同 EmojiPicker 模式
- 占位渲染：`msg.recalled` 时整条走系统消息样式 `你撤回了一条消息`（isSelf）/ `%{name} 撤回了一条消息`——i18n key 复用 `chat.message.revoked`？其值为"消息已撤回"不带主语 → **新增 key** `chat.message.revokedBySelf`（"你撤回了一条消息"/"You recalled a message"）与 `chat.message.revokedBy`（"%{name} 撤回了一条消息"/"%{name} recalled a message"），双语同步（此两键并入本任务改 locale 文件）
- 撤回动作流：菜单点撤回 → `recallMessage(msg.id)`（**用服务端 id**，故 sending/failed 状态不显示撤回项）→ 成功靠 WS 帧回来统一 applyRecall（本端不乐观翻转，双端一致）；403/4031 → alert 式行内提示（简化：`window.alert(t("chat.message.recallExpired"))`——**再加 key** `chat.message.recallExpired`（"超过 2 分钟，无法撤回"/"Cannot recall after 2 minutes"）

**bootstrap handler 追加：**

```ts
    "message.recalled": (p) => {
      const selfId = useAuthStore.getState().user?.id ?? "";
      useMessageStore.getState().applyRecall(p.conversation_id, p.message_id, p.operator_nickname);
      const convStore = useConversationStore.getState();
      const conv = convStore.conversations.find((c) => c.id === p.conversation_id);
      // 撤回的是最后一条时刷新列表预览
      if (conv && conv.lastSeq === p.seq) {
        convStore.updateConversation(p.conversation_id, {
          lastMessage: i18n.t(p.operator_id === selfId ? "chat.message.revokedBySelf" : "chat.message.revokedBy", { name: p.operator_nickname }),
        });
      }
    },
```

（useChatBootstrap 顶部 `import i18n from "@yuanchat/design-system/i18n";`）

- [ ] **Step 1: 写失败测试**（messageStore.test.ts 追加：预置 2 条消息 setState → applyRecall 第 1 条 → 断言 `recalled===true && text===undefined`，第 2 条不受影响）
- [ ] **Step 2: 确认失败** Run: `pnpm --filter @yuanchat/shared test -- messageStore` → FAIL
- [ ] **Step 3: 实现全链**（含 2 个新 i18n key 双语）
- [ ] **Step 4: 确认通过** Run: `pnpm --filter @yuanchat/shared test && pnpm --filter @yuanchat/ui typecheck` → PASS

### Task 2.4: 前端建群 — CreateGroupModal + 会话列表入口 + 帧接线 + 成员全列表

**Files:**

- Create: `packages/ui/src/CreateGroupModal.tsx`
- Modify: `packages/ui/src/ConversationList.tsx`（Plus 按钮 → 下拉菜单两项）
- Modify: `packages/ui/src/ChatScreen.tsx`（挂两个 Modal）
- Modify: `packages/ui/src/ChatDetail.tsx` + `packages/ui/src/ChatScreen.tsx`（onShowAllMembers → MembersView）
- Create: `packages/ui/src/MembersView.tsx`
- Modify: `packages/shared/src/api/chat.ts`（createGroup）
- Modify: `packages/shared/src/ws/chatSocket.ts` + `useChatBootstrap.ts`（conversation.created 帧）
- Modify: locale 双语（本任务 key，见下）
- Test: `packages/ui/src/__tests__/CreateGroupModal.test.tsx`

**Interfaces:**

- `api/chat.ts`：`export async function createGroup(name: string | undefined, memberIds: string[]): Promise<Conversation>`（POST /conversations，body `{name?, member_ids}`，响应 dto 过 mapConversation）
- ServerFrames 追加：`"conversation.created": { conversation: ConversationDTO };`（ConversationDTO 已在 chat.ts 导出，chatSocket import type）
- bootstrap handler：`mapConversation(p.conversation)` → 已存在同 id 则跳过，否则 `addConversation`
- `<CreateGroupModal open onClose />`：视觉沿用 AddContactModal 模式（fixed 遮罩 bg-black/40 + `bg-surface-container-low rounded-2xl` 卡片）；内容：可选群名 input（maxLength 100）→ 好友多选列表（useContactStore.friends + groupFriends 字母分组 + 每行 checkbox 样式选中态 `bg-primary-container/60`）→ 顶部已选头像横排（点删）→「创建」按钮（≥1 人可点，busy 防重入）→ 成功 `setActive(conv.id)` + onClose（不 navigate——本就在 /chat）
- ConversationList Plus 下拉：`useState showMenu`，菜单两项「发起群聊」`t("chat.menu.newGroup")`、「添加好友」`t("chat.menu.addContact")`（新 key，双语：发起群聊/New Group、添加好友/Add Contact）；回调 props `onNewGroup?: () => void; onAddContact?: () => void` 由 ChatScreen 传入（ChatScreen 挂 CreateGroupModal + AddContactModal 两个 state；进入 /chat 后好友列表可能未拉 → CreateGroupModal open 时 `useEffect` `if (!isMockEnabled()) void loadFriends();`）
- `<MembersView members onBack />`：全列表（Avatar+昵称+role 徽标：role===2 Crown 图标+`t("detail.roleOwner")`、role===1 Shield+`t("detail.roleAdmin")`——新 key 双语：群主/Owner、管理员/Admin）；ChatScreen 里 showDetail 面板内容在 detail/members 两态切换（`detailView: "info" | "members"` state，ChatDetail 的 onShowAllMembers 切到 members，onBack 切回）

- [ ] **Step 1: 写失败测试**（CreateGroupModal：预置 contactStore.friends 3 人 → 勾选 2 人 → mock createGroup resolve → 点创建 → 断言调用参数 member_ids 长度 2 且 setActive 被调；mock 方式照抄 AddContactModal 若有测试，否则 vi.mock("@yuanchat/shared", …) 模式同 SettingsScreen）
- [ ] **Step 2: 确认失败** → **Step 3: 实现全链**（i18n 4 新 key 双语同步）
- [ ] **Step 4: 确认通过** Run: `pnpm --filter @yuanchat/ui test -- CreateGroupModal && pnpm test` → 全 PASS

### Task 2.5: 批次 2 收口 — E2E + 文档 + Commit

- [ ] **Step 1: 全量测试门禁**（同 Task 1.9 Step 1 命令）
- [ ] **Step 2: E2E 双账号实测**（Alice + Bob 两浏览器上下文）：
  - Alice 发起群聊选 Bob（+Carol 若已是好友）→ 群出现在两端会话列表（Bob 端靠 conversation.created 帧实时冒出，验证系统消息"Alice 创建了群聊"与未读 1）
  - 群聊发消息 → 详情面板成员列表 owner 徽标 → 查看全部
  - Alice 发一条消息 → 右键撤回 → 双端气泡变占位、列表预览变"撤回了一条消息"
  - 等待/构造超窗：直接 curl 改库不必——用 psql 把某消息 created_at 改早 3 分钟后 curl recall 验证 4031
  - 手机视口：长按消息出菜单撤回
- [ ] **Step 3: 文档**：02_CHAT_API.md 追加 POST /conversations、POST /messages/:id/recall 两节 + WS 表两行（conversation.created / message.recalled）
- [ ] **Step 4: 一次完整提交**

```bash
git add -A
git commit -m "feat(group-recall): 批次2 建群流程 + 群成员查看 + 消息撤回

- POST /conversations 建群（好友校验/owner 角色/系统消息/conversation.created 推送）
- POST /messages/:id/recall（本人 2 分钟窗口/幂等/message.recalled 推送）
- CreateGroupModal 好友多选建群；会话列表 + 菜单（发起群聊/添加好友）
- MembersView 成员全列表（owner/admin 徽标）；撤回菜单与双端占位渲染
- E2E 双账号实测通过

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# 批次 3：MinIO + 图片消息 + 头像上传

### Task 3.1: MinIO 基础设施 — compose + config + storage 包

**Files:**

- Modify: `deploy/docker-compose.yml`（取消 minio 注释，含 volumes 里的 minio_data）
- Modify: `server/config/config.yaml` + `server/internal/config/config.go`（MinIOConfig）
- Create: `server/internal/storage/minio.go`
- Modify: `server/cmd/server/main.go` + `server/internal/router/router.go`（wiring）
- Test: `server/internal/storage/minio_test.go`

**Interfaces:**

config.yaml 追加：

```yaml
minio:
  endpoint: localhost:9000
  access_key: yuanchat_minio
  secret_key: yuanchat_minio_dev
  bucket: yuanchat
  use_ssl: false
```

config.go：`MinIO MinIOConfig \`mapstructure:"minio"\``+`type MinIOConfig struct { Endpoint, AccessKey, SecretKey, Bucket string; UseSSL bool }`（mapstructure tag 对应）。

storage 包：

```go
// Package storage 封装 MinIO 对象存储：预签名上传/下载 URL。
package storage

type Storage struct { client *minio.Client; bucket string; endpoint string; useSSL bool }

func New(cfg config.MinIOConfig) (*Storage, error)  // 连接 + EnsureBucket + avatars/ 前缀 public-read policy
func (s *Storage) PresignPut(ctx context.Context, objectKey, contentType string, expires time.Duration) (string, error)
func (s *Storage) PresignGet(ctx context.Context, objectKey string, expires time.Duration) (string, error)
func (s *Storage) PublicURL(objectKey string) string  // http(s)://endpoint/bucket/key（avatars 用）
```

public-read policy JSON（SetBucketPolicy）：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "AWS": ["*"] },
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::yuanchat/avatars/*"]
    }
  ]
}
```

（bucket 名从 cfg 拼进 Resource。）

- [ ] **Step 1: compose 取消注释 + `docker compose -f deploy/docker-compose.yml up -d` 确认 minio 健康**（`curl -sf http://localhost:9000/minio/health/live`）
- [ ] **Step 2: `cd server && go get github.com/minio/minio-go/v7`**
- [ ] **Step 3: 写失败测试**（连不上 MinIO 时 t.Skip，模式同 testDB）：New → PresignPut 返回含 `X-Amz-Signature` 的 URL → 用 `http.Put` 直传一段 bytes → PresignGet 拉回内容一致 → 清理 RemoveObject
- [ ] **Step 4: 实现 storage 包** → 测试 PASS
- [ ] **Step 5: main.go 在 redis 连接后初始化 `storage.New(cfg.MinIO)`（失败 zapLogger.Warn 不 Fatal——本地无 MinIO 时服务仍可跑，files 端点 503）**；router.Setup 签名加 `st *storage.Storage` 参数透传（main 传入，可为 nil）

### Task 3.2: 上传端点 POST /files/upload-url + GET /files/download-url

**Files:**

- Create: `server/internal/handler/file.go`
- Modify: `server/internal/router/router.go`
- Test: `server/internal/handler/file_test.go`（纯 handler 校验逻辑单测：白名单/大小/类别推断，httptest + nil storage 503）

**Interfaces:**

- `POST /api/v1/files/upload-url` body `{filename string, content_type string, size int64}` → 校验 content_type ∈ cfg.Upload.AllowedTypes 否则 400 code=4001 "unsupported file type"；size > cfg.Upload.MaxFileSize 400 code=4002 "file too large"；storage 为 nil 503
  - 响应 `{upload_url, object_key, public_url?, expires_in: 900}`；object_key = `{category}/{2026/07}/{uuid}{ext}`（category：content_type 前缀 image/ → "images"；filename 特判 avatar 由前端走 query `?category=avatars` 显式指定，白名单 categories = images/avatars/files，非法回落 files）；category==="avatars" 时响应带 public_url=`storage.PublicURL(key)`
- `GET /api/v1/files/download-url?key=xxx` → key 必须匹配 `^(images|avatars|files)/[0-9]{4}/[0-9]{2}/[0-9a-f-]+\.[a-z0-9]+$` 否则 400（防任意 key 探测）→ `{url, expires_in: 86400}`
- handler 构造 `NewFileHandler(st *storage.Storage, cfg config.UploadConfig, logger)`；路由挂 `chat` 组（AuthRequired）

- [ ] **Step 1: 写失败测试**（httptest.NewRecorder + gin.CreateTestContext：白名单拒绝、超大小拒绝、nil storage 503、key 正则校验 400）
- [ ] **Step 2: 确认失败** → **Step 3: 实现** → **Step 4: PASS + go vet**

### Task 3.3: 后端 message.send 放行 image content

**Files:**

- Modify: `server/internal/ws/protocol.go`（ContentPayload 扩展）
- Modify: `server/internal/ws/handler.go:131-179`（handleSend 校验分支）
- Modify: `server/internal/service/message_service.go`（SendText → 泛化 Send 或新增 SendImage——取小改：SendText 加参不动，新增 SendContent）
- Test: `server/internal/ws/protocol_test.go` 追加编解码用例

**Interfaces:**

protocol.go ContentPayload 扩展（向后兼容，text 帧不受影响）：

```go
// ContentPayload 是消息体的传输结构（text / image）。
type ContentPayload struct {
	Type   string `json:"type"`
	Text   string `json:"text,omitempty"`
	Key    string `json:"key,omitempty"`    // image: MinIO object key
	Width  int    `json:"width,omitempty"`
	Height int    `json:"height,omitempty"`
	Size   int64  `json:"size,omitempty"`
}
```

service 新增（复用 SendText 骨架，仅 content/messageType 不同）：

```go
// SendContent 持久化任意类型消息（content 为已序列化 JSON）。
func (s *MessageService) SendContent(
	ctx context.Context,
	senderID, convID uuid.UUID,
	messageType int16,
	contentJSON string,
	clientMsgID string,
	replyTo *uuid.UUID,
) (*SendResult, error)
```

（SendText 内部改为构造 JSON 后调 SendContent，消重复。）

handleSend 校验改为：

```go
	switch p.Content.Type {
	case "text":
		if p.Content.Text == "" || len([]rune(p.Content.Text)) > maxTextLen {
			c.sendError(400, "text content required (1-4000 chars)", p.ClientMsgID)
			return
		}
	case "image":
		if p.Content.Key == "" || p.Content.Width <= 0 || p.Content.Height <= 0 || p.Content.Size <= 0 {
			c.sendError(400, "image content requires key/width/height/size", p.ClientMsgID)
			return
		}
	default:
		c.sendError(400, "unsupported content type", p.ClientMsgID)
		return
	}
```

image 分支落库：`contentJSON = {"key":…,"width":…,"height":…,"size":…}`（`json.Marshal` 匿名 struct），messageType=model.MessageTypeImage；ReceivePayload.Content 原样回传 p.Content。

- [ ] **Step 1: protocol_test.go 追加 image 帧 Encode/Decode 往返用例（失败）** → **Step 2: 实现** → **Step 3: `go test ./internal/ws/ -v` PASS**

### Task 3.4: 前端 files api + 图片消息发送/展示 + Lightbox

**Files:**

- Create: `packages/shared/src/api/files.ts`
- Modify: `packages/shared/src/store/messageStore.ts`（sendImage + ChatMessage.image 扩展）
- Modify: `packages/shared/src/api/chat.ts`（mapMessage image 分支 + preview「[图片]」）
- Modify: `packages/shared/src/hooks/useChatBootstrap.ts`（receive 帧 image 分支）
- Modify: `packages/ui/src/Composer.tsx`（图片按钮 file input + paste）
- Modify: `packages/ui/src/MessageBubble.tsx`（真实图渲染）
- Create: `packages/ui/src/ImageLightbox.tsx`
- Modify: `packages/ui/src/ChatWindow.tsx`（Lightbox state）
- Test: `packages/shared/src/__tests__/filesApi.test.ts`

**Interfaces:**

```ts
// api/files.ts
export interface UploadTicket {
  uploadUrl: string;
  objectKey: string;
  publicUrl?: string;
}
export async function getUploadUrl(
  filename: string,
  contentType: string,
  size: number,
  category?: "images" | "avatars",
): Promise<UploadTicket>;
export async function uploadToTicket(
  ticket: UploadTicket,
  blob: Blob,
  contentType: string,
): Promise<void>; // fetch PUT 直传，非 2xx 抛错
export async function getDownloadUrl(key: string): Promise<string>; // 内存 Map<key,{url,expiresAt}> 缓存，提前 5 分钟过期重取
export async function compressImage(
  file: Blob,
  maxEdge?: number,
): Promise<{ blob: Blob; width: number; height: number }>; // canvas，默认 2560，gif 原样返回（用 createImageBitmap 不可用时 fallback new Image()——es2019 环境 createImageBitmap Chrome74 支持）
```

- `ChatMessage.image` 类型改为 `{ width: number; height: number; key?: string; localUrl?: string }`（兼容旧 demo 数据 width/height-only）
- `messageStore.sendImage(conversationId: string, file: Blob): Promise<void>`：compressImage → 乐观插入（kind:"image", localUrl: URL.createObjectURL(blob), status:"sending"）→ getUploadUrl(`img.jpg`, blob.type, size) → uploadToTicket → `chatSocket.send("message.send", { content: { type:"image", key, width, height, size }, client_msg_id })` → ack 走既有 applyAck；上传失败 setStatus failed（重试按钮：retrySend 需分支——image 的重试从 localUrl blob 重传，msg 上暂存 `_retryBlob`? 简化：**上传失败直接 failed 且重试执行整个 sendImage 流程重新走**，retrySend 里 kind==="image"&&localUrl 时 fetch(localUrl).then(r=>r.blob()) 重投）
- bootstrap receive 帧：`p.content.type === "image"` 时构造 `kind:"image", image:{key: p.content.key, width, height}`；预览文案 `i18n.t("chat.message.image")`
- MessageBubble image 渲染：盒子尺寸 = width/height 等比缩进 280×280 内；`msg.image.localUrl` 直接 `<img src>`；否则组件内 `useEffect` `getDownloadUrl(key)` → state url → `<img>`（加载失败显示重试小按钮重新 getDownloadUrl）；点击 `onImageClick?.(url)` 冒给 ChatWindow 开 `<ImageLightbox url onClose />`（fixed inset-0 z-50 bg-black/90，img max-h-full max-w-full，点击任意处/Esc 关）
- Composer：ImageIcon ToolButton 接 hidden `<input type="file" accept="image/*">`；textarea onPaste 检查 `e.clipboardData.files[0]` type 前缀 image/ → 同一发送路径；发送调 `useMessageStore.getState().sendImage(activeId, file)`（compact 模式 mobile 也加同一入口——Paperclip 按钮旁）

- [ ] **Step 1: 写失败测试**（filesApi：getUploadUrl 参数拼装/download-url 缓存命中不二次 fetch——两次调用断言 fetch 只 1 次）
- [ ] **Step 2: 确认失败** → **Step 3: 实现 shared 侧** → **Step 4: 实现 UI 侧** → **Step 5: `pnpm test` 全 PASS**

### Task 3.5: 头像上传激活（设置页）

**Files:**

- Modify: `packages/ui/src/ProfileEditView.tsx`（Task 1.5 的占位换真实现）
- Test: 手测为主（E2E 步骤覆盖）

**流程：** Camera 角标点击 → hidden file input（accept="image/\*"）→ `compressImage(file, 512)` → 中心裁方（canvas drawImage 裁剪：取 min(w,h) 居中）→ `getUploadUrl("avatar.jpg", "image/jpeg", size, "avatars")` → uploadToTicket → 拿 ticket.publicUrl → `updateProfile({ avatarUrl: publicUrl })`（authStore action，Task 1.3）→ 头像即时刷新；busy 转圈复用保存按钮 busy state。

- [ ] **Step 1: 实现** → **Step 2: `pnpm --filter @yuanchat/ui typecheck` PASS**

### Task 3.6: 批次 3 收口 — E2E + 文档 + Commit + 全环境清理

- [ ] **Step 1: 全量测试门禁**（同 Task 1.9；MinIO 已 up）
- [ ] **Step 2: E2E 双账号**：Alice 选图发送 → 本端缩略图 sending→sent → Bob 端实时收图、点开 Lightbox；粘贴截图发送；列表预览「[图片]」；Alice 设置页传头像 → Bob 端会话列表 Alice 头像变化（重新拉列表后）；断网/坏 key 的失败重试占位
- [ ] **Step 3: 文档**：
  - 02_CHAT_API.md：files 两端点 + ContentPayload image 说明 + 预签名读权限取舍备注
  - DEVELOPMENT.md：MinIO 启动步骤（compose 已含）、控制台 :9001、真机联调 endpoint 换局域网 IP 备注
  - AGENTS.md：MVP 状态更新（设置页/群聊/撤回/图片 ✅；未做改：语音/文件消息、presence、删好友/黑名单）
- [ ] **Step 4: 一次完整提交 + 合并**

```bash
git add -A
git commit -m "feat(files): 批次3 MinIO 基础设施 + 图片消息 + 头像上传

- MinIO compose 启用 + storage 包（预签名 PUT/GET、avatars 前缀 public-read）
- POST /files/upload-url、GET /files/download-url（白名单/大小/key 正则校验）
- WS message.send 放行 image content（key/width/height/size 校验）
- 前端 canvas 压缩直传、乐观缩略图、Lightbox、粘贴发图、失败重试
- 设置页头像上传激活（512px 中心裁方 → avatars 公开 URL）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"

git checkout dev && git merge --no-ff feature/ui-and-features -m "merge: feature/ui-and-features → dev

界面焕新（设置/资料/聊天细节/Emoji）+ 建群/撤回 + MinIO 图片消息

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push origin dev && git branch -d feature/ui-and-features
```

- [ ] **Step 5: 环境清理（铁律）**：kill go server 与 web dev server 后台任务、`docker compose -f deploy/docker-compose.yml stop`、关闭 Playwright 浏览器页

---

## Self-Review 结论（已核对）

- Spec 覆盖：1.1-1.5（设置/资料/两端点/聊天细节/Emoji）→ Task 1.1-1.8；2.1-2.3 → Task 2.1-2.4；3.1-3.4 → Task 3.1-3.5；每批次门禁 → Task x.9/2.5/3.6。发现并纳入计划的 spec 外必要项：PUT /users/me 不落库 bug（Task 1.1，spec 假设该端点可用）。
- 类型一致性：`fetchMembers/ConversationMember`（1.3→1.6/2.4）、`ProfilePatch/updateProfile`（1.3→1.5/3.5）、`ChatMessage.recalled/createdAtMs`（2.3 内自洽）、`UploadTicket`（3.2 响应 ↔ 3.4 消费：upload_url/object_key/public_url snake→camel 映射在 files.ts 内做）。
- spec 的"插画化空状态"降级为 lucide 图标空状态（未装 svgr，避免为 4 张插画引构建插件）——若用户想要真插画，后续单独加 vite-plugin-svgr。
