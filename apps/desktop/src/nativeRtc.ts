/**
 * nativeRtc — Linux 桌面端的 `RTCPeerConnection` 垫片（走进程内 GStreamer）
 *
 * @description
 * Tauri 在 Linux 上用系统 WebKitGTK，而 Ubuntu 与 GNOME 官方 Flatpak runtime 的
 * WebKitGTK 都没编进 GstWebRTC 后端：`navigator.mediaDevices` 正常，
 * `RTCPeerConnection` 却整个类不存在。媒体面因此下沉到 Rust 侧的 `webrtcbin`
 * （见 `src-tauri/src/native_rtc.rs`），本文件把它包装成标准 `RTCPeerConnection`
 * 的形状，**在 window 上就地替换**。
 *
 * 这样做而不是给 `PeerMesh` 加分支的理由：mesh 的 glare 消解、候选队列、
 * 幂等重投三段逻辑是通话里最容易写错且最难复现的部分，已被单测钉死。
 * 让它继续只认标准 API，等于 Linux 这条路白拿全部既有测试覆盖；
 * 将来 WebKitGTK 补上 WebRTC，删掉本文件的安装调用即可回到原生实现。
 *
 * # 视频
 *
 * 远端画面同样拿不到 `MediaStream`，故 Rust 侧把解码后的帧转成 JPEG，经本地
 * MJPEG 服务推给 WebView，前端用 `<img>` 显示（见 `src-tauri/src/mjpeg.rs`）。
 * `ontrack` 给出的那个空 `MediaStream` 的 `id` 在这里被登记成「流 → 对端」的
 * 索引：`CallView` 只认得 `MediaStream`，靠这个 id 才能反查出该拉哪一路画面。
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Rust 侧推上来的单条事件 */
interface NativeRtcEvent {
  peer_id: string;
  kind: "candidate" | "state" | "track";
  candidate?: string;
  sdp_mline_index?: number;
  state?: string;
}

/** peer_id → 垫片实例；事件按 peer_id 派发回对应实例 */
const instances = new Map<string, NativeRTCPeerConnection>();
/** MediaStream.id → peer_id，供 UI 反查该拉哪一路画面 */
const streamOwners = new Map<string, string>();
let listening = false;
let seq = 0;
/** 本次通话的媒体类型，由通话窗口在建连前告知（决定要不要开摄像头） */
let callMedia: "audio" | "video" = "audio";
/** MJPEG 服务基地址，装载时就取好，之后同步可用 */
let videoBase = "";
/** 本端自视画面在服务端的固定流名，与 Rust 侧的 SELF_STREAM 对应 */
const SELF_STREAM = "self";

/**
 * GStreamer 的连接状态名 → WebRTC 的 `RTCPeerConnectionState`。
 *
 * @remarks Rust 侧把 GLib 枚举序列化成字符串带上来，形如 `"connected"`；
 *   不同 GStreamer 版本的序列化格式略有差异（有的带类型前缀），故用包含匹配
 *   而不是全等。匹配不上时返回 `connecting` —— 绝不能返回 `failed`，
 *   那会让 `PeerMesh` 把一条正在建立的连接当场拆掉。
 */
function toConnectionState(raw: string): RTCPeerConnectionState {
  const s = raw.toLowerCase();
  if (s.indexOf("failed") >= 0) return "failed";
  if (s.indexOf("closed") >= 0) return "closed";
  if (s.indexOf("disconnected") >= 0) return "disconnected";
  if (s.indexOf("connected") >= 0) return "connected";
  if (s.indexOf("new") >= 0) return "new";
  return "connecting";
}

/** 确保事件订阅只建一次（每个 JS 上下文一条即可，按 peer_id 分发） */
async function ensureListener(): Promise<void> {
  if (listening) return;
  listening = true;
  await listen<NativeRtcEvent>("native-rtc", (event) => {
    const payload = event.payload;
    const instance = instances.get(payload.peer_id);
    if (!instance) return;
    instance.__dispatch(payload);
  });
}

/**
 * 标准 `RTCPeerConnection` 的等价物，底层是 GStreamer。
 *
 * 只实现 `PeerMesh` 与 `CallView` 实际用到的成员。刻意**不**做成完整实现：
 * 补一堆用不到的方法只会让人以为它通用，然后在没覆盖的路径上踩空。
 *
 * 刻意不写 `implements RTCPeerConnection`：那个接口里 `createOffer` /
 * `createAnswer` 带着上个时代的回调式重载（`(successCallback, failureCallback)`），
 * 声明实现它就必须把两个重载一起补上，而 `PeerMesh` 用的只有 Promise 那支。
 * 真正的契约由 `__tests__/nativeRtc.test.ts` 按 `PeerMesh` 的调用序列钉住。
 */
class NativeRTCPeerConnection {
  /** 与 Rust 侧对应连接的键 */
  private readonly peerId: string;
  private readonly ready: Promise<void>;
  private closed = false;

