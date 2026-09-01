/**
 * Admin REST API — /api/v1/admin/* 端点封装
 *
 * 写操作复用 shared 的 apiPost/apiDelete（自动带 token、统一信封解析）。
 * 分页列表用本地 pagedGet：后端 Paginated 把 total/page/size 放信封顶层，
 * shared apiGet 只返回 data 字段会丢分页信息。
 */
import { apiPost, apiDelete, API_BASE, getAccessToken, ApiError } from "@yuanchat/shared";

export interface AdminUser {
  id: string;
  phone?: string;
  email?: string;
  short_id: number;
  nickname: string;
  avatar_url?: string;
  status: number; // 1=正常 2=封禁
  role: number; // 0=普通 1=admin
  created_at: string;
  last_login_at?: string;
}

export interface AdminConversation {
  id: string;
  type: number; // 1=单聊 2=群聊
  name: string;
  member_count: number;
  created_at: string;
}

export interface AdminMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_nickname: string;
  message_type: number; // 1=text 2=image 3=file 4=voice 8=sticker
  content: string; // JSONB 原文（文本消息为 {"text":"..."}）
  seq: number;
  created_at: string;
}

export interface AuditLog {
  id: string;
  actor_id: string;
  actor_nickname: string;
  action: string;
  target_type: string;
  target_id: string;
  detail: string;
  created_at: string;
}

export interface Page<T> {
  list: T[];
  total: number;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
};

