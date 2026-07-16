/**
 * ConversationList 集成测试
 *
 * 测试范围：会话列表渲染 + 点击切换活跃会话 + 搜索
 * 依赖：conversationStore、MemoryRouter（Link 组件）
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ConversationList } from "../ConversationList";
import { useConversationStore } from "@yuanchat/shared";

beforeEach(() => {
  // Spy on DOM APIs instead of replacing document entirely
  // (jsdom provides a working document.body/document.head for React)
  vi.spyOn(document.documentElement.style, "setProperty").mockImplementation(() => {});
  vi.spyOn(document.documentElement.classList, "toggle").mockImplementation(() => false);

  useConversationStore.setState({
    activeId: null,
    conversations: [
      {
        id: "1",
        type: "private",
        name: "张三",
        lastMessage: "明天开会",
        lastTime: "14:32",
        unreadCount: 3,
        isOnline: true,
        isMuted: false,
      },
      {
        id: "2",
        type: "group",
        name: "产品研发群",
        lastMessage: "李四: 新版本上线了",
        lastTime: "13:15",
        unreadCount: 0,
        isMuted: true,
      },
      {
        id: "3",
        type: "private",
        name: "王五",
        lastMessage: "文件收到了吗",
        lastTime: "昨天",
        unreadCount: 0,
        isOnline: false,
        isMuted: false,
      },
    ],
  });
});

describe("ConversationList", () => {
  it("renders all conversations", () => {
    render(
      <MemoryRouter>
        <ConversationList />
      </MemoryRouter>,
    );
    // Avatar 会在 Fallback + aria-label 中重复渲染名字，
    // 用 getAllByText 检查至少存在一个
    expect(screen.getAllByText("张三").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("产品研发群").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("王五").length).toBeGreaterThanOrEqual(1);
  });

  it("shows last message preview", () => {
    render(
      <MemoryRouter>
        <ConversationList />
      </MemoryRouter>,
    );
    expect(screen.getByText("明天开会")).toBeInTheDocument();
    expect(screen.getByText("李四: 新版本上线了")).toBeInTheDocument();
  });

  it("shows unread badge when count > 0", () => {
    render(
      <MemoryRouter>
        <ConversationList />
      </MemoryRouter>,
    );
    // 张三有 3 条未读
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("does not show unread badge when count is 0", () => {
    render(
      <MemoryRouter>
        <ConversationList />
      </MemoryRouter>,
    );
    const badges = screen.getAllByText("3");
    expect(badges).toHaveLength(1); // 只有张三的 3
  });

  it("sets active conversation on click", () => {
    render(
      <MemoryRouter>
        <ConversationList />
      </MemoryRouter>,
    );
    // 点击第一个会话（取第一个 "张三" 元素 — 真正的列表项）
    const items = screen.getAllByText("张三");
    fireEvent.click(items[0]);
    expect(useConversationStore.getState().activeId).toBe("1");
  });

  it("renders search input", () => {
    render(
      <MemoryRouter>
        <ConversationList />
      </MemoryRouter>,
    );
    // jsdom locale 为 en-US
    expect(screen.getByPlaceholderText("Search chats, contacts, messages…")).toBeInTheDocument();
  });

  it("filters conversations by search input", () => {
    render(
      <MemoryRouter>
        <ConversationList />
      </MemoryRouter>,
    );
    const input = screen.getByPlaceholderText(
      "Search chats, contacts, messages…",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "产品" } });
    expect(input.value).toBe("产品");
    // 只剩产品研发群，张三/王五被过滤掉
    expect(screen.getAllByText("产品研发群").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("明天开会")).toBeNull();
  });

  it("filters unread conversations via chip", () => {
    render(
      <MemoryRouter>
        <ConversationList />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Unread/ }));
    // 只有张三有未读
    expect(screen.getAllByText("张三").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("李四: 新版本上线了")).toBeNull();
  });
});
