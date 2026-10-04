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
 * 后续请求抛 `TransactionInactiveError`。本模块所有事务内代码都只 await `reqDone`。
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
