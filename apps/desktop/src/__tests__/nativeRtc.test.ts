/**
 * nativeRtc 垫片的契约测试。
 *
 * 钉的是**垫片与 `PeerMesh` 之间的契约**，而不是 GStreamer 本身：后者要真设备与
 * 真对端，属于实测范畴。这里保证的是「`PeerMesh` 按标准 API 怎么调，垫片都不会
 * 在半路抛错或给回错形状」—— 一旦这层错了，表现是通话永远停在「连接中…」，
 * 而那在真机上极难定位。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** invoke 的调用记录：断言「发给 Rust 的是什么」 */
const invoked: Array<{ cmd: string; args: Record<string, unknown> }> = [];
/** 每个命令的返回值，按命令名覆盖 */
const returns: Record<string, unknown> = {};
/** listen 注册的回调，用来模拟 Rust 侧推事件 */
let emit: ((payload: unknown) => void) | null = null;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    invoked.push({ cmd, args });
    return returns[cmd];
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, handler: (e: { payload: unknown }) => void) => {
    emit = (payload) => handler({ payload });
    return () => {};
  }),
}));

const { NativeRTCPeerConnection, installNativeRtc, nativeVideoUrl } = await import("../nativeRtc");

/** 等垫片内部的建连 promise 落地（构造函数里的 invoke 是异步的） */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  invoked.length = 0;
  for (const k of Object.keys(returns)) delete returns[k];
  // 刻意**不**清 emit：垫片内部用模块级标志保证只订阅一次事件，
  // 清掉这里的引用只会让后续用例拿不到推送入口（而不是复现真实行为）
});

describe("与 PeerMesh 的调用序列", () => {
  it("主叫路径：createOffer 后 setLocalDescription 不得再打一次后端", async () => {
    returns["native_rtc_create_offer"] = "v=0\r\no=- 1 2 IN IP4 0.0.0.0\r\n";
    const pc = new NativeRTCPeerConnection({ iceServers: [] });
    await settle();

    const offer = await pc.createOffer();
    // local description 已在 Rust 侧随 create 一并设好，这里必须是空转 ——
    // 再设一次会让 webrtcbin 二次协商，对端听到的是一次断流
    await pc.setLocalDescription(offer);

    expect(offer.type).toBe("offer");
    expect(offer.sdp).toContain("v=0");
    const cmds = invoked.map((c) => c.cmd);
    expect(cmds.filter((c) => c === "native_rtc_create_offer")).toHaveLength(1);
    expect(cmds).not.toContain("native_rtc_set_local");
  });

  it("被叫路径：setRemoteDescription 之后 remoteDescription 必须同步可读", async () => {
    returns["native_rtc_create_answer"] = "v=0\r\na=recvonly\r\n";
    const pc = new NativeRTCPeerConnection({ iceServers: [] });
    await settle();

    // PeerMesh 靠 pc.remoteDescription 是否为空决定候选「入队」还是「直投」，
    // await 之后还读到 null 的话，所有候选都会被误判成需要入队而永不补投
    expect(pc.remoteDescription).toBeNull();
    await pc.setRemoteDescription({ type: "offer", sdp: "v=0\r\n" });
    expect(pc.remoteDescription).not.toBeNull();

    const answer = await pc.createAnswer();
    expect(answer.type).toBe("answer");
  });

  it("null 候选（收集结束标记）不发给后端", async () => {
    const pc = new NativeRTCPeerConnection({ iceServers: [] });
    await settle();
    await pc.addIceCandidate({ candidate: "", sdpMLineIndex: 0 });
    expect(invoked.map((c) => c.cmd)).not.toContain("native_rtc_add_candidate");
  });

  it("候选缺 sdpMLineIndex 时补 0 而不是发 undefined", async () => {
    const pc = new NativeRTCPeerConnection({ iceServers: [] });
    await settle();
    await pc.addIceCandidate({ candidate: "candidate:1 1 UDP 1 1.2.3.4 1 typ host" });
    const call = invoked.filter((c) => c.cmd === "native_rtc_add_candidate")[0];
    // undefined 过 IPC 会被 Rust 侧按缺参数拒掉，那条候选就此丢失
    expect(call.args.sdpMlineIndex).toBe(0);
  });
});

