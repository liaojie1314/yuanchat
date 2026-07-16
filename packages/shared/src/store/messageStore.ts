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
 * 还承载引用回复（replyTo）、表情回应（reactions）、@提及、
 * 撤回（recalled 转为系统消息文案）等 UI 所需的全部字段。
 *
 * 目前使用 DEMO 数据模拟，后续接入 WebSocket 后由服务端推送驱动。
 */
import { create } from "zustand";

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

/** 聊天消息（UI 层结构，与后端 Message 实体分离，接入 API 时做映射） */
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
  status?: ChatMessageStatus;
  edited?: boolean;
}

interface MessageState {
  /** 会话 ID → 消息列表（时间升序） */
  messagesByConv: Record<string, ChatMessage[]>;
  /** 正在输入中的联系人名（会话 ID → 名字，null 表示无人输入） */
  typingByConv: Record<string, string | undefined>;
  /** 正在引用回复的消息（composer 上方的引用条） */
  replyingTo: ChatMessage | null;
  setReplyingTo: (msg: ChatMessage | null) => void;
  /** 发送一条文本消息，返回消息 ID；内部模拟 送达→已读 流转 */
  sendText: (conversationId: string, text: string, quote?: QuoteRef) => string;
  /** 更新消息状态（重试 / WebSocket 回执） */
  setStatus: (conversationId: string, messageId: string, status: ChatMessageStatus) => void;
}

/** 简易自增 ID，接入后端后由服务端派发 */
let nextId = 1000;

const now = () =>
  new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

/** 产品研发群的演示消息流（覆盖全部气泡形态，与原型一致） */
const DEMO_MESSAGES: Record<string, ChatMessage[]> = {
  "1": [
    {
      id: "m0",
      conversationId: "1",
      kind: "system",
      isSelf: false,
      text: "会话加密已开启 🔒",
      time: "09:00",
    },
    {
      id: "m1",
      conversationId: "1",
      kind: "text",
      isSelf: false,
      senderName: "张伟",
      text: "早上好各位，今天的 @全体成员 同步一下发布准备情况",
      mentions: ["@全体成员"],
      time: "09:02",
    },
    {
      id: "m2",
      conversationId: "1",
      kind: "image",
      isSelf: false,
      senderName: "李四",
      image: { width: 220, height: 140 },
      time: "09:15",
    },
    {
      id: "m3",
      conversationId: "1",
      kind: "text",
      isSelf: true,
      text: "看起来不错！发布看板我已经更新到最新，大家可以对照检查各自模块。",
      time: "09:18",
      status: "read",
    },
    {
      id: "m4",
      conversationId: "1",
      kind: "voice",
      isSelf: false,
      senderName: "王芳",
      voice: { seconds: 12, wave: [6, 12, 18, 9, 14, 20, 8, 12, 16, 6] },
      time: "09:24",
    },
    {
      id: "m5",
      conversationId: "1",
      kind: "file",
      isSelf: true,
      file: { name: "发布评审_v3.pdf", size: "3.2 MB", ext: "PDF" },
      time: "09:26",
      status: "sent",
    },
    {
      id: "m6",
      conversationId: "1",
      kind: "text",
      isSelf: false,
      senderName: "陈曦",
      text: "收到，我这边接口联调今天能完成。@你 发布评审改到明早 9 点方便吗？",
      mentions: ["@你"],
      quote: { senderName: "我", excerpt: "发布看板我已经更新到最新…" },
      reactions: [
        { emoji: "👍", count: 2, mine: true },
        { emoji: "🎉", count: 1 },
      ],
      time: "14:32",
      edited: true,
    },
    {
      id: "m7",
      conversationId: "1",
      kind: "text",
      isSelf: true,
      text: "没问题，我改一下日程。",
      time: "14:33",
      status: "failed",
    },
    {
      id: "m8",
      conversationId: "1",
      kind: "system",
      isSelf: false,
      text: "陈曦 撤回了一条消息",
      time: "14:34",
    },
  ],
  "3": [
    {
      id: "m30",
      conversationId: "3",
      kind: "text",
      isSelf: false,
      senderName: "张伟",
      text: "你好，明天的会议准备得怎么样了？",
      time: "12:40",
    },
    {
      id: "m31",
      conversationId: "3",
      kind: "text",
      isSelf: true,
      text: "已经准备差不多了，PPT 还在完善",
      time: "12:44",
      status: "read",
    },
    {
      id: "m32",
      conversationId: "3",
      kind: "text",
      isSelf: false,
      senderName: "张伟",
      text: "好的，那就这么定了，辛苦！",
      time: "12:48",
    },
  ],
};

export const useMessageStore = create<MessageState>()((set, get) => ({
  messagesByConv: DEMO_MESSAGES,
  typingByConv: { "1": "陈曦" },
  replyingTo: null,

  setReplyingTo: (msg) => set({ replyingTo: msg }),

  sendText: (conversationId, text, quote) => {
    const id = `m${nextId++}`;
    const msg: ChatMessage = {
      id,
      conversationId,
      kind: "text",
      isSelf: true,
      text,
      quote,
      time: now(),
      status: "sending",
    };
    set((s) => ({
      messagesByConv: {
        ...s.messagesByConv,
        [conversationId]: [...(s.messagesByConv[conversationId] ?? []), msg],
      },
      replyingTo: null,
    }));
    // 模拟 发送中 → 已送达 → 已读 的回执流转，接入 WebSocket 后删除
    setTimeout(() => get().setStatus(conversationId, id, "sent"), 700);
    setTimeout(() => get().setStatus(conversationId, id, "read"), 1600);
    return id;
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
