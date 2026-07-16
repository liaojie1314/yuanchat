/**
 * messageStore 单元测试
 *
 * 覆盖真实模式的 WS 驱动状态机：
 * sendText 乐观插入 → applyAck 补 seq → applyRead 已读翻转，
 * receiveMessage 去重、setTyping 自动清除、ack 超时 → failed → retrySend。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setMessageMockMode, useMessageStore } from "../store/messageStore";
import type { ChatMessage } from "../store/messageStore";
import { chatSocket } from "../ws/chatSocket";

const CONV = "conv-1";

function reset() {
  useMessageStore.setState({
    messagesByConv: {},
    hasMoreByConv: {},
    typingByConv: {},
    replyingTo: null,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  setMessageMockMode(false);
  reset();
  // 隔离网络：send 打桩
  vi.spyOn(chatSocket, "send").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("messageStore (real mode)", () => {
  it("sendText optimistically inserts a sending message and emits message.send", () => {
    const id = useMessageStore.getState().sendText(CONV, "hello");

    const list = useMessageStore.getState().messagesByConv[CONV];
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(list[0].status).toBe("sending");
    expect(list[0].clientMsgId).toBe(id);

    expect(chatSocket.send).toHaveBeenCalledWith(
      "message.send",
      expect.objectContaining({
        conversation_id: CONV,
        content: { type: "text", text: "hello" },
        client_msg_id: id,
      }),
    );
  });

  it("applyAck marks message sent with server seq", () => {
    const id = useMessageStore.getState().sendText(CONV, "hi");
    useMessageStore.getState().applyAck(id, CONV, 42, Date.now());

    const msg = useMessageStore.getState().messagesByConv[CONV][0];
    expect(msg.status).toBe("sent");
    expect(msg.seq).toBe(42);
  });

  it("marks message failed when ack does not arrive in time", () => {
    const id = useMessageStore.getState().sendText(CONV, "lost");
    vi.advanceTimersByTime(5001);

    const msg = useMessageStore.getState().messagesByConv[CONV][0];
    expect(msg.id).toBe(id);
    expect(msg.status).toBe("failed");
  });

  it("ack before timeout prevents failed state", () => {
    const id = useMessageStore.getState().sendText(CONV, "ok");
    vi.advanceTimersByTime(2000);
    useMessageStore.getState().applyAck(id, CONV, 7, Date.now());
    vi.advanceTimersByTime(10_000);

    expect(useMessageStore.getState().messagesByConv[CONV][0].status).toBe("sent");
  });

  it("retrySend resends with the same client_msg_id", () => {
    const id = useMessageStore.getState().sendText(CONV, "retry me");
    vi.advanceTimersByTime(5001);
    expect(useMessageStore.getState().messagesByConv[CONV][0].status).toBe("failed");

    useMessageStore.getState().retrySend(CONV, id);
    expect(useMessageStore.getState().messagesByConv[CONV][0].status).toBe("sending");

    const calls = vi.mocked(chatSocket.send).mock.calls.filter(([t]) => t === "message.send");
    expect(calls).toHaveLength(2);
    expect((calls[1][1] as { client_msg_id: string }).client_msg_id).toBe(id);
  });

  it("applyRead flips own sent messages up to seq", () => {
    const id1 = useMessageStore.getState().sendText(CONV, "a");
    const id2 = useMessageStore.getState().sendText(CONV, "b");
    useMessageStore.getState().applyAck(id1, CONV, 1, Date.now());
    useMessageStore.getState().applyAck(id2, CONV, 2, Date.now());

    useMessageStore.getState().applyRead(CONV, 1);

    const list = useMessageStore.getState().messagesByConv[CONV];
    expect(list[0].status).toBe("read");
    expect(list[1].status).toBe("sent");
  });

  it("receiveMessage appends and dedupes by id / clientMsgId", () => {
    const incoming: ChatMessage = {
      id: "srv-1",
      conversationId: CONV,
      kind: "text",
      isSelf: false,
      senderName: "Bob",
      text: "yo",
      seq: 3,
      time: "10:00",
    };
    useMessageStore.getState().receiveMessage(incoming);
    useMessageStore.getState().receiveMessage(incoming); // 重复推送
    expect(useMessageStore.getState().messagesByConv[CONV]).toHaveLength(1);

    // 自己设备的回显（clientMsgId 命中本地乐观消息）
    const id = useMessageStore.getState().sendText(CONV, "mine");
    useMessageStore.getState().receiveMessage({
      id: "srv-2",
      conversationId: CONV,
      kind: "text",
      isSelf: true,
      text: "mine",
      seq: 4,
      time: "10:01",
      clientMsgId: id,
    });
    expect(useMessageStore.getState().messagesByConv[CONV]).toHaveLength(2);
  });

  it("incoming peer message clears typing indicator", () => {
    useMessageStore.getState().setTyping(CONV, "Bob");
    expect(useMessageStore.getState().typingByConv[CONV]).toBe("Bob");

    useMessageStore.getState().receiveMessage({
      id: "srv-9",
      conversationId: CONV,
      kind: "text",
      isSelf: false,
      text: "done typing",
      seq: 9,
      time: "10:02",
    });
    expect(useMessageStore.getState().typingByConv[CONV]).toBeUndefined();
  });

  it("setTyping auto-clears after 4s", () => {
    useMessageStore.getState().setTyping(CONV, "Bob");
    vi.advanceTimersByTime(3999);
    expect(useMessageStore.getState().typingByConv[CONV]).toBe("Bob");
    vi.advanceTimersByTime(1);
    expect(useMessageStore.getState().typingByConv[CONV]).toBeUndefined();
  });

  it("repeated typing extends the clear timer", () => {
    useMessageStore.getState().setTyping(CONV, "Bob");
    vi.advanceTimersByTime(3000);
    useMessageStore.getState().setTyping(CONV, "Bob");
    vi.advanceTimersByTime(3000);
    expect(useMessageStore.getState().typingByConv[CONV]).toBe("Bob");
    vi.advanceTimersByTime(1000);
    expect(useMessageStore.getState().typingByConv[CONV]).toBeUndefined();
  });
});

describe("messageStore (mock mode)", () => {
  it("simulates sent → read receipts without network", () => {
    setMessageMockMode(true);
    const id = useMessageStore.getState().sendText(CONV, "demo");
    expect(chatSocket.send).not.toHaveBeenCalled();

    vi.advanceTimersByTime(700);
    expect(useMessageStore.getState().messagesByConv[CONV][0].status).toBe("sent");
    vi.advanceTimersByTime(900);
    expect(useMessageStore.getState().messagesByConv[CONV][0].status).toBe("read");
    expect(useMessageStore.getState().messagesByConv[CONV][0].id).toBe(id);
  });
});
