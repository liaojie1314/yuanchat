/**
 * A7 聊天体验补全 E2E（MSW mock 模式）
 *
 * 覆盖：清空聊天记录（确认后消息流清空）、群公告横幅点开全文弹层、
 * 群内昵称编辑入口可见并可保存。
 */
import { test, expect } from "@playwright/test";
import { setAuth } from "./fixtures/auth.fixture";
import { waitForMSW } from "./utils/msw";

test.beforeEach(async ({ page }) => {
  await setAuth(page);
  await waitForMSW(page);
  await page.goto("/chat");
});

test("清空聊天记录：确认弹窗出现 → 确认 → 消息流清空", async ({ page }) => {
  await page.getByRole("button", { name: /产品研发群/ }).click();
  await page.getByRole("button", { name: "会话详情" }).click();

  await page.getByText("清空聊天记录").click();
  await expect(page.getByText("确定清空聊天记录？")).toBeVisible();
  await page.getByRole("button", { name: "确认" }).click();

  await expect(page.getByText("暂无消息，打个招呼吧")).toBeVisible();
});

test("群公告横幅点开显示全文弹层", async ({ page }) => {
  await page.getByRole("button", { name: /产品研发群/ }).click();

  const bannerExcerpt = "新人入群请先自我介绍";
  await expect(page.getByText(bannerExcerpt, { exact: false })).toBeVisible();
  await page.getByText(bannerExcerpt, { exact: false }).click();

  const heading = page.getByRole("heading", { name: "群公告" });
  await expect(heading).toBeVisible();
  // 定位到弹层卡片容器（heading 的祖先），避免与横幅重复文本产生 strict-mode 冲突
  const dialogCard = heading.locator("..").locator("..");
  await expect(dialogCard.getByText("核心响应时间", { exact: false })).toBeVisible();
});

test("群内昵称编辑入口可见并可保存", async ({ page }) => {
  await page.getByRole("button", { name: /产品研发群/ }).click();
  await page.getByRole("button", { name: "会话详情" }).click();

  const editButton = page.getByRole("button", { name: "我在本群的昵称" });
  await expect(editButton).toBeVisible();
  await editButton.click();

  const input = page.getByRole("textbox", { name: "我在本群的昵称" });
  await expect(input).toBeVisible();
  await input.fill("新昵称");
  await page.getByRole("button", { name: "确认" }).click();

  // 保存后退出编辑态，回到展示行（本机 mock 成员数据不联动刷新，
  // 展示态仍显示"未设置"——真实后端下由 memberVersion 重拉后端权威值，
  // 见 task-10-brief 手工验收清单第 4 条）
  await expect(input).toBeHidden();
  await expect(page.getByRole("button", { name: "我在本群的昵称" })).toBeVisible();
});
