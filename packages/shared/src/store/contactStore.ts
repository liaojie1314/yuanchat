/**
 * 联系人状态管理 Store
 *
 * @description
 * 管理好友列表与好友申请的全局状态：
 * - friends：好友列表（字母分组由 groupFriends selector 派生）
 * - requests：申请列表（收到 + 发出）
 * - pendingInCount：待我处理的申请数（"新的朋友"角标）
 *
 * 数据来源：
 * - 真实模式：loadFriends() / loadRequests() 拉 REST；
 *   WS `contact.request` / `contact.accepted` 帧经 applyIncomingRequest /
 *   applyAccepted 增量更新（useChatBootstrap 接线）
 * - Mock 模式：useChatBootstrap 注入 demo 数据
 *
 * accept 成功后把返回的 conversation_id 通过 conversationStore.loadConversations()
 * 带入会话列表（新会话含打招呼消息）。
 */
import { create } from "zustand";
import { pinyin } from "pinyin-pro";
import {
  acceptFriendRequest,
  deleteFriend as deleteFriendApi,
  fetchFriends,
  listFriendRequests,
  rejectFriendRequest,
  sendFriendRequest,
} from "../api/contacts";
import type { ContactUser, Friend, FriendRequestItem } from "../api/contacts";
import { useConversationStore } from "./conversationStore";

// ========================================
// 字母分组
// ========================================

/** 昵称 → 索引字母：A-Z（中文取拼音首字母），其余归 "#" */
export function indexLetterOf(name: string): string {
  const first = (name || "").trim().charAt(0);
  if (!first) return "#";
  if (/[a-zA-Z]/.test(first)) return first.toUpperCase();
  if (/[一-龥]/.test(first)) {
    const py = pinyin(first, { pattern: "first", toneType: "none" });
    const letter = (py || "").charAt(0).toUpperCase();
    return /[A-Z]/.test(letter) ? letter : "#";
  }
  return "#";
}

export interface FriendGroup {
  letter: string;
  friends: Friend[];
}

/** 好友列表 → 按索引字母分组排序（A-Z 在前，# 殿后） */
export function groupFriends(friends: Friend[]): FriendGroup[] {
  const byLetter = new Map<string, Friend[]>();
  for (const f of friends) {
    const letter = indexLetterOf(f.nickname);
    const list = byLetter.get(letter);
    if (list) {
      list.push(f);
    } else {
      byLetter.set(letter, [f]);
    }
  }
  const letters = Array.from(byLetter.keys()).sort((a, b) => {
    if (a === "#") return 1;
    if (b === "#") return -1;
    return a.localeCompare(b);
  });
  return letters.map((letter) => ({
    letter,
    friends: byLetter
      .get(letter)!
      .slice()
      .sort((a, b) => a.nickname.localeCompare(b.nickname, "zh-Hans-CN")),
  }));
}

// ========================================
// Store
// ========================================

interface ContactState {
  friends: Friend[];
  requests: FriendRequestItem[];
  /** 好友列表加载中（骨架屏用） */
  loading: boolean;
  /** 待我处理的申请数（角标） */
  pendingInCount: () => number;

  /** 拉取好友列表 */
  loadFriends: () => Promise<void>;
  /** 拉取申请列表 */
  loadRequests: () => Promise<void>;
  /** 发起好友申请（成功后由调用方刷新申请列表） */
  sendRequest: (targetId: string, message: string) => Promise<void>;
  /** 同意申请：建好友+会话，返回会话 ID（跳转聊天用） */
  accept: (requestId: string) => Promise<string>;
  /** 拒绝申请 */
  reject: (requestId: string) => Promise<void>;
  /** WS contact.request：收到新申请（插入/更新 + 角标随 pendingInCount 派生） */
  applyIncomingRequest: (item: FriendRequestItem) => void;
  /** WS contact.accepted：我发出的申请被同意（好友列表加人 + 出向申请翻状态） */
  applyAccepted: (requestId: string, friend: ContactUser, conversationId: string) => void;
  /**
   * 本地移除好友 + 关联单聊会话（幂等）。
   * WS friend.removed 帧与 deleteFriend 成功后共用。
   */
  removeFriend: (friendId: string) => void;
  /** 删除好友：REST 调用成功后本地清理（对方端由 WS 帧驱动） */
  deleteFriend: (friendId: string) => Promise<void>;
}

export const useContactStore = create<ContactState>()((set, get) => ({
  friends: [],
  requests: [],
  loading: false,

  pendingInCount: () => get().requests.filter((r) => r.direction === "in" && r.status === 0).length,

  loadFriends: async () => {
    set({ loading: true });
    try {
      const friends = await fetchFriends();
      set({ friends, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  loadRequests: async () => {
    try {
      const requests = await listFriendRequests();
      set({ requests });
    } catch {
      // 列表拉取失败保留现状（登录兜底 / 下次进入通讯录重试）
    }
  },

  sendRequest: async (targetId, message) => {
    await sendFriendRequest(targetId, message);
    await get().loadRequests();
  },

  accept: async (requestId) => {
    const conversationId = await acceptFriendRequest(requestId);
    // 本地立即翻状态（服务端已落库）
    set((s) => ({
      requests: s.requests.map((r) => (r.id === requestId ? { ...r, status: 1 as const } : r)),
    }));
    // 新好友 + 新会话（含打招呼消息）
    await Promise.all([get().loadFriends(), useConversationStore.getState().loadConversations()]);
    return conversationId;
  },

  reject: async (requestId) => {
    await rejectFriendRequest(requestId);
    set((s) => ({
      requests: s.requests.map((r) => (r.id === requestId ? { ...r, status: 2 as const } : r)),
    }));
  },

  applyIncomingRequest: (item) =>
    set((s) => {
      // 同一申请重复推送/重新申请：更新旧行并置顶
      const rest = s.requests.filter((r) => r.id !== item.id);
      return { requests: [item, ...rest] };
    }),

  applyAccepted: (requestId, friend, conversationId) => {
    set((s) => {
      const requests = s.requests.map((r) =>
        r.id === requestId ? { ...r, status: 1 as const } : r,
      );
      const exists = s.friends.some((f) => f.id === friend.id);
      const friends = exists ? s.friends : [...s.friends, { ...friend, conversationId }];
      return { requests, friends };
    });
    // 新会话（含打招呼消息）进入会话列表
    void useConversationStore.getState().loadConversations();
  },

  removeFriend: (friendId) => {
    const target = get().friends.find((f) => f.id === friendId);
    if (!target) return;
    set((s) => ({ friends: s.friends.filter((f) => f.id !== friendId) }));
    // 关联单聊会话同步移出列表（历史消息服务端保留，重新加好友可恢复）
    if (target.conversationId) {
      useConversationStore.getState().removeConversation(target.conversationId);
    }
  },

  deleteFriend: async (friendId) => {
    await deleteFriendApi(friendId);
    get().removeFriend(friendId);
  },
}));
