/**
 * 聊天 REST API — 会话列表 / 历史消息 + 后端 DTO → 前端模型映射
 *
 * @description
 * 后端返回的是数据库风格的 snake_case DTO（seq、message_type、content JSON 字符串），
 * 此处统一转换为 UI 直接消费的 `Conversation` / `ChatMessage` 结构。
 */
import { apiGet, apiPatch, apiPost, apiPut } from "./client";
import i18n from "@yuanchat/design-system/i18n";
import { previewBodyOf, quoteExcerptOf } from "../utils/messagePreview";
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
  /** 最后一次编辑时刻（ISO8601）；缺省/为 null 即从未编辑过 */
  edited_at?: string | null;
  /** 累计编辑次数；未编辑过为 0 */
  edit_count?: number;
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

/**
 * content JSON → 视频载荷（key/thumb_key/name/size/duration/width/height）
 *
 * @param content - 落库的 content JSON 字符串
 * @returns 解析结果；非法 JSON 时回退 0 时长 / 0 尺寸（容错口径同 parseImageContent）
 */
export function parseVideoContent(content: string): {
  key?: string;
  thumbKey?: string;
  name?: string;
  size?: number;
  duration: number;
  width: number;
  height: number;
} {
  try {
    const parsed = JSON.parse(content) as {
      key?: string;
      thumb_key?: string;
      name?: string;
      size?: number;
      duration?: number;
      width?: number;
      height?: number;
    };
    return {
      key: typeof parsed.key === "string" ? parsed.key : undefined,
      thumbKey: typeof parsed.thumb_key === "string" ? parsed.thumb_key : undefined,
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      size: typeof parsed.size === "number" ? parsed.size : undefined,
      duration: typeof parsed.duration === "number" ? parsed.duration : 0,
      width: typeof parsed.width === "number" ? parsed.width : 0,
      height: typeof parsed.height === "number" ? parsed.height : 0,
    };
  } catch {
    return { duration: 0, width: 0, height: 0 };
  }
}

/**
 * 秒 → `m:ss` 时长文案（视频时长角标、相册语音/视频行共用）
 *
 * @param totalSeconds - 时长秒数；非正/非有限值按 0 处理（元数据不可读时不显示 NaN）
 */
export function formatMediaDuration(totalSeconds: number): string {
  const safe = isFinite(totalSeconds) && totalSeconds > 0 ? Math.round(totalSeconds) : 0;
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return String(m) + ":" + (s < 10 ? "0" : "") + String(s);
}

/**
 * content JSON → 通话记录载荷（系统消息的 `call` 键）。
 *
 * @param content - 落库的 content JSON 字符串
 * @returns 通话记录；非通话系统消息（群成员变更等）与非法 JSON 均返回 undefined，
 *   调用方据此回退到 `text`（老服务端不带 `call` 键，不能因此白屏）
 */
