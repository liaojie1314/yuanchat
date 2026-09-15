/**
 * ConversationList 集成测试
 *
 * 测试范围：会话列表渲染 + 点击切换活跃会话 + 搜索
 * 依赖：conversationStore、MemoryRouter（Link 组件）
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ConversationList } from "../chat/ConversationList";
import { useConversationStore } from "@yuanchat/shared";

vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return { ...mod, applyConversationSetting: vi.fn() };
});
import { applyConversationSetting } from "@yuanchat/shared";

beforeEach(() => {
  // 只对 DOM API 打 spy，不整体替换 document
  //（jsdom 已提供可用的 document.body / document.head 供 React 使用）
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

describe("pinned ordering and context menu", () => {
  beforeEach(() => {
    vi.mocked(applyConversationSetting).mockClear();
    useConversationStore.setState({
      activeId: null,
      conversations: [
        // store 顺序故意与 pinnedAt 倒序相反，验证排序生效
        {
          id: "p1",
          type: "private",
          name: "旧置顶",
          unreadCount: 0,
          isMuted: false,
          isPinned: true,
          pinnedAt: "2026-07-30T10:00:00+08:00",
        },
        {
          id: "p2",
          type: "private",
          name: "新置顶",
          unreadCount: 0,
          isMuted: false,
          isPinned: true,
          pinnedAt: "2026-07-31T10:00:00+08:00",
        },
        { id: "r1", type: "private", name: "普通会话", unreadCount: 0, isMuted: false },
      ],
    });
  });

  it("sorts pinned section by pinnedAt desc", () => {
    render(
      <MemoryRouter>
        <ConversationList />
      </MemoryRouter>,
    );
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    const iNew = names.findIndex((s) => s?.includes("新置顶"));
    const iOld = names.findIndex((s) => s?.includes("旧置顶"));
    expect(iNew).toBeGreaterThan(-1);
    expect(iNew).toBeLessThan(iOld);
  });

  it("opens context menu on right click and toggles pin", () => {
    render(
      <MemoryRouter>
        <ConversationList />
      </MemoryRouter>,
    );
    fireEvent.contextMenu(screen.getByText("普通会话"));
    fireEvent.click(screen.getByRole("menuitem", { name: /pin/i }));
    expect(applyConversationSetting).toHaveBeenCalledWith("r1", { isPinned: true });
  });

  it("shows unpin and unmute labels for pinned/muted conversations", () => {
    useConversationStore.setState((s) => ({
      conversations: s.conversations.map((c) => (c.id === "p2" ? { ...c, isMuted: true } : c)),
    }));
    render(
      <MemoryRouter>
        <ConversationList />
      </MemoryRouter>,
    );
    fireEvent.contextMenu(screen.getByText("新置顶"));
    expect(screen.getByRole("menuitem", { name: /unpin/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /unmute/i }));
    expect(applyConversationSetting).toHaveBeenCalledWith("p2", { isMuted: false });
  });

  // 防秒关的豁免只针对触屏长按的合成事件；桌面右键开菜单后左键点同一条目
  // 仍应正常关闭菜单并切换会话（豁免不得外溢到鼠标路径）。
  it("closes the menu and selects when left-clicking the same item after right click", () => {
    render(
      <MemoryRouter>
        <ConversationList />
      </MemoryRouter>,
    );
    const item = screen.getByText("普通会话").closest("button") as HTMLButtonElement;
    fireEvent.contextMenu(item);
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);

    fireEvent.mouseDown(item);
    fireEvent.click(item);
    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(useConversationStore.getState().activeId).toBe("r1");
  });

  // 乐观置顶写入 new Date().toISOString()（Z 格式），服务端回的是 +08:00 偏移格式。
  // 字符串字典序会把 "…T00:00:00.000Z" 判为小于 "…T07:00:00+08:00"，
  // 但按真实时刻前者更新——必须按时间戳数值比较。
  it("sorts pinned by real instant across mixed Z / +08:00 formats", () => {
    useConversationStore.setState({
      activeId: null,
      conversations: [
        {
          id: "srv",
          type: "private",
          name: "服务端置顶",
          unreadCount: 0,
          isMuted: false,
          isPinned: true,
          // 实际时刻 2026-07-30T23:00:00Z（较早）
          pinnedAt: "2026-07-31T07:00:00+08:00",
        },
        {
          id: "opt",
          type: "private",
          name: "乐观新置顶",
          unreadCount: 0,
          isMuted: false,
          isPinned: true,
          // 实际时刻 2026-07-31T00:00:00Z（较晚，应排前）
          pinnedAt: "2026-07-31T00:00:00.000Z",
        },
      ],
    });
    render(
      <MemoryRouter>
        <ConversationList />
      </MemoryRouter>,
    );
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    const iOpt = names.findIndex((s) => s?.includes("乐观新置顶"));
    const iSrv = names.findIndex((s) => s?.includes("服务端置顶"));
    expect(iOpt).toBeGreaterThan(-1);
    expect(iOpt).toBeLessThan(iSrv);
  });

  it("keeps conversations with invalid or missing pinnedAt after valid ones", () => {
    useConversationStore.setState({
      activeId: null,
      conversations: [
        {
          id: "bad",
          type: "private",
          name: "无时间置顶",
          unreadCount: 0,
          isMuted: false,
          isPinned: true,
        },
        {
          id: "good",
          type: "private",
          name: "有时间置顶",
          unreadCount: 0,
          isMuted: false,
          isPinned: true,
          pinnedAt: "2026-07-31T10:00:00+08:00",
        },
      ],
    });
    render(
      <MemoryRouter>
        <ConversationList />
      </MemoryRouter>,
    );
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    const iGood = names.findIndex((s) => s?.includes("有时间置顶"));
    const iBad = names.findIndex((s) => s?.includes("无时间置顶"));
    expect(iGood).toBeGreaterThan(-1);
    expect(iBad).toBeGreaterThan(-1);
    expect(iGood).toBeLessThan(iBad);
  });
});

describe("long press menu (touch)", () => {
  beforeEach(() => {
    vi.mocked(applyConversationSetting).mockClear();
    useConversationStore.setState({
      activeId: null,
      conversations: [
        { id: "t1", type: "private", name: "长按会话", unreadCount: 0, isMuted: false },
      ],
    });
  });

  it("opens menu after 500ms touch and survives the synthetic mousedown + click", () => {
    vi.useFakeTimers();
    try {
      render(
        <MemoryRouter>
          <ConversationList />
        </MemoryRouter>,
      );
      const item = screen.getByText("长按会话").closest("button") as HTMLButtonElement;

      fireEvent.touchStart(item);
      act(() => {
        vi.advanceTimersByTime(500);
      });

      // 菜单已弹出
      expect(screen.getByRole("menuitem", { name: /pin/i })).toBeInTheDocument();

      // 抬手后浏览器补发合成 mousedown：不得触发 document 关闭监听把菜单秒关
      fireEvent.touchEnd(item);
      fireEvent.mouseDown(item);
      expect(screen.getAllByRole("menuitem")).toHaveLength(2);

      // 紧随其后的合成 click 必须被吞掉：不得切换活跃会话
      fireEvent.click(item);
      expect(useConversationStore.getState().activeId).toBeNull();
      // 菜单仍开着，用户可以真正点到菜单项
      expect(screen.getAllByRole("menuitem")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes the menu when tapping elsewhere after the synthetic burst settles", () => {
    vi.useFakeTimers();
    try {
      render(
        <MemoryRouter>
          <ConversationList />
        </MemoryRouter>,
      );
      const item = screen.getByText("长按会话").closest("button") as HTMLButtonElement;

      fireEvent.touchStart(item);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      fireEvent.touchEnd(item);
      expect(screen.getAllByRole("menuitem")).toHaveLength(2);

      // 合成事件序列结束后，点击列表外部仍应关闭菜单（不能因为防秒关就永不关闭）
      act(() => {
        vi.advanceTimersByTime(400);
      });
      act(() => {
        fireEvent.mouseDown(document.body);
      });
      expect(screen.queryByRole("menuitem")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("still selects the conversation on a normal short tap", () => {
    vi.useFakeTimers();
    try {
      render(
        <MemoryRouter>
          <ConversationList />
        </MemoryRouter>,
      );
      const item = screen.getByText("长按会话").closest("button") as HTMLButtonElement;

      fireEvent.touchStart(item);
      act(() => {
        vi.advanceTimersByTime(100); // 未达长按阈值
      });
      fireEvent.touchEnd(item);
      fireEvent.click(item);

      expect(screen.queryByRole("menuitem")).toBeNull();
      expect(useConversationStore.getState().activeId).toBe("t1");
    } finally {
      vi.useRealTimers();
    }
  });

  // 长按后不一定有合成 click 跟随（手指拖走 / touchcancel / Android Chrome
  // 长按后抑制合成事件）。若 longPressFired 只在 click 里复位，标志会残留，
  // 把用户下一次真实点击吞掉。
  it("does not swallow the next real tap when the long press had no synthetic click", () => {
    vi.useFakeTimers();
    try {
      render(
        <MemoryRouter>
          <ConversationList />
        </MemoryRouter>,
      );
      const item = screen.getByText("长按会话").closest("button") as HTMLButtonElement;

      // 第一次：长按开菜单，随后手指移开取消（无合成 click 跟随）
      fireEvent.touchStart(item);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      fireEvent.touchMove(item);
      fireEvent.touchCancel(item);

      // 关掉菜单，回到干净状态
      act(() => {
        vi.advanceTimersByTime(400);
      });
      act(() => {
        fireEvent.mouseDown(document.body);
      });
      expect(screen.queryByRole("menuitem")).toBeNull();

      // 第二次：正常短按，必须正常选中（不得被残留标志吞掉）
      fireEvent.touchStart(item);
      act(() => {
        vi.advanceTimersByTime(100);
      });
      fireEvent.touchEnd(item);
      fireEvent.click(item);

      expect(useConversationStore.getState().activeId).toBe("t1");
    } finally {
      vi.useRealTimers();
    }
  });
});
