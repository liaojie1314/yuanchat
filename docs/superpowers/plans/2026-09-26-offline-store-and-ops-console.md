# 离线本地消息库 + 运维概览重构 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让三端断网也能看会话列表与历史消息、离线能发（上线自动补发不重复），并把管理端概览页从 23 个等权方块重构成带趋势图表的分层看板。

**Architecture:** 客户端在 `packages/shared/src/localdb/` 建一层 IndexedDB 投影库（服务端永远是真源，故无冲突合并模型）；WS 帧与增量拉取双写本地，冷启动先渲染本地再后台对账；后端新增 `after_seq` 向后翻页端点补空洞，并用部分唯一索引把发送做成幂等，使离线 outbox 补发不产生重复消息。

**Tech Stack:** IndexedDB（原生 API + Promise 包装，`fake-indexeddb` 做测试替身）· Zustand · React 19 · Go（Gin + GORM + goose 迁移）· 手写 SVG 图表（零图表库）

**Spec:** [`docs/superpowers/specs/2026-09-26-offline-store-and-ops-console-design.md`](../specs/2026-09-26-offline-store-and-ops-console-design.md)

## Global Constraints

来自 AGENTS.md 与 spec，**每个 task 的要求都隐含包含本节**：

- **注释与文档**：所有注释**只能写中文**，禁止写进度/批次信息。所有导出函数/组件/Store/Hook 必须写 JSDoc；Go 所有导出函数/包必须写 godoc。关键并发/事务/错误分支必须注释。**先写注释再写代码**。
- **i18n**：所有用户可见文案**禁止硬编码**，必须走 `react-i18next` 的 `t()`，并在 `packages/design-system/src/i18n/locales/` 的 `zh-CN.json` / `en-US.json` / `ja-JP.json` / `ko-KR.json` **四份全部补齐**。占位符是 **`%{var}`**（Rails 风格，见 `i18n/index.ts` 的 `interpolation.prefix`），写成 `{{var}}` 不会插值。`node scripts/check-i18n.mjs` 会挡下漏翻、写错 key 与死键。
- **ES2019 底线**：不得使用 `?.` / `??` / `||=` / `replaceAll` / `.at()` / `structuredClone` 等 ES2020+ 语法与 API。`vite.config.ts` 的 `build.target` 必须保持 `es2019`（旧 Android WebView 如 Chrome 74 解析期 SyntaxError → 白屏）。
- **圆角上限 `rounded-lg`**（本仓 lg = 16px），禁止 `rounded-xl` / `rounded-2xl`（`rounded-full` 圆形除外）。
- **根字号是 14px**，Tailwind rem 刻度整体缩水 14/16。要精确 px 用方括号任意值（例：`min-h-6` 只有 21px，低于 WCAG 2.5.8 的 24px 触控下限，必须写 `min-h-[24px]`）。
- **源码目录按领域分子文件夹**，禁止在 `packages/ui/src` 等目录平铺堆文件。
- **Commit 规范**：Conventional Commits `<type>(<scope>): <subject>`，**禁止写版本号前缀**（如 `feat(v0.5/A1):`），版本归属由 tag 记录。
- **禁止原生权限弹窗**：不调用 `navigator.storage.persist()`（Firefox 会弹框）。
- **安卓贴顶浮层必须叠 `--safe-area-top`**（原生下发），否则压住系统时间/信号图标。
- **安卓返回键走前端拦截栈**：新增全屏浮层/子页必须 `registerBackInterceptor`，否则按返回被当成「已在标签根页面」而退出应用。
- **测试禁止依赖宿主语言环境**：要固定语言就在 `vi.hoisted()` 里打 `navigator` 桩；本地自测用 `LANG=C.UTF-8 pnpm test` 对齐 CI runner。
- **新增自定义请求头必须同步 `middleware/cors.go`** 的 `Allow-Headers`（浏览器预检不接受通配）。
- **新增服务端 WS 帧必须同时登记进** `contracts/server-frames.golden.json` **与** `ws/golden_server_frames_test.go` 的 `payloadPrototypes`，否则字段集比对测试直接失败。

## Review Focus

以下 5 类输入/失败模式是 spec 隐含要求、但容易在任务分解里漏掉测试的。每条都已把测试指派到拥有该代码的 task：

1. **IndexedDB 完全不可用**（隐私模式 / 企业策略禁用 / 配额为 0）—— 整个应用必须行为如常、不白屏、不报错弹窗，退化成今天的纯内存模式。→ 测试在 **Task 1**。
2. **`after_seq` 恰好等于最新 `seq`**（无新消息）—— 服务端返回空数组 + `has_more=false`，客户端**不能因此清空已渲染的消息**。这是「对账把消息擦掉」的典型写法错误。→ 测试在 **Task 8**（服务端）与 **Task 11**（客户端）。
3. **本地有会话但服务端已解散 / 自己已被踢** —— 联网对账后本地必须**删掉**该会话，否则留下一个点进去就 403 的僵尸会话。→ 测试在 **Task 12**。
4. **outbox 补发途中再次断网** —— 已成功的出队、剩余的留在队列，且**不进入无限重试循环**。→ 测试在 **Task 13**。
5. **同一 `objectKey` 并发两次缓存写入**（两个标签页，或同页两处同时渲染同一张图）—— 幂等覆盖不抛错，且配额账本 `mediaBytesTotal` **不重复累加**。→ 测试在 **Task 5**。

---

## Stage A — 本地库基座（纯数据层，不接业务）

### Task 1: 开库、降级与类型定义

**Files:**

- Create: `packages/shared/src/localdb/types.ts`
- Create: `packages/shared/src/localdb/db.ts`
- Create: `packages/shared/src/localdb/index.ts`
- Modify: `packages/shared/package.json`（加 `fake-indexeddb` devDependency）
- Modify: `packages/shared/vitest.config.ts`（`coverage.exclude` 不变；无需改 environment，见下）
- Test: `packages/shared/src/__tests__/localdb.db.test.ts`

**Interfaces:**

- Consumes: 无（本 task 是基座）
- Produces:
  - `SCHEMA_VERSION: number`（值为 `1`）
  - `dbNameOf(userId: string): string` → `"yuanchat-l1-" + userId`
  - `openLocalDb(userId: string): Promise<IDBDatabase | null>` —— **失败返回 `null`**，调用方据此静默降级
  - `deleteLocalDb(userId: string): Promise<void>`
  - `reqDone<T>(req: IDBRequest<T>): Promise<T>`
  - `txDone(tx: IDBTransaction): Promise<void>`
  - 类型 `LocalConversationRow` / `LocalMessageRow` / `OutboxRow` / `OutboxStatus` / `MediaRow`
  - store 名常量 `STORE_CONVERSATIONS` / `STORE_MESSAGES` / `STORE_OUTBOX` / `STORE_MEDIA` / `STORE_META`

> **贯穿 Stage A 全部 task 的铁律**：在已打开的 IDB 事务里**只能 await `reqDone(...)`**。
> await 任何非 IDB 请求（`fetch` / `setTimeout` / `crypto.subtle`）会让控制权回到事件循环、
> 事务立即提交，后续请求抛 `TransactionInactiveError`。需要网络数据就**先取好再开事务**。

> `packages/shared` 的 vitest environment 是 **`node`**（见 `vitest.config.ts`），没有 IndexedDB。
> 测试用 `fake-indexeddb/auto` 在测试文件顶部 import 即可注入全局 `indexedDB`，**不改 environment**
> （改成 jsdom 会波及该包全部 existing 测试）。

- [ ] **Step 1: 装测试替身**

```bash
pnpm --filter @yuanchat/shared add -D fake-indexeddb@6.2.5
```

- [ ] **Step 2: 写失败测试**

创建 `packages/shared/src/__tests__/localdb.db.test.ts`：

```ts
import "fake-indexeddb/auto";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  SCHEMA_VERSION,
  dbNameOf,
  openLocalDb,
  deleteLocalDb,
  STORE_CONVERSATIONS,
  STORE_MESSAGES,
  STORE_OUTBOX,
  STORE_MEDIA,
  STORE_META,
} from "../localdb";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("localdb/db", () => {
  it("库名按账号隔离", () => {
    expect(dbNameOf("u1")).toBe("yuanchat-l1-u1");
    expect(dbNameOf("u2")).not.toBe(dbNameOf("u1"));
  });

  it("开库建齐 5 个 store 与索引", async () => {
    const db = await openLocalDb("open-all");
    expect(db).not.toBeNull();
    const names = Array.from(db!.objectStoreNames);
    expect(names.sort()).toEqual(
      [STORE_CONVERSATIONS, STORE_MEDIA, STORE_MESSAGES, STORE_META, STORE_OUTBOX].sort(),
    );
    const tx = db!.transaction(STORE_MESSAGES, "readonly");
    expect(Array.from(tx.objectStore(STORE_MESSAGES).indexNames)).toContain("by_conv_seq");
    db!.close();
    await deleteLocalDb("open-all");
  });

  it("schema 版本号为 1", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  // Review Focus 1：IndexedDB 完全不可用时必须静默降级，不抛错
  it("indexedDB 缺失时返回 null 而不抛错", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(openLocalDb("no-idb")).resolves.toBeNull();
  });

  it("open 抛错时返回 null 而不抛错", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new DOMException("blocked by policy", "SecurityError");
      },
    });
    await expect(openLocalDb("policy-blocked")).resolves.toBeNull();
  });

  it("open 触发 onerror 时返回 null", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        const req: Record<string, unknown> = { error: new Error("quota 0") };
        setTimeout(() => {
          (req.onerror as (e: unknown) => void)?.({ target: req });
        }, 0);
        return req;
      },
    });
    await expect(openLocalDb("quota-zero")).resolves.toBeNull();
  });

  it("降级安装（本地版本更高）时删库重建", async () => {
    // 先用未来版本建库，再用当前版本打开：应当删库重建而不是抛 VersionError
    await new Promise<void>((resolve) => {
      const req = indexedDB.open(dbNameOf("downgrade"), SCHEMA_VERSION + 1);
      req.onupgradeneeded = () => req.result.createObjectStore("legacy");
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
    });
    const db = await openLocalDb("downgrade");
    expect(db).not.toBeNull();
    expect(Array.from(db!.objectStoreNames)).not.toContain("legacy");
    expect(Array.from(db!.objectStoreNames)).toContain(STORE_MESSAGES);
    db!.close();
    await deleteLocalDb("downgrade");
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd packages/shared && LANG=C.UTF-8 npx vitest run src/__tests__/localdb.db.test.ts`
Expected: FAIL —— `Failed to resolve import "../localdb"`

- [ ] **Step 4: 写 `types.ts`**

```ts
/**
 * 本地消息库的行类型定义。
 *
 * 会话行刻意镜像既有 `ConversationDTO` 的字段形状（而不是另造一套），
 * 否则每次 DTO 加字段都要在两处同步，必然漂移。
 */

/** outbox 条目的状态机取值 */
export type OutboxStatus = "pending" | "sending" | "failed" | "expired";

/** 会话列表投影行：DTO 快照 + 两个本地水位 */
export interface LocalConversationRow {
  /** 会话 id，即 keyPath */
  id: string;
  /** 服务端 ConversationDTO 原样快照（不解构，避免字段漂移） */
  dto: unknown;
  /**
   * 已**连续**确认到的 seq 水位。语义不是「见过的最大 seq」——
   * 两者混淆会导致空洞被永久跳过，见 advanceWatermark 的注释。
   */
  maxSeq: number;
  /** 清空聊天记录的水位，本地据此删除 seq <= 该值的消息 */
  clearedBeforeSeq: number;
  /** 排序用时间戳（毫秒），对应 by_updated 索引 */
  updatedAt: number;
}

/** 已确认消息行（必有 seq；待发消息在 outbox 而非此处） */
export interface LocalMessageRow {
  /** 服务端 message_id，即 keyPath */
  id: string;
  conversationId: string;
  /** 服务端分配的会话内序号，与 conversationId 组成 by_conv_seq 索引 */
  seq: number;
  /** 服务端 MessageDTO 原样快照 */
  dto: unknown;
  /**
   * 该消息引用的对象存储 key 列表（图片 key / 视频 thumb_key / 语音 key）。
   *
   * 必须在消息行上记着：`message.recalled` 帧只带 message_id 不带 key，
   * 删行时若不知道 key 就无从删除对应 blob，会留下永久孤儿（既占配额，
   * 又能被后续渲染命中，等于撤回没生效）。
   */
  mediaKeys: string[];
}

/** 待发队列行 */
export interface OutboxRow {
  /** 客户端生成的幂等 id，即 keyPath；服务端据此去重 */
  clientMsgId: string;
  conversationId: string;
  /** 原始 message.send 载荷，补发时原样重发（含 client_msg_id） */
  payload: unknown;
  /** 入队时间（毫秒），对应 by_created 索引，补发按它串行 */
  createdAt: number;
  status: OutboxStatus;
  /** 已尝试次数，仅用于诊断与退避，不作为过期判据 */
  attempts: number;
}

/** 媒体缓存行 */
export interface MediaRow {
  /** 对象存储 key，即 keyPath */
  objectKey: string;
  /**
   * 原始字节。**刻意存 ArrayBuffer 而不是 Blob**：部分 WebView 对 Blob 的
   * structured clone 会失败，ArrayBuffer 的支持面广得多。读时重建 Blob。
   */
  buf: ArrayBuffer;
  mimeType: string;
  bytes: number;
  /** 最后访问时间（毫秒），对应 by_access 索引，LRU 淘汰按它升序删 */
  lastAccessAt: number;
}
```

- [ ] **Step 5: 写 `db.ts`**

