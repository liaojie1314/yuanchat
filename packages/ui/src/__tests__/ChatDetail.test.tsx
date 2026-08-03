import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatDetail } from "../ChatDetail";
import { applyConversationSetting, useConversationStore } from "@yuanchat/shared";

// 群成员头像墙由 fetchMembers 驱动，mock 为固定 3 人（2 字昵称，与 Avatar 首字母回退一致）
const MOCK_FETCHED = [
  { userId: "u1", nickname: "阿建", avatarUrl: null, role: 2 },
  { userId: "u2", nickname: "小美", avatarUrl: null, role: 0 },
  { userId: "u3", nickname: "老王", avatarUrl: null, role: 0 },
];

vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return {
    ...mod,
    isMockEnabled: () => false,
    fetchMembers: vi.fn(async () => MOCK_FETCHED),
    applyConversationSetting: vi.fn(),
  };
});

// jsdom 默认 locale 为 en-US，所有 t() 文案断言使用英文
describe("ChatDetail", () => {
  beforeEach(() => {
    vi.mocked(applyConversationSetting).mockClear();
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

  it("shows group label for group chat type", async () => {
    useConversationStore.setState({ activeId: "2" });
    render(<ChatDetail />);
    expect(screen.getByText(/Group · 28 members/)).toBeInTheDocument();
    await screen.findByText("阿建");
  });

  it("renders mute toggle row", () => {
    render(<ChatDetail />);
    expect(screen.getByText("Mute notifications")).toBeInTheDocument();
  });

  it("delegates mute toggle to applyConversationSetting", () => {
    render(<ChatDetail />);
    fireEvent.click(screen.getByText("Mute notifications"));
    expect(applyConversationSetting).toHaveBeenCalledWith("1", { isMuted: true });
  });

  it("delegates pin toggle to applyConversationSetting", () => {
    render(<ChatDetail />);
    fireEvent.click(screen.getByText("Pin conversation"));
    expect(applyConversationSetting).toHaveBeenCalledWith("1", { isPinned: true });
  });

  it("shows invite button for group chats", async () => {
    useConversationStore.setState({ activeId: "2" });
    render(<ChatDetail />);
    expect(screen.getByText("Invite")).toBeInTheDocument();
    await screen.findByText("阿建");
  });

  it("renders fetched members on the avatar wall for group chats", async () => {
    useConversationStore.setState({ activeId: "2" });
    render(<ChatDetail />);
    // fetchMembers 异步返回 3 人，头像墙渲染其昵称首字母回退
    expect(await screen.findByText("阿建")).toBeInTheDocument();
    expect(screen.getByText("小美")).toBeInTheDocument();
    expect(screen.getByText("老王")).toBeInTheDocument();
  });

  it("fires onShowAllMembers when see-all button clicked", async () => {
    useConversationStore.setState({ activeId: "2" });
    let shown = false;
    render(<ChatDetail onShowAllMembers={() => (shown = true)} />);
    await screen.findByText("阿建");
    fireEvent.click(screen.getByText("All"));
    expect(shown).toBe(true);
  });

  it("hides see-all button when onShowAllMembers is absent", async () => {
    useConversationStore.setState({ activeId: "2" });
    render(<ChatDetail />);
    await screen.findByText("阿建");
    expect(screen.queryByText("All")).toBeNull();
  });

  it("does not show invite button for private chats", () => {
    render(<ChatDetail />);
    expect(screen.queryByText("Invite")).toBeNull();
  });

  it("shows leave-group action only for groups", async () => {
    const { unmount } = render(<ChatDetail />);
    expect(screen.queryByText("Leave group")).toBeNull();
    unmount();
    useConversationStore.setState({ activeId: "2" });
    render(<ChatDetail />);
    // 等群成员异步加载完成，避免 act() 警告
    await screen.findByText("阿建");
    expect(screen.getByText("Leave group")).toBeInTheDocument();
  });

  it("renders close button and fires onClose", () => {
    let closed = false;
    render(<ChatDetail onClose={() => (closed = true)} />);
    fireEvent.click(screen.getByLabelText("Close details"));
    expect(closed).toBe(true);
  });
});
