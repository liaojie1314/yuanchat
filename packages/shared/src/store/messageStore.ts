/**
 * 消息状态管理 Store
 *
 * @description
 * 管理每个会话内的消息流。消息按会话 ID 分桶存储（messagesByConv），
 * 支持文本 / 图片 / 文件 / 语音 / 系统消息，以及 IM 的完整状态机：
 *
 *   sending（发送中）→ sent（已送达）→ read（已读）
 *                    ↘ failed（失败，可点击重试）
 *
 * 数据来源分两种模式（由 useChatBootstrap 决定）：
 * - 真实模式：REST 拉历史（loadHistory/loadMore），WebSocket 收发
 *   （sendText → message.send，ack/receive/read/typing 帧驱动状态）
 * - Mock 模式：setMockMode(true) 后 sendText 走 setTimeout 模拟回执，
 *   demo 数据由 mocks/demoData.ts 注入
 */
import { create } from "zustand";
import { fetchMessages, dateKeyOf, formatMessageTime } from "../api/chat";
import { chatSocket } from "../ws/chatSocket";
import { useAuthStore } from "./authStore";

/** 消息在气泡里呈现的内容类别 */
export type ChatMessageKind = "text" | "image" | "file" | "voice" | "system";

/** 发送状态机（仅自己发出的消息有意义） */
export type ChatMessageStatus = "sending" | "sent" | "read" | "failed";

/** 被引用消息的摘要（嵌在气泡内的 quote 块） */
export interface QuoteRef {
  senderName: string;
  excerpt: string;
}

/** 表情回应聚合项，如 👍 x2 */
export interface Reaction {
  emoji: string;
  count: number;
  /** 我是否参与了该回应（高亮显示） */
  mine?: boolean;
}

/** 文件消息载荷 */
export interface FilePayload {
  name: string;
  /** 展示用大小文案，如 "3.2 MB" */
  size: string;
  /** 扩展名标签，如 "PDF" */
  ext: string;
}

/** 语音消息载荷 */
export interface VoicePayload {
  /** 时长（秒） */
  seconds: number;
  /** 波形采样高度（px 值数组，仅供展示） */
  wave: number[];
}

/** 聊天消息（UI 层结构，与后端 Message 实体分离，由 api/chat.ts 映射） */
export interface ChatMessage {
  id: string;
  conversationId: string;
  kind: ChatMessageKind;
  /** 是否自己发送（决定气泡左右与配色） */
  isSelf: boolean;
  /** 发送者昵称（群聊接收方气泡上方显示） */
  senderName?: string;
  /** 文本内容（text / system 消息） */
  text?: string;
  /** 图片尺寸占位（image 消息，接入后换成 URL + 宽高） */
  image?: { width: number; height: number };
  file?: FilePayload;
  voice?: VoicePayload;
  quote?: QuoteRef;
  reactions?: Reaction[];
  /** @提及的名字列表（渲染为高亮 token） */
  mentions?: string[];
  /** HH:mm 时间标签 */
  time: string;
  /** 本地日期键（YYYY-MM-DD），用于消息按日分组与日期分隔线 */
  dateKey?: string;
  status?: ChatMessageStatus;
  edited?: boolean;
  /** 已撤回：气泡渲染灰字系统占位，忽略 kind/text */
  recalled?: boolean;
  /** 服务端分配的会话内序列号（已读进度比对用） */
  seq?: number;
  /** 消息创建时间（epoch ms），用于撤回 2 分钟窗口的客户端判定 */
  createdAtMs?: number;
  /** 客户端幂等 ID（ack 匹配 / 重试复用） */
  clientMsgId?: string;
}