export function parseCallContent(
  content: string,
): { media: "audio" | "video"; result: string; duration: number } | undefined {
  try {
    const parsed = JSON.parse(content) as {
      call?: { media?: string; result?: string; duration?: number };
    };
    const call = parsed.call;
    if (!call || typeof call.result !== "string") return undefined;
    return {
      media: call.media === "video" ? "video" : "audio",
      result: call.result,
      duration: typeof call.duration === "number" ? call.duration : 0,
    };
  } catch {
    return undefined;
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

/**
 * 服务端消息 DTO → UI 层 `ChatMessage`。
 *
 * @param dto - `GET /conversations/:id/messages` 返回的单条消息
 * @param selfUserId - 当前登录用户 id，用于判定气泡左右
 */
export function mapMessage(dto: MessageDTO, selfUserId: string): ChatMessage {
  const isSelf = dto.sender_id === selfUserId;
  const kindMap: Record<number, ChatMessage["kind"]> = {
    1: "text",
    2: "image",
    3: "file",
    4: "voice",
    5: "video",
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
  const isVideo = dto.message_type === 5;
  let video: ChatMessage["video"];
  if (isVideo) {
    const parsed = parseVideoContent(dto.content);
    video = {
      duration: parsed.duration,
      width: parsed.width,
      height: parsed.height,
      key: parsed.key,
      thumbKey: parsed.thumbKey,
      name: parsed.name,
      // 展示用大小文案复用文件气泡口径（仓库无 formatFileSize，size 由 formatFileMeta 产出）
      size: parsed.size != null ? formatFileMeta(parsed.name ?? "", parsed.size).size : undefined,
    };
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
    video,
    sticker: isSticker ? parseStickerContent(dto.content) : undefined,
    // 通话记录：系统消息里带 call 键时走 i18n 渲染，不带则回退 text
    call: dto.message_type === 6 ? parseCallContent(dto.content) : undefined,
    reactions: dto.reactions,
    seq: dto.seq,
    time: formatMessageTime(dto.created_at),
    dateKey: dateKeyOf(new Date(dto.created_at)),
    createdAtMs: new Date(dto.created_at).getTime(),
    recalled: recalled ? true : undefined,
    edited: !!dto.edited_at,
    editCount: dto.edit_count ?? 0,
    replyToId: dto.reply_to_id ?? undefined,
    mentions: dto.mentions ?? undefined,
    // 历史消息不区分 sent/read（read 回执只对新消息实时生效），统一视为已读
    status: isSelf ? "read" : undefined,
  };
}

/**
 * 给一页历史消息就地回填引用快照（`quote`）。
 *
 * @param messages - 同一页已映射好的消息（顺序不限，函数自建 id 索引）
 * @remarks `quote` 原先只在 `sendText` 时由前端按当时的 UI 快照填入，REST 历史
 *   路径从不产出 —— 刷新页面后引用块整体消失。这里在同一页内按 `replyToId`
 *   找原消息并现场拼快照，兑现 `ChatMessage.replyToId` 注释里承诺的「惰性拉取」。
 *
 *   只在**本页内**查找：三条 REST 路径（loadHistory / loadMore / seekToMessage）
 *   里 store 都不可能提供本页缺的原消息 —— loadHistory 仅在该会话消息为空时才发请求，
 *   loadMore / seekToMessage 拿的是更早的页而 store 里存的是更晚的消息，
 *   而引用目标必然早于引用者。原消息不在本页时保持 `undefined`，不编造内容。
 *
 *   已撤回的原消息也跳过：服务端撤回时把 content 清成 `{}`，摘要必为空串，
 *   拼出来只会是「昵称 + 一行空白」的空引用块。
 *
 *   就地改动而非返回新数组：入参是 `fetchMessages` 刚 map 出来的临时对象，
 *   尚未被任何 store 观察到，复制一遍没有收益。
 */
export function backfillQuotes(messages: ChatMessage[]): void {
  const byId: Record<string, ChatMessage> = {};
  for (let i = 0; i < messages.length; i++) byId[messages[i].id] = messages[i];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m.replyToId || m.quote) continue;
    const src = byId[m.replyToId];
    if (!src || src.recalled) continue;
    m.quote = {
      messageId: src.id,
      // sender_nickname 后端必给，兜底只为防空串渲染出无名引用
      senderName: src.senderName || (src.isSelf ? i18n.t("common.me") : ""),
      excerpt: quoteExcerptOf(src),
    };
  }
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
  backfillQuotes(messages);
  return { messages, hasMore: !!data.has_more };
}

/** 相册可筛选的媒体类型（与后端 type 白名单一一对应，非白名单值后端回 400） */
export type MediaType = "all" | "image" | "file" | "voice" | "video" | "sticker";

/** 媒体相册条目（服务端 MediaItemView 的映射；字段按消息类型填充） */
export interface MediaItem {
  messageId: string;
  seq: number;
  /** 2=image 3=file 4=voice 5=video 8=sticker（不含 text/system/e2ee） */
  messageType: 2 | 3 | 4 | 5 | 8;
  senderNickname: string;
  createdAt: string;
  key: string;
  /** 缩略图对象键，仅视频 */
  thumbKey?: string;
  /** 原始文件名，见于文件/视频 */
  name?: string;
  /** 字节数（不是展示文案），见于文件/视频/图片 */
  size?: number;
  /** 秒数，见于语音/视频 */
  duration?: number;
  /** 像素尺寸，见于图片/视频/贴纸 */
  width?: number;
  height?: number;
  /** 贴纸 ID，仅贴纸 */
  stickerId?: string;
}

interface MediaItemDTO {
  message_id: string;
  seq: number;
  message_type: number;
  sender_nickname: string;
  created_at: string;
  key: string;
  thumb_key?: string;
  name?: string;
  size?: number;
  duration?: number;
  width?: number;
  height?: number;
  sticker_id?: string;
}

/**
 * 拉取会话媒体相册（seq 降序游标分页，与 fetchMessages 同构）。
 *
 * @param conversationId - 会话 ID
 * @param type - all|image|file|voice|video|sticker（非白名单值后端 400）
 * @param beforeSeq - 0 表示最新一页；下一页传上一页的最小 seq
 * @param limit - 页大小（后端上限 100）
 * @returns 相册条目（seq 降序）与是否还有更早的数据
 * @throws ApiError 403 非会话成员 · 400 type 非法
 */
export async function fetchConversationMedia(
  conversationId: string,
  type: MediaType,
  beforeSeq: number,
  limit: number,
): Promise<{ items: MediaItem[]; hasMore: boolean }> {
  const qs = new URLSearchParams({
    type,
    before_seq: String(beforeSeq),
    limit: String(limit),
  });
  const data = await apiGet<{ items: MediaItemDTO[]; has_more: boolean }>(
    "/api/v1/conversations/" + conversationId + "/media?" + qs.toString(),
  );
  const items = (data.items || []).map((dto) => ({
    messageId: dto.message_id,
    seq: dto.seq,
    messageType: dto.message_type as MediaItem["messageType"],
    senderNickname: dto.sender_nickname,
    createdAt: dto.created_at,
    key: dto.key,
    thumbKey: dto.thumb_key,
    name: dto.name,
    size: dto.size,
    duration: dto.duration,
    width: dto.width,
    height: dto.height,
    stickerId: dto.sticker_id,
  }));
  return { items, hasMore: !!data.has_more };
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

/** 消息编辑历史的一个版本 */
export interface EditVersion {
  /** 版本号，从 1 起，升序 */
  version: number;
  text: string;
  /**
   * 该版本被替换的时刻（ISO8601），**不是该版本被写下的时刻**。
   *
   * @remarks `message_edits` 每行记录的是"这段旧文本什么时候被替换掉"，
   *   因此首版的这个值等于第二版的生效时刻 —— 一条只编辑过 1 次的消息，
   *   version 1 与 version 2 的 `editedAt` 完全相同。按「编辑于 xx」逐版本
   *   渲染时首版时间会看着不对，需要 UI 侧特殊处理。
   *   另外时区表示随端点而异（PATCH 直出 UTC、本端点带 +08:00 偏移），
   *   比较一律先 `new Date(s).getTime()`，禁止对字符串做大小/相等比较。
   */
  editedAt: string;
  /** 当前生效版本（仅末项为 true） */
  current?: boolean;
}

/**
 * 编辑一条文本消息（仅发送者、5 分钟内、累计不超 20 次，窗口判定由后端兜底）。
 *
 * @param messageId - 服务端消息 id（乐观消息的 clientMsgId 会 404）
 * @param text - 编辑后正文，非空且不超 4000 字
 * @returns 服务端的最后编辑时刻与累计编辑次数
 * @remarks 前端不做乐观翻转：后端广播 `message.edited` 帧后统一在 applyEdited
 *   更新，保证双端一致（同 recallMessage 的姿态）。
 * @throws ApiError code=4032 超过编辑窗口；code=4033 编辑次数超限；
 *   code=4004 类型不可编辑 / 内容未变化 / 内容为空 / 超长；403 非发送者；404 消息不存在。
 */
export async function editMessage(
  messageId: string,
  text: string,
): Promise<{ editedAt: string; editCount: number }> {
  const data = await apiPatch<{ edited_at: string; edit_count: number }>(
    "/api/v1/messages/" + messageId,
    { text },
  );
  return { editedAt: data.edited_at, editCount: data.edit_count };
}

/**
 * 取一条消息的编辑历史（version 升序，末项为当前版本）。
 *
 * @param messageId - 服务端消息 id
 * @throws ApiError 403 非会话成员；404 消息不存在或在本人清空水位以下。
 */
export async function fetchMessageEdits(messageId: string): Promise<EditVersion[]> {
  const data = await apiGet<{
    versions: Array<{ version: number; text: string; edited_at: string; current?: boolean }>;
  }>("/api/v1/messages/" + messageId + "/edits");
  const out: EditVersion[] = [];
  const versions = data.versions || [];
  for (let i = 0; i < versions.length; i++) {
    const v = versions[i];
    out.push({ version: v.version, text: v.text, editedAt: v.edited_at, current: v.current });
  }
  return out;
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
