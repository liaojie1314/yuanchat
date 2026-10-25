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

  let rows: OutboxRow[];
  try {
    await expireOutbox(db, Date.now());
    rows = (await listOutbox(db)).filter((r) => r.status !== "expired");
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
 * 冷启动把队列里未发出的**文本**条目恢复成 `failed` 气泡。
 *
 * 恢复出来的条目**没有 seq**（服务端从未确认过），因此不会进 messages store，
 * 只在内存时间线末尾显示，由用户决定重发还是删除。
 *
 * 非文本载荷不在此恢复：媒体的字节早已上传完成、载荷里带着对象 key，
 * 链路一通 `flushOutbox` 就能原样重发；而按文本气泡渲染只会得到一个空气泡。
 */
export async function restoreOutbox(): Promise<ChatMessage[]> {
  const db = localDb();
  if (db === null) return [];
  try {
    const rows = await listOutbox(db);
    return rows
      .filter((r) => (r.payload as { content?: { type?: string } }).content?.type === "text")
      .map((r) => {
        const p = r.payload as { content?: { text?: string } };
        return {
          id: r.clientMsgId,
          clientMsgId: r.clientMsgId,
          conversationId: r.conversationId,
          kind: "text",
          isSelf: true,
          text: p.content?.text ?? "",
          time: "",
          status: "failed",
        } as ChatMessage;
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
 * 给它配一套配额账本是无谓的基建。web 端 sink 没有 read 方法（没有磁盘），
 * 这组函数在 web 上整体降级：stage / clear 是 no-op，read 抛错由调用方回落原行为。
 */
export async function stageOutboxFile(
  clientMsgId: string,
  bytes: Uint8Array,
  fileName: string,
  mime: string,
): Promise<void> {
  const sink = getFileSink();
  if (!sink.read) return; // web：没有磁盘，不落
  await sink.save(bytes, stagedKey(clientMsgId, fileName), mime, "appdata");
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
