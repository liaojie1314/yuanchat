/**
 * 登录流程 E2E 测试
 *
 * @description
 * 覆盖：成功登录、表单校验错误、API 错误、Enter 快捷键
 * 使用 MSW mock API（VITE_ENABLE_MOCK=true），无需真实后端。
 */

import { test, expect } from "@playwright/test";
import { LoginPage } from "./pages/LoginPage";
import { waitForMSW } from "./utils/msw";
import { clearAuth } from "./fixtures/auth.fixture";

test.describe("Login Flow", () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    // clearAuth 已经在 /login 页面（/ → reload → 未登录 → 重定向到 /login）
    await clearAuth(page);
    await waitForMSW(page);
    loginPage = new LoginPage(page);
  });

  test("successful login redirects to /chat", async ({ page }) => {
    await loginPage.login("testuser", "Abc1234!");
    await page.waitForURL("**/chat");
    expect(page.url()).toContain("/chat");
  });

  test("shows error for empty 账号", async ({ page }) => {
    await loginPage.passwordInput.fill("Abc1234!");
    await loginPage.loginButton.click();
    await expect(page.getByText("请输入账号")).toBeVisible();
  });

  test("shows error for empty password", async ({ page }) => {
    await loginPage.yuanchatIdInput.fill("testuser");
    await loginPage.loginButton.click();
    await expect(page.getByText("密码长度至少 8 位")).toBeVisible();
  });

  test("shows error for weak password (contains whitespace)", async ({ page }) => {
    await loginPage.yuanchatIdInput.fill("testuser");
    await loginPage.passwordInput.fill("Abcdef 12");
    await loginPage.loginButton.click();
    await expect(page.getByText("密码不能包含空白字符")).toBeVisible();
  });

  test("shows error for wrong credentials", async ({ page }) => {
    // 使用满足客户端校验的密码（8-64 字节、含大小写与数字、无空白），
    // 但 MSW mock 将此密码视为错误凭据
    await loginPage.login("testuser", "Wrong@1234");
    await expect(page.getByText("账号或密码错误")).toBeVisible();
  });

  // 账号可以是手机号 / 邮箱 / 元聊号三种形态，前端只校验非空。
  // 此前这里用元聊号规则校验（禁 @），邮箱账号在发出请求之前就被挡掉了，
  // 而登录接口本来就接受邮箱 —— 所以这条用例守的是「邮箱能走到服务端」。
  test("邮箱账号不被前端校验拦截", async ({ page }) => {
    await loginPage.login("user@example.com", "Abc1234!");
    await page.waitForURL("**/chat");
    expect(page.url()).toContain("/chat");
  });

  test("Enter key triggers login", async ({ page }) => {
    await loginPage.yuanchatIdInput.fill("testuser");
    await loginPage.passwordInput.fill("Abc1234!");
    await loginPage.passwordInput.press("Enter");
    await page.waitForURL("**/chat");
    expect(page.url()).toContain("/chat");
  });
});
