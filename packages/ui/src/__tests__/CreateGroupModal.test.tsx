/**
 * CreateGroupModal 集成测试
 *
 * 测试范围：好友多选 → 点「创建」调用 createGroup(member_ids 正确) →
 * REST 响应插入 conversationStore（不依赖 conversation.created 帧）+ setActive 激活新群。
 * 依赖：contactStore（直接 setState 预置 3 好友，loadFriends 桩掉防止真实请求
 * 竞态覆盖预置数据——isMockEnabled mock 为 false 时 open 会触发 loadFriends）、
 * createGroup（vi.mock 桩，resolve 假会话）。
 *
 * jsdom 默认 locale 为 en-US，t() 文案断言使用英文值（与 SettingsScreen.test 风格一致）。
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { useContactStore, useConversationStore } from "@yuanchat/shared";
import type { Conversation } from "@yuanchat/shared";
import { CreateGroupModal } from "../CreateGroupModal";

const NEW_CONV: Conversation = {
  id: "g-new",
  type: "group",
  name: "群聊",
  unreadCount: 0,
  isMuted: false,
  memberCount: 3,
};

const createGroupMock = vi.fn(async (_name: string | undefined, _memberIds: string[]) => NEW_CONV);

vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return {
    ...mod,
    isMockEnabled: () => false,
    createGroup: (name: string | undefined, memberIds: string[]) =>
      createGroupMock(name, memberIds),
  };
});

describe("CreateGroupModal", () => {
  beforeEach(() => {
    createGroupMock.mockClear();
    useContactStore.setState({
      friends: [
        { id: "f1", nickname: "Alice", shortId: 10001, avatarUrl: null, conversationId: "c1" },
        { id: "f2", nickname: "Bob", shortId: 10002, avatarUrl: null, conversationId: "c2" },
        { id: "f3", nickname: "Carol", shortId: 10003, avatarUrl: null, conversationId: "c3" },
      ],
      // open 时组件会调 loadFriends（isMockEnabled=false）：桩掉防止真实 fetch 覆盖预置好友
      loadFriends: vi.fn(async () => {}),
    });
    useConversationStore.setState({ conversations: [], activeId: null });
  });

  it("勾选 2 位好友并创建 → 调用 createGroup、REST 响应入库且激活新会话", async () => {
    const onClose = vi.fn();
    render(<CreateGroupModal open onClose={onClose} />);

    fireEvent.click(screen.getByText("Alice"));
    fireEvent.click(screen.getByText("Bob"));

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(createGroupMock).toHaveBeenCalledTimes(1));
    const [, memberIds] = createGroupMock.mock.calls[0];
    expect(memberIds).toHaveLength(2);
    expect(memberIds).toEqual(expect.arrayContaining(["f1", "f2"]));
    // 创建者不依赖 conversation.created 帧：REST 响应立即插入本地列表
    await waitFor(() => {
      const convs = useConversationStore.getState().conversations;
      expect(convs.some((c) => c.id === "g-new" && c.unreadCount === 0)).toBe(true);
    });
    expect(useConversationStore.getState().activeId).toBe("g-new");
    expect(onClose).toHaveBeenCalled();
  });

  it("会话已在列表（帧先到竞态）→ 不重复插入、且清零未读", async () => {
    // conversation.created 帧（成员视角 unread=1）抢先入库
    useConversationStore.setState({
      conversations: [{ ...NEW_CONV, unreadCount: 1 }],
      activeId: null,
    });
    render(<CreateGroupModal open onClose={() => {}} />);

    fireEvent.click(screen.getByText("Alice"));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(useConversationStore.getState().activeId).toBe("g-new"));
    const convs = useConversationStore.getState().conversations.filter((c) => c.id === "g-new");
    expect(convs).toHaveLength(1);
    // 创建者正看着新群：帧带来的 unread=1 被清零
    expect(convs[0].unreadCount).toBe(0);
  });

  it("未选好友时创建按钮禁用", () => {
    render(<CreateGroupModal open onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });
});
