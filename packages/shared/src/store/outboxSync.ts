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
