/** 登录提交已有密码，注册继续执行新密码强度规则；只替换 HTTP 服务端。 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { useAuthStore } from "@yuanchat/shared";
import i18n from "@yuanchat/design-system/i18n";
import { LoginPage as NativeLoginPage } from "../pages/LoginPage";
import { RegisterPage as NativeRegisterPage } from "../pages/RegisterPage";
import { LoginPage as WebLoginPage } from "../../../web/src/pages/LoginPage";
import { RegisterPage as WebRegisterPage } from "../../../web/src/pages/RegisterPage";

const requests: { path: string; body: unknown }[] = [];
const server = setupServer(
  http.post("*/api/v1/auth/:action", async ({ request }) => {
    requests.push({ path: new URL(request.url).pathname, body: await request.json() });
    return HttpResponse.json({
      code: 0,
      message: "ok",
      data: {
        user: { id: "test-user", nickname: "Test user" },
        access_token: "test-access-token",
        refresh_token: "test-refresh-token",
        expires_in: 900,
      },
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  requests.length = 0;
  useAuthStore.setState({
    user: null,
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
    isAuthenticated: false,
  });
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});

describe.each([
  { platform: "Web", LoginPage: WebLoginPage, RegisterPage: WebRegisterPage },
  { platform: "Desktop/Android", LoginPage: NativeLoginPage, RegisterPage: NativeRegisterPage },
])("$platform 密码校验", ({ LoginPage, RegisterPage }) => {
  it.each(["LegacyPasswordABCxyz", "old", " legacy password "])(
    "已有密码原样提交给登录服务：%s",
    async (password) => {
      render(
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>,
      );
      fireEvent.change(screen.getByPlaceholderText(i18n.t("auth.accountPlaceholder")), {
        target: { value: "test@example.com" },
      });
      fireEvent.change(screen.getByPlaceholderText(i18n.t("auth.password")), {
        target: { value: password },
      });
      fireEvent.click(screen.getByRole("button", { name: i18n.t("auth.login") }));
      await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(true));
      expect(requests).toEqual([
        { path: "/api/v1/auth/login", body: { account: "test@example.com", password } },
      ]);
    },
  );

  it("空密码在登录表单提示必填，不发请求", async () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByPlaceholderText(i18n.t("auth.accountPlaceholder")), {
      target: { value: "test@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: i18n.t("auth.login") }));
    await screen.findByText(i18n.t("auth.passwordRequired"));
    expect(requests).toEqual([]);
  });

  it.each([
    { password: "LegacyPasswordABCxyz", allowed: false },
    { password: "FreshPassword1", allowed: true },
  ])("注册新密码仍执行强度规则：$password", async ({ password, allowed }) => {
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByPlaceholderText(i18n.t("auth.nickname")), {
      target: { value: "Test user" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: i18n.t("auth.email") }), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText(i18n.t("auth.otpPlaceholder")), {
      target: { value: "123456" },
    });
    fireEvent.change(screen.getByPlaceholderText(i18n.t("auth.passwordPlaceholder")), {
      target: { value: password },
    });
    fireEvent.click(screen.getByRole("button", { name: i18n.t("auth.register") }));
    if (!allowed) {
      await screen.findByText(i18n.t("validation.passwordDigit"));
      expect(requests).toEqual([]);
      return;
    }
    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(true));
    expect(requests).toEqual([
      {
        path: "/api/v1/auth/register",
        body: { email: "test@example.com", code: "123456", password, nickname: "Test user" },
      },
    ]);
  });
});
