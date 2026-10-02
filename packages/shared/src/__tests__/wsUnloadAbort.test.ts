/**
 * WS 卸载中止不上报 Sentry 测试
 *
 * 测试环境是 node（见 vitest.config.ts），沿用 chatSocket.test.ts 里的
 * MockWebSocket + vi.stubGlobal 模式。vi.resetModules() + 动态 import 是
 * 必要的：chatSocket 是模块级单例，跨用例必须完全重置状态。
 */
import { describe, it, expect, vi } from "vitest";

// ---- WebSocket 打桩（与 chatSocket.test.ts 保持一致）----

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;

  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose();
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen();
  }
}

const latest = () => MockWebSocket.instances[MockWebSocket.instances.length - 1];

describe("WS onerror — 卸载态不上报 Sentry", () => {
  it("正常状态下 onerror 调用 captureException", async () => {
    vi.resetModules();
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);

    const mockCapture = vi.fn();
    vi.doMock("../observability/sentry", () => ({ captureException: mockCapture }));

    const { chatSocket } = await import("../ws/chatSocket");
    chatSocket.setTokenProvider(() => "tok");
    chatSocket.connect();
    latest().simulateOpen();

    if (latest().onerror) latest().onerror!();

    expect(mockCapture).toHaveBeenCalledTimes(1);
    chatSocket.disconnect();
    vi.unstubAllGlobals();
  });

  it("页面卸载时 onerror 不调用 captureException", async () => {
    vi.resetModules();
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);

    const mockCapture = vi.fn();
    vi.doMock("../observability/sentry", () => ({ captureException: mockCapture }));

    // window stub：接住 beforeunload / pagehide / online 监听
    const listeners: Record<string, Array<() => void>> = {};
    vi.stubGlobal("window", {
      addEventListener: (type: string, fn: () => void) => {
        (listeners[type] ??= []).push(fn);
      },
    });

    const { chatSocket } = await import("../ws/chatSocket");
    // 重置 envListenersBound，让本用例独立绑定监听
    (chatSocket as unknown as { envListenersBound: boolean }).envListenersBound = false;

    chatSocket.setTokenProvider(() => "tok");
    chatSocket.connect();
    latest().simulateOpen(); // onopen 里调 bindEnvListeners

    // 模拟页面卸载
    for (const fn of listeners["beforeunload"] ?? []) fn();

    // 卸载后握手中断触发 onerror
    if (latest().onerror) latest().onerror!();

    expect(mockCapture).not.toHaveBeenCalled();
    chatSocket.disconnect();
    vi.unstubAllGlobals();
  });
});
