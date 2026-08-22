/**
 * message.send 帧的黄金契约测试（前端侧）
 *
 * @description
 * 驱动 `messageStore` 的公开发送入口真的发一帧，把 `chatSocket.send` 收到的
 * payload 与 `contracts/message-send.golden.json` 深比较。Go 侧
 * （`server/internal/ws/golden_contract_test.go`）把**同一份 JSON** 反序列化进
 * `ws.SendPayload` 并跑 `buildContent`，因此任一侧改字段名/类型/嵌套层级都会双红。
 *
 * @remarks 此前两端各写一份"同构但独立"的断言（前端断 JS 对象、Go 断 Go 结构体），
 *   从未跑过同一份 JSON——贴纸帧只是碰巧写对了，改字段名照样双绿（审计第 35 项）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setMessageMockMode, setE2EEContext, useMessageStore } from "../store/messageStore";
import { chatSocket } from "../ws/chatSocket";
import * as filesApi from "../api/files";
import * as e2eeManager from "../crypto/e2eeManager";

const GOLDEN_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../contracts/message-send.golden.json",
);

interface GoldenCase {
  name: string;
  expected_message_type: number;
  frame: { type: string; payload: Record<string, unknown> };
}

const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as { cases: GoldenCase[] };

/** 按名字取用例；名字写错立即失败（而不是静默跳过一条契约）。 */
function goldenCase(name: string): GoldenCase {
  const found = golden.cases.find((c) => c.name === name);
  if (!found) throw new Error(`golden case not found: ${name}`);
  return found;
}

const CONV = "11111111-1111-4111-8111-111111111111";
const REPLY_TO = "22222222-2222-4222-8222-222222222222";
const MENTION_ID = "33333333-3333-4333-8333-333333333333";
const STICKER_ID = "44444444-4444-4444-8444-444444444444";

/** 取最近一帧 message.send 的 payload，并把随机 client_msg_id 换成 golden 占位符。 */
function lastSendPayload(): Record<string, unknown> {
  const calls = vi.mocked(chatSocket.send).mock.calls.filter(([t]) => t === "message.send");
  expect(calls.length).toBeGreaterThan(0);
  const payload = { ...(calls[calls.length - 1][1] as Record<string, unknown>) };
  expect(typeof payload.client_msg_id).toBe("string");
  expect(payload.client_msg_id).not.toBe("");
  payload.client_msg_id = "<client_msg_id>";
  return payload;
}

/** 断言最近一帧与指定 golden 用例逐字一致（含帧名）。 */
function expectMatchesGolden(name: string) {
  const c = goldenCase(name);
  expect(c.frame.type).toBe("message.send");
  expect(lastSendPayload()).toEqual(c.frame.payload);
}

beforeEach(() => {
  setMessageMockMode(false);
  useMessageStore.setState({
    messagesByConv: {},
    hasMoreByConv: {},
    typingByConv: {},
    replyingTo: null,
  });
  vi.spyOn(chatSocket, "send").mockImplementation(() => {});
  vi.stubGlobal("URL", { createObjectURL: () => "blob:golden", revokeObjectURL: () => {} });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setE2EEContext(
    () => undefined,
    () => undefined,
  );
});

