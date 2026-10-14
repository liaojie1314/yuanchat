import { apiGet } from "./client";

/**
 * 搜索类型筛选，与后端 handler 的 searchTypeNames 一一对应。
 *
 * 对外用名字而不是裸数字：数字是内部实现细节，写进 URL 就固化成了契约，
 * 以后插一个新类型会把客户端的 URL 全打乱。
 */
export type SearchType = "text" | "image" | "file" | "voice" | "video" | "sticker";

/** 搜索结果条目，对应后端 MessageSearchResult。 */
export interface MessageSearchResult {
  message_id: string;
  conversation_id: string;
  conv_name: string;
  sender_nickname: string;
  excerpt: string;
  created_at: string;
  seq: number;
  /** 消息类型（对应 model.MessageType），前端据此分组与选图标 */
  message_type: number;
  /** 文件/图片/视频的原始文件名；文本消息为空 */
  file_name?: string;
  /** 对象键，用于出缩略图；文本消息为空 */
  object_key?: string;
}

/** 搜索响应体。 */
export interface MessageSearchResponse {
  results: MessageSearchResult[];
  has_more: boolean;
}

/**
 * 全文搜索消息（后端 pg_trgm GIN 加速，检索正文与文件名）。
 * @param params.q 关键词，至少 3 个字符
 * @param params.conversation_id 限定会话（可选）
 * @param params.types 类型过滤；空数组与省略同义（不过滤）。未知类型后端返 400
 * @param params.before RFC3339 翻页游标（可选）
 * @param params.limit 分页大小，默认 20
 */
export async function searchMessages(params: {
  q: string;
  conversation_id?: string;
  types?: SearchType[];
  before?: string;
  limit?: number;
}): Promise<MessageSearchResponse> {
  const qs = new URLSearchParams({ q: params.q });
  if (params.conversation_id) qs.set("conversation_id", params.conversation_id);
  if (params.types?.length) qs.set("types", params.types.join(","));
  if (params.before) qs.set("before", params.before);
  if (params.limit) qs.set("limit", String(params.limit));
  return apiGet<MessageSearchResponse>("/api/v1/messages/search?" + qs.toString());
}
