/**
 * 聊天 REST API — 会话列表 / 历史消息 + 后端 DTO → 前端模型映射
 *
 * @description
 * 后端返回的是数据库风格的 snake_case DTO（seq、message_type、content JSON 字符串），
 * 此处统一转换为 UI 直接消费的 `Conversation` / `ChatMessage` 结构。
 */
import { apiGet, apiPost, apiPut } from "./client";
import i18n from "@yuanchat/design-system/i18n";
import { previewBodyOf } from "../utils/messagePreview";
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
  /** 正文：仅文本/系统消息有值，其余类型为空串（文案由 preview_kind 在前端本地化） */
  preview: string;
  /** 消息类型标记：text/system/image/file/voice/video/sticker/encrypted/unknown */
  preview_kind?: string;
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
  is_pinned?: boolean;
  pinned_at?: string | null;
  mention_unread?: boolean;
  last_seq: number;
  my_last_read_seq: number;
  last_message?: LastMessageDTO;
  peer?: PeerDTO;
  updated_at: string;
  /** 群公告（管理员编辑，空串/null 表示未设置或已清除） */
  announcement?: string | null;
  /** 公告最近一次更新时间（RFC3339），用于横幅未读态比对 */
  announcement_updated_at?: string;
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
  mentions?: string[] | null;
  client_msg_id?: string | null;
  created_at: string;
  sender_nickname: string;
  sender_avatar_url?: string | null;
  /** 表情回应聚合（mine 相对请求者） */
  reactions?: { emoji: string; count: number; mine: boolean }[];
}

// ========================================
// 时间格式化
// ========================================

/** 当前界面语言，交给 Intl 做日期本地化；i18n 未就绪时回落浏览器语言 */
function uiLocale(): string {
  return (
    i18n.language || (typeof navigator !== "undefined" ? navigator.language : undefined) || "zh-CN"
  );
}

/** 本地零点时间戳，用于按「日」比较（跨月跨年安全） */
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 相差整日数：0 今天，1 昨天，负数为未来（时钟偏差） */
function dayDiff(from: Date, to: Date): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / 86400000);
}

/** 星期简称：周六 / Sat / 土 / 토 */
function weekdayShort(d: Date): string {
  if (typeof Intl === "undefined") return monthDay(d);
  return new Intl.DateTimeFormat(uiLocale(), { weekday: "short" }).format(d);
}

/** 月日：8月22日 / Aug 22 / 8月22日 / 8월 22일 */
function monthDay(d: Date): string {
  if (typeof Intl === "undefined") return d.getMonth() + 1 + "/" + d.getDate();
  return new Intl.DateTimeFormat(uiLocale(), { month: "short", day: "numeric" }).format(d);
}

