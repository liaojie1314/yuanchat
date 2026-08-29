/**
 * 扫码登录 E2E 测试
 *
 * @description
 * 覆盖：二维码渲染、轮询推进到 confirmed 后进入主界面、扫描态提示。
 * 使用 MSW mock API（VITE_ENABLE_MOCK=true），无需真实后端。
 *
 * MSW 侧约定：轮询第 1 次回 pending、第 2 次回 scanned、第 3 次回 confirmed 并交出令牌；
 * 前端轮询间隔 2 秒，故约 6 秒后进入 /chat。
 */

import { test, expect } from "@playwright/test";
import { waitForMSW } from "./utils/msw";
import { clearAuth } from "./fixtures/auth.fixture";

test.describe("扫码登录", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await waitForMSW(page);
    await page.goto("/qr-login");
  });

  test("渲染二维码并在确认后进入主界面", async ({ page }) => {
    await expect(page.getByTestId("qr-code")).toBeVisible();

    // 轮询到 scanned 时给出「请在手机上确认」提示
    await expect(page.getByText("已扫描")).toBeVisible({ timeout: 15_000 });

    // 第 3 次轮询拿到令牌，写入登录态并跳转
    await page.waitForURL("**/chat", { timeout: 15_000 });
    expect(page.url()).toContain("/chat");
  });

  test("二维码内容不包含轮询密钥", async ({ page }) => {
    // poll_secret 只在建会话响应里出现；一旦编进二维码，
    // 拍到屏幕的人就能抢先轮询取走令牌
    const qr = page.getByTestId("qr-code");
    await expect(qr).toBeVisible();
    await expect(qr).not.toContainText("mock-qr-poll-secret");

    const html = await qr.innerHTML();
    expect(html).not.toContain("mock-qr-poll-secret");
  });
});
