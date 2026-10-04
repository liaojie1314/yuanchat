import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { networkPhase, subscribeNetworkPhase } from "../hooks/useNetworkStatus";
import { chatSocket } from "../ws/chatSocket";

/** 造一个只记录监听器的假 window */
function fakeWindow() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    api: {
      addEventListener: (type: string, fn: () => void) => {
        const set = listeners.get(type) ?? new Set();
        set.add(fn);
        listeners.set(type, set);
      },
      removeEventListener: (type: string, fn: () => void) => {
        listeners.get(type)?.delete(fn);
      },
    },
    emit: (type: string) => {
      for (const fn of listeners.get(type) ?? []) fn();
    },
    count: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
}

let win: ReturnType<typeof fakeWindow>;
/** subscribeNetworkPhase 传给 chatSocket 的那个回调（用来模拟 WS 状态变化） */
let socketListener: ((open: boolean) => void) | null;

beforeEach(() => {
  win = fakeWindow();
  socketListener = null;
  vi.stubGlobal("window", win.api);
  vi.stubGlobal("navigator", { onLine: true });
  vi.spyOn(chatSocket, "isOpen").mockReturnValue(false);
  // 不碰真 WebSocket：截下订阅回调，需要时直接调它
  vi.spyOn(chatSocket, "onStateChange").mockImplementation((fn) => {
    socketListener = fn;
    return () => {
      socketListener = null;
    };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("networkPhase —— 三态判定", () => {
  it("navigator.onLine 为 false → offline", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(networkPhase()).toBe("offline");
  });

  it("在线但 WS 未 open → connecting（网卡说在线也不能当一切正常）", () => {
    vi.spyOn(chatSocket, "isOpen").mockReturnValue(false);
    expect(networkPhase()).toBe("connecting");
  });

  it("在线且 WS open → online", () => {
    vi.spyOn(chatSocket, "isOpen").mockReturnValue(true);
    expect(networkPhase()).toBe("online");
  });

  it("navigator 缺失时按在线算（Node 下可能根本没有 navigator）", () => {
    vi.stubGlobal("navigator", undefined);
    vi.spyOn(chatSocket, "isOpen").mockReturnValue(true);
    expect(networkPhase()).toBe("online");
  });

  it("window 缺失时返回 online 且不抛错（SSR / node 环境不该弹断网条）", () => {
    vi.stubGlobal("window", undefined);
    vi.spyOn(chatSocket, "isOpen").mockReturnValue(false);
    expect(networkPhase()).toBe("online");
  });
});

describe("subscribeNetworkPhase —— 事件驱动，不轮询", () => {
  it("offline → online 事件后先 connecting，WS 连上才 online", () => {
    vi.stubGlobal("navigator", { onLine: false });
    const seen: string[] = [];
    const stop = subscribeNetworkPhase(() => seen.push(networkPhase()));
    expect(networkPhase()).toBe("offline");

    // 网卡恢复：此刻 WS 还没连上
    vi.stubGlobal("navigator", { onLine: true });
    win.emit("online");
    expect(seen[seen.length - 1]).toBe("connecting");

    // WS 连上
    vi.spyOn(chatSocket, "isOpen").mockReturnValue(true);
    socketListener!(true);
    expect(seen[seen.length - 1]).toBe("online");

    stop();
  });

  it("offline 事件立刻转 offline", () => {
    const seen: string[] = [];
    const stop = subscribeNetworkPhase(() => seen.push(networkPhase()));
    vi.stubGlobal("navigator", { onLine: false });
    win.emit("offline");
    expect(seen[seen.length - 1]).toBe("offline");
    stop();
  });

  it("取消订阅后监听器全部摘掉，不泄漏", () => {
    const stop = subscribeNetworkPhase(() => undefined);
    expect(win.count()).toBe(2); // online + offline
    stop();
    expect(win.count()).toBe(0);
  });

  it("取消订阅后退订 WS，监听器不再被持有", () => {
    const stop = subscribeNetworkPhase(() => undefined);
    expect(socketListener).not.toBeNull();
    stop();
    expect(socketListener).toBeNull();
  });

  it("window 缺失时订阅是 no-op，取消订阅也不抛错", () => {
    vi.stubGlobal("window", undefined);
    const stop = subscribeNetworkPhase(() => undefined);
    expect(() => stop()).not.toThrow();
  });
});
