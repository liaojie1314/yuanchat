# IM 能力增强迭代实施计划（收尾修复 / 群管理 / 文件语音消息 / Reactions / Presence+通知）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已有 IM 核心（文本/图片消息、建群、撤回、MinIO 直传）之上补齐：上轮 Minor 收尾 + 撤回重新编辑、群管理五操作、文件与语音消息、消息表情回应持久化、真实在线状态与桌面系统通知。

**Architecture:** 全部能力沿既有骨架扩展——REST 端点挂 `server/internal/handler`、业务在 `service`（事务用 `convRepo.DB().Transaction` 先例）、WS 帧在 `ws/protocol.go` 加类型 + handler 推送、前端 `chatSocket ServerFrames` + `useChatBootstrap.wireSocket` 两端同步接线、UI 状态走 Zustand store。文件/语音复用 MinIO 预签名直传（`files/` 前缀）。Presence 用进程内 Hub 在线表（未来换 Redis 不改业务码）。

**Tech Stack:** Go 1.24 + Gin + GORM + gorilla/websocket + MinIO；React 18 + Zustand v5 + Tailwind + lucide-react + react-i18next；vitest + go test（pg :5433 不可达自动 skip）。

## Global Constraints（每个任务隐含遵守）

- Go 工具链：`export PATH=/home/liaojie1314/env/go/go/bin:$PATH GOPATH=/home/liaojie1314/env/go/GOPATH`；go 命令在 `server/` 目录下执行。
- 集成测试连 dev postgres `:5433`（`deploy/docker-compose.yml`），不可达自动 `t.Skip`（复用 `server/internal/service/contact_service_test.go:22` 的 `testDB`）。
- 前端 `apps/desktop/vite.config.ts` 的 `build.target` **必须保持 `es2019`**，禁止引入无法转译的 ES2020+ API（`?.`/`??` 语法可用会被转译；`String.matchAll` 等运行时 API 需确认 Chrome 74 支持）。
- 所有用户可见文案走 `react-i18next`，key 在 `packages/design-system/src/i18n/locales/zh-CN.json` + `en-US.json` **双语同步**（扁平 key，插值格式 `%{name}`）。后端系统消息文本（如「X 创建了群聊」）沿用后端硬编码中文先例，不在此规则内。
- 图标一律 `lucide-react`，禁止内联 `<svg>`。
- 弹窗/菜单圆角用 `rounded-lg`（用户明确偏好，禁 `rounded-2xl` 于新弹窗/菜单）。
- Tailwind surface 只有 `surface-container` / `-low` / `-high`（无 lowest/highest，写错=透明）。
- zustand v5 selector 禁止返回新数组/对象（会无限渲染）。
- 每个文件尽量 ≤300 行；组件 PascalCase、工具 camelCase。
- 文档统一 `docs/`；新端点/帧同步进 `docs/02_CHAT_API.md`（每批次末尾任务负责）。
- **Git 纪律**：单分支 `feature/im-enhancements`（从 dev 切出）。任务内正常 commit；**每批次末尾 squash 为一次完整提交**（`git reset --soft <批次基点> && git add -A && git commit`），批次间不留碎 commit。全部完成后 `merge --no-ff` → dev → push → 删分支。
- 测试全绿才算任务完成；启动的后端/前端/docker 服务在验证后必须关闭。

## 环境与账号（E2E 用）

```bash
# 基础设施
docker compose -f deploy/docker-compose.yml up -d   # pg :5433 / redis :6379 / minio :9000
# 后端（server/ 目录）
go run ./cmd/seed && go run ./cmd/server            # REST :8080 + WS :8081
# 前端
VITE_ENABLE_MOCK=false pnpm --filter @yuanchat/web dev   # :5173
```

测试账号（密码全部 `Test@1234`）：Alice `13800000001`、Bob `13800000002`、Carol `13800000003`（互为好友）。Playwright 登录按钮名 **'登 录'（中间有空格）**。

## 全局门禁命令（每批次末尾执行）

```bash
cd server && export PATH=/home/liaojie1314/env/go/go/bin:$PATH GOPATH=/home/liaojie1314/env/go/GOPATH && go vet ./... && go test ./...
cd <repo根> && pnpm test
cd apps/web && npx tsc --noEmit && cd ../desktop && npx tsc --noEmit
```

## 任务 0：建分支

- [ ] **Step 0.1:** `git checkout dev && git pull && git checkout -b feature/im-enhancements`
- [ ] **Step 0.2:** `git log -1 --format=%H` 记录批次1基点 commit hash（写入 `.superpowers/sdd/progress.md`）

---

# 批次 1：收尾修复 + 撤回重新编辑

### Task 1.1: Toast + ConfirmDialog 基础组件

**Files:**

- Create: `packages/shared/src/store/toastStore.ts`
- Create: `packages/ui/src/Toast.tsx`
- Create: `packages/ui/src/ConfirmDialog.tsx`
- Modify: `packages/shared/src/index.ts`（导出 toastStore）
- Modify: `packages/ui/src/index.ts`（导出两组件）
- Modify: `packages/ui/src/MainLayout.tsx`（挂载 ToastHost）
- Modify: `packages/ui/src/ChatWindow.tsx:143-149`（`window.alert` → toast）
- Modify: `packages/ui/src/CreateGroupModal.tsx:94` 附近（建群失败 toast）
- Modify: `packages/design-system/src/i18n/locales/zh-CN.json` + `en-US.json`
- Test: `packages/shared/src/__tests__/toastStore.test.ts`

**Interfaces:**

- Produces: `showToast(kind: "info" | "error", text: string): void`（模块函数）、`useToastStore`（`{toasts: ToastItem[]; dismiss(id)}`）、`<ToastHost />`、`<ConfirmDialog open title message confirmLabel? danger? onConfirm onCancel />`。后续所有批次的错误提示统一走 `showToast`。

- [ ] **Step 1: 写失败测试** `packages/shared/src/__tests__/toastStore.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { showToast, useToastStore } from "../store/toastStore";

describe("toastStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [] });
  });
  it("show 追加并在 3s 后自动移除", () => {
    showToast("error", "boom");
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].kind).toBe("error");
    vi.advanceTimersByTime(3100);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
  it("dismiss 立即移除", () => {
    showToast("info", "hi");
    const id = useToastStore.getState().toasts[0].id;
    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
```

- [ ] **Step 2:** `pnpm --filter @yuanchat/shared test -- toastStore` → FAIL（模块不存在）
- [ ] **Step 3: 实现** `packages/shared/src/store/toastStore.ts`

```ts
import { create } from "zustand";

export interface ToastItem {
  id: number;
  kind: "info" | "error";
  text: string;
}

interface ToastState {
  toasts: ToastItem[];
  dismiss: (id: number) => void;
}

let seq = 0;
const AUTO_DISMISS_MS = 3000;

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** 全局轻提示：3 秒自动消失，供组件外代码（store/api 回调）直接调用 */
export function showToast(kind: ToastItem["kind"], text: string): void {
  seq += 1;
  const id = seq;
  useToastStore.setState((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
  setTimeout(() => useToastStore.getState().dismiss(id), AUTO_DISMISS_MS);
}
```

在 `packages/shared/src/index.ts` 追加 `export * from "./store/toastStore";`

- [ ] **Step 4:** 测试 PASS
- [ ] **Step 5: ToastHost 组件** `packages/ui/src/Toast.tsx`

```tsx
import { AlertCircle, Info } from "lucide-react";
import { useToastStore } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";

/** 全局 toast 浮层：顶部居中堆叠，MainLayout 挂载一次 */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed top-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            "bg-surface-container-high border-outline-variant animate-fade-in flex items-center gap-2 rounded-lg border px-4 py-2.5 shadow-lg",
            t.kind === "error" ? "text-error" : "text-on-surface",
          )}
        >
          {t.kind === "error" ? <AlertCircle size={16} /> : <Info size={16} />}
          <span className="text-body-md">{t.text}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: ConfirmDialog 组件** `packages/ui/src/ConfirmDialog.tsx`

```tsx
import { useTranslation } from "react-i18next";
import { cn } from "@yuanchat/shared/utils";
import { Button } from "./Button";

