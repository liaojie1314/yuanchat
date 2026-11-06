/** 搜索入口回归：桌面 Web 弹窗、原生宿主桥、手机路由共用会话范围。 */
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import {
  useAuthStore,
  useContactStore,
  useConversationStore,
  useMessageStore,
  useShortcutStore,
  DEFAULT_SEARCH_SHORTCUT,
} from "@yuanchat/shared";
import i18n from "@yuanchat/design-system/i18n";
import { MainLayout } from "../../layout/MainLayout";
import { ChatWindow } from "../../chat/ChatWindow";
import { ConversationList } from "../../chat/ConversationList";
import { setSearchWindowLauncher } from "../searchWindowActions";

vi.mock("@yuanchat/shared", async (original) => ({
  ...(await original<typeof import("@yuanchat/shared")>()),
  useChatBootstrap: () => {},
  isMockEnabled: () => true,
}));

beforeEach(() => {
  window.innerWidth = 1200;
  useShortcutStore.setState({ searchShortcut: DEFAULT_SEARCH_SHORTCUT });
  useAuthStore.setState({ user: { id: "self", nickname: "Me" } });
  useConversationStore.setState({
    activeId: "scope",
    conversations: [
      { id: "scope", name: "范围会话", type: "group", unreadCount: 0, isMuted: false },
    ],
  });
  useMessageStore.setState({
    messagesByConv: { scope: [] },
    loadHistory: async () => {},
    replyingTo: null,
  });
  useContactStore.setState({ friends: [], loadFriends: async () => {} });
});
afterEach(() => {
  cleanup();
  setSearchWindowLauncher(null);
  vi.restoreAllMocks();
});

function Location() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}
function mount(chat = true) {
  return render(
    <MemoryRouter initialEntries={["/chat"]}>
      <Location />
      <Routes>
        <Route element={<MainLayout />}>
          <Route
            path="/chat"
            element={
              chat ? <ChatWindow compactComposer={window.innerWidth < 768} /> : <ConversationList />
            }
          />
          <Route path="/search" element={<p>route search</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

it("Web 桌面会话内入口打开 dialog，而不是标题栏下旧 inline", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: i18n.t("chat.searchHistory") }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("combobox")).toBeInTheDocument();
  expect(screen.queryAllByRole("option")).toHaveLength(0);
});

it("会话内入口把范围交给原生 launcher，不在主窗口渲染搜索", () => {
  const launch = vi.fn(() => true);
  setSearchWindowLauncher(launch);
  mount();
  fireEvent.click(screen.getByRole("button", { name: i18n.t("chat.searchHistory") }));
  expect(launch).toHaveBeenCalledWith("scope");
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});

it.each(["按钮", "快捷键"])("桌面全局%s打开应用内弹窗，不调用原生会话搜索窗口", (entry) => {
  const launch = vi.fn(() => true);
  setSearchWindowLauncher(launch);
  mount(false);
  if (entry === "按钮") {
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common.search") }));
  } else {
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  }
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("combobox")).toBeInTheDocument();
  expect(launch).not.toHaveBeenCalled();
  expect(screen.getByTestId("location")).toHaveTextContent(/^\/chat$/);
});

it("手机会话内入口打开独立 /search 路由并携带范围，不是全屏 modal", () => {
  window.innerWidth = 400;
  mount();
  fireEvent.click(screen.getByRole("button", { name: i18n.t("chat.input.more") }));
  fireEvent.click(screen.getAllByRole("button", { name: i18n.t("chat.searchHistory") }).pop()!);
  expect(screen.getByTestId("location")).toHaveTextContent("/search?conversation_id=scope");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
});

it("手机全局搜索按钮与快捷键都打开独立路由且无会话范围", () => {
  window.innerWidth = 400;
  mount(false);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("common.search") }));
  expect(screen.getByTestId("location")).toHaveTextContent(/^\/search$/);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("手机全局快捷键不用全屏 dialog", () => {
  window.innerWidth = 400;
  mount(false);
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  expect(screen.getByTestId("location")).toHaveTextContent(/^\/search$/);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
