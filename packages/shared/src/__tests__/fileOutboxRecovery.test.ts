/** 附件出站恢复回归：覆盖 MIME、上传前草稿、冷启动重试及 ACK 清理。 */
import "fake-indexeddb/auto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import * as filesApi from "../api/files";
import { setFileSink, __resetFileSink } from "../download/fileSink";
import { closeLocalStore, initLocalStore, listOutbox, localDb, purgeLocalStore } from "../localdb";
import { setMessageMockMode, useMessageStore } from "../store/messageStore";
import { enqueueSend, flushOutbox, restoreOutbox } from "../store/outboxSync";
import { chatSocket } from "../ws/chatSocket";

const USER = "file-outbox-recovery-test";
const CONV = "file-outbox-conversation";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let disk: Map<string, Uint8Array>;

beforeEach(async () => {
  await initLocalStore(USER);
  setMessageMockMode(false);
  useMessageStore.setState({ messagesByConv: {} });
  disk = new Map();
  setFileSink({
    save: async (bytes, name) => {
      disk.set(name, bytes);
      return name;
    },
    read: async (name) => {
      const bytes = disk.get(name);
      if (!bytes) throw new Error("ENOENT");
      return bytes;
    },
    remove: async (name) => {
      disk.delete(name);
    },
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:expired-file-outbox");
  vi.spyOn(filesApi, "getUploadUrl").mockRejectedValue(new Error("offline"));
  vi.spyOn(filesApi, "uploadToTicket").mockResolvedValue(undefined);
  vi.spyOn(filesApi, "compressImage").mockResolvedValue({
    blob: new Blob([PNG], { type: "image/png" }),
    width: 1,
    height: 1,
  });
  vi.spyOn(chatSocket, "send").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("blob URL expired")));
});

afterEach(async () => {
  __resetFileSink();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useMessageStore.setState({ messagesByConv: {} });
  await purgeLocalStore();
});

it.each(["image/png", "application/pdf"])("blob 失效后文件重试保留原始 MIME %s", async (mime) => {
  const file = new File([PNG], "attachment.png", { type: mime });
  await useMessageStore.getState().sendFile(CONV, file);
  const message = useMessageStore.getState().messagesByConv[CONV][0];
  expect(message.status).toBe("failed");
  expect(disk.size).toBe(1);

  useMessageStore.getState().retrySend(CONV, message.id);
  await vi.waitFor(() => expect(filesApi.getUploadUrl).toHaveBeenCalledTimes(2));
  expect(vi.mocked(filesApi.getUploadUrl).mock.calls.map(([, mime]) => mime)).toEqual([mime, mime]);
});

it.each([
  ["file", "image/png"],
  ["image", "image/png"],
  ["voice", "audio/webm"],
] as const)("%s 上传前失败后可冷启动重试，ACK 清理记录和磁盘副本", async (kind, mime) => {
  const file = new File([PNG], "attachment.png", { type: mime });
  const store = useMessageStore.getState();
  if (kind === "file") await store.sendFile(CONV, file);
  else if (kind === "image") await store.sendImage(CONV, file);
  else await store.sendVoice(CONV, file, 1);
  const message = useMessageStore.getState().messagesByConv[CONV][0];
  expect(message.status).toBe("failed");
  expect(disk.size).toBe(1);

  // 清内存并重开同一账号数据库，不能把仍存活的乐观消息冒充冷启动恢复。
  closeLocalStore();
  useMessageStore.setState({ messagesByConv: {} });
  await initLocalStore(USER);
  const restored = await restoreOutbox();
  expect(restored).toContainEqual(
    expect.objectContaining({
      clientMsgId: message.clientMsgId,
      conversationId: CONV,
      kind,
      status: "failed",
    }),
  );
  expect(restored[0].file?.localUrl).toBeUndefined();
  expect(restored[0].image?.localUrl).toBeUndefined();
  expect(restored[0].voice?.localUrl).toBeUndefined();
  useMessageStore.getState().receiveMessage(restored[0]);
  vi.mocked(filesApi.getUploadUrl).mockResolvedValue({
    uploadUrl: "https://upload.invalid",
    objectKey: "uploads/recovered",
  });
  useMessageStore.getState().retrySend(CONV, message.id);
  await vi.waitFor(() =>
    expect(chatSocket.send).toHaveBeenCalledWith(
      "message.send",
      expect.objectContaining({
        content: expect.objectContaining({ type: kind, key: "uploads/recovered" }),
      }),
    ),
  );
  expect(vi.mocked(filesApi.getUploadUrl).mock.calls[1][1]).toBe(mime);
  expect(vi.mocked(filesApi.uploadToTicket).mock.calls[0][1].type).toBe(mime);

  // 上传完成、ACK 尚未到达时再重启，也要恢复气泡以处理 ACK 清理。
  await listOutbox(localDb()!);
  closeLocalStore();
  useMessageStore.setState({ messagesByConv: {} });
  await initLocalStore(USER);
  const uploaded = await restoreOutbox();
  expect(uploaded).toHaveLength(1);
  useMessageStore.getState().receiveMessage(uploaded[0]);
  const resend = vi.fn(() => true);
  await flushOutbox(resend);
  expect(resend).toHaveBeenCalledWith(
    expect.objectContaining({
      content: expect.objectContaining({ type: kind, key: "uploads/recovered" }),
    }),
  );
  useMessageStore
    .getState()
    .applyAck(message.clientMsgId!, "server-recovered", CONV, 1, Date.now());
  await vi.waitFor(async () => {
    expect(await listOutbox(localDb()!)).toEqual([]);
    expect(disk.size).toBe(0);
  });
  expect(useMessageStore.getState().messagesByConv[CONV][0].status).toBe("sent");
});

