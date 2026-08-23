/**
 * chatSocket 单元测试
 *
 * 用 Mock WebSocket 类替换全局 WebSocket，验证：
 * 连接、发送队列 flush、帧分发、断线重连退避、主动断开不重连。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chatSocket } from "../ws/chatSocket";

// ========================================
// WebSocket 打桩
// ========================================

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

  // 测试辅助
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen();
  }

  simulateMessage(frame: unknown) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(frame) });
  }

  simulateDrop() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose();
  }
}

const latest = () => MockWebSocket.instances[MockWebSocket.instances.length - 1];

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  chatSocket.setTokenProvider(() => "test-token");
});

afterEach(() => {
  chatSocket.disconnect();
  chatSocket.onReconnect = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("chatSocket", () => {
  it("connects with token in query string", () => {
    chatSocket.connect();
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(latest().url).toContain("/ws?token=test-token");
  });

  it("does not connect without token", () => {
    chatSocket.setTokenProvider(() => null);
    chatSocket.connect();
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("queues frames before open and flushes in order after open", () => {
    chatSocket.connect();
    chatSocket.send("typing", { conversation_id: "c1" });
    chatSocket.send("message.read", { conversation_id: "c1", seq: 5 });

    const ws = latest();
    expect(ws.sent).toHaveLength(0);

    ws.simulateOpen();
    expect(ws.sent).toHaveLength(2);
    expect(JSON.parse(ws.sent[0]).type).toBe("typing");
    expect(JSON.parse(ws.sent[1]).type).toBe("message.read");
  });

  it("sends immediately when open", () => {
    chatSocket.connect();
    latest().simulateOpen();
    chatSocket.send("typing", { conversation_id: "c2" });
    expect(latest().sent).toHaveLength(1);
  });

  it("dispatches frames to registered handlers", () => {
    const onTyping = vi.fn();
    chatSocket.setHandlers({ typing: onTyping });
    chatSocket.connect();
    const ws = latest();
    ws.simulateOpen();

    ws.simulateMessage({
      type: "typing",
      payload: { conversation_id: "c1", user_id: "u2", nickname: "Bob" },
    });
    expect(onTyping).toHaveBeenCalledWith({
      conversation_id: "c1",
      user_id: "u2",
      nickname: "Bob",
    });
  });

  it("ignores malformed frames", () => {
    const onTyping = vi.fn();
    chatSocket.setHandlers({ typing: onTyping });
    chatSocket.connect();
    const ws = latest();
    ws.simulateOpen();

    if (ws.onmessage) ws.onmessage({ data: "not-json{{" });
    ws.simulateMessage({ noType: true });
    expect(onTyping).not.toHaveBeenCalled();
  });

  it("reconnects with exponential backoff after drop", () => {
    chatSocket.connect();
    latest().simulateOpen();
    expect(MockWebSocket.instances).toHaveLength(1);

    latest().simulateDrop();
    // 第一次重连：1s
    vi.advanceTimersByTime(999);
    expect(MockWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(2);

    // 未 open 直接又断：第二次退避 2s
    latest().simulateDrop();
    vi.advanceTimersByTime(1999);
    expect(MockWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it("fires onReconnect after successful reconnection", () => {
    const onReconnect = vi.fn();
    chatSocket.onReconnect = onReconnect;

    chatSocket.connect();
    latest().simulateOpen();
    expect(onReconnect).not.toHaveBeenCalled(); // 首连不算重连

    latest().simulateDrop();
    vi.advanceTimersByTime(1000);
    latest().simulateOpen();
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("does not reconnect after explicit disconnect", () => {
    chatSocket.connect();
    latest().simulateOpen();
    chatSocket.disconnect();

    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  describe("adaptive heartbeat", () => {
    const pings = (ws: MockWebSocket) =>
      ws.sent.filter((f) => (JSON.parse(f) as { type: string }).type === "ping");

    it("sends a ping after the foreground interval and reschedules on pong", () => {
      chatSocket.connect();
      latest().simulateOpen();
      const ws = latest();

      // 前台间隔 30s：29.999s 无 ping，30s 发出
      vi.advanceTimersByTime(29_999);
      expect(pings(ws)).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(pings(ws)).toHaveLength(1);

      // pong 归来 → 重排下一轮
      ws.simulateMessage({ type: "pong", payload: {} });
      vi.advanceTimersByTime(30_000);
      expect(pings(ws)).toHaveLength(2);
    });

    it("closes the socket when pong does not arrive (half-open detection)", () => {
      chatSocket.connect();
      latest().simulateOpen();
      const ws = latest();

      vi.advanceTimersByTime(30_000); // ping 发出
      expect(pings(ws)).toHaveLength(1);

      // 10s 内无 pong → 主动 close → 触发退避重连
      vi.advanceTimersByTime(10_000);
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
      // 1s 退避后新连接建立
      vi.advanceTimersByTime(1_000);
      expect(MockWebSocket.instances).toHaveLength(2);
    });

    it("stops heartbeat after explicit disconnect", () => {
      chatSocket.connect();
      latest().simulateOpen();
      const ws = latest();
      chatSocket.disconnect();

      vi.advanceTimersByTime(120_000);
      expect(pings(ws)).toHaveLength(0);
    });

    it("uses low-battery interval when battery level is low", () => {
      // 直接注入 battery 状态（getBattery 在测试环境不可用）
      (chatSocket as unknown as { battery: { level: number } }).battery = { level: 0.1 };
      expect(chatSocket.heartbeatInterval()).toBe(60_000); // 前台 + 低电

      (chatSocket as unknown as { battery: { level: number } }).battery = { level: 0.9 };
      expect(chatSocket.heartbeatInterval()).toBe(30_000); // 前台 + 电量充足

      (chatSocket as unknown as { battery: null }).battery = null;
    });
  });

  describe("network online event", () => {
    it("reconnects immediately on 'online', skipping backoff", () => {
      // node 测试环境无 window：stub 最小事件目标，接住 chatSocket 绑定的 online 监听
      const listeners: Record<string, Array<() => void>> = {};
      vi.stubGlobal("window", {
        addEventListener: (type: string, fn: () => void) => {
          (listeners[type] ??= []).push(fn);
        },
      });
      // 绕过 envListenersBound（先前用例的 simulateOpen 可能已绑过真实分支）
      (chatSocket as unknown as { envListenersBound: boolean }).envListenersBound = false;

      chatSocket.connect();
      latest().simulateOpen(); // onopen 里绑定 env listeners
      latest().simulateDrop();
      expect(MockWebSocket.instances).toHaveLength(1);

      // 掉线后立刻触发 online：不等 1s 退避
      for (const fn of listeners["online"] ?? []) fn();
      expect(MockWebSocket.instances).toHaveLength(2);
    });
  });
});
