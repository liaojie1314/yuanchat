import { apiDelete, apiGet, apiPatch, apiPost } from "./client";

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

/**
 * 「我的表情包」列表的一页结果（GET /sticker-packs）。
 *
 * 分页为可选：服务端在不传 limit 时返回全量且 `nextCursor` 为 null（向后兼容）；
 * 传 limit 时按 created_at 升序取一页，`nextCursor` 非空表示还有下一页。
 */
export interface StickerPackPage {
  packs: StickerPackItem[];
  nextCursor: string | null;
}

// ========================================
// 表情商城与自主发布
// ========================================

/**
 * 商城列表 / 我发布的列表共用的包摘要。
 *
 * `owner_name` 为 null 表示官方包或发布者已注销（两者由 `is_official` 区分）。
 */
export interface StickerPackSummary {
  id: string;
  name: string;
  cover_url?: string | null;
  /** 包内最早一张贴纸的对象键；封面缺失时卡片回退展示（服务端可不下发）。 */
  first_sticker_key?: string | null;
  owner_name?: string | null;
  is_official: boolean;
  sticker_count: number;
  created_at: string;
}

/** 商城列表项：包摘要 + 当前用户是否已添加（角标用）。 */
export interface MarketPackItem extends StickerPackSummary {
  added: boolean;
}

/** 「我发布的」列表项：`is_owner` 恒为 true，保留字段以与详情页形状对齐。 */
export interface MyPackItem extends StickerPackSummary {
  is_owner: boolean;
}

/** 包详情元信息。`is_owner` 相对当前请求者；服务端不下发下架状态（下架包仅对已添加者保留）。 */
export interface PackDetailInfo {
  id: string;
  name: string;
  /** 包内最早一张贴纸对象键；封面缺失时回退展示（服务端可不下发）。 */
  first_sticker_key?: string | null;
  cover_url?: string | null;
  is_official: boolean;
  owner_name?: string | null;
  is_owner: boolean;
  /** 包名命中敏感词的异步打标标记，前端暂不展示，仅透传 */
  flagged?: boolean;
  sticker_count: number;
  created_at: string;
}

/** 包详情响应：元信息 + 全部贴纸 + 当前用户是否已添加。 */
export interface PackDetail {
  pack: PackDetailInfo;
  stickers: StickerItem[];
  added: boolean;
}

/**
 * 发布 / 追加贴纸的单条来源：
 * - `collection`：从本人收藏复制，只带 `sticker_id`；
 * - `upload`：直传的新图（images/ 前缀对象 + 客户端 SHA-256）。
 */
export type StickerSourceInput =
  | { source: "collection"; sticker_id: string }
  | {
      source: "upload";
      object_key: string;
      width: number;
      height: number;
      content_hash: string;
    };

/** 发布新表情包的请求体。封面须为 sticker-covers/ 类别上传的对象键。 */
export interface PublishPackInput {
  name: string;
  cover_object_key?: string;
  cover_width?: number;
  cover_height?: number;
  sticker_sources: StickerSourceInput[];
}

/** 编辑已发布包的请求体；不修改的字段不传。 */
export interface UpdatePackInput {
  name?: string;
  cover_object_key?: string;
  cover_width?: number;
  cover_height?: number;
}

