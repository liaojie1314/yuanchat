/**
 * PeerMesh — mesh 通话的 PeerConnection 生命周期管理（无 React 依赖）
 *
 * @description
 * 全连接 mesh：N 人房间里每端对其余 N-1 端各持一条 `RTCPeerConnection`。
 * 上限 4 人由服务端保证（`MaxCallParticipants`），本模块不判人数。
 *
 * 三件容易写错、且写错后「通话打不通」毫无线索的事，全部收在这里：
 *
 * 1. **glare 消解**：`self_conn < peer_conn`（字符串字典序）者发 offer，另一方等待。
 *    UUID 字典序全序且唯一，故不会双方同时 offer，也不会双方都在等。
 * 2. **ICE 候选队列**：候选常常先于 offer/answer 到达，此时 `addIceCandidate` 抛
 *    `InvalidStateError`，而丢掉的往往正是唯一能连通的那条 relay 候选。
 * 3. **`syncPeers` 幂等**：成员表每变一次就整表重投，重复建连会让同一对端出现
 *    两条 PC（音频叠加回声），漏拆则留下黑画面的僵尸格子。
 *
 * 兼容性：只用 `RTCPeerConnection` 的标准 Promise API（Chrome 74 WebView 可用），
 * 不用 `?.` / `??`。
 */
import type { CallSignalData } from "../ws/chatSocket";

/**
 * 投给 PeerMesh 的信令载荷 —— 服务端 `call.signal` 帧的可消费子集。
 *
 * `to_conn` 恒等于本端连接，PeerMesh 不需要它，故标为可选。
 */
export interface CallSignalPayload {
  call_id: string;
  from_conn: string;
  from_user: string;
  data: CallSignalData;
  to_conn?: string;
}

/**
 * 通话信令的模块级中转队列。
 *
 * @remarks 解决一个必然发生的竞态：`call.signal` 帧由 WS handler 收下，而
 *   `PeerMesh` 实例要等 `getUserMedia` 与 `fetchIceServers` 回来才建好 —— 帧比实例
 *   先到是常态。若 handler 直接丢弃，那批 offer/candidate 就永久消失，通话停在
 *   「连接中…」。这里在订阅前把帧暂存，订阅时一次性冲刷。
 *
 *   只支持单订阅者：一个 JS 上下文同时只可能有一个通话（桌面通话窗口是独立上下文）。
 */
export const callSignalSink = (() => {
  let listener: ((p: CallSignalPayload) => void) | null = null;
  const backlog: CallSignalPayload[] = [];

  return {
    /** 收到 `call.signal` 帧时投进来 */
    push(p: CallSignalPayload): void {
      if (listener !== null) listener(p);
      else backlog.push(p);
    },
    /**
     * 订阅信令（`PeerMesh` 建好后调用）。
     *
     * @returns 退订函数；订阅的瞬间会先把积压的帧按序冲刷给 `fn`
     */
    subscribe(fn: (p: CallSignalPayload) => void): () => void {
      listener = fn;
      const pending = backlog.splice(0, backlog.length);
      for (let i = 0; i < pending.length; i++) fn(pending[i]);
      return () => {
        if (listener === fn) listener = null;
      };
    },
    /** 清空订阅者与积压（通话结束/单测隔离） */
    clear(): void {
      listener = null;
      backlog.length = 0;
    },
  };
})();

/** PeerMesh 构造参数。 */
export interface PeerMeshOptions {
  /** 本端在房间里的连接 id（`call.state` 的 `self_conn`） */
  selfConn: string;
  iceServers: RTCIceServer[];
  /** 需要发一帧 `call.signal` 给 `toConn` */
  onSignal: (toConn: string, data: CallSignalData) => void;
  /** 某个对端的远端流就位（视频网格据此渲染） */
  onRemoteStream: (connId: string, stream: MediaStream) => void;
  /** 某个对端离开或连接彻底失败（UI 据此撤掉格子） */
  onPeerGone: (connId: string) => void;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  /** remote description 未就位期间暂存的候选 */
  queued: RTCIceCandidateInit[];
}

export class PeerMesh {
  private readonly opts: PeerMeshOptions;
  private readonly peers = new Map<string, PeerEntry>();
  private localStream: MediaStream | null = null;
  /** close 之后不得再凭空重建连接（否则挂断后还在继续协商） */
  private closed = false;

  constructor(opts: PeerMeshOptions) {
    this.opts = opts;
  }

