/**
 * WS error 帧分发单元测试
 *
 * 服务端有 21 个 sendError 调用点，此前前端只认 `message === "BLOCKED"` 一个，
 * 其余 20 种（含贴纸两个 400、落库失败 500、文本超 4000 字）全部静默丢弃——
 * 消息停在 sending 直到 5s ack 超时才无理由变 failed。本文件锁死通用分发行为，
 * 防止后续新增服务端校验时又退回"无理由失败"。
 *
 * 断言 toast 走 useToastStore 真实状态而非 spy：showToast 在被测模块里是
 * 静态 import 绑定，vi.spyOn 改不到已绑定的引用。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import i18n from "@yuanchat/design-system/i18n";
import { applyErrorFrame } from "../hooks/useChatBootstrap";
import { useMessageStore, setMessageMockMode } from "../store/messageStore";
import { useToastStore } from "../store/toastStore";
import { chatSocket } from "../ws/chatSocket";

const CONV = "c1";

/** 最近一条 toast 文案 */
function lastToast(): string {
  const list = useToastStore.getState().toasts;
  return list[list.length - 1]?.text ?? "";
}

/**
 * 断言最近一条 toast 用的是指定 i18n key。
 *
 * 不硬编码某语言的字面量（shared 测试环境是 zh-CN、ui 是 en-US），同时校验译文
 * 存在——`t()` 对缺失 key 会原样返回 key 本身，那正是本批次第 1 项 bug 的形态。
 */
function expectToastKey(key: string) {
  const text = lastToast();
  expect(text).not.toBe(key);
  expect(text).toBe(i18n.t(key));
}

describe("applyErrorFrame", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setMessageMockMode(false);
    useMessageStore.setState({ messagesByConv: {}, hasMoreByConv: {}, typingByConv: {} });
    useToastStore.setState({ toasts: [] });
    vi.spyOn(chatSocket, "send").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** 造一条处于 sending 的乐观消息，返回其 clientMsgId */
  function pendingMessage(): string {
    return useMessageStore.getState().sendText(CONV, "hello");
  }

  it("fails the pending message on a non-BLOCKED 400 instead of leaving it sending", () => {
    const clientMsgId = pendingMessage();
    expect(useMessageStore.getState().messagesByConv[CONV][0].status).toBe("sending");

    applyErrorFrame({
      code: 400,
      message: "sticker content requires sticker_id/key/width/height",
      client_msg_id: clientMsgId,
    });

    // 立即 failed，不再等 5s ack 超时兜底
    expect(useMessageStore.getState().messagesByConv[CONV][0].status).toBe("failed");
    expectToastKey("chat.error.invalidFrame");
  });

  it("fails the pending message on a 500 and shows a server-error toast", () => {
    const clientMsgId = pendingMessage();

    applyErrorFrame({ code: 500, message: "send failed", client_msg_id: clientMsgId });

    expect(useMessageStore.getState().messagesByConv[CONV][0].status).toBe("failed");
    expectToastKey("chat.error.serverError");
  });

  it("keeps the dedicated BLOCKED wording", () => {
    const clientMsgId = pendingMessage();

    applyErrorFrame({ code: 403, message: "BLOCKED", client_msg_id: clientMsgId });

    expect(useMessageStore.getState().messagesByConv[CONV][0].status).toBe("failed");
    expectToastKey("chat.message.blockedRejected");
  });

  it("uses a distinct wording for a non-BLOCKED 403", () => {
    applyErrorFrame({ code: 403, message: "forbidden" });

    expectToastKey("chat.error.rejected");
  });

  it("still toasts when the frame carries no client_msg_id", () => {
    // 服务端整帧 unmarshal 失败时 client_msg_id 为空串，此时无消息可翻 failed，
    // 但用户仍必须知道"刚才那个操作被拒了"
    applyErrorFrame({ code: 400, message: "invalid message.send payload" });

    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("never surfaces the raw server message to the user", () => {
    const clientMsgId = pendingMessage();

    applyErrorFrame({
      code: 400,
      message: "text content required (1-4000 chars)",
      client_msg_id: clientMsgId,
    });

    // 服务端文案是英文技术描述，只进 Sentry，不进 toast
    expect(lastToast()).not.toContain("1-4000");
  });
});