```ts
/**
 * 本地消息库的开库、升级与 Promise 包装。
 *
 * 设计姿态：**本地库是投影，服务端永远是真源**。因此任何一步失败都只降级、
 * 不向上抛——开库失败即整个 L1 退化成今天的纯内存模式，应用行为不变。
 */

/** 当前 schema 版本；本地版本更高（降级安装）时删库重建 */
export const SCHEMA_VERSION = 1;

export const STORE_CONVERSATIONS = "conversations";
export const STORE_MESSAGES = "messages";
export const STORE_OUTBOX = "outbox";
export const STORE_MEDIA = "media";
export const STORE_META = "meta";

/**
 * 按账号推导库名。一个账号一个库，退出/切号 deleteDatabase 一行清干净
 * （顺带解决多账号的本地存储分层）。
 */
export function dbNameOf(userId: string): string {
  return "yuanchat-l1-" + userId;
}

/** 把 IDBRequest 包成 Promise */
export function reqDone<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 等待事务提交完成（写入后必须等它，否则读可能看不到刚写的数据）。
 *
 * **事务存活的铁律**：IDB 事务在「请求队列空了且控制权回到事件循环」时自动提交。
 * `await reqDone(...)` 的 resolve 发生在微任务里，微任务在本轮事件循环结束前排空，
 * 因此**在同一事务内串 `await reqDone(...)` 再发下一个请求是安全的**。
 *
 * 但 **绝不能在打开的事务里 await 任何非 IDB 请求的东西**（`fetch`、`setTimeout`、
 * `crypto.subtle`……）—— 那会让控制权真正回到事件循环，事务当即提交，
 * 后续请求抛 `TransactionInactiveError`。本计划所有事务内代码都只 await `reqDone`。
 */
export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** 在 upgrade 事务里建齐 store 与索引（幂等：已存在则跳过） */
function createStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(STORE_CONVERSATIONS)) {
    const s = db.createObjectStore(STORE_CONVERSATIONS, { keyPath: "id" });
    s.createIndex("by_updated", "updatedAt");
  }
  if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
    const s = db.createObjectStore(STORE_MESSAGES, { keyPath: "id" });
    // 复合索引：会话内按 seq 翻页的唯一入口
    s.createIndex("by_conv_seq", ["conversationId", "seq"]);
  }
  if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
    const s = db.createObjectStore(STORE_OUTBOX, { keyPath: "clientMsgId" });
    s.createIndex("by_created", "createdAt");
  }
  if (!db.objectStoreNames.contains(STORE_MEDIA)) {
    const s = db.createObjectStore(STORE_MEDIA, { keyPath: "objectKey" });
    s.createIndex("by_access", "lastAccessAt");
  }
  if (!db.objectStoreNames.contains(STORE_META)) {
    db.createObjectStore(STORE_META, { keyPath: "key" });
  }
}

/** 删库；失败静默（库不存在也算成功） */
export function deleteLocalDb(userId: string): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(dbNameOf(userId));
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** 真正执行一次 open，成功返回 db，任何失败返回 null */
function tryOpen(name: string): Promise<IDBDatabase | null> {
  return new Promise<IDBDatabase | null>((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(name, SCHEMA_VERSION);
    } catch {
      // 隐私模式 / 企业策略禁用 IDB 时 open 会直接抛
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => createStores(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

/**
 * 打开本账号的本地库。
 *
 * 失败一律返回 `null`（不抛），调用方据此静默降级为纯内存模式。
 * 本地版本高于 SCHEMA_VERSION（用户装过更新版本又回退）时 open 会报
 * VersionError，此时删库重建——本地库是投影，重建无数据损失。
 */
export async function openLocalDb(userId: string): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined" || indexedDB === null) return null;
  const name = dbNameOf(userId);
  const db = await tryOpen(name);
  if (db !== null) return db;
  // 走到这里可能是降级安装导致的 VersionError：删库重建再试一次
  await deleteLocalDb(userId);
  return tryOpen(name);
}
```

- [ ] **Step 6: 写 `index.ts`**

```ts
/** 本地消息库对外唯一出口。 */
export * from "./types";
export * from "./db";
```

- [ ] **Step 7: 跑测试确认通过**

Run: `cd packages/shared && LANG=C.UTF-8 npx vitest run src/__tests__/localdb.db.test.ts`
Expected: PASS（7 个用例全绿）

- [ ] **Step 8: 类型检查**

Run: `pnpm --filter @yuanchat/shared typecheck`
Expected: 0 错误

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/localdb packages/shared/src/__tests__/localdb.db.test.ts \
        packages/shared/package.json pnpm-lock.yaml
git commit -m "feat(localdb): 本地消息库开库与降级基座"
```

### Task 2: 会话投影读写

**Files:**

- Create: `packages/shared/src/localdb/conversations.ts`
- Modify: `packages/shared/src/localdb/index.ts`（导出新模块）
- Test: `packages/shared/src/__tests__/localdb.conversations.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `openLocalDb` / `reqDone` / `txDone` / `STORE_CONVERSATIONS` / `LocalConversationRow`
- Produces:
  - `putConversations(db: IDBDatabase, rows: LocalConversationRow[]): Promise<void>` —— 批量写，单事务
  - `replaceConversations(db: IDBDatabase, rows: LocalConversationRow[]): Promise<void>` —— **整表替换**（清空后写入，单事务），服务端列表回来时用
  - `listConversations(db: IDBDatabase): Promise<LocalConversationRow[]>` —— 按 `updatedAt` 降序
  - `getConversation(db: IDBDatabase, id: string): Promise<LocalConversationRow | null>`
  - `patchConversation(db: IDBDatabase, id: string, patch: Partial<LocalConversationRow>): Promise<void>` —— 行不存在时 no-op
  - `deleteConversations(db: IDBDatabase, ids: string[]): Promise<void>`

> **`replaceConversations` 必须在一个事务里清空 + 写入**。分两个事务时，中途崩溃会留下
> 空列表——用户看到的是「打开应用会话全没了」，比不落盘更糟。

- [ ] **Step 1: 写失败测试**

创建 `packages/shared/src/__tests__/localdb.conversations.test.ts`：

```ts
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  openLocalDb,
  deleteLocalDb,
  putConversations,
  replaceConversations,
  listConversations,
  getConversation,
  patchConversation,
  deleteConversations,
  type LocalConversationRow,
} from "../localdb";

const USER = "conv-test";
let db: IDBDatabase;

/** 造一行会话投影 */
function row(id: string, updatedAt: number, maxSeq = 0): LocalConversationRow {
  return { id, dto: { id, name: "会话" + id }, maxSeq, clearedBeforeSeq: 0, updatedAt };
}

beforeEach(async () => {
  db = (await openLocalDb(USER))!;
});

afterEach(async () => {
  db.close();
  await deleteLocalDb(USER);
});

describe("localdb/conversations", () => {
  it("批量写入后按 updatedAt 降序读出", async () => {
    await putConversations(db, [row("a", 100), row("b", 300), row("c", 200)]);
    const got = await listConversations(db);
    expect(got.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("按 id 单读，不存在返回 null", async () => {
    await putConversations(db, [row("a", 1)]);
    expect((await getConversation(db, "a"))!.id).toBe("a");
    expect(await getConversation(db, "missing")).toBeNull();
  });

  it("整表替换会清掉不在新列表里的旧会话", async () => {
    await putConversations(db, [row("a", 1), row("b", 2)]);
    await replaceConversations(db, [row("b", 5), row("c", 6)]);
    const got = await listConversations(db);
    expect(got.map((r) => r.id).sort()).toEqual(["b", "c"]);
  });

  it("patch 只改给定字段，其余保留", async () => {
    await putConversations(db, [row("a", 1, 10)]);
    await patchConversation(db, "a", { maxSeq: 42 });
    const got = (await getConversation(db, "a"))!;
    expect(got.maxSeq).toBe(42);
    expect(got.updatedAt).toBe(1);
    expect(got.clearedBeforeSeq).toBe(0);
  });

  it("patch 不存在的行是 no-op，不创建幽灵行", async () => {
    await patchConversation(db, "ghost", { maxSeq: 9 });
    expect(await getConversation(db, "ghost")).toBeNull();
    expect(await listConversations(db)).toHaveLength(0);
  });

  it("批量删除", async () => {
    await putConversations(db, [row("a", 1), row("b", 2), row("c", 3)]);
    await deleteConversations(db, ["a", "c"]);
    expect((await listConversations(db)).map((r) => r.id)).toEqual(["b"]);
  });

  it("空数组写入不抛错", async () => {
    await expect(putConversations(db, [])).resolves.toBeUndefined();
    await expect(deleteConversations(db, [])).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/shared && LANG=C.UTF-8 npx vitest run src/__tests__/localdb.conversations.test.ts`
Expected: FAIL —— `putConversations is not a function`

- [ ] **Step 3: 写 `conversations.ts`**

```ts
/** 会话列表投影的本地读写。 */
import { reqDone, txDone, STORE_CONVERSATIONS } from "./db";
import type { LocalConversationRow } from "./types";

/** 批量写入（按 id 覆盖），单事务。 */
export async function putConversations(
  db: IDBDatabase,
  rows: LocalConversationRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const tx = db.transaction(STORE_CONVERSATIONS, "readwrite");
  const store = tx.objectStore(STORE_CONVERSATIONS);
  for (const r of rows) store.put(r);
  await txDone(tx);
}

/**
 * 整表替换：清空后写入新列表。
 *
 * 清空与写入必须在**同一个事务**里。分两个事务时，崩在中间会留下空列表——
 * 用户看到的是「打开应用会话全没了」，比不落盘更糟。
 */
export async function replaceConversations(
  db: IDBDatabase,
  rows: LocalConversationRow[],
): Promise<void> {
  const tx = db.transaction(STORE_CONVERSATIONS, "readwrite");
  const store = tx.objectStore(STORE_CONVERSATIONS);
  store.clear();
  for (const r of rows) store.put(r);
  await txDone(tx);
}

/** 读全部会话，按 updatedAt 降序（与列表展示顺序一致）。 */
export async function listConversations(db: IDBDatabase): Promise<LocalConversationRow[]> {
  const tx = db.transaction(STORE_CONVERSATIONS, "readonly");
  const idx = tx.objectStore(STORE_CONVERSATIONS).index("by_updated");
  const rows = await reqDone<LocalConversationRow[]>(
    idx.getAll() as IDBRequest<LocalConversationRow[]>,
  );
  // by_updated 索引是升序，列表要最近的在前
  return rows.reverse();
}

/** 按 id 读单行，不存在返回 null。 */
export async function getConversation(
  db: IDBDatabase,
  id: string,
): Promise<LocalConversationRow | null> {
  const tx = db.transaction(STORE_CONVERSATIONS, "readonly");
  const got = await reqDone<LocalConversationRow | undefined>(
    tx.objectStore(STORE_CONVERSATIONS).get(id) as IDBRequest<LocalConversationRow | undefined>,
  );
  return got === undefined ? null : got;
}

/**
 * 局部更新一行。行不存在时是 no-op —— 刻意不创建新行，
 * 否则一个迟到的 conversation.updated 帧会造出只有半截字段的幽灵会话。
 */
export async function patchConversation(
  db: IDBDatabase,
  id: string,
  patch: Partial<LocalConversationRow>,
): Promise<void> {
  const tx = db.transaction(STORE_CONVERSATIONS, "readwrite");
  const store = tx.objectStore(STORE_CONVERSATIONS);
  const cur = await reqDone<LocalConversationRow | undefined>(
    store.get(id) as IDBRequest<LocalConversationRow | undefined>,
  );
  if (cur !== undefined) store.put({ ...cur, ...patch, id: cur.id });
  await txDone(tx);
}

/** 批量删除。 */
export async function deleteConversations(db: IDBDatabase, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const tx = db.transaction(STORE_CONVERSATIONS, "readwrite");
  const store = tx.objectStore(STORE_CONVERSATIONS);
  for (const id of ids) store.delete(id);
  await txDone(tx);
}
```

- [ ] **Step 4: 导出**

在 `packages/shared/src/localdb/index.ts` 追加：

```ts
export * from "./conversations";
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/shared && LANG=C.UTF-8 npx vitest run src/__tests__/localdb.conversations.test.ts`
Expected: PASS（7 个用例全绿）

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/localdb packages/shared/src/__tests__/localdb.conversations.test.ts
git commit -m "feat(localdb): 会话投影本地读写"
```

---

### Task 3: 消息读写与空洞探测水位

**Files:**

- Create: `packages/shared/src/localdb/messages.ts`
- Modify: `packages/shared/src/localdb/index.ts`
- Test: `packages/shared/src/__tests__/localdb.messages.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `reqDone` / `txDone` / `STORE_MESSAGES` / `LocalMessageRow`；Task 2 的 `getConversation` / `patchConversation`
- Produces:
  - `putMessages(db, rows: LocalMessageRow[]): Promise<void>`
  - `listMessagesDesc(db, convId: string, beforeSeq: number, limit: number): Promise<LocalMessageRow[]>` —— `beforeSeq <= 0` 表示从最新开始；返回 **seq 升序**（与 UI 展示序一致）
  - `maxStoredSeq(db, convId: string): Promise<number>` —— 本地实际存着的最大 seq，无消息返回 0
  - `advanceWatermark(current: number, incomingSeq: number): { next: number; gap: boolean }` —— **纯函数**，无 IO，独立可测

**空洞探测是本计划最容易写错的一处。** `maxSeq` 的语义是「已**连续**确认到的水位」，
不是「见过的最大 seq」。无条件推进会永久跳过空洞：水位一旦跳到 15，`after_seq=15`
就再也补不回 11–14，那几条在本地永远缺失，而用户看不出来（列表连续、只是少了几条）。

- [ ] **Step 1: 写失败测试**

创建 `packages/shared/src/__tests__/localdb.messages.test.ts`：

