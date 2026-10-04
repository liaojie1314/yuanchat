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
