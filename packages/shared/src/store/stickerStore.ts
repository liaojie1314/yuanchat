/**
 * 贴纸状态管理 Store
 *
 * @description
 * 管理用户收藏的贴纸（favorites）+ 官方表情包（official packs），
 * 提供 SHA-256 哈希去重、上传、删除、本地缓存能力。
 *
 * 数据来源：REST API /api/v1/stickers
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** 贴纸条目（收藏夹 / 表情包内的单个贴纸） */
export interface Sticker {
  /** 贴纸 ID（UUID） */
  id: string;
  /** 对象存储 key（签名下载 URL 时用） */
  key: string;
  /** 像素宽度 */
  width: number;
  /** 像素高度 */
  height: number;
  /** 内容哈希（SHA-256 hex，用于客户端上传前去重） */
  contentHash: string;
}

/** 官方表情包 */
export interface StickerPack {
  /** 表情包 ID（UUID） */
  id: string;
  /** 表情包名称（多语言 key，前端按 i18n 展示） */
  name: string;
  /** 包内贴纸列表 */
  stickers: Sticker[];
}

/** 贴纸 API 响应 DTO（与后端 handler DTO 保持一致） */
interface StickerDTO {
  id: string;
  key: string;
  width: number;
  height: number;
  content_hash: string;
}

interface StickerPackDTO {
  id: string;
  name: string;
  stickers: StickerDTO[];
}

interface ListStickersResponse {
  favorites: StickerDTO[];
  official_packs: StickerPackDTO[];
}

interface AddStickerResponse {
  sticker: StickerDTO;
}

/** DTO → 前端模型映射 */
function mapSticker(dto: StickerDTO): Sticker {
  return {
    id: dto.id,
    key: dto.key,
    width: dto.width,
    height: dto.height,
    contentHash: dto.content_hash,
  };
}

function mapStickerPack(dto: StickerPackDTO): StickerPack {
  return {
    id: dto.id,
    name: dto.name,
    stickers: dto.stickers.map(mapSticker),
  };
}

interface StickerState {
  /** 用户收藏的贴纸（按添加时间倒序） */
  favorites: Sticker[];
  /** 官方表情包列表 */
  officialPacks: StickerPack[];
  /** 加载状态 */
  loaded: boolean;
  /** 从后端拉取全部贴纸数据（收藏 + 官方包） */
  fetchStickers: () => Promise<void>;
  /**
   * 添加贴纸到收藏：先算 SHA-256 hash，调后端接口（去重逻辑在后端）。
   * 返回添加后的贴纸 ID。
   */
  addSticker: (file: File) => Promise<string>;
  /** 从收藏中删除贴纸 */
  removeSticker: (stickerId: string) => Promise<void>;
  /** 清空本地缓存（登出时调用） */
  clear: () => void;
}

/**
 * 计算文件内容的 SHA-256 哈希（浏览器原生 crypto.subtle）。
 * @returns hex 字符串（64 字符）
 */
async function computeHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const useStickerStore = create<StickerState>()(
  persist(
    (set, get) => ({
      favorites: [],
      officialPacks: [],
      loaded: false,

      fetchStickers: async () => {
        try {
          const { apiGet } = await import("../api/client");
          const data = await apiGet<ListStickersResponse>("/api/v1/stickers");
          set({
            favorites: (data.favorites || []).map(mapSticker),
            officialPacks: (data.official_packs || []).map(mapStickerPack),
            loaded: true,
          });
        } catch (err) {
          console.error("[stickerStore] fetchStickers failed:", err);
          throw err;
        }
      },

      addSticker: async (file: File) => {
        // 1. 计算哈希
        const hash = await computeHash(file);

        // 2. 检查本地是否已存在（避免无谓请求）
        const existing = get().favorites.find((s) => s.contentHash === hash);
        if (existing) {
          return existing.id;
        }

        // 3. 调后端接口：申请上传 ticket + 直传 + 后端插入记录（去重在后端）
        const { apiPost } = await import("../api/client");
        const { getUploadUrl, uploadToTicket } = await import("../api/files");

        const ticket = await getUploadUrl("sticker", file.name);
        await uploadToTicket(ticket.upload_url, file);

        const resp = await apiPost<AddStickerResponse>("/api/v1/stickers", {
          key: ticket.key,
          content_hash: hash,
        });

        const newSticker = mapSticker(resp.sticker);

        // 4. 插入本地收藏列表头部（后端已返回完整 DTO）
        set((state) => ({
          favorites: [newSticker, ...state.favorites],
        }));

        return newSticker.id;
      },

      removeSticker: async (stickerId: string) => {
        const { apiDelete } = await import("../api/client");
        await apiDelete(`/api/v1/stickers/${stickerId}`);

        set((state) => ({
          favorites: state.favorites.filter((s) => s.id !== stickerId),
        }));
      },

      clear: () => {
        set({ favorites: [], officialPacks: [], loaded: false });
      },
    }),
    {
      name: "yuanchat-stickers",
      partialize: (state) => ({
        favorites: state.favorites,
        officialPacks: state.officialPacks,
        loaded: state.loaded,
      }),
    },
  ),
);