/** 通用确认弹窗：danger 模式确认键红色（退群/解散/踢人等破坏性操作用） */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 grid place-items-center bg-black/40"
      onMouseDown={onCancel}
    >
      <div
        className="bg-surface-container-low w-[320px] rounded-lg p-5 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-title-md text-on-surface font-semibold">{title}</h3>
        <p className="text-body-md text-on-surface-variant mt-2">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="text" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button onClick={onConfirm} className={cn(danger && "!bg-error hover:!bg-error/90")}>
            {confirmLabel ?? t("common.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

注：先读 `packages/ui/src/Button.tsx` 确认 variant/className 透传方式，按实际 API 调整（若无 `variant="text"` 用现有次级样式）。两组件在 `packages/ui/src/index.ts` 导出。

- [ ] **Step 7: 接线** — ① `MainLayout.tsx`：两个 return 的根 div 内末尾各加 `<ToastHost />`（或抽到共同外层）。② `ChatWindow.tsx` handleRecall：`window.alert(...)` → `showToast("error", t("chat.message.recallExpired"))`，删除 alert；其余错误分支加 `else showToast("error", t("common.opFailed"))`。③ `CreateGroupModal.tsx` 建群 catch 分支：加 `showToast("error", t("chat.group.createFailed"))`。
- [ ] **Step 8: i18n** — zh-CN.json 追加：`"common.opFailed": "操作失败，请重试"`、`"chat.group.createFailed": "创建群聊失败，请确认成员均为好友"`；en-US.json 对应：`"Operation failed, please retry"`、`"Failed to create group. All members must be your friends"`。
- [ ] **Step 9:** `pnpm test` 全绿 + `npx tsc --noEmit`（apps/web、apps/desktop）
- [ ] **Step 10:** `git add -A && git commit -m "feat(ui): 统一 Toast/ConfirmDialog 组件并替换 alert 与静默失败"`

### Task 1.2: 前端收尾三连（createdAtMs / PNG alpha / blob 清理 + store 重置）

**Files:**

- Modify: `packages/shared/src/hooks/useChatBootstrap.ts`（receive 补 createdAtMs；wireSocket 订阅登出重置；onReconnect 清缓存前 revoke）
- Modify: `packages/shared/src/api/files.ts`（compressImage PNG 保持 PNG 编码）
- Create: `packages/shared/src/store/resetStores.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/__tests__/filesApi.test.ts`（追加）、`packages/shared/src/__tests__/resetStores.test.ts`

**Interfaces:**

- Produces: `resetChatStores(): void`（revoke 全部 localUrl 后把 message/conversation/contact store 重置为初始态）；`outputTypeFor(mime: string): string`（纯函数，png→png 其余→jpeg）。

- [ ] **Step 1: 失败测试** — `filesApi.test.ts` 追加：

```ts
import { outputTypeFor } from "../api/files";

describe("outputTypeFor", () => {
  it("png 保持 png（保 alpha），其余统一 jpeg", () => {
    expect(outputTypeFor("image/png")).toBe("image/png");
    expect(outputTypeFor("image/jpeg")).toBe("image/jpeg");
    expect(outputTypeFor("image/webp")).toBe("image/jpeg");
  });
});
```

`resetStores.test.ts` 新建：

```ts
import { describe, it, expect, vi } from "vitest";
import { resetChatStores } from "../store/resetStores";
import { useMessageStore } from "../store/messageStore";
import { useConversationStore } from "../store/conversationStore";

describe("resetChatStores", () => {
  it("revoke 所有 localUrl 并清空三个 store", () => {
    const revoke = vi.fn();
    vi.stubGlobal("URL", { ...URL, revokeObjectURL: revoke });
    useMessageStore.setState({
      messagesByConv: {
        c1: [
          {
            id: "m1",
            conversationId: "c1",
            kind: "image",
            isSelf: true,
            time: "10:00",
            image: { width: 1, height: 1, localUrl: "blob:x" },
          },
        ],
      },
    });
    useConversationStore.setState({
      conversations: [{ id: "c1", type: "private", name: "x", unreadCount: 0, isMuted: false }],
      activeId: "c1",
    });
    resetChatStores();
    expect(revoke).toHaveBeenCalledWith("blob:x");
    expect(useMessageStore.getState().messagesByConv).toEqual({});
    expect(useConversationStore.getState().conversations).toEqual([]);
    expect(useConversationStore.getState().activeId).toBeNull();
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2:** 跑两个测试 → FAIL
- [ ] **Step 3: 实现** — ① `files.ts`：抽出并导出

```ts
/** 压缩输出 MIME：png 保持 png（canvas 重编码保留 alpha），其余统一 jpeg */
export function outputTypeFor(mime: string): string {
  return mime === "image/png" ? "image/png" : "image/jpeg";
}
```

`compressImage` 中 `canvasToBlob(canvas, "image/jpeg", 0.85)` 改为 `canvasToBlob(canvas, outputTypeFor(file.type), 0.85)`（`cropAvatar` 保持 jpeg 不变——头像统一 jpeg 是有意行为）。

② `packages/shared/src/store/resetStores.ts`：

```ts
import { useContactStore } from "./contactStore";
import { useConversationStore } from "./conversationStore";
import { useMessageStore } from "./messageStore";

/** 登出/切换账号时调用：revoke 全部本地图片 blob 后清空聊天相关 store，防内存泄漏与跨账号数据残留 */
export function resetChatStores(): void {
  revokeAllLocalPreviews();
  useMessageStore.setState({
    messagesByConv: {},
    hasMoreByConv: {},
    typingByConv: {},
    replyingTo: null,
  });
  useConversationStore.setState({ conversations: [], activeId: null, loading: false });
  useContactStore.setState({ friends: [], requests: [] });
}

/** 遍历所有会话消息，撤销未清理的本地 blob 预览 URL */
export function revokeAllLocalPreviews(): void {
  if (typeof URL === "undefined" || !URL.revokeObjectURL) return;
  const byConv = useMessageStore.getState().messagesByConv;
  for (const list of Object.values(byConv)) {
    for (const m of list) {
      if (m.image && m.image.localUrl) URL.revokeObjectURL(m.image.localUrl);
    }
  }
}
```

注意：先读 `contactStore.ts` 的 state 字段名（friends/requests 之外若有 loading 等一并归位初始值）。`index.ts` 导出 `resetStores`。

③ `useChatBootstrap.ts`：

- `wireSocket()` 末尾追加登出订阅（wired 一次性保证不重复）：

```ts
useAuthStore.subscribe((s, prev) => {
  if (prev.isAuthenticated && !s.isAuthenticated) resetChatStores();
});
```

- `"message.receive"` handler 构造 msg 时补一行 `createdAtMs: p.timestamp,`（修复多设备自消息撤回入口隐藏问题）。
- `chatSocket.onReconnect` 中 `useMessageStore.setState({ messagesByConv: {}, ... })` 之前加 `revokeAllLocalPreviews();`。

- [ ] **Step 4:** 测试 PASS；`pnpm test` 全量不回归（messageStore 既有测试若受 receive 字段影响则同步断言）
- [ ] **Step 5:** `git add -A && git commit -m "fix(chat): receive 补 createdAtMs、PNG 压缩保 alpha、登出/重连回收图片 blob 并重置 store"`

### Task 1.3: 后端 GetProfile 对已删用户回 404

**Files:**

- Modify: `server/internal/handler/user.go:126-131`（GetProfile err 分支）
- Test: 已有 `server/internal/service/user_service_profile_test.go` 覆盖 service 层 ErrUserNotFound；handler 改动以 vet/build + E2E 验证

**Interfaces:**

- Consumes: `service.ErrUserNotFound`（已存在，`user_service.go:22`）

- [ ] **Step 1:** `GetProfile` 的 err 处理改为：

```go
	user, err := h.svc.Profile(c.Request.Context(), userID)
	if err != nil {
		if errors.Is(err, service.ErrUserNotFound) {
			NotFound(c, "user not found")
			return
		}
		h.logger.Error("get profile failed", zap.Error(err))
		InternalError(c, "failed to get profile")
		return
	}
```

（`UpdateProfile` 同样加 ErrUserNotFound→NotFound 分支，消除台账提到的死代码路径。）

- [ ] **Step 2:** `cd server && go vet ./... && go test ./...` 全绿
- [ ] **Step 3:** `git add -A && git commit -m "fix(user): GetProfile/UpdateProfile 对已删用户返回 404 而非 500"`

### Task 1.4: 撤回重新编辑（5 分钟窗口）

**Files:**

- Modify: `packages/shared/src/store/messageStore.ts`（ChatMessage +recalledText/recalledAtMs；applyRecall 保文本；+composerInsert）
- Modify: `packages/ui/src/MessageBubble.tsx`（撤回占位追加「重新编辑」链接）
- Modify: `packages/ui/src/ChatWindow.tsx`（透传 onReEdit）
- Modify: `packages/ui/src/Composer.tsx`（消费 composerInsert）
- Modify: i18n 双语
- Test: `packages/shared/src/__tests__/messageStore.test.ts`（追加）

**Interfaces:**

- Produces: `ChatMessage.recalledText?: string`、`ChatMessage.recalledAtMs?: number`；store action `setComposerInsert(text: string | null)`、state `composerInsert: string | null`；`RE_EDIT_WINDOW_MS = 300_000` 导出常量。
- 行为：**仅本端自己发的 text 消息**在 applyRecall 时把原 text 存入 recalledText（撤回帧不携带原文，对方端自然无此字段）；气泡撤回占位对 `isSelf && recalledText` 显示「重新编辑」，点击时若距 recalledAtMs 超 5 分钟 → toast 过期，否则 `setComposerInsert(recalledText)`；Composer 监听 composerInsert 非空 → 覆盖输入框值 + 聚焦 + 清空该字段。

- [ ] **Step 1: 失败测试** — messageStore.test.ts 追加：

```ts
it("applyRecall 保留自己文本消息原文供重新编辑", () => {
  useMessageStore.setState({
    messagesByConv: {
      c1: [
        {
          id: "m1",
          conversationId: "c1",
          kind: "text",
          isSelf: true,
          text: "hello",
          time: "10:00",
        },
      ],
    },
  });
  useMessageStore.getState().applyRecall("c1", "m1", "我");
  const m = useMessageStore.getState().messagesByConv.c1[0];
  expect(m.recalled).toBe(true);
  expect(m.text).toBeUndefined();
  expect(m.recalledText).toBe("hello");
  expect(typeof m.recalledAtMs).toBe("number");
});

it("applyRecall 对他人消息不保留原文", () => {
  useMessageStore.setState({
    messagesByConv: {
      c1: [
        { id: "m2", conversationId: "c1", kind: "text", isSelf: false, text: "hi", time: "10:00" },
      ],
    },
  });
  useMessageStore.getState().applyRecall("c1", "m2", "对方");
  expect(useMessageStore.getState().messagesByConv.c1[0].recalledText).toBeUndefined();
});

it("setComposerInsert 写入与清空", () => {
  useMessageStore.getState().setComposerInsert("draft");
  expect(useMessageStore.getState().composerInsert).toBe("draft");
  useMessageStore.getState().setComposerInsert(null);
  expect(useMessageStore.getState().composerInsert).toBeNull();
});
```

- [ ] **Step 2:** 跑测试 → FAIL
- [ ] **Step 3: store 实现** — ① `ChatMessage` 接口加：

```ts
  /** 撤回前的原文本（仅本端自己的 text 消息保留，供「重新编辑」回填） */
  recalledText?: string;
  /** 撤回发生时刻（epoch ms），重新编辑 5 分钟窗口判定用 */
  recalledAtMs?: number;
```

② state 加 `composerInsert: string | null`（初始 null）与 `setComposerInsert: (text: string | null) => void`（实现 `set({ composerInsert: text })`）。③ `applyRecall` 的 map 改为：

```ts
[convId]: list.map((m) => {
  if (m.id !== messageId) return m;
  const keepText = m.isSelf && m.kind === "text" && m.text ? m.text : undefined;
  return {
    ...m,
    recalled: true,
    text: undefined,
    ...(keepText ? { recalledText: keepText, recalledAtMs: Date.now() } : {}),
  };
}),
```

④ 导出 `export const RE_EDIT_WINDOW_MS = 5 * 60_000;`

- [ ] **Step 4:** 测试 PASS
- [ ] **Step 5: UI** — ① `MessageBubble.tsx` recalled 分支改为（新增 props `onReEdit?: () => void`）：

```tsx
if (msg.recalled) {
  return (
    <div className="bg-surface-container text-label-md text-on-surface-variant mx-auto my-2.5 flex w-fit items-center gap-1.5 rounded-full px-3 py-1">
      {msg.isSelf
        ? t("chat.message.revokedBySelf")
        : t("chat.message.revokedBy", { name: msg.senderName ?? "" })}
      {msg.isSelf && msg.recalledText && onReEdit && (
        <button onClick={onReEdit} className="text-primary font-medium">
          {t("chat.message.reEdit")}
        </button>
      )}
    </div>
  );
}
```

② `ChatWindow.tsx` MessageBubble 处透传：

```tsx
onReEdit={
  msg.recalled && msg.isSelf && msg.recalledText
    ? () => {
        if (Date.now() - (msg.recalledAtMs ?? 0) > RE_EDIT_WINDOW_MS) {
          showToast("info", t("chat.message.reEditExpired"));
          return;
        }
        useMessageStore.getState().setComposerInsert(msg.recalledText ?? "");
      }
    : undefined
}
```

（`RE_EDIT_WINDOW_MS`、`showToast`、`useMessageStore` 从 `@yuanchat/shared` 导入；窗口判定在事件回调内做，符合 render 纯性约束。）

③ `Composer.tsx`：订阅并消费：

```tsx
const composerInsert = useMessageStore((s) => s.composerInsert);
useEffect(() => {
  if (composerInsert === null) return;
  setValue(composerInsert);
  useMessageStore.getState().setComposerInsert(null);
  requestAnimationFrame(() => textareaRef.current?.focus());
}, [composerInsert]);
```

- [ ] **Step 6: i18n** — zh：`"chat.message.reEdit": "重新编辑"`、`"chat.message.reEditExpired": "超过 5 分钟，无法重新编辑"`；en：`"Re-edit"`、`"Cannot re-edit after 5 minutes"`。
- [ ] **Step 7:** `pnpm test` + 双端 tsc 全绿
- [ ] **Step 8:** `git add -A && git commit -m "feat(chat): 撤回消息 5 分钟内可重新编辑回填输入框"`

### Task 1.5: 批次1 验证 + squash

- [ ] **Step 1:** 全局门禁命令三组全绿（见「全局门禁命令」）
- [ ] **Step 2: E2E 冒烟**（docker up + seed + server + web dev，Playwright）：Alice 登录 → 给 Bob 发一条文本 → 撤回 → 占位出现「重新编辑」→ 点击 → 输入框回填原文并可再发送；Bob 端看到「Alice 撤回了一条消息」无重新编辑入口。建群弹窗选 0 好友直接关闭无异常；断网撤回场景可跳过。验证后 kill dev server 与 go server，`docker compose -f deploy/docker-compose.yml stop`。
- [ ] **Step 3: squash** — `git reset --soft <批次1基点> && git add -A && git commit -m "feat(polish): 统一 Toast/确认弹窗、收尾修复（GetProfile 404/createdAtMs/PNG alpha/blob 回收）与撤回重新编辑"`
- [ ] **Step 4:** `git log -1 --format=%H` 记录为批次2基点，写入台账

# 批次 2：群管理（改名 / 邀请 / 踢人 / 退群 / 解散）

权限模型（role：0 普通 / 1 管理员 / 2 群主，`model.MemberRole*`）：

- 改名：role ≥ 1（当前无设管理员入口，实际即群主）
- 邀请：任意成员，被邀请者须为邀请者好友（与建群一致）
- 踢人：操作者 role > 目标 role（群主可踢所有人，管理员只能踢普通成员，无人可踢群主）
- 退群：非群主成员
- 解散：仅群主（软删会话）

### Task 2.1: 后端群管理 service（五操作 + 集成测试）

**Files:**

- Create: `server/internal/service/conversation_manage.go`
- Create: `server/internal/service/conversation_manage_test.go`
- Modify: `server/internal/repository/conversation_repo.go`（+GetMemberRole/FindByID）

**Interfaces:**

- Produces（供 Task 2.2 handler 调用）：

```go
var (
	ErrConversationNotFound = errors.New("conversation not found")
	ErrNotGroup             = errors.New("not a group conversation")
	ErrForbidden            = errors.New("operation not allowed for this role")
	ErrOwnerCannotLeave     = errors.New("owner cannot leave the group")
	ErrGroupMemberNotFound  = errors.New("member not found")
	ErrInvalidName          = errors.New("invalid group name")
)

// GroupOpResult 群管理操作结果，供 handler 组帧推送。
type GroupOpResult struct {
	SysMsg      *model.Message // 已落库的系统消息（解散时为 nil）
	SysText     string         // 系统消息文本（列表预览/receive 帧用）
	MemberIDs   []uuid.UUID    // 操作后仍在群内的全部成员
	RemovedID   uuid.UUID      // 被踢/退群者（其余操作为 uuid.Nil）
	NewMemberIDs []uuid.UUID   // 邀请新入群者
	NewMemberDTO *ConversationDTO // 新成员视角会话 DTO（仅邀请）
	MemberCount int64
	Name        string         // 操作后群名
}

func (s *ConversationService) RenameGroup(ctx context.Context, operatorID, convID uuid.UUID, name string) (*GroupOpResult, error)
func (s *ConversationService) InviteMembers(ctx context.Context, operatorID, convID uuid.UUID, memberIDs []uuid.UUID) (*GroupOpResult, error)
func (s *ConversationService) KickMember(ctx context.Context, operatorID, convID, targetID uuid.UUID) (*GroupOpResult, error)
func (s *ConversationService) LeaveGroup(ctx context.Context, operatorID, convID uuid.UUID) (*GroupOpResult, error)
func (s *ConversationService) DissolveGroup(ctx context.Context, operatorID, convID uuid.UUID) ([]uuid.UUID, error) // 返回原全员（推 conversation.removed）
```

- [ ] **Step 1: repo 辅助方法** — `conversation_repo.go` 追加：

```go
// GetMemberRole 返回成员角色；非成员返回 (0, false, nil)。
func (r *ConversationRepository) GetMemberRole(ctx context.Context, convID, userID uuid.UUID) (int16, bool, error) {
	var m model.ConversationMember
	err := r.db.WithContext(ctx).
		Where("conversation_id = ? AND user_id = ?", convID, userID).First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	return m.Role, true, nil
}

// FindByID 按 ID 查会话（软删过滤），不存在返回 nil。
func (r *ConversationRepository) FindByID(ctx context.Context, id uuid.UUID) (*model.Conversation, error) {
	var conv model.Conversation
	err := r.db.WithContext(ctx).First(&conv, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &conv, err
}
```

- [ ] **Step 2: 失败测试** — `conversation_manage_test.go`。fixture：先 grep 本包是否已有好友 fixture（`conversation_create_test.go`），有则复用；无则新增（Contact 双向 accepted 两行 + t.Cleanup Unscoped 删除）。群 fixture 直接调 `svc.CreateGroup`（已被测）。用例（全部走 `testDB(t)`，pg 不可达自动 skip）：

```go
// 每个用例的骨架（以 Rename 为例，其余同构）：
func TestRenameGroupByOwner(t *testing.T) {
	db := testDB(t)
	svc := newConvSvc(db) // NewConversationService(...)，参考 conversation_create_test.go 的构造 helper
	owner := newTestUser(t, db, "mg-owner")
	m1 := newTestUser(t, db, "mg-m1")
	makeFriends(t, db, owner.ID, m1.ID)
	dto, _, err := svc.CreateGroup(context.Background(), owner.ID, nil, []uuid.UUID{m1.ID})
	if err != nil { t.Fatalf("create group: %v", err) }

	res, err := svc.RenameGroup(context.Background(), owner.ID, dto.ID, "新群名")
	if err != nil { t.Fatalf("rename: %v", err) }
	if res.Name != "新群名" { t.Fatalf("got name %q", res.Name) }
	if res.SysMsg == nil || res.SysMsg.MessageType != model.MessageTypeSystem {
		t.Fatal("system message not persisted")
	}
	var conv model.Conversation
	db.First(&conv, "id = ?", dto.ID)
	if conv.Name == nil || *conv.Name != "新群名" { t.Fatal("db name not updated") }
}
```

必须覆盖的断言清单：

1. `TestRenameGroupByOwner`：DB name 更新 + 系统消息落库（type=system、seq 递增）
2. `TestRenameByNormalMemberForbidden`：普通成员 → `ErrForbidden`；非成员 → `ErrNotMember`
3. `TestRenameOnPrivateConvFails`：单聊会话 → `ErrNotGroup`
4. `TestInviteAddsMembersWithReadSeq`：邀请 1 人 → 成员行存在、`last_read_seq == 邀请前 last_seq`（系统消息后未读=1）、系统消息「A 邀请 B 加入了群聊」落库、`NewMemberDTO.UnreadCount==1`
5. `TestInviteNonFriendFails`：`ErrNotAllFriends`；已在群成员被自动剔除、全部已在群 → `ErrNoValidMembers`
6. `TestKickByOwner`：成员行删除、系统消息落库、`RemovedID` 正确
7. `TestKickForbidden`：普通成员踢人 → `ErrForbidden`；任何人踢群主 → `ErrForbidden`；踢不在群者 → `ErrGroupMemberNotFound`
8. `TestLeaveGroup`：成员行删除 + 系统消息；群主退群 → `ErrOwnerCannotLeave`
9. `TestDissolveGroup`：会话 DeletedAt 非空（`db.Unscoped().First` 验证）、返回全员 ID；非群主 → `ErrForbidden`

- [ ] **Step 3:** `cd server && go test ./internal/service/ -run 'TestRename|TestInvite|TestKick|TestLeave|TestDissolve'` → FAIL（未实现）
- [ ] **Step 4: 实现** `conversation_manage.go`。公共前置校验 helper：

```go
// loadGroupAndRole 校验会话存在且为群聊，返回会话与操作者角色。
func (s *ConversationService) loadGroupAndRole(ctx context.Context, convID, operatorID uuid.UUID) (*model.Conversation, int16, error) {
	conv, err := s.convRepo.FindByID(ctx, convID)
	if err != nil {
		return nil, 0, fmt.Errorf("find conversation: %w", err)
	}
	if conv == nil {
		return nil, 0, ErrConversationNotFound
	}
	if conv.Type != model.ConversationTypeGroup {
		return nil, 0, ErrNotGroup
	}
	role, ok, err := s.convRepo.GetMemberRole(ctx, convID, operatorID)
	if err != nil {
		return nil, 0, fmt.Errorf("get member role: %w", err)
	}
	if !ok {
		return nil, 0, ErrNotMember
	}
	return conv, role, nil
}

// appendSystemMessage 在事务内以 operator 身份落一条系统消息（CreateWithSeq 原子分配 seq）。
func appendSystemMessage(ctx context.Context, tx *gorm.DB, convID, operatorID uuid.UUID, text string) (*model.Message, error) {
	content, err := json.Marshal(model.MessageContentText{Text: text})
	if err != nil {
		return nil, err
	}
	msg := &model.Message{
		ConversationID: convID,
		SenderID:       operatorID,
		MessageType:    model.MessageTypeSystem,
		Content:        string(content),
		Status:         model.MessageStatusNormal,
	}
	return msg, repository.NewMessageRepository(tx).CreateWithSeq(ctx, msg)
}
```

各操作要点（事务均用 `s.convRepo.DB().WithContext(ctx).Transaction`，模式对照 `CreateGroup`）：

- **RenameGroup**：`strings.TrimSpace` 后空或 rune>100 → `ErrInvalidName`；role<Admin → `ErrForbidden`；tx 内 `tx.Model(&model.Conversation{}).Where("id = ?", convID).Update("name", name)` + 系统消息 `"%s 修改群名为「%s」"`（operator 昵称经 userRepo.FindByID）；结果带 MemberIDs（GetMemberIDs）。
- **InviteMembers**：去重 + 剔除已在群成员（查 GetMemberIDs 建 set）；剩余为空 → `ErrNoValidMembers`；逐个 `contactRepo.IsFriend(operator, id)` 不满足 → `ErrNotAllFriends`；tx 内：读 `conv.LastSeq` 快照 → 为每个新成员建 `ConversationMember{Role: Normal, JoinedAt: now, LastReadSeq: 快照}` → 系统消息 `"%s 邀请 %s 加入了群聊"`（新成员昵称「、」拼接）；NewMemberDTO 按新成员视角组装（`LastSeq=sysMsg.Seq, MyLastReadSeq=sysMsg.Seq-1, UnreadCount=1, Name=*conv.Name, MemberCount=新总数, LastMessage=系统消息摘要`）。
- **KickMember**：目标 role 查询不在群 → `ErrGroupMemberNotFound`；`operatorRole <= targetRole` → `ErrForbidden`（天然涵盖踢群主/平级）；tx 内删成员行（hard delete：`tx.Where(...).Delete(&model.ConversationMember{})`）+ 系统消息 `"%s 将 %s 移出了群聊"`。
- **LeaveGroup**：role==Owner → `ErrOwnerCannotLeave`；tx 内删自己成员行 + 系统消息 `"%s 退出了群聊"`；RemovedID=自己。
- **DissolveGroup**：role!=Owner → `ErrForbidden`；先 GetMemberIDs 存下全员 → `tx.Delete(&model.Conversation{ID: convID})`（gorm 软删）；成员行保留（历史可审计）；返回全员 ID。

- [ ] **Step 5:** 上述测试全 PASS + `go vet ./...`
- [ ] **Step 6:** `git add -A && git commit -m "feat(group): 群管理五操作 service 层（改名/邀请/踢人/退群/解散）"`

### Task 2.2: 后端 handler + WS 帧 + 路由

**Files:**

- Modify: `server/internal/ws/protocol.go`（+2 帧类型）
- Create: `server/internal/handler/conversation_manage.go`（ConversationHandler 的新方法）
- Modify: `server/internal/router/router.go`（+5 路由）

**Interfaces:**

- Produces（前端 Task 2.3 消费的帧）：`conversation.updated` `{conversation_id, name?, member_count?}`、`conversation.removed` `{conversation_id, reason: "kicked"|"left"|"dissolved"}`；系统消息实时下发复用 `message.receive`，`content.type = "system"`。

- [ ] **Step 1: protocol.go** 追加：

```go
	TypeConversationUpdated = "conversation.updated"
	TypeConversationRemoved = "conversation.removed"

// ConversationUpdatedPayload 群资料/成员数变更推送（改名/邀请/踢人/退群后刷新列表态）。
type ConversationUpdatedPayload struct {
	ConversationID uuid.UUID `json:"conversation_id"`
	Name           string    `json:"name,omitempty"`
	MemberCount    int64     `json:"member_count,omitempty"`
}

// ConversationRemovedPayload 会话移出列表推送（被踢 / 本人退群多端同步 / 群解散）。
type ConversationRemovedPayload struct {
	ConversationID uuid.UUID `json:"conversation_id"`
	Reason         string    `json:"reason"` // kicked | left | dissolved
}
```

- [ ] **Step 2: handler** `conversation_manage.go`。统一错误映射：

```go
func (h *ConversationHandler) groupErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrConversationNotFound):
		NotFound(c, "conversation not found")
	case errors.Is(err, service.ErrGroupMemberNotFound):
		NotFound(c, "member not found")
	case errors.Is(err, service.ErrNotGroup), errors.Is(err, service.ErrInvalidName),
		errors.Is(err, service.ErrOwnerCannotLeave), errors.Is(err, service.ErrNoValidMembers):
		BadRequest(c, err.Error())
	case errors.Is(err, service.ErrNotAllFriends):
		Error(c, http.StatusBadRequest, 400, "all members must be your friends")
	case errors.Is(err, service.ErrNotMember), errors.Is(err, service.ErrForbidden):
		Error(c, http.StatusForbidden, 403, err.Error())
	default:
		h.logger.Error("group operation failed", zap.Error(err))
		InternalError(c, "operation failed")
	}
}

