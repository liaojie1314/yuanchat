/** 命令面板的真实组件回归：导航关闭、建群入口、过期响应和异步本地源。 */
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { useContactStore, useConversationStore } from "@yuanchat/shared";
import i18n from "@yuanchat/design-system/i18n";
import * as searchApi from "../../../../shared/src/api/search";
import type { MessageSearchResponse } from "@yuanchat/shared";
import { CommandPalette } from "../CommandPalette";
import { ChatScreen } from "../../chat/ChatScreen";
import { ContactsScreen } from "../../contacts/ContactsScreen";

beforeEach(() => {
  useConversationStore.setState({ conversations: [], activeId: null });
  useContactStore.setState({
    friends: [],
    requests: [],
    loadFriends: async () => {},
    loadRequests: async () => {},
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each(["托", "托盘", "AI", "🙂", "%", "_"])(
  "非空查询 %s 发消息检索请求并展示结果",
  async (query) => {
    const search = vi.spyOn(searchApi, "searchMessages").mockResolvedValue({
      results: [
        {
          message_id: "hit",
          conversation_id: "c1",
          conv_name: "群聊",
          sender_nickname: "Bob",
          excerpt: "短词命中",
          created_at: "2026-11-05",
          seq: 1,
          message_type: 1,
        },
      ],
      has_more: false,
    });
    render(
      <MemoryRouter>
        <CommandPalette conversationId="c1" onClose={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: ` ${query} ` } });
    await waitFor(() =>
      expect(search).toHaveBeenCalledWith(
        expect.objectContaining({ q: query, conversation_id: "c1" }),
      ),
    );
    expect(await screen.findByRole("option", { name: /短词命中/ })).toBeInTheDocument();
  },
);

it.each([undefined, "c1"])(
  "空白查询不请求消息且不显示假无结果（scope=%s）",
  async (conversationId) => {
    vi.useFakeTimers();
    const search = vi
      .spyOn(searchApi, "searchMessages")
      .mockResolvedValue({ results: [], has_more: false });
    render(
      <MemoryRouter>
        <CommandPalette conversationId={conversationId} onClose={() => {}} />
      </MemoryRouter>,
    );
    for (const query of [" ", "\u3000\t"]) {
      fireEvent.change(screen.getByRole("combobox"), { target: { value: query } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });
      expect(search).not.toHaveBeenCalled();
      expect(screen.queryByText(i18n.t("palette.empty"))).toBeNull();
      if (!conversationId) expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
    }
  },
);

function Host() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Outlet />
      <CommandPalette show={open} onClose={() => setOpen(false)} />
    </>
  );
}

it.each([
  { isComposing: true, keyCode: 13 },
  { isComposing: false, keyCode: 229 },
])("输入法选字 Enter 不导航，结束组合后 Enter 仍能选中（%j）", (composition) => {
  useContactStore.setState({
    friends: [
      { id: "friend", shortId: 10002, nickname: "明明", avatarUrl: "", conversationId: "c1" },
    ],
  });
  const navigate = vi.fn();
  render(
    <MemoryRouter>
      <CommandPalette variant="window" onNavigate={navigate} onClose={vi.fn()} />
    </MemoryRouter>,
  );
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "明" } });
  expect(screen.getByRole("option", { name: /明明/ })).toBeInTheDocument();
  fireEvent.keyDown(input, { key: "Enter", ...composition });
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter", isComposing: false, keyCode: 13 });
  expect(navigate).toHaveBeenCalledWith("/chat/c1", { conversationId: "c1", seek: undefined });
});

it("导航动作跳转成功后关闭面板", async () => {
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Host />}>
          <Route path="/" element={<p>home</p>} />
          <Route path="/settings" element={<p data-testid="settings-route">settings</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("option", { name: i18n.t("settings.title") }));
  expect(await screen.findByTestId("settings-route")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("建群动作打开现有建群弹窗，而不只是跳到通讯录", async () => {
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Host />}>
          <Route path="/" element={<p>home</p>} />
          <Route path="/contacts" element={<ContactsScreen />} />
          <Route path="/chat" element={<ChatScreen />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  const actions = screen.getAllByRole("option");
  fireEvent.click(actions[0]);
  expect(
    await screen.findByRole("dialog", { name: i18n.t("chat.menu.newGroup") }),
  ).toBeInTheDocument();
});

it("清空后输入短查询，旧在途请求不能在新防抖窗口落地", async () => {
  let finish!: (response: MessageSearchResponse) => void;
  vi.spyOn(searchApi, "searchMessages").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <MemoryRouter>
      <CommandPalette onClose={() => {}} />
    </MemoryRouter>,
  );
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "旧关键词" } });
  await waitFor(() => expect(finish).toBeDefined());
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.change(input, { target: { value: "新" } });
  await act(async () => {
    finish({
      results: [
        {
          message_id: "old",
          conversation_id: "c",
          conv_name: "old",
          sender_nickname: "old",
          excerpt: "旧查询结果",
          created_at: "2026-11-02",
          seq: 1,
          message_type: 1,
        },
      ],
      has_more: false,
    });
  });
  expect(screen.queryByText("旧查询结果")).not.toBeInTheDocument();
});

