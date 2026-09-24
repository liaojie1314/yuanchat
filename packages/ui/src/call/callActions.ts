/**
 * 通话动作 — 发起 / 加入 与本地媒体交接
 *
 * @description
 * 与 {@link CallView} 分家的理由有两条：入口散在四处（顶栏按钮、「更多」宫格、
 * 会话详情、联系人详情），它们只需要这两个函数而不需要整个视图；且
 * `react-refresh` 规则要求组件文件只导出组件。
 *
 * **本地流的交接**：`getUserMedia` 必须在发 `call.invite` / `call.answer`
 * **之前**完成 —— 设备被占用或权限被拒时若邀请已发出，对方会响铃而本端永远接不通。
 * 取到的流经模块级 holder 交给 `CallView`，避免同一次通话连开两次摄像头。
 * holder 刻意不进 zustand：`MediaStream` 不可序列化，进 store 会让 devtools 与
 * React 的浅比较双双失效。
 */
import i18n from "@yuanchat/design-system/i18n";
import { chatSocket, MAX_CALL_PARTICIPANTS, showToast, useCallStore } from "@yuanchat/shared";
import type { CallMedia } from "@yuanchat/shared";

/** 视频通话的采集约束：640×480 足够 mesh 四路并发，再高就是旧机型发热掉帧 */
export const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 480 },
  facingMode: "user",
};

/** 按媒体形态给出 `getUserMedia` 约束。 */
export function constraintsOf(media: CallMedia): MediaStreamConstraints {
  return media === "video" ? { audio: true, video: VIDEO_CONSTRAINTS } : { audio: true };
}

/** 停掉一路流的全部轨道（不 stop 的话摄像头指示灯会一直亮着）。 */
export function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  const tracks = stream.getTracks();
  for (let i = 0; i < tracks.length; i++) tracks[i].stop();
}

let pendingLocalStream: MediaStream | null = null;

/**
 * 通话发起请求 —— 交给宿主层决定「在哪里承载这通电话」。
 *
 * @remarks `caller` 带 `conversationId` + `inviteeIds`（房间还不存在），
 *   `joiner` 带 `callId`（房间已在进行，本端是后加入的）。
 */
export interface CallLaunchRequest {
  role: "caller" | "joiner";
  media: CallMedia;
  conversationId?: string;
  callId?: string;
  inviteeIds?: string[];
}

/** 宿主层的通话承载器；返回 true 表示已接管，本模块不再自行发起。 */
export type CallLauncher = (req: CallLaunchRequest) => boolean;

let launcher: CallLauncher | null = null;

/**
 * 注册通话承载器（桌面端专用）。
 *
 * @remarks 桌面端通话在独立原生窗口里完成，而 Tauri 每个 `WebviewWindow` 是独立
 *   JS 上下文 —— `getUserMedia` 与 `RTCPeerConnection` 必须发生在那个窗口里，
 *   `call.invite` / `call.answer` 也必须由**它自己的** WebSocket 发出，
 *   否则房间里登记的是主窗口那条连接，视频要往哪渲染都没有。
 *   于是四个入口的动作在主窗口这边必须被整体拦下，只转成一次「开窗」。
 *
 * @param fn - 承载器；传 null 撤销（回到本模块自己发起）
 */
export function setCallLauncher(fn: CallLauncher | null): void {
  launcher = fn;
}

/**
 * 一路画面 → 可直接放进 `<img src>` 的地址；没有就返回 null。
 *
 * @param key - 远端传该路的 `MediaStream.id`，本端自视传 `"self"`
 */
export type NativeVideoResolver = (key: string) => string | null;

let nativeVideo: NativeVideoResolver | null = null;

/**
 * 注册原生视频取帧器（Linux 桌面端专用）。
 *
 * @remarks Linux 的 WebKitGTK 没有 WebRTC，画面在 Rust 侧的 GStreamer 里，
 *   `MediaStream` 是空的，`<video srcObject>` 永远黑屏。那一路改由本地 MJPEG
 *   服务推帧、前端用 `<img>` 显示，而「该拉哪个地址」只有桌面端知道 ——
 *   故与 {@link setCallLauncher} 同样用注入，不让平台差异渗进三端共用的 `CallView`。
 *
 * @param fn - 取帧器；传 null 撤销（回到标准 `srcObject` 那条路）
 */
export function setNativeVideoResolver(fn: NativeVideoResolver | null): void {
  nativeVideo = fn;
}

/**
 * 查一路画面的原生地址。
 *
 * @returns 未注册取帧器（Web / 移动端 / Windows / macOS）时恒为 null，
 *   调用方据此回落到标准 `srcObject`
 */
export function nativeVideoSrc(key: string | undefined): string | null {
  if (!nativeVideo || !key) return null;
  return nativeVideo(key);
}

/**
 * 取走预取的本地流。
 *
 * @returns 预取的流；没有则 null（桌面通话窗口是独立 JS 上下文，取不到主窗口
 *   这里的值 —— 那条路径由 `CallView` 自己现取）
 * @remarks 只能取一次，避免两处共用同一路轨道各自 `stop()`。
 */
