import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatDetail } from "../ChatDetail";
import { useConversationStore } from "@yuanchat/shared";

describe("ChatDetail", () => {
  beforeEach(() => {
    useConversationStore.setState({
      activeId: "1",
      conversations: [
        {
          id: "1",
          type: "private",
          name: "张三",
          lastMessage: "你好",
          lastTime: "14:32",
          unreadCount: 0,
          isOnline: true,
          isMuted: false,
        },
        {
          id: "2",
          type: "group",
          name: "研发群",
          lastMessage: "讨论",
          lastTime: "13:00",
          unreadCount: 1,
          isMuted: true,
        },
      ],
    });
  });

  it("renders conversation name", () => {
    render(<ChatDetail />);
    // Avatar 组件会重复渲染名字（Fallback + aria-label）
    expect(screen.getAllByText("张三").length).toBeGreaterThanOrEqual(1);
  });

  it("shows '联系人' for private chat type", () => {
    render(<ChatDetail />);
    expect(screen.getByText("联系人")).toBeInTheDocument();
  });

  it("shows '群聊' for group chat type", () => {
    useConversationStore.setState({ activeId: "2" });
    render(<ChatDetail />);
    expect(screen.getByText("群聊")).toBeInTheDocument();
  });

  it("renders mute toggle button", () => {
    render(<ChatDetail />);
    expect(screen.getByText("消息免打扰")).toBeInTheDocument();
  });

  it("toggles mute status on button click", () => {
    render(<ChatDetail />);
    fireEvent.click(screen.getByText("消息免打扰"));
    const conv = useConversationStore.getState().conversations.find((c) => c.id === "1");
    expect(conv?.isMuted).toBe(true);
  });

  it("renders search button", () => {
    render(<ChatDetail />);
    expect(screen.getByText("搜索聊天记录")).toBeInTheDocument();
  });

  it("shows invite button for group chats", () => {
    useConversationStore.setState({ activeId: "2" });
    render(<ChatDetail />);
    expect(screen.getByText("邀请成员")).toBeInTheDocument();
  });

  it("does not show invite button for private chats", () => {
    render(<ChatDetail />);
    expect(screen.queryByText("邀请成员")).toBeNull();
  });
});
