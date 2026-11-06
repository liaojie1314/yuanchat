/**
 * 全局搜索（命令面板）E2E 测试
 *
 * @description
 * 原针对 SearchModal；Task 12 起该组件升维为 CommandPalette（同一快捷键链路），
 * 用例随之改指新面板。覆盖：Ctrl/Cmd+K 打开、输入框自动聚焦、
 * Escape 关闭、关闭按钮关闭、空输入时列出快捷动作。
 *
 * ⚠️ Ctrl+K 是 Chromium 保留快捷键（地址栏搜索），浏览器会先吞事件，
 * 不会冒泡到页面 window keydown handler。测试改用 evaluate 派发合成
 * KeyboardEvent，直接触发 MainLayout 里 window.addEventListener("keydown")
 * 的回调，等价于用户真实按键的组件层效果。
 */

import { test, expect, type Page } from "@playwright/test";
import { setAuth } from "./fixtures/auth.fixture";
import { waitForMSW } from "./utils/msw";

async function dispatchKey(
  page: Page,
  opts: { key: string; ctrlKey?: boolean; metaKey?: boolean },
): Promise<void> {
  await page.evaluate((o) => {
    window.dispatchEvent(new KeyboardEvent("keydown", { ...o, bubbles: true, cancelable: true }));
  }, opts);
}

/**
 * 派发 Ctrl/Cmd+K 打开搜索浮层。
 *
 * MainLayout 的 keydown handler 挂在 useEffect 里，goto 后异步挂载；
 * 若单次 dispatch 早于挂载，事件丢失且断言 retry 不会重发按键。
 * 用 toPass 重试「dispatch + 可见」整块，直到 handler 就绪。
 */
async function openSearch(page: Page): Promise<void> {
  await expect(async () => {
    await dispatchKey(page, { key: "k", ctrlKey: true });
    await expect(page.getByRole("dialog", { name: "搜索或输入命令…" })).toBeVisible({
      timeout: 500,
    });
  }).toPass({ timeout: 5000 });
}

test.describe("Global Command Palette (Cmd/Ctrl+K)", () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page);
    await waitForMSW(page);
    await page.goto("/chat");
  });

  test("Ctrl+K opens search dialog", async ({ page }) => {
    await openSearch(page);
  });

  test("Meta+K opens search dialog (macOS)", async ({ page }) => {
    await expect(async () => {
      await dispatchKey(page, { key: "k", metaKey: true });
      await expect(page.getByRole("dialog", { name: "搜索或输入命令…" })).toBeVisible({
        timeout: 500,
      });
    }).toPass({ timeout: 5000 });
  });

  test("search input is focused when modal opens", async ({ page }) => {
    await openSearch(page);
    await expect(page.getByPlaceholder("搜索或输入命令…")).toBeFocused();
  });

  test("Escape closes search dialog", async ({ page }) => {
    await openSearch(page);
    await dispatchKey(page, { key: "Escape" });
    await expect(page.getByRole("dialog", { name: "搜索或输入命令…" })).not.toBeVisible();
  });

  test("close button closes search dialog", async ({ page }) => {
    await openSearch(page);
    await page.getByRole("button", { name: "关闭搜索" }).click();
    await expect(page.getByRole("dialog", { name: "搜索或输入命令…" })).not.toBeVisible();
  });

  test("shows quick actions before typing", async ({ page }) => {
    await openSearch(page);
    // 空输入是命令模式：渲染动作注册表而非搜索提示
    await expect(page.getByRole("option").first()).toBeVisible();
  });

  test("任意非空关键词都会请求消息搜索，包含单字、emoji 和字面量通配符", async ({ page }) => {
    await openSearch(page);
    for (const query of ["托", "托盘", "🙂", "%", "_"]) {
      const response = page.waitForResponse((r) => {
        const url = new URL(r.url());
        return url.pathname.endsWith("/messages/search") && url.searchParams.get("q") === query;
      });
      await page.getByRole("combobox").fill(` ${query} `);
      expect((await response).status()).toBe(200);
      await expect(page.getByRole("option").first()).toBeVisible();
    }
  });

  test("空白输入保留快捷动作，不发搜索请求", async ({ page }) => {
    await openSearch(page);
    const requests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/messages/search"))
        requests.push(request.url());
    });
    await page.getByRole("combobox").fill(" \u3000 ");
    await expect(page.getByRole("option").first()).toBeVisible();
    // 越过 300ms 防抖窗口，证明空白输入没有排入延迟请求。
    await page.waitForTimeout(400);
    expect(requests).toEqual([]);
  });
});
