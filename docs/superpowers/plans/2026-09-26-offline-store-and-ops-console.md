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
- **ES2019 底线（区分「语法」与「API」，两者规则不同）**：
  - **语法**（`?.` / `??` / `||=` / 可选 catch 绑定等）**源码里可以写** —— `vite.config.ts` 的
    `build.target: es2019` 会把它们转译掉，实测现有源码已有 180+ 处 `??`。
    **前提是 `build.target` 必须保持 `es2019`**，不得改成 `chrome105` / `es2020`
    （旧 Android WebView 如 Chrome 74 解析期 SyntaxError → 白屏）。
  - **运行时 API**（`replaceAll` / `.at()` / `structuredClone` / `Object.hasOwn` /
    `Array.prototype.flat` 之外的新方法）**禁止裸用** —— 转译器不会给它们补实现，
    旧 WebView 上是运行期 TypeError。要用必须先确认目标 WebView 支持或加 polyfill。
  - **未经转译的静态资源**（`public/*.js`，原样复制进 dist）里两类都禁止。
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

---

## Stage C — 前端接线（L1 开始产生用户可见效果）

**贯穿 Stage C 的形状决定**：本地库 `LocalMessageRow.dto` 里存的是**已派生的
`ChatMessage`**，不是服务端 `MessageDTO`。理由：REST 路径经 `mapMessage` 得到
`ChatMessage`、WS 路径直接构造 `ChatMessage`，两条路已经汇聚在同一形状上；
存 DTO 反而要额外写一个「WS 帧 → DTO」转换器。冷启动读出来直接渲染。

**代价与对策**：`ChatMessage` 含两类**不可持久化**的瞬态字段，落库前必须剥掉——

- `image.localUrl` / `file.localUrl` / `voice.localUrl`：`URL.createObjectURL` 产物，
  刷新后即失效（`resetStores.ts` 的 `revokeAllLocalPreviews` 就在 revoke 它们），
  存下来会得到一批点不开的死链接。
- `status`：`"sending"` / `"failed"` 属于 outbox 的职责范围。已确认消息一律按
  `"sent"` 读回，真实已读态由 `applyRead` 按 seq 水位重算。

`localdb` 保持 `dto: unknown` 不认识 `ChatMessage`（依赖方向是 store → localdb，
反过来会成环）；形状知识放在 store 侧的适配器里。

### Task 10: 本地库会话单例 + `after_seq` 客户端

**Files:**

- Create: `packages/shared/src/localdb/session.ts`
- Create: `packages/shared/src/store/messageLocalSync.ts`
- Modify: `packages/shared/src/localdb/index.ts`
- Modify: `packages/shared/src/api/chat.ts`（追加 `fetchMessagesAfter`）
- Test: `packages/shared/src/__tests__/localdb.session.test.ts`
- Test: `packages/shared/src/__tests__/messageLocalSync.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `openLocalDb` / `deleteLocalDb`；Task 3 的 `LocalMessageRow`；既有 `ChatMessage` / `mapMessage` / `apiGet`
- Produces:
  - `initLocalStore(userId: string): Promise<boolean>` —— 打开并缓存句柄，返回是否可用
  - `localDb(): IDBDatabase | null` —— **同步**访问器，`null` 表示降级模式
  - `closeLocalStore(): void`
  - `purgeLocalStore(): Promise<void>` —— 关闭并删掉当前账号的库
  - `localRowOf(m: ChatMessage): LocalMessageRow` —— 剥掉瞬态字段
  - `chatMessageOf(row: LocalMessageRow): ChatMessage`
  - `mediaKeysOf(m: ChatMessage): string[]` —— 抽出该消息**独占**的对象 key（图片 / 文件 / 语音 / 视频本体 + 封面）。**不含贴纸**，见下
  - `fetchMessagesAfter(conversationId: string, afterSeq: number, limit: number, selfUserId: string): Promise<{ messages: ChatMessage[]; hasMore: boolean }>`

`localDb()` 刻意做成**同步**：store 的 action 里到处 `await` 一个句柄会把每个
写路径都变成异步，而降级模式下这些 await 全是白等。

- [ ] **Step 1: 写 session 失败测试**

创建 `packages/shared/src/__tests__/localdb.session.test.ts`：

```ts
import "fake-indexeddb/auto";
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  initLocalStore,
  localDb,
  closeLocalStore,
  purgeLocalStore,
  putMessages,
  listMessagesDesc,
  dbNameOf,
} from "../localdb";

afterEach(() => {
  closeLocalStore();
  vi.unstubAllGlobals();
});

describe("localdb/session", () => {
  it("未初始化时 localDb() 返回 null", () => {
    expect(localDb()).toBeNull();
  });

  it("初始化成功后 localDb() 返回句柄", async () => {
    expect(await initLocalStore("s1")).toBe(true);
    expect(localDb()).not.toBeNull();
    await purgeLocalStore();
  });

  it("IDB 不可用时初始化返回 false 且 localDb() 仍为 null（降级模式）", async () => {
    vi.stubGlobal("indexedDB", undefined);
    expect(await initLocalStore("s2")).toBe(false);
    expect(localDb()).toBeNull();
  });

  it("切换账号时关旧库开新库，数据不串", async () => {
    await initLocalStore("userA");
    await putMessages(localDb()!, [
      { id: "a1", conversationId: "c", seq: 1, dto: {}, mediaKeys: [] },
    ]);

    await initLocalStore("userB");
    expect(await listMessagesDesc(localDb()!, "c", 0, 10)).toHaveLength(0);

    await initLocalStore("userA");
    expect(await listMessagesDesc(localDb()!, "c", 0, 10)).toHaveLength(1);

    await purgeLocalStore();
    await initLocalStore("userB");
    await purgeLocalStore();
  });

  it("purgeLocalStore 删库并把句柄清成 null", async () => {
    await initLocalStore("s3");
    await putMessages(localDb()!, [
      { id: "x", conversationId: "c", seq: 1, dto: {}, mediaKeys: [] },
    ]);
    await purgeLocalStore();
    expect(localDb()).toBeNull();

    // 库真的没了：重开是空的
    await initLocalStore("s3");
    expect(await listMessagesDesc(localDb()!, "c", 0, 10)).toHaveLength(0);
    await purgeLocalStore();
  });

  it("未初始化时 purgeLocalStore 不抛错", async () => {
    await expect(purgeLocalStore()).resolves.toBeUndefined();
  });

  it("库名走 dbNameOf，便于外部核对", async () => {
    await initLocalStore("s4");
    expect(dbNameOf("s4")).toBe("yuanchat-l1-s4");
    await purgeLocalStore();
  });
});
```

- [ ] **Step 2: 写 `session.ts`**

```ts
/**
 * 本地库的进程内单例：持有「当前账号的库句柄」。
 *
 * 句柄访问器 localDb() 刻意是**同步**的 —— store 的每个写路径都 await 一个
 * 句柄会把它们全变成异步，而在降级模式（IDB 不可用）下这些 await 全是白等。
 */
import { openLocalDb, deleteLocalDb } from "./db";

let current: IDBDatabase | null = null;
let currentUserId: string | null = null;

/**
 * 打开指定账号的本地库并缓存句柄，返回本地库是否可用。
 *
 * 返回 false 即降级模式：调用方跳过一切本地读写，应用行为退化成纯内存
 * （与引入 L1 之前完全一致），**不得因此报错或阻塞登录**。
 */
export async function initLocalStore(userId: string): Promise<boolean> {
  if (currentUserId === userId && current !== null) return true;
  closeLocalStore();
  const db = await openLocalDb(userId);
  if (db === null) return false;
  current = db;
  currentUserId = userId;
  return true;
}

/** 当前账号的库句柄；null 表示降级模式，调用方应跳过本地读写。 */
export function localDb(): IDBDatabase | null {
  return current;
}

/** 关闭句柄（不删库）。切账号与登出都先走这里。 */
export function closeLocalStore(): void {
  if (current !== null) {
    current.close();
    current = null;
  }
  currentUserId = null;
}

/**
 * 关闭并删除当前账号的库。
 *
 * 登出/切号时调用：一个账号一个库，删库即彻底清掉跨账号残留。
 * 未初始化时是 no-op（登出路径可能在登录失败后被调用）。
 */
export async function purgeLocalStore(): Promise<void> {
  const userId = currentUserId;
  closeLocalStore();
  if (userId === null) return;
  await deleteLocalDb(userId);
}
```

在 `localdb/index.ts` 追加 `export * from "./session";`。

- [ ] **Step 3: 跑 session 测试确认通过**

Run: `cd packages/shared && LANG=C.UTF-8 npx vitest run src/__tests__/localdb.session.test.ts`
Expected: PASS（7 个用例）

- [ ] **Step 4: 写适配器失败测试**

创建 `packages/shared/src/__tests__/messageLocalSync.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { localRowOf, chatMessageOf, mediaKeysOf } from "../store/messageLocalSync";
import type { ChatMessage } from "../store/messageStore";

/** 造一条最小文本消息 */
function text(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    conversationId: "c1",
    kind: "text",
    isSelf: true,
    senderName: "我",
    text: "hi",
    time: "10:00",
    status: "sent",
    seq: 5,
    createdAtMs: 1_700_000_000_000,
    ...over,
  } as ChatMessage;
}

