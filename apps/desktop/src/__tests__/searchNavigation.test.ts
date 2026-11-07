/** 跨窗口动作在主上下文执行，不能当普通空路径导航。 */
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useAuthStore, useConversationStore, useThemeStore } from "@yuanchat/shared";
import { applySearchNavigation } from "../hooks/useSearchWindow";

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: true, user: { id: "search-user", nickname: "甲" } });
});

it("切换主题在主窗口 store 落地且不改变路由", () => {
  const navigate = vi.fn();
  const original = useThemeStore.getState().mode;
  applySearchNavigation({ userId: "search-user", path: "", action: "toggle-theme" }, navigate);
  expect(useThemeStore.getState().mode).not.toBe(original);
  expect(navigate).not.toHaveBeenCalled();
});
it("登出清主窗口登录态，而不是只清独立窗口", async () => {
  useAuthStore.setState({ isAuthenticated: true, accessToken: "test", refreshToken: null });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ status: 200, json: async () => ({ code: 0, data: {} }) }),
  );
  const navigate = vi.fn();
  applySearchNavigation({ userId: "search-user", path: "", action: "logout" }, navigate);
  await vi.waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false));
  expect(navigate).not.toHaveBeenCalled();
});
it("会话定位仍先设置主窗口 activeId 再导航", () => {
  useConversationStore.setState({ activeId: null });
  const navigate = vi.fn(() => expect(useConversationStore.getState().activeId).toBe("c1"));
  applySearchNavigation(
    { userId: "search-user", path: "/chat/c1", conversationId: "c1" },
    navigate,
  );
  expect(navigate).toHaveBeenCalledWith("/chat/c1");
});

it.each([false, true])(
  "拒绝登出或切换账号后旧搜索窗口迟到的结果（当前登录=%s）",
  (isAuthenticated) => {
    useAuthStore.setState({
      isAuthenticated,
      user: isAuthenticated ? { id: "new-user", nickname: "乙" } : null,
    });
    useConversationStore.setState({ activeId: null });
    const navigate = vi.fn();
    applySearchNavigation(
      { userId: "search-user", path: "/chat/private", conversationId: "private" },
      navigate,
    );
    expect(useConversationStore.getState().activeId).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  },
);
