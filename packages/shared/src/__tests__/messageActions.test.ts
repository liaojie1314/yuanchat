/**
 * isServerConfirmed —「需要服务端 id 的操作」资格判定
 *
 * @description
 * 这个断言此前在 ChatWindow 里被手抄了 5 遍，`onReply` 漏抄导致乐观消息可被引用 →
 * 整帧 400 且 error 帧无 client_msg_id。抽成函数后由本测试锁住三条边界：
 * 未 ack（无 seq）、已撤回、系统消息。
 */
import { describe, expect, it } from "vitest";
import { isServerConfirmed } from "../utils/messageActions";

describe("isServerConfirmed", () => {
  it("已 ack 的普通消息可参与操作", () => {
    expect(isServerConfirmed({ seq: 1, kind: "text" })).toBe(true);
    expect(isServerConfirmed({ seq: 42, kind: "sticker" })).toBe(true);
    expect(isServerConfirmed({ seq: 42, kind: "image" })).toBe(true);
  });

  it("未 ack 的乐观消息不可参与（id 还是 clientMsgId）", () => {
    expect(isServerConfirmed({ kind: "text" })).toBe(false);
    expect(isServerConfirmed({ seq: undefined, kind: "text" })).toBe(false);
  });

  it("seq 为 0 视为未确认（服务端 seq 从 1 起）", () => {
    expect(isServerConfirmed({ seq: 0, kind: "text" })).toBe(false);
  });

  it("已撤回消息不可参与", () => {
    expect(isServerConfirmed({ seq: 1, kind: "text", recalled: true })).toBe(false);
  });

  it("系统消息不可参与", () => {
    expect(isServerConfirmed({ seq: 1, kind: "system" })).toBe(false);
  });

  it("recalled 显式 false 不影响判定", () => {
    expect(isServerConfirmed({ seq: 1, kind: "text", recalled: false })).toBe(true);
  });
});
