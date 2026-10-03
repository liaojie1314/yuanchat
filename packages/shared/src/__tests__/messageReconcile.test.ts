import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  initLocalStore,
  purgeLocalStore,
  localDb,
  putConversations,
  getConversation,
  putMessages,
} from "../localdb";
import {
  persistMessages,
  hydrateMessages,
  noteIncoming,
  reconcileConversation,
  localRowOf,
  RECONCILE_PAGE,
  RECONCILE_MAX_ROUNDS,
} from "../store/messageLocalSync";
import type { ChatMessage } from "../store/messageStore";
import { useMessageStore } from "../store/messageStore";

const CONV = "c1";
const SELF = "me";

const fetchAfter = vi.hoisted(() => vi.fn());
const fetchHistory = vi.hoisted(() => vi.fn());
vi.mock("../api/chat", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, fetchMessagesAfter: fetchAfter, fetchMessages: fetchHistory };
});

function msg(seq: number): ChatMessage {
  return {
    id: "m" + seq,
    conversationId: CONV,
    kind: "text",
    isSelf: false,
    text: "t" + seq,
    time: "10:00",
    seq,
    status: "sent",
  } as ChatMessage;
}

/** 落一行会话投影，水位为 maxSeq */
async function seedConv(maxSeq: number): Promise<void> {
  await putConversations(localDb()!, [
    { id: CONV, dto: {}, maxSeq, clearedBeforeSeq: 0, updatedAt: 1 },
  ]);
}

beforeEach(async () => {
  fetchAfter.mockReset();
  fetchHistory.mockReset();
  fetchHistory.mockResolvedValue({ messages: [], hasMore: false });
  useMessageStore.setState({ messagesByConv: {}, hasMoreByConv: {} });
  await initLocalStore("reconcile-test");
});

afterEach(async () => {
  await purgeLocalStore();
});

describe("闸门常量", () => {
  it("每页 50、最多 20 轮", () => {
    expect(RECONCILE_PAGE).toBe(50);
    expect(RECONCILE_MAX_ROUNDS).toBe(20);
  });
});

describe("persistMessages / hydrateMessages", () => {
  it("落盘后能水合回来，按 seq 升序", async () => {
    persistMessages(CONV, [msg(2), msg(1), msg(3)]);
    await vi.waitFor(async () => {
      expect((await hydrateMessages(CONV)).map((m) => m.seq)).toEqual([1, 2, 3]);
    });
  });

  it("无 seq 的乐观条目不落盘（它属 outbox 职责）", async () => {
    persistMessages(CONV, [{ ...msg(1), seq: undefined } as ChatMessage]);
    await vi.waitFor(async () => {
      expect(await hydrateMessages(CONV)).toHaveLength(0);
    });
  });

  it("降级模式（无库）下落盘与水合都不抛错", async () => {
    await purgeLocalStore();
    expect(() => persistMessages(CONV, [msg(1)])).not.toThrow();
    await expect(hydrateMessages(CONV)).resolves.toEqual([]);
    await initLocalStore("reconcile-test");
  });

  it("落盘失败被吞掉，不向上抛", async () => {
    vi.spyOn(localDb()!, "transaction").mockImplementation((() => {
      throw new DOMException("boom", "UnknownError");
    }) as IDBDatabase["transaction"]);
    expect(() => persistMessages(CONV, [msg(1)])).not.toThrow();
  });
});

describe("noteIncoming —— 水位推进与空洞判定", () => {
  it("连续到达推进水位、不报空洞", async () => {
    await seedConv(10);
    expect(await noteIncoming(CONV, 11)).toBe(false);
    expect((await getConversation(localDb()!, CONV))!.maxSeq).toBe(11);
  });

  it("跳号报空洞且水位不动（这条钉住永久丢空洞的缺陷）", async () => {
    await seedConv(10);
    expect(await noteIncoming(CONV, 15)).toBe(true);
    expect((await getConversation(localDb()!, CONV))!.maxSeq).toBe(10);
  });

  it("重复帧不报空洞、水位不动", async () => {
    await seedConv(10);
    expect(await noteIncoming(CONV, 10)).toBe(false);
    expect((await getConversation(localDb()!, CONV))!.maxSeq).toBe(10);
  });

  it("会话行不存在时不报空洞（还没拉过列表，不该触发补齐）", async () => {
    expect(await noteIncoming("unknown-conv", 5)).toBe(false);
  });
});

