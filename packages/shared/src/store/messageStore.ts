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
import i18n from "@yuanchat/design-system/i18n";
import {
  fetchMessages,
  dateKeyOf,
  formatFileMeta,
  formatMessageTime,
  pseudoWave,
} from "../api/chat";
import { compressImage, getUploadUrl, uploadToTicket } from "../api/files";
import { chatSocket } from "../ws/chatSocket";
import { useAuthStore } from "./authStore";
import { showToast } from "./toastStore";

/** 消息在气泡里呈现的内容类别 */
export type ChatMessageKind = "text" | "image" | "file" | "voice" | "system";

/** 发送状态机（仅自己发出的消息有意义） */
export type ChatMessageStatus = "sending" | "sent" | "read" | "failed";

/** 被引用消息的摘要（嵌在气泡内的 quote 块） */
export interface QuoteRef {
  /** 被引用消息的服务端 ID（点击时可 emit scroll 到源消息） */
  messageId?: string;
  senderName: string;
  excerpt: string;
}

/** @提及目标（Composer 收集，随 message.send 提交给后端） */
export interface MentionRef {
  /** 用户 ID */
  id: string;
  /** 昵称（渲染 token 用，接收端只需重新 lookup） */
  name: string;
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
  /** 对象存储 key，收到/确认后据此签下载 URL */
  key?: string;
  /** 本地 blob URL，上传期间保留供失败重试 */
  localUrl?: string;
}

/** 语音消息载荷 */
export interface VoicePayload {
  /** 时长（秒） */
  seconds: number;
  /** 波形采样高度（px 值数组，仅供展示） */
  wave: number[];
  /** 对象存储 key，播放时据此签下载 URL */
  key?: string;
  /** 本地 blob URL，上传期间保留供重试/即时回放 */
  localUrl?: string;
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
  /**
   * 图片消息载荷：width/height 为像素尺寸（气泡等比占位，防加载抖动）。
   * - key：对象存储 key，收到/确认后据此签下载 URL 渲染
   * - localUrl：本地 blob URL，上传期间直接预览（确认后可继续沿用，避免闪烁）
   */
  image?: { width: number; height: number; key?: string; localUrl?: string };
  file?: FilePayload;
  voice?: VoicePayload;
  quote?: QuoteRef;
  reactions?: Reaction[];
  /** @提及的用户 ID 列表（渲染时高亮相应昵称段） */
  mentions?: string[];
  /** 引用消息的服务端 ID（reply_to_id）：可能与 quote.messageId 重复，
   * quote 是"发送时的 UI 快照"，reply_to_id 是"服务端真源"，两者独立以便惰性拉取 */
  replyToId?: string;
  /** HH:mm 时间标签 */
  time: string;
  /** 本地日期键（YYYY-MM-DD），用于消息按日分组与日期分隔线 */
  dateKey?: string;
  status?: ChatMessageStatus;
  edited?: boolean;
  /** 已撤回：气泡渲染灰字系统占位，忽略 kind/text */
  recalled?: boolean;
  /** 撤回前的原文本（仅本端自己的 text 消息保留，供「重新编辑」回填） */
  recalledText?: string;
  /** 撤回发生时刻（epoch ms），重新编辑 5 分钟窗口判定用 */
  recalledAtMs?: number;
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
  /** 待回填输入框的文本（撤回重新编辑）；Composer 消费后置回 null */
  composerInsert: string | null;
  setComposerInsert: (text: string | null) => void;
  /** 首次加载会话历史（已有消息时跳过） */
  loadHistory: (conversationId: string) => Promise<void>;
  /** 向上翻页加载更早的历史 */
  loadMore: (conversationId: string) => Promise<void>;
  /** 发送一条文本消息，返回消息 ID；mentions/quote 一并提交给后端 */
  sendText: (
    conversationId: string,
    text: string,
    opts?: { quote?: QuoteRef; mentions?: MentionRef[] },
  ) => string;
  /**
   * 发送一张图片：本地压缩 → 乐观插入（本地预览）→ 申请上传 URL → 直传 → WS image 帧。
   * 任一步失败置该消息为 failed（可点击重试，走 retrySend 重跑整个流程）。
   */
  sendImage: (conversationId: string, file: Blob) => Promise<void>;
  /**
   * 发送一个文件：乐观插入（文件名/大小/扩展名）→ 申请上传 URL → 直传 → WS file 帧。
   * 无压缩步骤；localUrl 保留供失败重试取回字节。
   */
  sendFile: (conversationId: string, file: File) => Promise<void>;
  /** 发送一段语音：乐观插入（伪波形）→ 直传 webm → WS voice 帧 */
  sendVoice: (conversationId: string, blob: Blob, duration: number) => Promise<void>;
  /** 重试发送失败的消息（复用原 client_msg_id；图片则从 localUrl 重传） */
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
  /**
   * WebSocket message.reaction：更新消息的 emoji 回应聚合。
   * @param mine 仅当操作者是自己时传 reacted（true/false）；他人操作传 undefined 保持原 mine
   */
  applyReaction: (
    convId: string,
    messageId: string,
    emoji: string,
    count: number,
    mine: boolean | undefined,
  ) => void;
  /** typing 帧：显示"正在输入"，4 秒无后续自动清除 */
  setTyping: (convId: string, name: string) => void;
  /** 更新消息状态（重试 / 回执） */
  setStatus: (conversationId: string, messageId: string, status: ChatMessageStatus) => void;
  /**
   * WS error 帧（如 BLOCKED）按 clientMsgId 定位乐观消息并翻 failed。
   * 找不到目标（如重连后 store 已清）静默忽略。
   */
  failByClientMsgId: (clientMsgId: string) => void;
  /** 搜索跳转后高亮的消息 ID（2 秒后 ChatWindow 自动清除） */
  highlightMsgId: string | null;
  setHighlightMsgId: (id: string | null) => void;
  /**
   * 跳转到历史消息：若消息不在当前列表则拉取该 seq 附近的历史并替换当前列表，
   * 然后设置 highlightMsgId 触发 ChatWindow 滚动定位。
   */
  seekToMessage: (convId: string, msgId: string, seq: number) => Promise<void>;
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

/** 撤回后可重新编辑的时间窗口（5 分钟） */
export const RE_EDIT_WINDOW_MS = 5 * 60_000;

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
  composerInsert: null,
  highlightMsgId: null,

