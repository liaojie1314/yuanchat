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
import i18n from "@yuanchat/design-system/i18n";
import { useToastStore } from "../store/toastStore";

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

  it("applyReaction 新增/更新/清零回应聚合", () => {
    useMessageStore.setState({
      messagesByConv: {
        c1: [
          {
            id: "m1",
            conversationId: "c1",
            kind: "text",
            isSelf: false,
            text: "hi",
            time: "10:00",
          },
        ],
      },
    });
    const apply = useMessageStore.getState().applyReaction;
    apply("c1", "m1", "👍", 1, true);
    expect(useMessageStore.getState().messagesByConv.c1[0].reactions).toEqual([
      { emoji: "👍", count: 1, mine: true },
    ]);
    apply("c1", "m1", "👍", 2, undefined); // 他人 +1，mine 保持
    expect(useMessageStore.getState().messagesByConv.c1[0].reactions![0]).toEqual({
      emoji: "👍",
      count: 2,
      mine: true,
    });
    apply("c1", "m1", "👍", 0, false); // 自己取消且归零 → 条目移除
    expect(useMessageStore.getState().messagesByConv.c1[0].reactions).toEqual([]);
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

describe("messageStore.sendFile (real mode)", () => {
  let revokeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    setMessageMockMode(false);
    reset();
    vi.spyOn(chatSocket, "send").mockImplementation(() => {});
    revokeSpy = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: () => "blob:file-1", revokeObjectURL: revokeSpy });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("sendFile 乐观插入 file 气泡（sending + 本地元数据）并发 file 帧", async () => {
    vi.spyOn(filesApi, "getUploadUrl").mockResolvedValue({
      uploadUrl: "https://put",
      objectKey: "files/2026/07/k.pdf",
    });
    vi.spyOn(filesApi, "uploadToTicket").mockResolvedValue(undefined);

    const file = new File([new Uint8Array(1024)], "合同.pdf", { type: "application/pdf" });
    await useMessageStore.getState().sendFile(CONV, file);

    const m = useMessageStore.getState().messagesByConv[CONV][0];
    expect(m.kind).toBe("file");
    expect(m.file?.name).toBe("合同.pdf");
    expect(m.file?.ext).toBe("PDF");
    expect(m.file?.size).toBe("1.0 KB");
    expect(m.status).toBe("sending");
    expect(m.file?.key).toBe("files/2026/07/k.pdf");

    const call = vi.mocked(chatSocket.send).mock.calls.find(([tp]) => tp === "message.send");
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        conversation_id: CONV,
        content: expect.objectContaining({
          type: "file",
          key: "files/2026/07/k.pdf",
          name: "合同.pdf",
          size: 1024,
        }),
        client_msg_id: m.clientMsgId,
      }),
    );
  });

  it("上传失败置 failed 且不发帧", async () => {
    vi.spyOn(filesApi, "getUploadUrl").mockRejectedValue(new Error("network"));

    const file = new File(["x"], "a.zip", { type: "application/zip" });
    await useMessageStore.getState().sendFile(CONV, file);

    expect(useMessageStore.getState().messagesByConv[CONV][0].status).toBe("failed");
    const sendCall = vi.mocked(chatSocket.send).mock.calls.find(([tp]) => tp === "message.send");
    expect(sendCall).toBeUndefined();
  });

  it("applyAck 后 revoke file localUrl", async () => {
    vi.spyOn(filesApi, "getUploadUrl").mockResolvedValue({
      uploadUrl: "https://put",
      objectKey: "files/2026/07/k.pdf",
    });
    vi.spyOn(filesApi, "uploadToTicket").mockResolvedValue(undefined);

    const file = new File(["x"], "a.pdf", { type: "application/pdf" });
    await useMessageStore.getState().sendFile(CONV, file);
    const clientId = useMessageStore.getState().messagesByConv[CONV][0].clientMsgId!;
    useMessageStore.getState().applyAck(clientId, "srv-f-1", CONV, 3, Date.now());

    const after = useMessageStore.getState().messagesByConv[CONV][0];
    expect(after.status).toBe("sent");
    expect(after.file?.localUrl).toBeUndefined();
    expect(after.file?.key).toBe("files/2026/07/k.pdf");
    expect(revokeSpy).toHaveBeenCalledWith("blob:file-1");
  });
});