// pushSystemReceive 把已落库的系统消息推给成员（content.type=system，前端渲染居中胶囊）。
func (h *ConversationHandler) pushSystemReceive(memberIDs []uuid.UUID, msg *model.Message, text string) {
	frame, err := ws.Encode(ws.TypeMessageReceive, ws.ReceivePayload{
		MessageID:      msg.ID,
		ConversationID: msg.ConversationID,
		SenderID:       msg.SenderID,
		Content:        ws.ContentPayload{Type: "system", Text: text},
		Seq:            msg.Seq,
		Timestamp:      msg.CreatedAt.UnixMilli(),
	})
	if err == nil {
		h.dispatcher.SendToUsers(memberIDs, frame)
	}
}

func (h *ConversationHandler) pushUpdated(memberIDs []uuid.UUID, p ws.ConversationUpdatedPayload) {
	if frame, err := ws.Encode(ws.TypeConversationUpdated, p); err == nil {
		h.dispatcher.SendToUsers(memberIDs, frame)
	}
}

func (h *ConversationHandler) pushRemoved(userIDs []uuid.UUID, convID uuid.UUID, reason string) {
	if frame, err := ws.Encode(ws.TypeConversationRemoved, ws.ConversationRemovedPayload{
		ConversationID: convID, Reason: reason,
	}); err == nil {
		h.dispatcher.SendToUsers(userIDs, frame)
	}
}
```

五个端点（每个都先 `GetUserID` + `uuid.Parse(c.Param("id"))`，错误走 groupErr）：

- `Rename`（PATCH `/conversations/:id`，body `{name string binding:"required,max=100"}`）→ svc.RenameGroup → `pushSystemReceive(res.MemberIDs, res.SysMsg, res.SysText)` + `pushUpdated(res.MemberIDs, {ConversationID, Name: res.Name})` → `Success(c, gin.H{"name": res.Name})`
- `Invite`（POST `/conversations/:id/members`，body `{member_ids []uuid binding:"required,min=1,max=100"}`）→ svc.InviteMembers → 新成员推 `conversation.created`（复用 `ws.ConversationCreatedPayload{Conversation: res.NewMemberDTO}`）→ 全员推 systemReceive + `pushUpdated({ConversationID, MemberCount: res.MemberCount})` → `Success(c, gin.H{"member_count": res.MemberCount})`
- `Kick`（DELETE `/conversations/:id/members/:userId`）→ svc.KickMember → `pushRemoved([]uuid.UUID{res.RemovedID}, convID, "kicked")` + 剩余成员 systemReceive + updated(MemberCount) → Success
- `Leave`（POST `/conversations/:id/leave`）→ svc.LeaveGroup → `pushRemoved([自己], convID, "left")`（多端同步）+ 剩余成员 systemReceive + updated → Success
- `Dissolve`（DELETE `/conversations/:id`）→ svc.DissolveGroup → `pushRemoved(全员, convID, "dissolved")` → Success

- [ ] **Step 3: router.go** chat 组内追加：

```go
		chat.PATCH("/conversations/:id", convH.Rename)
		chat.POST("/conversations/:id/members", convH.Invite)
		chat.DELETE("/conversations/:id/members/:userId", convH.Kick)
		chat.POST("/conversations/:id/leave", convH.Leave)
		chat.DELETE("/conversations/:id", convH.Dissolve)
