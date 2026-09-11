/**
 * callFrameHandlers 单测 — 通话帧的接线层
 *
 * @description
 * 这一层只有两处逻辑（其余都是转交给 callStore），且两处都只在真机上暴露：
 *
 * 1. **来电能力闸门**：本端建不出 `RTCPeerConnection` 时当场回绝。四端的 WebView
 *    各自决定 WebRTC 支持度，且采集与连接会分别缺失 —— `getUserMedia` 照常出流
 *    而 `RTCPeerConnection` 整个类不存在是实测见过的形态；
 *    不回绝的话主叫要干等 60s 振铃超时。
 * 2. **busy 提示归属判定**：`applyEnded` 会清掉 `callId`，故必须在 apply **之前**
 *    判断这一帧是不是自己这一路的。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { callFrameHandlers } from "../hooks/useCallSocket";
import { useCallStore } from "../store/callStore";
import { chatSocket } from "../ws/chatSocket";

const sent: Array<{ type: string; payload: unknown }> = [];

/**
 * 摆出 / 撤掉 `window.RTCPeerConnection`。
 *
 * 本包的 vitest environment 是 node（没有 window），而闸门判的正是
 * `window.RTCPeerConnection` —— 故两个方向都要显式造出来：
 * 「可用」= window 存在且该属性是函数，「不可用」= window 存在但属性缺失
 * （后者才是「WebView 有窗口对象但没有 WebRTC」的真实形态；
 *   window 整个不存在是 SSR，不是本用例的场景）。
 */
function stubWebRTC(available: boolean) {
  const g = globalThis as unknown as { window?: Record<string, unknown> };
  if (!g.window) g.window = {};
  if (available) g.window.RTCPeerConnection = function () {};
  else delete g.window.RTCPeerConnection;
}

const INCOMING = {
  call_id: "c1",
  conversation_id: "v1",
  media: "audio" as const,
  caller: { id: "u-caller", nickname: "主叫", avatar_url: null, short_id: 1 },
  participants: [],
};

beforeEach(() => {
  sent.length = 0;
  useCallStore.getState().reset();
  stubWebRTC(true);
  vi.spyOn(chatSocket, "send").mockImplementation(((type: string, payload: unknown) => {
    sent.push({ type, payload });
  }) as typeof chatSocket.send);
});

describe("callFrameHandlers 来电能力闸门", () => {
  it("能建 PeerConnection 时正常进入振铃态", () => {
    callFrameHandlers["call.incoming"]?.(INCOMING as never);

    expect(useCallStore.getState().phase).toBe("incoming");
    expect(sent).toHaveLength(0);
  });

  it("建不出 PeerConnection 时当场回绝，不摆出接不通的来电界面", () => {
    stubWebRTC(false);

    callFrameHandlers["call.incoming"]?.(INCOMING as never);

    // 主叫立刻拿到 rejected，而不是干等 60s 振铃超时
    expect(sent).toEqual([{ type: "call.answer", payload: { call_id: "c1", accept: false } }]);
    expect(useCallStore.getState().phase).toBe("idle");
  });
});