  setReplyingTo: (msg) => set({ replyingTo: msg }),

  setComposerInsert: (text) => set({ composerInsert: text }),

  setHighlightMsgId: (id) => set({ highlightMsgId: id }),

  seekToMessage: async (convId, msgId, seq) => {
    if (mockMode) {
      set({ highlightMsgId: msgId });
      return;
    }
    const existing = get().messagesByConv[convId] ?? [];
    const found = existing.some((m) => m.id === msgId);
    if (!found) {
      try {
        const { messages, hasMore } = await fetchMessages(convId, seq + 1, PAGE_SIZE, selfUserId());
        set((s) => ({
          messagesByConv: { ...s.messagesByConv, [convId]: messages },
          hasMoreByConv: { ...s.hasMoreByConv, [convId]: hasMore },
        }));
      } catch {
        // 拉取失败时不跳转，静默忽略
        return;
      }
    }
    set({ highlightMsgId: msgId });
  },

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

  sendText: (conversationId, text, opts) => {
    const clientMsgId = newClientMsgId();
    const quote = opts?.quote;
    const mentions = opts?.mentions;
    const msg: ChatMessage = {
      id: clientMsgId,
      conversationId,
      kind: "text",
      isSelf: true,
      text,
      quote,
      replyToId: quote?.messageId,
      mentions: mentions && mentions.length > 0 ? mentions.map((m) => m.id) : undefined,
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
      setTimeout(() => get().setStatus(conversationId, clientMsgId, "sent"), 700);
      setTimeout(() => get().setStatus(conversationId, clientMsgId, "read"), 1600);
      return clientMsgId;
    }

    dispatchSend(conversationId, text, clientMsgId, get, {
      replyToId: quote?.messageId,
      mentionIds: mentions?.map((m) => m.id),
    });
    return clientMsgId;
  },