```

- [ ] **Step 4:** `go vet ./... && go test ./...` 全绿
- [ ] **Step 5:** `git add -A && git commit -m "feat(group): 群管理 REST 端点 + conversation.updated/removed 帧推送"`

### Task 2.3: 前端 API / store / socket 接线

**Files:**

- Modify: `packages/shared/src/api/client.ts`（+apiPatch/apiDelete）
- Create: `packages/shared/src/api/groups.ts`
- Modify: `packages/shared/src/store/conversationStore.ts`（+removeConversation）
- Modify: `packages/shared/src/ws/chatSocket.ts`（ServerFrames +2 帧；receive content 无需改）
- Modify: `packages/shared/src/hooks/useChatBootstrap.ts`（+2 handler；receive 支持 system）
- Modify: `packages/shared/src/index.ts`
- Modify: i18n 双语
- Test: `packages/shared/src/__tests__/conversationStore.test.ts`（追加）

**Interfaces:**

- Produces: `renameGroup(convId, name)`、`inviteMembers(convId, memberIds)`、`kickMember(convId, userId)`、`leaveGroup(convId)`、`dissolveGroup(convId)`（groups.ts）；`removeConversation(id: string)`（store）。

- [ ] **Step 1: 失败测试** — conversationStore.test.ts 追加：

```ts
it("removeConversation 移除会话并清空 activeId", () => {
  useConversationStore.setState({
    conversations: [
      { id: "g1", type: "group", name: "群", unreadCount: 0, isMuted: false },
      { id: "c2", type: "private", name: "b", unreadCount: 0, isMuted: false },
    ],
    activeId: "g1",
  });
  useConversationStore.getState().removeConversation("g1");
  expect(useConversationStore.getState().conversations.map((c) => c.id)).toEqual(["c2"]);
  expect(useConversationStore.getState().activeId).toBeNull();
});

it("removeConversation 非活跃会话不影响 activeId", () => {
  useConversationStore.setState({
    conversations: [{ id: "g1", type: "group", name: "群", unreadCount: 0, isMuted: false }],
    activeId: "other",
  });
  useConversationStore.getState().removeConversation("g1");
  expect(useConversationStore.getState().activeId).toBe("other");
});
```

- [ ] **Step 2:** 跑测试 FAIL → 实现 store action：

```ts
  /** 从列表移除会话（被踢/退群/解散）；若正是活跃会话则回到未选中态 */
  removeConversation: (id) =>
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
    })),
```

- [ ] **Step 3: client.ts** 仿 `apiPut` 追加 `apiPatch` / `apiDelete`（DELETE 无 body）。
- [ ] **Step 4: groups.ts**：

```ts
/**
 * 群管理 REST API — 改名 / 邀请 / 踢人 / 退群 / 解散。
 * 成功后列表态统一由 WS 帧（conversation.updated / removed / message.receive[system]）驱动，
 * 此处不做本地乐观更新（与撤回同构，保证多端一致）。
 */
import { apiDelete, apiPatch, apiPost } from "./client";

export async function renameGroup(convId: string, name: string): Promise<void> {
  await apiPatch<{ name: string }>("/api/v1/conversations/" + convId, { name });
}

export async function inviteMembers(convId: string, memberIds: string[]): Promise<void> {
  await apiPost<{ member_count: number }>("/api/v1/conversations/" + convId + "/members", {
    member_ids: memberIds,
  });
}

export async function kickMember(convId: string, userId: string): Promise<void> {
  await apiDelete<Record<string, never>>("/api/v1/conversations/" + convId + "/members/" + userId);
}

export async function leaveGroup(convId: string): Promise<void> {
  await apiPost<Record<string, never>>("/api/v1/conversations/" + convId + "/leave", {});
}

export async function dissolveGroup(convId: string): Promise<void> {
  await apiDelete<Record<string, never>>("/api/v1/conversations/" + convId);
}
```

`index.ts` 加 `export * from "./api/groups";`

- [ ] **Step 5: chatSocket ServerFrames** 追加：

```ts
  "conversation.updated": { conversation_id: string; name?: string; member_count?: number };
  "conversation.removed": { conversation_id: string; reason: "kicked" | "left" | "dissolved" };
```

- [ ] **Step 6: bootstrap** — ① 新 handler：

```ts
    "conversation.updated": (p) => {
      const patch: Partial<Conversation> = {};
      if (p.name) patch.name = p.name;
      if (p.member_count) patch.memberCount = p.member_count;
      useConversationStore.getState().updateConversation(p.conversation_id, patch);
    },

    "conversation.removed": (p) => {
      useConversationStore.getState().removeConversation(p.conversation_id);
      if (p.reason === "kicked") showToast("info", i18n.t("chat.group.kickedNotice"));
      else if (p.reason === "dissolved") showToast("info", i18n.t("chat.group.dissolvedNotice"));
    },
```

（`Conversation` 类型与 `showToast` 从既有模块导入。）② `message.receive` handler 支持 system：

```ts
      const isSystem = p.content.type === "system";
      // kind 三分支：system 居中胶囊 / image / text
      kind: isSystem ? "system" : isImage ? "image" : "text",
```

列表预览分支同步：`const preview = conv && conv.type === "group" && !isSelf && !isSystem ? p.sender_nickname + ": " + body : body;`（system 消息不加昵称前缀）。

- [ ] **Step 7: i18n** — zh：`"chat.group.kickedNotice": "你已被移出群聊"`、`"chat.group.dissolvedNotice": "该群聊已解散"`；en：`"You were removed from the group"`、`"The group has been dissolved"`。
- [ ] **Step 8:** `pnpm test` + 双端 tsc 全绿
- [ ] **Step 9:** `git add -A && git commit -m "feat(group): 前端群管理 API 与 updated/removed/system 帧接线"`

### Task 2.4: 群管理 UI（ChatDetail 改名/邀请/退群/解散 + MembersView 踢人/loading）

**Files:**

- Create: `packages/ui/src/InviteMembersModal.tsx`
- Modify: `packages/ui/src/ChatDetail.tsx`
- Modify: `packages/ui/src/MembersView.tsx`
- Modify: `packages/ui/src/ChatScreen.tsx`
- Modify: `packages/ui/src/index.ts`、i18n 双语

**Interfaces:**

- Consumes: Task 2.3 的 groups API、Task 1.1 的 `ConfirmDialog`/`showToast`。
- MembersView 新 props：`{ members, loading?: boolean, myRole: number, selfId: string, onKick?: (userId: string, nickname: string) => void, onBack }`。

- [ ] **Step 1: InviteMembersModal** — 以 `CreateGroupModal.tsx` 为模板裁剪：无群名输入；props `{open, onClose, convId, existingMemberIds: string[]}`；好友列表过滤 `!existingMemberIds.includes(f.id)`；确认按钮调 `inviteMembers(convId, selected)` → 成功 onClose（列表/成员数由帧驱动），失败 `showToast("error", t("detail.inviteFailed"))`。空可选好友时显示 `t("detail.noInvitable")` 空态。圆角 rounded-lg。
- [ ] **Step 2: ChatDetail** — ① 取 `selfId = useAuthStore((s) => s.user?.id ?? "")`，`myRole = members.find((m) => m.userId === selfId)?.role ?? 0`。② 群名行改名（`myRole >= 1` 时名字旁出现 `Pencil size={14}` 按钮）：点击切换 `editingName` state → 内联 `<input maxLength={100}>` + Enter/确认按钮保存 → `renameGroup(conv.id, trimmed)`，失败 toast `t("detail.renameFailed")`，成功由 `conversation.updated` 帧刷新（本地不乐观改）。③ 邀请 QuickAction `onClick={() => setInviteOpen(true)}`，挂 `<InviteMembersModal open convId={conv.id} existingMemberIds={members.map((m) => m.userId)} />`。④ 危险区：`myRole === 2` 显示 `t("detail.dissolveGroup")`（否则 `t("detail.leaveGroup")`），点击弹 `ConfirmDialog danger`（文案 `detail.dissolveConfirm` / `detail.leaveConfirm`），确认后调 `dissolveGroup`/`leaveGroup`，失败 toast；成功由 `conversation.removed` 帧移除会话。
- [ ] **Step 3: MembersView** — 新 props 如上；`loading` 时渲染 3 行骨架（`animate-pulse` 圆头像占位 + 条状文本占位，复用项目骨架屏样式惯例）；每行右侧当 `onKick && myRole > m.role && m.userId !== selfId` 时显示 `UserMinus size={15}` 红色图标按钮 → 本地 `ConfirmDialog`（文案 `t("detail.kickConfirm", { name })`，danger）→ 确认调 `onKick(m.userId, m.nickname)`。
- [ ] **Step 4: ChatScreen** — members 拉取加 `membersLoading` state（fetch 前 true / settle false）传给 MembersView；补 `selfId`、`myRole`（同 ChatDetail 推导，或把 members+selfId 传下由 MembersView 内推导——选前者保持纯展示）；`onKick = (userId) => kickMember(activeId!, userId).then(refetchMembers).catch(() => showToast("error", t("detail.kickFailed")))`，`refetchMembers` 即现有 fetchMembers effect 的手动重跑（抽成函数）。
- [ ] **Step 5: i18n** — zh 追加：`"detail.renameGroup": "修改群名"`、`"detail.renameFailed": "修改群名失败"`、`"detail.inviteTitle": "邀请成员"`、`"detail.inviteFailed": "邀请失败，请确认对方是你的好友"`、`"detail.noInvitable": "没有可邀请的好友"`、`"detail.dissolveGroup": "解散群聊"`、`"detail.dissolveConfirm": "解散后所有成员将被移出，且不可恢复"`、`"detail.leaveConfirm": "确定退出该群组？"`、`"detail.kickMember": "移出群聊"`、`"detail.kickConfirm": "确定将 %{name} 移出群聊？"`、`"detail.kickFailed": "移出失败"`；en 对应补齐（`"Rename group"`、`"Failed to rename"`、`"Invite members"`、`"Invite failed. Members must be your friends"`、`"No friends to invite"`、`"Dissolve group"`、`"All members will be removed. This cannot be undone"`、`"Leave this group?"`、`"Remove from group"`、`"Remove %{name} from the group?"`、`"Failed to remove"`）。
- [ ] **Step 6:** `pnpm test` + 双端 tsc；`git add -A && git commit -m "feat(group): 群管理 UI（改名/邀请/踢人/退群/解散 + 成员列表 loading）"`

### Task 2.5: 批次2 验证 + squash

- [ ] **Step 1:** 全局门禁三组全绿
- [ ] **Step 2: E2E**（Playwright 双上下文 Alice+Bob，Carol 备用）：
  1. Alice 建群（仅 Bob）→ Alice 改名 → Bob 端列表名实时变 + 群内系统消息胶囊
  2. Alice 邀请 Carol → Carol 端（第三上下文或复用）冒出新会话 unread=1；Alice/Bob 端成员数 +1 + 系统消息
  3. Alice 踢 Carol → Carol 端会话消失 + toast「你已被移出群聊」
  4. Bob 退群 → Alice 端系统消息「Bob 退出了群聊」+ 成员数 -1
  5. Alice 解散 → Bob（已退）不受影响，若重建群验证解散后全员会话消失 + toast
  6. 权限负例：Bob（普通成员)via API 直接 PATCH 改名 → 403
     验证后关闭全部服务。
- [ ] **Step 3: 文档** — `docs/02_CHAT_API.md`：REST 表追加 5 个群管理端点（方法/路径/请求体/错误码 400/403/404），WS 帧表追加 `conversation.updated` / `conversation.removed`（reason 枚举）与 `message.receive` 的 `content.type=system` 说明
- [ ] **Step 4: squash** — `git reset --soft <批次2基点> && git add -A && git commit -m "feat(group): 群管理全链路（改名/邀请/踢人/退群/解散，REST+WS 帧+UI）"`
- [ ] **Step 5:** 记录批次3基点 hash 入台账

# 批次 3：文件消息 + 语音消息

复用既有 MinIO 直传链路（`getUploadUrl` → `uploadToTicket` → `message.send` 帧）。文件走 `files/` 前缀（后端 `resolveCategory` 已支持：非 image/\* 自动落 files）；语音同走 `files/`（webm 容器）。

**后端配置前置**：语音 MIME `audio/webm` 不在 `server/config/config.yaml` 的 `upload.allowed_types` 白名单 → 需追加（连同常见办公格式）。

### Task 3.1: 后端 file/voice content 支持

**Files:**

- Modify: `server/config/config.yaml`（allowed_types 追加）
- Modify: `server/internal/ws/protocol.go`（ContentPayload +Name/Duration）
- Modify: `server/internal/ws/handler.go`（buildContent +file/voice 分支）
- Modify: `server/internal/service/conversation_service.go`（previewOf 已有 [文件]/[语音]，确认无需改）
- Test: `server/internal/ws/protocol_test.go`（追加编解码用例）

**Interfaces:**

- Produces: `message.send` / `message.receive` 的 content 支持
  - `{type:"file", key, name, size}`（name 为原始文件名，展示用）
  - `{type:"voice", key, duration, size}`（duration 秒，整数）
- 落库 content JSON 与帧字段一致；`model.MessageTypeFile=3` / `MessageTypeVoice=4` 已存在。

- [ ] **Step 1: config.yaml** allowed_types 追加：

```yaml
- audio/webm
- application/zip
- application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
- application/vnd.openxmlformats-officedocument.presentationml.presentation
```

- [ ] **Step 2: protocol.go** ContentPayload 追加（全 omitempty，不污染既有帧）：

```go
	Name     string `json:"name,omitempty"`     // file: 原始文件名（展示用）
	Duration int    `json:"duration,omitempty"` // voice: 时长（秒）
