/**
 * 聊天 REST API — 会话列表 / 历史消息 + 后端 DTO → 前端模型映射
 *
 * @description
 * 后端返回的是数据库风格的 snake_case DTO（seq、message_type、content JSON 字符串），
 * 此处统一转换为 UI 直接消费的 `Conversation` / `ChatMessage` 结构。
 */
import { apiGet } from "./client";
import type { Conversation } from "../store/conversationStore";
import type { ChatMessage } from "../store/messageStore";

// ========================================
// 后端 DTO（与 server/internal/service 的 JSON 结构一致）
// ========================================

interface PeerDTO {
  id: string;
  nickname: string;
  avatar_url?: string | null;
}

interface LastMessageDTO {
  preview: string;
  sender_nickname: string;
  created_at: string;
}

export interface ConversationDTO {
  id: string;
  /** 1=单聊 2=群聊 3=系统 */
  type: number;
  name: string;
  avatar_url?: string | null;
  member_count: number;
  unread_count: number;
  is_muted: boolean;
  last_seq: number;
  my_last_read_seq: number;
  last_message?: LastMessageDTO;
  peer?: PeerDTO;
  updated_at: string;
}

export interface MessageDTO {
  id: string;
  conversation_id: string;
  sender_id: string;
  seq: number;
  message_type: number;
  /** JSON 字符串，如 {"text":"..."} */
  content: string;
  status: number;
  reply_to_id?: string | null;
  client_msg_id?: string | null;
  created_at: string;
  sender_nickname: string;
  sender_avatar_url?: string | null;
}

// ========================================
// 时间格式化
// ========================================

/** 会话列表时间标签：今天 → HH:mm，今年 → M月D日，更早 → YYYY/M/D */
export function formatListTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return two(d.getHours()) + ":" + two(d.getMinutes());
  }
  if (d.getFullYear() === today.getFullYear()) {
    return d.getMonth() + 1 + "月" + d.getDate() + "日";
  }
  return d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate();
}

/** 气泡时间标签：HH:mm */
export function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return two(d.getHours()) + ":" + two(d.getMinutes());
}

function two(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

// ========================================
// DTO → 前端模型映射
// ========================================

export function mapConversation(dto: ConversationDTO): Conversation {
  const preview = dto.last_message
    ? dto.type === 2
      ? dto.last_message.sender_nickname + ": " + dto.last_message.preview
      : dto.last_message.preview
    : undefined;

  return {
    id: dto.id,
    type: dto.type === 2 ? "group" : "private",
    name: dto.name,
    avatarUrl: dto.avatar_url,
    lastMessage: preview,
    lastTime: dto.last_message ? formatListTime(dto.last_message.created_at) : "",
    unreadCount: dto.unread_count,
    isMuted: dto.is_muted,
    memberCount: dto.member_count,
    lastSeq: dto.last_seq,
    myLastReadSeq: dto.my_last_read_seq,
    peerId: dto.peer ? dto.peer.id : undefined,
  };
}

/** content JSON 字符串 → 文本（非法 JSON 时原样返回兜底） */
export function parseTextContent(content: string): string {
  try {
    const parsed = JSON.parse(content) as { text?: string };
    return typeof parsed.text === "string" ? parsed.text : "";
  } catch {
    return content;
  }
}

export function mapMessage(dto: MessageDTO, selfUserId: string): ChatMessage {
  const isSelf = dto.sender_id === selfUserId;
  const kindMap: Record<number, ChatMessage["kind"]> = {
    1: "text",
    2: "image",
    3: "file",
    4: "voice",
    6: "system",
  };

  return {
    id: dto.id,
    conversationId: dto.conversation_id,
    kind: kindMap[dto.message_type] || "text",
    isSelf,
    senderName: dto.sender_nickname,
    text:
      dto.message_type === 1 || dto.message_type === 6 ? parseTextContent(dto.content) : undefined,
    seq: dto.seq,
    time: formatMessageTime(dto.created_at),
    // 历史消息不区分 sent/read（read 回执只对新消息实时生效），统一视为已读
    status: isSelf ? "read" : undefined,
  };
}

// ========================================
// API 调用
// ========================================

export async function fetchConversations(): Promise<Conversation[]> {
  const data = await apiGet<{ conversations: ConversationDTO[] }>("/api/v1/conversations");
  return (data.conversations || []).map(mapConversation);
}

export async function fetchMessages(
  conversationId: string,
  beforeSeq: number,
  limit: number,
  selfUserId: string,
): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
  const data = await apiGet<{ messages: MessageDTO[]; has_more: boolean }>(
    "/api/v1/conversations/" +
      conversationId +
      "/messages?before_seq=" +
      beforeSeq +
      "&limit=" +
      limit,
  );
  // 后端返回 seq 降序，前端消息流按时间升序展示
  const messages = (data.messages || []).map((m) => mapMessage(m, selfUserId)).reverse();
  return { messages, hasMore: !!data.has_more };
}
