/**
 * 会话状态管理 Store
 *
 * @description
 * 管理聊天会话列表的全局状态，包括：
 * - 会话列表（conversations）：所有的单聊和群聊
 * - 当前活跃会话（activeId）：用户在哪个聊天窗口中
 * - 未读计数：每个会话的未读消息数量
 * - 会话操作：添加、更新、设置活跃、清理未读
 *
 * 这是 IM 应用最核心的 Store 之一，ChatPage、ConversationList、
 * ChatWindow、ChatDetail 等组件都依赖它。
 *
 * 目前使用 DEMO 数据模拟，后续会接入 WebSocket 实时更新。
 *
 * @see Conversation 查看会话数据结构
 */
import { create } from "zustand";

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
}

interface ConversationState {
  /** 会话列表，按时间降序排列 */
  conversations: Conversation[];
  /** 当前活跃的会话 ID，为 null 时显示 "选择会话" 占位 */
  activeId: string | null;
  /** 设置当前活跃会话 */
  setActive: (id: string | null) => void;
  /** 添加新会话到列表顶部 */
  addConversation: (conv: Conversation) => void;
  /** 更新某个会话的部分字段 */
  updateConversation: (id: string, partial: Partial<Conversation>) => void;
  /** 增加指定会话的未读计数（收到新消息时调用） */
  incrementUnread: (id: string) => void;
  /** 清零指定会话的未读计数（用户点击进入会话时调用） */
  clearUnread: (id: string) => void;
}

/** 开发阶段使用的模拟会话数据 */
const DEMO_CONVERSATIONS: Conversation[] = [
  {
    id: "1",
    type: "group",
    name: "产品研发群",
    lastMessage: "陈曦：发布评审改到明早 9 点",
    lastTime: "14:32",
    unreadCount: 3,
    isMuted: false,
    isPinned: true,
    mentionedMe: true,
    memberCount: 28,
    onlineCount: 5,
    pinnedMessage: "周五 15:00 发布评审，请提前更新进度看板",
  },
  {
    id: "2",
    type: "private",
    name: "李四",
    lastMessage: "[图片] 这是设计稿的第二版",
    lastTime: "13:05",
    unreadCount: 0,
    isOnline: true,
    presence: "away",
    isMuted: true,
    isPinned: true,
  },
  {
    id: "3",
    type: "private",
    name: "张伟",
    lastMessage: "好的，那就这么定了，辛苦！",
    lastTime: "12:48",
    unreadCount: 1,
    isOnline: true,
    presence: "online",
    isMuted: false,
  },
  {
    id: "4",
    type: "group",
    name: "设计组",
    lastMessage: "图标规范我下午整理一份",
    lastTime: "昨天",
    unreadCount: 0,
    isMuted: false,
    draft: "图标规范我下午整理一份",
    memberCount: 9,
  },
  {
    id: "5",
    type: "private",
    name: "王芳",
    lastMessage: "[语音] 0'15\"",
    lastTime: "周三",
    unreadCount: 0,
    isOnline: false,
    presence: "offline",
    isMuted: false,
  },
  {
    id: "6",
    type: "private",
    name: "元聊助手",
    lastMessage: "🤖 已为你总结 3 条未读消息",
    lastTime: "06-30",
    unreadCount: 0,
    isMuted: false,
  },
];

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
export const useConversationStore = create<ConversationState>()((set) => ({
  conversations: DEMO_CONVERSATIONS,
  activeId: null,

  setActive: (id) => set({ activeId: id }),

  // 新会话插入到列表最前面（最近聊天排最上）
  addConversation: (conv) => set((s) => ({ conversations: [conv, ...s.conversations] })),

  // 使用 Partial<Conversation> 实现部分更新，无需传递完整对象
  updateConversation: (id, partial) =>
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, ...partial } : c)),
    })),

  incrementUnread: (id) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, unreadCount: c.unreadCount + 1 } : c,
      ),
    })),

  clearUnread: (id) =>
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)),
    })),
}));