```

- [ ] **Step 3: 失败测试** — `protocol_test.go` 追加：

```go
func TestEncodeFileContent(t *testing.T) {
	data, err := Encode(TypeMessageReceive, ReceivePayload{
		Content: ContentPayload{Type: "file", Key: "files/2026/07/x.pdf", Name: "报告.pdf", Size: 1024},
	})
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	var env Envelope
	if err := json.Unmarshal(data, &env); err != nil {
		t.Fatalf("unmarshal envelope: %v", err)
	}
	var p ReceivePayload
	if err := json.Unmarshal(env.Payload, &p); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if p.Content.Name != "报告.pdf" || p.Content.Size != 1024 {
		t.Fatalf("file fields lost: %+v", p.Content)
	}
}

func TestEncodeVoiceContentOmitsImageFields(t *testing.T) {
	data, _ := Encode(TypeMessageReceive, ReceivePayload{
		Content: ContentPayload{Type: "voice", Key: "files/2026/07/v.webm", Duration: 12, Size: 2048},
	})
	if bytes.Contains(data, []byte(`"width"`)) || bytes.Contains(data, []byte(`"name"`)) {
		t.Fatalf("omitempty broken: %s", data)
	}
}
```

- [ ] **Step 4:** `go test ./internal/ws/ -run TestEncode` → 第一个用例 FAIL（Name/Duration 字段未加则编译失败，即红）。加字段后 PASS。
- [ ] **Step 5: buildContent** `handler.go` switch 追加两分支（对照 image 分支）：

```go
	case "file":
		if p.Content.Key == "" || p.Content.Name == "" || p.Content.Size <= 0 {
			c.sendError(400, "file content requires key/name/size", p.ClientMsgID)
			return 0, "", false
		}
		if len([]rune(p.Content.Name)) > 255 {
			c.sendError(400, "file name too long", p.ClientMsgID)
			return 0, "", false
		}
		raw, err := json.Marshal(struct {
			Key  string `json:"key"`
			Name string `json:"name"`
			Size int64  `json:"size"`
		}{p.Content.Key, p.Content.Name, p.Content.Size})
		if err != nil {
			c.sendError(400, "invalid file content", p.ClientMsgID)
			return 0, "", false
		}
		return model.MessageTypeFile, string(raw), true
	case "voice":
		if p.Content.Key == "" || p.Content.Duration <= 0 || p.Content.Duration > 60 || p.Content.Size <= 0 {
			c.sendError(400, "voice content requires key/duration(1-60s)/size", p.ClientMsgID)
			return 0, "", false
		}
		raw, err := json.Marshal(struct {
			Key      string `json:"key"`
			Duration int    `json:"duration"`
			Size     int64  `json:"size"`
		}{p.Content.Key, p.Content.Duration, p.Content.Size})
		if err != nil {
			c.sendError(400, "invalid voice content", p.ClientMsgID)
			return 0, "", false
		}
		return model.MessageTypeVoice, string(raw), true
```

- [ ] **Step 6:** `go vet ./... && go test ./...` 全绿
- [ ] **Step 7:** `git add -A && git commit -m "feat(ws): message.send 支持 file/voice content（白名单扩展 + 校验落库）"`

### Task 3.2: 前端文件消息（发送 / 接收 / 下载）

**Files:**

- Modify: `packages/shared/src/store/messageStore.ts`（FilePayload +key/rawSize；+sendFile；retrySend 支持 file）
- Modify: `packages/shared/src/api/chat.ts`（+parseFileContent；mapMessage file 分支；+formatFileMeta 工具）
- Modify: `packages/shared/src/ws/chatSocket.ts`（ServerFrames content +name/duration）
- Modify: `packages/shared/src/hooks/useChatBootstrap.ts`（receive file 分支）
- Modify: `packages/ui/src/Composer.tsx`（Paperclip 接第二个 file input）
- Modify: `packages/ui/src/MessageBubble.tsx`（file 气泡下载按钮接真实下载）
- Modify: i18n 双语
- Test: `packages/shared/src/__tests__/chatApi.test.ts` + `messageStore.test.ts`（追加）

**Interfaces:**

- Produces: `FilePayload` 变为 `{name: string; size: string; ext: string; key?: string; localUrl?: string}`（size 保持展示文案，兼容既有气泡）；`sendFile(conversationId: string, file: File): Promise<void>`；`formatFileMeta(name: string, bytes: number): {size: string; ext: string}`；`parseFileContent(content: string): {key?: string; name: string; size: number}`。
- 下载交互：点击气泡下载按钮 → `getDownloadUrl(key)` → `window.open(url, "_blank")`（预签名 URL 直接触发浏览器下载/预览）。

- [ ] **Step 1: 失败测试** — chatApi.test.ts：

```ts
import { formatFileMeta, parseFileContent } from "../api/chat";

describe("file message mapping", () => {
  it("formatFileMeta 产出可读大小与大写扩展名", () => {
    expect(formatFileMeta("报告.pdf", 3355443)).toEqual({ size: "3.2 MB", ext: "PDF" });
    expect(formatFileMeta("a.tar.gz", 512)).toEqual({ size: "512 B", ext: "GZ" });
    expect(formatFileMeta("noext", 2048)).toEqual({ size: "2.0 KB", ext: "FILE" });
  });
  it("parseFileContent 解析落库 JSON，非法时回退", () => {
    expect(parseFileContent('{"key":"files/2026/07/x.pdf","name":"报告.pdf","size":100}')).toEqual({
      key: "files/2026/07/x.pdf",
      name: "报告.pdf",
      size: 100,
    });
    expect(parseFileContent("broken")).toEqual({ name: "", size: 0 });
  });
});
```

messageStore.test.ts：

```ts
it("sendFile 乐观插入 file 气泡（sending + 本地元数据）", async () => {
  // mock getUploadUrl/uploadToTicket 成功（vi.mock ../api/files，模式对照既有 sendImage 用例）
  const file = new File([new Uint8Array(1024)], "合同.pdf", { type: "application/pdf" });
  await useMessageStore.getState().sendFile("c1", file);
  const m = useMessageStore.getState().messagesByConv.c1[0];
  expect(m.kind).toBe("file");
  expect(m.file?.name).toBe("合同.pdf");
  expect(m.file?.ext).toBe("PDF");
  expect(m.status).toBe("sending");
});
```

（先读既有 messageStore.test.ts 的 sendImage 用例 mock 手法，保持一致；断言按实际 mock 时序调整。）

- [ ] **Step 2:** 跑测试 FAIL
- [ ] **Step 3: chat.ts 实现**

```ts
/** 字节数 → 可读大小文案（B/KB/MB，1 位小数） */
function humanSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/** 文件名 + 字节数 → 气泡展示元数据（扩展名大写，无扩展名回退 FILE） */
export function formatFileMeta(name: string, bytes: number): { size: string; ext: string } {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase() : "FILE";
  return { size: humanSize(bytes), ext };
}

/** content JSON → 文件载荷；非法 JSON 回退空名 */
export function parseFileContent(content: string): { key?: string; name: string; size: number } {
  try {
    const p = JSON.parse(content) as { key?: string; name?: string; size?: number };
    return {
      key: typeof p.key === "string" ? p.key : undefined,
      name: typeof p.name === "string" ? p.name : "",
      size: typeof p.size === "number" ? p.size : 0,
    };
  } catch {
    return { name: "", size: 0 };
  }
}
```

`mapMessage` 加 file 分支：`message_type === 3` 时 `file: (() => { const f = parseFileContent(dto.content); return { ...formatFileMeta(f.name, f.size), name: f.name, key: f.key }; })()`（写成局部变量更清晰，不用 IIFE 也行）。

- [ ] **Step 4: messageStore 实现** — ① `FilePayload` 加 `key?: string; localUrl?: string`。② `sendFile`（对照 `sendImage` 骨架）：无压缩步骤；`URL.createObjectURL(file)` 存 `file.localUrl`（重试用）；乐观 msg `kind:"file", file: {name: file.name, ...formatFileMeta(file.name, file.size), localUrl}`；`dispatchFileSend`：`getUploadUrl(file.name, file.type || "application/octet-stream", file.size)` → `uploadToTicket` → 回写 key → `chatSocket.send("message.send", {content: {type: "file", key, name: file.name, size: file.size}})` → armAckTimeout。注意：后端扩展名校验严格（小写字母数字），`getUploadUrl` 的 filename 传原名——后端 `buildObjectKey` 会 `strings.ToLower(filepath.Ext())`，中文文件名无碍（key 只取扩展名）；无扩展名文件会被 4001 拒 → catch 置 failed 并 `showToast("error", i18n.t("chat.file.unsupported"))`。③ `applyAck` 的 revoke 分支扩展：file 消息 ack 后同样 revoke localUrl（抽 `revokeLocalPreview` 泛化或并列处理 `m.file`）。④ `retrySend` 加 file 分支（从 localUrl fetch blob 重跑，模式对照 image）。⑤ Task 1.2 的 `revokeAllLocalPreviews` 同步遍历 `m.file?.localUrl`。
- [ ] **Step 5: 接线** — ① chatSocket ServerFrames 的 receive content 加 `name?: string; duration?: number;`。② bootstrap receive handler：`p.content.type === "file"` 时 `kind: "file", file: {name: p.content.name ?? "", ...formatFileMeta(p.content.name ?? "", p.content.size ?? 0), key: p.content.key}`；列表预览 body 用 `i18n.t("chat.message.file")`。③ Composer：新增第二个隐藏 input（无 accept 限制），`Paperclip` ToolButton（桌面）与移动端回形针按钮 `onClick` 指向它；`handleAnyFilePick` 里 `file.type.indexOf("image/") === 0 ? sendImageFile(file) : useMessageStore.getState().sendFile(activeId, file)`。④ MessageBubble file 下载按钮：

```tsx
onClick={() => {
  const key = msg.file?.key;
  if (!key) return;
  void getDownloadUrl(key).then((url) => window.open(url, "_blank")).catch(() => showToast("error", t("chat.file.downloadFailed")));
}}
```

- [ ] **Step 6: i18n** — zh：`"chat.file.unsupported": "不支持的文件类型"`、`"chat.file.downloadFailed": "下载失败，请重试"`；en：`"Unsupported file type"`、`"Download failed, please retry"`。
- [ ] **Step 7:** `pnpm test` + 双端 tsc 全绿
- [ ] **Step 8:** `git add -A && git commit -m "feat(chat): 文件消息全链路（直传/气泡/下载/重试）"`

### Task 3.3: 前端语音消息（录制 / 发送 / 播放）

**Files:**

- Create: `packages/shared/src/hooks/useVoiceRecorder.ts`
- Modify: `packages/shared/src/store/messageStore.ts`（VoicePayload +key/localUrl；+sendVoice）
- Modify: `packages/shared/src/api/chat.ts`（+parseVoiceContent；mapMessage voice 分支）
- Modify: `packages/shared/src/hooks/useChatBootstrap.ts`（receive voice 分支）
- Create: `packages/ui/src/VoiceRecorderBar.tsx`
- Modify: `packages/ui/src/Composer.tsx`（Mic 按钮进入录音态）
- Modify: `packages/ui/src/MessageBubble.tsx`（voice 气泡真实播放）
- Modify: i18n 双语
- Test: `packages/shared/src/__tests__/chatApi.test.ts`（parseVoiceContent）

**Interfaces:**

- Produces: `useVoiceRecorder(): {state: "idle"|"recording"|"denied", seconds: number, start(): Promise<void>, stop(): Promise<{blob: Blob; duration: number} | null>, cancel(): void}`（MediaRecorder + `audio/webm`，上限 60s 自动 stop）；`sendVoice(conversationId: string, blob: Blob, duration: number): Promise<void>`；`VoicePayload` 变为 `{seconds: number; wave: number[]; key?: string; localUrl?: string}`。
- 播放：气泡 Play 点击 → key 存在则 `getDownloadUrl` → `new Audio(url).play()`（模块级单例 Audio，播新停旧，播放中图标切 `Pause`）；`wave` 无真实采样，用 `duration` 种子生成固定伪波形（渲染纯函数，不用 Math.random）。
- 兼容性注意：`MediaRecorder` + `audio/webm;codecs=opus` Chrome 49+ 支持，es2019 目标无碍；`navigator.mediaDevices` 需 secure context，桌面 Tauri WebView 与 localhost 均满足。

- [ ] **Step 1: 失败测试** — chatApi.test.ts 追加：

```ts
it("parseVoiceContent 解析 duration/key", () => {
  expect(parseVoiceContent('{"key":"files/2026/07/v.webm","duration":12,"size":100}')).toEqual({
    key: "files/2026/07/v.webm",
    duration: 12,
  });
  expect(parseVoiceContent("bad")).toEqual({ duration: 0 });
});
```

- [ ] **Step 2:** FAIL → 实现 `parseVoiceContent`（模式同 parseFileContent）；`mapMessage` voice 分支：`voice: {seconds: parsed.duration, wave: pseudoWave(parsed.duration), key: parsed.key}`，其中：

```ts
/** duration 为种子生成固定伪波形（12-20 根，高度 6-18px 确定性伪随机） */
export function pseudoWave(duration: number): number[] {
  const bars = Math.min(20, Math.max(12, duration + 8));
  const wave: number[] = [];
  for (let i = 0; i < bars; i++) {
    wave.push(6 + ((i * 7 + duration * 13) % 13));
  }
  return wave;
}
```

- [ ] **Step 3: useVoiceRecorder** —

```ts
/**
 * 语音录制 Hook：MediaRecorder 采集 audio/webm，秒表驱动 UI，60s 自动截断。
 * denied 态：getUserMedia 被拒（无权限/无设备），调用方展示提示。
 */
