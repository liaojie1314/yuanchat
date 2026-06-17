import { describe, it, expect, beforeEach } from "vitest";
import { useAuthStore } from "../store/authStore";

describe("authStore", () => {
  beforeEach(() => {
    // 重置 store 状态
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
    });
  });

  it("starts unauthenticated", () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
  });

  it("logout clears all auth state", async () => {
    // 先设置为已登录
    useAuthStore.setState({
      user: { id: "1", nickname: "Test" },
      accessToken: "token-123",
      refreshToken: "refresh-123",
      isAuthenticated: true,
    });

    await useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
  });
});
