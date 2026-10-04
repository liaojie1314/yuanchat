import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  initLocalStore,
  purgeLocalStore,
  localDb,
  putConversations,
  getConversation,
  putMessages,
  putMedia,
  getMedia,
  listMessagesDesc,
  mediaBytesTotal,
  RETENTION_PER_CONV,
} from "../localdb";
import {
  replayRecall,
  replayEdit,
  replayClear,
  pruneOnLeave,
  localRowOf,
  reconcileConversation,
} from "../store/messageLocalSync";
import type { ChatMessage } from "../store/messageStore";

const CONV = "c1";

const fetchAfter = vi.hoisted(() => vi.fn());
vi.mock("../api/chat", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, fetchMessagesAfter: fetchAfter };
});

function text(seq: number, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m" + seq,
    conversationId: CONV,
    kind: "text",
    isSelf: false,
    text: "t" + seq,
    time: "10:00",
    seq,
    status: "sent",
    ...over,
  } as ChatMessage;
}

/** 落一行会话投影 */
async function seedConv(maxSeq = 0): Promise<void> {
  await putConversations(localDb()!, [
    { id: CONV, dto: {}, maxSeq, clearedBeforeSeq: 0, updatedAt: 1 },
  ]);
}

/** 等 fire-and-forget 的回放落盘 */
async function settled(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

beforeEach(async () => {
  fetchAfter.mockReset();
  await initLocalStore("replay-test");
});

afterEach(async () => {
  await purgeLocalStore();
});

describe("replayRecall —— 撤回即访问撤销", () => {
  it("撤回一条图片消息：行没了、blob 没了、配额账本下降", async () => {
    await putMedia(localDb()!, "img-1", new ArrayBuffer(4096), "image/jpeg");
    await putMessages(localDb()!, [
      localRowOf(text(1, { kind: "image", image: { key: "img-1", width: 1, height: 1 } } as never)),
    ]);
    expect(await mediaBytesTotal(localDb()!)).toBe(4096);

    replayRecall("m1");
    await settled();

    expect(await listMessagesDesc(localDb()!, CONV, 0, 10)).toHaveLength(0);
    expect(await getMedia(localDb()!, "img-1")).toBeNull();
    expect(await mediaBytesTotal(localDb()!)).toBe(0);
  });

  it("撤回一条已被保留窗口淘汰的消息：no-op 不抛错", async () => {
    expect(() => replayRecall("never-stored")).not.toThrow();
    await settled();
    expect(await listMessagesDesc(localDb()!, CONV, 0, 10)).toHaveLength(0);
  });

  it("不留占位行（留行而不删 blob 就等于断网还能看已撤回的图）", async () => {
    await putMessages(localDb()!, [localRowOf(text(1)), localRowOf(text(2))]);
    replayRecall("m1");
    await settled();
    expect((await listMessagesDesc(localDb()!, CONV, 0, 10)).map((r) => r.id)).toEqual(["m2"]);
  });

  it("降级模式下不抛错", async () => {
    await purgeLocalStore();
    expect(() => replayRecall("m1")).not.toThrow();
    await initLocalStore("replay-test");
  });
});

describe("replayEdit —— 就地改 dto", () => {
  it("读回的 text 是新文本、editCount 正确、seq 不变（编辑不改位置）", async () => {
    await putMessages(localDb()!, [localRowOf(text(7))]);

    replayEdit("m7", "改过的正文", 3);
    await settled();

    const rows = await listMessagesDesc(localDb()!, CONV, 0, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].seq).toBe(7);
    const dto = rows[0].dto as ChatMessage;
    expect(dto.text).toBe("改过的正文");
    expect(dto.edited).toBe(true);
    expect(dto.editCount).toBe(3);
  });

  it("消息不在本地时 no-op 不抛错，也不凭空造行", async () => {
    replayEdit("missing", "x", 1);
    await settled();
    expect(await listMessagesDesc(localDb()!, CONV, 0, 10)).toHaveLength(0);
  });

  it("降级模式下不抛错", async () => {
    await purgeLocalStore();
    expect(() => replayEdit("m1", "x", 1)).not.toThrow();
    await initLocalStore("replay-test");
  });
});

describe("replayClear —— 删行 + 推水位两步必做", () => {
  it("本地消息与 blob 全没，会话行 clearedBeforeSeq 推到本地最大 seq", async () => {
    await seedConv(3);
    await putMedia(localDb()!, "img-3", new ArrayBuffer(2048), "image/jpeg");
    await putMessages(localDb()!, [
      localRowOf(text(1)),
      localRowOf(text(2)),
      localRowOf(text(3, { kind: "image", image: { key: "img-3", width: 1, height: 1 } } as never)),
    ]);

    replayClear(CONV);
    await settled();

    expect(await listMessagesDesc(localDb()!, CONV, 0, 10)).toHaveLength(0);
    expect(await getMedia(localDb()!, "img-3")).toBeNull();
    expect(await mediaBytesTotal(localDb()!)).toBe(0);
    expect((await getConversation(localDb()!, CONV))!.clearedBeforeSeq).toBe(3);
  });

  it("清空后再 reconcile 不会把已清空的消息拉回来（游标从水位起算）", async () => {
    await seedConv(3);
    await putMessages(localDb()!, [localRowOf(text(1)), localRowOf(text(2)), localRowOf(text(3))]);

    replayClear(CONV);
    await settled();

    // 服务端同样已把本人水位推到 3，after_seq=3 之后没有新消息
    fetchAfter.mockResolvedValueOnce({ messages: [], hasMore: false });
    const got = await reconcileConversation(CONV, "me");

    expect(fetchAfter).toHaveBeenCalledWith(CONV, 3, 50, "me");
    expect(got).toEqual([]);
    expect(await listMessagesDesc(localDb()!, CONV, 0, 10)).toHaveLength(0);
  });

  it("本地没有消息时也推进水位（未开过会话就清空，不能留残渣）", async () => {
    await seedConv(9);
    replayClear(CONV);
    await settled();
    expect((await getConversation(localDb()!, CONV))!.clearedBeforeSeq).toBe(9);
  });

  it("降级模式下不抛错", async () => {
    await purgeLocalStore();
    expect(() => replayClear(CONV)).not.toThrow();
    await initLocalStore("replay-test");
  });
});

describe("pruneOnLeave —— 淘汰时机是会话关闭", () => {
  it("超出保留窗口的最老消息被淘汰，窗口内的留着", async () => {
    const rows = Array.from({ length: RETENTION_PER_CONV + 2 }, (_, i) => localRowOf(text(i + 1)));
    await putMessages(localDb()!, rows);

    pruneOnLeave(CONV);
    await settled();

    const left = await listMessagesDesc(localDb()!, CONV, 0, RETENTION_PER_CONV + 10);
    expect(left).toHaveLength(RETENTION_PER_CONV);
    expect(left[0].seq).toBe(3);
  });

  it("未超窗口时不动任何行", async () => {
    await putMessages(localDb()!, [localRowOf(text(1))]);
    pruneOnLeave(CONV);
    await settled();
    expect(await listMessagesDesc(localDb()!, CONV, 0, 10)).toHaveLength(1);
  });

  it("降级模式下不抛错", async () => {
    await purgeLocalStore();
    expect(() => pruneOnLeave(CONV)).not.toThrow();
    await initLocalStore("replay-test");
  });
});
