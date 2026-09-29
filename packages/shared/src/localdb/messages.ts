/** 已确认消息的本地读写与水位推进。 */
import { reqDone, txDone, STORE_MESSAGES, STORE_MEDIA, STORE_META } from "./db";
import type { LocalMessageRow, MediaRow } from "./types";
import { bumpBytes } from "./media";

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
