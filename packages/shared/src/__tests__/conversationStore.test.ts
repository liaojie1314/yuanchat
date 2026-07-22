import { describe, it, expect, beforeEach } from "vitest";
import { useConversationStore } from "../store/conversationStore";

describe("conversationStore", () => {
  beforeEach(() => {
    // 重置到初始状态（含 DEMO 数据）
    useConversationStore.setState({
      activeId: null,
      conversations: [
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
      ],
    });
  });

  describe("initial state", () => {
    it("has demo conversations", () => {
      const state = useConversationStore.getState();
      expect(state.conversations.length).toBeGreaterThanOrEqual(2);
    });

    it("has null activeId initially", () => {
      const state = useConversationStore.getState();
      expect(state.activeId).toBeNull();
    });
  });

  describe("setActive", () => {
    it("sets active conversation id", () => {
      useConversationStore.getState().setActive("1");
      expect(useConversationStore.getState().activeId).toBe("1");
    });

    it("clears active conversation id with null", () => {
      useConversationStore.getState().setActive("1");
      useConversationStore.getState().setActive(null);
      expect(useConversationStore.getState().activeId).toBeNull();
    });
  });

  describe("addConversation", () => {
    it("adds a new conversation at the top of the list", () => {
      const newConv = {
        id: "new",
        type: "private" as const,
        name: "新用户",
        lastMessage: "你好",
        lastTime: "15:00",
        unreadCount: 1,
        isMuted: false,
      };
      useConversationStore.getState().addConversation(newConv);
      const state = useConversationStore.getState();
      expect(state.conversations[0].id).toBe("new");
      expect(state.conversations.length).toBe(3);
    });
  });

  describe("updateConversation", () => {
    it("updates partial fields of a conversation", () => {
      useConversationStore.getState().updateConversation("1", {
        lastMessage: "已更新",
        unreadCount: 0,
      });
      const conv = useConversationStore.getState().conversations.find((c) => c.id === "1");
      expect(conv?.lastMessage).toBe("已更新");
      expect(conv?.unreadCount).toBe(0);
      // 其他字段不变
      expect(conv?.name).toBe("张三");
    });

    it("does nothing for non-existent id", () => {
      const before = useConversationStore.getState().conversations.length;
      useConversationStore.getState().updateConversation("nonexistent", { name: "x" });
      expect(useConversationStore.getState().conversations.length).toBe(before);
    });
  });

  describe("incrementUnread", () => {
    it("increments unread count by 1", () => {
      useConversationStore.getState().incrementUnread("1");
      const conv = useConversationStore.getState().conversations.find((c) => c.id === "1");
      expect(conv?.unreadCount).toBe(4); // was 3
    });
  });

  describe("clearUnread", () => {
    it("sets unread count to 0", () => {
      useConversationStore.getState().clearUnread("1");
      const conv = useConversationStore.getState().conversations.find((c) => c.id === "1");
      expect(conv?.unreadCount).toBe(0);
    });
  });

  describe("removeConversation", () => {
    it("移除会话并清空 activeId", () => {
      useConversationStore.setState({
        conversations: [
          { id: "g1", type: "group", name: "群", unreadCount: 0, isMuted: false },
          { id: "c2", type: "private", name: "b", unreadCount: 0, isMuted: false },
        ],
        activeId: "g1",
      });
      useConversationStore.getState().removeConversation("g1");
      expect(useConversationStore.getState().conversations.map((c) => c.id)).toEqual(["c2"]);
      expect(useConversationStore.getState().activeId).toBeNull();
    });

    it("非活跃会话不影响 activeId", () => {
      useConversationStore.setState({
        conversations: [{ id: "g1", type: "group", name: "群", unreadCount: 0, isMuted: false }],
        activeId: "other",
      });
      useConversationStore.getState().removeConversation("g1");
      expect(useConversationStore.getState().activeId).toBe("other");
    });
  });

  describe("presence", () => {
    it("applyPresenceSnapshot 按 peerId 全量刷新单聊在线态", () => {
      useConversationStore.setState({
        conversations: [
          { id: "c1", type: "private", name: "a", unreadCount: 0, isMuted: false, peerId: "u1" },
          { id: "c2", type: "private", name: "b", unreadCount: 0, isMuted: false, peerId: "u2" },
          { id: "g1", type: "group", name: "g", unreadCount: 0, isMuted: false },
        ],
      });
      useConversationStore.getState().applyPresenceSnapshot(["u1"]);
      const convs = useConversationStore.getState().conversations;
      expect(convs.find((c) => c.id === "c1")!.presence).toBe("online");
      expect(convs.find((c) => c.id === "c2")!.presence).toBe("offline");
      expect(convs.find((c) => c.id === "g1")!.presence).toBeUndefined();
    });

    it("applyPresence 单点更新", () => {
      useConversationStore.setState({
        conversations: [
          {
            id: "c1",
            type: "private",
            name: "a",
            unreadCount: 0,
            isMuted: false,
            peerId: "u1",
            presence: "offline",
          },
        ],
      });
      useConversationStore.getState().applyPresence("u1", true);
      expect(useConversationStore.getState().conversations[0].presence).toBe("online");
    });
  });
});
