/**
 * 好友在线状态 Store
 *
 * @description
 * 以用户 ID 集合维护好友在线态（区别于 conversationStore.presence 的
 * "会话视角"字段）：通讯录列表 / 好友详情等非会话场景直接按 userId 查询。
 *
 * 数据来源与会话在线态同源：
 * - 登录/重连快照 `GET /presence` → applySnapshot
 * - WS `presence` 帧 → applyPresence 增量更新
 */
import { create } from "zustand";

interface PresenceState {
  /** 当前在线的好友用户 ID */
  onlineIds: string[];

  /** 登录/重连快照：整体替换在线集合 */
  applySnapshot: (onlineIds: string[]) => void;
  /** presence 帧：单点上线/下线 */
  applyPresence: (userId: string, online: boolean) => void;
  /** 指定用户当前是否在线 */
  isOnline: (userId: string) => boolean;
}

export const usePresenceStore = create<PresenceState>()((set, get) => ({
  onlineIds: [],

  applySnapshot: (onlineIds) => set({ onlineIds: Array.from(new Set(onlineIds)) }),

  applyPresence: (userId, online) =>
    set((s) => {
      const has = s.onlineIds.includes(userId);
      if (online === has) return s;
      return {
        onlineIds: online ? [...s.onlineIds, userId] : s.onlineIds.filter((id) => id !== userId),
      };
    }),

  isOnline: (userId) => get().onlineIds.includes(userId),
}));
