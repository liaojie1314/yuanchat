/**
 * PeerMesh 单测
 *
 * @description
 * 验的是「谁先发 offer」「候选先到时是否入队」「syncPeers 是否幂等」三件事 ——
 * 都是 mesh 通话打不通时最难排查、又最容易写错的地方。浏览器 WebRTC 实现本身不在射程内。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PeerMesh, callSignalSink } from "../webrtc/peerMesh";

// jsdom 没有 RTCPeerConnection，用最小桩顶上
class FakePC {
  static instances: FakePC[] = [];
  localDescription: unknown = null;
  remoteDescription: unknown = null;
  pending: unknown[] = [];
  onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
  ontrack: ((e: { streams: MediaStream[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  connectionState = "new";
  constructor() {
    FakePC.instances.push(this);
  }
  addTrack = vi.fn();
  getSenders = vi.fn(() => []);
  createOffer = vi.fn(async () => ({ type: "offer", sdp: "o" }));
  createAnswer = vi.fn(async () => ({ type: "answer", sdp: "a" }));
  setLocalDescription = vi.fn(async (d: unknown) => {
    this.localDescription = d;
  });
  setRemoteDescription = vi.fn(async (d: unknown) => {
    this.remoteDescription = d;
  });
  addIceCandidate = vi.fn(async (c: unknown) => {
    this.pending.push(c);
  });
  close = vi.fn();
}

describe("PeerMesh", () => {
  beforeEach(() => {
    FakePC.instances = [];
    (globalThis as unknown as Record<string, unknown>).RTCPeerConnection = FakePC;
  });

  it("conn_id 字典序小的一方发 offer，大的一方等待", async () => {
    const sent: Array<[string, { type: string }]> = [];
    const mesh = new PeerMesh({
      selfConn: "aaa",
      iceServers: [],
      onSignal: (to, d) => sent.push([to, d]),
      onRemoteStream: () => {},
      onPeerGone: () => {},
    });
    await mesh.syncPeers(["bbb"]);
    expect(sent.map(([, d]) => d.type)).toEqual(["offer"]);
    expect(sent[0][0]).toBe("bbb");

    // 反过来：自己是较大的一方，不该主动发
    sent.length = 0;
    const mesh2 = new PeerMesh({
      selfConn: "zzz",
      iceServers: [],
      onSignal: (to, d) => sent.push([to, d]),
      onRemoteStream: () => {},
      onPeerGone: () => {},
    });
    await mesh2.syncPeers(["bbb"]);
    expect(sent).toHaveLength(0);
    mesh.close();
    mesh2.close();
  });

  it("remote description 未就位时候选先入队，就位后一次性补投", async () => {
    const mesh = new PeerMesh({
      selfConn: "zzz",
      iceServers: [],
      onSignal: () => {},
      onRemoteStream: () => {},
      onPeerGone: () => {},
    });
    await mesh.syncPeers(["bbb"]);
    const pc = FakePC.instances[0];
    await mesh.handleSignal("bbb", { type: "candidate", candidate: { candidate: "c1" } });
    expect(pc.addIceCandidate).not.toHaveBeenCalled();

    await mesh.handleSignal("bbb", { type: "offer", sdp: "o" });
    expect(pc.addIceCandidate).toHaveBeenCalledTimes(1);
    mesh.close();
  });

  it("收到 offer 后回 answer，answer 里带上自己的描述", async () => {
    const sent: Array<{ type: string }> = [];
    const mesh = new PeerMesh({
      selfConn: "zzz",
      iceServers: [],
      onSignal: (_to, d) => sent.push(d),
      onRemoteStream: () => {},
      onPeerGone: () => {},
    });
    await mesh.syncPeers(["bbb"]);
    await mesh.handleSignal("bbb", { type: "offer", sdp: "o" });
    expect(sent.map((d) => d.type)).toEqual(["answer"]);
    mesh.close();
  });

  it("syncPeers 幂等：同一 peer 不重复建连，消失的 peer 被关闭", async () => {
    const gone: string[] = [];
    const mesh = new PeerMesh({
      selfConn: "aaa",
      iceServers: [],
      onSignal: () => {},
      onRemoteStream: () => {},
      onPeerGone: (c) => gone.push(c),
    });
    await mesh.syncPeers(["bbb"]);
    await mesh.syncPeers(["bbb"]);
    expect(FakePC.instances).toHaveLength(1);
    await mesh.syncPeers([]);
    expect(gone).toEqual(["bbb"]);
    expect(FakePC.instances[0].close).toHaveBeenCalled();
    mesh.close();
  });

  it("close 拆掉全部连接，后续信令不再落到已关闭的 PC 上", async () => {
    const mesh = new PeerMesh({
      selfConn: "aaa",
      iceServers: [],
      onSignal: () => {},
      onRemoteStream: () => {},
      onPeerGone: () => {},
    });
    await mesh.syncPeers(["bbb", "ccc"]);
    expect(FakePC.instances).toHaveLength(2);
    mesh.close();
    expect(FakePC.instances[0].close).toHaveBeenCalled();
    expect(FakePC.instances[1].close).toHaveBeenCalled();
    await mesh.handleSignal("bbb", { type: "answer", sdp: "a" });
    // close 之后不得凭空重建连接（否则挂断后还会继续协商）
    expect(FakePC.instances).toHaveLength(2);
  });

  it("setLocalStream 把本地轨挂到已建立与后建立的连接上", async () => {
    const track = { kind: "audio" } as unknown as MediaStreamTrack;
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    const mesh = new PeerMesh({
      selfConn: "aaa",
      iceServers: [],
      onSignal: () => {},
      onRemoteStream: () => {},
      onPeerGone: () => {},
    });
    await mesh.syncPeers(["bbb"]);
    mesh.setLocalStream(stream);
    expect(FakePC.instances[0].addTrack).toHaveBeenCalledWith(track, stream);
    await mesh.syncPeers(["bbb", "ccc"]);
    expect(FakePC.instances[1].addTrack).toHaveBeenCalledWith(track, stream);
    mesh.close();
  });
});

describe("callSignalSink", () => {
  beforeEach(() => callSignalSink.clear());

  it("订阅前到达的信令被暂存，订阅时一次性冲刷", () => {
    const got: string[] = [];
    callSignalSink.push({
      call_id: "c1",
      from_conn: "x",
      from_user: "u",
      data: { type: "offer", sdp: "o" },
    });
    const unsub = callSignalSink.subscribe((p) => got.push(p.from_conn));
    // 帧比 PeerMesh 实例先到是常态：CallView 挂载要等 fetchIceServers 回来
    expect(got).toEqual(["x"]);

    callSignalSink.push({
      call_id: "c1",
      from_conn: "y",
      from_user: "u",
      data: { type: "answer", sdp: "a" },
    });
    expect(got).toEqual(["x", "y"]);
    unsub();
    callSignalSink.push({
      call_id: "c1",
      from_conn: "z",
      from_user: "u",
      data: { type: "answer", sdp: "a" },
    });
    expect(got).toEqual(["x", "y"]);
  });
});
