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
  deleteConversations,
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
    await deleteConversations(db, [id]);
  } catch {
    // 静默
  }
}
