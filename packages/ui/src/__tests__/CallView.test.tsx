/**
 * CallView 组件测试
 *
 * 测试范围：来电/呼出/通话中三态的按钮集合、最小化与挂断的区别、
 * 语音通话不出现摄像头相关按钮、安卓返回键的两层语义。
 *
 * jsdom 没有 `RTCPeerConnection` / `AudioContext` / `navigator.mediaDevices`，
 * 三者全部打桩；`fetchIceServers` 也桩掉（否则每次挂载都会真的发请求）。
 * setup.ts 已把语言钉成 en-US，故文案断言写英文。
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { runBackInterceptors, useCallStore, chatSocket } from "@yuanchat/shared";
import type { CallParticipant } from "@yuanchat/shared";
import { CallView } from "../call/CallView";

const sent: Array<{ type: string; payload: unknown }> = [];

vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return {
    ...mod,
    // 真实实现会打 /calls/ice-servers；这里给一份空列表，PeerMesh 照样能建
    fetchIceServers: async () => [],
  };
});

/** jsdom 缺的三个 Web API 的最小桩 */
class FakePC {
  addTrack = vi.fn();
  getSenders = vi.fn(() => []);
  createOffer = vi.fn(async () => ({ type: "offer", sdp: "o" }));
  createAnswer = vi.fn(async () => ({ type: "answer", sdp: "a" }));
  setLocalDescription = vi.fn(async () => {});
  setRemoteDescription = vi.fn(async () => {});
  addIceCandidate = vi.fn(async () => {});
  close = vi.fn();
  onicecandidate: unknown = null;
  ontrack: unknown = null;
  onconnectionstatechange: unknown = null;
  remoteDescription: unknown = null;
  connectionState = "new";
}

class FakeAudioCtx {
  state = "running";
  currentTime = 0;
  destination = {};
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  createOscillator = () => ({
    type: "",
    frequency: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
  });
  createGain = () => ({
    gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  });
}

const fakeTrack = { kind: "audio", enabled: true, stop: vi.fn() };
const fakeStream = {
  getTracks: () => [fakeTrack],
  getAudioTracks: () => [fakeTrack],
  getVideoTracks: () => [],
};
const getUserMedia = vi.fn(async () => fakeStream as unknown as MediaStream);

const P = (conn: string, nickname: string): CallParticipant => ({
  user_id: "u-" + conn,
  conn_id: conn,
  nickname,
  avatar_url: null,
  state: "joined",
});

