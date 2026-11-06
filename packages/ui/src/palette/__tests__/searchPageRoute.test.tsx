/** 手机搜索路由回归：真实应用路由、原页面返回、消息定位和 MSW 四态。 */
import { beforeAll, afterAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import {
  runBackInterceptors,
  searchMessages,
  useAuthStore,
  useContactStore,
  useConversationStore,
  useMessageStore,
} from "@yuanchat/shared";
import { server } from "@yuanchat/shared/mocks/server";
import i18n from "@yuanchat/design-system/i18n";
import { fetchFriends } from "../../../../shared/src/api/contacts";
import { apiGet } from "../../../../shared/src/api/client";
import WebApp from "../../../../../apps/web/src/App";

vi.mock("@yuanchat/shared", async (original) => ({
  ...(await original<typeof import("@yuanchat/shared")>()),
  useChatBootstrap: () => {},
  isMockEnabled: () => true,
}));
vi.mock("../../../../../apps/web/src/pages/ContactsPage", () => ({
  ContactsPage: () => <p>contacts page</p>,
}));
vi.mock("../../../../../apps/web/src/pages/ChatPage", () => ({ ChatPage: () => <p>chat page</p> }));

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());
beforeEach(() => {
  window.innerWidth = 400;
  useAuthStore.setState({ isAuthenticated: true, user: { id: "self", nickname: "Me" } });
  useConversationStore.setState({
    activeId: null,
    conversations: [
      { id: "conv_001", type: "group", name: "产品讨论组", unreadCount: 0, isMuted: false },
    ],
  });
  useContactStore.setState({ friends: [], loadFriends: async () => {} });
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.restoreAllMocks();
});

function Probe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="location">{location.pathname + location.search}</p>
      <button onClick={() => navigate(-1)}>history back</button>
    </>
  );
}
function mount(scope?: string, returnTo = "/contacts") {
  return render(
    <MemoryRouter
      initialEntries={[
        returnTo,
        {
          pathname: "/search",
          search: scope ? `?conversation_id=${scope}` : "",
          state: { searchReturnTo: returnTo },
        },
      ]}
    >
      <Probe />
      <WebApp />
    </MemoryRouter>,
  );
}

it("Web App 注册真实手机 /search 页面，不渲染 dialog 或底栏", async () => {
  mount("conv_001");
  expect(await screen.findByRole("combobox")).toBeInTheDocument();
  expect(screen.getByTestId("location")).toHaveTextContent("/search?conversation_id=conv_001");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  expect(screen.queryAllByRole("option")).toHaveLength(0);
});

it.each(["button", "android"])("%s 返回原页面而不是聊天页", async (kind) => {
  mount(undefined, "/contacts");
  await screen.findByRole("combobox");
  if (kind === "button") fireEvent.click(screen.getByRole("button", { name: i18n.t("chat.back") }));
  else
    act(() => {
      expect(runBackInterceptors()).toBe(true);
    });
  await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/contacts$/));
});

it("消息结果先 setActive/seek 再落到 /chat，不能关页再 back 覆盖目标", async () => {
  const seek = vi.spyOn(useMessageStore.getState(), "seekToMessage").mockResolvedValue(undefined);
  mount("conv_001");
  fireEvent.change(await screen.findByRole("combobox"), { target: { value: "季度报告" } });
  fireEvent.click(await screen.findByRole("option", { name: /季度报告写完了/ }));
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/chat\/conv_001$/),
  );
  expect(useConversationStore.getState().activeId).toBe("conv_001");
  expect(seek).toHaveBeenCalledWith("conv_001", "msg_search_1", 128);
  fireEvent.click(screen.getByText("history back"));
  await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/contacts$/));
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});

it("全局搜索首次拉联系人有 MSW 正常/空/错误/加载四态，不穿透真实后端", async () => {
  const friends = await fetchFriends();
  expect(friends.length).toBeGreaterThan(0);
  expect(useAuthStore.getState().isAuthenticated).toBe(true);
  expect(await apiGet("/api/v1/contacts?scenario=empty")).toEqual({ friends: [] });
  await expect(apiGet("/api/v1/contacts?scenario=error")).rejects.toThrow();
  let settled = false;
  const slow = apiGet("/api/v1/contacts?scenario=slow").then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(settled).toBe(false);
  await slow;
  expect(settled).toBe(true);
});

it("MSW 正常态也限定会话范围，不能用全局夹具冒充会话内结果", async () => {
  const result = await searchMessages({ q: "季度报告", conversation_id: "conv_001" });
  expect(result.results.length).toBeGreaterThan(0);
  expect(result.results.every((row) => row.conversation_id === "conv_001")).toBe(true);
});

it.each(["nomatch", "boom", "slow"])("搜索页面复用 MSW %s 状态", async (query) => {
  mount("conv_001");
  fireEvent.change(await screen.findByRole("combobox"), { target: { value: query } });
  if (query === "nomatch")
    expect(await screen.findByText(i18n.t("palette.empty"))).toBeInTheDocument();
  else if (query === "boom")
    expect(
      await screen.findByRole("button", { name: i18n.t("palette.searchFailed") }),
    ).toBeInTheDocument();
  else {
    await waitFor(() =>
      expect(screen.getByRole("listbox").querySelector(".animate-pulse")).not.toBeNull(),
    );
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  }
});