describe("message.send 黄金契约（前端产出 == contracts/message-send.golden.json）", () => {
  it("text", () => {
    useMessageStore.getState().sendText(CONV, "你好，golden");
    expectMatchesGolden("text");
  });

  it("text_with_reply_and_mentions", () => {
    useMessageStore.getState().sendText(CONV, "@张伟 看下这条", {
      quote: { messageId: REPLY_TO, senderName: "张伟", excerpt: "上一条" },
      mentions: [{ id: MENTION_ID, name: "张伟" }],
    });
    expectMatchesGolden("text_with_reply_and_mentions");
  });

  it("image", async () => {
    // size 取压缩产物的字节数：golden 里写死 7（"jpegbin".length）
    vi.spyOn(filesApi, "compressImage").mockResolvedValue({
      blob: new Blob(["jpegbin"], { type: "image/jpeg" }),
      width: 800,
      height: 600,
    });
    vi.spyOn(filesApi, "getUploadUrl").mockResolvedValue({
      uploadUrl: "https://put",
      objectKey: "images/2026/08/0f5a1c00-0001.jpg",
    });
    vi.spyOn(filesApi, "uploadToTicket").mockResolvedValue(undefined);

    await useMessageStore.getState().sendImage(CONV, new Blob(["src"], { type: "image/jpeg" }));
    expectMatchesGolden("image");
  });

  it("file", async () => {
    vi.spyOn(filesApi, "getUploadUrl").mockResolvedValue({
      uploadUrl: "https://put",
      objectKey: "files/2026/08/0f5a1c00-0002.pdf",
    });
    vi.spyOn(filesApi, "uploadToTicket").mockResolvedValue(undefined);

    const file = new File(["pdfbytes"], "发布评审_v3.pdf", { type: "application/pdf" });
    await useMessageStore.getState().sendFile(CONV, file);
    expectMatchesGolden("file");
  });

  it("voice", async () => {
    vi.spyOn(filesApi, "getUploadUrl").mockResolvedValue({
      uploadUrl: "https://put",
      objectKey: "files/2026/08/0f5a1c00-0003.webm",
    });
    vi.spyOn(filesApi, "uploadToTicket").mockResolvedValue(undefined);

    await useMessageStore
      .getState()
      .sendVoice(CONV, new Blob(["webm!"], { type: "audio/webm" }), 12);
    expectMatchesGolden("voice");
  });

  it("sticker", () => {
    useMessageStore.getState().sendSticker(CONV, {
      id: STICKER_ID,
      objectKey: "images/2026/08/0f5a1c00-0004.png",
      width: 96,
      height: 96,
    });
    expectMatchesGolden("sticker");
  });

  it("e2ee_subsequent", async () => {
    setE2EEContext(
      () => "self-user",
      () => "peer-user",
    );
    vi.spyOn(e2eeManager, "encryptFor").mockResolvedValue({
      type: "e2ee",
      ratchet_key: "cmF0Y2hldC1rZXktYmFzZTY0",
      n: 3,
      pn: 1,
      nonce: "bm9uY2UtYmFzZTY0",
      ciphertext: "Y2lwaGVydGV4dC1iYXNlNjQ=",
    });

    useMessageStore.getState().sendText(CONV, "密文正文不上线");
    await vi.waitFor(() => {
      expect(vi.mocked(chatSocket.send).mock.calls.length).toBeGreaterThan(0);
    });
    expectMatchesGolden("e2ee_subsequent");
  });

  it("e2ee_first_message", async () => {
    setE2EEContext(
      () => "self-user",
      () => "peer-user",
    );
    vi.spyOn(e2eeManager, "encryptFor").mockResolvedValue({
      type: "e2ee",
      ratchet_key: "cmF0Y2hldC1rZXktYmFzZTY0",
      n: 0,
      pn: 0,
      nonce: "bm9uY2UtYmFzZTY0",
      ciphertext: "Y2lwaGVydGV4dC1iYXNlNjQ=",
      identity_key: "aWRlbnRpdHkta2V5LWJhc2U2NA==",
      ephemeral_key: "ZXBoZW1lcmFsLWtleS1iYXNlNjQ=",
      otk_id: 7,
    });

    useMessageStore.getState().sendText(CONV, "首条密文");
    await vi.waitFor(() => {
      expect(vi.mocked(chatSocket.send).mock.calls.length).toBeGreaterThan(0);
    });
    expectMatchesGolden("e2ee_first_message");
  });

  it("golden 文件里的每个用例都被本文件覆盖到", () => {
    // 防止有人往 golden 里加了用例却没加前端断言（Go 侧是遍历式的，天然全覆盖）
    const covered = [
      "text",
      "text_with_reply_and_mentions",
      "image",
      "file",
      "voice",
      "sticker",
      "e2ee_subsequent",
      "e2ee_first_message",
    ];
    expect(golden.cases.map((c) => c.name).sort()).toEqual(covered.slice().sort());
  });
});