  onicecandidate: ((ev: RTCPeerConnectionIceEvent) => void) | null = null;
  ontrack: ((ev: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  connectionState: RTCPeerConnectionState = "new";
  remoteDescription: RTCSessionDescription | null = null;
  localDescription: RTCSessionDescription | null = null;

  constructor(config?: RTCConfiguration) {
    this.peerId = "p" + String(seq++) + "-" + String(Date.now());
    instances.set(this.peerId, this);
    const iceServers = config && config.iceServers ? config.iceServers : [];
    // 建连是异步的，而 PeerMesh 构造完立刻就会调 createOffer/addIceCandidate；
    // 用一个 promise 把后续调用排在建连之后，避免「连接不存在」
    this.ready = ensureListener().then(() =>
      invoke("native_rtc_create", {
        peerId: this.peerId,
        media: callMedia,
        iceServers: iceServers.map((s) => ({
          // urls 可能是字符串或数组，Rust 侧统一收数组
          urls: typeof s.urls === "string" ? [s.urls] : s.urls,
          username: s.username,
          credential: typeof s.credential === "string" ? s.credential : undefined,
        })),
      }),
    );
  }

  /** 事件分发入口（仅供本模块的监听器调用） */
  __dispatch(payload: NativeRtcEvent): void {
    if (this.closed) return;
    if (payload.kind === "candidate") {
      const handler = this.onicecandidate;
      if (!handler) return;
      // PeerMesh 只读 candidate.toJSON()，故给一个形状兼容的最小对象
      const candidate = {
        candidate: payload.candidate || "",
        sdpMLineIndex: payload.sdp_mline_index == null ? 0 : payload.sdp_mline_index,
        sdpMid: null,
        toJSON() {
          return {
            candidate: this.candidate,
            sdpMLineIndex: this.sdpMLineIndex,
            sdpMid: this.sdpMid,
          };
        },
      };
      handler({ candidate } as unknown as RTCPeerConnectionIceEvent);
      return;
    }
    if (payload.kind === "state") {
      this.connectionState = toConnectionState(payload.state || "");
      if (this.onconnectionstatechange) this.onconnectionstatechange();
      return;
    }
    // track：远端音频已由 GStreamer 直接播放，这里给一个空 MediaStream 只为让 UI
    // 把该参与者标成「已连接」。WebKitGTK 有 MediaStream 构造器（实测可用），
    // 故不必伪造对象 —— 伪造的东西一旦被赋给 video.srcObject 会抛 TypeError。
    // 视频则靠 stream.id 反查对端，去 MJPEG 服务上取画面
    const stream = typeof MediaStream === "function" ? new MediaStream() : null;
    if (this.ontrack && stream) {
      streamOwners.set(stream.id, this.peerId);
      this.ontrack({ streams: [stream] } as unknown as RTCTrackEvent);
    }
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    await this.ready;
    const sdp = await invoke<string>("native_rtc_create_offer", { peerId: this.peerId });
    this.localDescription = { type: "offer", sdp } as RTCSessionDescription;
    return { type: "offer", sdp };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    await this.ready;
    const sdp = await invoke<string>("native_rtc_create_answer", { peerId: this.peerId });
    this.localDescription = { type: "answer", sdp } as RTCSessionDescription;
    return { type: "answer", sdp };
  }

  /**
   * 空实现 —— local description 已在 Rust 侧随 create 一并设好。
   *
   * @remarks webrtcbin 的 `create-offer` 回调里拿到的是原生会话描述对象，
   *   跨 IPC 只能退化成 SDP 字符串再解析回来，白白多一轮解析且可能丢属性。
   *   故 Rust 侧造完就地 set，这里保留同名方法只为让 `PeerMesh` 的调用序列不变。
   */
  async setLocalDescription(_desc?: RTCLocalSessionDescriptionInit): Promise<void> {
    await this.ready;
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    await this.ready;
    await invoke("native_rtc_set_remote", {
      peerId: this.peerId,
      sdpType: desc.type,
      sdp: desc.sdp || "",
    });
    // PeerMesh 用 remoteDescription 是否为空来决定候选入队还是直投，
    // 必须在 await 之后同步置上
    this.remoteDescription = desc as RTCSessionDescription;
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    await this.ready;
    if (!candidate || !candidate.candidate) return; // null 候选表示收集结束
    await invoke("native_rtc_add_candidate", {
      peerId: this.peerId,
      candidate: candidate.candidate,
      sdpMlineIndex: candidate.sdpMLineIndex == null ? 0 : candidate.sdpMLineIndex,
    });
  }

  /**
   * 空实现 —— 麦克风由 GStreamer 的 `pulsesrc` 直接采集。
   *
   * @remarks 返回一个最小 sender 而不是 undefined：`PeerMesh.setLocalStream`
   *   会遍历 `getSenders()` 找同 kind 的轨道换轨，返回空数组它会退回 `addTrack`，
   *   两条路都不会出错，但保持形状一致更不容易在将来改动时踩空。
   */
  addTrack(_track: MediaStreamTrack, ..._streams: MediaStream[]): RTCRtpSender {
    return { track: null, replaceTrack: async () => {} } as unknown as RTCRtpSender;
  }

  getSenders(): RTCRtpSender[] {
    return [];
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    instances.delete(this.peerId);
    this.connectionState = "closed";
    void this.ready
      .then(() => invoke("native_rtc_close", { peerId: this.peerId }))
      .catch(() => {
        /* 连接可能已被 close_all 收走，重复关闭不是错误 */
      });
  }

  /** 静音本端麦克风（由桌面端订阅 callStore 后调用，UI 代码不感知平台） */
  static async setMutedAll(muted: boolean): Promise<void> {
    const ids = Array.from(instances.keys());
    for (let i = 0; i < ids.length; i++) {
      try {
        await invoke("native_rtc_set_muted", { peerId: ids[i], muted });
      } catch {
        /* 单条连接已拆除不影响其余 */
      }
    }
  }

  /**
   * 关/开摄像头。
   *
   * @remarks 不按连接分别处理 —— 摄像头是全局共享的一路采集（V4L2 不允许多个
   *   打开者），关掉即所有对端一起看不见。
   */
  static async setCameraOff(off: boolean): Promise<void> {
    try {
      await invoke("native_rtc_set_camera", { off });
    } catch {
      /* 语音通话没有采集，忽略 */
    }
  }

  /**
   * 声明本次通话的媒体类型。
   *
   * 必须在 `PeerMesh` 建第一条连接**之前**调用：摄像头分支要在 SDP 协商前就位，
   * 接通后再加视频轨得重新协商，对端会黑屏一下。
   */
  static setCallMedia(media: "audio" | "video"): void {
    callMedia = media;
  }

  /** 拆掉全部连接（通话结束兜底，防止麦克风占用泄漏） */
  static async closeAll(): Promise<void> {
    instances.clear();
    streamOwners.clear();
    try {
      await invoke("native_rtc_close_all");
    } catch {
      /* 非 Tauri 环境或后端未注册命令 */
    }
  }
}

export { NativeRTCPeerConnection };

/**
 * 本端是否走原生后端（即垫片已装上）。
 *
 * @remarks 判「window 上装的是不是我们这个类」而不是记一个布尔量：通话窗口是
 *   独立 JS 上下文，模块级变量不跨窗口共享，而 `window.RTCPeerConnection`
 *   在每个上下文里都由各自的 {@link installNativeRtc} 装好。
 */
export function isNativeRtc(): boolean {
  if (typeof window === "undefined") return false;
  return (
    (window as unknown as { RTCPeerConnection?: unknown }).RTCPeerConnection ===
    NativeRTCPeerConnection
  );
}

/**
 * 某一路画面的 MJPEG 地址；没有原生后端或该路不存在时返回 null。
 *
 * @param key - 远端传 `ontrack` 给出的 `MediaStream.id`；本端自视传 `"self"`
 * @remarks 同步函数：`videoBase` 在 {@link installNativeRtc} 里就取好了，
 *   渲染期间不能再等一个 Promise。
 */
export function nativeVideoUrl(key: string): string | null {
  if (!videoBase) return null;
  if (key === SELF_STREAM) return videoBase + "/" + SELF_STREAM;
  const peerId = streamOwners.get(key);
  return peerId ? videoBase + "/" + peerId : null;
}

/**
 * 若本端缺 `RTCPeerConnection` 而原生后端可用，就把垫片装到 window 上。
 *
 * 必须在 React 渲染前调用：`canUseWebRTC()` 判的就是 `window.RTCPeerConnection`，
 * 装晚了通话入口已经被收起来了。
 *
 * @returns 是否完成安装（false 表示本端本来就有 WebRTC，或原生后端不可用）
 */
export async function installNativeRtc(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  // 已有原生实现就不碰：Windows 的 WebView2 与 macOS 的 WKWebView 都自带 WebRTC，
  // 用垫片顶掉它们只会把好好的实现换成一个只支持语音的
  if (typeof window.RTCPeerConnection === "function") return false;
  if (!("__TAURI_INTERNALS__" in window)) return false;
  try {
    const available = await invoke<boolean>("native_rtc_available");
    if (!available) return false;
  } catch (e) {
    // WebKitGTK 没有可外接的开发者工具，通话这类「两端同时在线才能复现」的问题
    // 只能靠 console 定位；这里把失败原因打出来而不是静默吞掉
    console.error("[nativeRtc] 原生后端探测失败:", e);
    return false; // 命令未注册（非 Linux 构建）
  }
  (window as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = NativeRTCPeerConnection;
  // 视频地址在这里就取好：渲染期间要同步拿到（`<img src>` 等不了 Promise）。
  // 取不到不影响语音 —— 缺 vp8/v4l2 插件时视频本来就不可用
  try {
    if (await invoke<boolean>("native_rtc_video_available")) {
      videoBase = await invoke<string>("native_rtc_video_url");
    }
  } catch (e) {
    console.error("[nativeRtc] 视频服务不可用，本端将只有语音:", e);
  }
  return true;
}
