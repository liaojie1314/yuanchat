/**
 * 登出流程 E2E 测试
 *
 * @description
 * 覆盖：登出按钮清除认证状态并跳转到 /login、
 * 登出后路由守卫生效。
 * 通过完整登录流程获取认证状态，确保测试真实可靠。
 */

import { test, expect } from "@playwright/test";
import { LoginPage } from "./pages/LoginPage";
import { waitForMSW } from "./utils/msw";
import { clearAuth } from "./fixtures/auth.fixture";

test.describe("Logout Flow", () => {
  test("logout button clears auth and redirects to /login", async ({ page }) => {
    // 通过 UI 完成登录（最真实的 E2E 方式）
    await clearAuth(page);
    await waitForMSW(page);
    const loginPage = new LoginPage(page);
    await loginPage.login("testuser", "Abc1234!");
    await page.waitForURL("**/chat");
    expect(page.url()).toContain("/chat");

    // 点击登出按钮（导航栏最后一个 button）
    await page.locator("nav button").last().click();
    await page.waitForURL("**/login");
    expect(page.url()).toContain("/login");

    // 验证 localStorage 中 auth 状态已清除
    const auth = await page.evaluate(() => {
      const raw = localStorage.getItem("yuanchat-auth");
      if (!raw) return null;
      return JSON.parse(raw);
    });
    expect(auth?.state?.isAuthenticated).toBeFalsy();
  });

  test("after logout, /chat redirects to /login", async ({ page }) => {
    // 通过 UI 完成登录
    await clearAuth(page);
    await waitForMSW(page);
    const loginPage = new LoginPage(page);
    await loginPage.login("testuser", "Abc1234!");
    await page.waitForURL("**/chat");

    // 登出
    await page.locator("nav button").last().click();
    await page.waitForURL("**/login");

    // 直接访问 /chat 应被重定向
    await page.goto("/chat");
    await page.waitForURL("**/login");
    expect(page.url()).toContain("/login");
  });
});
