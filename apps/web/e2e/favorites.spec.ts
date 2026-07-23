/**
 * 收藏页 E2E 测试
 *
 * @description
 * 覆盖：页面可访问、四个分类 Tab 按钮可见且可点击。
 * 不测试具体收藏项加载（依赖后端，CI 无真实服务）。
 */

import { test, expect } from "@playwright/test";
import { setAuth } from "./fixtures/auth.fixture";
import { waitForMSW } from "./utils/msw";

test.describe("Favorites Page", () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page);
    await waitForMSW(page);
    await page.goto("/favorites");
  });

  test("favorites page is accessible", async ({ page }) => {
    await expect(page).toHaveURL(/\/favorites/);
  });

  test("tab filter buttons are visible", async ({ page }) => {
    await expect(page.getByRole("button", { name: "全部" })).toBeVisible();
    await expect(page.getByRole("button", { name: "文字" })).toBeVisible();
    await expect(page.getByRole("button", { name: "图片" })).toBeVisible();
    await expect(page.getByRole("button", { name: "文件" })).toBeVisible();
  });

  test("clicking a tab does not crash the page", async ({ page }) => {
    await page.getByRole("button", { name: "文字" }).click();
    await expect(page).toHaveURL(/\/favorites/);
    // 页面仍然存在（非崩溃验证）
    await expect(page.getByRole("button", { name: "全部" })).toBeVisible();
  });
});