interface MessageState {
  /** 会话 ID → 消息列表（时间升序） */
  messagesByConv: Record<string, ChatMessage[]>;
  /** 会话 ID → 是否还有更早的历史消息 */
  hasMoreByConv: Record<string, boolean>;
  /** 正在输入中的联系人名（会话 ID → 名字，undefined 表示无人输入） */
  typingByConv: Record<string, string | undefined>;
  /** 正在引用回复的消息（composer 上方的引用条） */
  replyingTo: ChatMessage | null;
  setReplyingTo: (msg: ChatMessage | null) => void;
  /** 首次加载会话历史（已有消息时跳过） */
  loadHistory: (conversationId: string) => Promise<void>;
  /** 向上翻页加载更早的历史 */
  loadMore: (conversationId: string) => Promise<void>;
  /** 发送一条文本消息，返回消息 ID */
  sendText: (conversationId: string, text: string, quote?: QuoteRef) => string;
  /** 重试发送失败的消息（复用原 client_msg_id） */
  retrySend: (conversationId: string, messageId: string) => void;
  /** WebSocket message.receive：追加新消息（自动按 clientMsgId 去重自己的回显） */
  receiveMessage: (msg: ChatMessage) => void;
  /** WebSocket message.ack：本地乐观消息 → sent（补 seq / 服务端时间 / 服务端 id） */
  applyAck: (
    clientMsgId: string,
    messageId: string,
    convId: string,
    seq: number,
    timestamp: number,
  ) => void;
  /** WebSocket message.read：把自己 seq ≤ 给定值的消息标记为已读 */
  applyRead: (convId: string, seq: number) => void;
  /**
   * WebSocket message.recalled：把目标消息翻成撤回占位（清空 text）。
   * 非乐观更新——本端与他端都只在收到帧后调用，保证双端一致。
   * @param operatorName 撤回操作者昵称（预留给调用方拼列表预览，store 内不用）
   */
  applyRecall: (convId: string, messageId: string, operatorName: string) => void;
  /** typing 帧：显示"正在输入"，4 秒无后续自动清除 */
  setTyping: (convId: string, name: string) => void;
  /** 更新消息状态（重试 / 回执） */
  setStatus: (conversationId: string, messageId: string, status: ChatMessageStatus) => void;
}

// ========================================
// 模块内部状态（不进 Zustand，避免无谓渲染）
// ========================================

/** Mock 模式开关：true 时 sendText 用 setTimeout 模拟回执（无后端演示用） */
let mockMode = false;

export function setMessageMockMode(on: boolean) {
  mockMode = on;
}

/** 客户端消息 ID：时间戳 + 随机段，进程内唯一即可 */
let counter = 0;
function newClientMsgId(): string {
  counter += 1;
  return (
    "c" + Date.now().toString(36) + "-" + counter + "-" + Math.random().toString(36).slice(2, 8)
  );
}

/** clientMsgId → ack 超时定时器 */
const ackTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** convId → typing 清除定时器 */
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

const ACK_TIMEOUT_MS = 5000;
const TYPING_CLEAR_MS = 4000;

const now = () =>
  new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

const PAGE_SIZE = 30;

function selfUserId(): string {
  const user = useAuthStore.getState().user;
  return user ? user.id : "";
}

