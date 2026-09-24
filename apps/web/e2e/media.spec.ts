/**
 * 会话媒体相册与视频消息 E2E
 *
 * @description
 * 全程跑在仓库既有的 mock 模式（MSW + demo 数据）下，与其他 spec 一致：
 * `setAuth` 写认证态、`waitForMSW` 等 Service Worker 激活，不依赖真实后端。
 * 相册数据来自 MSW 的 `GET /conversations/:id/media`（由 DEMO_MESSAGES 过滤映射），
 * 因此「产品研发群」里的一图一视频一文件一语音就是相册里应当出现的四条。
 *
 * locale 固定为 zh-CN（见 playwright.config.ts），故直接用中文文案定位。
 *
 * @remarks 语音倍速不在此覆盖：mock 的 `files/download-url` 对任何 key 都回一张
 *   SVG data URL（见 mocks/handlers.ts 的 stickerDataUrl），真实浏览器里
 *   `new Audio(svg).play()` 必然 onerror → 播放态立刻回落，没有任何一行会进入
 *   「正在播放」，倍速按钮因此不可能出现。该行为由 voicePlayer 与 MessageBubble
 *   的单测覆盖（含 1→1.5→2→1 循环与「只在播放行显示」）。
 */
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { setAuth } from "./fixtures/auth.fixture";
import { waitForMSW } from "./utils/msw";

/** demo 会话「产品研发群」里各媒体样本的 seq（见 mocks/demoData.ts） */
const SEQ = { image: 3, voice: 5, file: 6, video: 9 };

/** 打开第一个会话（demo 数据的「产品研发群」，内含图片/语音/文件/视频四类媒体）。 */
async function openFirstConversation(page: Page) {
  await page.goto("/chat");
  await page.getByText("产品研发群").first().click();
  // 图片气泡出现即说明消息流已渲染
  await expect(page.locator('[data-kind="image"]').first()).toBeVisible();
}

/** 从会话顶栏打开媒体相册，返回相册浮层 locator。 */
async function openAlbum(page: Page) {
  await page.getByTestId("open-media").click();
  const album = page.getByRole("dialog", { name: "媒体相册" });
  await expect(album).toBeVisible();
  return album;
}

test.describe("会话媒体相册", () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page);
    await waitForMSW(page);
    await openFirstConversation(page);
  });

  test("顶栏入口打开相册：六个类型 Tab 与 demo 媒体齐全", async ({ page }) => {
    const album = await openAlbum(page);

    // 六个类型 Tab（全部/图片/文件/语音/视频/贴纸），默认选中「全部」
    await expect(album.getByRole("tab")).toHaveCount(6);
    await expect(album.getByRole("tab", { name: "全部" })).toHaveAttribute("aria-selected", "true");

    // 方格区：图片 + 视频；行列表区：文件 + 语音（四条 demo 媒体一条不少）
    await expect(album.getByTestId("media-image-" + SEQ.image)).toBeVisible();
    await expect(album.getByTestId("media-video-" + SEQ.video)).toBeVisible();
    await expect(album.getByTestId("media-row-" + SEQ.file)).toBeVisible();
    await expect(album.getByTestId("media-row-" + SEQ.voice)).toBeVisible();

    // 缩略图真的出图（MSW 的 download-url 回 data URL，naturalWidth>0 才算解码成功）
    const thumb = album.getByTestId("media-image-" + SEQ.image).locator("img");
    await expect
      .poll(async () => thumb.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);
  });

  test("切到「视频」Tab 只留视频卡，且带时长角标", async ({ page }) => {
    const album = await openAlbum(page);
    await album.getByRole("tab", { name: "视频" }).click();

    await expect(album.getByTestId("media-video-" + SEQ.video)).toBeVisible();
    // 图片方格与文件/语音行随筛选消失
    await expect(album.getByTestId("media-image-" + SEQ.image)).toHaveCount(0);
    await expect(album.getByTestId("media-row-" + SEQ.file)).toHaveCount(0);
    // demo 视频 15 秒 → 角标 0:15（m:ss，不是裸秒数）
    await expect(album.getByText("0:15")).toBeVisible();
  });

  test("切到「贴纸」Tab 无数据时显示空态", async ({ page }) => {
    const album = await openAlbum(page);
    await album.getByRole("tab", { name: "贴纸" }).click();

    // demo 数据没有贴纸消息，相册应给出空态而不是空白页
    await expect(album.getByText("这里还没有媒体")).toBeVisible();
    await expect(album.getByTestId("media-image-" + SEQ.image)).toHaveCount(0);
  });

  test("点图片方格开大图查看器，关闭后仍在相册里", async ({ page }) => {
    const album = await openAlbum(page);
    await album.getByTestId("media-image-" + SEQ.image).click();

    const lightbox = page.getByRole("dialog", { name: "图片" });
    await expect(lightbox).toBeVisible();

    // 关闭按钮与相册顶栏的「关闭」同名，故限定在大图层内定位
    await lightbox.getByRole("button", { name: "关闭" }).click();
    await expect(lightbox).toBeHidden();
    await expect(album).toBeVisible();
  });

  test("点视频方格开全屏播放层（video 元素带可播地址）", async ({ page }) => {
    const album = await openAlbum(page);
    await album.getByTestId("media-video-" + SEQ.video).click();

    const player = page.getByRole("dialog", { name: "播放视频" });
    await expect(player).toBeVisible();
    await expect(player.locator("video")).toHaveAttribute("src", /.+/);

    // Esc 关闭播放层，相册留在原地
    await page.keyboard.press("Escape");
    await expect(player).toBeHidden();
    await expect(album).toBeVisible();
  });

  test("相册可关闭并回到会话", async ({ page }) => {
    const album = await openAlbum(page);
    await album.getByRole("button", { name: "返回" }).click();
    await expect(album).toBeHidden();
    await expect(page.locator('[data-kind="image"]').first()).toBeVisible();
  });
});

test.describe("视频消息", () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page);
    await waitForMSW(page);
    await openFirstConversation(page);
  });

  test("输入区视频按钮选文件后消息流出现视频气泡", async ({ page }) => {
    const bubbles = page.locator('[data-kind="video"]');
    // demo 里已有一条视频消息，故按增量断言
    const before = await bubbles.count();

    // 隐藏 input 直接喂文件（点按钮会拉起系统选择器，E2E 无法交互）
    await page.locator('input[accept="video/*"]').setInputFiles({
      name: "e2e-clip.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("fake mp4 bytes"),
    });

    // mock 模式下发送在乐观插入后即停（不上传、不发帧），气泡出现就是终态
    await expect(bubbles).toHaveCount(before + 1);
  });

  test("视频气泡的播放钮打开全屏播放层", async ({ page }) => {
    // demo 视频消息自带 thumbKey/key，点播放钮走签名下载路径
    await page.locator('[data-kind="video"]').first().getByTestId("video-play").click();

    const player = page.getByRole("dialog", { name: "播放视频" });
    await expect(player).toBeVisible();
    await expect(player.locator("video")).toHaveAttribute("src", /.+/);
  });
});