  sendImage: async (conversationId, file) => {
    // 1. 压缩（gif 原样透传）；失败则不插入乐观消息（无法渲染无图气泡）
    let compressed: { blob: Blob; width: number; height: number };
    try {
      compressed = await compressImage(file);
    } catch {
      return;
    }
    const { blob, width, height } = compressed;

    // 2. 乐观插入：本地 blob URL 立即预览，状态 sending
    const clientMsgId = newClientMsgId();
    const localUrl = URL.createObjectURL(blob);
    const msg: ChatMessage = {
      id: clientMsgId,
      conversationId,
      kind: "image",
      isSelf: true,
      image: { width, height, localUrl },
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
      setTimeout(() => get().setStatus(conversationId, clientMsgId, "sent"), 700);
      setTimeout(() => get().setStatus(conversationId, clientMsgId, "read"), 1600);
      return;
    }

    // 3. 申请上传 URL → 直传 → WS image 帧（含对象 key），失败置 failed
    await dispatchImageSend(conversationId, blob, width, height, clientMsgId, get);
  },

  sendFile: async (conversationId, file) => {
    const clientMsgId = newClientMsgId();
    const localUrl = URL.createObjectURL(file);
    const msg: ChatMessage = {
      id: clientMsgId,
      conversationId,
      kind: "file",
      isSelf: true,
      file: { name: file.name, ...formatFileMeta(file.name, file.size), localUrl },
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
      setTimeout(() => get().setStatus(conversationId, clientMsgId, "sent"), 700);
      return;
    }

    await dispatchFileSend(conversationId, file, clientMsgId, get);
  },

  sendVoice: async (conversationId, blob, duration) => {
    const clientMsgId = newClientMsgId();
    const localUrl = URL.createObjectURL(blob);
    const msg: ChatMessage = {
      id: clientMsgId,
      conversationId,
      kind: "voice",
      isSelf: true,
      voice: { seconds: duration, wave: pseudoWave(duration), localUrl },
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
      setTimeout(() => get().setStatus(conversationId, clientMsgId, "sent"), 700);
      return;
    }

    await dispatchVoiceSend(conversationId, blob, duration, clientMsgId, get);
  },