export function useVoiceRecorder() {
  /* ... */
}
```

实现要点：`start()` 内 `navigator.mediaDevices.getUserMedia({audio: true})` catch → `setState("denied")`；`new MediaRecorder(stream, {mimeType: "audio/webm"})`（`isTypeSupported` 检查，不支持时不带 mimeType 用默认）；`dataavailable` 收 chunks；秒表 `setInterval` 1s 更新 `seconds`，到 60 自动调 `stop()`；`stop()` 返回 `{blob: new Blob(chunks, {type: "audio/webm"}), duration: seconds}`，`duration < 1` 返回 null（太短丢弃）；`stop`/`cancel` 均停 tracks（`stream.getTracks().forEach(t => t.stop())`）与计时器；unmount cleanup 同 cancel。

- [ ] **Step 4: sendVoice** — messageStore 加（对照 sendFile）：乐观 msg `kind:"voice", voice: {seconds: duration, wave: pseudoWave(duration), localUrl}`；上传 `getUploadUrl("voice.webm", "audio/webm", blob.size)` → PUT → `chatSocket.send("message.send", {content: {type: "voice", key, duration, size: blob.size}})` → armAckTimeout；ack revoke localUrl 与 file 同路径。
- [ ] **Step 5: UI** — ① `VoiceRecorderBar.tsx`：props `{onDone: (blob: Blob, duration: number) => void, onCancel: () => void}`；内部用 useVoiceRecorder，mount 即 start；布局：红点脉冲（`animate-pulse bg-error h-2 w-2 rounded-full`）+ `MM:SS` 计时 + 取消（X）/发送（Send）按钮；denied 态显示 `t("chat.voice.denied")` + 关闭按钮。② Composer：`const [recording, setRecording] = useState(false)`；Mic 按钮（桌面 ToolButton 与移动端）`onClick={() => setRecording(true)}`；`recording` 时输入行替换为 `<VoiceRecorderBar onDone={(b, d) => { setRecording(false); if (activeId) void useMessageStore.getState().sendVoice(activeId, b, d); }} onCancel={() => setRecording(false)} />`。③ MessageBubble voice 气泡：Play 按钮接播放（见 Interfaces；`voicePlayer.ts` 模块级单例可直接放 MessageBubble 文件顶部或抽 `packages/ui/src/voicePlayer.ts`，若 MessageBubble 超 300 行则抽出）；「转文字」按钮本轮不实现，保持展示。
- [ ] **Step 6: i18n** — zh：`"chat.voice.recording": "正在录音"`、`"chat.voice.denied": "无法访问麦克风，请检查权限"`、`"chat.voice.tooShort": "说话时间太短"`、`"chat.voice.playFailed": "播放失败"`；en：`"Recording"`、`"Microphone unavailable. Check permissions"`、`"Too short"`、`"Playback failed"`。stop 返回 null 时 toast tooShort。
- [ ] **Step 7:** `pnpm test` + 双端 tsc 全绿
- [ ] **Step 8:** `git add -A && git commit -m "feat(chat): 语音消息（MediaRecorder 录制/直传/气泡播放）"`

### Task 3.4: 批次3 验证 + squash

- [ ] **Step 1:** 全局门禁三组全绿
- [ ] **Step 2: E2E**（Alice+Bob）：
  1. Alice 发一个 PDF（Playwright `setInputFiles` 构造临时 pdf）→ 自己气泡 sending→sent；Bob 实时收到 file 气泡（名字/大小/PDF 徽标正确）→ 点下载按钮 → 拿到预签名 URL 打开（断言新页/请求 200）
  2. 无扩展名文件 → toast「不支持的文件类型」+ 气泡 failed 可重试
  3. 语音：Playwright 授麦克风权限（`browserContext.grantPermissions(["microphone"])` + fake device 启动参数）录 2s 发送 → Bob 收到 voice 气泡 → 点播放无报错；若 CI 无音频设备则验证 denied 提示分支
  4. 刷新页面拉历史：file/voice 气泡正确重建（key 签名下载可用）
     验证后关闭全部服务。
- [ ] **Step 3: 文档** — `docs/02_CHAT_API.md` WS content 表追加 file/voice 字段说明与 60s 语音上限；`docs/DEVELOPMENT.md` 补 allowed_types 变更说明
- [ ] **Step 4: squash** — `git reset --soft <批次3基点> && git add -A && git commit -m "feat(chat): 文件与语音消息全链路（MinIO 直传/气泡/下载/播放）"`
- [ ] **Step 5:** 记录批次4基点 hash 入台账

# 批次 4：消息表情回应（Reactions）持久化

UI 已有聚合展示（MessageBubble 的 reactions 渲染），缺：后端表/端点/帧、前端加回应入口与状态接线。交互：右键菜单加「回应」子行（6 个常用 emoji 快捷条）+ 点击已有回应气泡切换自己的参与态（toggle）。

### Task 4.1: 后端 reactions 表 + service + 端点 + 帧

**Files:**

- Create: `server/internal/model/reaction.go`
- Create: `server/internal/repository/reaction_repo.go`
- Modify: `server/internal/service/message_service.go`（+ToggleReaction；GetHistory 附带聚合）
- Modify: `server/internal/repository/message_repo.go`（ListBefore 后聚合查询）
- Modify: `server/internal/handler/message.go`（+React 端点）
- Modify: `server/internal/ws/protocol.go`（+message.reaction 帧）
- Modify: `server/internal/router/router.go`（+1 路由）
- Modify: `server/cmd/server/main.go` + `server/cmd/seed/main.go` + `service` 测试 testDB（AutoMigrate 追加 `&model.MessageReaction{}`）
- Test: `server/internal/service/message_reaction_test.go`

**Interfaces:**

- Produces:
  - 表 `message_reactions`：`(message_id, user_id, emoji)` 联合唯一
  - REST `POST /api/v1/messages/:id/reactions`，body `{emoji string}` → toggle 语义（有则删、无则加），返回 `{emoji, count, reacted}`
  - WS 帧 `message.reaction`：`{message_id, conversation_id, user_id, emoji, count, reacted}`（推全员，count 为该 emoji 最新总数，reacted 指操作者动作是加是删）
  - 历史消息 DTO：`MessageWithSender` 增加 `Reactions []ReactionAgg`，`ReactionAgg{Emoji string; Count int64; Mine bool}`

- [ ] **Step 1: model** `reaction.go`：

```go
package model

import (
	"time"

	"github.com/google/uuid"
)

// MessageReaction 消息表情回应：一人对一条消息的同一 emoji 至多一条（联合唯一）。
type MessageReaction struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	MessageID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_msg_user_emoji" json:"message_id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_msg_user_emoji" json:"user_id"`
	Emoji     string    `gorm:"type:varchar(16);not null;uniqueIndex:idx_msg_user_emoji" json:"emoji"`
	CreatedAt time.Time `json:"created_at"`
}

func (MessageReaction) TableName() string { return "message_reactions" }
```

AutoMigrate 三处（server main / seed main / service testDB）追加该 model。

- [ ] **Step 2: 失败测试** `message_reaction_test.go`（testDB + newRecallFixture 复用建消息）：

```go
func TestToggleReactionAddThenRemove(t *testing.T) {
	db := testDB(t)
	svc := newMessageSvc(db)
	a := newTestUser(t, db, "rx-a")
	b := newTestUser(t, db, "rx-b")
	msg := newRecallFixture(t, db, a, b)
	ctx := context.Background()

	res, err := svc.ToggleReaction(ctx, b.ID, msg.ID, "👍")
	if err != nil { t.Fatalf("toggle add: %v", err) }
	if !res.Reacted || res.Count != 1 { t.Fatalf("add: %+v", res) }

	res, err = svc.ToggleReaction(ctx, b.ID, msg.ID, "👍")
	if err != nil { t.Fatalf("toggle remove: %v", err) }
	if res.Reacted || res.Count != 0 { t.Fatalf("remove: %+v", res) }
}

func TestToggleReactionValidation(t *testing.T) {
	// 非成员 → ErrNotMember；消息不存在 → ErrMessageNotFound；
	// emoji 空或 rune>8 → ErrInvalidEmoji；已撤回消息 → ErrMessageNotFound（视同不可回应）
}

func TestHistoryCarriesReactions(t *testing.T) {
	// b 对消息回应 👍，a 拉 GetHistory：Reactions=[{👍,1,Mine:false}]；b 拉：Mine:true
}
```

（第二、三个用例按注释写全断言。）

- [ ] **Step 3:** 跑测试 FAIL
- [ ] **Step 4: 实现** — ① `reaction_repo.go`：

```go
// Toggle 有则删无则加，返回 (操作后是否存在, 该 emoji 最新总数, error)。
func (r *ReactionRepository) Toggle(ctx context.Context, messageID, userID uuid.UUID, emoji string) (bool, int64, error) {
	var reacted bool
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		res := tx.Where("message_id = ? AND user_id = ? AND emoji = ?", messageID, userID, emoji).
			Delete(&model.MessageReaction{})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			if err := tx.Create(&model.MessageReaction{
				MessageID: messageID, UserID: userID, Emoji: emoji,
			}).Error; err != nil {
				return err
			}
			reacted = true
		}
		return nil
	})
	if err != nil {
		return false, 0, err
	}
	var count int64
	err = r.db.WithContext(ctx).Model(&model.MessageReaction{}).
		Where("message_id = ? AND emoji = ?", messageID, emoji).Count(&count).Error
	return reacted, count, err
}

// ReactionAgg 单条消息的 emoji 聚合。
type ReactionAgg struct {
	MessageID uuid.UUID `json:"-"`
	Emoji     string    `json:"emoji"`
	Count     int64     `json:"count"`
	Mine      bool      `json:"mine"`
}

