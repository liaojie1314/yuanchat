import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  initLocalStore,
  purgeLocalStore,
  localDb,
  putMessages,
  listMessagesDesc,
  listOutbox,
} from "../localdb";
import { startLocalStore } from "../store/localStoreLifecycle";
import { enqueueSend } from "../store/outboxSync";
import { useMessageStore } from "../store/messageStore";
import { resetChatStores } from "../store/resetStores";
import { localRowOf } from "../store/messageLocalSync";
import type { ChatMessage } from "../store/messageStore";

const CONV = "c1";

const fetchHistory = vi.hoisted(() => vi.fn());
vi.mock("../api/chat", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, fetchMessages: fetchHistory };
});

function text(seq: number): ChatMessage {
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

/** 等 fire-and-forget 落盘 */
async function settled(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

beforeEach(() => {
  fetchHistory.mockReset();
  fetchHistory.mockResolvedValue({ messages: [], hasMore: false });
  useMessageStore.setState({ messagesByConv: {}, hasMoreByConv: {} });
});

afterEach(async () => {
  await purgeLocalStore();
  vi.unstubAllGlobals();
});

describe("账号隔离", () => {
  it("登录 A 存数据 → 登出 → 登录 B：B 看不到 A 的任何数据", async () => {
    await startLocalStore("userA");
    await putMessages(localDb()!, [localRowOf(text(1))]);

    resetChatStores();
    await settled();

    await startLocalStore("userB");
    expect(await listMessagesDesc(localDb()!, CONV, 0, 10)).toHaveLength(0);
  });

  it("登出后再登录 A：A 的数据已被删掉（登出即清，不是留着）", async () => {
    await startLocalStore("userA");
    await putMessages(localDb()!, [localRowOf(text(1))]);
    expect(await listMessagesDesc(localDb()!, CONV, 0, 10)).toHaveLength(1);

    resetChatStores();
    await settled();

    await startLocalStore("userA");
    expect(await listMessagesDesc(localDb()!, CONV, 0, 10)).toHaveLength(0);
  });
});

describe("降级模式不阻塞登录", () => {
  it("IDB 不可用时 startLocalStore 返回 false 且不抛错", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(startLocalStore("userC")).resolves.toBe(false);
  });
});

describe("待发队列恢复", () => {
  it("恢复出的条目是 failed 气泡、带 clientMsgId，落在对应会话末尾", async () => {
    await initLocalStore("userD");
    enqueueSend(CONV, "cid-left", {
      conversation_id: CONV,
      client_msg_id: "cid-left",
      content: { type: "text", text: "上次没发出去的" },
    });
    await settled();
    // 换个「冷启动」：关掉句柄重新按登录流程开库
    expect(await listOutbox(localDb()!)).toHaveLength(1);

    await startLocalStore("userD");

    const list = useMessageStore.getState().messagesByConv[CONV] ?? [];
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("failed");
    expect(list[0].clientMsgId).toBe("cid-left");
    expect(list[0].text).toBe("上次没发出去的");
  });

  it("重复调用不会把同一条恢复成两个气泡", async () => {
    await initLocalStore("userE");
    enqueueSend(CONV, "cid-dup", {
      conversation_id: CONV,
      client_msg_id: "cid-dup",
      content: { type: "text", text: "x" },
    });
    await settled();

    await startLocalStore("userE");
    await startLocalStore("userE");

    expect(useMessageStore.getState().messagesByConv[CONV] ?? []).toHaveLength(1);
  });

  it("队列为空时不动 store", async () => {
    await startLocalStore("userF");
    expect(useMessageStore.getState().messagesByConv[CONV]).toBeUndefined();
  });
});

describe("未确认条目不被历史加载冲掉", () => {
  it("只有 failed 气泡的会话仍会去拉历史，拉回来后气泡留在末尾", async () => {
    await startLocalStore("userG");
    useMessageStore.setState({
      messagesByConv: {
        [CONV]: [
          {
            id: "cid-keep",
            clientMsgId: "cid-keep",
            conversationId: CONV,
            kind: "text",
            isSelf: true,
            text: "没发出去",
            time: "",
            status: "failed",
          } as ChatMessage,
        ],
      },
    });
    fetchHistory.mockResolvedValueOnce({ messages: [text(1), text(2)], hasMore: false });

    await useMessageStore.getState().loadHistory(CONV);

    // 列表里只有未确认条目时不算「已加载过」，否则 failed 气泡会永久挡住历史
    expect(fetchHistory).toHaveBeenCalledTimes(1);
    const list = useMessageStore.getState().messagesByConv[CONV];
    expect(list.map((m) => m.id)).toEqual(["m1", "m2", "cid-keep"]);
  });

  it("已有已确认历史时照旧短路，不重复拉", async () => {
    await startLocalStore("userH");
    useMessageStore.setState({ messagesByConv: { [CONV]: [text(1)] } });

    await useMessageStore.getState().loadHistory(CONV);

    expect(fetchHistory).not.toHaveBeenCalled();
  });
});