describe("localRowOf —— 剥掉瞬态字段", () => {
  it("剥掉 image.localUrl（刷新后即为死链）", () => {
    const m = text({
      kind: "image",
      image: { key: "k1", localUrl: "blob:abc", width: 10, height: 10 },
    } as Partial<ChatMessage>);
    const row = localRowOf(m);
    const back = chatMessageOf(row);
    expect(back.image!.localUrl).toBeUndefined();
    expect(back.image!.key).toBe("k1");
  });

  it("剥掉 file.localUrl 与 voice.localUrl", () => {
    const f = localRowOf(
      text({
        kind: "file",
        file: { key: "f1", name: "a.pdf", size: "3.2 MB", ext: "PDF", localUrl: "blob:f" },
      } as Partial<ChatMessage>),
    );
    expect(chatMessageOf(f).file!.localUrl).toBeUndefined();

    const v = localRowOf(
      text({
        kind: "voice",
        voice: { key: "v1", seconds: 3, wave: [], localUrl: "blob:v" },
      } as Partial<ChatMessage>),
    );
    expect(chatMessageOf(v).voice!.localUrl).toBeUndefined();
  });

  it("status 一律按 sent 读回（sending/failed 属 outbox 职责）", () => {
    expect(chatMessageOf(localRowOf(text({ status: "sending" }))).status).toBe("sent");
    expect(chatMessageOf(localRowOf(text({ status: "failed" }))).status).toBe("sent");
    expect(chatMessageOf(localRowOf(text({ status: "read" }))).status).toBe("sent");
  });

  it("id / conversationId / seq 原样保留，供索引与游标使用", () => {
    const row = localRowOf(text({ seq: 42 }));
    expect(row.id).toBe("m1");
    expect(row.conversationId).toBe("c1");
    expect(row.seq).toBe(42);
  });

  it("无 seq 的消息（乐观条目）seq 记为 0，由调用方负责不落库", () => {
    const row = localRowOf(text({ seq: undefined } as Partial<ChatMessage>));
    expect(row.seq).toBe(0);
  });

  it("往返不丢正文与时间", () => {
    const back = chatMessageOf(localRowOf(text()));
    expect(back.text).toBe("hi");
    expect(back.createdAtMs).toBe(1_700_000_000_000);
  });
});

describe("mediaKeysOf —— 撤回时要删哪些 blob", () => {
  it("文本消息无 key", () => {
    expect(mediaKeysOf(text())).toEqual([]);
  });

  it("图片取 image.key", () => {
    expect(
      mediaKeysOf(
        text({ kind: "image", image: { key: "k1", width: 1, height: 1 } } as Partial<ChatMessage>),
      ),
    ).toEqual(["k1"]);
  });

  it("视频同时取 key 与 thumbKey（封面也要随撤回删掉）", () => {
    const keys = mediaKeysOf(
      text({
        kind: "video",
        video: {
          key: "v1",
          thumbKey: "t1",
          name: "a.mp4",
          size: "1.0 MB",
          duration: 2,
          width: 1,
          height: 1,
        },
      } as Partial<ChatMessage>),
    );
    expect(keys.sort()).toEqual(["t1", "v1"]);
  });

  it("语音与文件各取自己的 key", () => {
    expect(
      mediaKeysOf(
        text({ kind: "voice", voice: { key: "v", seconds: 1, wave: [] } } as Partial<ChatMessage>),
      ),
    ).toEqual(["v"]);
    expect(
      mediaKeysOf(
        text({
          kind: "file",
          file: { key: "f", name: "n", size: "1 B", ext: "TXT" },
        } as Partial<ChatMessage>),
      ),
    ).toEqual(["f"]);
  });

  it("贴纸 key 不算进来（内容寻址共享对象，撤回不能删别处在用的图）", () => {
    expect(
      mediaKeysOf(
        text({
          kind: "sticker",
          sticker: { stickerId: "s1", key: "shared-sticker-key", width: 1, height: 1 },
        } as Partial<ChatMessage>),
      ),
    ).toEqual([]);
  });

  it("缺 key 的媒体消息不产出空字符串（否则会去删 key 为空的行）", () => {
    expect(
      mediaKeysOf(text({ kind: "image", image: { width: 1, height: 1 } } as Partial<ChatMessage>)),
    ).toEqual([]);
  });
});
```

- [ ] **Step 5: 写 `messageLocalSync.ts`**

```ts
/**
 * `ChatMessage` 与本地库行之间的适配。
 *
 * 放在 store 侧而不是 localdb 侧：依赖方向是 store → localdb，
 * 反过来让 localdb 认识 ChatMessage 会成环。
 */
import type { LocalMessageRow } from "../localdb";
import type { ChatMessage } from "./messageStore";

/**
 * 抽出该消息引用的对象存储 key。
 *
 * 撤回与保留窗口淘汰要靠它决定删哪些 blob，**视频必须连封面 thumbKey 一起给**
 * ——只删本体会留下一个能被渲染命中的孤儿封面。
 * 缺 key 的媒体消息返回空数组，不能产出空字符串（那会去删 key 为空的行）。
 */
export function mediaKeysOf(m: ChatMessage): string[] {
  const keys: string[] = [];
  const push = (k?: string) => {
    if (typeof k === "string" && k !== "") keys.push(k);
  };
  if (m.image) push(m.image.key);
  if (m.file) push(m.file.key);
  if (m.voice) push(m.voice.key);
  if (m.video) {
    push(m.video.key);
    push(m.video.thumbKey);
  }
  // **刻意不含 sticker**：贴纸对象是内容寻址去重的**共享**资源，同一个 key
  // 被大量消息、收藏面板与表情选择器共用。把它算进「这条消息的 blob」，
  // 撤回一条贴纸消息就会删掉别处仍在渲染的那张图。贴纸缓存的回收交给
  // LRU 配额淘汰，不绑消息生命周期。
  return keys;
}

/** 去掉一个媒体载荷里的 localUrl（blob: URL 刷新后即失效，存下来是死链）。 */
function stripLocalUrl<T extends { localUrl?: string }>(payload: T | undefined): T | undefined {
  if (payload === undefined) return undefined;
  const copy = { ...payload };
  delete copy.localUrl;
  return copy;
}

/**
 * 把内存消息转成可落盘的行。
 *
 * 剥掉两类瞬态字段：blob: 形式的 localUrl（刷新即失效），以及
 * sending/failed 状态（属 outbox 职责，已确认消息一律按 sent 存）。
 */
export function localRowOf(m: ChatMessage): LocalMessageRow {
  const persisted: ChatMessage = {
    ...m,
    status: "sent",
    image: stripLocalUrl(m.image),
    file: stripLocalUrl(m.file),
    voice: stripLocalUrl(m.voice),
  };
  return {
    id: m.id,
    conversationId: m.conversationId,
    seq: typeof m.seq === "number" ? m.seq : 0,
    dto: persisted,
    mediaKeys: mediaKeysOf(m),
  };
}

/** 把本地行读回成内存消息。 */
export function chatMessageOf(row: LocalMessageRow): ChatMessage {
  return row.dto as ChatMessage;
}
```

> **已核实**：`packages/shared/tsconfig.json` 只开了 `strict` + `noUnusedLocals`
> （**未开** `exactOptionalPropertyTypes`），因此 `delete copy.localUrl` 对可选属性合法，
> 上面的写法可直接用。

- [ ] **Step 6: 写 `fetchMessagesAfter`**

在 `packages/shared/src/api/chat.ts` 的 `fetchMessages` 之后追加：

```ts
/**
 * 增量补齐：拉取 seq > afterSeq 的消息（服务端返回**升序**，无需 reverse）。
 *
 * 与 `fetchMessages` 的区别只在方向：前者向前翻历史（降序），本函数向后补
 * 断线期间的空洞（升序）。两者的 `before_seq` / `after_seq` 在服务端互斥。
 */
export async function fetchMessagesAfter(
  conversationId: string,
  afterSeq: number,
  limit: number,
  selfUserId: string,
): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
  const data = await apiGet<{ messages: MessageDTO[]; has_more: boolean }>(
    "/api/v1/conversations/" +
      conversationId +
      "/messages?after_seq=" +
      afterSeq +
      "&limit=" +
      limit,
  );
  // 服务端已按 seq 升序返回，与前端展示序一致，**不要 reverse**
  const messages = (data.messages || []).map((m) => mapMessage(m, selfUserId));
  backfillQuotes(messages);
  return { messages, hasMore: !!data.has_more };
}
```

- [ ] **Step 7: 跑适配器测试确认通过**

Run: `cd packages/shared && LANG=C.UTF-8 npx vitest run src/__tests__/messageLocalSync.test.ts src/__tests__/localdb.session.test.ts`
Expected: PASS（18 个用例）

- [ ] **Step 8: 补 MSW mock**

在 `packages/shared/src/mocks/` 里给 `after_seq` 补 handler（沿用既有消息历史 handler 的写法，
按 `after_seq` 返回升序切片 + `has_more`）。**MSW 必须覆盖正常/空/错误三态**
（加载态由前端自身控制），否则 E2E 与 mock 模式会打到真网络。

- [ ] **Step 9: 类型检查 + Commit**

Run: `pnpm --filter @yuanchat/shared typecheck`
Expected: 0 错误

```bash
git add packages/shared/src/localdb packages/shared/src/store/messageLocalSync.ts \
        packages/shared/src/api/chat.ts packages/shared/src/mocks \
        packages/shared/src/__tests__/localdb.session.test.ts \
        packages/shared/src/__tests__/messageLocalSync.test.ts
git commit -m "feat(localdb): 本地库会话单例与 after_seq 客户端"
```

---

### Task 11: messageStore 双写、冷启动水合与空洞补齐

**Files:**

- Modify: `packages/shared/src/store/messageLocalSync.ts`（追加持久化/水合/对账）
- Modify: `packages/shared/src/store/messageStore.ts`（`receiveMessage` / `loadHistory` / `loadMore` / `applyAck` 挂钩）
- Test: `packages/shared/src/__tests__/messageReconcile.test.ts`

**Interfaces:**

- Consumes: Task 10 的 `localDb` / `localRowOf` / `chatMessageOf` / `fetchMessagesAfter`；Task 3 的 `putMessages` / `listMessagesDesc` / `advanceWatermark` / `maxStoredSeq`；Task 2 的 `getConversation` / `patchConversation`
- Produces:
  - `RECONCILE_PAGE = 50` / `RECONCILE_MAX_ROUNDS = 20`
  - `persistMessages(convId: string, msgs: ChatMessage[]): void` —— **fire-and-forget**，内部吞掉全部异常
  - `hydrateConversation(convId: string, limit?: number): Promise<ChatMessage[]>` —— 本地读；无库或无数据返回 `[]`
  - `noteIncoming(convId: string, seq: number): Promise<boolean>` —— 推进水位，返回**是否发现空洞**
  - `reconcileConversation(convId: string, selfUserId: string): Promise<ChatMessage[]>` —— 三道闸门的 `after_seq` 循环，返回补回来的消息

**`persistMessages` 必须 fire-and-forget。** `receiveMessage` 今天是同步的、由 WS 帧处理器
直接调用；把它改成 async 会波及整条帧处理链。落盘失败只能吞（降级模式本来就没库）。

**三道闸门缺一不可**：`has_more == false` **或** 已补满保留窗口 500 **或** 循环达 20 轮。
只靠 `has_more` 时，一个长期离线的账号会在进会话瞬间拉几千条并撑爆本地库。

- [ ] **Step 1: 写失败测试**

创建 `packages/shared/src/__tests__/messageReconcile.test.ts`：

```ts
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  initLocalStore,
  purgeLocalStore,
  localDb,
  putConversations,
  getConversation,
  putMessages,
} from "../localdb";
import {
  persistMessages,
  hydrateConversation,
  noteIncoming,
  reconcileConversation,
  localRowOf,
  RECONCILE_PAGE,
  RECONCILE_MAX_ROUNDS,
} from "../store/messageLocalSync";
import type { ChatMessage } from "../store/messageStore";

