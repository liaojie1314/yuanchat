import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { useAuthStore } from "../store/authStore";

// MSW Server — 在 Node 环境下拦截 fetch 请求
const server = setupServer(
  http.post("http://localhost:8085/api/v1/auth/login", async ({ request }) => {
    const body = (await request.json()) as { account?: string; password?: string };
    if (body.password === "wrong") {
      return HttpResponse.json(
        { code: 40101, message: "账号或密码错误", data: null },
        { status: 401 },
      );
    }
    return HttpResponse.json({
      code: 0,
      message: "ok",
      data: {
        user: { id: "test_user", nickname: body.account || "test" },
        access_token: "token_access",
        refresh_token: "token_refresh",
        expires_in: 900,
      },
    });
  }),

  http.post("http://localhost:8085/api/v1/auth/register/otp", async ({ request }) => {
    const body = (await request.json()) as { email?: string };
    if (!body.email) {
      return HttpResponse.json(
        { code: 400, message: "auth.emailInvalid", data: null },
        {
          status: 400,
        },
      );
    }
    // 同邮箱 60 秒冷却
    if (body.email === "cooldown@yuanchat.com") {
      return HttpResponse.json(
        { code: 429, message: "auth.otpCooldown", data: null },
        {
          status: 429,
        },
      );
    }
    return new HttpResponse(null, { status: 204 });
  }),

  http.post("http://localhost:8085/api/v1/auth/register", async ({ request }) => {
    const body = (await request.json()) as {
      email?: string;
      code?: string;
      password?: string;
      nickname?: string;
      phone?: string;
    };
    if (!body.email) {
      return HttpResponse.json(
        { code: 400, message: "auth.emailInvalid", data: null },
        {
          status: 400,
        },
      );
    }
    if (body.code !== "123456") {
      return HttpResponse.json(
        { code: 400, message: "auth.otpWrong", data: null },
        { status: 400 },
      );
    }
    return HttpResponse.json({
      code: 0,
      message: "ok",
      data: {
        user: {
          id: "new_user",
          nickname: body.nickname || "new",
          email: body.email,
          phone: body.phone ?? null,
        },
        access_token: "token_access_new",
        refresh_token: "token_refresh_new",
        expires_in: 900,
      },
    });
  }),

  http.post("http://localhost:8085/api/v1/auth/logout", () => {
    return HttpResponse.json({ code: 0, message: "ok", data: { message: "logged out" } });
  }),

  http.put("http://localhost:8085/api/v1/users/me", async ({ request }) => {
    const patch = (await request.json()) as { nickname?: string };
    return HttpResponse.json({
      code: 0,
      message: "ok",
      data: {
        id: "test_user",
        nickname: patch.nickname || "老名",
        avatar_url: null,
        short_id: 10001,
        bio: "更新后的签名",
        gender: 2,
        phone: "13800000001",
        email: null,
      },
    });
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

  describe("clearSession", () => {
    it("同步清空令牌与登录态，且不调服务端登出接口", () => {
      let logoutCalls = 0;
      server.use(
        http.post("http://localhost:8085/api/v1/auth/logout", () => {
          logoutCalls += 1;
          return HttpResponse.json({ code: 0, message: "ok", data: null });
        }),
      );
      useAuthStore.setState({
        user: { id: "1", nickname: "Test" },
        accessToken: "token-123",
        refreshToken: "refresh-123",
        expiresAt: Date.now() + 60_000,
        isAuthenticated: true,
      });

      useAuthStore.getState().clearSession();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      expect(state.accessToken).toBeNull();
      expect(state.refreshToken).toBeNull();
      expect(state.expiresAt).toBeNull();
      // 改密后服务端令牌已失效，再打 logout 只会拿 401，因此这里必须是纯本地清理
      expect(logoutCalls).toBe(0);
    });
  });

  describe("sessionFromTokens", () => {
    it("用扫码换出的令牌建立登录态，并拉 /users/me 补齐资料", async () => {
      server.use(
        http.get("http://localhost:8085/api/v1/users/me", () =>
          HttpResponse.json({
            code: 0,
            message: "ok",
            data: { id: "u-1", nickname: "扫码的人", short_id: 10001, gender: 1 },
          }),
        ),
      );

      await useAuthStore
        .getState()
        .sessionFromTokens({ accessToken: "at-1", refreshToken: "rt-1", expiresIn: 3600 });

      const state = useAuthStore.getState();
      expect(state.accessToken).toBe("at-1");
      expect(state.refreshToken).toBe("rt-1");
      expect(state.isAuthenticated).toBe(true);
      expect(state.user?.nickname).toBe("扫码的人");
      // 过期时刻按令牌寿命算，而不是别处那个同名的会话剩余秒数
      expect((state.expiresAt as number) - Date.now()).toBeGreaterThan(3000_000);
    });

    it("拉资料失败时不留半个登录态：清干净并把错误抛给调用方", async () => {
      // 刻意用 500 而不是 401：401 会触发 client 的静默刷新兜底，
      // 刷新失败时 tokenManager 自己就会清登录态，那样这条用例就测不到本方法的清理了
      server.use(
        http.get("http://localhost:8085/api/v1/users/me", () =>
          HttpResponse.json({ code: 500, message: "failed to get profile" }, { status: 500 }),
        ),
      );

      await expect(
        useAuthStore
          .getState()
          .sessionFromTokens({ accessToken: "at-1", refreshToken: "rt-1", expiresIn: 3600 }),
      ).rejects.toBeTruthy();

      const state = useAuthStore.getState();
      // 留着令牌但没有 user，界面会顶着一个没有昵称头像的空账号
      expect(state.isAuthenticated).toBe(false);
      expect(state.accessToken).toBeNull();
      expect(state.refreshToken).toBeNull();
      expect(state.user).toBeNull();
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
        "账号或密码错误",
      );

      // 状态不应改变
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });

  describe("requestRegisterCode", () => {
    it("发码成功（204 空体）即正常返回，且不改动登录态", async () => {
      await expect(
        useAuthStore.getState().requestRegisterCode("new@yuanchat.com"),
      ).resolves.toBeUndefined();

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().accessToken).toBeNull();
    });

    it("只发 email 一个字段", async () => {
      let sent: unknown = null;
      server.use(
        http.post("http://localhost:8085/api/v1/auth/register/otp", async ({ request }) => {
          sent = await request.json();
          return new HttpResponse(null, { status: 204 });
        }),
      );

      await useAuthStore.getState().requestRegisterCode("new@yuanchat.com");

      expect(sent).toEqual({ email: "new@yuanchat.com" });
    });

    it("60 秒冷却内重发抛 429 auth.otpCooldown", async () => {
      await expect(
        useAuthStore.getState().requestRegisterCode("cooldown@yuanchat.com"),
      ).rejects.toMatchObject({ code: 429, message: "auth.otpCooldown" });
    });
  });

  describe("registerWithPassword", () => {
    it("sets auth state on successful registration", async () => {
      await useAuthStore
        .getState()
        .registerWithPassword("new@yuanchat.com", "123456", "Abc1234!", "新用户");

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user?.nickname).toBe("新用户");
      expect(state.user?.email).toBe("new@yuanchat.com");
      expect(state.accessToken).toBe("token_access_new");
    });

    it("请求体只有 email/code/password/nickname，不含 captcha 与 phone 字段", async () => {
      let sent: Record<string, unknown> = {};
      server.use(
        http.post("http://localhost:8085/api/v1/auth/register", async ({ request }) => {
          sent = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({
            code: 0,
            message: "ok",
            data: {
              user: { id: "new_user", nickname: "新用户" },
              access_token: "token_access_new",
              refresh_token: "token_refresh_new",
              expires_in: 900,
            },
          });
        }),
      );

      await useAuthStore
        .getState()
        .registerWithPassword("new@yuanchat.com", "123456", "Abc1234!", "新用户");

      expect(sent).toEqual({
        email: "new@yuanchat.com",
        code: "123456",
        password: "Abc1234!",
        nickname: "新用户",
      });
      // 图形验证码两个字段已从契约里删除，残留会被后端忽略并掩盖前端写错
      expect(sent).not.toHaveProperty("captcha_id");
      expect(sent).not.toHaveProperty("captcha_answer");
    });

    it("注册契约里没有 phone：多传一个手机号实参也不会进请求体", async () => {
      let sent: Record<string, unknown> = {};
      server.use(
        http.post("http://localhost:8085/api/v1/auth/register", async ({ request }) => {
          sent = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({
            code: 0,
            message: "ok",
            data: {
              user: { id: "new_user", nickname: "新用户" },
              access_token: "token_access_new",
              refresh_token: "token_refresh_new",
              expires_in: 900,
            },
          });
        }),
      );

      // 故意绕过类型签名多传一个手机号：只有实现真的把 phone 透传出去才会失败，
      // 这样一旦有人把旧的「手机号选填」实现改回来，这条用例立刻红。
      const register = useAuthStore.getState().registerWithPassword as unknown as (
        ...args: unknown[]
      ) => Promise<void>;
      await register("new@yuanchat.com", "123456", "Abc1234!", "新用户", "13800138000");

      expect(sent).not.toHaveProperty("phone");
    });

    it("验证码错误时抛 400 auth.otpWrong，且不建立登录态", async () => {
      await expect(
        useAuthStore
          .getState()
          .registerWithPassword("new@yuanchat.com", "000000", "Abc1234!", "新用户"),
      ).rejects.toMatchObject({ code: 400, message: "auth.otpWrong" });

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it("throws on missing email", async () => {
      await expect(
        useAuthStore.getState().registerWithPassword("", "123456", "Abc1234!", "user"),
      ).rejects.toThrow("auth.emailInvalid");

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });

  describe("updateProfile", () => {
    it("merges returned profile fields into local user", async () => {
      useAuthStore.setState({
        user: { id: "test_user", nickname: "老名", phone: "13800000001", shortId: 10001 },
        accessToken: "token-123",
        refreshToken: "refresh-123",
        isAuthenticated: true,
      });

      await useAuthStore.getState().updateProfile({ nickname: "新名" });

      const user = useAuthStore.getState().user;
      expect(user?.nickname).toBe("新名");
      expect(user?.bio).toBe("更新后的签名");
      expect(user?.gender).toBe(2);
      // 未被更新接口覆盖的字段保持不变
      expect(user?.phone).toBe("13800000001");
      expect(user?.shortId).toBe(10001);
    });

    it("no-ops when there is no logged-in user", async () => {
      useAuthStore.setState({ user: null, isAuthenticated: false });

      await useAuthStore.getState().updateProfile({ nickname: "新名" });

      expect(useAuthStore.getState().user).toBeNull();
    });
  });
});