describe("ICE 配置转换", () => {
  it("urls 是字符串时也要收成数组", async () => {
    new NativeRTCPeerConnection({
      iceServers: [
        { urls: "stun:a:3478" },
        { urls: ["turn:b:3478"], username: "u", credential: "p" },
      ],
    });
    await settle();
    const create = invoked.filter((c) => c.cmd === "native_rtc_create")[0];
    const servers = create.args.iceServers as Array<{ urls: string[] }>;
    expect(servers[0].urls).toEqual(["stun:a:3478"]);
    expect(servers[1].urls).toEqual(["turn:b:3478"]);
  });
});

describe("事件分发", () => {
  it("候选事件给出的对象必须能 toJSON（PeerMesh 只用这个）", async () => {
    const pc = new NativeRTCPeerConnection({ iceServers: [] });
    await settle();
    const seen: RTCIceCandidateInit[] = [];
    pc.onicecandidate = (e) => {
      const c = e.candidate as unknown as { toJSON(): RTCIceCandidateInit };
      if (c) seen.push(c.toJSON());
    };
    const peerId = (
      invoked.filter((c) => c.cmd === "native_rtc_create")[0].args as { peerId: string }
    ).peerId;
    emit!({ peer_id: peerId, kind: "candidate", candidate: "cand-1", sdp_mline_index: 0 });
    expect(seen).toEqual([{ candidate: "cand-1", sdpMLineIndex: 0, sdpMid: null }]);
  });

  it("识别不了的连接状态退回 connecting，绝不能报 failed", async () => {
    const pc = new NativeRTCPeerConnection({ iceServers: [] });
    await settle();
    const peerId = (
      invoked.filter((c) => c.cmd === "native_rtc_create")[0].args as { peerId: string }
    ).peerId;

    // PeerMesh 收到 failed 会当场拆连接。GStreamer 各版本的枚举序列化格式不同，
    // 认不出来时误判成 failed 等于把一条正在建立的连接掐死
    emit!({ peer_id: peerId, kind: "state", state: "some-unknown-enum-repr" });
    expect(pc.connectionState).toBe("connecting");

    emit!({ peer_id: peerId, kind: "state", state: "GST_WEBRTC_PEER_CONNECTION_STATE_CONNECTED" });
    expect(pc.connectionState).toBe("connected");

    emit!({ peer_id: peerId, kind: "state", state: "failed" });
    expect(pc.connectionState).toBe("failed");
  });

  it("close 之后不再分发事件", async () => {
    const pc = new NativeRTCPeerConnection({ iceServers: [] });
    await settle();
    const peerId = (
      invoked.filter((c) => c.cmd === "native_rtc_create")[0].args as { peerId: string }
    ).peerId;
    let hits = 0;
    pc.onconnectionstatechange = () => {
      hits++;
    };
    pc.close();
    emit!({ peer_id: peerId, kind: "state", state: "connected" });
    // 挂断后仍改 phase 会让刚复位的界面又跳回通话中
    expect(hits).toBe(0);
    expect(pc.connectionState).toBe("closed");
  });
});

