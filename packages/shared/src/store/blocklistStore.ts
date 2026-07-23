/**
 * 黑名单状态管理 Store
 *
 * @description
 * 管理黑名单列表 + 拉黑/解除操作（乐观更新 + 失败回滚）：
 * - items：黑名单条目（后端已 join 用户资料，按拉黑时间倒序）
 * - block()：拉黑后把目标追加到本地列表（若目标资料未知则重拉列表）
 * - unblock()：乐观移除，失败回滚
 *
 * 数据来源：BlocklistPage 进入时 fetch()；操作走 REST（无 WS 帧，
 * 拉黑纯个人视角数据，无需实时推送对方）。
 */
import { create } from "zustand";
import { blockUser, listBlocked, unblockUser } from "../api/contacts";
import type { BlockedUser } from "../api/contacts";

interface BlocklistState {
  items: BlockedUser[];
  /** 列表加载中（骨架屏用） */
  loading: boolean;

  /** 拉取黑名单列表 */
  fetch: () => Promise<void>;
  /** 拉黑：REST 成功后重拉列表（新条目带完整用户资料） */
  block: (targetId: string) => Promise<void>;
  /** 解除拉黑：乐观移除，失败回滚 */
  unblock: (targetId: string) => Promise<void>;
}

export const useBlocklistStore = create<BlocklistState>()((set, get) => ({
  items: [],
  loading: false,

  fetch: async () => {
    set({ loading: true });
    try {
      const items = await listBlocked();
      set({ items, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  block: async (targetId) => {
    await blockUser(targetId);
    // 服务端为真源：重拉一次拿到 join 后的完整条目
    await get().fetch();
  },

  unblock: async (targetId) => {
    const prev = get().items;
    set({ items: prev.filter((it) => it.targetId !== targetId) });
    try {
      await unblockUser(targetId);
    } catch (err) {
      set({ items: prev });
      throw err;
    }
  },
}));