const CONV = "c1";
const SELF = "me";

const fetchAfter = vi.hoisted(() => vi.fn());
vi.mock("../api/chat", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, fetchMessagesAfter: fetchAfter };
});

function msg(seq: number): ChatMessage {
  return {
    id: "m" + seq,
    conversationId: CONV,
    kind: "text",
    isSelf: false,
    text: "t" + seq,
    time: "10:00",
    seq,
    status: "sent",
  } as ChatMessage;
}

/** 落一行会话投影，水位为 maxSeq */
async function seedConv(maxSeq: number): Promise<void> {
  await putConversations(localDb()!, [
    { id: CONV, dto: {}, maxSeq, clearedBeforeSeq: 0, updatedAt: 1 },
  ]);
}

beforeEach(async () => {
  fetchAfter.mockReset();
  await initLocalStore("reconcile-test");
});

afterEach(async () => {
  await purgeLocalStore();
});

describe("闸门常量", () => {
  it("每页 50、最多 20 轮", () => {
    expect(RECONCILE_PAGE).toBe(50);
    expect(RECONCILE_MAX_ROUNDS).toBe(20);
  });
});

describe("persistMessages / hydrateConversation", () => {
  it("落盘后能水合回来，按 seq 升序", async () => {
    persistMessages(CONV, [msg(2), msg(1), msg(3)]);
    await vi.waitFor(async () => {
      expect((await hydrateConversation(CONV)).map((m) => m.seq)).toEqual([1, 2, 3]);
    });
  });

  it("无 seq 的乐观条目不落盘（它属 outbox 职责）", async () => {
    persistMessages(CONV, [{ ...msg(1), seq: undefined } as ChatMessage]);
    await vi.waitFor(async () => {
      expect(await hydrateConversation(CONV)).toHaveLength(0);
    });
  });

  it("降级模式（无库）下落盘与水合都不抛错", async () => {
    await purgeLocalStore();
    expect(() => persistMessages(CONV, [msg(1)])).not.toThrow();
    await expect(hydrateConversation(CONV)).resolves.toEqual([]);
    await initLocalStore("reconcile-test");
  });

  it("落盘失败被吞掉，不向上抛", async () => {
    vi.spyOn(localDb()!, "transaction").mockImplementation((() => {
      throw new DOMException("boom", "UnknownError");
    }) as IDBDatabase["transaction"]);
    expect(() => persistMessages(CONV, [msg(1)])).not.toThrow();
  });
});

describe("noteIncoming —— 水位推进与空洞判定", () => {
  it("连续到达推进水位、不报空洞", async () => {
    await seedConv(10);
    expect(await noteIncoming(CONV, 11)).toBe(false);
    expect((await getConversation(localDb()!, CONV))!.maxSeq).toBe(11);
  });

  it("跳号报空洞且水位不动（这条钉住永久丢空洞的缺陷）", async () => {
    await seedConv(10);
    expect(await noteIncoming(CONV, 15)).toBe(true);
    expect((await getConversation(localDb()!, CONV))!.maxSeq).toBe(10);
  });

  it("重复帧不报空洞、水位不动", async () => {
    await seedConv(10);
    expect(await noteIncoming(CONV, 10)).toBe(false);
    expect((await getConversation(localDb()!, CONV))!.maxSeq).toBe(10);
  });

  it("会话行不存在时不报空洞（还没拉过列表，不该触发补齐）", async () => {
    expect(await noteIncoming("unknown-conv", 5)).toBe(false);
  });
});

