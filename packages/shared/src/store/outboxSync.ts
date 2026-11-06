/**
 * 离线发送队列的接线：入队、ack 出队、上线串行补发、冷启动恢复，
 * 以及发送前的磁盘副本（outbox 落盘）。
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
import { getFileSink } from "../download/fileSink";
import { localRowOf } from "./messageLocalSync";
import type { ChatMessage } from "./messageStore";

/** 只保存已支持磁盘恢复的附件，并去掉重启后失效的预览 URL。 */
function uploadDraftOf(message?: ChatMessage): ChatMessage | undefined {
  if (!message || !["file", "image", "voice"].includes(message.kind)) return undefined;
  return {
    ...message,
    seq: undefined,
    status: "failed",
    file: message.file ? { ...message.file, localUrl: undefined } : undefined,
    image: message.image ? { ...message.image, localUrl: undefined } : undefined,
    voice: message.voice ? { ...message.voice, localUrl: undefined } : undefined,
  };
}

/** 发送时入队；附件保留快照以便冷启动后处理 ACK 清理（失败静默）。 */
export function enqueueSend(
  convId: string,
  clientMsgId: string,
  payload: unknown,
  message?: ChatMessage,
): void {
  const db = localDb();
  if (db === null) return;
  const draft = uploadDraftOf(message);
  void enqueueOutbox(db, {
    clientMsgId,
    conversationId: convId,
    payload,
    ...(draft ? { draft } : {}),
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

  let rows: OutboxRow[];
  try {
    await expireOutbox(db, Date.now());
    // 未上传草稿只能由用户重试上传，不能作为缺少对象 key 的 WS 帧发出去。
    rows = (await listOutbox(db)).filter((r) => r.status !== "expired" && r.payload !== null);
  } catch {
    return { sent: 0, left: 0 };
  }
  if (rows.length === 0) return { sent: 0, left: 0 };

  let sent = 0;
  for (const row of rows) {
    if (!send(row.payload)) {
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
 * 冷启动把文本及有快照的附件恢复成 `failed` 气泡。
 *
 * 恢复出来的条目**没有 seq**（服务端从未确认过），因此不会进 messages store，
 * 只在内存时间线末尾显示，由用户决定重发还是删除。
 *
 * 旧媒体行没有快照，仍只由 flushOutbox 补发；不能把它们当成空文本恢复。
 */
export async function restoreOutbox(): Promise<ChatMessage[]> {
  const db = localDb();
  if (db === null) return [];
  try {
    const rows = await listOutbox(db);
    return rows.flatMap((r): ChatMessage[] => {
      const draft = uploadDraftOf(r.draft as ChatMessage | undefined);
      if (draft) {
        return [
          {
            ...draft,
            id: r.clientMsgId,
            clientMsgId: r.clientMsgId,
            conversationId: r.conversationId,
          },
        ];
      }
      const p = r.payload as { content?: { type?: string; text?: string } } | null;
      if (p?.content?.type !== "text") return [];
      return [
        {
          id: r.clientMsgId,
          clientMsgId: r.clientMsgId,
          conversationId: r.conversationId,
          kind: "text",
          isSelf: true,
          text: p.content?.text ?? "",
          time: "",
          status: "failed",
        },
      ];
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// 发送前的磁盘副本（outbox 落盘）
// ---------------------------------------------------------------------------

/** image 消息的落盘副本名：压缩 blob 没有原始文件名，用固定名，mime 重试时按魔数嗅探 */
export const STAGED_IMAGE_NAME = "img";

/** voice 消息的落盘副本名：与 dispatchVoiceSend 的上传名保持一致 */
export const STAGED_VOICE_NAME = "voice.webm";

/** 副本的完整键。文件名来自用户输入，路径分隔符一律替换 —— 副本只可能是 outbox/ 下的平铺文件 */
function stagedKey(clientMsgId: string, fileName: string): string {
  return `${clientMsgId}-${fileName.replace(/[\\/]/g, "_")}`;
}

/**
 * 发送前把字节落到应用私有目录，重试从那里读。
 *
 * 为什么必须落盘：安卓用文件选择器选出来的 blob 在应用重启后**必然失效**，
 * 此时「重试」只能如实报「本地文件已失效」—— 对用户就是消息永久卡住。
 *
 * 清理策略：发送成功即删，不引入 LRU 配额。outbox 条目本来就短命，
 * 给它配一套配额账本是无谓的基建。Web 的授权下载可读，但不提供 appdata 磁盘副本；
 * 这组函数在 Web 上整体降级：stage / clear 是 no-op，read 抛错由调用方回落原行为。
 * 提供消息快照时，成功写盘后还要先保存当前账号的上传草稿，调用方才能开始上传。
 */
export async function stageOutboxFile(
  clientMsgId: string,
  bytes: Uint8Array,
  fileName: string,
  mime: string,
  message?: ChatMessage,
): Promise<void> {
  const sink = getFileSink();
  if (!sink.read) return; // 无读回能力时不落；Web 的 appdata save 自行保持 no-op。
  const db = localDb();
  const draft = uploadDraftOf(message);
  const saved = await sink.save(bytes, stagedKey(clientMsgId, fileName), mime, "appdata");
  // Web 的空操作不产生草稿；换号后迟到的写盘也不能污染新账号的队列。
  if (saved === null || !draft || !db || localDb() !== db) return;
  await enqueueOutbox(db, {
    clientMsgId,
    conversationId: draft.conversationId,
    payload: null,
    draft,
    createdAt: draft.createdAtMs ?? Date.now(),
    status: "pending",
    attempts: 0,
  });
}

/** 读回发送前落的磁盘副本；副本不存在（如较旧的消息）或无磁盘 sink 时抛错 */
export async function readStagedOutboxFile(
  clientMsgId: string,
  fileName: string,
): Promise<Uint8Array> {
  const sink = getFileSink();
  if (!sink.read) throw new Error("no disk sink");
  return sink.read(stagedKey(clientMsgId, fileName), "appdata");
}

/**
 * 删除发送前的磁盘副本（收到服务端 ack 后调用）。
 *
 * 清理失败不能让「发送成功」回退成失败：最坏结果只是多占一点私有目录空间。
 */
export async function clearStagedOutboxFile(clientMsgId: string, fileName: string): Promise<void> {
  const sink = getFileSink();
  if (!sink.remove) return;
  await sink.remove(stagedKey(clientMsgId, fileName), "appdata").catch(() => {
    // 同上：副本清理失败不值得打断任何一条主流程
  });
}

/**
 * 从字节魔数嗅探图片 MIME（发送时落盘的副本只存了字节，mime 没有单独落）。
 *
 * 覆盖 sendImage 实际可能产生的全部类型：compressImage 只产出 jpeg/png
 * （gif 原样透传），其余按 filenameForBlob 的默认口径回 image/jpeg。
 */
export function sniffImageMime(bytes: Uint8Array): string {
  if (bytes.length < 4) return "image/jpeg";
  // JPEG：FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  // PNG：89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return "image/png";
  // GIF：GIF8（87a / 89a 两个版本）
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)
    return "image/gif";
  // WEBP：RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "image/webp";
  return "image/jpeg";
}