describe("视频", () => {
  it("建连时必须带上本次通话的媒体类型", async () => {
    // Rust 侧据此决定开不开摄像头分支，而摄像头分支必须在 SDP 协商前就位 ——
    // 漏传的话视频通话会以纯语音接通，且双方都没有任何报错
    NativeRTCPeerConnection.setCallMedia("video");
    new NativeRTCPeerConnection({ iceServers: [] });
    await settle();
    const create = invoked.filter((c) => c.cmd === "native_rtc_create")[0];
    expect((create.args as { media: string }).media).toBe("video");

    NativeRTCPeerConnection.setCallMedia("audio");
    invoked.length = 0;
    new NativeRTCPeerConnection({ iceServers: [] });
    await settle();
    const second = invoked.filter((c) => c.cmd === "native_rtc_create")[0];
    expect((second.args as { media: string }).media).toBe("audio");
  });

  it("track 事件把流登记成「该拉哪一路画面」", async () => {
    const w = globalThis as unknown as Record<string, unknown>;
    const saved = w.RTCPeerConnection;
    const savedStream = w.MediaStream;
    delete w.RTCPeerConnection;
    w.__TAURI_INTERNALS__ = {};
    // jsdom 没有 MediaStream，而垫片正是靠它的 id 建立「流 → 对端」索引。
    // 真实的 WebKitGTK 有这个构造器（已实测），故这里补一个等价物而不是改垫片
    let streamSeq = 0;
    w.MediaStream = class {
      id = "fake-stream-" + String(++streamSeq);
    };
    returns["native_rtc_available"] = true;
    returns["native_rtc_video_available"] = true;
    returns["native_rtc_video_url"] = "http://127.0.0.1:4321/tok";
    await installNativeRtc();

    const pc = new NativeRTCPeerConnection({ iceServers: [] });
    await settle();
    const peerId = (
      invoked.filter((c) => c.cmd === "native_rtc_create").pop()!.args as {
        peerId: string;
      }
    ).peerId;

    let streamId = "";
    pc.ontrack = (e) => {
      streamId = e.streams[0].id;
    };
    emit!({ peer_id: peerId, kind: "track" });

    // 画面地址必须按 stream.id 反查得到：CallView 手上只有 MediaStream，
    // 查不到就只能显示头像，表现为「接通了但对方一直没画面」
    expect(nativeVideoUrl(streamId)).toBe("http://127.0.0.1:4321/tok/" + peerId);
    expect(nativeVideoUrl("self")).toBe("http://127.0.0.1:4321/tok/self");
    expect(nativeVideoUrl("不存在的流")).toBeNull();

    delete w.__TAURI_INTERNALS__;
    w.RTCPeerConnection = saved;
    w.MediaStream = savedStream;
  });
});

describe("installNativeRtc", () => {
  it("已有原生 WebRTC 时不安装垫片", async () => {
    const w = globalThis as unknown as Record<string, unknown>;
    const saved = w.RTCPeerConnection;
    w.RTCPeerConnection = function () {} as unknown;
    // Windows 的 WebView2 / macOS 的 WKWebView 自带完整 WebRTC，
    // 用只支持语音的垫片顶掉它们是明确的功能倒退
    await expect(installNativeRtc()).resolves.toBe(false);
    w.RTCPeerConnection = saved;
  });

  it("非 Tauri 环境（浏览器里跑桌面 SPA）不安装", async () => {
    const w = globalThis as unknown as Record<string, unknown>;
    const saved = w.RTCPeerConnection;
    delete w.RTCPeerConnection;
    await expect(installNativeRtc()).resolves.toBe(false);
    w.RTCPeerConnection = saved;
  });

  it("后端报不可用时不安装（缺 gstreamer 插件的机器）", async () => {
    const w = globalThis as unknown as Record<string, unknown>;
    const saved = w.RTCPeerConnection;
    delete w.RTCPeerConnection;
    w.__TAURI_INTERNALS__ = {};
    returns["native_rtc_available"] = false;
    // 装了垫片却建不出连接，比没有通话入口更糟：对方会响铃然后等到超时
    await expect(installNativeRtc()).resolves.toBe(false);
    expect(w.RTCPeerConnection).toBeUndefined();
    delete w.__TAURI_INTERNALS__;
    w.RTCPeerConnection = saved;
  });

  it("Linux 且后端可用时装上垫片", async () => {
    const w = globalThis as unknown as Record<string, unknown>;
    const saved = w.RTCPeerConnection;
    delete w.RTCPeerConnection;
    w.__TAURI_INTERNALS__ = {};
    returns["native_rtc_available"] = true;
    await expect(installNativeRtc()).resolves.toBe(true);
    expect(w.RTCPeerConnection).toBe(NativeRTCPeerConnection);
    delete w.__TAURI_INTERNALS__;
    w.RTCPeerConnection = saved;
  });
});
