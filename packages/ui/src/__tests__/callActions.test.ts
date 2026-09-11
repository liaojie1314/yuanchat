/**
 * callActions 承载器（CallLauncher）测试
 *
 * 测试范围：桌面端注册承载器后，四个入口的发起动作必须被**整体**拦下 ——
 * 既不取媒体也不发信令。
 *
 * 这条线错了的症状极难定位：房间建得起来、对方也会响铃，但服务端登记的是
 * 主窗口那条连接，而视频渲染在通话窗口里，双方永远都看不到对方的画面。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatSocket, useCallStore } from "@yuanchat/shared";
import { joinCall, setCallLauncher, startCall, type CallLaunchRequest } from "../callActions";

const sent: Array<{ type: string; payload: unknown }> = [];
const getUserMedia = vi.fn(async () => ({ getTracks: () => [] }) as unknown as MediaStream);

beforeEach(() => {
  sent.length = 0;
  getUserMedia.mockClear();
  setCallLauncher(null);
  useCallStore.getState().reset();
  vi.spyOn(chatSocket, "send").mockImplementation(((type: string, payload: unknown) => {
    sent.push({ type, payload });
  }) as typeof chatSocket.send);
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
    writable: true,
  });
});

describe("CallLauncher", () => {
  it("注册后 startCall 只转成一次开窗请求，不取媒体也不发 call.invite", async () => {
    const seen: CallLaunchRequest[] = [];
    setCallLauncher((req) => {
      seen.push(req);
      return true;
    });

    await startCall("conv-1", "video", ["u1", "u2"]);

    expect(seen).toEqual([
      { role: "caller", media: "video", conversationId: "conv-1", inviteeIds: ["u1", "u2"] },
    ]);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
    // 通话态归承载方所有：主窗口这边不得留下半个 outgoing
    expect(useCallStore.getState().phase).toBe("idle");
  });

  it("注册后 joinCall 同样被拦下，且带上横幅的 conversation_id", async () => {
    const seen: CallLaunchRequest[] = [];
    setCallLauncher((req) => {
      seen.push(req);
      return true;
    });

    await joinCall({ callId: "c-9", conversationId: "conv-7", media: "audio", joinedCount: 2 });

    expect(seen).toEqual([
      { role: "joiner", media: "audio", callId: "c-9", conversationId: "conv-7" },
    ]);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("满员在承载器之前就拦住 —— 开了窗才发现进不去等于白要一次麦克风权限", async () => {
    const launcher = vi.fn(() => true);
    setCallLauncher(launcher);

    await joinCall({ callId: "c-9", conversationId: "conv-7", media: "audio", joinedCount: 4 });

    expect(launcher).not.toHaveBeenCalled();
  });

  it("未注册承载器时走本端发起：取媒体后发 call.invite", async () => {
    await startCall("conv-1", "audio", []);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([
      { type: "call.invite", payload: { conversation_id: "conv-1", media: "audio" } },
    ]);
    expect(useCallStore.getState().phase).toBe("outgoing");
  });

  it("撤销承载器后恢复本端发起", async () => {
    setCallLauncher(() => true);
    setCallLauncher(null);

    await startCall("conv-2", "audio", []);

    expect(sent.map((f) => f.type)).toEqual(["call.invite"]);
  });
});
