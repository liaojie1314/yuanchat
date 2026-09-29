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
