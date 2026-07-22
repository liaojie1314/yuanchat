/**
 * blocklistStore 单元测试
 *
 * 覆盖：unblock 乐观移除 + 失败回滚；fetch 装载；
 * removeFriend（contactStore）幂等移除 + 关联会话清理。
 * block 走 REST 后重拉列表，在 E2E 验证，此处仅回滚路径。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useBlocklistStore } from "../store/blocklistStore";
import { useContactStore } from "../store/contactStore";
import { useConversationStore } from "../store/conversationStore";
import type { BlockedUser } from "../api/contacts";

vi.mock("../api/contacts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../api/contacts")>();
  return {
    ...mod,
    listBlocked: vi.fn(),
    blockUser: vi.fn(),
    unblockUser: vi.fn(),
    deleteFriend: vi.fn(),
  };
});

import { listBlocked, unblockUser, deleteFriend } from "../api/contacts";

const blocked = (targetId: string, nickname: string): BlockedUser => ({
  targetId,
  nickname,
  avatarUrl: null,
  shortId: 100,
  createdAt: 1753150000000,
});

beforeEach(() => {
  vi.clearAllMocks();
  useBlocklistStore.setState({ items: [], loading: false });
  useContactStore.setState({ friends: [], requests: [], loading: false });
  useConversationStore.setState({ conversations: [], activeId: null, loading: false });
});

describe("blocklistStore", () => {
  it("fetch loads items", async () => {
    vi.mocked(listBlocked).mockResolvedValue([blocked("u1", "Bob"), blocked("u2", "Carol")]);
    await useBlocklistStore.getState().fetch();
    expect(useBlocklistStore.getState().items).toHaveLength(2);
    expect(useBlocklistStore.getState().loading).toBe(false);
  });

  it("fetch failure keeps previous items and clears loading", async () => {
    useBlocklistStore.setState({ items: [blocked("u1", "Bob")] });
    vi.mocked(listBlocked).mockRejectedValue(new Error("net"));
    await useBlocklistStore.getState().fetch();
    expect(useBlocklistStore.getState().items).toHaveLength(1);
    expect(useBlocklistStore.getState().loading).toBe(false);
  });

  it("unblock removes optimistically", async () => {
    useBlocklistStore.setState({ items: [blocked("u1", "Bob"), blocked("u2", "Carol")] });
    vi.mocked(unblockUser).mockResolvedValue(undefined);

    await useBlocklistStore.getState().unblock("u1");

    expect(useBlocklistStore.getState().items.map((i) => i.targetId)).toEqual(["u2"]);
    expect(unblockUser).toHaveBeenCalledWith("u1");
  });

  it("unblock rolls back on failure", async () => {
    useBlocklistStore.setState({ items: [blocked("u1", "Bob")] });
    vi.mocked(unblockUser).mockRejectedValue(new Error("500"));

    await expect(useBlocklistStore.getState().unblock("u1")).rejects.toThrow("500");
    expect(useBlocklistStore.getState().items).toHaveLength(1);
  });
});

describe("contactStore.removeFriend", () => {
  it("removes friend and related private conversation", () => {
    useContactStore.setState({
      friends: [
        { id: "u1", nickname: "Bob", avatarUrl: null, shortId: 1, conversationId: "c1" },
        { id: "u2", nickname: "Carol", avatarUrl: null, shortId: 2, conversationId: "c2" },
      ],
    });
    useConversationStore.setState({
      conversations: [
        { id: "c1", type: "private", name: "Bob", unread: 0 },
        { id: "c2", type: "private", name: "Carol", unread: 0 },
      ] as never,
    });

    useContactStore.getState().removeFriend("u1");

    expect(useContactStore.getState().friends.map((f) => f.id)).toEqual(["u2"]);
    expect(useConversationStore.getState().conversations.map((c) => c.id)).toEqual(["c2"]);
  });

  it("is idempotent for unknown friend", () => {
    useContactStore.setState({
      friends: [{ id: "u1", nickname: "Bob", avatarUrl: null, shortId: 1, conversationId: null }],
    });
    useContactStore.getState().removeFriend("nonexistent");
    expect(useContactStore.getState().friends).toHaveLength(1);
  });

  it("deleteFriend calls api then removes locally", async () => {
    vi.mocked(deleteFriend).mockResolvedValue(undefined);
    useContactStore.setState({
      friends: [{ id: "u1", nickname: "Bob", avatarUrl: null, shortId: 1, conversationId: null }],
    });

    await useContactStore.getState().deleteFriend("u1");

    expect(deleteFriend).toHaveBeenCalledWith("u1");
    expect(useContactStore.getState().friends).toHaveLength(0);
  });

  it("deleteFriend keeps friend when api fails", async () => {
    vi.mocked(deleteFriend).mockRejectedValue(new Error("500"));
    useContactStore.setState({
      friends: [{ id: "u1", nickname: "Bob", avatarUrl: null, shortId: 1, conversationId: null }],
    });

    await expect(useContactStore.getState().deleteFriend("u1")).rejects.toThrow("500");
    expect(useContactStore.getState().friends).toHaveLength(1);
  });
});