  retrySend: (conversationId, messageId) => {
    const msg = (get().messagesByConv[conversationId] ?? []).find((m) => m.id === messageId);
    if (!msg) return;

    // 图片：从本地 blob URL 重新取回压缩后的字节，整条流程（上传+发送）重跑
    if (msg.kind === "image") {
      const localUrl = msg.image?.localUrl;
      if (!localUrl) return; // 无本地副本（如重进会话后的历史消息）无法重传
      get().setStatus(conversationId, messageId, "sending");
      if (mockMode) {
        setTimeout(() => get().setStatus(conversationId, messageId, "sent"), 700);
        return;
      }
      const clientMsgId = msg.clientMsgId ?? messageId;
      const w = msg.image?.width ?? 0;
      const h = msg.image?.height ?? 0;
      void fetch(localUrl)
        .then((r) => r.blob())
        .then((blob) => dispatchImageSend(conversationId, blob, w, h, clientMsgId, get))
        .catch(() => get().setStatus(conversationId, messageId, "failed"));
      return;
    }

    // 文件：从 localUrl 取回字节重跑上传 + 发送（File 名从 file.name 还原）
    if (msg.kind === "file") {
      const localUrl = msg.file?.localUrl;
      const fileName = msg.file?.name;
      if (!localUrl || !fileName) return;
      get().setStatus(conversationId, messageId, "sending");
      if (mockMode) {
        setTimeout(() => get().setStatus(conversationId, messageId, "sent"), 700);
        return;
      }
      const clientMsgId = msg.clientMsgId ?? messageId;
      void fetch(localUrl)
        .then((r) => r.blob())
        .then((blob) =>
          dispatchFileSend(
            conversationId,
            new File([blob], fileName, { type: blob.type }),
            clientMsgId,
            get,
          ),
        )
        .catch(() => get().setStatus(conversationId, messageId, "failed"));
      return;
    }

    // 语音：从 localUrl 取回 webm 字节重跑
    if (msg.kind === "voice") {
      const localUrl = msg.voice?.localUrl;
      const duration = msg.voice?.seconds;
      if (!localUrl || !duration) return;
      get().setStatus(conversationId, messageId, "sending");
      if (mockMode) {
        setTimeout(() => get().setStatus(conversationId, messageId, "sent"), 700);
        return;
      }
      const clientMsgId = msg.clientMsgId ?? messageId;
      void fetch(localUrl)
        .then((r) => r.blob())
        .then((blob) => dispatchVoiceSend(conversationId, blob, duration, clientMsgId, get))
        .catch(() => get().setStatus(conversationId, messageId, "failed"));
      return;
    }

    if (!msg.text) return;
    get().setStatus(conversationId, messageId, "sending");

    if (mockMode) {
      setTimeout(() => get().setStatus(conversationId, messageId, "sent"), 700);
      return;
    }

    dispatchSend(conversationId, msg.text, msg.clientMsgId ?? messageId, get, {
      replyToId: msg.replyToId,
      mentionIds: msg.mentions,
    });
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
        [convId]: (s.messagesByConv[convId] ?? []).map((m) => {
          if (m.clientMsgId !== clientMsgId) return m;
          // 已确认：本地 blob 预览到此为止（新挂载据 key 签下载渲染），
          // 撤销 object URL 释放内存并清除 localUrl，防长会话内 blob 无限堆积。
          const image = revokeLocalPreview(m.image);
          const file = revokeFileLocalUrl(m.file);
          const voice = revokeVoiceLocalUrl(m.voice);
          return {
            ...m,
            // 本地 client id 提升为服务端 message id：撤回/去重以服务端 id 为准，
            // clientMsgId 原样保留供 message.receive 自回显去重
            id: messageId,
            status: "sent" as const,
            seq,
            time: formatMessageTime(new Date(timestamp).toISOString()),
            dateKey: dateKeyOf(new Date(timestamp)),
            createdAtMs: timestamp,
            ...(image ? { image } : {}),
            ...(file ? { file } : {}),
            ...(voice ? { voice } : {}),
          };
        }),
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
          [convId]: list.map((m) => {
            if (m.id !== messageId) return m;
            const keepText = m.isSelf && m.kind === "text" && m.text ? m.text : undefined;
            return {
              ...m,
              recalled: true,
              text: undefined,
              ...(keepText ? { recalledText: keepText, recalledAtMs: Date.now() } : {}),
            };
          }),
        },
      };
    }),

  applyReaction: (convId, messageId, emoji, count, mine) =>
    set((s) => ({
      messagesByConv: {
        ...s.messagesByConv,
        [convId]: (s.messagesByConv[convId] ?? []).map((m) => {
          if (m.id !== messageId) return m;
          const prev = m.reactions ?? [];
          const existing = prev.find((r) => r.emoji === emoji);
          if (count <= 0) return { ...m, reactions: prev.filter((r) => r.emoji !== emoji) };
          const nextMine = mine === undefined ? (existing?.mine ?? false) : mine;
          const entry = { emoji, count, mine: nextMine };
          // 已存在原位替换（保持展示顺序稳定），否则追加
          return {
            ...m,
            reactions: existing
              ? prev.map((r) => (r.emoji === emoji ? entry : r))
              : [...prev, entry],
          };
        }),
      },
    })),

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

  failByClientMsgId: (clientMsgId) => {
    // 先解除 ack 超时（error 帧已是终态，避免超时重复翻 failed）
    const timer = ackTimers.get(clientMsgId);
    if (timer) {
      clearTimeout(timer);
      ackTimers.delete(clientMsgId);
    }
    set((s) => {
      for (const [convId, list] of Object.entries(s.messagesByConv)) {
        if (list.some((m) => m.clientMsgId === clientMsgId)) {
          return {
            messagesByConv: {
              ...s.messagesByConv,
              [convId]: list.map((m) =>
                m.clientMsgId === clientMsgId ? { ...m, status: "failed" as const } : m,
              ),
            },
          };
        }
      }
      return s;
    });
  },
}));

