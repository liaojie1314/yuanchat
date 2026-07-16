/**
 * ChatSocket — WebSocket 连接管理器（单例，无 React 依赖）
 *
 * @description
 * 职责：
 * - 携带 access token 建立连接（浏览器 WS 无法带 Header，token 走 query）
 * - 断线自动重连：指数退避 1s→2s→4s→8s…上限 30s，最多 10 次
 * - 发送队列：未连接时缓存，连上后按序 flush
 * - 帧分发：按 type 调用外部注册的事件处理器（由 bootstrap 注册，
 *   避免 chatSocket ↔ store 循环导入）
 *
 * 兼容性：产物经 es2019 转译；WebSocket / JSON 在 Chrome 74 WebView 均可用。
 */
import { ensureFreshToken, needsRefresh } from "../api/tokenManager";

export interface ServerFrames {
  "message.ack": {
    client_msg_id: string;
    message_id: string;
    conversation_id: string;
    seq: number;
    timestamp: number;
  };
  "message.receive": {
    message_id: string;
    conversation_id: string;
    sender_id: string;
    sender_nickname: string;
    content: { type: string; text: string };
    seq: number;
    timestamp: number;
    reply_to_id?: string;
    client_msg_id?: string;
  };
  "message.read": { conversation_id: string; user_id: string; seq: number };
  typing: { conversation_id: string; user_id: string; nickname: string };
  error: { code: number; message: string; client_msg_id?: string };
}

export type FrameHandler = {
  [K in keyof ServerFrames]?: (payload: ServerFrames[K]) => void;
};

interface ImportMetaEnv {
  VITE_WS_URL?: string;
}

const WS_BASE: string =
  typeof import.meta !== "undefined"
    ? (import.meta as { env?: ImportMetaEnv }).env?.VITE_WS_URL || "ws://localhost:8081"
    : "ws://localhost:8081";

const MAX_BACKOFF_MS = 30_000;

type SocketState = "idle" | "connecting" | "open" | "closed";

class ChatSocket {
  private ws: WebSocket | null = null;
  private state: SocketState = "idle";
  private queue: string[] = [];
  private handlers: FrameHandler = {};
  private retries = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private tokenProvider: () => string | null = () => null;
  /** 重连成功后的回调（bootstrap 用来拉增量数据） */
  onReconnect: (() => void) | null = null;

  /** 注册 token 读取函数（bootstrap 时由 authStore 提供） */
  setTokenProvider(provider: () => string | null) {
    this.tokenProvider = provider;
  }

  /** 注册服务端帧处理器（覆盖式合并） */
  setHandlers(handlers: FrameHandler) {
    this.handlers = { ...this.handlers, ...handlers };
  }

  /** 当前是否已连接 */
  isOpen(): boolean {
    return this.state === "open";
  }

  connect() {
    if (this.state === "connecting" || this.state === "open") return;

    // token 临近过期：先静默刷新再拨号，避免注定 401 的握手
    //（服务端只在握手时校验 token，已建立的连接不受过期影响）
    if (needsRefresh()) {
      this.state = "connecting";
      void ensureFreshToken().then(() => {
        if (this.state !== "connecting") return; // 刷新期间被主动断开
        this.state = "idle";
        // 刷新失败时仍尝试拨号：登出场景 token 已清、dial 自然跳过；
        // 网络抖动场景则靠 401 握手失败 → 退避重连兜底
        this.dial();
      });
      return;
    }

    this.dial();
  }

  /** 实际建立 WebSocket 连接（token 已确保新鲜或由重连兜底） */
  private dial() {
    if (this.state === "connecting" || this.state === "open") return;
    const token = this.tokenProvider();
    if (!token) return;

    this.state = "connecting";
    const isRetry = this.retries > 0;

    let ws: WebSocket;
    try {
      ws = new WebSocket(WS_BASE + "/ws?token=" + encodeURIComponent(token));
    } catch {
      this.state = "closed";
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.state = "open";
      this.retries = 0;
      this.flushQueue();
      if (isRetry && this.onReconnect) this.onReconnect();
    };

    ws.onmessage = (event) => {
      this.handleFrame(typeof event.data === "string" ? event.data : "");
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.state === "closed") return; // 主动断开，不重连
      this.state = "closed";
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose 会紧随其后触发，重连逻辑统一放在 onclose
    };
  }

  /** 主动断开（登出/卸载时调用），不触发重连 */
  disconnect() {
    this.state = "closed";
    this.retries = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    this.queue = [];
    this.state = "idle";
  }

  /** 发送一帧；未连接时入队，连接建立后按序发出 */
  send(type: string, payload: unknown) {
    const frame = JSON.stringify({ type, payload });
    if (this.state === "open" && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(frame);
    } else {
      this.queue.push(frame);
      // 掉线期间的发送尝试触发一次立即重连（若未在退避等待中）
      if (this.state === "idle" || this.state === "closed") {
        this.connect();
      }
    }
  }

  private flushQueue() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const pending = this.queue;
    this.queue = [];
    for (const frame of pending) {
      this.ws.send(frame);
    }
  }

  private handleFrame(raw: string) {
    if (!raw) return;
    let env: { type?: string; payload?: unknown };
    try {
      env = JSON.parse(raw) as { type?: string; payload?: unknown };
    } catch {
      return;
    }
    if (!env.type) return;
    const handler = this.handlers[env.type as keyof ServerFrames] as
      | ((payload: unknown) => void)
      | undefined;
    if (handler) handler(env.payload);
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;

    // IM 长连接不设重试上限：服务端不可用期间以 30s 封顶持续重试，
    // 否则空闲端（无发送动作触发立即重连）会在上限耗尽后永久掉线
    const delay = Math.min(1000 * Math.pow(2, this.retries), MAX_BACKOFF_MS);
    this.retries += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

/** 全应用唯一的聊天连接实例 */
export const chatSocket = new ChatSocket();
