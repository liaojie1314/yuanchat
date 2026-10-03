import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  initLocalStore,
  purgeLocalStore,
  localDb,
  listOutbox,
  listMessagesDesc,
  OUTBOX_EXPIRE_MS,
} from "../localdb";
import { enqueueSend, settleSend, flushOutbox, restoreOutbox } from "../store/outboxSync";
import type { ChatMessage } from "../store/messageStore";

const CONV = "c1";

function confirmed(seq: number, id = "m" + seq): ChatMessage {
  return {
    id,
    conversationId: CONV,
    kind: "text",
    isSelf: true,
    text: "t",
    time: "10:00",
    seq,
    status: "sent",
  } as ChatMessage;
}

/** 等 fire-and-forget 的入队落盘 */
async function settled(): Promise<void> {
  await new Promise((r) => setTimeout(r, 10));
}

beforeEach(async () => {
  await initLocalStore("outbox-sync-test");
});

afterEach(async () => {
  await purgeLocalStore();
});

describe("入队与出队", () => {
  it("发送时入队，ack 到达后出队并落进 messages", async () => {
    enqueueSend(CONV, "cid-1", { text: "hi" });
    await settled();
    expect(await listOutbox(localDb()!)).toHaveLength(1);

    settleSend("cid-1", confirmed(5));
    await settled();
    expect(await listOutbox(localDb()!)).toHaveLength(0);
    expect((await listMessagesDesc(localDb()!, CONV, 0, 10)).map((m) => m.seq)).toEqual([5]);
  });

  it("降级模式下入队与出队都不抛错", async () => {
    await purgeLocalStore();
    expect(() => enqueueSend(CONV, "cid", {})).not.toThrow();
    expect(() => settleSend("cid", confirmed(1))).not.toThrow();
    await initLocalStore("outbox-sync-test");
  });
});

describe("flushOutbox —— 串行补发", () => {
  it("按 createdAt 顺序补发（并行会打乱用户输入顺序）", async () => {
    enqueueSend(CONV, "q1", { n: 1 });
    await settled();
    enqueueSend(CONV, "q2", { n: 2 });
    await settled();
    enqueueSend(CONV, "q3", { n: 3 });
    await settled();

    const order: number[] = [];
    const res = await flushOutbox((p) => {
      order.push((p as { n: number }).n);
      return true;
    });

    expect(order).toEqual([1, 2, 3]);
    expect(res.sent).toBe(3);
  });

  // 补发途中再次断网
  it("send 返回 false 时立刻停止本轮，不尝试后面的（防无限重试）", async () => {
    enqueueSend(CONV, "a", { n: 1 });
    await settled();
    enqueueSend(CONV, "b", { n: 2 });
    await settled();
    enqueueSend(CONV, "c", { n: 3 });
    await settled();

    let calls = 0;
    const res = await flushOutbox(() => {
      calls++;
      return calls === 1; // 第一条成功，第二条起断网
    });

    expect(calls).toBe(2); // 只试到第二条就停，不试第三条
    expect(res.sent).toBe(1);
    expect(res.left).toBe(2);
  });

  it("断网停下后，成功的那条被标 sending、失败的被标 failed，队列都还在", async () => {
    enqueueSend(CONV, "a", {});
    await settled();
    enqueueSend(CONV, "b", {});
    await settled();

    let first = true;
    await flushOutbox(() => {
      const ok = first;
      first = false;
      return ok;
    });

    const byId = new Map((await listOutbox(localDb()!)).map((r) => [r.clientMsgId, r.status]));
    expect(byId.get("a")).toBe("sending");
    expect(byId.get("b")).toBe("failed");
  });

  it("expired 的条目不参与自动补发（要用户显式重发）", async () => {
    enqueueSend(CONV, "old", {});
    await settled();
    // 手工把 createdAt 推到 24h 前，让 flushOutbox 的过期判定把它标成 expired
    const db = localDb()!;
    const tx = db.transaction("outbox", "readwrite");
    const store = tx.objectStore("outbox");
    const cur = await new Promise<Record<string, unknown>>((res) => {
      const r = store.get("old");
      r.onsuccess = () => res(r.result as Record<string, unknown>);
    });
    store.put({ ...cur, createdAt: Date.now() - OUTBOX_EXPIRE_MS - 1 });
    await new Promise<void>((res) => {
      tx.oncomplete = () => res();
    });

    const res = await flushOutbox(() => true);
    expect(res.sent).toBe(0);
    expect((await listOutbox(db))[0].status).toBe("expired");
  });

  it("队列为空时不调 send", async () => {
    const send = vi.fn(() => true);
    const res = await flushOutbox(send);
    expect(send).not.toHaveBeenCalled();
    expect(res).toEqual({ sent: 0, left: 0 });
  });

  it("降级模式下返回零且不调 send", async () => {
    await purgeLocalStore();
    const send = vi.fn(() => true);
    expect(await flushOutbox(send)).toEqual({ sent: 0, left: 0 });
    expect(send).not.toHaveBeenCalled();
    await initLocalStore("outbox-sync-test");
  });
});

describe("restoreOutbox —— 冷启动恢复", () => {
  it("未发出的恢复成 failed 气泡，供用户重发", async () => {
    enqueueSend(CONV, "cid-x", {
      conversation_id: CONV,
      client_msg_id: "cid-x",
      content: { type: "text", text: "没发出去的" },
    });
    await settled();

    const restored = await restoreOutbox();

    expect(restored).toHaveLength(1);
    expect(restored[0].status).toBe("failed");
    expect(restored[0].clientMsgId).toBe("cid-x");
    expect(restored[0].conversationId).toBe(CONV);
    expect(restored[0].text).toBe("没发出去的");
  });

  it("恢复出来的条目没有 seq（还没被服务端确认过）", async () => {
    enqueueSend(CONV, "cid-y", {
      conversation_id: CONV,
      client_msg_id: "cid-y",
      content: { type: "text", text: "x" },
    });
    await settled();
    expect((await restoreOutbox())[0].seq).toBeUndefined();
  });

  it("非文本载荷不恢复成空气泡（媒体靠 flushOutbox 重发，不占时间线）", async () => {
    enqueueSend(CONV, "cid-img", {
      conversation_id: CONV,
      client_msg_id: "cid-img",
      content: { type: "image", key: "images/x.jpg", width: 10, height: 10 },
    });
    await settled();
    expect(await restoreOutbox()).toEqual([]);
  });

  it("降级模式下返回空数组", async () => {
    await purgeLocalStore();
    expect(await restoreOutbox()).toEqual([]);
    await initLocalStore("outbox-sync-test");
  });
});
