/**
 * 认证状态夹具 — 操作 localStorage 中的 Zustand authStore 持久化数据
 *
 * @description
 * Zustand persist 中间件在 store 初始化时从 localStorage 水合状态（仅一次）。
 * 因此必须在页面加载前设置好 localStorage，再通过 reload 让 Zustand 读到正确的值。
 *
 * 使用方法：
 * 1. clearAuth(page) — 导航到 / → 清除 localStorage → reload
 *    页面将显示未登录状态（自动重定向到 /login）
 * 2. setAuth(page) — 导航到 / → 设置 localStorage → reload
 *    页面将显示已登录状态（自动重定向到 /chat）
 *
 * ⚠️ 必须是页面首次导航（或 reload），确保 Zustand 初始化时读到正确的 localStorage。
 */

import type { Page } from "@playwright/test";

const AUTH_KEY = "yuanchat-auth";

const AUTH_PAYLOAD = JSON.stringify({
  state: {
    user: { id: "e2e_user", nickname: "E2E Tester" },
    accessToken: "mock_access_token_e2e",
    refreshToken: "mock_refresh_token_e2e",
    isAuthenticated: true,
  },
  version: 0,
});

/**
 * 设置已登录状态
 *
 * 导航到 / 建立 origin，写入认证数据，reload 让 Zustand 水合。
 * 调用后页面停留在已登录状态（/chat 或重定向目标）。
 */
export async function setAuth(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    ({ key, payload }) => {
      localStorage.setItem(key, payload);
    },
    { key: AUTH_KEY, payload: AUTH_PAYLOAD },
  );
  await page.reload();
}

/**
 * 清除认证状态
 *
 * 导航到 / 建立 origin，移除认证数据，reload 让 Zustand 水合。
 * 调用后页面停留在未登录状态（自动重定向到 /login）。
 */
export async function clearAuth(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate((key) => {
    localStorage.removeItem(key);
  }, AUTH_KEY);
  await page.reload();
}