/** 商城列表的一页结果：`nextCursor` 为 null 表示没有下一页。 */
export interface MarketPackPage {
  packs: MarketPackItem[];
  nextCursor: string | null;
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
 *
 * @throws 响应里 `stickers` 不是数组时抛错。原实现是 `data.stickers || []`：
 *   响应结构损坏（服务端改字段名、网关返回错误页被当成 JSON、null）会被兜底成
 *   "你没有收藏"，与真实空列表在 UI 上完全无法区分——正是本仓已修的
 *   「空白面板对应五种现实」那类静默失败。抛错则由 EmojiPicker 渲染错误态 + 重试。
 */
export async function listMyStickers(): Promise<StickerItem[]> {
  const data = await apiGet<{ stickers: StickerItem[]; has_more?: boolean }>(
    "/api/v1/stickers/mine",
  );
  if (!Array.isArray(data.stickers)) {
    throw new Error("malformed /stickers/mine response: stickers is not an array");
  }
  if (data.has_more) {
    console.warn("[stickers] /stickers/mine 返回 has_more=true，收藏列表可能不完整");
  }
  return data.stickers;
}

/**
 * 列出「我的表情包」（官方包 + 已添加包，含各自贴纸）——全量形态。
 *
 * 等价于 {@link listStickerPacksPaged} 不带分页参数：服务端返回全量，
 * EmojiPicker 一次拿全，无需翻页。新代码如需分页请用 {@link listStickerPacksPaged}。
 *
 * @throws 响应里 `packs` 不是数组时抛错（理由同 {@link listMyStickers}）。
 */
export async function listStickerPacks(): Promise<StickerPackItem[]> {
  return (await listStickerPacksPaged()).packs;
}

/**
 * 列出「我的表情包」（官方包 + 已添加包，含各自贴纸）——分页形态。
 *
 * 分页为可选：不传 limit 时服务端返回全量（向后兼容，nextCursor 恒为 null）；
 * 传 limit 时按 created_at 升序取一页，用 nextCursor 续页直到为 null。
 *
 * @param params.cursor - 上一页响应的 `nextCursor`（RFC3339 时间戳），缺省取第一页
 * @param params.limit - 每页条数（服务端上限 50；缺省返回全量）
 * @throws 响应里 `packs` 不是数组时抛错（理由同 {@link listMyStickers}）。
 */
export async function listStickerPacksPaged(params?: {
  cursor?: string;
  limit?: number;
}): Promise<StickerPackPage> {
  const sp = new URLSearchParams();
  if (params?.cursor) sp.set("cursor", params.cursor);
  if (params?.limit) sp.set("limit", String(params.limit));
  const qs = sp.toString();
  const data = await apiGet<{ packs: StickerPackItem[]; next_cursor: string | null }>(
    "/api/v1/sticker-packs" + (qs ? "?" + qs : ""),
  );
  if (!Array.isArray(data.packs)) {
    throw new Error("malformed /sticker-packs response: packs is not an array");
  }
  return { packs: data.packs, nextCursor: data.next_cursor || null };
}

// ========================================
// 表情商城与自主发布
// ========================================

/**
 * 商城列表：公开未下架的包按发布时间倒序游标分页，附当前用户是否已添加。
 *
 * @param params.cursor - 上一页响应的 `nextCursor`（RFC3339 时间戳），缺省取第一页
 * @param params.limit - 每页条数（服务端默认 20、上限 50）
 * @throws 响应里 `packs` 不是数组时抛错（理由同 {@link listMyStickers}）
 */
export async function listMarketPacks(params?: {
  cursor?: string;
  limit?: number;
}): Promise<MarketPackPage> {
  const sp = new URLSearchParams();
  if (params?.cursor) sp.set("cursor", params.cursor);
  if (params?.limit) sp.set("limit", String(params.limit));
  const qs = sp.toString();
  const data = await apiGet<{ packs: MarketPackItem[]; next_cursor: string | null }>(
    "/api/v1/sticker-packs/market" + (qs ? "?" + qs : ""),
  );
  if (!Array.isArray(data.packs)) {
    throw new Error("malformed /sticker-packs/market response: packs is not an array");
  }
  return { packs: data.packs, nextCursor: data.next_cursor || null };
}

/**
 * 包详情（含全部贴纸与发布者；`is_owner` 相对当前请求者）。
 *
 * @throws 包不存在 / 已下架且未添加时服务端回 404，经 {@link ApiError} 透出。
 */
export async function getPackDetail(packId: string): Promise<PackDetail> {
  const data = await apiGet<PackDetail>("/api/v1/sticker-packs/" + packId);
  if (!data || typeof data.pack !== "object" || data.pack === null) {
    throw new Error("malformed /sticker-packs/:id response: pack is missing");
  }
  if (!Array.isArray(data.stickers)) {
    throw new Error("malformed /sticker-packs/:id response: stickers is not an array");
  }
  return data;
}

/** 把表情包加入「我的表情包」（幂等，重复添加不报错）。 */
export async function addStickerPack(packId: string): Promise<void> {
  await apiPost<{ message: string }>("/api/v1/sticker-packs/" + packId + "/add", {});
}

/** 把表情包移出「我的表情包」（不影响包本身）。 */
export async function removeStickerPack(packId: string): Promise<void> {
  await apiDelete<{ message: string }>("/api/v1/sticker-packs/" + packId + "/add");
}

/**
 * 发布一个公开的表情包（一步创建即公开）。
 *
 * @param input - 包名（≤64 字符）、封面（sticker-covers/ 对象键，可省略）与贴纸来源（≥1 条）
 * @returns 与包详情相同的形状（added=false、is_owner=true）
 * @throws ApiError 400：包名非法 / 来源为空；4003：每用户发布数达上限
 *   （独立业务码，前端按 code 识别）
 */
export async function publishStickerPack(input: PublishPackInput): Promise<PackDetail> {
  return apiPost<PackDetail>("/api/v1/sticker-packs", input);
}

/**
 * 编辑本人发布的包（改名 / 换封面，仅本人）。
 *
 * @returns 编辑后的包详情（贴纸列表一并返回）
 */
export async function updateStickerPack(
  packId: string,
  input: UpdatePackInput,
): Promise<PackDetail> {
  return apiPatch<PackDetail>("/api/v1/sticker-packs/" + packId, input);
}

/**
 * 给本人发布的包追加一张贴纸（仅本人）。
 *
 * @param source - 从收藏复制（collection）或直传新图（upload）
 */
export async function addStickerToPack(packId: string, source: StickerSourceInput): Promise<void> {
  await apiPost<{ message: string }>("/api/v1/sticker-packs/" + packId + "/stickers", source);
}

/**
 * 从本人发布的包移除一张贴纸（仅本人；不校验剩余张数，空包允许存在）。
 *
 * @remarks 只删包内引用，不影响原收藏（发布时是复制不是移动）。
 */
export async function removeStickerFromPack(packId: string, stickerId: string): Promise<void> {
  await apiDelete<{ message: string }>(
    "/api/v1/sticker-packs/" + packId + "/stickers/" + stickerId,
  );
}

/**
 * 列出我发布的包（无分页：发布上限 20，一页足够）。
 *
 * @throws 响应里 `packs` 不是数组时抛错（理由同 {@link listMyStickers}）。
 */
export async function listMyPacks(): Promise<MyPackItem[]> {
  const data = await apiGet<{ packs: MyPackItem[] }>("/api/v1/sticker-packs/mine");
  if (!Array.isArray(data.packs)) {
    throw new Error("malformed /sticker-packs/mine response: packs is not an array");
  }
  return data.packs;
}

/**
 * 删除本人发布的包（仅本人；级联清理包内贴纸与所有用户的添加关系）。
 *
 * @remarks 发布者主动撤回内容，已添加者的 EmojiPicker 中该包同步消失。
 */
export async function deleteStickerPack(packId: string): Promise<void> {
  await apiDelete<{ message: string }>("/api/v1/sticker-packs/" + packId);
}