/** 经 WebSocket 发出 message.send 并挂 ack 超时（超时 → failed） */
function dispatchSend(
  conversationId: string,
  text: string,
  clientMsgId: string,
  get: () => MessageState,
  extras?: { replyToId?: string; mentionIds?: string[] },
) {
  const payload: Record<string, unknown> = {
    conversation_id: conversationId,
    content: { type: "text", text },
    client_msg_id: clientMsgId,
  };
  if (extras?.replyToId) payload.reply_to_id = extras.replyToId;
  if (extras?.mentionIds && extras.mentionIds.length > 0) payload.mentions = extras.mentionIds;
  chatSocket.send("message.send", payload);
  armAckTimeout(conversationId, clientMsgId, get);
}

/**
 * 图片发送：申请上传 URL → 直传对象存储 → 发 WS image 帧（含对象 key）→ 挂 ack 超时。
 * 上传阶段任一失败置该消息为 failed（可重试）；ack 走既有 applyAck 复用文本回执路径。
 */
async function dispatchImageSend(
  conversationId: string,
  blob: Blob,
  width: number,
  height: number,
  clientMsgId: string,
  get: () => MessageState,
) {
  let key: string;
  try {
    const ticket = await getUploadUrl(filenameForBlob(blob), blob.type, blob.size);
    await uploadToTicket(ticket, blob, blob.type);
    key = ticket.objectKey;
  } catch {
    // 消息可能在上传期间被重试重置为 sending：仅当仍是该乐观条目时翻 failed
    const pending = (get().messagesByConv[conversationId] ?? []).find(
      (m) => m.clientMsgId === clientMsgId,
    );
    if (pending) get().setStatus(conversationId, pending.id, "failed");
    return;
  }

  // 回填对象 key（乐观 → 确认的一部分）：ack 后本地副本失效时可据 key 签下载渲染
  writeBackImageKey(conversationId, clientMsgId, key);

  chatSocket.send("message.send", {
    conversation_id: conversationId,
    content: { type: "image", key, width, height, size: blob.size },
    client_msg_id: clientMsgId,
  });
  armAckTimeout(conversationId, clientMsgId, get);
}

/**
 * 撤销图片消息的本地 blob 预览并清除 localUrl。
 *
 * 确认（ack）后本地 object URL 不再需要——新挂载会据 key 签下载渲染，
 * 已挂载的 <img> 早已解码持有位图，撤销 URL 不影响其继续显示（见 MessageImage 的锁存）。
 * 返回去掉 localUrl 的新 image（引用不变的对象不复制），无 localUrl 时原样返回。
 */
function revokeLocalPreview(image: ChatMessage["image"]): ChatMessage["image"] {
  if (!image || !image.localUrl) return image;
  if (typeof URL !== "undefined" && URL.revokeObjectURL) {
    URL.revokeObjectURL(image.localUrl);
  }
  const { localUrl: _dropped, ...rest } = image;
  return rest;
}

/** 文件消息 ack 后撤销本地 blob 并清除 localUrl（与图片同路径） */
function revokeFileLocalUrl(file: ChatMessage["file"]): ChatMessage["file"] {
  if (!file || !file.localUrl) return file;
  if (typeof URL !== "undefined" && URL.revokeObjectURL) {
    URL.revokeObjectURL(file.localUrl);
  }
  const { localUrl: _dropped, ...rest } = file;
  return rest;
}

/** 语音消息 ack 后撤销本地 blob 并清除 localUrl */
function revokeVoiceLocalUrl(voice: ChatMessage["voice"]): ChatMessage["voice"] {
  if (!voice || !voice.localUrl) return voice;
  if (typeof URL !== "undefined" && URL.revokeObjectURL) {
    URL.revokeObjectURL(voice.localUrl);
  }
  const { localUrl: _dropped, ...rest } = voice;
  return rest;
}

