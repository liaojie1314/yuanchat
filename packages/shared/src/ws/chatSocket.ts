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
import type { ConversationDTO } from "../api/chat";
import { captureException } from "../observability/sentry";

/**
 * 客户端 → 服务端的 `content` 载荷，与 `server/internal/ws/protocol.go` 的
 * `ContentPayload` + `buildContent` 的各 case 一一对应。
 *
 * @remarks 用可辨识联合而非"一个全 optional 的大对象"：后者允许
 * `{type:"sticker"}` 少带 key 之类的组合通过编译，而服务端 `buildContent`
 * 会回 400，前端却要到运行时才知道。字段名一律 snake_case（就是线上 JSON 本身，
 * 不做 camel 转换），这样与 Go 的 json tag 逐字对照即可核对。
 */
export type ClientContent =
  | { type: "text"; text: string }
  | { type: "image"; key: string; width: number; height: number; size: number }
  | { type: "file"; key: string; name: string; size: number }
  | { type: "voice"; key: string; duration: number; size: number }
  | {
      type: "video";
      key: string;
      /** 客户端生成的 JPEG 缩略图对象键（images/ 前缀，作 poster 用） */
      thumb_key: string;
      name: string;
      size: number;
      /** 时长（秒），服务端上限 120 */
      duration: number;
      width: number;
      height: number;
    }
  | { type: "sticker"; sticker_id: string; key: string; width: number; height: number }
  | {
      type: "e2ee";
      ratchet_key: string;
      n: number;
      pn: number;
      nonce: string;
      ciphertext: string;
      /** 仅首条消息携带（接收方据此完成 X3DH） */
      identity_key?: string;
      ephemeral_key?: string;
      otk_id?: number;
    };

/**
 * 客户端可发送的帧契约（type → payload），对齐 `ws/protocol.go` 的
 * `SendPayload` / `ReadPayload` / `TypingPayload`。
 *
 * @remarks 原签名是 `send(type: string, payload: unknown)`——帧契约漂移在编译期
 * 完全无人拦截，正是「`reply_to_id` 误填 clientMsgId 导致整帧 400」那类缺陷
 * 能一路发到线上的直接原因。`reply_to_id` 用 branded 类型 {@link ServerMessageId}
 * 标出"必须是服务端 UUID"，本地 clientMsgId 传进去即编译不过。
 */
export interface ClientFrames {
  "message.send": {
    conversation_id: string;
    content: ClientContent;
    client_msg_id: string;
    /** 被引用消息的**服务端** id；未 ack 的乐观消息没有它，故需 branded 类型把关 */
    reply_to_id?: ServerMessageId;
    mentions?: string[];
  };
  "message.read": { conversation_id: string; seq: number };
  typing: { conversation_id: string };
  ping: Record<string, never>;
  /** 发起通话；单聊可省略 `invitee_ids`（服务端默认取对端） */
  "call.invite": { conversation_id: string; media: CallMedia; invitee_ids?: string[] };
  /** 接听 / 拒绝；群通话的「主动加入」复用 `accept: true` */
  "call.answer": { call_id: string; accept: boolean };
  /** 挂断 / 取消 / 退出 —— 同一语义（离开房间），终结原因由服务端推导 */
  "call.leave": { call_id: string };
  /** SDP / ICE 转发，服务端不解析 `data` */
  "call.signal": { call_id: string; to_conn: string; data: CallSignalData };
}

/** 通话媒体形态。 */
export type CallMedia = "audio" | "video";

/**
 * SDP / ICE 协商载荷。
 *
 * @remarks 服务端只转发不解析，这个类型只在客户端两侧成立 —— 故它不属于任何
 *   Go struct，改动无需同步契约文件。
 */
export type CallSignalData =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "candidate"; candidate: RTCIceCandidateInit };

/**
 * 通话房间里的一名参与者。
 *
 * @remarks `conn_id` 在 `state === "invited"`（尚未接听）时为空串 —— mesh 建连
 *   必须按 `conn_id` 而非 `user_id` 定址：同一用户可能多设备在线。
 */
export interface CallParticipant {
  user_id: string;
  conn_id: string;
  nickname: string;
  avatar_url?: string | null;
  state: "invited" | "joined";
}

/**
 * "服务端已确认的消息 id"标记类型。
 *
 * 运行期就是 string，只在类型层面区分：普通 string（可能是 clientMsgId）无法直接
 * 赋给它，必须经 {@link asServerMessageId} 显式断言——那一行就是"我确认这是服务端
 * id"的可审查点（调用处应先过 `isServerConfirmed`）。
 */
export type ServerMessageId = string & { readonly __serverMessageId: unique symbol };

