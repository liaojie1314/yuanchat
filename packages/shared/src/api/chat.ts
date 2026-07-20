/**
 * 聊天 REST API — 会话列表 / 历史消息 + 后端 DTO → 前端模型映射
 *
 * @description
 * 后端返回的是数据库风格的 snake_case DTO（seq、message_type、content JSON 字符串），
 * 此处统一转换为 UI 直接消费的 `Conversation` / `ChatMessage` 结构。
 */
import { apiGet, apiPost } from "./client";
import i18n from "@yuanchat/design-system/i18n";
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

/** Date → 本地日期键（YYYY-MM-DD），用于消息按日分组与日期分隔线 */
export function dateKeyOf(d: Date): string {
  if (isNaN(d.getTime())) return "";
  return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate());
}

/**
 * 日期分隔线文案：今天 / 昨天 / `M月D日`（今年）/ `YYYY/M/D`（跨年）
 *
 * @param dateKey - `YYYY-MM-DD` 本地日期键（由 dateKeyOf 产出）
 * @remarks 今天/昨天经 i18n（shared 层直接 `i18n.t`，不依赖 react 组件层）；
 *   月日格式沿用 formatListTime 的中文风格，跨年与其一致。
 */
export function formatDateDivider(dateKey: string): string {
  const parts = dateKey.split("-");
  if (parts.length !== 3) return dateKey;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const d = new Date(year, month - 1, day);
  if (isNaN(d.getTime())) return dateKey;

  const today = new Date();
  if (dateKey === dateKeyOf(today)) return i18n.t("chat.today");
  const yesterday = new Date(today.getTime() - 86400000);
  if (dateKey === dateKeyOf(yesterday)) return i18n.t("chat.yesterday");
  if (year === today.getFullYear()) return month + "月" + day + "日";
  return year + "/" + month + "/" + day;
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
  // status=2 表示已撤回：气泡走灰字系统占位，忽略 kind/text
  const recalled = dto.status === 2;

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
    dateKey: dateKeyOf(new Date(dto.created_at)),
    createdAtMs: new Date(dto.created_at).getTime(),
    recalled: recalled ? true : undefined,
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

/**
 * 创建群聊：选定好友作为初始成员，可选群名。
 *
 * @param name - 群名，留空时后端按成员昵称拼接默认名
 * @param memberIds - 初始成员 ID（须全部为发起者好友，1-100 人）
 * @returns 新群会话（发起者视角 DTO 过 mapConversation）
 * @throws ApiError code=400 成员非好友 / 无有效成员
 */
export async function createGroup(
  name: string | undefined,
  memberIds: string[],
): Promise<Conversation> {
  const dto = await apiPost<ConversationDTO>("/api/v1/conversations", {
    name,
    member_ids: memberIds,
  });
  return mapConversation(dto);
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

export interface ConversationMember {
  userId: string;
  nickname: string;
  avatarUrl?: string | null;
  role: 0 | 1 | 2;
}

interface MemberDTO {
  user_id: string;
  nickname: string;
  avatar_url?: string | null;
  role: number;
}

/** 群成员列表（ChatDetail 头像墙 / 成员全列表用） */
export async function fetchMembers(conversationId: string): Promise<ConversationMember[]> {
  const data = await apiGet<{ members: MemberDTO[] }>(
    "/api/v1/conversations/" + conversationId + "/members",
  );
  return (data.members || []).map((m) => ({
    userId: m.user_id,
    nickname: m.nickname,
    avatarUrl: m.avatar_url,
    role: (m.role === 1 || m.role === 2 ? m.role : 0) as 0 | 1 | 2,
  }));
}

/**
 * 撤回一条消息（仅发送者、2 分钟内有效，窗口判定由后端兜底）。
 *
 * @remarks 成功 / 幂等均返回 200；撤回后由后端广播 `message.recalled` 帧，
 *   前端不做乐观翻转，统一在收到帧时 applyRecall，保证双端一致。
 * @throws ApiError code=4031 超过撤回窗口；403 非发送者；404 消息不存在。
 */
export async function recallMessage(messageId: string): Promise<void> {
  await apiPost<Record<string, never>>("/api/v1/messages/" + messageId + "/recall", {});
}
