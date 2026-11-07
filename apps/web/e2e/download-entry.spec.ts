/**
 * Web 端下载入口 E2E
 *
 * @description
 * 钉住 Task 20 的主链路：侧栏沉底区的下载按钮（仅 web 构建渲染）
 * → 打开 DownloadPanel 浮层 → 推荐区按当前系统高亮。
 *
 * Playwright 的 chromium 跑在 Linux runner 上，catalog mock（MSW）里
 * linux/x86_64 恒有已发布版本，因此推荐区必须是 Linux。
 */
import { test, expect } from "@playwright/test";
import { setAuth } from "./fixtures/auth.fixture";
import { waitForMSW } from "./utils/msw";

test.use({
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
});

test.describe("Web 端下载入口", () => {
  // Playwright 的 Desktop Chrome 设备描述符把 UA **硬编码**成 Windows NT（与
  // 实际跑在哪台机器无关），照抄「Linux runner 上推荐 Linux」必然落空。
  // 这里显式给 Linux UA，让断言钉的是真实的平台识别逻辑，而不是设备描述符的巧合。
  test.use({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  test.beforeEach(async ({ page }) => {
    await setAuth(page);
    await waitForMSW(page);
  });

  test("web 端侧栏下载入口：面板打开且当前系统项高亮", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/chat");
    await page.getByTitle(/下载客户端|Download apps/).click();
    await expect(page.getByTestId("recommended")).toBeVisible();
    // Playwright 的 chromium 跑在 Linux runner 上
    await expect(page.getByTestId("recommended")).toContainText(/Linux/i);
  });
});

/** 延迟真实 fetch 而非伪造响应，验证目录到达时面板不发生布局跳动。 */
test("客户端下载从骨架切到结果时面板高度与位置不变", async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      if (String(args[0]).includes("/updates/catalog")) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      return original(...args);
    };
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  await page.getByPlaceholder(/邮箱.*元聊号/).fill("alice@example.com");
  await page.getByPlaceholder("密码", { exact: true }).fill("Test@1234");
  await page.getByRole("button", { name: /^登录$/ }).click();
  await page.getByTitle(/下载客户端|Download apps/).click();
  const panel = page.getByRole("dialog", { name: "下载客户端" }).locator(":scope > div").first();
  await expect(page.getByTestId("download-skeleton")).toBeVisible();
  const before = (await panel.boundingBox())!;
  await expect(page.getByTestId("download-skeleton")).toHaveCount(0);
  const after = (await panel.boundingBox())!;
  expect(after.height).toBe(before.height);
  expect(after.y).toBe(before.y);
  expect((await page.getByTestId("recommended").boundingBox())!.height).toBeLessThanOrEqual(96);
  await expect(page.getByRole("heading", { name: "当前系统" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "其他平台" })).toBeVisible();
  await expect(page.getByRole("button", { name: "其他平台" })).toHaveCount(0);
  const otherPlatforms = page.getByRole("region", { name: "其他平台" });
  await expect(otherPlatforms.getByRole("link", { name: /^Windows / })).toBeVisible();
  await expect(otherPlatforms.getByRole("link", { name: /^macOS / })).toBeVisible();
  expect((await panel.boundingBox())!.height).toBe(after.height);
  expect((await panel.boundingBox())!.y).toBe(after.y);
});
