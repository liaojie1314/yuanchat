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
  try {
    tx.objectStore(STORE_OUTBOX).delete(clientMsgId);
    tx.objectStore(STORE_MESSAGES).put(confirmed);
  } catch (e) {
    // 请求构造阶段抛错（如 confirmed 取不到 keyPath）不会自动回滚已入队的
    // delete —— 控制权回到事件循环后事务照样提交。必须显式 abort，
    // 否则出队生效、消息没落库，这条消息就彻底消失了。
    tx.abort();
    throw e;
  }
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
