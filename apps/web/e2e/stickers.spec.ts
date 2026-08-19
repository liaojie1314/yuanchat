/**
 * 贴纸功能 E2E 测试
 *
 * 前置条件：
 * - 后端运行在 localhost:8080
 * - 测试账号已创建（通过 setup）
 * - 至少一个官方表情包已存在（需 seed 数据）
 */
import { test, expect } from "@playwright/test";

const TEST_USER = {
  username: process.env.E2E_USERNAME || "testuser_sticker",
  password: process.env.E2E_PASSWORD || "Test123456!",
};

test.describe("Sticker Functionality", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[type="text"]', TEST_USER.username);
    await page.fill('input[type="password"]', TEST_USER.password);
    await page.click('button[type="submit"]');
    await page.waitForURL("/chat");
  });

  test("should open emoji picker and show sticker tabs", async ({ page }) => {
    // 点击表情按钮打开面板
    await page.click('[aria-label*="表情"], [aria-label*="Emoji"]');

    // 验证贴纸 tab 存在（收藏 + 官方）
    await expect(page.getByRole("tab", { name: /收藏|Favorites/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /官方|Official/i })).toBeVisible();
  });

  test("should switch between emoji and sticker tabs", async ({ page }) => {
    await page.click('[aria-label*="表情"], [aria-label*="Emoji"]');

    // 切换到官方贴纸 tab
    await page.getByRole("tab", { name: /官方|Official/i }).click();

    // 验证显示贴纸网格（4 列）
    const stickerGrid = page.locator(".grid-cols-4").first();
    await expect(stickerGrid).toBeVisible();

    // 切换回 emoji tab
    const emojiTab = page.getByRole("tab", { name: /笑脸|Smileys/i }).first();
    await emojiTab.click();

    // 验证显示 emoji 网格（8 列）
    const emojiGrid = page.locator(".grid-cols-8").first();
    await expect(emojiGrid).toBeVisible();
  });

  test("should add image to sticker favorites via context menu", async ({ page }) => {
    // 进入有图片消息的会话（需预先存在）
    const firstConv = page.locator('[data-testid="conversation-item"]').first();
    await firstConv.click();

    // 等待消息加载
    await page.waitForTimeout(500);

    // 查找图片消息
    const imageMsg = page.locator('[data-kind="image"]').first();
    if ((await imageMsg.count()) === 0) {
      test.skip(true, "No image message found in conversation");
    }

    // 右键图片消息
    await imageMsg.click({ button: "right" });

    // 点击"添加到表情"菜单项
    const addMenuItem = page.getByRole("menuitem", { name: /添加到表情|Add to stickers/i });
    await expect(addMenuItem).toBeVisible();
    await addMenuItem.click();

    // 等待 toast 提示
    await expect(page.locator("text=/已添加|Added/i")).toBeVisible({ timeout: 2000 });
  });

  test("should show added sticker in favorites tab", async ({ page }) => {
    await page.click('[aria-label*="表情"], [aria-label*="Emoji"]');

    // 切换到收藏 tab
    await page.getByRole("tab", { name: /收藏|Favorites/i }).click();

    // 验证至少有一个收藏贴纸（如果之前添加成功）
    const favGrid = page.locator(".grid-cols-4").first();
    const stickerButtons = favGrid.locator("button");
    const count = await stickerButtons.count();

    if (count === 0) {
      test.skip(true, "No stickers in favorites (run add test first)");
    }

    await expect(stickerButtons.first()).toBeVisible();
  });

  test("should send sticker by clicking in picker", async ({ page }) => {
    await page.click('[aria-label*="表情"], [aria-label*="Emoji"]');

    // 切换到官方贴纸
    await page.getByRole("tab", { name: /官方|Official/i }).click();

    const stickerGrid = page.locator(".grid-cols-4").first();
    const firstSticker = stickerGrid.locator("button").first();

    if ((await firstSticker.count()) === 0) {
      test.skip(true, "No official stickers available (seed required)");
    }

    await firstSticker.click();

    // 验证面板关闭
    await expect(page.getByRole("dialog", { name: /表情|Emoji/i })).not.toBeVisible({
      timeout: 1000,
    });

    // 验证贴纸消息出现在聊天流
    const stickerMsg = page.locator('[data-kind="sticker"]').last();
    await expect(stickerMsg).toBeVisible({ timeout: 2000 });
  });

  test("should remove sticker from favorites via context menu", async ({ page }) => {
    await page.click('[aria-label*="表情"], [aria-label*="Emoji"]');
    await page.getByRole("tab", { name: /收藏|Favorites/i }).click();

    const favGrid = page.locator(".grid-cols-4").first();
    const firstSticker = favGrid.locator("button").first();

    if ((await firstSticker.count()) === 0) {
      test.skip(true, "No stickers to remove");
    }

    // 右键收藏贴纸
    await firstSticker.click({ button: "right" });

    // 点击删除菜单项
    const removeMenuItem = page.getByRole("menuitem", { name: /移除|Remove/i });
    await expect(removeMenuItem).toBeVisible();
    await removeMenuItem.click();

    // 验证贴纸从列表消失
    await page.waitForTimeout(300);
    const newCount = await favGrid.locator("button").count();
    expect(newCount).toBeLessThan(await firstSticker.count());
  });
});
