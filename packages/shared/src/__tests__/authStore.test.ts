import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { useAuthStore } from "../store/authStore";

// MSW Server — 在 Node 环境下拦截 fetch 请求
const server = setupServer(
  http.post("http://localhost:8080/api/v1/users/login", async ({ request }) => {
    const body = (await request.json()) as { yuanchat_id?: string; password?: string };
    if (body.password === "wrong") {
      return HttpResponse.json(
        { code: 40101, message: "元聊号或密码错误", data: null },
        { status: 401 },
      );
    }
    return HttpResponse.json({
      code: 0,
      message: "ok",
      data: {
        user: { id: "test_user", nickname: body.yuanchat_id || "test" },
        access_token: "token_access",
        refresh_token: "token_refresh",
        expires_in: 900,
      },
    });
  }),

  http.post("http://localhost:8080/api/v1/users/register", async ({ request }) => {
    const body = (await request.json()) as { phone?: string; password?: string; nickname?: string };
    if (!body.phone) {
      return HttpResponse.json(
        { code: 40003, message: "手机号不能为空", data: null },
        { status: 400 },
      );
    }
    return HttpResponse.json({
      code: 0,
      message: "ok",
      data: {
        user: { id: "new_user", nickname: body.nickname || "new", phone: body.phone },
        access_token: "token_access_new",
        refresh_token: "token_refresh_new",
        expires_in: 900,
      },
    });
  }),

  http.post("http://localhost:8080/api/v1/auth/logout", () => {
    return HttpResponse.json({ code: 0, message: "ok", data: { message: "logged out" } });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

describe("authStore", () => {
  beforeEach(() => {
    server.resetHandlers();
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

  describe("logout", () => {
    it("clears all auth state", async () => {
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

  describe("loginWithPassword", () => {
    it("sets auth state on successful login", async () => {
      await useAuthStore.getState().loginWithPassword("testuser", "password123");

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).not.toBeNull();
      expect(state.user?.nickname).toBe("testuser");
      expect(state.accessToken).toBe("token_access");
      expect(state.refreshToken).toBe("token_refresh");
    });

    it("throws on wrong password", async () => {
      await expect(useAuthStore.getState().loginWithPassword("testuser", "wrong")).rejects.toThrow(
        "元聊号或密码错误",
      );

      // 状态不应改变
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });

  describe("registerWithPassword", () => {
    it("sets auth state on successful registration", async () => {
      await useAuthStore
        .getState()
        .registerWithPassword("13800138000", "Abc1234!", "captcha_id", 1234, "新用户");

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user?.nickname).toBe("新用户");
      expect(state.user?.phone).toBe("13800138000");
      expect(state.accessToken).toBe("token_access_new");
    });

    it("throws on missing phone", async () => {
      await expect(
        useAuthStore.getState().registerWithPassword("", "Abc1234!", "id", 1234, "user"),
      ).rejects.toThrow("手机号不能为空");

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });
});
