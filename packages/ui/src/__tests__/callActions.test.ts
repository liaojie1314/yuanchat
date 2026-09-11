/**
 * callActions 承载器（CallLauncher）与 WebRTC 能力闸门测试
 *
 * 测试范围：
 * 1. 桌面端注册承载器后，四个入口的发起动作必须被**整体**拦下 —— 既不取媒体也不发信令。
 *    这条线错了的症状极难定位：房间建得起来、对方也会响铃，但服务端登记的是主窗口那条
 *    连接，而视频渲染在通话窗口里，双方永远都看不到对方的画面。
 * 2. `RTCPeerConnection` 不存在时一步都不许往下走。采集能力与连接能力在各端的
 *    WebView 上会分别缺失（getUserMedia 能出流而 RTCPeerConnection 整个类不存在
 *    是实测见过的形态）；不拦住的话摄像头亮起、邀请发出、对方响铃，
 *    本端却永远建不出连接。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatSocket, useCallStore } from "@yuanchat/shared";
import { joinCall, setCallLauncher, startCall, type CallLaunchRequest } from "../callActions";

const sent: Array<{ type: string; payload: unknown }> = [];
const getUserMedia = vi.fn(async () => ({ getTracks: () => [] }) as unknown as MediaStream);

/** jsdom 没有 RTCPeerConnection，能力闸门默认会拦死；除非用例明确要测那条分支 */
function stubWebRTC(available: boolean) {
  const g = globalThis as unknown as Record<string, unknown>;
  if (available) g.RTCPeerConnection = function () {} as unknown;
  else delete g.RTCPeerConnection;
}

beforeEach(() => {
  sent.length = 0;
  getUserMedia.mockClear();
  setCallLauncher(null);
  useCallStore.getState().reset();
  stubWebRTC(true);
  vi.spyOn(chatSocket, "send").mockImplementation(((type: string, payload: unknown) => {
    sent.push({ type, payload });
  }) as typeof chatSocket.send);
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  stubWebRTC(false);
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

describe("WebRTC 能力闸门", () => {
  it("没有 RTCPeerConnection 时 startCall 不取媒体、不发邀请", async () => {
    stubWebRTC(false);

    await startCall("conv-1", "audio", []);

    // 摄像头/麦克风不许亮：这台机器根本连不通，白要一次权限
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
    expect(useCallStore.getState().phase).toBe("idle");
  });

  it("没有 RTCPeerConnection 时闸门先于承载器，桌面端不会开出一个连不通的窗口", async () => {
    stubWebRTC(false);
    const launcher = vi.fn(() => true);
    setCallLauncher(launcher);

    await startCall("conv-1", "video", ["u1"]);

    expect(launcher).not.toHaveBeenCalled();
  });

  it("没有 RTCPeerConnection 时 joinCall 同样拦下", async () => {
    stubWebRTC(false);

    await joinCall({ callId: "c-1", conversationId: "conv-1", media: "audio", joinedCount: 1 });

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });
});