it("已有短查询在好友加载后自动刷新，不要求重新输入", async () => {
  vi.useFakeTimers();
  vi.spyOn(searchApi, "searchMessages").mockResolvedValue({ results: [], has_more: false });
  render(
    <MemoryRouter>
      <CommandPalette variant="window" onClose={() => {}} />
    </MemoryRouter>,
  );
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "明" } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
  expect(screen.getByText(i18n.t("palette.empty"))).toBeInTheDocument();
  act(() =>
    useContactStore.setState({
      friends: [
        { id: "friend", shortId: 10002, nickname: "明明", avatarUrl: "", conversationId: "c" },
      ],
    }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
  const appeared = !!screen.queryByRole("option", { name: /明明/ });
  // 同一份数据在改词后能命中，排除夹具结构错误造成的假阴性。
  fireEvent.change(input, { target: { value: "明明" } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
  expect(screen.getByRole("option", { name: /明明/ })).toBeInTheDocument();
  expect(appeared).toBe(true);
});

it.each(["toggle-theme", "logout"])("独立窗口的 %s 交给主窗口，不改本窗口状态", (action) => {
  const navigate = vi.fn();
  render(
    <MemoryRouter>
      <CommandPalette variant="window" onNavigate={navigate} onClose={vi.fn()} />
    </MemoryRouter>,
  );
  const label = action === "toggle-theme" ? "palette.toggleTheme" : "settings.logout";
  fireEvent.click(screen.getByRole("option", { name: i18n.t(label) }));
  expect(navigate).toHaveBeenCalledWith("", { action });
});

it("快速搜索不闪骨架或空态，慢搜索骨架至少稳定显示 250ms", async () => {
  vi.useFakeTimers();
  let finish!: (response: MessageSearchResponse) => void;
  vi.spyOn(searchApi, "searchMessages").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <MemoryRouter>
      <CommandPalette conversationId="scope" onClose={() => {}} />
    </MemoryRouter>,
  );
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "快速搜索" } });
  expect(screen.queryByText(i18n.t("palette.empty"))).not.toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
  expect(screen.getByRole("listbox").querySelector(".animate-pulse")).toBeNull();
  await act(async () => {
    finish({ results: [], has_more: false });
  });
  expect(screen.getByText(i18n.t("palette.empty"))).toBeInTheDocument();
  fireEvent.change(input, { target: { value: "慢速搜索" } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(510);
  });
  expect(screen.getByRole("listbox").querySelector(".animate-pulse")).not.toBeNull();
  await act(async () => {
    finish({ results: [], has_more: false });
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(screen.getByRole("listbox").querySelector(".animate-pulse")).not.toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60);
  });
  expect(screen.getByRole("listbox").querySelector(".animate-pulse")).toBeNull();
  expect(screen.getByText(i18n.t("palette.empty"))).toBeInTheDocument();
});

it.each([
  [undefined, "scope"],
  ["scope", undefined],
])("范围 %s → %s 的旧响应不能串入新范围", async (from, to) => {
  vi.useFakeTimers();
  let finish!: (response: MessageSearchResponse) => void;
  vi.spyOn(searchApi, "searchMessages").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { rerender } = render(
    <MemoryRouter>
      <CommandPalette conversationId={from} onClose={() => {}} />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "季度报告" } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
  expect(finish).toBeDefined();
  rerender(
    <MemoryRouter>
      <CommandPalette conversationId={to} onClose={() => {}} />
    </MemoryRouter>,
  );
  await act(async () => {
    finish({
      results: [
        {
          message_id: "stale",
          conversation_id: from ?? "other",
          conv_name: "旧范围",
          sender_nickname: "old",
          excerpt: "旧范围查询结果",
          created_at: "2026-11-02",
          seq: 1,
          message_type: 1,
        },
      ],
      has_more: false,
    });
  });
  expect(screen.queryByText("旧范围查询结果")).not.toBeInTheDocument();
});

it("Web 首次打开命令面板即加载联系人，不要求先访问通讯录", async () => {
  useContactStore.setState({
    loadFriends: async () => {
      useContactStore.setState({
        friends: [
          { id: "friend", shortId: 10002, nickname: "Bob", avatarUrl: "", conversationId: "c1" },
        ],
      });
    },
  });
  render(
    <MemoryRouter>
      <CommandPalette onClose={() => {}} />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "Bo" } });
  expect(await screen.findByRole("option", { name: /Bob/ })).toBeInTheDocument();
});