describe("reconcileConversation —— 三道闸门", () => {
  it("has_more=false 时一轮即停", async () => {
    await seedConv(10);
    fetchAfter.mockResolvedValueOnce({ messages: [msg(11), msg(12)], hasMore: false });

    const got = await reconcileConversation(CONV, SELF);

    expect(fetchAfter).toHaveBeenCalledTimes(1);
    expect(fetchAfter).toHaveBeenCalledWith(CONV, 10, RECONCILE_PAGE, SELF);
    expect(got.map((m) => m.seq)).toEqual([11, 12]);
    expect((await getConversation(localDb()!, CONV))!.maxSeq).toBe(12);
  });

  // Review Focus 2：空结果不能清空已渲染的消息
  it("服务端回空数组时不动本地已有消息，也不动水位", async () => {
    await seedConv(3);
    await putMessages(localDb()!, [msg(1), msg(2), msg(3)].map(localRowOf));
    fetchAfter.mockResolvedValueOnce({ messages: [], hasMore: false });

    const got = await reconcileConversation(CONV, SELF);

    expect(got).toEqual([]);
    expect((await hydrateConversation(CONV)).map((m) => m.seq)).toEqual([1, 2, 3]);
    expect((await getConversation(localDb()!, CONV))!.maxSeq).toBe(3);
  });

  it("has_more=true 时按游标续拉，游标取上一页最大 seq", async () => {
    await seedConv(0);
    fetchAfter
      .mockResolvedValueOnce({ messages: [msg(1), msg(2)], hasMore: true })
      .mockResolvedValueOnce({ messages: [msg(3)], hasMore: false });

    await reconcileConversation(CONV, SELF);

    expect(fetchAfter).toHaveBeenNthCalledWith(1, CONV, 0, RECONCILE_PAGE, SELF);
    expect(fetchAfter).toHaveBeenNthCalledWith(2, CONV, 2, RECONCILE_PAGE, SELF);
  });

  it("循环轮数达上限即停（防长期离线账号把本地库撑爆）", async () => {
    await seedConv(0);
    // 永远 hasMore=true：只靠 has_more 会无限循环
    let n = 0;
    fetchAfter.mockImplementation(() => {
      n++;
      return Promise.resolve({ messages: [msg(n)], hasMore: true });
    });

    await reconcileConversation(CONV, SELF);

    expect(fetchAfter).toHaveBeenCalledTimes(RECONCILE_MAX_ROUNDS);
  });

  it("补满保留窗口即停，即使 has_more 仍为 true", async () => {
    await seedConv(0);
    let base = 0;
    fetchAfter.mockImplementation(() => {
      const page = Array.from({ length: RECONCILE_PAGE }, (_, i) => msg(base + i + 1));
      base += RECONCILE_PAGE;
      return Promise.resolve({ messages: page, hasMore: true });
    });

    await reconcileConversation(CONV, SELF);

    // 500 / 50 = 10 轮就该停，远小于 20 轮上限
    expect(fetchAfter).toHaveBeenCalledTimes(10);
  });

  it("网络失败时返回已补到的部分，不抛错", async () => {
    await seedConv(0);
    fetchAfter
      .mockResolvedValueOnce({ messages: [msg(1)], hasMore: true })
      .mockRejectedValueOnce(new Error("offline"));

    const got = await reconcileConversation(CONV, SELF);

    expect(got.map((m) => m.seq)).toEqual([1]);
    expect((await getConversation(localDb()!, CONV))!.maxSeq).toBe(1);
  });

  it("降级模式下直接返回空，不打网络", async () => {
    await purgeLocalStore();
    expect(await reconcileConversation(CONV, SELF)).toEqual([]);
    expect(fetchAfter).not.toHaveBeenCalled();
    await initLocalStore("reconcile-test");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/shared && LANG=C.UTF-8 npx vitest run src/__tests__/messageReconcile.test.ts`
Expected: FAIL —— `persistMessages is not a function`

- [ ] **Step 3: 在 `messageLocalSync.ts` 追加实现**

```ts
import { fetchMessagesAfter } from "../api/chat";
import {
  localDb,
  putMessages,
  listMessagesDesc,
  advanceWatermark,
  getConversation,
  patchConversation,
  RETENTION_PER_CONV,
} from "../localdb";

/** 每轮补齐拉取的条数，与服务端 limit 上限 100 留有余量。 */
export const RECONCILE_PAGE = 50;

/** 补齐循环的硬上限轮数。 */
export const RECONCILE_MAX_ROUNDS = 20;

/**
 * 把消息写入本地库。**fire-and-forget**：不返回 Promise、内部吞掉全部异常。
 *
 * `receiveMessage` 今天是同步的、由 WS 帧处理器直接调用；把它改成 async 会波及
 * 整条帧处理链。落盘失败只能吞 —— 降级模式本来就没有库，而落盘是投影、不是真源。
 *
 * 无 seq 的乐观条目**不落盘**：它们属 outbox 的职责范围，
 * 混进 messages store 会污染 [conversationId, seq] 索引。
 */
export function persistMessages(convId: string, msgs: ChatMessage[]): void {
  const db = localDb();
  if (db === null) return;
  const rows = msgs
    .filter((m) => typeof m.seq === "number" && m.seq > 0)
    .map((m) => localRowOf({ ...m, conversationId: convId }));
  if (rows.length === 0) return;
  try {
    void putMessages(db, rows).catch(() => {
      // 落盘失败不影响在线功能，静默
    });
  } catch {
    // transaction() 本身抛错（配额为 0、库已关闭）同样静默
  }
}

/** 从本地库水合某会话最近的消息；无库或无数据返回空数组。 */
export async function hydrateConversation(
  convId: string,
  limit: number = RECONCILE_PAGE,
): Promise<ChatMessage[]> {
  const db = localDb();
  if (db === null) return [];
  try {
    const rows = await listMessagesDesc(db, convId, 0, limit);
    return rows.map(chatMessageOf);
  } catch {
    return [];
  }
}

/**
 * 记录一条新到达消息的 seq，推进「已连续确认到」的水位。
 *
 * 返回 true 表示发现空洞，调用方应触发 `reconcileConversation`。
 * 会话行还不存在时返回 false —— 列表都没拉过，此时触发补齐没有意义。
 */
export async function noteIncoming(convId: string, seq: number): Promise<boolean> {
  const db = localDb();
  if (db === null) return false;
  try {
    const conv = await getConversation(db, convId);
    if (conv === null) return false;
    const { next, gap } = advanceWatermark(conv.maxSeq, seq);
    if (next !== conv.maxSeq) await patchConversation(db, convId, { maxSeq: next });
    return gap;
  } catch {
    return false;
  }
}

/**
 * 用 `after_seq` 从本地水位往后补齐空洞，返回补回来的消息（升序）。
 *
 * 三道闸门缺一不可：`hasMore === false` **或** 累计已达保留窗口 **或** 轮数达上限。
 * 只靠 hasMore 时，一个长期离线的账号会在进会话瞬间拉几千条并撑爆本地库。
 *
 * 任一轮网络失败即停并返回已补到的部分：补齐是尽力而为的，失败不该让进会话失败。
 * **服务端回空数组时不动本地任何数据** —— 空结果表示「没有更新」，
 * 误当成「服务端说这个会话是空的」去清本地就是把用户的历史擦掉。
 */
export async function reconcileConversation(
  convId: string,
  selfUserId: string,
): Promise<ChatMessage[]> {
  const db = localDb();
  if (db === null) return [];
  const conv = await getConversation(db, convId);
  let cursor = conv === null ? 0 : conv.maxSeq;
  const collected: ChatMessage[] = [];

  for (let round = 0; round < RECONCILE_MAX_ROUNDS; round++) {
    let page: { messages: ChatMessage[]; hasMore: boolean };
    try {
      page = await fetchMessagesAfter(convId, cursor, RECONCILE_PAGE, selfUserId);
    } catch {
      break;
    }
    if (page.messages.length === 0) break;

    persistMessages(convId, page.messages);
    collected.push(...page.messages);

    const last = page.messages[page.messages.length - 1];
    cursor = typeof last.seq === "number" ? last.seq : cursor;
    // 补齐过程是连续的，故水位可直接推到本页末尾
    await patchConversation(db, convId, { maxSeq: cursor });

    if (!page.hasMore) break;
    if (collected.length >= RETENTION_PER_CONV) break;
  }
  return collected;
}
```

- [ ] **Step 4: messageStore 挂钩**

四处改动，**每处都只加一行、不改既有控制流**：

1. `receiveMessage` 末尾（追加进 `messagesByConv` 之后）：

```ts
// 双写本地 + 空洞探测。fire-and-forget：帧处理链保持同步。
persistMessages(msg.conversationId, [msg]);
if (typeof msg.seq === "number") {
  void noteIncoming(msg.conversationId, msg.seq).then((gap) => {
    // 发现空洞立即补齐：帧丢失或应用启动前的窗口都会造成跳号
    if (gap) void reconcileConversation(msg.conversationId, selfUserId());
  });
}
```

2. `loadHistory` 开头（`if (mockMode) return;` 之后、现有「已有消息则跳过」判断**之前**）：

```ts
// 冷启动先渲染本地：断网时这是用户唯一能看到的内容
if ((get().messagesByConv[conversationId] ?? []).length === 0) {
  const local = await hydrateConversation(conversationId);
  if (local.length > 0) {
    set((s) => ({ messagesByConv: { ...s.messagesByConv, [conversationId]: local } }));
  }
}
```

3. `loadHistory` 的 `fetchMessages` 成功分支之后追加 `persistMessages(conversationId, messages);`；
   `loadMore` 的成功分支同样追加一行。

4. `applyAck` 里，把已确认消息落盘（seq 此时才有）：在现有 `set(...)` 之后追加

```ts
// ack 到达后该消息才有 seq，此刻才能落进 messages store
const confirmed = (get().messagesByConv[convId] ?? []).find((m) => m.id === messageId);
if (confirmed !== undefined) persistMessages(convId, [confirmed]);
```

> **`loadHistory` 的既有短路必须保留在本地水合之后**：原代码是
> `if (已有消息) return;`。水合插在它之前，否则第二次进会话时会跳过水合直接返回，
> 而第一次进会话（列表为空）走完水合后又被短路挡住不去拉网络 —— 两种顺序都错，
> 正确顺序是**先水合、再判断是否还需要打网络**。

- [ ] **Step 5: 跑测试确认通过 + 回归 messageStore 既有测试**

Run: `cd packages/shared && LANG=C.UTF-8 npx vitest run src/__tests__/messageReconcile.test.ts`
Expected: PASS（15 个用例）

Run: `cd packages/shared && LANG=C.UTF-8 npx vitest run`
Expected: PASS，既有用例零失败（重点看 `messageStore` / `chatApi` 相关）

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/store packages/shared/src/__tests__/messageReconcile.test.ts
git commit -m "feat(localdb): 消息双写、冷启动水合与空洞增量补齐"
```

---

### Task 12: 会话列表双写、冷启动渲染与僵尸会话清理

**Files:**

- Create: `packages/shared/src/store/conversationLocalSync.ts`
- Modify: `packages/shared/src/store/conversationStore.ts`（`loadConversations` / `addConversation` / `updateConversation` / `removeConversation` 挂钩）
- Test: `packages/shared/src/__tests__/conversationLocalSync.test.ts`

**Interfaces:**

- Consumes: Task 2 的 `replaceConversations` / `putConversations` / `listConversations` / `deleteConversations` / `getConversation`；Task 4 的 `dropMessages`；Task 10 的 `localDb`
- Produces:
  - `persistConversationList(list: Conversation[]): Promise<void>` —— **整表替换**，并清掉不在新列表里的会话的本地消息
  - `hydrateConversationList(): Promise<Conversation[]>`
  - `persistConversationPatch(id: string, conv: Conversation): void` —— fire-and-forget
  - `forgetConversation(id: string): Promise<void>` —— 删会话行 + 删其全部本地消息与 blob

**Review Focus 3 落在这里。** 服务端列表回来时，本地有、列表里没有的会话**必须删掉**：
那是已解散的群或自己已被踢出的会话，留着就是一个点进去就 403 的僵尸条目。
而且它的本地消息与 blob 也要一并清 —— 否则用户被踢出群之后，**断网仍能翻那个群的历史**。

- [ ] **Step 1: 写失败测试**

创建 `packages/shared/src/__tests__/conversationLocalSync.test.ts`：

```ts
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  initLocalStore,
  purgeLocalStore,
  localDb,
  putMessages,
  putMedia,
  getMedia,
  listMessagesDesc,
} from "../localdb";
import {
  persistConversationList,
  hydrateConversationList,
  persistConversationPatch,
  forgetConversation,
} from "../store/conversationLocalSync";
import type { Conversation } from "../store/conversationStore";

function conv(id: string, name = "会话"): Conversation {
  return { id, name, type: "group", lastSeq: 0, unread: 0 } as Conversation;
}

beforeEach(async () => {
  await initLocalStore("conv-sync-test");
});

afterEach(async () => {
  await purgeLocalStore();
});

describe("列表落盘与水合", () => {
  it("落盘后水合回同一批会话", async () => {
    await persistConversationList([conv("a"), conv("b")]);
    expect((await hydrateConversationList()).map((c) => c.id).sort()).toEqual(["a", "b"]);
  });

  it("水合保留服务端 DTO 的全部字段", async () => {
    await persistConversationList([{ ...conv("a"), name: "特定名字", unread: 7 } as Conversation]);
    const got = (await hydrateConversationList())[0];
    expect(got.name).toBe("特定名字");
    expect(got.unread).toBe(7);
  });

  it("降级模式下落盘与水合都不抛错", async () => {
    await purgeLocalStore();
    await expect(persistConversationList([conv("a")])).resolves.toBeUndefined();
    await expect(hydrateConversationList()).resolves.toEqual([]);
    await initLocalStore("conv-sync-test");
  });

  it("空列表落盘会清空本地（服务端确实回了零会话）", async () => {
    await persistConversationList([conv("a")]);
    await persistConversationList([]);
    expect(await hydrateConversationList()).toEqual([]);
  });
});

// Review Focus 3：僵尸会话必须连消息与 blob 一起清掉
describe("僵尸会话清理", () => {
  it("新列表里没有的会话被删掉", async () => {
    await persistConversationList([conv("a"), conv("gone")]);
    await persistConversationList([conv("a")]);
    expect((await hydrateConversationList()).map((c) => c.id)).toEqual(["a"]);
  });

  it("被删会话的本地消息与 blob 一并清掉（否则被踢出群后断网仍能翻历史）", async () => {
    await persistConversationList([conv("kicked")]);
    await putMedia(localDb()!, "grp-img", new ArrayBuffer(100), "image/jpeg");
    await putMessages(localDb()!, [
      { id: "m1", conversationId: "kicked", seq: 1, dto: {}, mediaKeys: ["grp-img"] },
    ]);

    await persistConversationList([]); // 服务端已不含该会话

    expect(await listMessagesDesc(localDb()!, "kicked", 0, 10)).toHaveLength(0);
    expect(await getMedia(localDb()!, "grp-img")).toBeNull();
  });

  it("仍在列表里的会话，其消息不受影响", async () => {
    await persistConversationList([conv("keep"), conv("drop")]);
    await putMessages(localDb()!, [
      { id: "k1", conversationId: "keep", seq: 1, dto: {}, mediaKeys: [] },
      { id: "d1", conversationId: "drop", seq: 1, dto: {}, mediaKeys: [] },
    ]);

    await persistConversationList([conv("keep")]);

    expect(await listMessagesDesc(localDb()!, "keep", 0, 10)).toHaveLength(1);
    expect(await listMessagesDesc(localDb()!, "drop", 0, 10)).toHaveLength(0);
  });

  it("水位不因整表替换而丢失（同一会话再次落盘保留 maxSeq）", async () => {
    await persistConversationList([conv("a")]);
    await localDb()!; // 显式水位改写
    const db = localDb()!;
    const tx = db.transaction("conversations", "readwrite");
    const store = tx.objectStore("conversations");
    const cur = await new Promise<Record<string, unknown>>((res) => {
      const r = store.get("a");
      r.onsuccess = () => res(r.result as Record<string, unknown>);
    });
    store.put({ ...cur, maxSeq: 42 });
    await new Promise<void>((res) => {
      tx.oncomplete = () => res();
    });

    await persistConversationList([conv("a")]);

    const after = await new Promise<Record<string, unknown>>((res) => {
      const t2 = localDb()!.transaction("conversations", "readonly");
      const r = t2.objectStore("conversations").get("a");
      r.onsuccess = () => res(r.result as Record<string, unknown>);
    });
    expect(after.maxSeq).toBe(42);
  });
});

describe("局部更新与显式遗忘", () => {
  it("persistConversationPatch 更新单条且不抛错", async () => {
    await persistConversationList([conv("a")]);
    persistConversationPatch("a", { ...conv("a"), name: "改名后" } as Conversation);
    await new Promise((r) => setTimeout(r, 10));
    expect((await hydrateConversationList())[0].name).toBe("改名后");
  });

  it("forgetConversation 删会话与其消息（主动退群/解散走它）", async () => {
    await persistConversationList([conv("a")]);
    await putMessages(localDb()!, [
      { id: "m1", conversationId: "a", seq: 1, dto: {}, mediaKeys: [] },
    ]);
    await forgetConversation("a");
    expect(await hydrateConversationList()).toEqual([]);
    expect(await listMessagesDesc(localDb()!, "a", 0, 10)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/shared && LANG=C.UTF-8 npx vitest run src/__tests__/conversationLocalSync.test.ts`
Expected: FAIL —— `persistConversationList is not a function`

- [ ] **Step 3: 写 `conversationLocalSync.ts`**

```ts
/**
 * 会话列表投影的落盘与水合。
 *
 * 与消息侧同一姿态：本地是投影、服务端是真源。
 */
import {
  localDb,
  listConversations,
  replaceConversations,
  putConversations,
  getConversation,
  dropMessages,
  listMessagesDesc,
  type LocalConversationRow,
} from "../localdb";
import type { Conversation } from "./conversationStore";

/** 取某会话在本地的全部消息 id（用于连带清理）。 */
async function allMessageIdsOf(db: IDBDatabase, convId: string): Promise<string[]> {
  // 取一个远超保留窗口的 limit，一次拿全（保留窗口上限 500，这里给足余量）
  const rows = await listMessagesDesc(db, convId, 0, 10_000);
  return rows.map((r) => r.id);
}

/**
 * 整表替换会话列表，并清掉**不在新列表里**的会话的消息与 blob。
 *
 * 本地有、服务端列表没有的会话 = 已解散的群或自己已被踢出。留着它是一个点进去
 * 就 403 的僵尸条目；而留着它的本地消息更糟 —— 用户被踢出群之后，
 * **断网仍能翻那个群的全部历史**，等于绕过了成员校验。
 *
 * 同一会话再次落盘时**保留既有水位**（maxSeq / clearedBeforeSeq）：
 * 整表替换的是服务端 DTO 快照，水位是本地状态，冲掉它会让下次补齐从 0 开始全量重拉。
 */
export async function persistConversationList(list: Conversation[]): Promise<void> {
  const db = localDb();
  if (db === null) return;
  try {
    const keep = new Set(list.map((c) => c.id));
    const existing = await listConversations(db);

    // 先清僵尸会话的消息与 blob（会话行本身由 replaceConversations 清掉）
    for (const row of existing) {
      if (keep.has(row.id)) continue;
      const ids = await allMessageIdsOf(db, row.id);
      if (ids.length > 0) await dropMessages(db, ids);
    }

    const prev = new Map(existing.map((r) => [r.id, r]));
    const rows: LocalConversationRow[] = list.map((c) => {
      const old = prev.get(c.id);
      return {
        id: c.id,
        dto: c,
        // 水位是本地状态，不能被服务端 DTO 快照冲掉
        maxSeq: old === undefined ? 0 : old.maxSeq,
        clearedBeforeSeq: old === undefined ? 0 : old.clearedBeforeSeq,
        updatedAt: Date.now(),
      };
    });
    await replaceConversations(db, rows);
  } catch {
    // 落盘失败不影响在线功能
  }
}

/** 从本地水合会话列表；无库或无数据返回空数组。 */
export async function hydrateConversationList(): Promise<Conversation[]> {
  const db = localDb();
  if (db === null) return [];
  try {
    const rows = await listConversations(db);
    return rows.map((r) => r.dto as Conversation);
  } catch {
    return [];
  }
}

/** 单条会话落盘（新建/改名/未读变化）。fire-and-forget。 */
export function persistConversationPatch(id: string, conv: Conversation): void {
  const db = localDb();
  if (db === null) return;
  void (async () => {
    try {
      const old = await getConversation(db, id);
      await putConversations(db, [
        {
          id,
          dto: conv,
          maxSeq: old === null ? 0 : old.maxSeq,
          clearedBeforeSeq: old === null ? 0 : old.clearedBeforeSeq,
          updatedAt: Date.now(),
        },
      ]);
    } catch {
      // 静默
    }
  })();
}

/** 显式遗忘一个会话（主动退群/解散）：删会话行 + 删其全部消息与 blob。 */
export async function forgetConversation(id: string): Promise<void> {
  const db = localDb();
  if (db === null) return;
  try {
    const ids = await allMessageIdsOf(db, id);
    if (ids.length > 0) await dropMessages(db, ids);
    const rest = (await listConversations(db)).filter((r) => r.id !== id);
    await replaceConversations(db, rest);
  } catch {
    // 静默
  }
}
```

- [ ] **Step 4: conversationStore 挂钩**

```ts
  loadConversations: async () => {
    set({ loading: true });
    // 冷启动先渲染本地：断网时这是用户唯一能看到的内容
    if (get().conversations.length === 0) {
      const local = await hydrateConversationList();
      if (local.length > 0) set({ conversations: local });
    }
    try {
      const conversations = await fetchConversations();
      set({ conversations, loading: false });
      // 整表替换 + 清僵尸会话（含其本地消息与 blob）
      void persistConversationList(conversations);
    } catch {
      // 失败时保留已水合的本地列表，只关掉 loading
      set({ loading: false });
    }
  },
```

`addConversation` / `updateConversation` 末尾各加一行
`persistConversationPatch(id, 更新后的会话)`；`removeConversation` 末尾加
`void forgetConversation(id)`。

> **`catch` 分支刻意不清空 `conversations`**：原实现只 `set({ loading: false })`，
> 这正是我们要的 —— 断网时保留水合出来的本地列表。**不要顺手改成清空**。

- [ ] **Step 5: 跑测试 + 回归**

Run: `cd packages/shared && LANG=C.UTF-8 npx vitest run src/__tests__/conversationLocalSync.test.ts src/__tests__/conversationStore.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/store packages/shared/src/__tests__/conversationLocalSync.test.ts
git commit -m "feat(localdb): 会话列表双写与僵尸会话连带清理"
```

---

### Task 13: 离线发送队列接线与上线补发

**Files:**

- Create: `packages/shared/src/store/outboxSync.ts`
- Modify: `packages/shared/src/store/messageStore.ts`（`sendText` / `retrySend` / `applyAck` 挂钩）
- Modify: `packages/shared/src/ws/chatSocket.ts`（连上后触发补发）
- Test: `packages/shared/src/__tests__/outboxSync.test.ts`

**Interfaces:**

- Consumes: Task 6 的 `enqueueOutbox` / `listOutbox` / `markOutbox` / `settleOutbox` / `expireOutbox` / `dropOutbox`；Task 10 的 `localDb` / `localRowOf`
- Produces:
  - `enqueueSend(convId: string, clientMsgId: string, payload: unknown): void` —— fire-and-forget 入队
  - `settleSend(clientMsgId: string, confirmed: ChatMessage): void` —— ack 到达后出队
  - `flushOutbox(send: (payload: unknown) => boolean): Promise<{ sent: number; left: number }>` —— **串行**补发
  - `restoreOutbox(): Promise<ChatMessage[]>` —— 冷启动把未发出的恢复成 `failed` 气泡

**Review Focus 4 落在这里。** 补发途中再次断网：已成功的出队、剩余的留在队列，
**且不进入无限重试循环** —— `send` 返回 false 即立刻停止本轮，不继续尝试后面的。

`flushOutbox` 接收一个 `send` 回调而不是直接调 `chatSocket`：这样它可以被纯函数式地测试，
不用起 WebSocket。

- [ ] **Step 1: 写失败测试**

创建 `packages/shared/src/__tests__/outboxSync.test.ts`：

```ts
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  initLocalStore,
  purgeLocalStore,
  localDb,
  listOutbox,
  listMessagesDesc,
  OUTBOX_EXPIRE_MS,
} from "../localdb";
import { enqueueSend, settleSend, flushOutbox, restoreOutbox } from "../store/outboxSync";
import type { ChatMessage } from "../store/messageStore";

const CONV = "c1";

function confirmed(seq: number, id = "m" + seq): ChatMessage {
  return {
    id,
    conversationId: CONV,
    kind: "text",
    isSelf: true,
    text: "t",
    time: "10:00",
    seq,
    status: "sent",
  } as ChatMessage;
}

/** 等 fire-and-forget 的入队落盘 */
async function settled(): Promise<void> {
  await new Promise((r) => setTimeout(r, 10));
}

beforeEach(async () => {
  await initLocalStore("outbox-sync-test");
});

afterEach(async () => {
  await purgeLocalStore();
});

describe("入队与出队", () => {
  it("发送时入队，ack 到达后出队并落进 messages", async () => {
    enqueueSend(CONV, "cid-1", { text: "hi" });
    await settled();
    expect(await listOutbox(localDb()!)).toHaveLength(1);

    settleSend("cid-1", confirmed(5));
    await settled();
    expect(await listOutbox(localDb()!)).toHaveLength(0);
    expect((await listMessagesDesc(localDb()!, CONV, 0, 10)).map((m) => m.seq)).toEqual([5]);
  });

  it("降级模式下入队与出队都不抛错", async () => {
    await purgeLocalStore();
    expect(() => enqueueSend(CONV, "cid", {})).not.toThrow();
    expect(() => settleSend("cid", confirmed(1))).not.toThrow();
    await initLocalStore("outbox-sync-test");
  });
});

describe("flushOutbox —— 串行补发", () => {
  it("按 createdAt 顺序补发（并行会打乱用户输入顺序）", async () => {
    enqueueSend(CONV, "c1", { n: 1 });
    await settled();
    enqueueSend(CONV, "c2", { n: 2 });
    await settled();
    enqueueSend(CONV, "c3", { n: 3 });
    await settled();

    const order: number[] = [];
    const res = await flushOutbox((p) => {
      order.push((p as { n: number }).n);
      return true;
    });

    expect(order).toEqual([1, 2, 3]);
    expect(res.sent).toBe(3);
  });

  // Review Focus 4：补发途中再次断网
  it("send 返回 false 时立刻停止本轮，不尝试后面的（防无限重试）", async () => {
    enqueueSend(CONV, "a", { n: 1 });
    await settled();
    enqueueSend(CONV, "b", { n: 2 });
    await settled();
    enqueueSend(CONV, "c", { n: 3 });
    await settled();

    let calls = 0;
    const res = await flushOutbox(() => {
      calls++;
      return calls === 1; // 第一条成功，第二条起断网
    });

    expect(calls).toBe(2); // 只试到第二条就停，不试第三条
    expect(res.sent).toBe(1);
    expect(res.left).toBe(2);
  });

  it("断网停下后，成功的那条被标 sending、失败的被标 failed，队列都还在", async () => {
    enqueueSend(CONV, "a", {});
    await settled();
    enqueueSend(CONV, "b", {});
    await settled();

    let first = true;
    await flushOutbox(() => {
      const ok = first;
      first = false;
      return ok;
    });

    const byId = new Map((await listOutbox(localDb()!)).map((r) => [r.clientMsgId, r.status]));
    expect(byId.get("a")).toBe("sending");
    expect(byId.get("b")).toBe("failed");
  });

  it("expired 的条目不参与自动补发（要用户显式重发）", async () => {
    enqueueSend(CONV, "old", {});
    await settled();
    // 手工把 createdAt 推到 24h 前并跑一次过期判定
    const db = localDb()!;
    const tx = db.transaction("outbox", "readwrite");
    const store = tx.objectStore("outbox");
    const cur = await new Promise<Record<string, unknown>>((res) => {
      const r = store.get("old");
      r.onsuccess = () => res(r.result as Record<string, unknown>);
    });
    store.put({ ...cur, createdAt: Date.now() - OUTBOX_EXPIRE_MS - 1, status: "expired" });
    await new Promise<void>((res) => {
      tx.oncomplete = () => res();
    });

    const res = await flushOutbox(() => true);
    expect(res.sent).toBe(0);
  });

  it("队列为空时不调 send", async () => {
    const send = vi.fn(() => true);
    const res = await flushOutbox(send);
    expect(send).not.toHaveBeenCalled();
    expect(res).toEqual({ sent: 0, left: 0 });
  });

  it("降级模式下返回零且不调 send", async () => {
    await purgeLocalStore();
    const send = vi.fn(() => true);
    expect(await flushOutbox(send)).toEqual({ sent: 0, left: 0 });
    expect(send).not.toHaveBeenCalled();
    await initLocalStore("outbox-sync-test");
  });
});

describe("restoreOutbox —— 冷启动恢复", () => {
  it("未发出的恢复成 failed 气泡，供用户重发", async () => {
    enqueueSend(CONV, "cid-x", {
      conversation_id: CONV,
      client_msg_id: "cid-x",
      content: { type: "text", text: "没发出去的" },
    });
    await settled();

    const restored = await restoreOutbox();

    expect(restored).toHaveLength(1);
    expect(restored[0].status).toBe("failed");
    expect(restored[0].clientMsgId).toBe("cid-x");
    expect(restored[0].conversationId).toBe(CONV);
    expect(restored[0].text).toBe("没发出去的");
  });

  it("恢复出来的条目没有 seq（还没被服务端确认过）", async () => {
    enqueueSend(CONV, "cid-y", {
      conversation_id: CONV,
      client_msg_id: "cid-y",
      content: { type: "text", text: "x" },
    });
    await settled();
    expect((await restoreOutbox())[0].seq).toBeUndefined();
  });

  it("降级模式下返回空数组", async () => {
    await purgeLocalStore();
    expect(await restoreOutbox()).toEqual([]);
    await initLocalStore("outbox-sync-test");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/shared && LANG=C.UTF-8 npx vitest run src/__tests__/outboxSync.test.ts`
Expected: FAIL —— `enqueueSend is not a function`

- [ ] **Step 3: 写 `outboxSync.ts`**

```ts
/**
 * 离线发送队列的接线：入队、ack 出队、上线串行补发、冷启动恢复。
 */
import {
  localDb,
  enqueueOutbox,
  listOutbox,
  markOutbox,
  settleOutbox,
  expireOutbox,
  type OutboxRow,
} from "../localdb";
import { localRowOf } from "./messageLocalSync";
import type { ChatMessage } from "./messageStore";

/** 发送时入队（fire-and-forget，失败静默）。 */
export function enqueueSend(convId: string, clientMsgId: string, payload: unknown): void {
  const db = localDb();
  if (db === null) return;
  void enqueueOutbox(db, {
    clientMsgId,
    conversationId: convId,
    payload,
    createdAt: Date.now(),
    status: "pending",
    attempts: 0,
  }).catch(() => {
    // 入队失败只意味着「这条重启后不可恢复」，不影响本次在线发送
  });
}

/** ack 到达：出队并把已确认消息落进 messages（单事务，见 settleOutbox）。 */
export function settleSend(clientMsgId: string, confirmed: ChatMessage): void {
  const db = localDb();
  if (db === null) return;
  void settleOutbox(db, clientMsgId, localRowOf(confirmed)).catch(() => {
    // 静默：内存态已经是对的，本地副本缺一条只影响下次冷启动
  });
}

/**
 * 串行补发待发队列。
 *
 * `send` 返回 false 表示链路不可用 —— 此时**立刻停止本轮**，不再尝试后面的条目。
 * 逐条硬试到底会在断网时把整个队列的 attempts 全部推高，并产生一串无意义的
 * 失败日志；而链路恢复后下一次 `online` 事件会重新触发本函数。
 *
 * `expired` 的条目不参与自动补发（要用户显式重发），已在筛选里排除。
 */
export async function flushOutbox(
  send: (payload: unknown) => boolean,
): Promise<{ sent: number; left: number }> {
  const db = localDb();
  if (db === null) return { sent: 0, left: 0 };

  await expireOutbox(db, Date.now());

  let rows: OutboxRow[];
  try {
    rows = (await listOutbox(db)).filter((r) => r.status !== "expired");
  } catch {
    return { sent: 0, left: 0 };
  }
  if (rows.length === 0) return { sent: 0, left: 0 };

  let sent = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const ok = send(row.payload);
    if (!ok) {
      await markOutbox(db, row.clientMsgId, "failed");
      // 链路不可用，本轮到此为止；剩余条目留在队列等下次 online
      return { sent, left: rows.length - sent };
    }
    // 标 sending 而非直接出队：真正出队要等 ack（settleSend）
    await markOutbox(db, row.clientMsgId, "sending");
    sent++;
  }
  return { sent, left: rows.length - sent };
}

/**
 * 冷启动把队列里未发出的条目恢复成 `failed` 气泡。
 *
 * 恢复出来的条目**没有 seq**（服务端从未确认过），因此不会进 messages store，
 * 只在内存时间线末尾显示，由用户决定重发还是删除。
 */
export async function restoreOutbox(): Promise<ChatMessage[]> {
  const db = localDb();
  if (db === null) return [];
  try {
    const rows = await listOutbox(db);
    return rows.map((r) => {
      const p = r.payload as { content?: { text?: string } };
      return {
        id: r.clientMsgId,
        clientMsgId: r.clientMsgId,
        conversationId: r.conversationId,
        kind: "text",
        isSelf: true,
        text: p.content === undefined ? "" : (p.content.text ?? ""),
        time: "",
        status: "failed",
      } as ChatMessage;
    });
  } catch {
    return [];
  }
}
```

> **`??` 在源码里是允许的**（已核实现有源码 180+ 处在用）：`packages/shared` 作为
> workspace 包被两端 app 以**源码**形式消费，最终由 vite 按 `build.target: es2019`
> 统一转译，产物里不会残留。上面那行照写即可，**不必改成三元**。

- [ ] **Step 4: messageStore 与 chatSocket 挂钩**

1. `sendText` / `sendImage` / `sendFile` / `sendVoice` / `sendVideo` / `sendSticker` 在构造好
   WS 载荷、调用 `chatSocket.send` **之前**各加一行 `enqueueSend(conversationId, clientMsgId, payload);`
2. `applyAck` 里在 `persistMessages` 那行**替换**为 `settleSend(clientMsgId, confirmed);`
   （`settleSend` 已经包含落 messages，两者重复会白写一次）
3. `chatSocket.ts` 的 `online` 监听与连接建立成功回调里追加：

```ts
// 链路可用即补发离线期间积压的消息（串行，返回 false 即停）
void flushOutbox((payload) => this.send(payload as Parameters<typeof this.send>[0]));
```

- [ ] **Step 5: 跑测试 + 回归**

Run: `cd packages/shared && LANG=C.UTF-8 npx vitest run src/__tests__/outboxSync.test.ts src/__tests__/chatSocket.test.ts src/__tests__/messageActions.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/store packages/shared/src/ws/chatSocket.ts \
        packages/shared/src/__tests__/outboxSync.test.ts
git commit -m "feat(localdb): 离线发送队列与上线串行补发"
```

---

> **Task 14 起改用紧凑写法**：文件清单、接口契约、关键断言与易错点照旧写全，
> 但不再逐行铺测试代码 —— Task 1-13 已建立本计划的测试范式（`fake-indexeddb/auto`
> 顶部 import、`beforeEach` 开库、`afterEach` purge、断言写中文用例名），照抄即可。

### Task 14: 撤回 / 编辑 / 清空回放到本地

**Files:**

- Modify: `packages/shared/src/store/messageLocalSync.ts`（追加三个回放函数）
- Modify: `packages/shared/src/store/messageStore.ts`（`applyRecall` / `applyEdited` / `clearConversation` 挂钩）
- Modify: `packages/ui/src/chat/ChatWindow.tsx`（会话关闭时触发 `pruneConversation`）
- Test: `packages/shared/src/__tests__/messageReplay.test.ts`

**Interfaces:**

- Consumes: Task 4 的 `dropMessages` / `dropMessagesBelowSeq` / `pruneConversation`；Task 2 的 `patchConversation`
- Produces:
  - `replayRecall(convId: string, messageId: string): void` —— fire-and-forget
  - `replayEdit(convId: string, messageId: string, text: string, editCount: number): void`
  - `replayClear(convId: string, clearedBeforeSeq: number): void`
  - `pruneOnLeave(convId: string): void` —— 会话关闭时的淘汰入口

**这个 task 兑现 spec 的三条不可让步不变量。** 关键点：

1. **撤回走 `dropMessages` 而不是「改成占位行」。** 本仓语义是「撤回 = 访问撤销」：
   留一行占位在本地、blob 却不删，断网就能看到已撤回的图片。UI 的占位气泡由内存态
   （`applyRecall` 已有逻辑）负责渲染，**本地库直接删行 + 删 blob**。
2. **编辑是就地改 dto**，不删不增：读出行 → 改 `dto.text` / `dto.edited` / `dto.editCount` → 写回。
3. **清空走 `dropMessagesBelowSeq` + 推进 `clearedBeforeSeq` 水位**，两步必做 ——
   只删不推水位，下次 `after_seq` 补齐会把删掉的原样拉回来。
4. **淘汰时机是「会话关闭」**（`ChatWindow` 的 `useEffect` cleanup），不是写入时。

**必测断言**（对应 spec 的不变量）：

- 撤回一条图片消息 → 本地行没了、blob 没了、`mediaBytesTotal` 下降
- 撤回一条**已被保留窗口淘汰**的消息 → no-op 不抛错（且因「行在 blob 才在」不变量，不留孤儿）
- 编辑后本地读回的 `text` 是新文本、`editCount` 正确、**seq 不变**（编辑不改位置）
- 清空水位 3 → seq ≤ 3 的消息与 blob 全没、会话行 `clearedBeforeSeq` 变成 3
- 清空后再跑一次 `reconcileConversation`，**不会把已清空的消息拉回来**（游标从水位起算）
- 降级模式下四个函数都不抛错

- [ ] **Step 1: 写失败测试**（按上述断言，照 Task 4/11 的测试范式）
- [ ] **Step 2: 跑测试确认失败** —— `cd packages/shared && LANG=C.UTF-8 npx vitest run src/__tests__/messageReplay.test.ts`
- [ ] **Step 3: 实现四个回放函数**（全部 fire-and-forget，内部 try/catch 吞异常，`localDb() === null` 时直接 return）
- [ ] **Step 4: messageStore 挂钩** —— `applyRecall` 末尾加 `replayRecall(convId, messageId);`；`applyEdited` 末尾加 `replayEdit(convId, messageId, text, editCount);`；`clearConversation` 末尾加 `replayClear(convId, 水位)`
- [ ] **Step 5: ChatWindow 挂钩** —— 会话切换/卸载的 `useEffect` cleanup 里调 `pruneOnLeave(上一个 convId)`
- [ ] **Step 6: 跑测试 + 回归** —— `LANG=C.UTF-8 npx vitest run`（重点看 `messageEdit` / `messageActions` 既有用例）
- [ ] **Step 7: Commit** —— `git commit -m "feat(localdb): 撤回编辑清空回放到本地并接入淘汰时机"`

---

### Task 15: 媒体缓存接入下载链路（顺带干掉 download-url 重复请求）

**Files:**

- Modify: `packages/shared/src/api/files.ts`（`download-url` 外面包一层本地优先）
- Test: `packages/shared/src/__tests__/mediaCache.test.ts`

**Interfaces:**

- Consumes: Task 5 的 `cacheMedia` / `readMediaBlob`；Task 10 的 `localDb`
- Produces:
  - `resolveObjectUrl(objectKey: string, opts?: { cache?: boolean }): Promise<string>` ——
    本地命中则返回 `URL.createObjectURL` 结果；否则签 URL → 取回字节 → 缓存 → 返回

**缓存范围按裁决 L1-4**：图片与语音**缓存原件**；视频**只缓存封面 `thumbKey`**，
本体永远走网络（`opts.cache = false`）。文件（任意扩展）也不缓存 —— 体积不可控，
且用户对文件的预期本来就是「点了才下载」。

**这条顺带收口 §2.7 登记的债**「同一对象 key 的 `download-url` 单页连发 8 次」：
本地命中就不发请求了。但**首次加载仍会并发**（8 个 `<img>` 同时挂载），所以还要加
一层**进行中请求的 in-flight 去重表**（`Map<objectKey, Promise<string>>`），
同 key 的并发调用共享同一个 Promise。缺这层，首屏 8 张图仍是 8 个请求。

**必测断言**：

- 首次调用签 URL 并写入缓存；第二次**不再**调 `download-url`
- 同 key **并发** 8 次只签 1 次 URL（in-flight 去重）
- `opts.cache = false` 时不写缓存，两次调用都签 URL
- 缓存写入失败（`cacheMedia` 返回 false）时**照常返回可用 URL**（功能不因缓存失败退化）
- 降级模式（无本地库）下行为与今天完全一致
- `URL.createObjectURL` 产出的 URL 由调用方负责 revoke —— 沿用 `revokeAllLocalPreviews` 既有约定，**本函数不自行 revoke**（提前 revoke 会让正在渲染的 `<img>` 变成裂图）

- [ ] **Step 1** 写失败测试（mock `download-url` 端点与 `fetch`）
- [ ] **Step 2** 跑测试确认失败
- [ ] **Step 3** 实现 `resolveObjectUrl`（含 in-flight Map，`finally` 里清表）
- [ ] **Step 4** 把 `ImageLightbox` / `MessageBubble` 图片 / `voicePlayer` / 视频封面四处的取 URL 改走它
- [ ] **Step 5** 跑测试 + `pnpm --filter @yuanchat/ui test` 回归
- [ ] **Step 6** Commit —— `git commit -m "feat(localdb): 媒体本地缓存接入下载链路并去重并发请求"`

---

### Task 16: 登录初始化与登出删库

**Files:**

- Modify: `packages/shared/src/hooks/useChatBootstrap.ts`（登录后 `initLocalStore` + `restoreOutbox`）
- Modify: `packages/shared/src/store/resetStores.ts`（`resetChatStores` 里加 `purgeLocalStore`）
- Test: `packages/shared/src/__tests__/localStoreLifecycle.test.ts`

**Interfaces:**

- Consumes: Task 10 的 `initLocalStore` / `purgeLocalStore`；Task 13 的 `restoreOutbox`
- Produces: 无新导出（纯接线）

**要点**：

1. `useChatBootstrap` 里，`initLocalStore(user.id)` 必须在 `loadConversations()`
   **之前** await —— 否则冷启动水合拿不到句柄，本地数据白存。
2. `initLocalStore` 返回 false（降级）时**照常继续**，不阻塞登录。
3. `restoreOutbox()` 的结果要合并进 `messageStore`，让上次没发出去的消息以 `failed`
   气泡出现在对应会话末尾。
4. `resetChatStores()` 目前是**同步**函数，而 `purgeLocalStore` 是异步。
   **不要把 resetChatStores 改成 async**（它被多处同步调用）—— 用
   `void purgeLocalStore();` fire-and-forget，并在注释里写明「删库是幂等的，
   下次 initLocalStore 会开新库，即使删除还在进行中也不会读到旧账号数据
   （库名带 userId，不同账号本来就是不同库）」。

**必测断言**：

- 登录 A → 存数据 → 登出 → 登录 B：B 看不到 A 的任何数据
- 登出后再登录 A：A 的数据**已被删掉**（登出即清，不是留着）
- `initLocalStore` 返回 false 时 bootstrap 不抛错、不阻塞
- `restoreOutbox` 恢复出的条目状态是 `failed` 且带 `clientMsgId`

- [ ] **Step 1** 写失败测试
- [ ] **Step 2** 跑测试确认失败
- [ ] **Step 3** 接线三处
- [ ] **Step 4** 跑测试 + `LANG=C.UTF-8 pnpm --filter @yuanchat/shared test` 全量回归
- [ ] **Step 5** `pnpm turbo typecheck`
- [ ] **Step 6** Commit —— `git commit -m "feat(localdb): 登录初始化本地库、登出清库并恢复待发队列"`

---

## Stage D — 离线态、下拉刷新与桌面对账

### Task 17: `useNetworkStatus` 三态

**Files:**

- Create: `packages/shared/src/hooks/useNetworkStatus.ts`
- Test: `packages/shared/src/__tests__/useNetworkStatus.test.ts`

**Interfaces:**

- Consumes: `chatSocket` 的连接状态（需确认它是否已对外暴露状态；若没有，本 task 顺带加一个 `chatSocket.onStateChange` 回调或轻量订阅，**不要在 hook 里轮询**）
- Produces:
  - `type NetworkPhase = "online" | "connecting" | "offline"`
  - `useNetworkStatus(): NetworkPhase`

**必须是三态，不能是布尔。** 判定：

| 态           | 条件                                   |
| ------------ | -------------------------------------- |
| `offline`    | `!navigator.onLine`                    |
| `connecting` | `navigator.onLine` 为真但 WS 未 `open` |
| `online`     | 在线且 WS `open`                       |

合并成布尔会在 WS 每次短暂重连时误报「断网」，用户看到的是一条无端闪烁的红条。

**易错点**：

- `navigator.onLine` 在 Linux WebKitGTK 上可能恒为 `true`（桌面端实测项）。
  因此**不能只靠它** —— `connecting` 态就是为这种情况兜底的：网卡说在线但 WS 连不上，
  用户至少看到「连接中…」而不是一切正常的假象。
- 测试里**禁止依赖宿主环境**：用 `vi.stubGlobal("navigator", { onLine: false })` 打桩，
  不要读真实 `navigator`（Node 20 下 `navigator` 可能根本不存在，见 `ringtone` 单测的教训）。
- `window` 可能不存在（`packages/shared` 的 vitest environment 是 node）→ 注册监听前
  `typeof window === "undefined"` 守卫。

**必测断言**：三态各自成立；`offline` → `online` 事件触发后转 `connecting` 再转 `online`；
卸载时移除监听器（不泄漏）；`window` 缺失时返回 `"online"` 且不抛错。

- [ ] **Step 1-6**：写失败测试 → 确认失败 → 实现 → 确认通过 → typecheck → Commit
      （`git commit -m "feat(shared): 网络状态三态 hook"`）

---

### Task 18: 全局顶部离线横幅

**Files:**

- Create: `packages/ui/src/layout/NetworkBanner.tsx`
- Modify: `packages/ui/src/layout/MainLayout.tsx`（挂载横幅）
- Modify: `packages/design-system/src/i18n/locales/{zh-CN,en-US,ja-JP,ko-KR}.json`
- Test: `packages/ui/src/__tests__/NetworkBanner.test.tsx`

**Interfaces:**

- Consumes: Task 17 的 `useNetworkStatus`
- Produces: `<NetworkBanner />`（无 props，内部取状态 —— 沿用 D1 裁决：`packages/ui` 组件不接状态 prop）

**新增四语 key**（`%{}` 占位符风格，本仓是 Rails 风格不是 i18next 默认）：

| key                  | zh-CN      |
| -------------------- | ---------- |
| `network.offline`    | 当前无网络 |
| `network.connecting` | 连接中…    |
| `network.restored`   | 已连接     |

**要点**：

- **必须叠 `--safe-area-top`**：横幅贴顶，不叠会压住安卓系统时间/信号图标（A8 已有教训）。
  写法参照 `ToastHost` 的顶部偏移（它已经叠了）。
- `online` 态时显示 `network.restored` **2 秒后自动消失**；`offline` / `connecting` 常驻。
- 圆角 ≤ `rounded-lg`；颜色走主题 token（暗色自动跟随）；`role="status"` + `aria-live="polite"`
  （离线是状态变更，屏幕阅读器应播报，但不该打断当前朗读 → `polite` 不是 `assertive`）。
- **不要用 `animate-fade-in` 之外的新动效**；且要尊重 `prefers-reduced-motion`（J7 债方向）。

**必测断言**：三态各自渲染对应文案；`online` 态 2s 后消失（`vi.useFakeTimers`）；
`role="status"` 存在；四语 key 齐全（由 `check:i18n` 门禁兜）。

- [ ] **Step 1-7**：写失败测试 → 确认失败 → 实现组件 → 补四语 → 挂进 MainLayout →
      `node scripts/check-i18n.mjs` + 测试通过 → Commit
      （`git commit -m "feat(ui): 全局离线状态横幅"`）

### Task 19: `usePullToRefresh` + `PullToRefresh` 容器

Create `packages/ui/src/util/usePullToRefresh.ts` + `packages/ui/src/primitives/PullToRefresh.tsx`；Test 同名。

要点：① 按 `pointer: coarse` 内部 `matchMedia` 门控（裁决 N-1，不接 prop）；② 容器必须 `overscroll-behavior-y: contain`，否则被 Chrome 自带下拉接管、安卓上永远触发不了；③ 仅 `scrollTop === 0` 且向下拖才进手势，阈值 64px 带阻尼；④ 刷新中禁重复触发，失败也收起指示器 + toast。

断言：非触屏返回空 handler；`scrollTop > 0` 不触发；未达阈值回弹不刷新；刷新中二次下拉被忽略；`onRefresh` reject 时指示器收起。

- [ ] 写失败测试 → 确认失败 → 实现 → 通过 → Commit `feat(ui): 下拉刷新 hook 与容器组件`

### Task 20: 七屏接入下拉刷新

Modify：`ConversationList` / `ContactsPanel` / `NewFriendsView` / `MomentsScreen` / `StickerMarketView` / `StickerMineView` / `MomentActivitiesView`，各包一层 `<PullToRefresh onRefresh={...}>`。

要点：`onRefresh` 复用各屏已有的 load 函数，**不新造数据通路**。`ConversationList` 的 `onRefresh` 要同时触发 `loadConversations()` 与当前会话的 `reconcileConversation`。

- [ ] 逐屏接入 → `pnpm --filter @yuanchat/ui test` → Commit `feat(ui): 七个主列表接入下拉刷新`

### Task 21: 桌面回前台对账 + 三处局部刷新图标

Modify `packages/shared/src/hooks/useChatBootstrap.ts`（`visibilitychange` → visible 且距 `meta.lastReconcileAt` > 30s 则静默对账）；`StickerMarketView` / `MomentsScreen` / `StickerMineView` 区块标题旁加刷新图标按钮。

要点：搭 `chatSocket.ts:357` **现有** `visibilitychange` 监听，不新起监听器。刷新图标 `aria-label` 走 i18n（新 key `common.refresh`，四语齐）。WS 驱动的列表**一律不加**按钮（裁决 N-2）。

- [ ] 实现 → check:i18n → 测试 → Commit `feat(ui): 桌面回前台自动对账与三处局部刷新`

## Stage E — 运维概览重构与小任务

### Task 22: 后端 `GET /admin/stats/timeseries`

Modify `admin_repo.go` / `admin_stats.go` / `handler/admin.go` / `router.go:457` 附近；Test `admin_stats_test.go`。

要点：`days` 取值 7–90，越界 **400 拒绝**（不静默夹取）；`WHERE created_at >= now() - interval` 走既有 `idx_messages_created`；**空日补零**返回连续日期序列（前端不补洞）；只读不写审计。

断言：`days=30` 返回 30 个点；`days=0` / `days=91` → 400；无数据的日子值为 0 而非缺项；非 admin → 403。

- [ ] TDD 五步 → Commit `feat(server): 管理端概览时间序列端点`

### Task 23: 手写 SVG 图表三组件

Create `apps/admin/src/components/charts/{Sparkline,LineChart,DonutChart}.tsx`；Test 同目录。

要点：零依赖纯 SVG；取色走主题 token（暗色自动跟随）；**必须 `role="img"` + `aria-label` 描述数据要点**（不能只给哑图）；空数据渲染占位不崩；单点数据不除零。

- [ ] TDD 五步 → Commit `feat(admin): 零依赖 SVG 图表组件`

### Task 24: 概览页重构

Modify `apps/admin/src/pages/Overview.tsx` + `api.ts`（加 timeseries 类型与函数）+ 四语 locale。

布局四层：① 顶部 4 张关键指标大卡（含 sparkline + 环比）② 中部两列（消息量趋势折线 + 类型占比环形）③ 治理项独立一栏（有积压才高亮，沿用现有 `GovernanceCard`）④ 次要区（存储 + 推送订阅）。

顺带：admin 内 **4 处 `rounded-xl` → `rounded-lg`**；新增文案补四语；骨架屏固定宽高保证 CLS 为零。

- [ ] 实现 → check:i18n → `pnpm --filter @yuanchat/admin typecheck` → Commit `feat(admin): 概览页重构为分层看板`

### Task 25: Button hover/focus + ConfirmDialog 无障碍

Modify `packages/ui/src/primitives/Button.tsx` + `ConfirmDialog.tsx`；Test 同名。

Button：danger 变体补 `hover:` 态（现在**零 hover**）；全变体把 `focus:outline-none` 换成 `focus-visible:ring-2 focus-visible:ring-offset-2`（ring 是 box-shadow 不占位，不破布局）。

ConfirmDialog：补 `role="dialog"` / `aria-modal="true"` / `aria-labelledby`；Esc 关闭；焦点陷阱；打开时初始焦点落在取消键（危险操作不该默认聚焦确认）；关闭后焦点还原。

断言：四变体各有 hover class；`focus-visible` ring 存在；Esc 触发 `onCancel`；Tab 在弹窗内循环；初始焦点在取消键。**影响全仓所有按钮，需三端走查。**

- [ ] TDD 五步 → Commit `fix(ui): 补齐按钮悬停与焦点态、弹窗无障碍语义`

### Task 26: 三个 app 的 tsconfig target 降到 ES2019

Modify `apps/{web,desktop,admin}/tsconfig.json` 的 `"target": "ES2021"` → `"ES2019"`。

**单独一个 commit，不与其他项混。** 降 target 后 tsc 可能开始拦一些 lib 类型（`Array.at` 等），若报错则逐个改为 ES2019 可用写法，**不要为了过编译把 target 改回去**。

- [ ] 改 → `pnpm turbo typecheck` → 有错则修 → Commit `chore(build): 三端 tsconfig target 对齐 es2019`

### Task 27: WS 卸载中止不再上报 Sentry

Modify `packages/shared/src/ws/chatSocket.ts` 的 `onerror`。

要点：区分「页面卸载中止」与「真实故障」—— 在 `beforeunload` / `pagehide` 里置一个 `unloading` 标志，`onerror` 见到它就只 `debug` 不 `captureException`。

- [ ] 加测试（卸载态下不调 captureException）→ 实现 → Commit `fix(shared): 页面卸载中止的 WS 握手不再上报 Sentry`

## Stage F — 收尾

### Task 28: 文档回写

Modify `docs/MASTER_PLAN.md`（§9 L1 标 ✅ 并写交付面；§4 J9 标 ✅；阶段四「数据统计面板」勾选；**§2.7 的 design-system tsconfig 债标 ✅ 已过期**；新发现的债当次登记）、`docs/CHAT_API.md`、`docs/DB_SCHEMA.md`、`docs/DEVELOPMENT.md`（若启动命令有变）。

新债登记候选（实测后按实际填）：本地库无加密、多标签页并发不加锁、视频本体不缓存、离线不可发文件/图片（仅文本进 outbox，若本批如此）、`navigator.onLine` 在 WebKitGTK 的不可靠性。

- [ ] 回写 → Commit `docs: 回写 L1 与运维概览交付状态及新登记债`