/** 把已确认（有 seq）的消息 id 标记为服务端 id。 */
export function asServerMessageId(id: string): ServerMessageId {
  return id as ServerMessageId;
}

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
    // text 帧只用 type/text；image 帧带 key/width/height/size；file 帧带 key/name/size；
    // voice 帧带 key/duration/size；video 帧带 key/thumb_key/name/duration/width/height/size；
    // sticker 帧带 sticker_id/key/width/height（后端 omitempty，不污染文本）
    content: {
      type: string;
      text?: string;
      key?: string;
      width?: number;
      height?: number;
      size?: number;
      name?: string;
      duration?: number;
      sticker_id?: string;
      /** video: 缩略图对象键 */
      thumb_key?: string;
      // e2ee 密文（服务端原样透传，不解析语义）
      ratchet_key?: string;
      n?: number;
      pn?: number;
      nonce?: string;
      ciphertext?: string;
      identity_key?: string;
      ephemeral_key?: string;
      otk_id?: number;
      /** 通话记录（系统消息 message_type=6）：老客户端读不到就回退 `text` */
      call?: { media: CallMedia; result: string; duration: number };
    };
    seq: number;
    timestamp: number;
    reply_to_id?: string;
    mentions?: string[];
    client_msg_id?: string;
  };
  "message.read": { conversation_id: string; user_id: string; seq: number };
  "message.recalled": {
    message_id: string;
    conversation_id: string;
    seq: number;
    operator_id: string;
    operator_nickname: string;
  };
  /** 消息被编辑：就地替换正文，带服务端累计编辑次数 */
  "message.edited": {
    message_id: string;
    conversation_id: string;
    seq: number;
    text: string;
    /** 最后一次编辑时刻（ISO8601，时区表示随端点而异，一律 new Date() 后再比较） */
    edited_at: string;
    edit_count: number;
  };
  "message.reaction": {
    message_id: string;
    conversation_id: string;
    user_id: string;
    emoji: string;
    count: number;
    reacted: boolean;
  };
  typing: { conversation_id: string; user_id: string; nickname: string };
  "contact.request": {
    request_id: string;
    requester: { id: string; nickname: string; avatar_url?: string | null; short_id: number };
    message?: string;
    created_at: number;
  };
  "contact.accepted": {
    request_id: string;
    friend: { id: string; nickname: string; avatar_url?: string | null; short_id: number };
    conversation_id: string;
  };
  "conversation.created": { conversation: ConversationDTO };
  "conversation.updated": {
    conversation_id: string;
    name?: string;
    member_count?: number;
    is_pinned?: boolean;
    pinned_at?: string | null;
    is_muted?: boolean;
    /** 公告变更帧中恒存在（空串=清除）；其他类型的更新帧不含该键 */
    announcement?: string | null;
    announcement_updated_at?: string;
  };
  "conversation.removed": { conversation_id: string; reason: "kicked" | "left" | "dissolved" };
  "conversation.role_changed": {
    conversation_id: string;
    user_id: string;
    new_role: number;
    changed_by: string;
  };
  "friend.removed": { friend_id: string };
  presence: { user_id: string; online: boolean };
  /**
   * 来电推送：投给被邀请者的全部设备（振铃）。
   *
   * 字段名逐字对齐 `contracts/server-frames.golden.json` 的 `call.incoming` 用例。
   */
  "call.incoming": {
    call_id: string;
    conversation_id: string;
    media: CallMedia;
    caller: { id: string; nickname: string; avatar_url?: string | null; short_id: number };
    participants: CallParticipant[];
  };
  /**
   * 房间成员变更：投给房间内全部连接 **以及** 会话里的其他成员。
   *
   * `self_conn` 是**收件人自己**在房间里的连接 id —— 会话内的非参与者收到的是空串，
   * 他们只用这一帧渲染「通话中」横幅，不得把自己拖进通话。
   */
  "call.state": {
    call_id: string;
    conversation_id: string;
    media: CallMedia;
    state: "ringing" | "active";
    self_conn: string;
    participants: CallParticipant[];
  };
  /** SDP / ICE 转发：只投给 `to_conn` 那一条连接 */
  "call.signal": {
    call_id: string;
    to_conn: string;
    from_conn: string;
    from_user: string;
    data: CallSignalData;
  };
  /** 通话终结：投给房间内全部连接与曾振铃的设备；`reason` 由服务端推导 */
  "call.ended": { call_id: string; reason: string; duration: number };
  pong: Record<string, never>;
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
    ? (import.meta as { env?: ImportMetaEnv }).env?.VITE_WS_URL || "ws://localhost:8086"
    : "ws://localhost:8086";

const MAX_BACKOFF_MS = 30_000;

// ---- 应用层心跳（半开连接探测）----
// 浏览器对 WS 协议层 ping/pong 自动响应且 JS 不可见，无法探测
// NAT 超时/网络切换造成的半开连接。客户端周期发 "ping" 帧，
// PONG_TIMEOUT_MS 内无 "pong" 即判定链路死亡，主动断开走重连。
// 间隔按可见性 + 电量自适应，后台/低电时省电（服务端 pong_timeout 已放宽兼容）。
const HEARTBEAT_FG_MS = 30_000; // 前台
const HEARTBEAT_FG_LOW_BATTERY_MS = 60_000; // 前台 + 电量 ≤20%
const HEARTBEAT_BG_MS = 120_000; // 后台
const HEARTBEAT_BG_LOW_BATTERY_MS = 300_000; // 后台 + 电量 ≤20%
const PONG_TIMEOUT_MS = 10_000;
const LOW_BATTERY_LEVEL = 0.2;

