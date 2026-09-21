/**
 * 朋友圈 E2E 测试
 *
 * @description
 * 覆盖：页面可达、feed 渲染出动态、发布页与互动消息页可进入、
 * 导航栏已把朋友圈换上而收藏已移出。
 * 不测真实发布链路（要传对象存储，CI 无真实服务），数据一律走 MSW。
 */

import { test, expect } from "@playwright/test";
import { setAuth } from "./fixtures/auth.fixture";
import { waitForMSW } from "./utils/msw";

test.describe("Moments", () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page);
    await waitForMSW(page);
    await page.goto("/moments");
  });

  test("moments page is accessible and renders the feed", async ({ page }) => {
    await expect(page).toHaveURL(/\/moments/);
    // 标题用 heading 定位：导航项也叫「朋友圈」，getByText 会命中两处
    await expect(page.getByRole("heading", { name: "朋友圈" })).toBeVisible();
    // MSW 的 feed 有数据，骨架屏退场后应看得到点赞/评论按钮
    await expect(page.getByRole("button", { name: "赞" }).first()).toBeVisible();
  });

  test("compose page opens from the publish button", async ({ page }) => {
    await page.getByRole("button", { name: "发布" }).click();
    await expect(page).toHaveURL(/\/moments\/compose/);
    await expect(page.getByPlaceholder("这一刻的想法…")).toBeVisible();
  });

  test("activities page is accessible", async ({ page }) => {
    await page.getByRole("button", { name: "互动消息" }).click();
    await expect(page).toHaveURL(/\/moments\/activities/);
  });

  test("nav carries moments and no longer carries favorites", async ({ page }) => {
    await expect(page.getByRole("link", { name: "朋友圈" }).first()).toBeVisible();
    // 收藏已从导航移到设置页，导航里不该再有入口
    await expect(page.getByRole("link", { name: "我的收藏" })).toHaveCount(0);
  });
});
