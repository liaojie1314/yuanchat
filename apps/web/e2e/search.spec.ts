/**
 * 全局搜索浮层 E2E 测试
 *
 * @description
 * 覆盖：Ctrl/Cmd+K 打开搜索弹窗、输入框自动聚焦、
 * Escape 关闭、关闭按钮关闭、打开时显示提示文案。
 */

import { test, expect } from "@playwright/test";
import { setAuth } from "./fixtures/auth.fixture";
import { waitForMSW } from "./utils/msw";

test.describe("Global Search Modal (Cmd/Ctrl+K)", () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page);
    await waitForMSW(page);
    await page.goto("/chat");
  });

  test("Ctrl+K opens search dialog", async ({ page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog", { name: "搜索消息" })).toBeVisible();
  });

  test("Meta+K opens search dialog (macOS)", async ({ page }) => {
    await page.keyboard.press("Meta+k");
    await expect(page.getByRole("dialog", { name: "搜索消息" })).toBeVisible();
  });

  test("search input is focused when modal opens", async ({ page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.getByPlaceholder("搜索聊天记录…")).toBeFocused();
  });

  test("Escape closes search dialog", async ({ page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog", { name: "搜索消息" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "搜索消息" })).not.toBeVisible();
  });

  test("close button closes search dialog", async ({ page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog", { name: "搜索消息" })).toBeVisible();
    await page.getByRole("button", { name: "关闭搜索" }).click();
    await expect(page.getByRole("dialog", { name: "搜索消息" })).not.toBeVisible();
  });

  test("shows hint before typing", async ({ page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.getByText("输入至少 3 个字符")).toBeVisible();
  });
});