interface BatteryLike {
  level: number;
  addEventListener?: (type: string, fn: () => void) => void;
}

type SocketState = "idle" | "connecting" | "open" | "closed";

class ChatSocket {
  private ws: WebSocket | null = null;
  private state: SocketState = "idle";
  private queue: string[] = [];
  private handlers: FrameHandler = {};
  private retries = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private tokenProvider: () => string | null = () => null;
  private lastErrorReport = 0;
  /** 重连成功后的回调（bootstrap 用来拉增量数据） */
  onReconnect: (() => void) | null = null;

  // ---- 心跳状态 ----
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private battery: BatteryLike | null = null;
  private envListenersBound = false;

  /** 按可见性 + 电量决定当前心跳间隔 */
  heartbeatInterval(): number {
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    const lowBattery = this.battery !== null && this.battery.level <= LOW_BATTERY_LEVEL;
    if (hidden) return lowBattery ? HEARTBEAT_BG_LOW_BATTERY_MS : HEARTBEAT_BG_MS;
    return lowBattery ? HEARTBEAT_FG_LOW_BATTERY_MS : HEARTBEAT_FG_MS;
  }

  /** 绑定环境信号（可见性/电量/网络恢复），只绑一次 */
  private bindEnvListeners() {
    if (this.envListenersBound) return;
    this.envListenersBound = true;

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        // 状态切换按新间隔重排下一次心跳；回前台立即探测一次链路
        if (this.state === "open") {
          this.scheduleHeartbeat(
            document.visibilityState === "visible" ? 0 : this.heartbeatInterval(),
          );
        }
      });
    }
    if (typeof window !== "undefined") {
      // 网络恢复：跳过退避立即重连
      window.addEventListener("online", () => {
        if (this.state === "closed" || this.state === "idle") {
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          this.connect();
        }
      });
    }
    // Battery Status API：Chrome 支持；Safari/Firefox 无则永远走"电量充足"分支
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    const getBattery = nav && (nav as { getBattery?: () => Promise<BatteryLike> }).getBattery;
    if (getBattery) {
      void getBattery.call(nav).then((b) => {
        this.battery = b;
        b.addEventListener?.("levelchange", () => {
          if (this.state === "open") this.scheduleHeartbeat(this.heartbeatInterval());
        });
      });
    }
  }

  private scheduleHeartbeat(delay: number) {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = null;
      if (this.state !== "open" || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(JSON.stringify({ type: "ping", payload: {} }));
      // pong 超时未归 → 半开连接，关闭触发重连
      this.pongTimer = setTimeout(() => {
        this.pongTimer = null;
        if (this.ws) this.ws.close();
      }, PONG_TIMEOUT_MS);
    }, delay);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

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
      this.bindEnvListeners();
      this.scheduleHeartbeat(this.heartbeatInterval());
      if (isRetry && this.onReconnect) this.onReconnect();
    };

    ws.onmessage = (event) => {
      this.handleFrame(typeof event.data === "string" ? event.data : "");
    };

    ws.onclose = (event?: { code?: number }) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopHeartbeat();
      if (this.state === "closed") return; // 主动断开，不重连
      this.state = "closed";
      const code = event && event.code;
      if (code && code !== 1000 && code !== 1001) {
        const now = Date.now();
        if (now - this.lastErrorReport > 30000) {
          this.lastErrorReport = now;
          captureException(new Error("WebSocket abnormal close " + String(code)), {
            code,
            url: WS_BASE,
          });
        }
      }
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      const now = Date.now();
      if (now - this.lastErrorReport > 30000) {
        this.lastErrorReport = now;
        captureException(new Error("WebSocket error"), { url: WS_BASE });
      }
    };
  }

  /** 主动断开（登出/卸载时调用），不触发重连 */
  disconnect() {
    this.state = "closed";
    this.retries = 0;
    this.stopHeartbeat();
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

  /**
   * 发送一帧；未连接时入队，连接建立后按序发出。
   *
   * 泛型把 payload 钉在 {@link ClientFrames} 上：帧名写错、字段缺失/多余、
   * content 与 type 不匹配都在编译期报错，不再等服务端回 400。
   */
  send<K extends keyof ClientFrames>(type: K, payload: ClientFrames[K]) {
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
    // pong：链路活性确认 → 取消超时判决，排下一轮心跳
    if (env.type === "pong") {
      if (this.pongTimer) {
        clearTimeout(this.pongTimer);
        this.pongTimer = null;
      }
      this.scheduleHeartbeat(this.heartbeatInterval());
    }
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
