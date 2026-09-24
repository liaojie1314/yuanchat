/**
 * useCallSocket — 通话窗口专用的精简 bootstrap
 *
 * @description
 * 桌面端通话开独立原生窗口，而 Tauri 的每个 `WebviewWindow` 是独立 JS 上下文：
 * `MediaStream` / `RTCPeerConnection` 不能跨窗口传递，PeerConnection 必须建在
 * 通话窗口里，于是那个窗口得自己有一条 WebSocket 才能收发信令 —— 它这才成为
 * 房间里真正的参与者（`max_connections_per_user` 为 5，主窗口 + 通话窗口共 2 条）。
 *
 * 与 {@link useChatBootstrap} 的区别只有一个：**不拉会话列表 / 联系人 / presence**。
 * 通话窗口用不到这些，多拉一遍只会在开窗那一刻抢占带宽，而那正是建连最吃紧的时刻。
 */
import { useEffect } from "react";
import i18n from "@yuanchat/design-system/i18n";
import { useAuthStore } from "../store/authStore";
import { useCallStore } from "../store/callStore";
import { showToast } from "../store/toastStore";
import { callSignalSink } from "../webrtc/peerMesh";
import { chatSocket } from "../ws/chatSocket";
import type { FrameHandler } from "../ws/chatSocket";

/**
 * 四个通话帧的处理器表（主窗口与通话窗口共用同一份）。
 *
 * @remarks `call.signal` 刻意不进 store —— `RTCPeerConnection` 不是可序列化状态。
 *   它经 {@link callSignalSink} 交给 `PeerMesh` 实例，后者由通话界面在挂载时订阅。
 */
export const callFrameHandlers: FrameHandler = {
  "call.incoming": (p) => {
    // 本端建不出 PeerConnection 就当场回绝，不要摆出一个接了也接不通的来电界面。
    // 主叫据此立刻拿到 rejected，而不是干等 60s 振铃超时。
    //
    // 判的是运行时能力而非平台：四端的 WebView 各自决定支持度，且采集与连接会
    // 分别缺失 —— getUserMedia 能用而 RTCPeerConnection 不存在是实测见过的形态
    // （见 packages/ui/src/callActions.ts 的 canUseWebRTC）。
    if (typeof window === "undefined" || typeof window.RTCPeerConnection !== "function") {
      chatSocket.send("call.answer", { call_id: p.call_id, accept: false });
      return;
    }
    useCallStore.getState().applyIncoming(p);
  },
  "call.state": (p) => {
    useCallStore.getState().applyState(p);
  },
  "call.signal": (p) => {
    callSignalSink.push(p);
  },
  "call.ended": (p) => {
    // 终结原因要在 apply 之前判归属：applyEnded 会把 callId 清掉
    const mine = useCallStore.getState().callId === p.call_id;
    useCallStore.getState().applyEnded(p);
    // 全部受邀人忙线时房间直接终结：不提示的话用户只看到界面一闪而过，
    // 会以为是自己点错了。其余原因（挂断/拒接/超时）界面消失本身就是反馈
    if (mine && p.reason === "busy") showToast("info", i18n.t("call.busy"));
  },
};

/** 通话窗口的数据源接线：建连 + 只注册通话帧；卸载时断开。 */
export function useCallSocket(): void {
  useEffect(() => {
    chatSocket.setTokenProvider(() => useAuthStore.getState().accessToken);
    chatSocket.setHandlers(callFrameHandlers);
    chatSocket.connect();
    return () => {
      chatSocket.disconnect();
      callSignalSink.clear();
    };
  }, []);
}