/** 分页 GET：解析完整信封（data + total 顶层平级）。 */
async function pagedGet<T>(path: string): Promise<Page<T>> {
  const token = getAccessToken();
  const res = await fetch(API_BASE + path, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const json = (await res.json()) as {
    code: number;
    message: string;
    data: T[] | null;
    total: number;
  };
  if (json.code !== 0) {
    throw new ApiError(json.code, json.message || "Request failed");
  }
  return { list: json.data ?? [], total: json.total };
}

export function listUsers(q: string, page: number, size = 20) {
  return pagedGet<AdminUser>(`/api/v1/admin/users${qs({ q, page, size })}`);
}

export function banUser(id: string) {
  return apiPost<{ banned: boolean; kicked_connections: number }>(
    `/api/v1/admin/users/${id}/ban`,
    {},
  );
}

export function unbanUser(id: string) {
  return apiDelete<{ banned: boolean }>(`/api/v1/admin/users/${id}/ban`);
}

export function listConversations(q: string, type: number, page: number, size = 20) {
  return pagedGet<AdminConversation>(
    `/api/v1/admin/conversations${qs({ q, type: type || undefined, page, size })}`,
  );
}

export function dissolveConversation(id: string) {
  return apiPost<{ dissolved: boolean; notified_members: number }>(
    `/api/v1/admin/conversations/${id}/dissolve`,
    {},
  );
}

export function listMessages(q: string, page: number, size = 20) {
  return pagedGet<AdminMessage>(`/api/v1/admin/messages${qs({ q, page, size })}`);
}

export function listFlaggedMessages(page: number, size = 20) {
  return pagedGet<AdminMessage>(`/api/v1/admin/messages${qs({ flagged: "true", page, size })}`);
}

export function deleteMessage(id: string) {
  return apiDelete<{ deleted: boolean }>(`/api/v1/admin/messages/${id}`);
}

export function clearMessageFlag(id: string) {
  return apiDelete<{ flagged: boolean }>(`/api/v1/admin/messages/${id}/flag`);
}

export interface AdminStickerPack {
  id: string;
  name: string;
  cover_url: string | null;
  is_official: boolean;
  flagged: boolean;
  taken_down: boolean;
  owner_name: string | null;
  sticker_count: number;
  created_at: string;
}

export function listFlaggedPacks(page: number, size = 20) {
  return pagedGet<AdminStickerPack>(
    `/api/v1/admin/sticker-packs${qs({ flagged: "true", page, size })}`,
  );
}

/** 全量检索表情包（q 为包名模糊匹配，空串列出最新；不含 flagged 过滤） */
export function listStickerPacks(q: string, page: number, size = 20) {
  return pagedGet<AdminStickerPack>(`/api/v1/admin/sticker-packs${qs({ q, page, size })}`);
}

export function takedownPack(id: string) {
  return apiPost<{ taken_down: boolean }>(`/api/v1/admin/sticker-packs/${id}/takedown`, {});
}

/** 恢复表情包上架（清 taken_down，商城重新展示） */
export function untakedownPack(id: string) {
  return apiPost<{ taken_down: boolean }>(`/api/v1/admin/sticker-packs/${id}/untakedown`, {});
}

/** 切换表情包官方标识（显式目标布尔，避免并发下 toggle 歧义） */
export function setPackOfficial(id: string, isOfficial: boolean) {
  return apiPost<{ is_official: boolean }>(`/api/v1/admin/sticker-packs/${id}/official`, {
    is_official: isOfficial,
  });
}

export function clearPackFlag(id: string) {
  return apiDelete<{ flagged: boolean }>(`/api/v1/admin/sticker-packs/${id}/flag`);
}

export interface AdminReport {
  id: string;
  reporter_id: string;
  reporter_nickname: string;
  target_type: string; // message | user
  target_id: string;
  reason: string;
  status: number; // 0=待处理 1=已保留 2=已删除
  created_at: string;
}

export function listReports(status: number, page: number, size = 20) {
  return pagedGet<AdminReport>(`/api/v1/admin/reports${qs({ status, page, size })}`);
}

export function handleReport(id: string, action: "keep" | "delete") {
  return apiPost<{ handled: boolean }>(`/api/v1/admin/reports/${id}/handle`, { action });
}

export function listAuditLogs(action: string, page: number, size = 20) {
  return pagedGet<AuditLog>(`/api/v1/admin/audit-logs${qs({ action, page, size })}`);
}

/** 消息媒体预签名响应（管理端专用读通道） */
export interface MessageMedia {
  url: string;
  expires_in: number;
  message_type: number;
  object_key: string;
  file_name?: string;
  width?: number;
  height?: number;
  duration?: number;
}

/**
 * 获取消息媒体的短期预签名下载 URL。
 * 走 /admin/messages/:id/media 专用通道，不依赖举报人上下文。
 */
export function getMessageMedia(id: string) {
  return pagedGetSingle<MessageMedia>(`/api/v1/admin/messages/${id}/media`);
}

/** 单对象 GET：解析完整信封（data 为对象而非数组）。 */
async function pagedGetSingle<T>(path: string): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(API_BASE + path, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const json = (await res.json()) as { code: number; message: string; data: T | null };
  if (json.code !== 0) {
    throw new ApiError(json.code, json.message || "Request failed");
  }
  return json.data as T;
}

/** UGC 敏感词命中记录（昵称 / bio / 群名 / 群公告审核队列） */
export interface FlaggedUGC {
  id: string;
  ugc_type: string; // nickname | bio | group_name | announcement
  content: string;
  hit_word: string;
  user_id?: string;
  conversation_id?: string;
  handled_at?: string;
  created_at: string;
}

/** 分页检索 UGC 敏感词命中记录（handled: false=待处理 true=已处置 all=全部） */
export function listFlaggedUGC(handled: "false" | "true" | "all", page: number, size = 20) {
  return pagedGet<FlaggedUGC>(`/api/v1/admin/flagged-ugc${qs({ handled, page, size })}`);
}

/** 强制重置命中的 UGC：昵称重置为默认昵称，bio / 群名 / 公告清空 */
export function resetFlaggedUGC(id: string) {
  return apiPost<{ reset: boolean }>(`/api/v1/admin/flagged-ugc/${id}/reset`, {});
}

/** 放行命中的 UGC（内容维持原样，记录关闭） */
export function dismissFlaggedUGC(id: string) {
  return apiDelete<{ dismissed: boolean }>(`/api/v1/admin/flagged-ugc/${id}`);
}

/** 概览用户维度计数 */
export interface AdminUserStats {
  total: number;
  banned: number;
  new_today: number;
  new_week: number;
}

/** 概览消息维度计数 */
export interface AdminMessageStats {
  total: number;
  today: number;
  by_type: Record<string, number>;
}

/** 概览治理队列积压计数 */
export interface AdminModerationStats {
  pending_reports: number;
  flagged_messages: number;
  pending_ugc: number;
  taken_down_packs: number;
  flagged_packs: number;
}

/** 概览增长侧写计数（好友申请 / 验证码下发，今日与近 7 天） */
export interface AdminGrowthStats {
  friend_requests_today: number;
  friend_requests_week: number;
  otp_today: number;
  otp_week: number;
}

/** 管理端运营概览聚合指标（GET /admin/stats 响应体） */
export interface AdminStats {
  users: AdminUserStats;
  conversations: { total: number };
  messages: AdminMessageStats;
  moderation: AdminModerationStats;
  growth: AdminGrowthStats;
  runtime: { online_connections: number };
}

/** 拉取运营概览聚合指标（只读快照） */
export function getStats() {
  return pagedGetSingle<AdminStats>("/api/v1/admin/stats");
}

/** 管理端推送订阅视图（附所属用户昵称） */
export interface AdminPushSubscription {
  id: string;
  user_id: string;
  endpoint: string;
  created_at: string;
  user_nickname?: string | null;
}

/** 分页列出推送订阅（最新在前） */
export function listPushSubscriptions(page: number, size = 10) {
  return pagedGet<AdminPushSubscription>(`/api/v1/admin/push-subscriptions${qs({ page, size })}`);
}