```ts
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  openLocalDb,
  deleteLocalDb,
  putMessages,
  listMessagesDesc,
  maxStoredSeq,
  advanceWatermark,
  type LocalMessageRow,
} from "../localdb";

const USER = "msg-test";
const CONV = "c1";
let db: IDBDatabase;

/** 造一行消息 */
function msg(seq: number, convId = CONV, mediaKeys: string[] = []): LocalMessageRow {
  return { id: convId + "-" + seq, conversationId: convId, seq, dto: { seq }, mediaKeys };
}

beforeEach(async () => {
  db = (await openLocalDb(USER))!;
});

afterEach(async () => {
  db.close();
  await deleteLocalDb(USER);
});

describe("advanceWatermark（纯函数）", () => {
  it("连续则推进水位", () => {
    expect(advanceWatermark(10, 11)).toEqual({ next: 11, gap: false });
  });

  it("跳号则报空洞且水位不动", () => {
    // 这条断言直接钉住「永久丢空洞」缺陷
    expect(advanceWatermark(10, 15)).toEqual({ next: 10, gap: true });
  });

  it("重复帧不动水位也不报空洞", () => {
    expect(advanceWatermark(10, 9)).toEqual({ next: 10, gap: false });
    expect(advanceWatermark(10, 10)).toEqual({ next: 10, gap: false });
  });

  it("水位为 0 时第一条 seq=1 算连续", () => {
    expect(advanceWatermark(0, 1)).toEqual({ next: 1, gap: false });
  });

  it("水位为 0 时第一条 seq>1 算空洞", () => {
    expect(advanceWatermark(0, 7)).toEqual({ next: 0, gap: true });
  });
});

describe("localdb/messages", () => {
  it("写入后按 seq 升序读出", async () => {
    await putMessages(db, [msg(3), msg(1), msg(2)]);
    const got = await listMessagesDesc(db, CONV, 0, 10);
    expect(got.map((m) => m.seq)).toEqual([1, 2, 3]);
  });

  it("beforeSeq 游标向前翻，取最近 limit 条", async () => {
    await putMessages(db, [msg(1), msg(2), msg(3), msg(4), msg(5)]);
    // beforeSeq=4 → 取 seq<4 的最近 2 条 = [2,3]，升序返回
    expect((await listMessagesDesc(db, CONV, 4, 2)).map((m) => m.seq)).toEqual([2, 3]);
  });

  it("beforeSeq<=0 表示从最新开始", async () => {
    await putMessages(db, [msg(1), msg(2), msg(3)]);
    expect((await listMessagesDesc(db, CONV, 0, 2)).map((m) => m.seq)).toEqual([2, 3]);
  });

  it("按会话隔离，不串会话", async () => {
    await putMessages(db, [msg(1, "c1"), msg(1, "c2"), msg(2, "c2")]);
    expect((await listMessagesDesc(db, "c1", 0, 10)).map((m) => m.id)).toEqual(["c1-1"]);
    expect((await listMessagesDesc(db, "c2", 0, 10)).map((m) => m.seq)).toEqual([1, 2]);
  });

  it("maxStoredSeq 取本地最大 seq，空会话为 0", async () => {
    expect(await maxStoredSeq(db, CONV)).toBe(0);
    await putMessages(db, [msg(5), msg(2)]);
    expect(await maxStoredSeq(db, CONV)).toBe(5);
  });

  it("同 id 重复写入是覆盖而非重复行", async () => {
    await putMessages(db, [msg(1)]);
    await putMessages(db, [{ ...msg(1), dto: { seq: 1, edited: true } }]);
    const got = await listMessagesDesc(db, CONV, 0, 10);
    expect(got).toHaveLength(1);
    expect((got[0].dto as { edited?: boolean }).edited).toBe(true);
  });

  it("空数组写入不抛错", async () => {
    await expect(putMessages(db, [])).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/shared && LANG=C.UTF-8 npx vitest run src/__tests__/localdb.messages.test.ts`
Expected: FAIL —— `advanceWatermark is not a function`

- [ ] **Step 3: 写 `messages.ts`**

```ts
/** 已确认消息的本地读写与水位推进。 */
import { reqDone, txDone, STORE_MESSAGES } from "./db";
import type { LocalMessageRow } from "./types";

/**
 * 按新到达的 seq 推进「已连续确认到」的水位。
 *
 * **水位语义是「连续确认到哪」，不是「见过的最大 seq」。** 两者混淆即引入
 * 一个不可见的数据丢失缺陷：无条件推进后，水位一旦从 10 跳到 15，
 * 后续 `after_seq=15` 就再也补不回 11–14，这几条消息在本地永久缺失，
 * 而用户看不出来——列表是连续的，只是少了几条。
 *
 * @param current 当前水位
 * @param incomingSeq 新到达消息的 seq
 * @returns next 推进后的水位；gap 为 true 表示中间有空洞、调用方须触发 after_seq 补齐
 */
export function advanceWatermark(
  current: number,
  incomingSeq: number,
): { next: number; gap: boolean } {
  if (incomingSeq <= current) return { next: current, gap: false };
  if (incomingSeq === current + 1) return { next: incomingSeq, gap: false };
  return { next: current, gap: true };
}

/** 批量写入消息（按 id 覆盖），单事务。 */
export async function putMessages(db: IDBDatabase, rows: LocalMessageRow[]): Promise<void> {
  if (rows.length === 0) return;
  const tx = db.transaction(STORE_MESSAGES, "readwrite");
  const store = tx.objectStore(STORE_MESSAGES);
  for (const r of rows) store.put(r);
  await txDone(tx);
}

/**
 * 取会话内 seq < beforeSeq 的最近 limit 条，**返回 seq 升序**。
 *
 * 游标语义与服务端 `ListBefore` 对齐（beforeSeq ≤ 0 表示从最新开始），
 * 返回序与 UI 展示序对齐（升序），因此内部用反向游标取完再 reverse。
 */
export async function listMessagesDesc(
  db: IDBDatabase,
  convId: string,
  beforeSeq: number,
  limit: number,
): Promise<LocalMessageRow[]> {
  const upper = beforeSeq > 0 ? beforeSeq - 1 : Number.MAX_SAFE_INTEGER;
  // 下界写成只含会话 id 的**单元素数组**：IDB 的数组键逐元素比较，
  // 相同前缀下短数组永远排在长数组之前，故 [convId] < [convId, 任何 seq]。
  // 这是取前缀区间的惯用写法，比拿 -Infinity 当数值下界稳妥。
  const range = IDBKeyRange.bound([convId], [convId, upper]);
  const tx = db.transaction(STORE_MESSAGES, "readonly");
  const idx = tx.objectStore(STORE_MESSAGES).index("by_conv_seq");
  const out: LocalMessageRow[] = [];
  await new Promise<void>((resolve, reject) => {
    // "prev" 从上界往下走，取够 limit 条即停——避免把整个会话读进内存
    const req = idx.openCursor(range, "prev");
    req.onsuccess = () => {
      const cur = req.result;
      if (cur === null || out.length >= limit) {
        resolve();
        return;
      }
      out.push(cur.value as LocalMessageRow);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
  return out.reverse();
}

/** 本地实际存着的最大 seq（不是水位），无消息返回 0。 */
export async function maxStoredSeq(db: IDBDatabase, convId: string): Promise<number> {
  const newest = await listMessagesDesc(db, convId, 0, 1);
  return newest.length === 0 ? 0 : newest[0].seq;
}
```

- [ ] **Step 4: 导出**

在 `packages/shared/src/localdb/index.ts` 追加：

```ts
export * from "./messages";
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/shared && LANG=C.UTF-8 npx vitest run src/__tests__/localdb.messages.test.ts`
Expected: PASS（13 个用例全绿）

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/localdb packages/shared/src/__tests__/localdb.messages.test.ts
git commit -m "feat(localdb): 消息本地读写与空洞探测水位"
```

---

### Task 4: 统一删除路径与保留窗口淘汰

**Files:**

- Modify: `packages/shared/src/localdb/messages.ts`（追加删除与淘汰）
- Test: `packages/shared/src/__tests__/localdb.retention.test.ts`

**Interfaces:**

- Consumes: Task 3 的 `putMessages` / `listMessagesDesc`；Task 1 的 `STORE_MESSAGES` / `STORE_MEDIA` / `STORE_META`
- Produces:
  - `RETENTION_PER_CONV: number`（值 `500`）
  - `dropMessages(db, ids: string[]): Promise<void>` —— **删消息行 + 删其引用的 blob + 扣减配额账本，单事务**
  - `dropMessagesBelowSeq(db, convId: string, maxSeqInclusive: number): Promise<number>` —— 清空记录用，返回删除条数
  - `pruneConversation(db, convId: string): Promise<number>` —— 保留窗口淘汰，返回删除条数

**这个 task 承载 spec 的三条不可让步不变量。** 核心约束是
**「消息行在，blob 才在」**：`media` store 按 `objectKey` 寻址、与消息生命周期本来解耦，
而 `message.recalled` 帧只带 `message_id`、**不带 objectKey**。若那条消息已被淘汰，
撤回时就无从得知该删哪个 blob → blob 变成永久孤儿（既占配额，又能被后续渲染命中，
**等于撤回没生效**）。因此撤回 / 清空 / 淘汰三条删除路径**必须走同一个 `dropMessages`**。

`pruneConversation` **只在「会话关闭」与「冷启动」两个时机被调用**（接线在 Task 12/14）。
写入即淘汰会在用户正往上翻历史时把刚渲染出来的旧消息删掉，表现为列表在手里跳。

- [ ] **Step 1: 写失败测试**

创建 `packages/shared/src/__tests__/localdb.retention.test.ts`：

```ts
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  openLocalDb,
  deleteLocalDb,
  putMessages,
  listMessagesDesc,
  putMedia,
  getMedia,
  mediaBytesTotal,
  dropMessages,
  dropMessagesBelowSeq,
  pruneConversation,
  RETENTION_PER_CONV,
  type LocalMessageRow,
} from "../localdb";

const USER = "retention-test";
const CONV = "c1";
let db: IDBDatabase;

function msg(seq: number, mediaKeys: string[] = []): LocalMessageRow {
  return { id: CONV + "-" + seq, conversationId: CONV, seq, dto: { seq }, mediaKeys };
}

/** 造 n 字节的 buffer */
function buf(n: number): ArrayBuffer {
  return new ArrayBuffer(n);
}

beforeEach(async () => {
  db = (await openLocalDb(USER))!;
});

afterEach(async () => {
  db.close();
  await deleteLocalDb(USER);
});

describe("保留窗口常量", () => {
  it("每会话保留 500 条", () => {
    expect(RETENTION_PER_CONV).toBe(500);
  });
});

describe("dropMessages —— 行与 blob 同生共死", () => {
  it("删消息行时连带删掉它引用的 blob 并扣减账本", async () => {
    await putMedia(db, "k1", buf(100), "image/jpeg");
    await putMessages(db, [msg(1, ["k1"])]);
    expect(await mediaBytesTotal(db)).toBe(100);

    await dropMessages(db, [CONV + "-1"]);

    expect(await listMessagesDesc(db, CONV, 0, 10)).toHaveLength(0);
    expect(await getMedia(db, "k1")).toBeNull();
    expect(await mediaBytesTotal(db)).toBe(0);
  });

  it("一条消息引用多个 key（视频的 key + thumb_key）时全删", async () => {
    await putMedia(db, "v1", buf(50), "video/mp4");
    await putMedia(db, "t1", buf(20), "image/jpeg");
    await putMessages(db, [msg(1, ["v1", "t1"])]);
    await dropMessages(db, [CONV + "-1"]);
    expect(await getMedia(db, "v1")).toBeNull();
    expect(await getMedia(db, "t1")).toBeNull();
    expect(await mediaBytesTotal(db)).toBe(0);
  });

  it("删不存在的 id 是 no-op，不抛错", async () => {
    await expect(dropMessages(db, ["ghost"])).resolves.toBeUndefined();
  });

  it("空数组不抛错", async () => {
    await expect(dropMessages(db, [])).resolves.toBeUndefined();
  });
});

describe("dropMessagesBelowSeq —— 清空聊天记录水位", () => {
  it("删掉 seq <= 水位的消息与 blob", async () => {
    await putMedia(db, "k1", buf(10), "image/jpeg");
    await putMedia(db, "k3", buf(30), "image/jpeg");
    await putMessages(db, [msg(1, ["k1"]), msg(2), msg(3, ["k3"])]);

    const n = await dropMessagesBelowSeq(db, CONV, 2);

    expect(n).toBe(2);
    expect((await listMessagesDesc(db, CONV, 0, 10)).map((m) => m.seq)).toEqual([3]);
    expect(await getMedia(db, "k1")).toBeNull();
    expect(await getMedia(db, "k3")).not.toBeNull();
    expect(await mediaBytesTotal(db)).toBe(30);
  });

  it("水位为 0 时不删任何东西", async () => {
    await putMessages(db, [msg(1), msg(2)]);
    expect(await dropMessagesBelowSeq(db, CONV, 0)).toBe(0);
    expect(await listMessagesDesc(db, CONV, 0, 10)).toHaveLength(2);
  });
});

