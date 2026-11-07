/** Android 外壳搜索路由：与 Web 共用独立页面，并接住系统返回。 */
import { beforeAll, afterAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import {
  useAuthStore,
  useContactStore,
  useConversationStore,
  useMessageStore,
} from "@yuanchat/shared";
import i18n from "@yuanchat/design-system/i18n";
import { server } from "@yuanchat/shared/mocks/server";
import App from "../App";

vi.mock("../../../../packages/shared/src/config/serverEndpoint", async (original) => ({
  ...(await original<typeof import("../../../../packages/shared/src/config/serverEndpoint")>()),
  resolveApiBase: () => "http://localhost:8085",
}));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: async () => true,
  sendNotification: vi.fn(),
}));
vi.mock("../hooks/useIsMobile", () => ({ useIsMobile: () => true }));
vi.mock("../hooks/useCallWindow", () => ({ useCallWindow: () => {} }));
vi.mock("../pages/ContactsPage", () => ({ ContactsPage: () => <p>contacts</p> }));
vi.mock("../pages/ChatPage", () => ({ ChatPage: () => <p>chat</p> }));
vi.mock("@yuanchat/shared", async (original) => ({
  ...(await original<typeof import("@yuanchat/shared")>()),
  useChatBootstrap: () => {},
}));

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());
beforeEach(() => {
  window.innerWidth = 400;
  useAuthStore.setState({ isAuthenticated: true, user: { id: "self", nickname: "Me" } });
  useConversationStore.setState({ activeId: null, conversations: [] });
  useContactStore.setState({ friends: [], loadFriends: async () => {} });
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.restoreAllMocks();
});
function Probe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}
function mount() {
  render(
    <MemoryRouter
      initialEntries={[
        "/contacts",
        {
          pathname: "/search",
          search: "?conversation_id=conv_001",
          state: { searchReturnTo: "/contacts" },
        },
      ]}
    >
      <Probe />
      <App />
    </MemoryRouter>,
  );
}

it("Android 外壳注册 /search，scope 传入共享页面而非 modal", async () => {
  mount();
  expect(await screen.findByRole("combobox")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByTestId("location").textContent).toBe("/search?conversation_id=conv_001");
});
it("Android 系统返回恢复原路由，不被外壳兜底送回 /chat", async () => {
  mount();
  await screen.findByRole("combobox");
  act(() => {
    expect((window as Window & { __androidBack__?: () => boolean }).__androidBack__?.()).toBe(true);
  });
  await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/contacts"));
});
it("Android 消息结果定位后导航，不再调用返回覆盖目标", async () => {
  const seek = vi.spyOn(useMessageStore.getState(), "seekToMessage").mockResolvedValue(undefined);
  const requests = vi.spyOn(globalThis, "fetch");
  mount();
  fireEvent.change(await screen.findByRole("combobox"), { target: { value: "季度报告" } });
  fireEvent.click(await screen.findByRole("option", { name: /季度报告写完了/ }));
  await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/chat/conv_001"));
  expect(
    requests.mock.calls.some(([url]) => String(url).includes("conversation_id=conv_001")),
  ).toBe(true);
  expect(useConversationStore.getState().activeId).toBe("conv_001");
  expect(seek).toHaveBeenCalledWith("conv_001", "msg_search_1", 128);
  expect(screen.queryByRole("button", { name: i18n.t("chat.back") })).toBeNull();
});
