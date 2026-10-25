/**
 * 文件下载进度条 E2E — 真实布局测量
 *
 * @description
 * 按 MASTER_PLAN §2.12 的教训：宽度/溢出类断言一律量真实 getBoundingClientRect，
 * 不要只断言类名 —— JSDOM 不做布局，offsetWidth 恒为 0，气泡宽度那个 bug
 * 就是「单测全绿、真机照穿」三次。进度条挂在气泡外层、用 w-full 正推宽度，
 * 这里在 412px 手机视口下量它不超出气泡所在列。
 *
 * 为什么挂起对象字节流：mock 的 /files/download-url 回 data URL，
 * 真实 fetch 几十毫秒就下完，进度条闪现即逝量不到。把 window.fetch 对
 * data: 的调用换成永不 resolve 的 Promise，进度条就停在不确定态供测量；
 * 其余请求照走原 fetch（→ MSW）。
 */
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { setAuth } from "./fixtures/auth.fixture";
import { waitForMSW } from "./utils/msw";

/** 手机视口：进度条与气泡列在窄屏下才可能互相顶到（桌面 1920px 永远碰不上） */
test.use({ viewport: { width: 412, height: 915 } });

async function openConversationWithFile(page: Page) {
  await page.goto("/chat");
  await page.getByText("产品研发群").first().click();
  const bubble = page.locator('[data-testid="file-bubble"]').first();
  await expect(bubble).toBeVisible();
  return bubble;
}

test.describe("文件下载进度条", () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page);
    await waitForMSW(page);
  });

  test("进度条不超出气泡所在列的宽度", async ({ page }) => {
    const bubble = await openConversationWithFile(page);

    // 截下对象字节流：MSW 签出的 data URL 由挂起的假 fetch 接管，
    // 其余请求照走原 fetch。必须在点下载之前装好
    await page.evaluate(() => {
      const original = window.fetch.bind(window);
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith("data:")) return new Promise<Response>(() => {});
        return original(input as RequestInfo, init);
      };
    });

    // 文件气泡的下载按钮（aria-label 走 zh-CN：下载）
    await bubble.getByRole("button", { name: "下载" }).click();

    const bar = page.getByRole("progressbar").first();
    await expect(bar).toBeVisible();

    const barBox = await bar.boundingBox();
    // 气泡的父级是「气泡行」（w-full，宽 = 75% 列宽），进度条与其同级同宽
    const colBox = await bubble.locator("xpath=..").boundingBox();
    expect(barBox).not.toBeNull();
    expect(colBox).not.toBeNull();
    expect(barBox!.width).toBeGreaterThan(0);
    expect(barBox!.width).toBeLessThanOrEqual(colBox!.width + 1);
  });
});