  /**
   * 挂上本地媒体流。
   *
   * @remarks 对已建立的连接做「同 kind 就地换轨」而非再 `addTrack` —— 切换摄像头
   *   走的正是这条路，重复 addTrack 会让对端多出一路静止画面。
   */
  setLocalStream(stream: MediaStream): void {
    this.localStream = stream;
    const tracks = stream.getTracks();
    this.peers.forEach((entry) => {
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        const senders = entry.pc.getSenders().filter((s) => {
          return s.track !== null && s.track !== undefined && s.track.kind === track.kind;
        });
        if (senders.length > 0) void senders[0].replaceTrack(track);
        else entry.pc.addTrack(track, stream);
      }
    });
  }

  /**
   * 按最新成员表对齐连接集合（幂等）。
   *
   * @param peers - 房间里除自己以外、已 `joined` 的连接 id
   */
  async syncPeers(peers: string[]): Promise<void> {
    if (this.closed) return;
    const wanted = peers.filter((c) => !!c && c !== this.opts.selfConn);

    // 先拆走掉的：留着就是一格永不刷新的黑画面
    const current = Array.from(this.peers.keys());
    for (let i = 0; i < current.length; i++) {
      const conn = current[i];
      if (wanted.indexOf(conn) >= 0) continue;
      this.dropPeer(conn);
    }

    // 再建新的；glare 消解决定谁先开口
    for (let i = 0; i < wanted.length; i++) {
      const conn = wanted[i];
      if (this.peers.has(conn)) continue;
      this.ensurePeer(conn);
      if (this.opts.selfConn < conn) await this.offerTo(conn);
    }
  }

  /**
   * 处理一帧来自 `fromConn` 的协商载荷。
   *
   * @remarks 对端未在成员表里时也会建连：offer 完全可能先于本端的 `call.state`
   *   到达，此时丢掉它就再没有第二次机会 —— 发起方按 glare 规则不会重发。
   */
  async handleSignal(fromConn: string, data: CallSignalData): Promise<void> {
    if (this.closed || !fromConn || fromConn === this.opts.selfConn) return;
    const entry = this.ensurePeer(fromConn);
    const pc = entry.pc;

    if (data.type === "offer") {
      await pc.setRemoteDescription({ type: "offer", sdp: data.sdp });
      await this.flushCandidates(entry);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.opts.onSignal(fromConn, { type: "answer", sdp: answer.sdp || "" });
      return;
    }
    if (data.type === "answer") {
      await pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
      await this.flushCandidates(entry);
      return;
    }
    // candidate：remote description 未就位时必须入队（见文件头第 2 条）
    if (!pc.remoteDescription) {
      entry.queued.push(data.candidate);
      return;
    }
    await this.addCandidate(pc, data.candidate);
  }

  /** 拆掉全部连接（挂断 / 组件卸载）。 */
  close(): void {
    this.closed = true;
    this.peers.forEach((entry) => entry.pc.close());
    this.peers.clear();
  }

  /** 建（或复用）到某个对端的连接；**不**发 offer。 */
  private ensurePeer(conn: string): PeerEntry {
    const existing = this.peers.get(conn);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: this.opts.iceServers });
    const entry: PeerEntry = { pc, queued: [] };
    this.peers.set(conn, entry);

    pc.onicecandidate = (e) => {
      const candidate = e.candidate;
      if (!candidate) return; // null 表示收集结束，不必转发
      this.opts.onSignal(conn, { type: "candidate", candidate: candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      const stream = e.streams && e.streams.length > 0 ? e.streams[0] : null;
      if (stream) this.opts.onRemoteStream(conn, stream);
    };
    pc.onconnectionstatechange = () => {
      // failed 是终态（ICE 重启不在本批次范围内）：不上报的话 UI 会一直卡在
      // 「连接中…」，用户既不知道失败也不知道该重拨
      if (pc.connectionState === "failed") this.dropPeer(conn);
    };

    const stream = this.localStream;
    if (stream) {
      const tracks = stream.getTracks();
      for (let i = 0; i < tracks.length; i++) pc.addTrack(tracks[i], stream);
    }
    return entry;
  }

  private dropPeer(conn: string): void {
    const entry = this.peers.get(conn);
    if (!entry) return;
    this.peers.delete(conn);
    entry.pc.close();
    this.opts.onPeerGone(conn);
  }

  private async offerTo(conn: string): Promise<void> {
    const entry = this.peers.get(conn);
    if (!entry) return;
    const offer = await entry.pc.createOffer();
    await entry.pc.setLocalDescription(offer);
    this.opts.onSignal(conn, { type: "offer", sdp: offer.sdp || "" });
  }

  /** remote description 就位后一次性补投积压的候选。 */
  private async flushCandidates(entry: PeerEntry): Promise<void> {
    const pending = entry.queued.splice(0, entry.queued.length);
    for (let i = 0; i < pending.length; i++) {
      await this.addCandidate(entry.pc, pending[i]);
    }
  }

  /** 单个坏候选不能中断整批补投 —— 只要有一条能通，通话就能建立。 */
  private async addCandidate(pc: RTCPeerConnection, candidate: RTCIceCandidateInit): Promise<void> {
    try {
      await pc.addIceCandidate(candidate);
    } catch {
      /* 忽略：过期或格式不受支持的候选 */
    }
  }
}