/** 完整日期：2026/8/22 / 8/22/2026 / 2026/8/22 / 2026. 8. 22. */
function fullDate(d: Date): string {
  if (typeof Intl === "undefined") {
    return d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate();
  }
  return new Intl.DateTimeFormat(uiLocale(), {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(d);
}

/**
 * 会话列表时间标签，按 IM 惯例分档
 *
 * @param iso - 消息时间（ISO 字符串）
 * @returns 今天 → `HH:mm`；昨天 → 「昨天」；一周内 → 星期简称；
 *   今年 → 月日；更早 → 完整日期。非法时间返回空串。
 * @remarks 昨天走 i18n，月日/星期/完整日期走 Intl，四语言都不写死中文格式。
 */
export function formatListTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const days = dayDiff(d, now);
  // 未来时间（客户端时钟偏差）当今天处理，不显示「星期」
  if (days <= 0) return two(d.getHours()) + ":" + two(d.getMinutes());
  if (days === 1) return i18n.t("chat.yesterday");
  if (days < 7) return weekdayShort(d);
  if (d.getFullYear() === now.getFullYear()) return monthDay(d);
  return fullDate(d);
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
 * 日期分隔线文案：今天 / 昨天 / 月日（今年）/ 完整日期（跨年）
 *
 * @param dateKey - `YYYY-MM-DD` 本地日期键（由 dateKeyOf 产出）
 * @remarks 今天/昨天经 i18n（shared 层直接 `i18n.t`，不依赖 react 组件层）；
 *   月日与完整日期走 Intl，与 formatListTime 同源。
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
  if (year === today.getFullYear()) return monthDay(d);
  return fullDate(d);
}

// ========================================
// DTO → 前端模型映射
// ========================================

export function mapConversation(dto: ConversationDTO): Conversation {
  // 非文本类消息的占位文案由前端按当前语言产出，与 WS 实时路径同源（见 previewBodyOf）
  const body = dto.last_message
    ? previewBodyOf(dto.last_message.preview_kind, dto.last_message.preview)
    : undefined;
  const preview =
    dto.last_message && body !== undefined
      ? dto.type === 2 && dto.last_message.preview_kind !== "system"
        ? dto.last_message.sender_nickname + ": " + body
        : body
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
    isPinned: dto.is_pinned ?? false,
    pinnedAt: dto.pinned_at ?? undefined,
    mentionUnread: dto.mention_unread ?? false,
    memberCount: dto.member_count,
    lastSeq: dto.last_seq,
    myLastReadSeq: dto.my_last_read_seq,
    peerId: dto.peer ? dto.peer.id : undefined,
    // 空串与 null 统一映射为 undefined（未设置/已清除同义），与 conversationUpdatePatch 对称
    announcement: dto.announcement || undefined,
    announcementUpdatedAt: dto.announcement_updated_at,
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

/** content JSON 字符串 → 图片载荷（key + 宽高）；非法 JSON 时返回 0 尺寸占位 */
export function parseImageContent(content: string): {
  key?: string;
  width: number;
  height: number;
} {
  try {
    const parsed = JSON.parse(content) as { key?: string; width?: number; height?: number };
    return {
      key: typeof parsed.key === "string" ? parsed.key : undefined,
      width: typeof parsed.width === "number" ? parsed.width : 0,
      height: typeof parsed.height === "number" ? parsed.height : 0,
    };
  } catch {
    return { width: 0, height: 0 };
  }
}

/** 字节数 → 可读大小文案（B/KB/MB，1 位小数） */
function humanSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/** 文件名 + 字节数 → 气泡展示元数据（扩展名大写，无扩展名回退 FILE） */
export function formatFileMeta(name: string, bytes: number): { size: string; ext: string } {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase() : "FILE";
  return { size: humanSize(bytes), ext };
}

/** content JSON → 文件载荷；非法 JSON 回退空名 */
export function parseFileContent(content: string): { key?: string; name: string; size: number } {
  try {
    const p = JSON.parse(content) as { key?: string; name?: string; size?: number };
    return {
      key: typeof p.key === "string" ? p.key : undefined,
      name: typeof p.name === "string" ? p.name : "",
      size: typeof p.size === "number" ? p.size : 0,
    };
  } catch {
    return { name: "", size: 0 };
  }
}

/** content JSON → 语音载荷；非法 JSON 回退 0 时长 */
export function parseVoiceContent(content: string): { key?: string; duration: number } {
  try {
    const p = JSON.parse(content) as { key?: string; duration?: number };
    return {
      key: typeof p.key === "string" ? p.key : undefined,
      duration: typeof p.duration === "number" ? p.duration : 0,
    };
  } catch {
    return { duration: 0 };
  }
}

/** content JSON → 贴纸载荷（sticker_id + key + 宽高） */
export function parseStickerContent(content: string): {
  stickerId?: string;
  key?: string;
  width: number;
  height: number;
} {
  try {
    const parsed = JSON.parse(content) as {
      sticker_id?: string;
      key?: string;
      width?: number;
      height?: number;
    };
    return {
      stickerId: typeof parsed.sticker_id === "string" ? parsed.sticker_id : undefined,
      key: typeof parsed.key === "string" ? parsed.key : undefined,
      width: typeof parsed.width === "number" ? parsed.width : 0,
      height: typeof parsed.height === "number" ? parsed.height : 0,
    };
  } catch {
    return { width: 0, height: 0 };
  }
}

/** duration 为种子生成固定伪波形（12-20 根，高度 6-18px 确定性伪随机） */
export function pseudoWave(duration: number): number[] {
  const bars = Math.min(20, Math.max(12, duration + 8));
  const wave: number[] = [];
  for (let i = 0; i < bars; i++) {
    wave.push(6 + ((i * 7 + duration * 13) % 13));
  }
  return wave;
}

export function mapMessage(dto: MessageDTO, selfUserId: string): ChatMessage {
  const isSelf = dto.sender_id === selfUserId;
  const kindMap: Record<number, ChatMessage["kind"]> = {
    1: "text",
    2: "image",
    3: "file",
    4: "voice",
    6: "system",
    8: "sticker",
  };

  // status=2 表示已撤回：气泡走灰字系统占位，忽略 kind/text
  const recalled = dto.status === 2;
  const isImage = dto.message_type === 2;
  const isFile = dto.message_type === 3;
  let file: ChatMessage["file"];
  if (isFile) {
    const parsed = parseFileContent(dto.content);
    file = { name: parsed.name, ...formatFileMeta(parsed.name, parsed.size), key: parsed.key };
  }
  const isVoice = dto.message_type === 4;
  let voice: ChatMessage["voice"];
  if (isVoice) {
    const parsed = parseVoiceContent(dto.content);
    voice = { seconds: parsed.duration, wave: pseudoWave(parsed.duration), key: parsed.key };
  }
  const isSticker = dto.message_type === 8;
  // E2EE 密文（type 7）：本设备不保存历史明文，且双棘轮状态早已推进，
  // 拿到旧密文也无法就地重新解密（强行调 decryptFrom 还会污染当前会话棘轮状态）。
  // 原实现 kindMap 缺 7 → kind 回退 "text"，而 text 只在 type 1|6 赋值 →
  // 加密单聊刷新后整段历史变空气泡，连"这是加密消息"都看不出来。
  const isEncrypted = dto.message_type === 7;

  return {
    id: dto.id,
    conversationId: dto.conversation_id,
    kind: kindMap[dto.message_type] || "text",
    isSelf,
    senderName: dto.sender_nickname,
    senderId: dto.sender_id,
    text: isEncrypted
      ? i18n.t("e2ee.historyNotStored")
      : dto.message_type === 1 || dto.message_type === 6
        ? parseTextContent(dto.content)
        : undefined,
    // 历史图片：解析 key + 宽高，渲染时按 key 签下载 URL（无 localUrl）
    image: isImage ? parseImageContent(dto.content) : undefined,
    file,
    voice,
    sticker: isSticker ? parseStickerContent(dto.content) : undefined,
    reactions: dto.reactions,
    seq: dto.seq,
    time: formatMessageTime(dto.created_at),
    dateKey: dateKeyOf(new Date(dto.created_at)),
    createdAtMs: new Date(dto.created_at).getTime(),
    recalled: recalled ? true : undefined,
    replyToId: dto.reply_to_id ?? undefined,
    mentions: dto.mentions ?? undefined,
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
  /** 群内昵称（未设置/已清除时字段整个消失，非 null 非空串） */
  alias?: string;
}

interface MemberDTO {
  user_id: string;
  nickname: string;
  avatar_url?: string | null;
  role: number;
  /** 群内昵称，未设置/已清除时后端不下发该字段（或为 null） */
  alias?: string | null;
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
    alias: m.alias ?? undefined,
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

/** 切换自己对消息的某个 emoji 回应（结果由 message.reaction 帧驱动，不乐观更新） */
export async function toggleReaction(messageId: string, emoji: string): Promise<void> {
  await apiPost<{ emoji: string; count: number; reacted: boolean }>(
    "/api/v1/messages/" + messageId + "/reactions",
    { emoji },
  );
}

/** 转发结果条目：目标会话 + 新消息 ID + 序列号 */
export interface ForwardResult {
  conversationId: string;
  messageId: string;
  seq: number;
}

/**
 * 转发消息到多个会话（最多 9 个）。
 *
 * @remarks 每个目标会话都独立触发 message.receive 帧（转发消息与用户直接发送同构，
 *   不做特殊标记；转发感由前端"从右键菜单进入"的交互隐式表达）。
 */
export async function forwardMessage(
  messageId: string,
  conversationIds: string[],
): Promise<ForwardResult[]> {
  const data = await apiPost<{
    results: { conversation_id: string; message_id: string; seq: number }[];
  }>("/api/v1/messages/" + messageId + "/forward", { conversation_ids: conversationIds });
  return (data.results || []).map((r) => ({
    conversationId: r.conversation_id,
    messageId: r.message_id,
    seq: r.seq,
  }));
}

/** 会话个人设置（置顶/免打扰）响应 */
export interface ConversationSettingsDTO {
  is_pinned: boolean;
  pinned_at?: string | null;
  is_muted: boolean;
}

/** 更新本人会话设置（置顶/免打扰，member 维度） */
export async function updateConversationSettings(
  convId: string,
  body: { is_pinned?: boolean; is_muted?: boolean },
): Promise<ConversationSettingsDTO> {
  return apiPut<ConversationSettingsDTO>("/api/v1/conversations/" + convId + "/settings", body);
}

/** conversation.updated 帧 → store patch（纯函数，供 wireSocket 与单测复用） */
export function conversationUpdatePatch(p: {
  conversation_id: string;
  name?: string;
  member_count?: number;
  is_pinned?: boolean;
  pinned_at?: string | null;
  is_muted?: boolean;
  /** 公告变更帧中恒存在（空串=清除）；群改名/邀请等其他帧完全不含该键 */
  announcement?: string | null;
  announcement_updated_at?: string;
}): Partial<Conversation> {
  const patch: Partial<Conversation> = {};
  if (p.name) patch.name = p.name;
  if (p.member_count) patch.memberCount = p.member_count;
  if (p.is_pinned !== undefined) {
    patch.isPinned = p.is_pinned;
    patch.pinnedAt = p.pinned_at ?? undefined;
  }
  if (p.is_muted !== undefined) patch.isMuted = p.is_muted;
  if (p.announcement !== undefined) {
    // 空串 = 清除（后端约定）：映射为本地 undefined，与"未设置"同义
    patch.announcement = p.announcement || undefined;
    patch.announcementUpdatedAt = p.announcement_updated_at;
  }
  return patch;
}