// AggregateFor 批量取多条消息的回应聚合（Mine 相对 viewer）。
func (r *ReactionRepository) AggregateFor(ctx context.Context, messageIDs []uuid.UUID, viewerID uuid.UUID) (map[uuid.UUID][]ReactionAgg, error) {
	if len(messageIDs) == 0 {
		return map[uuid.UUID][]ReactionAgg{}, nil
	}
	var rows []ReactionAgg
	err := r.db.WithContext(ctx).
		Table("message_reactions").
		Select("message_id, emoji, count(*) AS count, bool_or(user_id = ?) AS mine", viewerID).
		Where("message_id IN ?", messageIDs).
		Group("message_id, emoji").
		Order("min(created_at)").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID][]ReactionAgg)
	for _, row := range rows {
		out[row.MessageID] = append(out[row.MessageID], row)
	}
	return out, nil
}
```

② `message_service.go`：`MessageService` 构造函数加 `reactionRepo *repository.ReactionRepository` 参数（router/测试构造同步更新）；新增 `ErrInvalidEmoji`；`ToggleReaction`：FindByID → nil 或 `Status != Normal` → ErrMessageNotFound；IsMember 校验；emoji `TrimSpace` 后空或 rune>8 → ErrInvalidEmoji；调 repo.Toggle；返回 `ReactionResult{Message, Emoji, Count, Reacted, MemberIDs}`。③ `GetHistory` 末尾：收集 messageIDs → `AggregateFor(ctx, ids, userID)` → 填充 `MessageWithSender.Reactions`（结构体加 `Reactions []ReactionAgg \`json:"reactions,omitempty" gorm:"-"\``）。

- [ ] **Step 5: 帧与端点** — protocol.go：

```go
	TypeMessageReaction = "message.reaction"

// MessageReactionPayload 表情回应变更推送（推会话全员，含操作者多端）。
type MessageReactionPayload struct {
	MessageID      uuid.UUID `json:"message_id"`
	ConversationID uuid.UUID `json:"conversation_id"`
	UserID         uuid.UUID `json:"user_id"`
	Emoji          string    `json:"emoji"`
	Count          int64     `json:"count"`
	Reacted        bool      `json:"reacted"`
}
```

handler `message.go` 加 `React`（POST `/messages/:id/reactions`，body `{Emoji string \`json:"emoji" binding:"required"\`}`）：调 ToggleReaction → 错误映射（ErrMessageNotFound→404 / ErrNotMember→403 / ErrInvalidEmoji→400）→ 组帧推 MemberIDs → `Success(c, gin.H{"emoji": ..., "count": ..., "reacted": ...})`。router 挂 `chat.POST("/messages/:id/reactions", msgH.React)`。

- [ ] **Step 6:** `go vet ./... && go test ./...` 全绿
- [ ] **Step 7:** `git add -A && git commit -m "feat(reaction): 表情回应持久化（toggle 端点 + 历史聚合 + message.reaction 帧）"`

### Task 4.2: 前端 reactions 接线 + UI

**Files:**

- Modify: `packages/shared/src/api/chat.ts`（+toggleReaction API；MessageDTO/mapMessage +reactions）
- Modify: `packages/shared/src/store/messageStore.ts`（+applyReaction）
- Modify: `packages/shared/src/ws/chatSocket.ts`（+message.reaction 帧类型）
- Modify: `packages/shared/src/hooks/useChatBootstrap.ts`（接 handler）
- Modify: `packages/ui/src/MessageBubble.tsx`（菜单快捷 emoji 条 + 回应气泡点击 toggle）
- Modify: `packages/ui/src/ChatWindow.tsx`（透传 onReact）
- Test: `packages/shared/src/__tests__/messageStore.test.ts`（追加）

**Interfaces:**

- Produces: `toggleReaction(messageId: string, emoji: string): Promise<void>`；store `applyReaction(convId, messageId, emoji, count, mine: boolean | undefined)`——mine 仅当 user_id===self 时按 reacted 更新，他人操作时保持原 mine。
- 快捷条 emoji 固定：`["👍", "❤️", "😂", "😮", "😢", "🎉"]`。

- [ ] **Step 1: 失败测试** — messageStore.test.ts：

```ts
it("applyReaction 新增/更新/清零回应聚合", () => {
  useMessageStore.setState({
    messagesByConv: {
      c1: [
        { id: "m1", conversationId: "c1", kind: "text", isSelf: false, text: "hi", time: "10:00" },
      ],
    },
  });
  const apply = useMessageStore.getState().applyReaction;
  apply("c1", "m1", "👍", 1, true);
  expect(useMessageStore.getState().messagesByConv.c1[0].reactions).toEqual([
    { emoji: "👍", count: 1, mine: true },
  ]);
  apply("c1", "m1", "👍", 2, undefined); // 他人 +1，mine 保持
  expect(useMessageStore.getState().messagesByConv.c1[0].reactions![0]).toEqual({
    emoji: "👍",
    count: 2,
    mine: true,
  });
  apply("c1", "m1", "👍", 0, false); // 自己取消且归零 → 条目移除
  expect(useMessageStore.getState().messagesByConv.c1[0].reactions).toEqual([]);
});
```

- [ ] **Step 2:** FAIL → 实现 `applyReaction`：

```ts
  applyReaction: (convId, messageId, emoji, count, mine) =>
    set((s) => ({
      messagesByConv: {
        ...s.messagesByConv,
        [convId]: (s.messagesByConv[convId] ?? []).map((m) => {
          if (m.id !== messageId) return m;
          const prev = m.reactions ?? [];
          const rest = prev.filter((r) => r.emoji !== emoji);
          const existing = prev.find((r) => r.emoji === emoji);
          if (count <= 0) return { ...m, reactions: rest };
          const nextMine = mine === undefined ? (existing?.mine ?? false) : mine;
          return { ...m, reactions: [...rest, { emoji, count, mine: nextMine }] };
        }),
      },
    })),
```

（保持 emoji 相对顺序可改为 map 原位替换 + 不存在时 push——按测试断言实现。）

- [ ] **Step 3: API 与接线** — ① chat.ts：`MessageDTO` 加 `reactions?: {emoji: string; count: number; mine: boolean}[]`；`mapMessage` 透传 `reactions: dto.reactions`；新增：

```ts
/** 切换自己对消息的某个 emoji 回应（结果由 message.reaction 帧驱动，不乐观更新） */
export async function toggleReaction(messageId: string, emoji: string): Promise<void> {
  await apiPost<{ emoji: string; count: number; reacted: boolean }>(
    "/api/v1/messages/" + messageId + "/reactions",
    { emoji },
  );
}
```

② chatSocket ServerFrames 加 `"message.reaction": {message_id: string; conversation_id: string; user_id: string; emoji: string; count: number; reacted: boolean}`。③ bootstrap handler：

```ts
    "message.reaction": (p) => {
      const selfId = useAuthStore.getState().user?.id ?? "";
      useMessageStore.getState().applyReaction(
        p.conversation_id, p.message_id, p.emoji, p.count,
        p.user_id === selfId ? p.reacted : undefined,
      );
    },
```

- [ ] **Step 4: UI** — ① MessageBubble 新 props `onReact?: (emoji: string) => void`；菜单（`menuOpen` 块）顶部加快捷条：

```tsx
{
  onReact && (
    <div className="border-outline-variant flex gap-0.5 border-b px-1.5 py-1">
      {QUICK_REACTIONS.map((e) => (
        <button
          key={e}
          role="menuitem"
          onClick={() => {
            setMenuOpen(false);
            onReact(e);
          }}
          className="hover:bg-surface-container-low grid h-7 w-7 place-items-center rounded-lg text-base transition-transform active:scale-90"
        >
          {e}
        </button>
      ))}
    </div>
  );
}
```

（`const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🎉"];` 文件顶部；菜单打开条件 `openMenu` 的 early-return 加 `!onReact` 判断。）② 既有回应气泡 onClick：`onReact?.(r.emoji)`（toggle 语义天然成立）。③ ChatWindow 透传：`onReact={msg.recalled || msg.kind === "system" || !msg.seq ? undefined : (emoji) => { void toggleReaction(msg.id, emoji).catch(() => showToast("error", t("common.opFailed"))); }}`（`!msg.seq` 排除未 ack 的乐观消息——其 id 还是 client id，服务端 404）。

- [ ] **Step 5:** `pnpm test` + 双端 tsc 全绿
- [ ] **Step 6:** `git add -A && git commit -m "feat(reaction): 前端回应接线（快捷条/气泡 toggle/实时帧/历史回填）"`

### Task 4.3: 批次4 验证 + squash

- [ ] **Step 1:** 全局门禁三组全绿
- [ ] **Step 2: E2E**：Alice 发消息 → Bob 右键点 👍 → 双端气泡下方出现 `👍 1`（Bob 端高亮 mine）→ Alice 也点 👍 → 双端变 `👍 2` → Bob 再点取消 → `👍 1` 且 Bob 端去高亮 → 刷新页面拉历史，聚合与 mine 正确回填。验证后关服务。
- [ ] **Step 3: 文档** — `docs/02_CHAT_API.md` 追加 reactions 端点与 message.reaction 帧
- [ ] **Step 4: squash** — `git reset --soft <批次4基点> && git add -A && git commit -m "feat(reaction): 消息表情回应持久化全链路"`
- [ ] **Step 5:** 记录批次5基点 hash 入台账

---

# 批次 5：Presence 在线状态 + 桌面系统通知

修复「对方在线这边显示离线」：当前 `Conversation.presence` 无任何真实数据源（仅 demo）。方案：Hub 已天然持有在线表（`clients` map）——包装为 presence 源；上线/下线经 WS 广播给「与我有单聊会话的好友」，登录时前端拉一次快照。进程内实现，接口抽象保留换 Redis 的余地。

### Task 5.1: 后端 presence（Hub 扩展 + 快照端点 + 上下线广播）

**Files:**

- Modify: `server/internal/ws/hub.go`（+OnlineUserIDs / 上下线回调）
- Modify: `server/internal/ws/handler.go`（Register/Unregister 处触发广播）
- Modify: `server/internal/ws/protocol.go`（+presence 帧）
- Modify: `server/internal/repository/contact_repo.go`（+FriendIDs）
- Modify: `server/internal/handler/contact.go`（ListFriends 响应附 online；或独立快照端点——选后者，见下）
- Create: `server/internal/handler/presence.go`
- Modify: `server/internal/router/router.go`
- Test: `server/internal/ws/hub_test.go`（追加）

**Interfaces:**

- Produces:
  - WS 帧 `presence`：`{user_id, online: bool}`（好友上/下线时推给其在线好友）
  - REST `GET /api/v1/presence` → `{online_ids: []uuid}`（我的好友中当前在线者，登录快照）
  - `Hub.SetPresenceNotifier(fn func(userID uuid.UUID, online bool))`：用户**首连**上线 / **末连**下线时回调（多设备去重）
  - `Hub.OnlineFilter(ids []uuid.UUID) []uuid.UUID`：过滤出在线子集
  - `ContactRepository.FriendIDs(ctx, userID) ([]uuid.UUID, error)`

- [ ] **Step 1: 失败测试** — hub_test.go 追加：

```go
func TestHubPresenceNotifyOnFirstAndLast(t *testing.T) {
	hub := NewHub(0, zap.NewNop())
	var events []bool
	hub.SetPresenceNotifier(func(_ uuid.UUID, online bool) { events = append(events, online) })
	uid := uuid.New()
	c1 := &Client{userID: uid, send: make(chan []byte, 1)}
	c2 := &Client{userID: uid, send: make(chan []byte, 1)}
	hub.Register(c1) // 首连 → online
	hub.Register(c2) // 第二设备 → 不触发
	hub.Unregister(c1) // 还剩一连 → 不触发
	hub.Unregister(c2) // 末连 → offline
	if len(events) != 2 || !events[0] || events[1] {
		t.Fatalf("expected [online, offline], got %v", events)
	}
}

func TestHubOnlineFilter(t *testing.T) {
	hub := NewHub(0, zap.NewNop())
	on := uuid.New()
	off := uuid.New()
	hub.Register(&Client{userID: on, send: make(chan []byte, 1)})
	got := hub.OnlineFilter([]uuid.UUID{on, off})
	if len(got) != 1 || got[0] != on {
		t.Fatalf("filter: %v", got)
	}
}
```

（对照既有 hub_test 的 Client 构造方式，缺字段按现状补。）

- [ ] **Step 2:** FAIL → **实现 Hub**：加字段 `presenceNotifier func(uuid.UUID, bool)`；`SetPresenceNotifier` setter；`Register` 成功且 `len(conns)==0`（注册前）时在**锁外**回调 `notifier(uid, true)`（先在锁内记 flag，解锁后调，防死锁）；`Unregister` 删除后 map 项清空时同理回调 false；`OnlineFilter` RLock 遍历。
- [ ] **Step 3: FriendIDs** contact_repo.go（对照 ListFriends 查询裁剪）：

