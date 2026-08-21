import { apiDelete, apiGet, apiPost } from "./client";

/** 单张贴纸（用户收藏或表情包内） */
export interface StickerItem {
  id: string;
  object_key: string;
  width: number;
  height: number;
}

/** 表情包元信息 */
export interface StickerPackInfo {
  id: string;
  name: string;
  cover_url?: string | null;
  is_official: boolean;
  sort: number;
}

/** 表情包 + 其贴纸列表 */
export interface StickerPackItem {
  pack: StickerPackInfo;
  stickers: StickerItem[];
}

/** 收藏一张贴纸（object_key 须来自已上传的 images/ 对象；content_hash 为客户端 SHA-256）。 */
export async function addSticker(
  objectKey: string,
  width: number,
  height: number,
  contentHash: string,
): Promise<StickerItem> {
  return apiPost<StickerItem>("/api/v1/stickers", {
    object_key: objectKey,
    width,
    height,
    content_hash: contentHash,
  });
}

/** 取消收藏。 */
export async function removeSticker(id: string): Promise<void> {
  await apiDelete<{ message: string }>("/api/v1/stickers/" + id);
}

/**
 * 列出本人收藏的贴纸。
 *
 * 服务端一页即可返回一个用户可能拥有的全部收藏（页大小 == 收藏上限），
 * 故这里不翻页。`has_more` 为真意味着服务端放宽了收藏上限而前端未跟上——
 * 那会静默少显示几张，因此显式告警而不是无声吞掉。
 */
export async function listMyStickers(): Promise<StickerItem[]> {
  const data = await apiGet<{ stickers: StickerItem[]; has_more?: boolean }>(
    "/api/v1/stickers/mine",
  );
  if (data.has_more) {
    console.warn("[stickers] /stickers/mine 返回 has_more=true，收藏列表可能不完整");
  }
  return data.stickers || [];
}

/** 列出全部表情包（当前仅官方包）。 */
export async function listStickerPacks(): Promise<StickerPackItem[]> {
  const data = await apiGet<{ packs: StickerPackItem[] }>("/api/v1/sticker-packs");
  return data.packs || [];
}
