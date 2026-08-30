/**
 * 已登录状态下的主导航区域 E2E 测试
 *
 * @description
 * 覆盖：聊天/通讯录/我的收藏/设置四大区域在已登录状态下可正常访问。
 * 通过 setAuth 直接注入认证状态，跳过 UI 登录流程节省时间。
 */

import { test, expect } from "@playwright/test";
import { setAuth } from "./fixtures/auth.fixture";
import { waitForMSW } from "./utils/msw";

test.describe("Authenticated Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page);
    await waitForMSW(page);
  });

  test("chat page renders after login", async ({ page }) => {
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/chat/);
    // 侧边栏或底部导航存在（布局正常挂载）
    await expect(page.locator("nav").first()).toBeVisible();
  });

  test("contacts page is accessible", async ({ page }) => {
    await page.goto("/contacts");
    await expect(page).toHaveURL(/\/contacts/);
  });

  test("favorites page is accessible", async ({ page }) => {
    await page.goto("/favorites");
    await expect(page).toHaveURL(/\/favorites/);
  });

  test("sticker market page is accessible", async ({ page }) => {
    await page.goto("/stickers");
    await expect(page).toHaveURL(/\/stickers/);
  });

  test("settings page is accessible", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings/);
  });

  test("navigates between sections via sidebar links", async ({ page }) => {
    await page.goto("/chat");

    // 点击通讯录导航链接（桌面侧边栏的 title 属性或文本内容）
    await page.getByRole("link", { name: "通讯录" }).first().click();
    await expect(page).toHaveURL(/\/contacts/);

    // 点击我的收藏
    await page.getByRole("link", { name: "我的收藏" }).first().click();
    await expect(page).toHaveURL(/\/favorites/);

    // 点击表情商城（桌面侧栏第 5 项）
    await page.getByRole("link", { name: "表情商城" }).first().click();
    await expect(page).toHaveURL(/\/stickers/);

    // 点击设置
    await page.getByRole("link", { name: "设置" }).first().click();
    await expect(page).toHaveURL(/\/settings/);

    // 返回消息
    await page.getByRole("link", { name: "消息" }).first().click();
    await expect(page).toHaveURL(/\/chat/);
  });
});
