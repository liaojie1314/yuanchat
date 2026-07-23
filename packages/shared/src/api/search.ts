import { apiGet } from "./client";

/** 搜索结果条目，对应后端 MessageSearchResult。 */
export interface MessageSearchResult {
  message_id: string;
  conversation_id: string;
  conv_name: string;
  sender_nickname: string;
  excerpt: string;
  created_at: string;
  seq: number;
}

/** 搜索响应体。 */
export interface MessageSearchResponse {
  results: MessageSearchResult[];
  has_more: boolean;
}

/**
 * 全文搜索消息（后端 pg_trgm GIN 加速）。
 * @param params.q 关键词，至少 3 个字符
 * @param params.conversation_id 限定会话（可选）
 * @param params.before RFC3339 翻页游标（可选）
 * @param params.limit 分页大小，默认 20
 */
export async function searchMessages(params: {
  q: string;
  conversation_id?: string;
  before?: string;
  limit?: number;
}): Promise<MessageSearchResponse> {
  const qs = new URLSearchParams({ q: params.q });
  if (params.conversation_id) qs.set("conversation_id", params.conversation_id);
  if (params.before) qs.set("before", params.before);
  if (params.limit) qs.set("limit", String(params.limit));
  return apiGet<MessageSearchResponse>("/api/v1/messages/search?" + qs.toString());
}
