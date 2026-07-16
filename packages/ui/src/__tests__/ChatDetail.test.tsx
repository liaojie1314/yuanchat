import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatDetail } from "../ChatDetail";
import { useConversationStore } from "@yuanchat/shared";

// jsdom 默认 locale 为 en-US，所有 t() 文案断言使用英文
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
          memberCount: 28,
        },
      ],
    });
  });

  it("renders conversation name", () => {
    render(<ChatDetail />);
    // Avatar 组件会重复渲染名字（Fallback + aria-label）
    expect(screen.getAllByText("张三").length).toBeGreaterThanOrEqual(1);
  });

  it("shows contact label for private chat type", () => {
    render(<ChatDetail />);
    expect(screen.getByText("Contact")).toBeInTheDocument();
  });

  it("shows group label for group chat type", () => {
    useConversationStore.setState({ activeId: "2" });
    render(<ChatDetail />);
    expect(screen.getByText(/Group · 28 members/)).toBeInTheDocument();
  });

  it("renders mute toggle row", () => {
    render(<ChatDetail />);
    expect(screen.getByText("Mute notifications")).toBeInTheDocument();
  });

  it("toggles mute status on row click", () => {
    render(<ChatDetail />);
    fireEvent.click(screen.getByText("Mute notifications"));
    const conv = useConversationStore.getState().conversations.find((c) => c.id === "1");
    expect(conv?.isMuted).toBe(true);
  });

  it("toggles pinned status on row click", () => {
    render(<ChatDetail />);
    fireEvent.click(screen.getByText("Pin conversation"));
    const conv = useConversationStore.getState().conversations.find((c) => c.id === "1");
    expect(conv?.isPinned).toBe(true);
  });

  it("shows invite button for group chats", () => {
    useConversationStore.setState({ activeId: "2" });
    render(<ChatDetail />);
    expect(screen.getByText("Invite")).toBeInTheDocument();
  });

  it("does not show invite button for private chats", () => {
    render(<ChatDetail />);
    expect(screen.queryByText("Invite")).toBeNull();
  });

  it("shows leave-group action only for groups", () => {
    const { unmount } = render(<ChatDetail />);
    expect(screen.queryByText("Leave group")).toBeNull();
    unmount();
    useConversationStore.setState({ activeId: "2" });
    render(<ChatDetail />);
    expect(screen.getByText("Leave group")).toBeInTheDocument();
  });

  it("renders close button and fires onClose", () => {
    let closed = false;
    render(<ChatDetail onClose={() => (closed = true)} />);
    fireEvent.click(screen.getByLabelText("Close details"));
    expect(closed).toBe(true);
  });
});
