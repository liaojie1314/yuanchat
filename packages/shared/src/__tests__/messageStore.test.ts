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
import * as filesApi from "../api/files";

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
    useMessageStore.getState().applyAck(id, "srv-42", CONV, 42, Date.now());

    const msg = useMessageStore.getState().messagesByConv[CONV][0];
    expect(msg.status).toBe("sent");
    expect(msg.seq).toBe(42);
  });

  it("applyAck promotes optimistic id to server message id so recall-by-server-id works", () => {
    const clientId = useMessageStore.getState().sendText(CONV, "recall me");
    const serverId = "srv-msg-777";
    useMessageStore.getState().applyAck(clientId, serverId, CONV, 5, Date.now());

    const msg = useMessageStore.getState().messagesByConv[CONV][0];
    // id 从本地 client id 提升为服务端 message id（撤回、去重都以服务端 id 为准）
    expect(msg.id).toBe(serverId);
    expect(msg.status).toBe("sent");
    expect(msg.seq).toBe(5);
    // clientMsgId 保留：message.receive 自回显仍按 clientMsgId 去重
    expect(msg.clientMsgId).toBe(clientId);

    // 撤回帧携带服务端 message_id → applyRecall(按 id) 现在能命中并翻转
    useMessageStore.getState().applyRecall(CONV, serverId, "我");
    const recalled = useMessageStore.getState().messagesByConv[CONV][0];
    expect(recalled.recalled).toBe(true);
    expect(recalled.text).toBeUndefined();
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
    useMessageStore.getState().applyAck(id, "srv-7", CONV, 7, Date.now());
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
    useMessageStore.getState().applyAck(id1, "srv-a", CONV, 1, Date.now());
    useMessageStore.getState().applyAck(id2, "srv-b", CONV, 2, Date.now());

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

  it("applyRecall flags the target message and clears its text, leaving others intact", () => {
    useMessageStore.setState({
      messagesByConv: {
        [CONV]: [
          {
            id: "m-1",
            conversationId: CONV,
            kind: "text",
            isSelf: true,
            text: "撤回我",
            time: "10:00",
            seq: 1,
          },
          {
            id: "m-2",
            conversationId: CONV,
            kind: "text",
            isSelf: false,
            senderName: "Bob",
            text: "保留我",
            time: "10:01",
            seq: 2,
          },
        ],
      },
    });

    useMessageStore.getState().applyRecall(CONV, "m-1", "我");

    const list = useMessageStore.getState().messagesByConv[CONV];
    expect(list[0].recalled).toBe(true);
    expect(list[0].text).toBeUndefined();
    // 其余消息不受影响
    expect(list[1].recalled).toBeUndefined();
    expect(list[1].text).toBe("保留我");
  });

  it("applyRecall is a no-op for unknown conversation / message id", () => {
    useMessageStore.setState({
      messagesByConv: {
        [CONV]: [
          { id: "m-1", conversationId: CONV, kind: "text", isSelf: true, text: "x", time: "10:00" },
        ],
      },
    });

    useMessageStore.getState().applyRecall("missing-conv", "m-1", "我");
    useMessageStore.getState().applyRecall(CONV, "missing-msg", "我");

    const list = useMessageStore.getState().messagesByConv[CONV];
    expect(list[0].recalled).toBeUndefined();
    expect(list[0].text).toBe("x");
  });

  it("applyRecall 保留自己文本消息原文供重新编辑", () => {
    useMessageStore.setState({
      messagesByConv: {
        c1: [
          {
            id: "m1",
            conversationId: "c1",
            kind: "text",
            isSelf: true,
            text: "hello",
            time: "10:00",
          },
        ],
      },
    });
    useMessageStore.getState().applyRecall("c1", "m1", "我");
    const m = useMessageStore.getState().messagesByConv.c1[0];
    expect(m.recalled).toBe(true);
    expect(m.text).toBeUndefined();
    expect(m.recalledText).toBe("hello");
    expect(typeof m.recalledAtMs).toBe("number");
  });

  it("applyRecall 对他人消息不保留原文", () => {
    useMessageStore.setState({
      messagesByConv: {
        c1: [
          {
            id: "m2",
            conversationId: "c1",
            kind: "text",
            isSelf: false,
            text: "hi",
            time: "10:00",
          },
        ],
      },
    });
    useMessageStore.getState().applyRecall("c1", "m2", "对方");
    expect(useMessageStore.getState().messagesByConv.c1[0].recalledText).toBeUndefined();
  });

  it("setComposerInsert 写入与清空", () => {
    useMessageStore.getState().setComposerInsert("draft");
    expect(useMessageStore.getState().composerInsert).toBe("draft");
    useMessageStore.getState().setComposerInsert(null);
    expect(useMessageStore.getState().composerInsert).toBeNull();
  });
});