export function takeLocalStream(): MediaStream | null {
  const s = pendingLocalStream;
  pendingLocalStream = null;
  return s;
}

/**
 * 本端能否真的建立通话连接。
 *
 * @remarks 与 {@link probeLocalMedia} 分开判，因为**采集能力与连接能力是两件事**，
 *   在各端的 WebView 上会分别缺失：三端跑的分别是 WebView2 / WKWebView /
 *   Android System WebView / WebKitGTK，各自的 WebRTC 支持由宿主系统的版本与
 *   构建选项决定，应用侧无从假定。典型形态是 `getUserMedia` 能出流、
 *   `RTCPeerConnection` 却整个类不存在（旧版 Android WebView 与部分 Linux 发行版
 *   打包的 WebKitGTK 都实测到过），此时摄像头会亮起、`call.invite` 会发出、
 *   对方会响铃，本端却永远建不出连接，直到 60s 振铃超时 —— 最难排查的那种失败。
 *
 *   因此这里按**能力探测**而不是平台判断：不枚举系统与版本，只问这一个运行时
 *   有没有 `RTCPeerConnection`。新平台、新版本都不需要回来改这里。
 */
export function canUseWebRTC(): boolean {
  return typeof window !== "undefined" && typeof window.RTCPeerConnection === "function";
}

/**
 * 取本地媒体并存进 holder，失败出 toast 并返回 false。
 *
 * 发起 / 接听 / 加入三条路径共用：取不到设备就绝不能进房间 —— 那会让对方响铃却
 * 永远接不通，或在房里多一个静音黑屏的参与者把房间撑到 60s 超时。
 *
 * 先判连接能力再要采集权限：反过来的话用户白交一次麦克风/摄像头权限，
 * 还要看着指示灯亮起后才被告知这台机器打不了电话。
 */
export async function probeLocalMedia(media: CallMedia): Promise<boolean> {
  if (!canUseWebRTC()) {
    showToast("error", i18n.t("call.unsupported"));
    return false;
  }
  const devices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (!devices) {
    showToast("error", i18n.t("call.failedMedia"));
    return false;
  }
  try {
    const stream = await devices.getUserMedia(constraintsOf(media));
    stopStream(pendingLocalStream); // 上一轮遗留（呼叫未接通就被取消）
    pendingLocalStream = stream;
    return true;
  } catch {
    showToast("error", i18n.t("call.failedMedia"));
    return false;
  }
}

/**
 * 发起一通电话（四个入口共用）。
 *
 * @param conversationId - 目标会话
 * @param media - 语音或视频
 * @param inviteeIds - 群通话选中的成员；单聊传空数组（服务端默认取对端）
 */
export async function startCall(
  conversationId: string,
  media: CallMedia,
  inviteeIds: string[],
): Promise<void> {
  const store = useCallStore.getState();
  if (store.phase !== "idle") return; // 已在通话里，忽略重复点击
  // 能力判定必须在承载器之前：桌面端若开了独立窗口才发现连不通，
  // 用户看到的是一个空窗口自己闪一下关掉，比一条明确提示糟糕得多
  if (!canUseWebRTC()) {
    showToast("error", i18n.t("call.unsupported"));
    return;
  }
  // 承载器优先：媒体与信令都必须发生在真正承载这通电话的上下文里
  if (launcher !== null && launcher({ role: "caller", media, conversationId, inviteeIds })) return;
  if (!(await probeLocalMedia(media))) return;
  store.startOutgoing(conversationId, media, inviteeIds);
  chatSocket.send("call.invite", {
    conversation_id: conversationId,
    media,
    invitee_ids: inviteeIds.length > 0 ? inviteeIds : undefined,
  });
}

/**
 * 加入一通已在进行的群通话（会话横幅的「加入」）。
 *
 * @remarks 复用 `call.answer{accept:true}` —— 服务端不区分「接听」与「主动加入」，
 *   两者对房间都是「这个人进来了」。满员在这里前置拦住：等服务端回「人数已满」的话，
 *   用户已经交出了麦克风权限。
 * @param banner - 会话横幅携带的房间信息
 */
export async function joinCall(banner: {
  callId: string;
  conversationId: string;
  media: CallMedia;
  joinedCount: number;
}): Promise<void> {
  if (useCallStore.getState().phase !== "idle") return;
  if (banner.joinedCount >= MAX_CALL_PARTICIPANTS) {
    showToast("error", i18n.t("call.full"));
    return;
  }
  if (!canUseWebRTC()) {
    showToast("error", i18n.t("call.unsupported"));
    return;
  }
  if (
    launcher !== null &&
    launcher({
      role: "joiner",
      media: banner.media,
      callId: banner.callId,
      conversationId: banner.conversationId,
    })
  )
    return;
  if (!(await probeLocalMedia(banner.media))) return;
  chatSocket.send("call.answer", { call_id: banner.callId, accept: true });
}