describe("pruneConversation —— 保留窗口边界", () => {
  it("499 条不淘汰", async () => {
    await putMessages(
      db,
      Array.from({ length: 499 }, (_, i) => msg(i + 1)),
    );
    expect(await pruneConversation(db, CONV)).toBe(0);
  });

  it("恰好 500 条不淘汰", async () => {
    await putMessages(
      db,
      Array.from({ length: 500 }, (_, i) => msg(i + 1)),
    );
    expect(await pruneConversation(db, CONV)).toBe(0);
  });

  it("501 条淘汰最老的 1 条，留下的是最近 500 条", async () => {
    await putMessages(
      db,
      Array.from({ length: 501 }, (_, i) => msg(i + 1)),
    );
    expect(await pruneConversation(db, CONV)).toBe(1);
    const left = await listMessagesDesc(db, CONV, 0, 1000);
    expect(left).toHaveLength(500);
    expect(left[0].seq).toBe(2);
    expect(left[499].seq).toBe(501);
  });

  it("淘汰走 dropMessages，连带删 blob（撤回后不留孤儿的前提）", async () => {
    await putMedia(db, "old", buf(70), "image/jpeg");
    const rows = Array.from({ length: 501 }, (_, i) => msg(i + 1));
    rows[0] = msg(1, ["old"]);
    await putMessages(db, rows);
    await pruneConversation(db, CONV);
    expect(await getMedia(db, "old")).toBeNull();
    expect(await mediaBytesTotal(db)).toBe(0);
  });

  it("E2EE 占位行同样参与淘汰，不豁免", async () => {
    // 占位行的特征只是 dto 里没有正文，行本身与普通消息一视同仁
    const rows = Array.from({ length: 501 }, (_, i) => ({
      ...msg(i + 1),
      dto: { seq: i + 1, message_type: 7 },
    }));
    await putMessages(db, rows);
    expect(await pruneConversation(db, CONV)).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/shared && LANG=C.UTF-8 npx vitest run src/__tests__/localdb.retention.test.ts`
Expected: FAIL —— `dropMessages is not a function`（`putMedia` 等由 Task 5 提供，本 task 先写 media 侧最小实现，见 Step 3）

> **执行顺序提示**：本 task 的测试同时用到 Task 5 的 `putMedia` / `getMedia` / `mediaBytesTotal`。
> 为保持每个 task 自带可运行闭环，**本 task 先实现这三个函数的最小版本**（无配额淘汰、无
> QuotaExceededError 处理），Task 5 在其上补齐 LRU 与降级。Task 5 不会改这三个函数的签名。

- [ ] **Step 3: 在 `media.ts` 写最小版本**

创建 `packages/shared/src/localdb/media.ts`：

```ts
/**
 * 媒体缓存的本地读写。
 *
 * 本文件在 Task 4 只提供最小读写与配额账本，LRU 淘汰与 QuotaExceededError
 * 三段降级在 Task 5 补齐（签名不变）。
 */
import { reqDone, txDone, STORE_MEDIA, STORE_META } from "./db";
import type { MediaRow } from "./types";

/** 配额账本在 meta store 里的 key */
export const META_MEDIA_BYTES = "mediaBytesTotal";

/**
 * 读配额账本。
 *
 * 账本单独记一行、**不靠遍历 media store 求和**：IDB 无聚合能力，
 * 为算个总量逐行累加几千条 blob 记录在移动端是明显的卡顿源。
 */
export async function mediaBytesTotal(db: IDBDatabase): Promise<number> {
  const tx = db.transaction(STORE_META, "readonly");
  const got = await reqDone<{ key: string; value: number } | undefined>(
    tx.objectStore(STORE_META).get(META_MEDIA_BYTES) as IDBRequest<
      { key: string; value: number } | undefined
    >,
  );
  return got === undefined ? 0 : got.value;
}

/** 在已打开的事务里调整账本（增量维护，正负皆可）。 */
export function bumpBytes(tx: IDBTransaction, delta: number): void {
  const store = tx.objectStore(STORE_META);
  const req = store.get(META_MEDIA_BYTES) as IDBRequest<{ key: string; value: number } | undefined>;
  req.onsuccess = () => {
    const cur = req.result === undefined ? 0 : req.result.value;
    const next = cur + delta;
    store.put({ key: META_MEDIA_BYTES, value: next < 0 ? 0 : next });
  };
}

/**
 * 写入一份媒体缓存。
 *
 * 同 objectKey 重复写入是**幂等覆盖**：账本按「新字节数 - 旧字节数」调整，
 * 不重复累加（两个标签页或同页两处同时渲染同一张图会真实触发这条路径）。
 */
export async function putMedia(
  db: IDBDatabase,
  objectKey: string,
  bufData: ArrayBuffer,
  mimeType: string,
): Promise<void> {
  const tx = db.transaction([STORE_MEDIA, STORE_META], "readwrite");
  const store = tx.objectStore(STORE_MEDIA);
  const prev = await reqDone<MediaRow | undefined>(
    store.get(objectKey) as IDBRequest<MediaRow | undefined>,
  );
  const prevBytes = prev === undefined ? 0 : prev.bytes;
  const row: MediaRow = {
    objectKey,
    buf: bufData,
    mimeType,
    bytes: bufData.byteLength,
    lastAccessAt: Date.now(),
  };
  store.put(row);
  bumpBytes(tx, row.bytes - prevBytes);
  await txDone(tx);
}

/** 读一份媒体缓存并刷新其访问时间（LRU 依据），未命中返回 null。 */
export async function getMedia(db: IDBDatabase, objectKey: string): Promise<MediaRow | null> {
  const tx = db.transaction(STORE_MEDIA, "readwrite");
  const store = tx.objectStore(STORE_MEDIA);
  const got = await reqDone<MediaRow | undefined>(
    store.get(objectKey) as IDBRequest<MediaRow | undefined>,
  );
  if (got === undefined) {
    await txDone(tx);
    return null;
  }
  store.put({ ...got, lastAccessAt: Date.now() });
  await txDone(tx);
  return got;
}
```

- [ ] **Step 4: 在 `messages.ts` 追加删除与淘汰**

```ts
/** 每会话本地保留的消息条数上限。超出部分仍可联网翻，只是离线看不到。 */
export const RETENTION_PER_CONV = 500;

/**
 * 删除消息行，并连带删除它引用的 media blob、同步扣减配额账本。
 *
 * **撤回 / 清空 / 保留窗口淘汰三条路径必须都走这里。** 原因：`media` store 按
 * objectKey 寻址、与消息生命周期解耦，而 `message.recalled` 帧只带 message_id
 * **不带 objectKey**。若消息行已被淘汰掉，撤回时就无从得知该删哪个 blob，
 * blob 会变成永久孤儿——既占配额，又能被后续渲染命中，**等于撤回没生效**。
 *
 * 维持「消息行在，blob 才在」这条不变量，撤回落到不存在的行上时 no-op 才是正确的。
 */
export async function dropMessages(db: IDBDatabase, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const tx = db.transaction([STORE_MESSAGES, STORE_MEDIA, STORE_META], "readwrite");
  const msgStore = tx.objectStore(STORE_MESSAGES);
  const mediaStore = tx.objectStore(STORE_MEDIA);
  let freed = 0;
  for (const id of ids) {
    const row = await reqDone<LocalMessageRow | undefined>(
      msgStore.get(id) as IDBRequest<LocalMessageRow | undefined>,
    );
    if (row === undefined) continue;
    for (const key of row.mediaKeys) {
      const blob = await reqDone<MediaRow | undefined>(
        mediaStore.get(key) as IDBRequest<MediaRow | undefined>,
      );
      if (blob !== undefined) {
        freed += blob.bytes;
        mediaStore.delete(key);
      }
    }
    msgStore.delete(id);
  }
  if (freed > 0) bumpBytes(tx, -freed);
  await txDone(tx);
}

/**
 * 删除会话内 seq <= maxSeqInclusive 的消息（清空聊天记录水位推进时调用）。
 * 返回删除条数。水位为 0 时不删任何东西。
 */
export async function dropMessagesBelowSeq(
  db: IDBDatabase,
  convId: string,
  maxSeqInclusive: number,
): Promise<number> {
  if (maxSeqInclusive <= 0) return 0;
  const range = IDBKeyRange.bound([convId], [convId, maxSeqInclusive]);
  const tx = db.transaction(STORE_MESSAGES, "readonly");
  const idx = tx.objectStore(STORE_MESSAGES).index("by_conv_seq");
  const rows = await reqDone<LocalMessageRow[]>(idx.getAll(range) as IDBRequest<LocalMessageRow[]>);
  await dropMessages(
    db,
    rows.map((r) => r.id),
  );
  return rows.length;
}

/**
 * 保留窗口淘汰：只留最近 RETENTION_PER_CONV 条，返回删除条数。
 *
 * **只在「会话关闭」与「冷启动」两个时机调用。** 写入即淘汰会在用户正往上
 * 翻历史时把刚渲染出来的旧消息删掉，表现为列表在手里跳。
 */
export async function pruneConversation(db: IDBDatabase, convId: string): Promise<number> {
  const range = IDBKeyRange.bound([convId], [convId, Number.MAX_SAFE_INTEGER]);
  const tx = db.transaction(STORE_MESSAGES, "readonly");
  const idx = tx.objectStore(STORE_MESSAGES).index("by_conv_seq");
  const rows = await reqDone<LocalMessageRow[]>(idx.getAll(range) as IDBRequest<LocalMessageRow[]>);
  if (rows.length <= RETENTION_PER_CONV) return 0;
  // getAll 按索引升序，最老的在前
  const doomed = rows.slice(0, rows.length - RETENTION_PER_CONV);
  await dropMessages(
    db,
    doomed.map((r) => r.id),
  );
  return doomed.length;
}
```

同时在 `messages.ts` 顶部补齐 import：

```ts
import { reqDone, txDone, STORE_MESSAGES, STORE_MEDIA, STORE_META } from "./db";
import type { LocalMessageRow, MediaRow } from "./types";
import { bumpBytes } from "./media";
```

- [ ] **Step 5: 导出 media 模块**

在 `packages/shared/src/localdb/index.ts` 追加：

```ts
export * from "./media";
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd packages/shared && LANG=C.UTF-8 npx vitest run src/__tests__/localdb.retention.test.ts`
Expected: PASS（12 个用例全绿）

- [ ] **Step 7: 回归已有 localdb 测试**

Run: `cd packages/shared && LANG=C.UTF-8 npx vitest run src/__tests__/localdb`
Expected: PASS（Task 1-4 全部用例）

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/localdb packages/shared/src/__tests__/localdb.retention.test.ts
git commit -m "feat(localdb): 统一删除路径与保留窗口淘汰"
```

---

### Task 5: 媒体配额 LRU 与 QuotaExceededError 三段降级

**Files:**

- Modify: `packages/shared/src/localdb/media.ts`（在 Task 4 最小版本上补齐，**不改已有签名**）
- Test: `packages/shared/src/__tests__/localdb.media.test.ts`

**Interfaces:**

- Consumes: Task 4 的 `putMedia` / `getMedia` / `mediaBytesTotal` / `bumpBytes` / `META_MEDIA_BYTES`
- Produces:
  - `MEDIA_QUOTA_BYTES: number`（值 `200 * 1024 * 1024`）
  - `MEDIA_EVICT_TARGET: number`（值 `0.8`）
  - `evictMediaTo(db, targetBytes: number): Promise<number>` —— 按 `lastAccessAt` 升序删到目标水位，返回释放字节数
  - `cacheMedia(db, objectKey, buf, mimeType): Promise<boolean>` —— **带三段降级的对外写入入口**，返回是否最终缓存成功
  - `readMediaBlob(db, objectKey): Promise<Blob | null>` —— 命中则用 `ArrayBuffer` 重建 `Blob`

**三段降级（spec §3.8，缺了会让缓存失败升级成功能失败）**：

```
putMedia 抛错且 err.name === "QuotaExceededError"
  → evictMediaTo(db, QUOTA * 0.8)
  → 重试一次
  → 仍失败：返回 false，调用方照常走网络，记一条 warn（不上报 Sentry）
```

写入前若 `mediaBytesTotal + 新字节 > MEDIA_QUOTA_BYTES`，**先主动淘汰再写**，
不等浏览器抛错——浏览器给单 origin 的配额可能远小于 200MB，主动控制更可预测。

- [ ] **Step 1: 写失败测试**

创建 `packages/shared/src/__tests__/localdb.media.test.ts`：

```ts
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  openLocalDb,
  deleteLocalDb,
  putMedia,
  getMedia,
  mediaBytesTotal,
  evictMediaTo,
  cacheMedia,
  readMediaBlob,
  MEDIA_QUOTA_BYTES,
  MEDIA_EVICT_TARGET,
} from "../localdb";

const USER = "media-test";
let db: IDBDatabase;

function buf(n: number): ArrayBuffer {
  return new ArrayBuffer(n);
}

beforeEach(async () => {
  db = (await openLocalDb(USER))!;
});

afterEach(async () => {
  db.close();
  await deleteLocalDb(USER);
  vi.restoreAllMocks();
});

describe("配额常量", () => {
  it("200MB 配额，淘汰到 80% 水位", () => {
    expect(MEDIA_QUOTA_BYTES).toBe(200 * 1024 * 1024);
    expect(MEDIA_EVICT_TARGET).toBe(0.8);
  });
});

describe("读写与账本", () => {
  it("写入后可读回，字节数进账本", async () => {
    await putMedia(db, "k1", buf(1000), "image/jpeg");
    const got = await getMedia(db, "k1");
    expect(got!.bytes).toBe(1000);
    expect(got!.mimeType).toBe("image/jpeg");
    expect(await mediaBytesTotal(db)).toBe(1000);
  });

  it("未命中返回 null", async () => {
    expect(await getMedia(db, "nope")).toBeNull();
    expect(await readMediaBlob(db, "nope")).toBeNull();
  });

  it("readMediaBlob 用 ArrayBuffer 重建 Blob 并带上 mimeType", async () => {
    await putMedia(db, "k1", buf(64), "audio/webm");
    const blob = await readMediaBlob(db, "k1");
    expect(blob).toBeInstanceOf(Blob);
    expect(blob!.type).toBe("audio/webm");
    expect(blob!.size).toBe(64);
  });

  // Review Focus 5：同 key 并发两次写入，账本不能重复累加
  it("同 key 重复写入是幂等覆盖，账本不重复累加", async () => {
    await putMedia(db, "same", buf(500), "image/jpeg");
    await putMedia(db, "same", buf(500), "image/jpeg");
    expect(await mediaBytesTotal(db)).toBe(500);
  });

  it("同 key 并发写入（Promise.all）账本仍收敛到单份字节数", async () => {
    await Promise.all([
      putMedia(db, "race", buf(300), "image/jpeg"),
      putMedia(db, "race", buf(300), "image/jpeg"),
    ]);
    expect(await mediaBytesTotal(db)).toBe(300);
  });

  it("同 key 换成更大的内容，账本按差值调整", async () => {
    await putMedia(db, "grow", buf(100), "image/jpeg");
    await putMedia(db, "grow", buf(400), "image/jpeg");
    expect(await mediaBytesTotal(db)).toBe(400);
  });

  it("getMedia 会刷新 lastAccessAt（LRU 依据）", async () => {
    await putMedia(db, "k1", buf(10), "image/jpeg");
    const before = (await getMedia(db, "k1"))!.lastAccessAt;
    await new Promise((r) => setTimeout(r, 5));
    await getMedia(db, "k1");
    const after = (await getMedia(db, "k1"))!.lastAccessAt;
    expect(after).toBeGreaterThan(before);
  });
});

describe("LRU 淘汰", () => {
  it("按 lastAccessAt 升序删到目标水位", async () => {
    await putMedia(db, "old", buf(100), "image/jpeg");
    await new Promise((r) => setTimeout(r, 5));
    await putMedia(db, "mid", buf(100), "image/jpeg");
    await new Promise((r) => setTimeout(r, 5));
    await putMedia(db, "new", buf(100), "image/jpeg");

    const freed = await evictMediaTo(db, 150);

    expect(freed).toBe(200);
    expect(await getMedia(db, "old")).toBeNull();
    expect(await getMedia(db, "mid")).toBeNull();
    expect(await getMedia(db, "new")).not.toBeNull();
    expect(await mediaBytesTotal(db)).toBe(100);
  });

  it("已在水位内则不删任何东西", async () => {
    await putMedia(db, "k1", buf(50), "image/jpeg");
    expect(await evictMediaTo(db, 100)).toBe(0);
    expect(await getMedia(db, "k1")).not.toBeNull();
  });

  it("刚被读过的不会先被淘汰", async () => {
    await putMedia(db, "a", buf(100), "image/jpeg");
    await new Promise((r) => setTimeout(r, 5));
    await putMedia(db, "b", buf(100), "image/jpeg");
    await new Promise((r) => setTimeout(r, 5));
    await getMedia(db, "a"); // a 变成最近访问
    await evictMediaTo(db, 100);
    expect(await getMedia(db, "a")).not.toBeNull();
    expect(await getMedia(db, "b")).toBeNull();
  });
});

describe("cacheMedia 三段降级", () => {
  it("正常路径返回 true", async () => {
    expect(await cacheMedia(db, "ok", buf(10), "image/jpeg")).toBe(true);
    expect(await getMedia(db, "ok")).not.toBeNull();
  });

  it("超配额时先主动淘汰再写，不等浏览器抛错", async () => {
    // 塞满到配额，再写一份新的：老的应被淘汰、新的应写进去
    await putMedia(db, "filler", buf(MEDIA_QUOTA_BYTES), "image/jpeg");
    expect(await cacheMedia(db, "fresh", buf(1024), "image/jpeg")).toBe(true);
    expect(await getMedia(db, "filler")).toBeNull();
    expect(await getMedia(db, "fresh")).not.toBeNull();
  });

  it("QuotaExceededError 首次抛出后淘汰重试，第二次成功则返回 true", async () => {
    let calls = 0;
    const realOpen = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementation(((...args: unknown[]) => {
      calls++;
      if (calls === 1) {
        throw new DOMException("quota", "QuotaExceededError");
      }
      return (realOpen as (...a: unknown[]) => IDBTransaction)(...args);
    }) as typeof db.transaction);

    expect(await cacheMedia(db, "retry", buf(10), "image/jpeg")).toBe(true);
  });

  it("重试后仍 QuotaExceededError 则返回 false 而不抛", async () => {
    vi.spyOn(db, "transaction").mockImplementation((() => {
      throw new DOMException("quota", "QuotaExceededError");
    }) as typeof db.transaction);

    await expect(cacheMedia(db, "hopeless", buf(10), "image/jpeg")).resolves.toBe(false);
  });

  it("非配额类错误也返回 false，不向上抛（缓存失败不能升级成功能失败）", async () => {
    vi.spyOn(db, "transaction").mockImplementation((() => {
      throw new DOMException("boom", "UnknownError");
    }) as typeof db.transaction);

    await expect(cacheMedia(db, "broken", buf(10), "image/jpeg")).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/shared && LANG=C.UTF-8 npx vitest run src/__tests__/localdb.media.test.ts`
Expected: FAIL —— `evictMediaTo is not a function`

- [ ] **Step 3: 在 `media.ts` 追加配额与降级**

```ts
/** 媒体缓存全局配额（200MB）。 */
export const MEDIA_QUOTA_BYTES = 200 * 1024 * 1024;

/** 触发淘汰时删到配额的这个比例（留出余量，避免刚淘汰完又立刻超限）。 */
export const MEDIA_EVICT_TARGET = 0.8;

/**
 * 按 lastAccessAt 升序（最久未访问优先）淘汰到 targetBytes 以下，返回释放字节数。
 *
 * 用游标逐条删而不是先 getAll：getAll 会把所有 blob 的字节一起读进内存，
 * 200MB 配额下等于瞬间吃掉 200MB 堆。
 */
export async function evictMediaTo(db: IDBDatabase, targetBytes: number): Promise<number> {
  let total = await mediaBytesTotal(db);
  if (total <= targetBytes) return 0;

  const tx = db.transaction([STORE_MEDIA, STORE_META], "readwrite");
  const idx = tx.objectStore(STORE_MEDIA).index("by_access");
  let freed = 0;
  await new Promise<void>((resolve, reject) => {
    const req = idx.openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (cur === null || total - freed <= targetBytes) {
        resolve();
        return;
      }
      freed += (cur.value as MediaRow).bytes;
      cur.delete();
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
  if (freed > 0) bumpBytes(tx, -freed);
  await txDone(tx);
  return freed;
}

/**
 * 对外的媒体写入入口，带三段降级。返回是否最终缓存成功。
 *
 * **缓存失败绝不能升级成功能失败** —— 拿不到本地副本时调用方照常走网络，
 * 用户看不出区别。因此本函数吞掉所有异常、只用返回值表达结果。
 *
 * 超配额时**先主动淘汰再写**，不等浏览器抛 QuotaExceededError：浏览器给单
 * origin 的配额可能远小于 200MB，主动控制比被动接错更可预测。
 */
export async function cacheMedia(
  db: IDBDatabase,
  objectKey: string,
  bufData: ArrayBuffer,
  mimeType: string,
): Promise<boolean> {
  const target = Math.floor(MEDIA_QUOTA_BYTES * MEDIA_EVICT_TARGET);
  try {
    const total = await mediaBytesTotal(db);
    if (total + bufData.byteLength > MEDIA_QUOTA_BYTES) {
      await evictMediaTo(db, Math.max(0, target - bufData.byteLength));
    }
    await putMedia(db, objectKey, bufData, mimeType);
    return true;
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    if (name !== "QuotaExceededError") return false;
    // 第二段：淘汰后重试一次
    try {
      await evictMediaTo(db, target);
      await putMedia(db, objectKey, bufData, mimeType);
      return true;
    } catch {
      // 第三段：放弃缓存，调用方走网络
      return false;
    }
  }
}

/** 读出媒体并重建 Blob（IDB 里存的是 ArrayBuffer），未命中返回 null。 */
export async function readMediaBlob(db: IDBDatabase, objectKey: string): Promise<Blob | null> {
  const row = await getMedia(db, objectKey);
  if (row === null) return null;
  return new Blob([row.buf], { type: row.mimeType });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/shared && LANG=C.UTF-8 npx vitest run src/__tests__/localdb.media.test.ts`
Expected: PASS（16 个用例全绿）

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/localdb/media.ts packages/shared/src/__tests__/localdb.media.test.ts
git commit -m "feat(localdb): 媒体配额 LRU 淘汰与配额超限三段降级"
```

---

### Task 6: outbox 状态机与 ack 单事务出队

**Files:**

- Create: `packages/shared/src/localdb/outbox.ts`
- Modify: `packages/shared/src/localdb/index.ts`
- Test: `packages/shared/src/__tests__/localdb.outbox.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `reqDone` / `txDone` / `STORE_OUTBOX` / `STORE_MESSAGES` / `OutboxRow` / `OutboxStatus`；Task 3 的 `LocalMessageRow`
- Produces:
  - `OUTBOX_EXPIRE_MS: number`（值 `24 * 3600 * 1000`）
  - `enqueueOutbox(db, row: OutboxRow): Promise<void>`
  - `listOutbox(db, convId?: string): Promise<OutboxRow[]>` —— 按 `createdAt` 升序（补发顺序）
  - `markOutbox(db, clientMsgId: string, status: OutboxStatus): Promise<void>` —— 同时自增 `attempts`
  - `settleOutbox(db, clientMsgId: string, confirmed: LocalMessageRow): Promise<void>` —— **单事务**：删 outbox 行 + 写 messages 行
  - `expireOutbox(db, nowMs: number): Promise<number>` —— 把超期的 `pending`/`failed` 标为 `expired`，返回条数
  - `dropOutbox(db, clientMsgId: string): Promise<void>` —— 用户手动丢弃

**`settleOutbox` 必须单事务。** 分两个事务时，崩在中间会让这条消息既不在 outbox
也不在 `messages` —— 用户看到的是「发出去了，重启后消失了」。IDB 支持多 store 事务。

`expired` **不自动删**：用户有权知道哪条没发出去，所以留在队列里由 UI 给
「重发 / 删除」两个出口，不静默吞掉。

- [ ] **Step 1: 写失败测试**

创建 `packages/shared/src/__tests__/localdb.outbox.test.ts`：

```ts
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  openLocalDb,
  deleteLocalDb,
  enqueueOutbox,
  listOutbox,
  markOutbox,
  settleOutbox,
  expireOutbox,
  dropOutbox,
  listMessagesDesc,
  OUTBOX_EXPIRE_MS,
  type OutboxRow,
  type LocalMessageRow,
} from "../localdb";

const USER = "outbox-test";
const CONV = "c1";
let db: IDBDatabase;

function pending(id: string, createdAt: number, convId = CONV): OutboxRow {
  return {
    clientMsgId: id,
    conversationId: convId,
    payload: { type: "message.send", client_msg_id: id, text: "hi " + id },
    createdAt,
    status: "pending",
    attempts: 0,
  };
}

function confirmed(seq: number): LocalMessageRow {
  return { id: "m" + seq, conversationId: CONV, seq, dto: { seq }, mediaKeys: [] };
}

beforeEach(async () => {
  db = (await openLocalDb(USER))!;
});

afterEach(async () => {
  db.close();
  await deleteLocalDb(USER);
});

describe("过期阈值", () => {
  it("24 小时", () => {
    expect(OUTBOX_EXPIRE_MS).toBe(24 * 3600 * 1000);
  });
});

describe("入队与顺序", () => {
  it("按 createdAt 升序列出（补发顺序）", async () => {
    await enqueueOutbox(db, pending("c", 300));
    await enqueueOutbox(db, pending("a", 100));
    await enqueueOutbox(db, pending("b", 200));
    expect((await listOutbox(db)).map((r) => r.clientMsgId)).toEqual(["a", "b", "c"]);
  });

  it("可按会话过滤", async () => {
    await enqueueOutbox(db, pending("a", 100, "c1"));
    await enqueueOutbox(db, pending("b", 200, "c2"));
    expect((await listOutbox(db, "c2")).map((r) => r.clientMsgId)).toEqual(["b"]);
  });

  it("同 clientMsgId 重复入队是覆盖，不产生两条", async () => {
    await enqueueOutbox(db, pending("a", 100));
    await enqueueOutbox(db, pending("a", 100));
    expect(await listOutbox(db)).toHaveLength(1);
  });
});

describe("状态流转", () => {
  it("markOutbox 改状态并自增 attempts", async () => {
    await enqueueOutbox(db, pending("a", 100));
    await markOutbox(db, "a", "sending");
    let row = (await listOutbox(db))[0];
    expect(row.status).toBe("sending");
    expect(row.attempts).toBe(1);

    await markOutbox(db, "a", "failed");
    row = (await listOutbox(db))[0];
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(2);
  });

  it("mark 不存在的行是 no-op", async () => {
    await expect(markOutbox(db, "ghost", "failed")).resolves.toBeUndefined();
    expect(await listOutbox(db)).toHaveLength(0);
  });
});

describe("settleOutbox —— ack 单事务出队", () => {
  it("出队与落 messages 一起完成", async () => {
    await enqueueOutbox(db, pending("a", 100));
    await settleOutbox(db, "a", confirmed(7));

    expect(await listOutbox(db)).toHaveLength(0);
    const msgs = await listMessagesDesc(db, CONV, 0, 10);
    expect(msgs.map((m) => m.seq)).toEqual([7]);
  });

  it("outbox 行不存在时仍写入 messages（ack 重复到达也要幂等）", async () => {
    await settleOutbox(db, "never-queued", confirmed(9));
    expect((await listMessagesDesc(db, CONV, 0, 10)).map((m) => m.seq)).toEqual([9]);
  });
});

describe("过期", () => {
  it("超 24h 的 pending 与 failed 标为 expired，未超的不动", async () => {
    const now = 1_000_000_000_000;
    await enqueueOutbox(db, pending("old", now - OUTBOX_EXPIRE_MS - 1));
    await enqueueOutbox(db, pending("fresh", now - 1000));
    await enqueueOutbox(db, {
      ...pending("oldFailed", now - OUTBOX_EXPIRE_MS - 1),
      status: "failed",
    });

    expect(await expireOutbox(db, now)).toBe(2);

    const byId = new Map((await listOutbox(db)).map((r) => [r.clientMsgId, r.status]));
    expect(byId.get("old")).toBe("expired");
    expect(byId.get("oldFailed")).toBe("expired");
    expect(byId.get("fresh")).toBe("pending");
  });

  it("expired 不自动删除（用户要能看到并重发或丢弃）", async () => {
    const now = 1_000_000_000_000;
    await enqueueOutbox(db, pending("old", now - OUTBOX_EXPIRE_MS - 1));
    await expireOutbox(db, now);
    expect(await listOutbox(db)).toHaveLength(1);
  });

  it("已 expired 的不重复计数", async () => {
    const now = 1_000_000_000_000;
    await enqueueOutbox(db, { ...pending("old", now - OUTBOX_EXPIRE_MS - 1), status: "expired" });
    expect(await expireOutbox(db, now)).toBe(0);
  });
});

describe("手动丢弃", () => {
  it("dropOutbox 删掉指定行", async () => {
    await enqueueOutbox(db, pending("a", 100));
    await dropOutbox(db, "a");
    expect(await listOutbox(db)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/shared && LANG=C.UTF-8 npx vitest run src/__tests__/localdb.outbox.test.ts`
Expected: FAIL —— `enqueueOutbox is not a function`

- [ ] **Step 3: 写 `outbox.ts`**

```ts
/** 待发消息队列的本地读写与状态流转。 */
import { reqDone, txDone, STORE_OUTBOX, STORE_MESSAGES } from "./db";
import type { OutboxRow, OutboxStatus, LocalMessageRow } from "./types";

/** 入队超过这个时长仍未发出即判为过期（24 小时）。 */
export const OUTBOX_EXPIRE_MS = 24 * 3600 * 1000;

/** 入队（同 clientMsgId 覆盖）。 */
export async function enqueueOutbox(db: IDBDatabase, row: OutboxRow): Promise<void> {
  const tx = db.transaction(STORE_OUTBOX, "readwrite");
  tx.objectStore(STORE_OUTBOX).put(row);
  await txDone(tx);
}

/**
 * 列出待发队列，按 createdAt 升序。
 *
 * 升序即补发顺序：补发必须**串行按序**，并行会打乱用户实际输入的消息顺序。
 */
export async function listOutbox(db: IDBDatabase, convId?: string): Promise<OutboxRow[]> {
  const tx = db.transaction(STORE_OUTBOX, "readonly");
  const idx = tx.objectStore(STORE_OUTBOX).index("by_created");
  const rows = await reqDone<OutboxRow[]>(idx.getAll() as IDBRequest<OutboxRow[]>);
  if (convId === undefined) return rows;
  return rows.filter((r) => r.conversationId === convId);
}

/** 改状态并自增尝试次数。行不存在时 no-op。 */
export async function markOutbox(
  db: IDBDatabase,
  clientMsgId: string,
  status: OutboxStatus,
): Promise<void> {
  const tx = db.transaction(STORE_OUTBOX, "readwrite");
  const store = tx.objectStore(STORE_OUTBOX);
  const cur = await reqDone<OutboxRow | undefined>(
    store.get(clientMsgId) as IDBRequest<OutboxRow | undefined>,
  );
  if (cur !== undefined) store.put({ ...cur, status, attempts: cur.attempts + 1 });
  await txDone(tx);
}

/**
 * ack 到达：出队并把已确认消息落入 messages。
 *
 * **两步必须在同一个事务里。** 分两个事务时崩在中间，这条消息既不在 outbox
 * 也不在 messages —— 用户看到的是「发出去了，重启后消失了」。
 *
 * outbox 行不存在也照常写 messages：重复 ack（服务端幂等回原 ack）必须幂等。
 */
export async function settleOutbox(
  db: IDBDatabase,
  clientMsgId: string,
  confirmed: LocalMessageRow,
): Promise<void> {
  const tx = db.transaction([STORE_OUTBOX, STORE_MESSAGES], "readwrite");
  tx.objectStore(STORE_OUTBOX).delete(clientMsgId);
  tx.objectStore(STORE_MESSAGES).put(confirmed);
  await txDone(tx);
}

/**
 * 把超期未发出的 pending / failed 标为 expired，返回本次标记条数。
 *
 * **expired 不自动删除** —— 用户有权知道哪条没发出去，由 UI 给「重发 / 删除」
 * 两个出口，不静默吞掉。已是 expired 的不重复计数。
 */
export async function expireOutbox(db: IDBDatabase, nowMs: number): Promise<number> {
  const tx = db.transaction(STORE_OUTBOX, "readwrite");
  const store = tx.objectStore(STORE_OUTBOX);
  const rows = await reqDone<OutboxRow[]>(store.getAll() as IDBRequest<OutboxRow[]>);
  let n = 0;
  for (const r of rows) {
    const stale = r.status === "pending" || r.status === "failed";
    if (stale && nowMs - r.createdAt > OUTBOX_EXPIRE_MS) {
      store.put({ ...r, status: "expired" as OutboxStatus });
      n++;
    }
  }
  await txDone(tx);
  return n;
}

/** 用户手动丢弃一条待发消息。 */
export async function dropOutbox(db: IDBDatabase, clientMsgId: string): Promise<void> {
  const tx = db.transaction(STORE_OUTBOX, "readwrite");
  tx.objectStore(STORE_OUTBOX).delete(clientMsgId);
  await txDone(tx);
}
```

- [ ] **Step 4: 导出**

在 `packages/shared/src/localdb/index.ts` 追加：

```ts
export * from "./outbox";
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/shared && LANG=C.UTF-8 npx vitest run src/__tests__/localdb.outbox.test.ts`
Expected: PASS（13 个用例全绿）

- [ ] **Step 6: Stage A 全量回归 + 类型检查**

Run: `cd packages/shared && LANG=C.UTF-8 npx vitest run src/__tests__/localdb`
Expected: PASS（Task 1-6 全部用例，约 61 条）

Run: `pnpm --filter @yuanchat/shared typecheck`
Expected: 0 错误

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/localdb packages/shared/src/__tests__/localdb.outbox.test.ts
git commit -m "feat(localdb): 待发队列状态机与 ack 单事务出队"
```

---

## Stage B — 后端：`after_seq` 向后翻页 + 幂等发送

### Task 7: repository 抽出共用查询构造并加 `ListAfter`

**Files:**

- Modify: `server/internal/repository/message_repo.go:79-99`（`ListBefore` 抽出共用构造）
- Test: `server/internal/repository/message_repo_test.go`（追加用例）

**Interfaces:**

- Consumes: 既有 `MessageWithSender`、`testutil.NewDB`
- Produces:
  - `(r *MessageRepository) ListAfter(ctx context.Context, convID uuid.UUID, afterSeq, minSeq int64, limit int) ([]MessageWithSender, error)` —— 返回 **seq 升序**
  - 私有 `(r *MessageRepository) historyQuery(ctx context.Context, convID uuid.UUID, minSeq int64) *gorm.DB`

**可见性口径必须唯一。** `ListBefore` 与 `ListAfter` 共用 `historyQuery`，
不允许各写一份 `Where` —— 两处独立判断必然漂移，而漂移的方向就是越权。

**注意 `ListBefore` 刻意不过滤 `status`**：撤回消息要作为占位行回给客户端
（相册的 `ListMedia` 才过滤 `status=1`）。`ListAfter` 必须保持同一姿态。

- [ ] **Step 1: 写失败测试**

在 `server/internal/repository/message_repo_test.go` 追加（沿用该文件已有的夹具写法）：

```go
// TestListAfter 增量补齐：取 seq > afterSeq 的消息，升序，可见性口径与 ListBefore 一致。
func TestListAfter(t *testing.T) {
	db := testutil.NewDB(t)
	repo := repository.NewMessageRepository(db)
	ctx := context.Background()

	convID, senderID := seedConversationWithSender(t, db)
	for i := 1; i <= 5; i++ {
		msg := &model.Message{
			ConversationID: convID,
			SenderID:       senderID,
			MessageType:    model.MessageTypeText,
			Content:        `{"text":"m"}`,
			Status:         model.MessageStatusNormal,
		}
		if err := repo.CreateWithSeq(ctx, msg); err != nil {
			t.Fatalf("seed message %d: %v", i, err)
		}
	}

	t.Run("升序返回 seq 大于游标的消息", func(t *testing.T) {
		rows, err := repo.ListAfter(ctx, convID, 2, 0, 10)
		if err != nil {
			t.Fatalf("ListAfter: %v", err)
		}
		got := make([]int64, len(rows))
		for i, r := range rows {
			got[i] = r.Seq
		}
		if len(got) != 3 || got[0] != 3 || got[2] != 5 {
			t.Fatalf("want ascending [3 4 5], got %v", got)
		}
	})

	t.Run("limit 生效且取最靠前的那批（补空洞要从缺口处往后补）", func(t *testing.T) {
		rows, err := repo.ListAfter(ctx, convID, 0, 0, 2)
		if err != nil {
			t.Fatalf("ListAfter: %v", err)
		}
		if len(rows) != 2 || rows[0].Seq != 1 || rows[1].Seq != 2 {
			t.Fatalf("want [1 2], got %v", rows)
		}
	})

	t.Run("游标等于最新 seq 时返回空（不是报错）", func(t *testing.T) {
		rows, err := repo.ListAfter(ctx, convID, 5, 0, 10)
		if err != nil {
			t.Fatalf("ListAfter: %v", err)
		}
		if len(rows) != 0 {
			t.Fatalf("want empty, got %d rows", len(rows))
		}
	})

	t.Run("minSeq 水位过滤生效（清空聊天记录语义）", func(t *testing.T) {
		rows, err := repo.ListAfter(ctx, convID, 0, 3, 10)
		if err != nil {
			t.Fatalf("ListAfter: %v", err)
		}
		if len(rows) != 2 || rows[0].Seq != 4 {
			t.Fatalf("want [4 5], got %v", rows)
		}
	})

	t.Run("撤回消息照常回占位行（与 ListBefore 同口径，不过滤 status）", func(t *testing.T) {
		if err := db.Exec(
			`UPDATE messages SET status = ?, content = '{}' WHERE conversation_id = ? AND seq = 4`,
			model.MessageStatusRecalled, convID,
		).Error; err != nil {
			t.Fatalf("mark recalled: %v", err)
		}
		rows, err := repo.ListAfter(ctx, convID, 3, 0, 10)
		if err != nil {
			t.Fatalf("ListAfter: %v", err)
		}
		if len(rows) != 2 {
			t.Fatalf("撤回消息必须仍作为占位行返回，want 2 rows, got %d", len(rows))
		}
	})
}
```

> **夹具提示**：`seedConversationWithSender` 与 `model.MessageStatusRecalled` 若在该测试文件中
> 尚不存在，先照 `message_repo_test.go` 现有用例的建会话/建用户写法补一个本地 helper；
> `status` 的撤回取值以 `server/internal/model/` 中的实际常量名为准（**先 grep 确认，不要照抄**）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/repository/ -run TestListAfter -v`
Expected: FAIL —— `repo.ListAfter undefined`

- [ ] **Step 3: 抽出共用构造并实现 `ListAfter`**

把 `message_repo.go` 的 `ListBefore` 改写为：

```go
// historyQuery 历史翻页与增量补齐**共用**的查询构造。
//
// 可见性口径只能有这一份：ListBefore 与 ListAfter 各写一份 Where 必然漂移，
// 而漂移的方向就是越权。刻意**不过滤 status** —— 撤回消息要作为占位行回给
// 客户端（相册的 ListMedia 才过滤 status=1）。
//
// minSeq 为调用方的 cleared_before_seq 水位（0 表示不过滤）；
// 群会话署名用成员 alias 覆盖 nickname。
func (r *MessageRepository) historyQuery(
	ctx context.Context,
	convID uuid.UUID,
	minSeq int64,
) *gorm.DB {
	q := r.db.WithContext(ctx).
		Table("messages m").
		Select(`m.*, COALESCE(NULLIF(cm.alias, ''), u.nickname) AS sender_nickname, u.avatar_url AS sender_avatar_url`).
		Joins("JOIN users u ON u.id = m.sender_id").
		Joins("LEFT JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = m.sender_id").
		Where("m.conversation_id = ? AND m.deleted_at IS NULL", convID)
	if minSeq > 0 {
		q = q.Where("m.seq > ?", minSeq)
	}
	return q
}

// ListBefore 取会话中 seq < beforeSeq 且 seq > minSeq 的最新 limit 条消息（seq 降序）。
// beforeSeq ≤ 0 表示从最新一条开始取。
func (r *MessageRepository) ListBefore(ctx context.Context, convID uuid.UUID, beforeSeq, minSeq int64, limit int) ([]MessageWithSender, error) {
	q := r.historyQuery(ctx, convID, minSeq)
	if beforeSeq > 0 {
		q = q.Where("m.seq < ?", beforeSeq)
	}

	var rows []MessageWithSender
	err := q.Order("m.seq DESC").Limit(limit).Scan(&rows).Error
	for i := range rows {
		rows[i].EditedAt = utcTimePtr(rows[i].EditedAt)
	}
	return rows, err
}

// ListAfter 取会话中 seq > afterSeq 且 seq > minSeq 的最早 limit 条消息（seq **升序**）。
//
// 供客户端断线重连后补空洞用：从本地水位往后拉，升序保证补齐时可顺序推进水位。
// 游标等于最新 seq 时返回空切片（不是错误）——客户端据此停止循环。
func (r *MessageRepository) ListAfter(ctx context.Context, convID uuid.UUID, afterSeq, minSeq int64, limit int) ([]MessageWithSender, error) {
	q := r.historyQuery(ctx, convID, minSeq)
	if afterSeq > 0 {
		q = q.Where("m.seq > ?", afterSeq)
	}

	var rows []MessageWithSender
	err := q.Order("m.seq ASC").Limit(limit).Scan(&rows).Error
	for i := range rows {
		rows[i].EditedAt = utcTimePtr(rows[i].EditedAt)
	}
	return rows, err
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && go test ./internal/repository/ -run TestListAfter -v`
Expected: PASS（5 个子测试全绿）

- [ ] **Step 5: 回归 ListBefore（抽构造不能改它的行为）**

Run: `cd server && go test ./internal/repository/ -v`
Expected: PASS，`ListBefore` 相关既有用例零失败

- [ ] **Step 6: Commit**

```bash
git add server/internal/repository/message_repo.go server/internal/repository/message_repo_test.go
git commit -m "feat(server): 消息历史抽出共用查询构造并加 ListAfter"
```

---

### Task 8: service 与 handler 接入 `after_seq`

**Files:**

- Modify: `server/internal/service/message_service.go:350`（`GetHistory` 旁加 `GetHistoryAfter`）
- Modify: `server/internal/handler/message.go:38-70`（`History` 支持 `after_seq`，互斥校验）
- Test: `server/internal/handler/message_test.go`（追加用例；文件不存在则新建）

**Interfaces:**

- Consumes: Task 7 的 `ListAfter`；既有 `GetHistory` 的成员校验与表情回应回填逻辑
- Produces:
  - `(s *MessageService) GetHistoryAfter(ctx context.Context, userID, convID uuid.UUID, afterSeq int64, limit int) ([]repository.MessageWithSender, error)`
  - `GET /api/v1/conversations/:id/messages` 新增查询参数 `after_seq`，与 `before_seq` **互斥**

**互斥必须按 400 拒绝，不能静默取其一。** 两个游标同时给是调用方的 bug，
静默选一个会让对方在错误的方向上翻页却毫无察觉。

**`limit` 上限 100**，与既有 `before_seq` 路径完全一致（`limit <= 0 || limit > 100` 时回落 30）。

- [ ] **Step 1: 写失败测试**

在 `server/internal/handler/message_test.go` 追加：

```go
// TestHistoryAfterSeq 增量补齐端点：互斥校验、limit 夹取、空结果语义。
func TestHistoryAfterSeq(t *testing.T) {
	env := newMessageHandlerEnv(t) // 沿用本文件既有夹具构造；无则照现有用例补
	convID := env.seedConversation(t, 5)

	t.Run("after_seq 升序返回并带 has_more", func(t *testing.T) {
		rec := env.get(t, "/api/v1/conversations/"+convID.String()+"/messages?after_seq=2&limit=2")
		if rec.Code != 200 {
			t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
		}
		var resp struct {
			Data struct {
				Messages []struct{ Seq int64 `json:"seq"` } `json:"messages"`
				HasMore  bool                                `json:"has_more"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if len(resp.Data.Messages) != 2 || resp.Data.Messages[0].Seq != 3 {
			t.Fatalf("want ascending from seq 3, got %+v", resp.Data.Messages)
		}
		if !resp.Data.HasMore {
			t.Fatal("满页应报 has_more=true")
		}
	})

	// Review Focus 2：游标等于最新 seq 时必须回空数组 + has_more=false
	t.Run("after_seq 等于最新 seq 回空数组且 has_more=false", func(t *testing.T) {
		rec := env.get(t, "/api/v1/conversations/"+convID.String()+"/messages?after_seq=5")
		if rec.Code != 200 {
			t.Fatalf("want 200, got %d", rec.Code)
		}
		var resp struct {
			Data struct {
				Messages []json.RawMessage `json:"messages"`
				HasMore  bool              `json:"has_more"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if len(resp.Data.Messages) != 0 {
			t.Fatalf("want empty messages, got %d", len(resp.Data.Messages))
		}
		if resp.Data.HasMore {
			t.Fatal("空结果不能报 has_more=true")
		}
	})

	t.Run("两个游标同时给按 400 拒绝，不静默取其一", func(t *testing.T) {
		rec := env.get(t, "/api/v1/conversations/"+convID.String()+"/messages?after_seq=1&before_seq=4")
		if rec.Code != 400 {
			t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("limit 超上限回落到 30", func(t *testing.T) {
		rec := env.get(t, "/api/v1/conversations/"+convID.String()+"/messages?after_seq=0&limit=999")
		if rec.Code != 200 {
			t.Fatalf("want 200, got %d", rec.Code)
		}
		// 只有 5 条种子消息，断言不因 limit=999 报错即可
	})

	t.Run("非成员 403", func(t *testing.T) {
		rec := env.getAs(t, env.outsiderToken, "/api/v1/conversations/"+convID.String()+"/messages?after_seq=0")
		if rec.Code != 403 {
			t.Fatalf("want 403, got %d", rec.Code)
		}
	})
}
```

> **夹具提示**：`newMessageHandlerEnv` / `env.get` / `env.getAs` / `env.seedConversation` 是本
> task 要建立的本地测试夹具。**先读 `server/internal/handler/message_test.go` 与
> `message_edit_test.go`**（两者已存在，且 `message_edit_test.go` 就是「建会话 → 发消息 →
> 打 REST 断言业务码」的现成范式），照同一姿态复用，不要另造一套。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && go test ./internal/handler/ -run TestHistoryAfterSeq -v`
Expected: FAIL（`after_seq` 被忽略，第一个子测试就拿到降序的最新 5 条）

- [ ] **Step 3: 写 service 侧 `GetHistoryAfter`**

在 `message_service.go` 的 `GetHistory` 之后追加。**表情回应回填必须复用同一段逻辑**
（把 `GetHistory` 里那段抽成私有 `backfillReactions`，两处共用）：

```go
// GetHistoryAfter 取 seq > afterSeq 的最早 limit 条消息（升序），供客户端补空洞。
//
// 成员校验、cleared_before_seq 水位、表情回应回填**全部与 GetHistory 同口径**
// （共用 historyQuery 与 backfillReactions），故两条路径不会漂移出越权差异。
func (s *MessageService) GetHistoryAfter(
	ctx context.Context,
	userID, convID uuid.UUID,
	afterSeq int64,
	limit int,
) ([]repository.MessageWithSender, error) {
	member, ok, err := s.convRepo.GetMember(ctx, convID, userID)
	if err != nil {
		return nil, fmt.Errorf("check membership: %w", err)
	}
	if !ok {
		return nil, ErrNotMember
	}

	if limit <= 0 || limit > 100 {
		limit = 30
	}
	messages, err := s.msgRepo.ListAfter(ctx, convID, afterSeq, member.ClearedBeforeSeq, limit)
	if err != nil {
		return nil, err
	}
	s.backfillReactions(ctx, userID, messages)
	return messages, nil
}
```

抽出的私有助手**必须保持 `GetHistory` 原有的「失败只 warn、不中断」语义**
（原代码在 `AggregateFor` 出错时是 `return messages, nil`，表情回应加载失败不该让
整个历史拉取失败），因此它不返回 error：

```go
// backfillReactions 就地回填表情回应聚合（Mine 相对 userID）。
//
// 加载失败只记 warn 不返回错误：表情回应是附加信息，
// 拿不到时让整个历史拉取失败是不成比例的。
func (s *MessageService) backfillReactions(
	ctx context.Context,
	userID uuid.UUID,
	messages []repository.MessageWithSender,
) {
	if len(messages) == 0 {
		return
	}
	ids := make([]uuid.UUID, 0, len(messages))
	for _, m := range messages {
		ids = append(ids, m.ID)
	}
	aggs, err := s.reactionRepo.AggregateFor(ctx, ids, userID)
	if err != nil {
		s.logger.Warn("load reactions failed", zap.Error(err))
		return
	}
	for i := range messages {
		messages[i].Reactions = aggs[messages[i].ID]
	}
}
```

`GetHistory` 里原先那段内联回填同步替换为 `s.backfillReactions(ctx, userID, messages)`。

- [ ] **Step 4: 改 handler 支持 `after_seq`**

把 `handler/message.go` 的 `History` 改为：

```go
// History 分页返回某会话的消息。
//
// 两种游标互斥：before_seq 向前翻（seq 降序，翻历史）、after_seq 向后补
// （seq 升序，断线补空洞）。同时给按 400 拒绝——静默取其一会让调用方
// 在错误的方向上翻页却毫无察觉。
//
//	@Summary		拉取消息历史
//	@Tags			chat
//	@Security		BearerAuth
//	@Param			id			path	string	true	"会话 id"
//	@Param			before_seq	query	int		false	"拉取 seq < before_seq 的消息（降序）；0 表示最新"
//	@Param			after_seq	query	int		false	"拉取 seq > after_seq 的消息（升序）；与 before_seq 互斥"
//	@Param			limit		query	int		false	"每页条数，默认 30，上限 100"
//	@Success		200	{object}	Response
//	@Router			/api/v1/conversations/{id}/messages [get]
func (h *MessageHandler) History(c *gin.Context) {
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

	beforeSeq, _ := strconv.ParseInt(c.DefaultQuery("before_seq", "0"), 10, 64)
	afterSeq, _ := strconv.ParseInt(c.DefaultQuery("after_seq", "0"), 10, 64)
	if beforeSeq > 0 && afterSeq > 0 {
		BadRequest(c, "before_seq and after_seq are mutually exclusive")
		return
	}

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "30"))
	if limit <= 0 || limit > 100 {
		limit = 30
	}

	var msgs []repository.MessageWithSender
	if afterSeq > 0 || c.Query("after_seq") != "" {
		msgs, err = h.svc.GetHistoryAfter(c.Request.Context(), userID, convID, afterSeq, limit)
	} else {
		msgs, err = h.svc.GetHistory(c.Request.Context(), userID, convID, beforeSeq, limit)
	}
	if err != nil {
		if errors.Is(err, service.ErrNotMember) {
			Error(c, 403, 403, "not a conversation member")
			return
		}
		h.logger.Error("get history failed", zap.Error(err))
		InternalError(c, "failed to load messages")
		return
	}

	// 满页说明同方向上可能还有更多
	Success(c, gin.H{
		"messages": msgs,
		"has_more": len(msgs) == limit,
	})
}
```

> **`c.Query("after_seq") != ""` 这个条件不可省**：客户端首次补齐时本地水位是 0，
> 会传 `after_seq=0`，此时必须走升序分支从头补。只判 `afterSeq > 0` 会把它错分到
> `before_seq` 的降序分支上，补齐方向反了。

同时确认 `handler/message.go` 已 import `repository` 包；若原文件未 import，补上。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd server && go test ./internal/handler/ -run TestHistoryAfterSeq -v`
Expected: PASS（5 个子测试全绿）

- [ ] **Step 6: 全量后端回归**

Run: `cd server && go vet ./... && go test ./...`
Expected: PASS，14 包零失败

- [ ] **Step 7: 同步 API 文档**

在 `docs/CHAT_API.md` 的消息历史段落补 `after_seq` 参数、互斥规则与升序语义。

- [ ] **Step 8: Commit**

```bash
git add server/internal/service/message_service.go server/internal/handler/message.go \
        server/internal/handler/message_test.go docs/CHAT_API.md
git commit -m "feat(server): 消息历史支持 after_seq 增量补齐"
```

---

### Task 9: 幂等发送（迁移 020 + 唯一索引 + 并发测试）

**Files:**

- Create: `server/internal/database/migrations/020_idempotent_send.sql`
- Modify: `server/internal/repository/message_repo.go`（`CreateWithSeq` 识别唯一冲突 + 新增 `FindByClientMsgID`）
- Modify: `server/internal/service/message_service.go`（`SendResult` 加 `Duplicate`；`SendContent` 幂等短路）
- Modify: `server/internal/ws/handler.go:234-280`（`Duplicate` 时只回 ack、跳过扇出与离线推送）
- Modify: `docs/DB_SCHEMA.md`（补 020）
- Test: `server/internal/repository/message_repo_test.go`、`server/internal/service/message_send_idempotent_test.go`

**Interfaces:**

- Consumes: 既有 `CreateWithSeq` / `SendContent` / `SendResult`
- Produces:
  - `repository.ErrDuplicateClientMsg`（`errors.New`）
  - `(r *MessageRepository) FindByClientMsgID(ctx context.Context, senderID uuid.UUID, clientMsgID string) (*model.Message, error)` —— 未找到返回 `(nil, nil)`
  - `service.SendResult.Duplicate bool`

**这是方案 C 的隐藏前置。** 没有它，离线 outbox 补发就是个重复消息生成器：
典型失败场景是「服务端已落库、ack 在回程丢了」，客户端上线重发即产生第二条。

`Duplicate` 语义沿用本仓既有的 `RecallResult.Idempotent` 姿态（「handler 跳过推送」）：
**只回 ack 让客户端出队，不重发 `message.receive`** —— 收件人第一次就已经收到了。

- [ ] **Step 1: 写迁移 020**

创建 `server/internal/database/migrations/020_idempotent_send.sql`：

```sql
-- +goose Up
-- +goose StatementBegin
-- 发送幂等：同一发送者的同一 client_msg_id 只允许落一行。
--
-- 没有这条索引，离线补发就是重复消息生成器 —— 典型失败是「服务端已落库、
-- ack 在回程丢了」，客户端上线重发即产生第二条一模一样的消息。
--
-- 部分索引（WHERE client_msg_id IS NOT NULL）：系统消息、通话记录等
-- 服务端自行产生的消息没有 client_msg_id，不能被这条约束波及。
-- 存量重复行会让建索引失败并给出明确报错（不会半途留下不一致状态），
-- 届时需先人工去重再重跑迁移。
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_sender_client_msg
  ON messages(sender_id, client_msg_id)
  WHERE client_msg_id IS NOT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_messages_sender_client_msg;
-- +goose StatementEnd
```

- [ ] **Step 2: 探测存量重复（迁移前必做）**

Run:

```bash
docker exec -i $(docker ps -qf name=postgres) psql -U yuanchat -d yuanchat -c \
  "SELECT sender_id, client_msg_id, count(*) FROM messages
   WHERE client_msg_id IS NOT NULL
   GROUP BY 1,2 HAVING count(*) > 1 LIMIT 20;"
```

Expected: 0 行。**若有输出，先停下来把重复行清理掉再继续**——直接跑迁移会失败。

- [ ] **Step 3: 写失败测试（repository 层）**

在 `server/internal/repository/message_repo_test.go` 追加：

```go
// TestCreateWithSeqIdempotent 同一 (sender_id, client_msg_id) 重复落库必须被唯一索引挡下。
func TestCreateWithSeqIdempotent(t *testing.T) {
	db := testutil.NewDB(t)
	repo := repository.NewMessageRepository(db)
	ctx := context.Background()
	convID, senderID := seedConversationWithSender(t, db)

	cid := "client-msg-1"
	first := &model.Message{
		ConversationID: convID, SenderID: senderID,
		MessageType: model.MessageTypeText, Content: `{"text":"hello"}`,
		Status: model.MessageStatusNormal, ClientMsgID: &cid,
	}
	if err := repo.CreateWithSeq(ctx, first); err != nil {
		t.Fatalf("first send: %v", err)
	}

	t.Run("重复 client_msg_id 返回 ErrDuplicateClientMsg", func(t *testing.T) {
		dup := &model.Message{
			ConversationID: convID, SenderID: senderID,
			MessageType: model.MessageTypeText, Content: `{"text":"hello"}`,
			Status: model.MessageStatusNormal, ClientMsgID: &cid,
		}
		err := repo.CreateWithSeq(ctx, dup)
		if !errors.Is(err, repository.ErrDuplicateClientMsg) {
			t.Fatalf("want ErrDuplicateClientMsg, got %v", err)
		}
	})

	t.Run("冲突回滚后 seq 不泄漏（last_seq 未被白占）", func(t *testing.T) {
		var lastSeq int64
		if err := db.Raw(`SELECT last_seq FROM conversations WHERE id = ?`, convID).
			Scan(&lastSeq).Error; err != nil {
			t.Fatalf("read last_seq: %v", err)
		}
		if lastSeq != first.Seq {
			t.Fatalf("冲突事务回滚后 last_seq 应仍为 %d，实际 %d（seq 被白占）", first.Seq, lastSeq)
		}
	})

	t.Run("FindByClientMsgID 取回原行", func(t *testing.T) {
		got, err := repo.FindByClientMsgID(ctx, senderID, cid)
		if err != nil {
			t.Fatalf("FindByClientMsgID: %v", err)
		}
		if got == nil || got.ID != first.ID || got.Seq != first.Seq {
			t.Fatalf("want original message %s/seq %d, got %+v", first.ID, first.Seq, got)
		}
	})

	t.Run("FindByClientMsgID 未命中返回 (nil, nil)", func(t *testing.T) {
		got, err := repo.FindByClientMsgID(ctx, senderID, "never-sent")
		if err != nil || got != nil {
			t.Fatalf("want (nil, nil), got (%+v, %v)", got, err)
		}
	})

	t.Run("不同发送者可用同一 client_msg_id", func(t *testing.T) {
		_, otherSender := seedConversationWithSender(t, db)
		other := &model.Message{
			ConversationID: convID, SenderID: otherSender,
			MessageType: model.MessageTypeText, Content: `{"text":"hi"}`,
			Status: model.MessageStatusNormal, ClientMsgID: &cid,
		}
		// 索引是 (sender_id, client_msg_id) 复合的，换人不算冲突
		if err := repo.CreateWithSeq(ctx, other); err != nil {
			t.Fatalf("不同发送者的同 client_msg_id 应当放行，got %v", err)
		}
	})

	t.Run("client_msg_id 为 NULL 的消息不受约束（系统消息可多条）", func(t *testing.T) {
		for i := 0; i < 3; i++ {
			sys := &model.Message{
				ConversationID: convID, SenderID: senderID,
				MessageType: model.MessageTypeSystem, Content: `{"text":"sys"}`,
				Status: model.MessageStatusNormal,
			}
			if err := repo.CreateWithSeq(ctx, sys); err != nil {
				t.Fatalf("系统消息第 %d 条应放行，got %v", i+1, err)
			}
		}
	})
}
```

- [ ] **Step 4: 写失败测试（service 层并发）**

创建 `server/internal/service/message_send_idempotent_test.go`：

```go
package service_test

// N 个 goroutine 同时用同一 client_msg_id 发送：必须恰好落 1 行，
// 且所有响应指向同一条消息。
//
// 这是 spec 要求的并发断言：两层（repo/service）都只按 READ COMMITTED
// 语义推理不够，唯一索引在并发下的实际行为必须被证明。
func TestSendContentConcurrentSameClientMsgID(t *testing.T) {
	env := newSendEnv(t) // 沿用本包既有 service 测试夹具搭法
	convID, senderID := env.seedPrivateConversation(t)

	const n = 8
	const cid = "concurrent-cid"

	var wg sync.WaitGroup
	results := make([]*service.SendResult, n)
	errs := make([]error, n)
	start := make(chan struct{})

	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-start // 齐发，最大化并发窗口
			results[idx], errs[idx] = env.svc.SendContent(
				context.Background(), senderID, convID,
				model.MessageTypeText, `{"text":"race"}`, cid, nil, nil,
			)
		}(i)
	}
	close(start)
	wg.Wait()

	// 全部调用都必须成功（幂等，不是「一个成功其余报错」）
	for i, err := range errs {
		if err != nil {
			t.Fatalf("goroutine %d failed: %v", i, err)
		}
	}

	// 所有响应必须指向同一条消息
	firstID := results[0].Message.ID
	firstSeq := results[0].Message.Seq
	dupCount := 0
	for i, r := range results {
		if r.Message.ID != firstID {
			t.Fatalf("goroutine %d 拿到不同 message_id：%s vs %s", i, r.Message.ID, firstID)
		}
		if r.Message.Seq != firstSeq {
			t.Fatalf("goroutine %d 拿到不同 seq：%d vs %d", i, r.Message.Seq, firstSeq)
		}
		if r.Duplicate {
			dupCount++
		}
	}

	// 恰好一个是「首发」，其余全是「重复」
	if dupCount != n-1 {
		t.Fatalf("want %d 个 Duplicate，实际 %d", n-1, dupCount)
	}

	// 库里只有一行
	var count int64
	if err := env.db.Raw(
		`SELECT count(*) FROM messages WHERE sender_id = ? AND client_msg_id = ?`,
		senderID, cid,
	).Scan(&count).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Fatalf("want 恰好 1 行落库，实际 %d 行", count)
	}
}
```

> **夹具提示**：`newSendEnv` / `env.seedPrivateConversation` 照 `server/internal/service/`
> 下既有 service 测试的装配写法建（**先 `ls server/internal/service/*_test.go` 找一个发消息的
> 现成用例照抄装配**）。import 需要 `sync`、`context`、`testing` 与本仓 `model` / `service` 包。

- [ ] **Step 5: 跑测试确认失败**

Run: `cd server && go test ./internal/repository/ -run TestCreateWithSeqIdempotent -v`
Expected: FAIL —— `repository.ErrDuplicateClientMsg undefined`

- [ ] **Step 6: 实现 repository 侧**

在 `message_repo.go` 顶部加哨兵错误与查询方法：

```go
// ErrDuplicateClientMsg 同一发送者的同一 client_msg_id 已落库。
//
// 由唯一索引 idx_messages_sender_client_msg（迁移 020）保证。调用方收到它
// 应当回查既有行并返回**原 ack**，而不是报错给客户端 —— 离线补发撞到它是
// 正常路径，不是异常。
var ErrDuplicateClientMsg = errors.New("duplicate client_msg_id")

// FindByClientMsgID 按 (sender_id, client_msg_id) 取回既有消息，未找到返回 (nil, nil)。
func (r *MessageRepository) FindByClientMsgID(
	ctx context.Context,
	senderID uuid.UUID,
	clientMsgID string,
) (*model.Message, error) {
	var msg model.Message
	err := r.db.WithContext(ctx).
		Where("sender_id = ? AND client_msg_id = ? AND deleted_at IS NULL", senderID, clientMsgID).
		First(&msg).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	msg.CreatedAt = utcTime(msg.CreatedAt)
	msg.EditedAt = utcTimePtr(msg.EditedAt)
	return &msg, nil
}
```

在 `CreateWithSeq` 的 `tx.Create(msg)` 分支识别唯一冲突：

```go
		if err := tx.Create(msg).Error; err != nil {
			// 23505 = unique_violation。只有 client_msg_id 那条部分唯一索引会在
			// 正常业务流里被撞到（离线补发），转成哨兵错误交由上层回查既有行。
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" &&
				pgErr.ConstraintName == "idx_messages_sender_client_msg" {
				return ErrDuplicateClientMsg
			}
			return err
		}
```

> **驱动错误类型已核实，照写即可**：本仓 `gorm.io/driver/postgres v1.6.0` 底层走
> `jackc/pgx/v5 v5.10.0`，`github.com/jackc/pgx/v5/pgconn` 已在模块图内且可直接 import
> （已实测编译通过）。`lib/pq` 虽是直接依赖，但只用于 `pq.StringArray`，**不是** 错误类型来源。
>
> pgx/v5 当前在 `go.mod` 里标着 `// indirect`；本 task 首次直接 import 它之后，
> 跑一次 `go mod tidy` 会自动把它移出 indirect 块。**这是预期的 go.mod 改动**，
> 需要随本 task 一起提交。

- [ ] **Step 7: 实现 service 侧幂等短路**

`SendResult` 加字段：

```go
type SendResult struct {
	Message          *model.Message
	SenderNickname   string
	MemberIDs        []uuid.UUID
	MentionedMembers []uuid.UUID // SendContent 校验后回填，供 WS 层构造帧
	// Duplicate 为 true 表示这条 client_msg_id 之前已落库（离线补发撞上幂等索引）。
	// handler 应只回 ack 让客户端出队，**不重发 message.receive** —— 收件人
	// 第一次就已经收到了。语义与 RecallResult.Idempotent 一致。
	Duplicate bool
}
```

在 `SendContent` 里，`CreateWithSeq` 调用处改为：

```go
	if err := s.msgRepo.CreateWithSeq(ctx, msg); err != nil {
		if !errors.Is(err, repository.ErrDuplicateClientMsg) {
			return nil, fmt.Errorf("persist message: %w", err)
		}
		// 幂等路径：这条 client_msg_id 已落过库，回查原行并按重复处理。
		// 后续的 mention_unread 打标必须跳过 —— 第一次发送时已经打过了，
		// 再打一次会把对方已读掉的 @ 红点重新点亮。
		existing, findErr := s.msgRepo.FindByClientMsgID(ctx, senderID, clientMsgID)
		if findErr != nil {
			return nil, fmt.Errorf("lookup duplicate message: %w", findErr)
		}
		if existing == nil {
			// 唯一索引报了冲突却查不到行：只可能是原行已被软删，
			// 此时按正常错误上报，不伪造一个 ack。
			return nil, fmt.Errorf("duplicate client_msg_id but original not found")
		}
		return s.buildSendResult(ctx, existing, true)
	}
```

并把 `CreateWithSeq` 之后「mention_unread 打标 → 装载 sender → 组装 SendResult」
那一整段抽成 `buildSendResult(ctx, msg *model.Message, duplicate bool) (*SendResult, error)`，
**在 `duplicate == true` 时跳过 `SetMentionUnread`**（其余装配照常，因为 ack 需要
发送者昵称与成员列表）。

- [ ] **Step 8: WS handler 跳过重复扇出**

在 `ws/handler.go` 发完 ack 之后、构造 `receive` 之前插入：

```go
	// 幂等重发：收件人第一次就已经收到了，只回 ack 让发送端出队即可。
	// 再扇出一次会让在线成员的列表预览无端跳动（客户端按 message_id 去重后
	// 不会多渲染一条，但预览与未读计数的抖动是真实可见的）。
	if result.Duplicate {
		return
	}
```

- [ ] **Step 9: 跑测试确认通过**

Run: `cd server && go test ./internal/repository/ -run TestCreateWithSeqIdempotent -v`
Expected: PASS（6 个子测试全绿）

Run: `cd server && go test ./internal/service/ -run TestSendContentConcurrentSameClientMsgID -v`
Expected: PASS

- [ ] **Step 10: 全量后端回归（含竞态检测）**

Run: `cd server && go vet ./... && go test ./... && go test -race ./internal/ws/`
Expected: 全绿

- [ ] **Step 11: 同步 DB 文档**

在 `docs/DB_SCHEMA.md` 补迁移 020 与该部分唯一索引的用途说明。

- [ ] **Step 12: Commit**

```bash
git add server/go.mod server/go.sum \
        server/internal/database/migrations/020_idempotent_send.sql \
        server/internal/repository/message_repo.go server/internal/repository/message_repo_test.go \
        server/internal/service/message_service.go \
        server/internal/service/message_send_idempotent_test.go \
        server/internal/ws/handler.go docs/DB_SCHEMA.md
git commit -m "feat(server): 发送幂等化，离线补发不再产生重复消息"
```