describe("messageStore.sendImage (real mode)", () => {
  let revokeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    setMessageMockMode(false);
    reset();
    vi.spyOn(chatSocket, "send").mockImplementation(() => {});
    // node 环境无 URL.createObjectURL / canvas：桩掉本地预览与压缩
    // revokeObjectURL 用 vi.fn 以便断言 ack 后释放 blob（防长会话内存泄漏）
    revokeSpy = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: () => "blob:local-1", revokeObjectURL: revokeSpy });
    vi.spyOn(filesApi, "compressImage").mockResolvedValue({
      blob: new Blob(["x"], { type: "image/jpeg" }),
      width: 800,
      height: 600,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("optimistically inserts an image message with localUrl and sending status, then uploads + emits image frame", async () => {
    vi.spyOn(filesApi, "getUploadUrl").mockResolvedValue({
      uploadUrl: "https://put",
      objectKey: "images/2026/07/k.jpg",
    });
    vi.spyOn(filesApi, "uploadToTicket").mockResolvedValue(undefined);

    await useMessageStore.getState().sendImage(CONV, new Blob(["src"], { type: "image/jpeg" }));

    const list = useMessageStore.getState().messagesByConv[CONV];
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe("image");
    expect(list[0].status).toBe("sending");
    expect(list[0].image?.localUrl).toBe("blob:local-1");
    expect(list[0].image?.width).toBe(800);
    // key 回填到乐观消息
    expect(list[0].image?.key).toBe("images/2026/07/k.jpg");

    // WS 帧带 image content + 对象 key + 尺寸
    const call = vi.mocked(chatSocket.send).mock.calls.find(([tp]) => tp === "message.send");
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        conversation_id: CONV,
        content: expect.objectContaining({
          type: "image",
          key: "images/2026/07/k.jpg",
          width: 800,
          height: 600,
        }),
        client_msg_id: list[0].clientMsgId,
      }),
    );
  });

  it("marks the message failed when upload throws (no WS frame sent)", async () => {
    vi.spyOn(filesApi, "getUploadUrl").mockRejectedValue(new Error("network"));

    await useMessageStore.getState().sendImage(CONV, new Blob(["src"], { type: "image/jpeg" }));

    const list = useMessageStore.getState().messagesByConv[CONV];
    expect(list[0].status).toBe("failed");
    const sendCall = vi.mocked(chatSocket.send).mock.calls.find(([tp]) => tp === "message.send");
    expect(sendCall).toBeUndefined();
  });

  it("applyAck reconciles the optimistic image message to sent, preserving image payload", async () => {
    vi.spyOn(filesApi, "getUploadUrl").mockResolvedValue({
      uploadUrl: "https://put",
      objectKey: "images/2026/07/k.jpg",
    });
    vi.spyOn(filesApi, "uploadToTicket").mockResolvedValue(undefined);

    await useMessageStore.getState().sendImage(CONV, new Blob(["src"], { type: "image/jpeg" }));
    const clientId = useMessageStore.getState().messagesByConv[CONV][0].clientMsgId!;
    useMessageStore.getState().applyAck(clientId, "srv-img-1", CONV, 9, Date.now());

    const msg = useMessageStore.getState().messagesByConv[CONV][0];
    expect(msg.status).toBe("sent");
    expect(msg.id).toBe("srv-img-1");
    expect(msg.seq).toBe(9);
    // 对象 key 在 ack 后保留（新挂载据此签下载渲染）
    expect(msg.image?.key).toBe("images/2026/07/k.jpg");
  });

  it("applyAck revokes the local blob preview and clears localUrl to free memory", async () => {
    vi.spyOn(filesApi, "getUploadUrl").mockResolvedValue({
      uploadUrl: "https://put",
      objectKey: "images/2026/07/k.jpg",
    });
    vi.spyOn(filesApi, "uploadToTicket").mockResolvedValue(undefined);

    await useMessageStore.getState().sendImage(CONV, new Blob(["src"], { type: "image/jpeg" }));
    const before = useMessageStore.getState().messagesByConv[CONV][0];
    expect(before.image?.localUrl).toBe("blob:local-1");

    const clientId = before.clientMsgId!;
    useMessageStore.getState().applyAck(clientId, "srv-img-1", CONV, 9, Date.now());

    const after = useMessageStore.getState().messagesByConv[CONV][0];
    // ack 后 localUrl 被清除，且旧 blob URL 已撤销（长会话内存不再堆积压缩图）
    expect(after.image?.localUrl).toBeUndefined();
    expect(after.image?.key).toBe("images/2026/07/k.jpg");
    expect(revokeSpy).toHaveBeenCalledWith("blob:local-1");
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
