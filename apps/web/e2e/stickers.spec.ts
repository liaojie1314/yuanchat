/**
 * 贴纸功能 E2E 测试
 *
 * @description
 * 全程跑在仓库既有的 mock 模式（MSW + demo 数据）下，与其他 spec 一致：
 * `setAuth` 写认证态、`waitForMSW` 等 Service Worker 激活，不依赖真实后端/seed。
 *
 * @remarks 原实现有四类问题，此处逐条修掉：
 * 1. 走真实登录表单 + 真实后端（CI 无后端，必挂）→ 改用仓库夹具
 * 2. 用了应用里不存在的选择器（`[data-kind]` / `[data-testid="conversation-item"]`）
 *    → 改用真实存在的 `[data-kind]`（气泡本体上的属性）、`[data-sticker-id]`、
 *    role=tab/menuitem + 实际文案
 * 3. 6 个用例里 4 个带 `test.skip(...)` 兜底 → 前置条件不满足时静默通过，
 *    等于没测；现在 mock 数据保证前置条件成立，断言直接失败暴露问题
 * 4. 末条断言拿 `newCount < firstSticker.count()`（后者恒为 0/1）→ 改为
 *    删除前后的真实数量对比
 */
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { setAuth } from "./fixtures/auth.fixture";
import { waitForMSW } from "./utils/msw";

/** locale 固定为 zh-CN（见 playwright.config.ts），故直接用中文文案定位。 */
const TXT = {
  emojiBtn: "表情",
  tabFavorites: "收藏",
  tabOfficial: "官方",
  addToStickers: "添加到表情",
  removeSticker: "删除",
  addSuccess: "已添加",
  sendSticker: "发送表情",
};

/** 打开第一个会话（demo 数据的「产品研发群」，内含图片消息）。 */
async function openFirstConversation(page: Page) {
  await page.goto("/chat");
  const conv = page.getByText("产品研发群").first();
  await conv.click();
  // 图片气泡出现即说明消息流已渲染
  await expect(page.locator('[data-kind="image"]').first()).toBeVisible();
}

/** 打开表情面板并切到指定贴纸 tab。 */
async function openStickerTab(page: Page, tab: "收藏" | "官方") {
  await page.getByRole("button", { name: TXT.emojiBtn }).first().click();
  const picker = page.getByRole("dialog", { name: TXT.emojiBtn });
  await expect(picker).toBeVisible();
  await picker.getByRole("tab", { name: tab }).click();
  return picker;
}

test.describe("贴纸功能", () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page);
    await waitForMSW(page);
    await openFirstConversation(page);
  });

  test("表情面板同时提供收藏与官方两个贴纸 tab", async ({ page }) => {
    await page.getByRole("button", { name: TXT.emojiBtn }).first().click();
    const picker = page.getByRole("dialog", { name: TXT.emojiBtn });
    await expect(picker.getByRole("tab", { name: TXT.tabFavorites })).toBeVisible();
    await expect(picker.getByRole("tab", { name: TXT.tabOfficial })).toBeVisible();
  });

  test("官方 tab 列出 mock 表情包的全部贴纸", async ({ page }) => {
    const picker = await openStickerTab(page, "官方");
    // MSW 的官方包固定 8 张；数量断言能同时抓住「一张没出」和「聚合逻辑漏包」
    await expect(picker.locator("[data-sticker-id]")).toHaveCount(8);
  });

  test("收藏 tab 列出本人收藏（mock 预置 2 张）", async ({ page }) => {
    const picker = await openStickerTab(page, "收藏");
    await expect(picker.locator("[data-sticker-id]")).toHaveCount(2);
  });

  test("贴纸与 emoji tab 之间可来回切换", async ({ page }) => {
    const picker = await openStickerTab(page, "官方");
    await expect(picker.locator("[data-sticker-id]").first()).toBeVisible();

    // 切回 emoji 分类（第一个 emoji 分类 tab 在贴纸两个 tab 之后）
    await picker.getByRole("tab", { name: "笑脸" }).click();
    await expect(picker.locator("[data-sticker-id]")).toHaveCount(0);
    await expect(picker.getByRole("button", { name: "😀" })).toBeVisible();
  });

  test("点击官方贴纸后面板关闭且消息流出现贴纸气泡", async ({ page }) => {
    const picker = await openStickerTab(page, "官方");
    const before = await page.locator('[data-kind="sticker"]').count();

    await picker.locator("[data-sticker-id]").first().click();

    await expect(picker).toBeHidden();
    await expect(page.locator('[data-kind="sticker"]')).toHaveCount(before + 1);
  });

  test("右键图片消息可添加到表情，且新贴纸出现在收藏 tab", async ({ page }) => {
    const imageBubble = page.locator('[data-kind="image"]').first();
    await imageBubble.click({ button: "right" });

    await page.getByRole("menuitem", { name: TXT.addToStickers }).click();
    await expect(page.getByText(TXT.addSuccess)).toBeVisible();

    // 收藏 tab 从 2 张变 3 张（MSW 按 content_hash 幂等，此图未收藏过）
    const picker = await openStickerTab(page, "收藏");
    await expect(picker.locator("[data-sticker-id]")).toHaveCount(3);
  });

  test("未被服务端确认的消息不提供添加到表情入口", async ({ page }) => {
    // demo 数据里 status=failed 的那条文本消息没有 seq，右键菜单不应出现贴纸入口
    const failed = page.getByText("没问题，我改一下日程。").first();
    await failed.click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: TXT.addToStickers })).toHaveCount(0);
  });

  test("右键收藏贴纸可删除，列表实际少一张", async ({ page }) => {
    const picker = await openStickerTab(page, "收藏");
    const stickers = picker.locator("[data-sticker-id]");
    await expect(stickers).toHaveCount(2);

    await stickers.first().click({ button: "right" });
    await picker.getByRole("menuitem", { name: TXT.removeSticker }).click();

    await expect(stickers).toHaveCount(1);
  });

  test("贴纸缩略图真实出图（不是破图占位）", async ({ page }) => {
    const picker = await openStickerTab(page, "官方");
    const firstThumb = picker.locator("[data-sticker-id] img").first();
    await expect(firstThumb).toBeVisible();
    // MSW 的 /files/download-url 回 data URL，naturalWidth > 0 才算真的解码成功
    await expect
      .poll(async () => firstThumb.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);
    // 破图占位是 aria-label="加载失败" 的按钮，不应出现
    await expect(picker.getByRole("button", { name: "加载失败" })).toHaveCount(0);
  });
});
