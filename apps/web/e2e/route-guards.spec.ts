/**
 * 路由守卫 E2E 测试
 *
 * @description
 * 覆盖：未登录状态下受保护路由重定向到 /login、
 * 已登录状态下 /login /register 重定向到 /chat。
 * 验证 App 组件中的认证门控逻辑。
 */

import { test, expect } from "@playwright/test";
import { setAuth, clearAuth } from "./fixtures/auth.fixture";
import { waitForMSW } from "./utils/msw";

test.describe("Route Guards — Unauthenticated", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await waitForMSW(page);
    // clearAuth 后页面已在 /login
  });

  test("/ redirects to /login", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL("**/login");
    expect(page.url()).toContain("/login");
  });

  test("/chat redirects to /login", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForURL("**/login");
    expect(page.url()).toContain("/login");
  });

  test("/contacts redirects to /login", async ({ page }) => {
    await page.goto("/contacts");
    await page.waitForURL("**/login");
    expect(page.url()).toContain("/login");
  });

  test("/settings redirects to /login", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForURL("**/login");
    expect(page.url()).toContain("/login");
  });

  test("unknown route redirects to /login", async ({ page }) => {
    await page.goto("/nonexistent-route");
    await page.waitForURL("**/login");
    expect(page.url()).toContain("/login");
  });

  test("/login page is accessible", async ({ page }) => {
    await page.goto("/login");
    expect(page.url()).toContain("/login");
    await expect(page.getByPlaceholder("元聊号")).toBeVisible();
  });

  test("/register page is accessible", async ({ page }) => {
    await page.goto("/register");
    expect(page.url()).toContain("/register");
    await expect(page.getByPlaceholder("昵称")).toBeVisible();
  });
});

test.describe("Route Guards — Authenticated", () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page);
    await waitForMSW(page);
    // setAuth 后页面已在 /chat
  });

  test("/login redirects to /chat", async ({ page }) => {
    await page.goto("/login");
    await page.waitForURL("**/chat");
    expect(page.url()).toContain("/chat");
  });

  test("/register redirects to /chat", async ({ page }) => {
    await page.goto("/register");
    await page.waitForURL("**/chat");
    expect(page.url()).toContain("/chat");
  });

  test("/chat is accessible", async ({ page }) => {
    await page.goto("/chat");
    expect(page.url()).toContain("/chat");
  });
});