```go
// FriendIDs 返回用户全部好友的用户 ID（presence 广播目标）。
func (r *ContactRepository) FriendIDs(ctx context.Context, userID uuid.UUID) ([]uuid.UUID, error) {
	var ids []uuid.UUID
	err := r.db.WithContext(ctx).
		Model(&model.Contact{}).
		Where("user_id = ? AND status = ? AND deleted_at IS NULL", userID, model.ContactStatusAccepted).
		Pluck("contact_user_id", &ids).Error
	return ids, err
}
```

- [ ] **Step 4: 广播接线** — protocol.go 加 `TypePresence = "presence"` 与 `PresencePayload{UserID uuid.UUID \`json:"user_id"\`; Online bool \`json:"online"\`}`。router.go 在 `wsH := ws.NewHandler(...)` 后：

```go
	hub.SetPresenceNotifier(func(userID uuid.UUID, online bool) {
		// 上下线事件在独立 goroutine 通知好友，不阻塞连接注册路径
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			friendIDs, err := contactRepo.FriendIDs(ctx, userID)
			if err != nil {
				logger.Warn("presence friend lookup failed", zap.Error(err))
				return
			}
			frame, err := ws.Encode(ws.TypePresence, ws.PresencePayload{UserID: userID, Online: online})
			if err != nil {
				return
			}
			hub.SendToUsers(friendIDs, frame)
		}()
	})
```

- [ ] **Step 5: 快照端点** `presence.go`：

```go
// PresenceHandler 在线状态快照端点。
type PresenceHandler struct {
	contactRepo *repository.ContactRepository
	hub         *ws.Hub
	logger      *zap.Logger
}

// Snapshot 返回我的好友中当前在线的用户 ID（登录/重连时拉一次，此后靠 presence 帧增量）。
func (h *PresenceHandler) Snapshot(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		Unauthorized(c, "unauthorized")
		return
	}
	friendIDs, err := h.contactRepo.FriendIDs(c.Request.Context(), userID)
	if err != nil {
		h.logger.Error("presence snapshot failed", zap.Error(err))
		InternalError(c, "failed to load presence")
		return
	}
	Success(c, gin.H{"online_ids": h.hub.OnlineFilter(friendIDs)})
}
```

router：`chat.GET("/presence", presenceH.Snapshot)`（NewPresenceHandler 构造 + wiring）。

- [ ] **Step 6:** `go vet ./... && go test ./...` 全绿（含 -race 跑 ws 包：`go test -race ./internal/ws/`）
- [ ] **Step 7:** `git add -A && git commit -m "feat(presence): Hub 上下线广播 + 好友在线快照端点"`

### Task 5.2: 前端 presence 接线（修「在线显示离线」）

**Files:**

- Modify: `packages/shared/src/store/conversationStore.ts`（+applyPresence）
- Modify: `packages/shared/src/store/contactStore.ts`（+onlineIds set 或 Friend.online——选 conversationStore 为主，contacts 页可后续复用）
- Create: `packages/shared/src/api/presence.ts`
- Modify: `packages/shared/src/ws/chatSocket.ts` + `useChatBootstrap.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/__tests__/conversationStore.test.ts`（追加）

**Interfaces:**

- Produces: `fetchPresence(): Promise<string[]>`；store `applyPresence(userId: string, online: boolean)`（按 `peerId` 匹配单聊会话，写 `presence: "online" | "offline"`）与 `applyPresenceSnapshot(onlineIds: string[])`（全量：命中集合 online，其余单聊 offline）。

- [ ] **Step 1: 失败测试**：

```ts
it("applyPresenceSnapshot 按 peerId 全量刷新单聊在线态", () => {
  useConversationStore.setState({
    conversations: [
      { id: "c1", type: "private", name: "a", unreadCount: 0, isMuted: false, peerId: "u1" },
      { id: "c2", type: "private", name: "b", unreadCount: 0, isMuted: false, peerId: "u2" },
      { id: "g1", type: "group", name: "g", unreadCount: 0, isMuted: false },
    ],
  });
  useConversationStore.getState().applyPresenceSnapshot(["u1"]);
  const convs = useConversationStore.getState().conversations;
  expect(convs.find((c) => c.id === "c1")!.presence).toBe("online");
  expect(convs.find((c) => c.id === "c2")!.presence).toBe("offline");
  expect(convs.find((c) => c.id === "g1")!.presence).toBeUndefined();
});

it("applyPresence 单点更新", () => {
  useConversationStore.setState({
    conversations: [
      {
        id: "c1",
        type: "private",
        name: "a",
        unreadCount: 0,
        isMuted: false,
        peerId: "u1",
        presence: "offline",
      },
    ],
  });
  useConversationStore.getState().applyPresence("u1", true);
  expect(useConversationStore.getState().conversations[0].presence).toBe("online");
});
```

- [ ] **Step 2:** FAIL → 实现两个 action（map conversations，`type === "private" && peerId` 匹配；snapshot 对群聊不动）。
- [ ] **Step 3: api/presence.ts**：

```ts
/** 好友在线快照：登录/重连时拉一次，此后由 presence 帧增量维护 */
import { apiGet } from "./client";

export async function fetchPresence(): Promise<string[]> {
  const data = await apiGet<{ online_ids: string[] }>("/api/v1/presence");
  return data.online_ids || [];
}
```

- [ ] **Step 4: 接线** — ① ServerFrames 加 `presence: {user_id: string; online: boolean}`。② bootstrap handler：`presence: (p) => useConversationStore.getState().applyPresence(p.user_id, p.online)`。③ `useChatBootstrap` 真实模式与 `onReconnect` 中，`loadConversations()` 之后追加 `void fetchPresence().then((ids) => useConversationStore.getState().applyPresenceSnapshot(ids));`（注意 loadConversations 是 async——用 `.then` 串联保证快照落在列表加载之后：`void useConversationStore.getState().loadConversations().then(() => fetchPresence()).then((ids) => ...)`）。
- [ ] **Step 5:** ChatWindow 副标题已按 `conv.presence === "online"` 分支（`ChatWindow.tsx:123`），ConversationList/ChatDetail 已消费 presence——无需 UI 改动，验证即可。
- [ ] **Step 6:** `pnpm test` + 双端 tsc 全绿
- [ ] **Step 7:** `git add -A && git commit -m "feat(presence): 前端在线状态接线（快照+增量帧），修单聊在线显示离线"`

### Task 5.3: 桌面系统通知

**Files:**

- Create: `packages/shared/src/notify.ts`
- Modify: `packages/shared/src/hooks/useChatBootstrap.ts`（receive handler 触发）
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/desktop/src/App.tsx`（启动时注册 Tauri 通知实现 + 请求权限）
- Modify: i18n 双语
- Test: `packages/shared/src/__tests__/notify.test.ts`

**Interfaces:**

- Produces: `setNotifier(fn: (title: string, body: string) => void)`（平台注入；web 端不注册则空操作）、`notifyIncoming(conv: {name: string; isMuted: boolean}, preview: string): void`（守卫：页面聚焦时不打扰、免打扰会话跳过）。
- Tauri 依赖已就绪：`@tauri-apps/plugin-notification` 在 `apps/desktop/package.json`、`notification:default` 在 capabilities、`tauri_plugin_notification` 已注册（`lib.rs`）。

- [ ] **Step 1: 失败测试** `notify.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setNotifier, notifyIncoming, __resetNotifier } from "../notify";

describe("notifyIncoming", () => {
  beforeEach(() => __resetNotifier());
  it("页面失焦且非免打扰时通知", () => {
    const fn = vi.fn();
    setNotifier(fn);
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    notifyIncoming({ name: "Alice", isMuted: false }, "你好");
    expect(fn).toHaveBeenCalledWith("Alice", "你好");
  });
  it("聚焦时不通知", () => {
    const fn = vi.fn();
    setNotifier(fn);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    notifyIncoming({ name: "Alice", isMuted: false }, "你好");
    expect(fn).not.toHaveBeenCalled();
  });
  it("免打扰会话不通知；未注册 notifier 不抛错", () => {
    const fn = vi.fn();
    setNotifier(fn);
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    notifyIncoming({ name: "群", isMuted: true }, "x");
    expect(fn).not.toHaveBeenCalled();
    __resetNotifier();
    expect(() => notifyIncoming({ name: "a", isMuted: false }, "x")).not.toThrow();
  });
});
```

- [ ] **Step 2:** FAIL → 实现 `notify.ts`：

```ts
/**
 * 系统通知抽象：平台在启动时注入实现（桌面端 Tauri notification，web 端不注册=静默）。
 * 守卫集中于此：窗口聚焦不打扰、免打扰会话跳过、正文截断 60 字。
 */
type Notifier = (title: string, body: string) => void;

let notifier: Notifier | null = null;

export function setNotifier(fn: Notifier): void {
  notifier = fn;
}

/** 测试辅助：还原未注册态 */
export function __resetNotifier(): void {
  notifier = null;
}

export function notifyIncoming(conv: { name: string; isMuted: boolean }, preview: string): void {
  if (!notifier || conv.isMuted) return;
  if (typeof document !== "undefined" && document.hasFocus()) return;
  const body = preview.length > 60 ? preview.slice(0, 60) + "…" : preview;
  notifier(conv.name, body);
}
```

- [ ] **Step 3: bootstrap 触发** — `message.receive` handler 非 isSelf 分支（`applyIncoming` 调用旁）加：

```ts
if (conv) notifyIncoming({ name: conv.name, isMuted: conv.isMuted }, preview);
```

- [ ] **Step 4: 桌面注入** — `apps/desktop/src/App.tsx`（认证成功分支或模块启动处，只跑一次）：

```tsx
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { setNotifier } from "@yuanchat/shared";

// 模块级一次性注册：权限就绪后把 Tauri 通知注入 shared 抽象
void (async () => {
  let granted = await isPermissionGranted();
  if (!granted) {
    granted = (await requestPermission()) === "granted";
  }
  if (granted) {
    setNotifier((title, body) => sendNotification({ title, body }));
  }
})();
```

（放 App.tsx 模块顶层、`getCurrentWindow()` 逻辑之外；主窗口守卫不影响——通知注册对子窗口无害，仅主窗口会有 receive 帧。）

- [ ] **Step 5:** `pnpm test` + 双端 tsc 全绿
- [ ] **Step 6:** `git add -A && git commit -m "feat(desktop): 新消息系统通知（Tauri notification 注入 + 聚焦/免打扰守卫）"`

### Task 5.4: 批次5 验证 + squash + 记忆更新

- [ ] **Step 1:** 全局门禁三组全绿（ws 包补 `-race`）
- [ ] **Step 2: E2E**：
  1. Alice、Bob 双上下文都登录 → Alice 单聊窗口副标题显示「在线」、会话列表头像绿点
  2. 关 Bob 上下文（断 WS）→ 数秒内 Alice 端变「离线」
  3. Bob 重新登录 → Alice 端实时变回「在线」；Bob 登录时快照正确（Alice 显示在线）
  4. 桌面通知逻辑用 web 端单测覆盖即可；真实 Tauri 弹通知留给用户手动验证（计划末尾提示）
     验证后关闭全部服务。
- [ ] **Step 3: 文档** — `docs/02_CHAT_API.md`：presence 端点 + presence 帧；`AGENTS.md` MVP 状态段更新
- [ ] **Step 4: squash** — `git reset --soft <批次5基点> && git add -A && git commit -m "feat(presence): 真实在线状态 + 桌面系统通知"`

---

# 收尾：合并与清理

- [ ] **Step 1:** 确认工作树干净、全部门禁最后跑一遍
- [ ] **Step 2:** `git checkout dev && git merge --no-ff feature/im-enhancements -m "merge: IM 能力增强（收尾修复/群管理/文件语音消息/Reactions/Presence+通知）"`
- [ ] **Step 3:** `git push origin dev && git branch -d feature/im-enhancements`
- [ ] **Step 4:** 服务清理：kill 残留 dev server / go server，`docker compose -f deploy/docker-compose.yml stop`
- [ ] **Step 5:** 更新记忆 `chat-backend-integrated.md`（第五轮：新帧 conversation.updated/removed、message.reaction、presence、content.type file/voice/system；notify 抽象注入点；群管理权限模型）+ MEMORY.md 索引行
- [ ] **Step 6:** 提示用户手动验证：真实桌面端跑一次「收到消息弹系统通知」与语音录制（浏览器 fake device 无法覆盖真实麦克风路径）

## 留存决策（本轮明确不做）

- 管理员任命/转让群主（role=1 无入口，踢人权限模型已预留）
- 语音转文字（气泡按钮保持展示态）
- 消息搜索（需 Elasticsearch）、消息本地缓存、删好友/黑名单
- presence 换 Redis（多进程部署时再做，Hub 接口已抽象）
