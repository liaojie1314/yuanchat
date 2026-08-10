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

/** 列出本人收藏的全部贴纸。 */
export async function listMyStickers(): Promise<StickerItem[]> {
  const data = await apiGet<{ stickers: StickerItem[] }>("/api/v1/stickers/mine");
  return data.stickers || [];
}

/** 列出全部表情包（当前仅官方包）。 */
export async function listStickerPacks(): Promise<StickerPackItem[]> {
  const data = await apiGet<{ packs: StickerPackItem[] }>("/api/v1/sticker-packs");
  return data.packs || [];
}
