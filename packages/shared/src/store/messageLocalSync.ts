/**
 * `ChatMessage` 与本地库行之间的适配。
 *
 * 放在 store 侧而不是 localdb 侧：依赖方向是 store → localdb，
 * 反过来让 localdb 认识 ChatMessage 会成环。
 */
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
 * 四种媒体载荷都带 localUrl，**一个都不能漏**——漏掉的那种读回来就是
 * 一条指向已失效 blob 的死链，气泡会拿它当真源去渲染。
 */
export function localRowOf(m: ChatMessage): LocalMessageRow {
  const persisted: ChatMessage = {
    ...m,
    status: "sent",
    image: stripLocalUrl(m.image),
    file: stripLocalUrl(m.file),
    voice: stripLocalUrl(m.voice),
    video: stripLocalUrl(m.video),
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

/** 从本地库水合某会话最近的消息（seq 升序）；无库或无数据返回空数组。 */
export async function hydrateMessages(
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
