/**
 * 气泡宽度约束 E2E — 真实布局测量
 *
 * @description
 * 这组用例只做一件事：在**手机视口**下量真实的 `getBoundingClientRect()`，
 * 确认气泡不会被内容顶穿 60% 的宽度上限、媒体盒不会戳出气泡。
 *
 * 为什么必须是 E2E 而不是单测：JSDOM 不做布局，`offsetWidth` 恒为 0，
 * 断言只能退化成「某个类名在不在」—— 而这个 bug 的全程都是类名齐全、布局照穿
 * （`min-w-0` 三层都写着，溢出 83px）。只有真浏览器排版才测得出来。
 *
 * 为什么必须是窄视口：桌面 1920px 下 60% ≈ 1150px，远大于气泡内容的
 * min-content（约 330px），永远碰不到上限 —— 同一个 bug 在 Web 桌面端完全不显形。
 */
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { setAuth } from "./fixtures/auth.fixture";
import { waitForMSW } from "./utils/msw";

/** 手机视口（Pixel 7 逻辑像素）：60% 上限在这个宽度下才比内容 min-content 窄 */
test.use({ viewport: { width: 412, height: 915 } });

/** 容忍 0.5px：浏览器子像素排版下宽度不是整数 */
const EPS = 0.5;

async function openGroupConversation(page: Page) {
  await page.goto("/chat");
  await page.getByText("产品研发群").first().click();
  await expect(page.locator('[data-kind="image"]').first()).toBeVisible();
}

/**
 * 量某个气泡与它所在的 60% 列、以及列的父行的宽度。
 *
 * 由气泡本体向上找带 `max-w-[60%]` 的祖先（即气泡列），从而不依赖具体嵌套层数。
 */
async function measure(page: Page, kind: string) {
  return page.evaluate((k) => {
    const bubble = document.querySelector(`[data-kind="${k}"]`);
    if (!bubble) throw new Error(`找不到 ${k} 气泡`);
    let col: Element | null = bubble;
    while (col && !(col as HTMLElement).className.includes("max-w-[60%]")) col = col.parentElement;
    if (!col?.parentElement) throw new Error("找不到 60% 气泡列");
    const w = (el: Element) => el.getBoundingClientRect().width;
    return { bubble: w(bubble), col: w(col), row: w(col.parentElement), viewport: innerWidth };
  }, kind);
}

test.describe("气泡宽度上限", () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page);
    await waitForMSW(page);
    await openGroupConversation(page);
  });

  test("超长文件名：气泡仍收在 60% 列内，不溢出屏幕", async ({ page }) => {
    // demo 数据的文件名只有 16 字符，撑不到上限；把名字主干换成 120 字符再量。
    // 改 DOM 文本而不是改 demo fixture：其他 spec 依赖那份数据的内容与条数
    await page.evaluate(() => {
      const stem = document.querySelector('[data-kind="file"] span.truncate');
      if (!stem) throw new Error("找不到文件名主干");
      stem.textContent = "超长文件名".repeat(24);
    });

    const m = await measure(page, "file");
    // 列本身守住 60%
    expect(m.col).toBeLessThanOrEqual(m.row * 0.6 + EPS);
    // 气泡不得反过来顶穿它的列（回归点：此处曾为 330 vs 247）
    expect(m.bubble).toBeLessThanOrEqual(m.col + EPS);
    // 兜底：无论如何不许溢出屏幕
    expect(m.bubble).toBeLessThanOrEqual(m.viewport);
  });

  for (const kind of ["image", "video"] as const) {
    test(`${kind} 媒体盒随气泡收缩，不戳出气泡`, async ({ page }) => {
      const m = await measure(page, kind);
      expect(m.col).toBeLessThanOrEqual(m.row * 0.6 + EPS);
      expect(m.bubble).toBeLessThanOrEqual(m.col + EPS);

      // 媒体盒（气泡的直接子元素）不得超过气泡内宽：
      // 它的原始展示边长是定值（图 280 / 视频 240），窄屏下比气泡还宽
      const box = await page.evaluate((k) => {
        const bubble = document.querySelector(`[data-kind="${k}"]`)!;
        const inner = bubble.firstElementChild!;
        const cs = getComputedStyle(bubble);
        const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        return {
          box: inner.getBoundingClientRect().width,
          content: bubble.getBoundingClientRect().width - pad,
        };
      }, kind);
      expect(box.box).toBeLessThanOrEqual(box.content + EPS);
    });
  }
});