describe("messageStore.sendVideo (real mode)", () => {
  let revokeSpy: ReturnType<typeof vi.fn>;

  /** 一个「元数据可读」的视频：node 环境无解码器，故整体打桩 extractVideoMeta */
  function stubMeta(duration = 15) {
    return vi.spyOn(filesApi, "extractVideoMeta").mockResolvedValue({
      duration,
      width: 1280,
      height: 720,
      thumbnail: new Blob(["jpeg"], { type: "image/jpeg" }),
    });
  }

  /** 两次直传票据：先视频（files/）后缩略图（images/） */
  function stubUploads() {
    vi.spyOn(filesApi, "getUploadUrl")
      .mockResolvedValueOnce({ uploadUrl: "https://put", objectKey: "files/2026/09/v.mp4" })
      .mockResolvedValueOnce({ uploadUrl: "https://put", objectKey: "images/2026/09/t.jpg" });
    vi.spyOn(filesApi, "uploadToTicket").mockResolvedValue(undefined);
  }

  function videoFile(bytes = 1024): File {
    return new File([new Uint8Array(bytes)], "发布演示.mp4", { type: "video/mp4" });
  }

  /**
   * 断言最近一条 toast 用的就是指定 i18n key 的译文。
   *
   * @remarks showToast 在被测模块里是静态 import 绑定，vi.spyOn 改不到，故读真实 store。
   *   额外断言译文 ≠ key 本身：i18next 对缺失 key 原样返回 key，
   *   否则「locale 里没这条 key」会让 toBe(i18n.t(key)) 恒真（假绿）。
   */
  function expectToastKey(key: string) {
    const list = useToastStore.getState().toasts;
    const text = list.length > 0 ? list[list.length - 1].text : "";
    expect(i18n.t(key)).not.toBe(key);
    expect(text).toBe(i18n.t(key));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    setMessageMockMode(false);
    reset();
    useToastStore.setState({ toasts: [] });
    vi.spyOn(chatSocket, "send").mockImplementation(() => {});
    revokeSpy = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: () => "blob:video-1", revokeObjectURL: revokeSpy });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("乐观插入 video 气泡（localUrl + sending），回填 key/thumbKey/尺寸并发 video 帧", async () => {
    stubMeta();
    stubUploads();

    await useMessageStore.getState().sendVideo(CONV, videoFile(2048));

    const m = useMessageStore.getState().messagesByConv[CONV][0];
    expect(m.kind).toBe("video");
    expect(m.status).toBe("sending");
    expect(m.video?.localUrl).toBe("blob:video-1");
    expect(m.video?.name).toBe("发布演示.mp4");
    // 元数据回填：乐观插入时是 0，上传完成后是真实值
    expect(m.video?.key).toBe("files/2026/09/v.mp4");
    expect(m.video?.thumbKey).toBe("images/2026/09/t.jpg");
    expect(m.video?.duration).toBe(15);
    expect(m.video?.width).toBe(1280);
    expect(m.video?.height).toBe(720);

    const call = vi.mocked(chatSocket.send).mock.calls.find(([tp]) => tp === "message.send");
    expect(call?.[1]).toEqual({
      conversation_id: CONV,
      content: {
        type: "video",
        key: "files/2026/09/v.mp4",
        thumb_key: "images/2026/09/t.jpg",
        name: "发布演示.mp4",
        size: 2048,
        duration: 15,
        width: 1280,
        height: 720,
      },
      client_msg_id: m.clientMsgId,
    });
  });

  it("超过 100MB：置 failed + toast，且不读元数据、不发帧", async () => {
    const metaSpy = stubMeta();
    stubUploads();

    const file = videoFile(1024);
    // 造一个「超大」文件：真分配 100MB 只为跑断言不值当
    Object.defineProperty(file, "size", { value: 101 * 1024 * 1024 });
    await useMessageStore.getState().sendVideo(CONV, file);

    expect(useMessageStore.getState().messagesByConv[CONV][0].status).toBe("failed");
    expect(metaSpy).not.toHaveBeenCalled();
    expectToastKey("chat.video.tooLarge");
    expect(
      vi.mocked(chatSocket.send).mock.calls.find(([tp]) => tp === "message.send"),
    ).toBeUndefined();
  });

  it("超过 120 秒：置 failed + toast，且不上传字节", async () => {
    stubMeta(121);
    const uploadSpy = vi.spyOn(filesApi, "uploadToTicket").mockResolvedValue(undefined);

    await useMessageStore.getState().sendVideo(CONV, videoFile());

    expect(useMessageStore.getState().messagesByConv[CONV][0].status).toBe("failed");
    expectToastKey("chat.video.tooLong");
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(
      vi.mocked(chatSocket.send).mock.calls.find(([tp]) => tp === "message.send"),
    ).toBeUndefined();
  });

  it("元数据/抽帧失败：置 failed + toast（缩略图缺失的帧服务端必拒，不能发）", async () => {
    vi.spyOn(filesApi, "extractVideoMeta").mockRejectedValue(new Error("meta timeout"));

    await useMessageStore.getState().sendVideo(CONV, videoFile());

    expect(useMessageStore.getState().messagesByConv[CONV][0].status).toBe("failed");
    expectToastKey("chat.video.readFailed");
    expect(
      vi.mocked(chatSocket.send).mock.calls.find(([tp]) => tp === "message.send"),
    ).toBeUndefined();
  });

  it("上传失败：置 failed + toast，且不发帧", async () => {
    stubMeta();
    vi.spyOn(filesApi, "getUploadUrl").mockRejectedValue(new Error("network"));

    await useMessageStore.getState().sendVideo(CONV, videoFile());

    expect(useMessageStore.getState().messagesByConv[CONV][0].status).toBe("failed");
    expectToastKey("chat.video.sendFailed");
    expect(
      vi.mocked(chatSocket.send).mock.calls.find(([tp]) => tp === "message.send"),
    ).toBeUndefined();
  });

  it("applyAck 后撤销本地 blob 并保留 key（新挂载据 key 签下载播放）", async () => {
    stubMeta();
    stubUploads();

    await useMessageStore.getState().sendVideo(CONV, videoFile());
    const clientId = useMessageStore.getState().messagesByConv[CONV][0].clientMsgId!;
    useMessageStore.getState().applyAck(clientId, "srv-v-1", CONV, 7, Date.now());

    const after = useMessageStore.getState().messagesByConv[CONV][0];
    expect(after.status).toBe("sent");
    expect(after.video?.localUrl).toBeUndefined();
    expect(after.video?.key).toBe("files/2026/09/v.mp4");
    expect(revokeSpy).toHaveBeenCalledWith("blob:video-1");
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

describe("messageStore.clearConversation", () => {
  const CONV_B = "conv-b";

  it("empties messages and resets hasMore for the target conversation only", () => {
    useMessageStore.setState({
      messagesByConv: {
        [CONV]: [
          {
            id: "a1",
            conversationId: CONV,
            kind: "text",
            isSelf: false,
            text: "hi",
            time: "09:00",
          },
          { id: "a2", conversationId: CONV, kind: "text", isSelf: true, text: "yo", time: "09:01" },
        ],
        [CONV_B]: [
          {
            id: "b1",
            conversationId: CONV_B,
            kind: "text",
            isSelf: false,
            text: "hey",
            time: "09:02",
          },
        ],
      },
      hasMoreByConv: { [CONV]: true, [CONV_B]: true },
    });

    useMessageStore.getState().clearConversation(CONV);

    const state = useMessageStore.getState();
    expect(state.messagesByConv[CONV]).toEqual([]);
    expect(state.hasMoreByConv[CONV]).toBe(false);
    expect(state.messagesByConv[CONV_B]).toHaveLength(1);
    expect(state.hasMoreByConv[CONV_B]).toBe(true);
  });

  describe("sendSticker", () => {
    it("optimistically inserts a sticker message with sending status", () => {
      useMessageStore.setState({ messagesByConv: {}, hasMoreByConv: {} });
      useMessageStore.getState().sendSticker("c1", {
        id: "s1",
        objectKey: "images/2026/08/a.png",
        width: 96,
        height: 96,
      });
      const msgs = useMessageStore.getState().messagesByConv["c1"];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].kind).toBe("sticker");
      expect(msgs[0].isSelf).toBe(true);
      expect(msgs[0].status).toBe("sending");
      expect(msgs[0].sticker).toEqual({
        stickerId: "s1",
        key: "images/2026/08/a.png",
        width: 96,
        height: 96,
      });
    });

    // 帧格式必须与服务端 buildContent 的 case "sticker" 完全对齐：
    // content 是对象（非 JSON 字符串）、带 type、四字段齐全，否则服务端回 400 且贴纸发不出去。
    it("emits a message.send frame matching the server sticker contract", () => {
      useMessageStore.setState({ messagesByConv: {}, hasMoreByConv: {} });
      useMessageStore.getState().sendSticker("c1", {
        id: "s1",
        objectKey: "images/2026/08/a.png",
        width: 96,
        height: 96,
      });

      const call = vi.mocked(chatSocket.send).mock.calls.find(([tp]) => tp === "message.send");
      expect(call).toBeTruthy();
      const payload = call![1] as {
        conversation_id: string;
        content: Record<string, unknown>;
        client_msg_id: string;
      };
      expect(payload.conversation_id).toBe("c1");
      expect(payload.content).toEqual({
        type: "sticker",
        sticker_id: "s1",
        key: "images/2026/08/a.png",
        width: 96,
        height: 96,
      });
      expect(payload.client_msg_id).toBeTruthy();
    });

    it("marks the sticker failed when no ack arrives before the timeout", () => {
      useMessageStore.setState({ messagesByConv: {}, hasMoreByConv: {} });
      useMessageStore.getState().sendSticker("c1", {
        id: "s1",
        objectKey: "images/2026/08/a.png",
        width: 96,
        height: 96,
      });

      vi.advanceTimersByTime(20_000);

      expect(useMessageStore.getState().messagesByConv["c1"][0].status).toBe("failed");
    });

    // 贴纸没有本地 blob 可重传，重试就是按原 client_msg_id 重发同一帧；
    // 若 retrySend 漏了 sticker 分支，会落到文本路径被 `if (!msg.text) return` 静默吞掉。
    it("retrySend re-emits the same sticker frame with the original client_msg_id", () => {
      useMessageStore.setState({ messagesByConv: {}, hasMoreByConv: {} });
      useMessageStore.getState().sendSticker("c1", {
        id: "s1",
        objectKey: "images/2026/08/a.png",
        width: 96,
        height: 96,
      });
      vi.advanceTimersByTime(20_000);
      const msg = useMessageStore.getState().messagesByConv["c1"][0];
      expect(msg.status).toBe("failed");
      vi.mocked(chatSocket.send).mockClear();

      useMessageStore.getState().retrySend("c1", msg.id);

      expect(useMessageStore.getState().messagesByConv["c1"][0].status).toBe("sending");
      const call = vi.mocked(chatSocket.send).mock.calls.find(([tp]) => tp === "message.send");
      expect(call).toBeTruthy();
      const payload = call![1] as { content: Record<string, unknown>; client_msg_id: string };
      expect(payload.content).toEqual({
        type: "sticker",
        sticker_id: "s1",
        key: "images/2026/08/a.png",
        width: 96,
        height: 96,
      });
      expect(payload.client_msg_id).toBe(msg.clientMsgId);
    });
  });
});