describe("CallView", () => {
  beforeEach(() => {
    sent.length = 0;
    getUserMedia.mockClear();
    (globalThis as unknown as Record<string, unknown>).RTCPeerConnection = FakePC;
    (globalThis as unknown as Record<string, unknown>).AudioContext = FakeAudioCtx;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    vi.spyOn(chatSocket, "send").mockImplementation((type, payload) => {
      sent.push({ type: String(type), payload });
    });
    useCallStore.getState().reset();
  });

  it("来电态显示主叫昵称与接听/拒绝两个按钮", () => {
    act(() => {
      useCallStore.getState().applyIncoming({
        call_id: "c1",
        conversation_id: "v1",
        media: "audio",
        caller: { id: "a", nickname: "Alice", avatar_url: null, short_id: 1 },
        participants: [P("ca", "Alice")],
      });
    });
    render(<CallView />);

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Incoming voice call")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
    // 来电态没有挂断/静音 —— 这些只在已接通后有意义
    expect(screen.queryByRole("button", { name: "Hang up" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mute" })).toBeNull();
  });

  it("点拒绝发出 call.answer{accept:false} 并立即复位", () => {
    act(() => {
      useCallStore.getState().applyIncoming({
        call_id: "c1",
        conversation_id: "v1",
        media: "audio",
        caller: { id: "a", nickname: "Alice", avatar_url: null, short_id: 1 },
        participants: [P("ca", "Alice")],
      });
    });
    render(<CallView />);

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("call.answer");
    expect(sent[0].payload).toEqual({ call_id: "c1", accept: false });
    // 不等 call.ended 帧：本端立即出画，否则拒接后界面还挂着像是没挂掉
    expect(useCallStore.getState().phase).toBe("idle");
  });

  it("通话中点最小化只改 minimized，不挂断", () => {
    act(() => {
      useCallStore.getState().startOutgoing("v1", "audio", []);
      useCallStore.getState().applyState({
        call_id: "c1",
        conversation_id: "v1",
        media: "audio",
        state: "active",
        self_conn: "cb",
        participants: [P("ca", "Alice"), P("cb", "Me")],
      });
    });
    render(<CallView />);

    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));

    expect(useCallStore.getState().minimized).toBe(true);
    expect(useCallStore.getState().phase).toBe("active");
    // 没有发出任何帧 —— 最小化是纯本端的 UI 动作
    expect(sent.filter((f) => f.type === "call.leave")).toHaveLength(0);
    // 最小化后只剩一条「返回通话」悬浮条
    expect(screen.getByRole("button", { name: "Back to call" })).toBeInTheDocument();
  });

  it("挂断发出 call.leave 并复位", () => {
    act(() => {
      useCallStore.getState().startOutgoing("v1", "audio", []);
      useCallStore.getState().applyState({
        call_id: "c1",
        conversation_id: "v1",
        media: "audio",
        state: "active",
        self_conn: "cb",
        participants: [P("ca", "Alice"), P("cb", "Me")],
      });
    });
    render(<CallView />);

    fireEvent.click(screen.getByRole("button", { name: "Hang up" }));

    expect(sent.filter((f) => f.type === "call.leave")).toHaveLength(1);
    expect(useCallStore.getState().phase).toBe("idle");
  });

  it("语音通话不显示摄像头按钮", () => {
    act(() => {
      useCallStore.getState().startOutgoing("v1", "audio", []);
      useCallStore.getState().applyState({
        call_id: "c1",
        conversation_id: "v1",
        media: "audio",
        state: "active",
        self_conn: "cb",
        participants: [P("ca", "Alice"), P("cb", "Me")],
      });
    });
    render(<CallView />);

    // en-US 下三个摄像头相关标签都含 "camera"：开/关/切换一个都不该出现
    expect(screen.queryByRole("button", { name: /camera/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Mute" })).toBeInTheDocument();
  });

  it("视频通话显示摄像头开关", () => {
    act(() => {
      useCallStore.getState().startOutgoing("v1", "video", []);
      useCallStore.getState().applyState({
        call_id: "c1",
        conversation_id: "v1",
        media: "video",
        state: "active",
        self_conn: "cb",
        participants: [P("ca", "Alice"), P("cb", "Me")],
      });
    });
    render(<CallView />);

    expect(screen.getByRole("button", { name: "Turn camera off" })).toBeInTheDocument();
  });

  it("安卓返回键在来电态等于拒接，在通话态等于最小化", () => {
    act(() => {
      useCallStore.getState().applyIncoming({
        call_id: "c1",
        conversation_id: "v1",
        media: "audio",
        caller: { id: "a", nickname: "Alice", avatar_url: null, short_id: 1 },
        participants: [P("ca", "Alice")],
      });
    });
    const incoming = render(<CallView />);

    let handled = false;
    act(() => {
      handled = runBackInterceptors();
    });
    expect(handled).toBe(true);
    expect(useCallStore.getState().phase).toBe("idle");
    expect(sent[0].payload).toEqual({ call_id: "c1", accept: false });
    incoming.unmount();

    // 通话态：同一个返回键必须只最小化，误触返回键就断线是最恼人的失误
    sent.length = 0;
    act(() => {
      useCallStore.getState().startOutgoing("v1", "audio", []);
      useCallStore.getState().applyState({
        call_id: "c2",
        conversation_id: "v1",
        media: "audio",
        state: "active",
        self_conn: "cb",
        participants: [P("ca", "Alice"), P("cb", "Me")],
      });
    });
    render(<CallView />);

    act(() => {
      handled = runBackInterceptors();
    });
    expect(handled).toBe(true);
    expect(useCallStore.getState().minimized).toBe(true);
    expect(useCallStore.getState().phase).toBe("active");
    expect(sent.filter((f) => f.type === "call.leave")).toHaveLength(0);
  });

  it("呼出态显示「正在呼叫…」与取消（挂断）键，没有接听键", () => {
    act(() => {
      useCallStore.getState().startOutgoing("v1", "audio", ["u2"]);
    });
    render(<CallView />);

    expect(screen.getByText("Calling…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hang up" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    // 呼出期还没接通，最小化无意义（也没有时长可显示）
    expect(screen.queryByRole("button", { name: "Minimize" })).toBeNull();
  });
});
