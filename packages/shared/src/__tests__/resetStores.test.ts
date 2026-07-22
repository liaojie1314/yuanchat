/**
 * resetChatStores 单元测试：登出时 revoke 本地 blob 并清空聊天相关 store。
 */
import { describe, it, expect, vi } from "vitest";
import { resetChatStores } from "../store/resetStores";
import { useMessageStore } from "../store/messageStore";
import { useConversationStore } from "../store/conversationStore";
import { useContactStore } from "../store/contactStore";

describe("resetChatStores", () => {
  it("revoke 所有 localUrl 并清空三个 store", () => {
    const revoke = vi.fn();
    vi.stubGlobal("URL", { ...URL, revokeObjectURL: revoke });
    useMessageStore.setState({
      messagesByConv: {
        c1: [
          {
            id: "m1",
            conversationId: "c1",
            kind: "image",
            isSelf: true,
            time: "10:00",
            image: { width: 1, height: 1, localUrl: "blob:x" },
          },
        ],
      },
    });
    useConversationStore.setState({
      conversations: [{ id: "c1", type: "private", name: "x", unreadCount: 0, isMuted: false }],
      activeId: "c1",
    });
    useContactStore.setState({ friends: [], requests: [] });
    resetChatStores();
    expect(revoke).toHaveBeenCalledWith("blob:x");
    expect(useMessageStore.getState().messagesByConv).toEqual({});
    expect(useConversationStore.getState().conversations).toEqual([]);
    expect(useConversationStore.getState().activeId).toBeNull();
    vi.unstubAllGlobals();
  });
});