describe("reconcileConversation —— 三道闸门", () => {
  it("has_more=false 时一轮即停", async () => {
    await seedConv(10);
    fetchAfter.mockResolvedValueOnce({ messages: [msg(11), msg(12)], hasMore: false });

    const got = await reconcileConversation(CONV, SELF);

    expect(fetchAfter).toHaveBeenCalledTimes(1);
    expect(fetchAfter).toHaveBeenCalledWith(CONV, 10, RECONCILE_PAGE, SELF);
    expect(got.map((m) => m.seq)).toEqual([11, 12]);
    expect((await getConversation(localDb()!, CONV))!.maxSeq).toBe(12);
  });

  // 空结果不能清空已渲染的消息
  it("服务端回空数组时不动本地已有消息，也不动水位", async () => {
    await seedConv(3);
    await putMessages(localDb()!, [msg(1), msg(2), msg(3)].map(localRowOf));
    fetchAfter.mockResolvedValueOnce({ messages: [], hasMore: false });

    const got = await reconcileConversation(CONV, SELF);

    expect(got).toEqual([]);
    expect((await hydrateMessages(CONV)).map((m) => m.seq)).toEqual([1, 2, 3]);
    expect((await getConversation(localDb()!, CONV))!.maxSeq).toBe(3);
  });

  it("has_more=true 时按游标续拉，游标取上一页最大 seq", async () => {
    await seedConv(0);
    fetchAfter
      .mockResolvedValueOnce({ messages: [msg(1), msg(2)], hasMore: true })
      .mockResolvedValueOnce({ messages: [msg(3)], hasMore: false });

    await reconcileConversation(CONV, SELF);

    expect(fetchAfter).toHaveBeenNthCalledWith(1, CONV, 0, RECONCILE_PAGE, SELF);
    expect(fetchAfter).toHaveBeenNthCalledWith(2, CONV, 2, RECONCILE_PAGE, SELF);
  });

  it("循环轮数达上限即停（防长期离线账号把本地库撑爆）", async () => {
    await seedConv(0);
    // 永远 hasMore=true：只靠 has_more 会无限循环
    let n = 0;
    fetchAfter.mockImplementation(() => {
      n++;
      return Promise.resolve({ messages: [msg(n)], hasMore: true });
    });

    await reconcileConversation(CONV, SELF);

    expect(fetchAfter).toHaveBeenCalledTimes(RECONCILE_MAX_ROUNDS);
  });

  it("补满保留窗口即停，即使 has_more 仍为 true", async () => {
    await seedConv(0);
    let base = 0;
    fetchAfter.mockImplementation(() => {
      const page = Array.from({ length: RECONCILE_PAGE }, (_, i) => msg(base + i + 1));
      base += RECONCILE_PAGE;
      return Promise.resolve({ messages: page, hasMore: true });
    });

    await reconcileConversation(CONV, SELF);

    // 500 / 50 = 10 轮就该停，远小于 20 轮上限
    expect(fetchAfter).toHaveBeenCalledTimes(10);
  });

  it("网络失败时返回已补到的部分，不抛错", async () => {
    await seedConv(0);
    fetchAfter
      .mockResolvedValueOnce({ messages: [msg(1)], hasMore: true })
      .mockRejectedValueOnce(new Error("offline"));

    const got = await reconcileConversation(CONV, SELF);

    expect(got.map((m) => m.seq)).toEqual([1]);
    expect((await getConversation(localDb()!, CONV))!.maxSeq).toBe(1);
  });

  it("降级模式下直接返回空，不打网络", async () => {
    await purgeLocalStore();
    expect(await reconcileConversation(CONV, SELF)).toEqual([]);
    expect(fetchAfter).not.toHaveBeenCalled();
    await initLocalStore("reconcile-test");
  });
});

describe("loadHistory —— 先水合再打网络", () => {
  it("冷启动先渲染本地，随后仍会拉网络刷新", async () => {
    await putMessages(localDb()!, [msg(1), msg(2)].map(localRowOf));
    fetchHistory.mockResolvedValueOnce({ messages: [msg(1), msg(2), msg(3)], hasMore: false });

    await useMessageStore.getState().loadHistory(CONV);

    // 水合把本地内容填进内存后，短路判据仍须按「进来之前」算，否则永远打不到网络
    expect(fetchHistory).toHaveBeenCalledTimes(1);
    expect(useMessageStore.getState().messagesByConv[CONV].map((m) => m.seq)).toEqual([1, 2, 3]);
  });

  it("内存里已有消息时整体短路，既不水合也不打网络", async () => {
    fetchHistory.mockResolvedValueOnce({ messages: [msg(1)], hasMore: false });
    await useMessageStore.getState().loadHistory(CONV);
    fetchHistory.mockClear();

    await useMessageStore.getState().loadHistory(CONV);

    expect(fetchHistory).not.toHaveBeenCalled();
  });
});
