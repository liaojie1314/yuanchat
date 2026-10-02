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

const LOST_STORAGE_KEY = "yuanchat:net-lost";
/** sessionStorage 里的「断过网」标记保留时长，超过即视为陈旧记录 */
const LOST_TTL_MS = 60_000;

/** sessionStorage 可用性探测（隐私模式 / 禁用存储会抛）。 */
function safeStorage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/**
 * 标记「刚刚真的断过网」。
 *
 * 用 sessionStorage 而非模块级变量：硬刷新会重建整个 JS 环境，
 * 模块变量一律归零，只有 storage 能跨页面加载活下来 —— 而硬刷新
 * 恰恰是最容易误报「已连接」的场景（重载 → WS 重连 → 看着像恢复）。
 */
export function markNetworkLost(): void {
  const s = safeStorage();
  if (!s) return;
  try {
    s.setItem(LOST_STORAGE_KEY, String(Date.now()));
  } catch {
    // 存不进去就退化成「不提示」，宁少提示也不要误报
  }
}

/**
 * 消费「断过网」标记（读取即清除，保证一次断网只提示一次）。
 *
 * @param now 当前时间戳，便于测试注入
 * @returns 标记存在且未超过 {@link LOST_TTL_MS}
 */
export function consumeNetworkLost(now: number = Date.now()): boolean {
  const s = safeStorage();
  if (!s) return false;
  try {
    const raw = s.getItem(LOST_STORAGE_KEY);
    if (raw === null) return false;
    s.removeItem(LOST_STORAGE_KEY);
    const at = Number(raw);
    return Number.isFinite(at) && now - at <= LOST_TTL_MS;
  } catch {
    return false;
  }
}

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
  // 网卡真的断了 → 打标记。这样即便用户立刻刷新页面，新页面也知道
  // 「刚才断过」，恢复时才该提示 —— 否则每次硬刷新都会误报一次「已连接」。
  const onOffline = () => {
    markNetworkLost();
    onChange();
  };
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onOffline);
  const offSocket = chatSocket.onStateChange(onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onOffline);
    offSocket();
  };
}

/** 订阅当前网络态；变化时组件自动重渲染。 */
export function useNetworkStatus(): NetworkPhase {
  return useSyncExternalStore(subscribeNetworkPhase, networkPhase, () => "online");
}
