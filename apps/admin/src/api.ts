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

export function takedownPack(id: string) {
  return apiPost<{ taken_down: boolean }>(`/api/v1/admin/sticker-packs/${id}/takedown`, {});
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