it("自动补发跳过未上传草稿，仍发送旧文本和已上传附件载荷", async () => {
  await useMessageStore
    .getState()
    .sendFile(CONV, new File([PNG], "pending.png", { type: "image/png" }));
  const text = {
    client_msg_id: "old-text",
    conversation_id: CONV,
    content: { type: "text", text: "old" },
  };
  const uploaded = {
    client_msg_id: "old-file",
    conversation_id: CONV,
    content: { type: "file", key: "files/old.png", name: "old.png", size: 8 },
  };
  enqueueSend(CONV, "old-text", text);
  enqueueSend(CONV, "old-file", uploaded);
  expect(await listOutbox(localDb()!)).toHaveLength(3);
  const send = vi.fn(() => true);
  await flushOutbox(send);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenCalledWith(text);
  expect(send).toHaveBeenCalledWith(uploaded);
});

it("Web appdata 保存返回 null 时不留下无法恢复的上传草稿", async () => {
  setFileSink({
    save: async () => null,
    read: async () => {
      throw new Error("no appdata");
    },
  });
  await useMessageStore
    .getState()
    .sendFile(CONV, new File([PNG], "web.png", { type: "image/png" }));
  expect(await listOutbox(localDb()!)).toEqual([]);
});

it("副本丢失时重试仍失败并保留草稿，不发上传请求或空帧", async () => {
  await useMessageStore
    .getState()
    .sendFile(CONV, new File([PNG], "lost.png", { type: "image/png" }));
  const [draft] = await restoreOutbox();
  useMessageStore.setState({ messagesByConv: { [CONV]: [draft] } });
  disk.clear();
  useMessageStore.getState().retrySend(CONV, draft.id);
  await vi.waitFor(() =>
    expect(useMessageStore.getState().messagesByConv[CONV][0].status).toBe("failed"),
  );
  expect(filesApi.getUploadUrl).toHaveBeenCalledTimes(1);
  expect(chatSocket.send).not.toHaveBeenCalled();
  expect(await listOutbox(localDb()!)).toHaveLength(1);
});

it("换账号期间迟到的写盘不能把上传草稿写进新账号", async () => {
  let entered!: () => void;
  let finish!: () => void;
  const writing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  setFileSink({
    save: async (bytes, name) => {
      entered();
      await finished;
      disk.set(name, bytes);
      return name;
    },
    read: async () => PNG,
  });
  const sending = useMessageStore
    .getState()
    .sendFile(CONV, new File([PNG], "late.png", { type: "image/png" }));
  await writing;
  await initLocalStore("other-file-outbox-user");
  finish();
  await sending;
  expect(await listOutbox(localDb()!)).toEqual([]);
  await purgeLocalStore();
  await initLocalStore(USER);
  expect(await restoreOutbox()).toEqual([]);
});