export const useMessageStore = create<MessageState>()((set, get) => ({
  messagesByConv: {},
  hasMoreByConv: {},
  typingByConv: {},
  replyingTo: null,

  setReplyingTo: (msg) => set({ replyingTo: msg }),

  loadHistory: async (conversationId) => {
    if (mockMode) return;
    if ((get().messagesByConv[conversationId] ?? []).length > 0) return;
    try {
      const { messages, hasMore } = await fetchMessages(conversationId, 0, PAGE_SIZE, selfUserId());
      set((s) => ({
        messagesByConv: { ...s.messagesByConv, [conversationId]: messages },
        hasMoreByConv: { ...s.hasMoreByConv, [conversationId]: hasMore },
      }));
    } catch {
      // 历史加载失败不阻塞聊天（保持空列表，可通过重进会话重试）
    }
  },

  loadMore: async (conversationId) => {
    if (mockMode) return;
    const existing = get().messagesByConv[conversationId] ?? [];
    const oldest = existing.find((m) => typeof m.seq === "number");
    if (!oldest || !oldest.seq) return;
    try {
      const { messages, hasMore } = await fetchMessages(
        conversationId,
        oldest.seq,
        PAGE_SIZE,
        selfUserId(),
      );
      set((s) => ({
        messagesByConv: {
          ...s.messagesByConv,
          [conversationId]: [...messages, ...(s.messagesByConv[conversationId] ?? [])],
        },
        hasMoreByConv: { ...s.hasMoreByConv, [conversationId]: hasMore },
      }));
    } catch {
      // 翻页失败保持现状，用户可再次触发
    }
  },

  sendText: (conversationId, text, quote) => {
    const clientMsgId = newClientMsgId();
    const msg: ChatMessage = {
      id: clientMsgId,
      conversationId,
      kind: "text",
      isSelf: true,
      text,
      quote,
      time: now(),
      dateKey: dateKeyOf(new Date()),
      createdAtMs: Date.now(),
      status: "sending",
      clientMsgId,
    };
    set((s) => ({
      messagesByConv: {
        ...s.messagesByConv,
        [conversationId]: [...(s.messagesByConv[conversationId] ?? []), msg],
      },
      replyingTo: null,
    }));

    if (mockMode) {
      // 无后端演示：模拟 送达 → 已读
      setTimeout(() => get().setStatus(conversationId, clientMsgId, "sent"), 700);
      setTimeout(() => get().setStatus(conversationId, clientMsgId, "read"), 1600);
      return clientMsgId;
    }

    dispatchSend(conversationId, text, clientMsgId, get);
    return clientMsgId;
  },

  retrySend: (conversationId, messageId) => {
    const msg = (get().messagesByConv[conversationId] ?? []).find((m) => m.id === messageId);
    if (!msg || !msg.text) return;
    get().setStatus(conversationId, messageId, "sending");

    if (mockMode) {
      setTimeout(() => get().setStatus(conversationId, messageId, "sent"), 700);
      return;
    }

    dispatchSend(conversationId, msg.text, msg.clientMsgId ?? messageId, get);
  },

  receiveMessage: (msg) => {
    set((s) => {
      const list = s.messagesByConv[msg.conversationId] ?? [];
      // 去重：自己其他入口的回显（clientMsgId）或重复推送（id）
      const dup = list.some(
        (m) => m.id === msg.id || (msg.clientMsgId && m.clientMsgId === msg.clientMsgId),
      );
      if (dup) return s;
      return {
        messagesByConv: {
          ...s.messagesByConv,
          [msg.conversationId]: [...list, msg],
        },
        // 对方发来消息意味着不再"正在输入"
        typingByConv: msg.isSelf
          ? s.typingByConv
          : { ...s.typingByConv, [msg.conversationId]: undefined },
      };
    });
  },

  applyAck: (clientMsgId, messageId, convId, seq, timestamp) => {
    const timer = ackTimers.get(clientMsgId);
    if (timer) {
      clearTimeout(timer);
      ackTimers.delete(clientMsgId);
    }
    set((s) => ({
      messagesByConv: {
        ...s.messagesByConv,
        [convId]: (s.messagesByConv[convId] ?? []).map((m) =>
          m.clientMsgId === clientMsgId
            ? {
                ...m,
                // 本地 client id 提升为服务端 message id：撤回/去重以服务端 id 为准，
                // clientMsgId 原样保留供 message.receive 自回显去重
                id: messageId,
                status: "sent" as const,
                seq,
                time: formatMessageTime(new Date(timestamp).toISOString()),
                dateKey: dateKeyOf(new Date(timestamp)),
                createdAtMs: timestamp,
              }
            : m,
        ),
      },
    }));
  },

  applyRead: (convId, seq) =>
    set((s) => ({
      messagesByConv: {
        ...s.messagesByConv,
        [convId]: (s.messagesByConv[convId] ?? []).map((m) =>
          m.isSelf && m.status === "sent" && typeof m.seq === "number" && m.seq <= seq
            ? { ...m, status: "read" as const }
            : m,
        ),
      },
    })),

  applyRecall: (convId, messageId, _operatorName) =>
    set((s) => {
      const list = s.messagesByConv[convId];
      if (!list || !list.some((m) => m.id === messageId)) return s;
      return {
        messagesByConv: {
          ...s.messagesByConv,
          [convId]: list.map((m) =>
            m.id === messageId ? { ...m, recalled: true, text: undefined } : m,
          ),
        },
      };
    }),

  setTyping: (convId, name) => {
    const prev = typingTimers.get(convId);
    if (prev) clearTimeout(prev);
    typingTimers.set(
      convId,
      setTimeout(() => {
        typingTimers.delete(convId);
        set((s) => ({ typingByConv: { ...s.typingByConv, [convId]: undefined } }));
      }, TYPING_CLEAR_MS),
    );
    set((s) => ({ typingByConv: { ...s.typingByConv, [convId]: name } }));
  },

  setStatus: (conversationId, messageId, status) =>
    set((s) => ({
      messagesByConv: {
        ...s.messagesByConv,
        [conversationId]: (s.messagesByConv[conversationId] ?? []).map((m) =>
          m.id === messageId ? { ...m, status } : m,
        ),
      },
    })),
}));

/** 经 WebSocket 发出 message.send 并挂 ack 超时（超时 → failed） */
function dispatchSend(
  conversationId: string,
  text: string,
  clientMsgId: string,
  get: () => MessageState,
) {
  chatSocket.send("message.send", {
    conversation_id: conversationId,
    content: { type: "text", text },
    client_msg_id: clientMsgId,
  });

  ackTimers.set(
    clientMsgId,
    setTimeout(() => {
      ackTimers.delete(clientMsgId);
      const list = get().messagesByConv[conversationId] ?? [];
      const pending = list.find((m) => m.clientMsgId === clientMsgId && m.status === "sending");
      if (pending) get().setStatus(conversationId, pending.id, "failed");
    }, ACK_TIMEOUT_MS),
  );
}
