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

  test("shows error for empty 元聊号", async ({ page }) => {
    await loginPage.passwordInput.fill("Abc1234!");
    await loginPage.loginButton.click();
    await expect(page.getByText("请输入元聊号")).toBeVisible();
  });

  test("shows error for empty password", async ({ page }) => {
    await loginPage.yuanchatIdInput.fill("testuser");
    await loginPage.loginButton.click();
    await expect(page.getByText("密码长度至少 8 位")).toBeVisible();
  });

  test("shows error for weak password (missing special char)", async ({ page }) => {
    await loginPage.yuanchatIdInput.fill("testuser");
    await loginPage.passwordInput.fill("Abc12345");
    await loginPage.loginButton.click();
    await expect(page.getByText("密码需包含特殊字符")).toBeVisible();
  });

  test("shows error for wrong credentials", async ({ page }) => {
    // 使用满足客户端校验的密码（8+ 位、大小写+数字+特殊字符），
    // 但 MSW mock 将此密码视为错误凭据
    await loginPage.login("testuser", "Wrong@1234");
    await expect(page.getByText("元聊号或密码错误")).toBeVisible();
  });

  test("shows error for short 元聊号", async ({ page }) => {
    await loginPage.login("ab", "Abc1234!");
    await expect(page.getByText("元聊号长度至少 3 位")).toBeVisible();
  });

  test("Enter key triggers login", async ({ page }) => {
    await loginPage.yuanchatIdInput.fill("testuser");
    await loginPage.passwordInput.fill("Abc1234!");
    await loginPage.passwordInput.press("Enter");
    await page.waitForURL("**/chat");
    expect(page.url()).toContain("/chat");
  });
});
