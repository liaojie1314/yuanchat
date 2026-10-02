/**
 * 网络状态三态。
 *
 * 刻意不是布尔：WS 每次短暂重连都会让 isOpen() 翻一下，合并成「在线 / 断网」
 * 的话用户看到的是一条无端闪烁的红条。中间那个 `connecting` 态同时也是
 * Linux WebKitGTK 的兜底 —— 那里 `navigator.onLine` 实测恒为 true，
 * 只信它的话断网时界面会一切正常地骗人，而 WS 连不上至少能显示「连接中…」。
 */
import { useSyncExternalStore } from "react";
import { chatSocket } from "../ws/chatSocket";

/** `offline` 网卡已断；`connecting` 网卡在线但 WS 未连上；`online` 两者都就绪 */
export type NetworkPhase = "online" | "connecting" | "offline";

/**
 * 当前网络态快照。
 *
 * 无 `window`（SSR / node）时一律当 `online` —— 那种环境谈不上网络态，
 * 返回别的只会让服务端渲染出一条断网提示条。
 * `navigator` 缺失（Node 20 下可能根本没有）同样按在线算。
 */
export function networkPhase(): NetworkPhase {
  if (typeof window === "undefined") return "online";
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  if (nav !== undefined && nav.onLine === false) return "offline";
  return chatSocket.isOpen() ? "online" : "connecting";
}

/**
 * 订阅网络态变化，返回取消订阅函数。
 *
 * 三个来源：`online` / `offline` 两个 window 事件，加 WS 连接状态订阅。
 * **不轮询** —— 轮询既晚一拍又白耗电。
 */
export function subscribeNetworkPhase(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  const offSocket = chatSocket.onStateChange(onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
    offSocket();
  };
}

/** 订阅当前网络态；变化时组件自动重渲染。 */
export function useNetworkStatus(): NetworkPhase {
  return useSyncExternalStore(subscribeNetworkPhase, networkPhase, () => "online");
}
