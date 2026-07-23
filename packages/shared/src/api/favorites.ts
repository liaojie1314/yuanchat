import { apiDelete, apiGet, apiPost } from "./client";

/** 收藏条目（对应后端 model.Favorite）。 */
export interface FavoriteItem {
  id: string;
  message_id: string;
  conversation_id: string;
  conv_name: string;
  sender_nickname: string;
  /** 1=文字 2=图片 3=文件 4=语音 */
  message_type: number;
  /** JSON string，与消息 content 字段同构 */
  content: string;
  created_at: string;
}

export interface FavoriteListResponse {
  favorites: FavoriteItem[];
  has_more: boolean;
}

/** 收藏一条消息（幂等，已收藏则返回现有记录）。 */
export async function addFavorite(messageId: string): Promise<{ id: string; message_id: string }> {
  return apiPost("/api/v1/favorites", { message_id: messageId });
}

/** 取消收藏（按 message_id）。 */
export async function removeFavorite(messageId: string): Promise<void> {
  await apiDelete<{ message: string }>(`/api/v1/favorites/${messageId}`);
}

/** 分页列出收藏（倒序）。type: 0=全部 1=文字 2=图片 3=文件。 */
export async function listFavorites(params?: {
  before?: string;
  limit?: number;
  type?: number;
}): Promise<FavoriteListResponse> {
  const qs = new URLSearchParams();
  if (params?.before) qs.set("before", params.before);
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.type) qs.set("type", String(params.type));
  const q = qs.toString();
  return apiGet(`/api/v1/favorites${q ? "?" + q : ""}`);
}
