/**
 * 会话置顶/免打扰 E2E（MSW mock 模式：applyConversationSetting 走纯本地分支）
 */
import { test, expect } from "@playwright/test";
import { setAuth } from "./fixtures/auth.fixture";
import { waitForMSW } from "./utils/msw";

test.beforeEach(async ({ page }) => {
  await setAuth(page);
  await waitForMSW(page);
  await page.goto("/chat");
});

test("右键会话呼出菜单并取消置顶", async ({ page }) => {
  const item = page.getByRole("button", { name: /产品研发群/ });
  await item.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "取消置顶" })).toBeVisible();
  await page.getByRole("menuitem", { name: "取消置顶" }).click();
  // 状态翻转：再次右键显示「置顶」
  await item.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "置顶" })).toBeVisible();
});

test("免打扰后未读徽章灰显", async ({ page }) => {
  const item = page.getByRole("button", { name: /张伟/ });
  // 免打扰前徽章红色
  const badge = item.locator("span", { hasText: /^1$/ }).last();
  await expect(badge).toHaveClass(/bg-red-500/);
  await item.click({ button: "right" });
  await page.getByRole("menuitem", { name: "免打扰" }).click();
  await expect(badge).toHaveClass(/bg-outline/);
});
