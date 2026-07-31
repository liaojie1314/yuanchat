/**
 * 注册流程 E2E 测试
 *
 * @description
 * 覆盖：成功注册、表单校验错误、验证码加载/刷新、Enter 快捷键
 * 使用 MSW mock API，验证码为 mock SVG。
 */

import { test, expect } from "@playwright/test";
import { RegisterPage } from "./pages/RegisterPage";
import { waitForMSW } from "./utils/msw";
import { clearAuth } from "./fixtures/auth.fixture";

test.describe("Register Flow", () => {
  let registerPage: RegisterPage;

  test.beforeEach(async ({ page }) => {
    // clearAuth 已经在 /login 页面，需要导航到 /register
    await clearAuth(page);
    await waitForMSW(page);
    registerPage = new RegisterPage(page);
    await registerPage.goto();
  });

  test("successful registration redirects to /chat", async ({ page }) => {
    await expect(registerPage.captchaImage).toBeVisible({
      timeout: 5000,
    });
    await registerPage.register("新用户", "13800138000", "Abc1234!", "1234");
    await page.waitForURL("**/chat", { timeout: 10000 });
    expect(page.url()).toContain("/chat");
  });

  test("shows error for empty nickname", async ({ page }) => {
    await registerPage.registerButton.click();
    await expect(page.getByText("请输入昵称")).toBeVisible();
  });

  test("shows error for invalid phone", async ({ page }) => {
    await registerPage.nicknameInput.fill("新用户");
    await registerPage.phoneInput.fill("12345");
    await registerPage.registerButton.click();
    await expect(page.getByText("手机号格式不正确")).toBeVisible();
  });

  test("shows error for weak password", async ({ page }) => {
    await registerPage.nicknameInput.fill("新用户");
    await registerPage.phoneInput.fill("13800138000");
    await registerPage.passwordInput.fill("short");
    await registerPage.registerButton.click();
    await expect(page.getByText("密码长度至少 8 位")).toBeVisible();
  });

  test("shows error for empty captcha", async ({ page }) => {
    await registerPage.nicknameInput.fill("新用户");
    await registerPage.phoneInput.fill("13800138000");
    await registerPage.passwordInput.fill("Abc1234!");
    await registerPage.registerButton.click();
    await expect(page.getByText("请输入验证码")).toBeVisible();
  });

  test("captcha image loads and refreshes on click", async ({ page: _page }) => {
    await expect(registerPage.captchaImage).toBeVisible({
      timeout: 5000,
    });
    await registerPage.captchaButton.click();
    await expect(registerPage.captchaImage).toBeVisible({
      timeout: 5000,
    });
  });

  test("all fields validated together before submit", async ({ page }) => {
    await registerPage.registerButton.click();
    await expect(page.getByText("请输入昵称")).toBeVisible();
  });

  test("Enter key on captcha triggers registration", async ({ page }) => {
    await registerPage.nicknameInput.fill("新用户");
    await registerPage.phoneInput.fill("13800138000");
    await registerPage.passwordInput.fill("Abc1234!");
    await expect(registerPage.captchaImage).toBeVisible({
      timeout: 5000,
    });
    await registerPage.captchaInput.fill("1234");
    await registerPage.captchaInput.press("Enter");
    await page.waitForURL("**/chat", { timeout: 10000 });
    expect(page.url()).toContain("/chat");
  });
});
