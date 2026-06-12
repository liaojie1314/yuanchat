import { create } from "zustand";

export interface Conversation {
  id: string;
  type: "private" | "group";
  name: string;
  avatarUrl?: string | null;
  lastMessage?: string;
  lastTime?: string;
  unreadCount: number;
  isOnline?: boolean;
  isMuted: boolean;
}

interface ConversationState {
  conversations: Conversation[];
  activeId: string | null;
  setActive: (id: string | null) => void;
  addConversation: (conv: Conversation) => void;
  updateConversation: (id: string, partial: Partial<Conversation>) => void;
  incrementUnread: (id: string) => void;
  clearUnread: (id: string) => void;
}

// 模拟数据
const DEMO_CONVERSATIONS: Conversation[] = [
  {
    id: "1",
    type: "private",
    name: "张三",
    lastMessage: "好的，明天开会讨论一下",
    lastTime: "14:32",
    unreadCount: 3,
    isOnline: true,
    isMuted: false,
  },
  {
    id: "2",
    type: "group",
    name: "产品研发群",
    lastMessage: "李四: 新版本已经发布了",
    lastTime: "13:15",
    unreadCount: 0,
    isMuted: true,
  },
  {
    id: "3",
    type: "private",
    name: "王五",
    lastMessage: "文件收到了吗？",
    lastTime: "昨天",
    unreadCount: 1,
    isOnline: false,
    isMuted: false,
  },
];

export const useConversationStore = create<ConversationState>()((set) => ({
  conversations: DEMO_CONVERSATIONS,
  activeId: null,
  setActive: (id) => set({ activeId: id }),
  addConversation: (conv) =>
    set((s) => ({ conversations: [conv, ...s.conversations] })),
  updateConversation: (id, partial) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, ...partial } : c,
      ),
    })),
  incrementUnread: (id) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, unreadCount: c.unreadCount + 1 } : c,
      ),
    })),
  clearUnread: (id) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, unreadCount: 0 } : c,
      ),
    })),
}));
