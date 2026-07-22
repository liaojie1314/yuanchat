/**
 * 页面导航 E2E 测试
 *
 * @description
 * 覆盖：登录页 ↔ 注册页之间的链接导航。
 */

import { test, expect } from "@playwright/test";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { waitForMSW } from "./utils/msw";
import { clearAuth } from "./fixtures/auth.fixture";

test.describe("Navigation between login and register", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await waitForMSW(page);
    // clearAuth 后页面已在 /login
  });

  test("'立即注册' link navigates from login to register page", async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.registerLink.click();
    await page.waitForURL("**/register");
    expect(page.url()).toContain("/register");
    await expect(page.getByPlaceholder("昵称")).toBeVisible();
  });

  test("'立即登录' link navigates from register to login page", async ({ page }) => {
    // 先导航到注册页
    await page.goto("/register");
    await waitForMSW(page);
    const registerPage = new RegisterPage(page);
    await registerPage.loginLink.click();
    await page.waitForURL("**/login");
    expect(page.url()).toContain("/login");
    await expect(page.getByPlaceholder("元聊号")).toBeVisible();
  });

  test("form state is independent between pages", async ({ page }) => {
    const loginPage = new LoginPage(page);

    // 在登录页输入
    await loginPage.yuanchatIdInput.fill("myuser");
    expect(await loginPage.yuanchatIdInput.inputValue()).toBe("myuser");

    // 导航到注册页
    await loginPage.registerLink.click();
    await page.waitForURL("**/register");

    // 注册页表单应为空（组件重新挂载）
    const registerPage = new RegisterPage(page);
    expect(await registerPage.nicknameInput.inputValue()).toBe("");

    // 返回登录页
    await registerPage.loginLink.click();
    await page.waitForURL("**/login");

    // 登录页表单已重置
    expect(await loginPage.yuanchatIdInput.inputValue()).toBe("");
  });
});