/** 把对象 key 写回乐观图片消息（保留已有 localUrl，二者并存） */
function writeBackImageKey(conversationId: string, clientMsgId: string, key: string) {
  useMessageStore.setState((s) => ({
    messagesByConv: {
      ...s.messagesByConv,
      [conversationId]: (s.messagesByConv[conversationId] ?? []).map((m) =>
        m.clientMsgId === clientMsgId && m.image ? { ...m, image: { ...m.image, key } } : m,
      ),
    },
  }));
}

/**
 * 文件发送：申请上传 URL → 直传对象存储 → 发 WS file 帧（含对象 key + 原始文件名）。
 * 后端按扩展名白名单校验（4001 不支持类型），失败置 failed 并 toast。
 */
async function dispatchFileSend(
  conversationId: string,
  file: File | Blob,
  clientMsgId: string,
  get: () => MessageState,
) {
  const name = file instanceof File ? file.name : "file.bin";
  const contentType = file.type || "application/octet-stream";
  let key: string;
  try {
    const ticket = await getUploadUrl(name, contentType, file.size);
    await uploadToTicket(ticket, file, contentType);
    key = ticket.objectKey;
  } catch {
    const pending = (get().messagesByConv[conversationId] ?? []).find(
      (m) => m.clientMsgId === clientMsgId,
    );
    if (pending) get().setStatus(conversationId, pending.id, "failed");
    showToast("error", i18n.t("chat.file.unsupported"));
    return;
  }

  // 回填对象 key：ack 后可据 key 签下载
  useMessageStore.setState((s) => ({
    messagesByConv: {
      ...s.messagesByConv,
      [conversationId]: (s.messagesByConv[conversationId] ?? []).map((m) =>
        m.clientMsgId === clientMsgId && m.file ? { ...m, file: { ...m.file, key } } : m,
      ),
    },
  }));

  chatSocket.send("message.send", {
    conversation_id: conversationId,
    content: { type: "file", key, name, size: file.size },
    client_msg_id: clientMsgId,
  });
  armAckTimeout(conversationId, clientMsgId, get);
}

/**
 * 语音发送：直传 webm → 发 WS voice 帧（key + duration + size）。
 * 失败置 failed；ack 后 revoke localUrl（与图片/文件同路径）。
 */
async function dispatchVoiceSend(
  conversationId: string,
  blob: Blob,
  duration: number,
  clientMsgId: string,
  get: () => MessageState,
) {
  let key: string;
  try {
    const ticket = await getUploadUrl("voice.webm", "audio/webm", blob.size);
    await uploadToTicket(ticket, blob, "audio/webm");
    key = ticket.objectKey;
  } catch {
    const pending = (get().messagesByConv[conversationId] ?? []).find(
      (m) => m.clientMsgId === clientMsgId,
    );
    if (pending) get().setStatus(conversationId, pending.id, "failed");
    return;
  }

  useMessageStore.setState((s) => ({
    messagesByConv: {
      ...s.messagesByConv,
      [conversationId]: (s.messagesByConv[conversationId] ?? []).map((m) =>
        m.clientMsgId === clientMsgId && m.voice ? { ...m, voice: { ...m.voice, key } } : m,
      ),
    },
  }));

  chatSocket.send("message.send", {
    conversation_id: conversationId,
    content: { type: "voice", key, duration, size: blob.size },
    client_msg_id: clientMsgId,
  });
  armAckTimeout(conversationId, clientMsgId, get);
}

/** 挂 ack 超时定时器：ACK_TIMEOUT_MS 内未收到回执则置 failed */
function armAckTimeout(conversationId: string, clientMsgId: string, get: () => MessageState) {
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

/** 由 blob MIME 推断上传文件名（扩展名须小写字母数字，与后端 download 正则自洽） */
function filenameForBlob(blob: Blob): string {
  switch (blob.type) {
    case "image/png":
      return "img.png";
    case "image/gif":
      return "img.gif";
    case "image/webp":
      return "img.webp";
    default:
      return "img.jpg";
  }
}
