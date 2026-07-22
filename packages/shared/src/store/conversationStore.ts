/**
 * 会话状态管理 Store
 *
 * @description
 * 管理聊天会话列表的全局状态，包括：
 * - 会话列表（conversations）：所有的单聊和群聊
 * - 当前活跃会话（activeId）：用户在哪个聊天窗口中
 * - 未读计数：每个会话的未读消息数量
 * - 会话操作：加载、添加、更新、设置活跃、清理未读
 *
 * 这是 IM 应用最核心的 Store 之一，ChatPage、ConversationList、
 * ChatWindow、ChatDetail 等组件都依赖它。
 *
 * 数据来源：
 * - 真实模式：loadConversations() 拉取 REST 会话列表，
 *   WebSocket 推送经 applyIncoming / applyReadReceipt 增量更新
 * - Mock 模式：useChatBootstrap 注入 demo 数据（mocks/demoData.ts）
 *
 * @see Conversation 查看会话数据结构
 */
import { create } from "zustand";
import { fetchConversations } from "../api/chat";
import { chatSocket } from "../ws/chatSocket";

/** 用户/会话在线状态（比布尔 isOnline 更细，isOnline 保留兼容旧组件与测试） */
export type Presence = "online" | "away" | "busy" | "offline";

/**
 * 会话数据结构
 *
 * @description 单聊（private）和群聊（group）共用此结构，
 * 通过 `type` 字段区分类别。
 */
export interface Conversation {
  /** 会话唯一 ID（UUID） */
  id: string;
  /** 会话类型：单聊 / 群聊 */
  type: "private" | "group";
  /** 会话显示名称（单聊时是对方昵称，群聊时是群名） */
  name: string;
  /** 头像 URL，为 null 时显示首字母头像 */
  avatarUrl?: string | null;
  /** 最后一条消息的预览文本 */
  lastMessage?: string;
  /** 最后一条消息的时间标签 */
  lastTime?: string;
  /** 未读消息计数，0 时不显示角标 */
  unreadCount: number;
  /** 对方/群聊中是否有人在线 */
  isOnline?: boolean;
  /** 是否开启免打扰模式 */
  isMuted: boolean;
  /** 是否置顶（置顶会话在列表中单独分组靠前显示） */
  isPinned?: boolean;
  /** 单聊对方的在线状态（不设置时回退 isOnline 布尔值） */
  presence?: Presence;
  /** 未发送的草稿内容，非空时列表预览显示 [草稿] 前缀 */
  draft?: string;
  /** 最后一条消息中是否 @ 了我（列表预览高亮 [@你]） */
  mentionedMe?: boolean;
  /** 群聊成员总数 */
  memberCount?: number;
  /** 群聊当前在线人数 */
  onlineCount?: number;
  /** 群公告/置顶消息（聊天窗口顶部 pin-bar 显示） */
  pinnedMessage?: string;
  /** 会话最新消息的 seq（服务端分配，已读上报用） */
  lastSeq?: number;
  /** 我的已读进度 seq */
  myLastReadSeq?: number;
  /** 单聊对端用户 ID */
  peerId?: string;
}

interface ConversationState {
  /** 会话列表，按时间降序排列 */
  conversations: Conversation[];
  /** 当前活跃的会话 ID，为 null 时显示 "选择会话" 占位 */
  activeId: string | null;
  /** 列表加载中（首次拉取时骨架屏用） */
  loading: boolean;
  /** 从后端拉取会话列表（真实模式 bootstrap 调用） */
  loadConversations: () => Promise<void>;
  /** 设置当前活跃会话 */
  setActive: (id: string | null) => void;
  /** 添加新会话到列表顶部 */
  addConversation: (conv: Conversation) => void;
  /** 更新某个会话的部分字段 */
  updateConversation: (id: string, partial: Partial<Conversation>) => void;
  /** 收到新消息：更新预览/时间/lastSeq，非活跃会话未读 +1，会话置顶到列表首位 */
  applyIncoming: (convId: string, preview: string, time: string, seq: number) => void;
  /** 增加指定会话的未读计数（收到新消息时调用） */
  incrementUnread: (id: string) => void;
  /** 清零指定会话的未读计数并上报已读进度（用户点击进入会话时调用） */
  clearUnread: (id: string) => void;
  /** 从列表移除会话（被踢/退群/解散）；若正是活跃会话则回到未选中态 */
  removeConversation: (id: string) => void;
  /** presence 帧：按 peerId 单点更新单聊在线态 */
  applyPresence: (userId: string, online: boolean) => void;
  /** 登录/重连快照：命中集合的单聊 online，其余单聊 offline（群聊不动） */
  applyPresenceSnapshot: (onlineIds: string[]) => void;
}

/**
 * 会话 Store Hook
 *
 * @example
 * // 获取所有会话
 * const conversations = useConversationStore((s) => s.conversations);
 *
 * @example
 * // 获取并设置活跃会话
 * const { activeId, setActive } = useConversationStore();
 * setActive("uuid-123"); // 切换到指定会话
 * setActive(null);       // 取消选择
 */
export const useConversationStore = create<ConversationState>()((set, get) => ({
  conversations: [],
  activeId: null,
  loading: false,

  loadConversations: async () => {
    set({ loading: true });
    try {
      const conversations = await fetchConversations();
      set({ conversations, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  setActive: (id) => set({ activeId: id }),

  // 新会话插入到列表最前面（最近聊天排最上）
  addConversation: (conv) => set((s) => ({ conversations: [conv, ...s.conversations] })),

  // 使用 Partial<Conversation> 实现部分更新，无需传递完整对象
  updateConversation: (id, partial) =>
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, ...partial } : c)),
    })),

  removeConversation: (id) =>
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
    })),

  applyPresence: (userId, online) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.type === "private" && c.peerId === userId
          ? { ...c, presence: online ? "online" : "offline" }
          : c,
      ),
    })),

  applyPresenceSnapshot: (onlineIds) => {
    const online = new Set(onlineIds);
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.type === "private" && c.peerId
          ? { ...c, presence: online.has(c.peerId) ? "online" : "offline" }
          : c,
      ),
    }));
  },

  applyIncoming: (convId, preview, time, seq) =>
    set((s) => {
      const conv = s.conversations.find((c) => c.id === convId);
      if (!conv) return s;
      const isActive = s.activeId === convId;
      const updated: Conversation = {
        ...conv,
        lastMessage: preview,
        lastTime: time,
        lastSeq: seq,
        unreadCount: isActive ? conv.unreadCount : conv.unreadCount + 1,
      };
      // 收到消息的会话移到列表最前
      return {
        conversations: [updated, ...s.conversations.filter((c) => c.id !== convId)],
      };
    }),

  incrementUnread: (id) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, unreadCount: c.unreadCount + 1 } : c,
      ),
    })),

  clearUnread: (id) => {
    const conv = get().conversations.find((c) => c.id === id);
    // 有未读或已读进度落后时上报服务端（demo 会话无 lastSeq，自然跳过）
    if (conv && conv.lastSeq && (conv.myLastReadSeq ?? 0) < conv.lastSeq) {
      chatSocket.send("message.read", { conversation_id: id, seq: conv.lastSeq });
    }
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, unreadCount: 0, myLastReadSeq: c.lastSeq ?? c.myLastReadSeq } : c,
      ),
    }));
  },
}));
