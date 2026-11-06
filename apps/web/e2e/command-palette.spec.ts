/**
 * 命令面板 E2E 测试
 *
 * @description
 * 覆盖 Task 12 的五条链路：Ctrl+K 打开并聚焦、输入后分组 + 类型筛选、
 * Enter 执行选中项落到目标会话、Escape 关闭、桌面视口宽度明显大于手机视口
 * （K18 的「屏幕再大也只有一个窄弹窗」抱怨的回归钉）。
 *
 * ⚠️ Ctrl+K 是 Chromium 保留快捷键（地址栏搜索），浏览器会先吞事件，
 * 不会冒泡到页面 window keydown handler（与 search.spec.ts 同一结论）。
 * 打开面板改用 evaluate 派发合成 KeyboardEvent，直接触发 MainLayout 里
 * window.addEventListener("keydown") 的回调，等价于用户真实按键的组件层效果。
 *
 * 查询词用「季度报告」：任意非空词都会请求服务端；
 * MSW 的 mockSearchResults 对任意非关键词返回
 * text/file/image 三类结果，足以验证分组与筛选。
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
 * 派发 Ctrl/Cmd+K 打开命令面板。
 *
 * MainLayout 的 keydown handler 挂在 useEffect 里，goto 后异步挂载；
 * 若单次 dispatch 早于挂载，事件丢失且断言 retry 不会重发按键。
 * 用 toPass 重试「dispatch + 可见」整块，直到 handler 就绪。
 */
async function openPalette(page: Page): Promise<void> {
  await expect(async () => {
    await dispatchKey(page, { key: "k", ctrlKey: true });
    if ((page.viewportSize()?.width ?? 1280) < 768) {
      await expect(page).toHaveURL(/\/search(?:\?|$)/, { timeout: 500 });
      await expect(page.getByRole("combobox")).toBeVisible({ timeout: 500 });
    } else {
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 500 });
    }
  }).toPass({ timeout: 5000 });
}

test.describe("命令面板", () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page);
    await waitForMSW(page);
    await page.goto("/chat");
  });

  test("Ctrl+K 打开，空输入时列出快捷动作", async ({ page }) => {
    await openPalette(page);
    const box = page.getByRole("combobox");
    await expect(box).toBeFocused();
    await expect(page.getByRole("option").first()).toBeVisible();
  });

  test("输入后按类别分组，点文件筛选器只剩文件组", async ({ page }) => {
    await openPalette(page);
    await page.getByRole("combobox").fill("季度报告");
    await expect(page.getByRole("group", { name: /文件与媒体|Files/i })).toBeVisible();

    await page.getByRole("button", { name: /^文件$|^Files$/ }).click();
    await expect(page.getByRole("group", { name: /消息$|Messages$/ })).toHaveCount(0);
  });

  test("Enter 执行选中的消息结果并落到目标会话", async ({ page }) => {
    await openPalette(page);
    await page.getByRole("combobox").fill("季度报告");
    await page.getByRole("option").first().waitFor();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    // 面板关闭且落到某个会话
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await expect(page).toHaveURL(/\/chat\/.+/);
  });

  test("Escape 关闭面板", async ({ page }) => {
    await openPalette(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("combobox")).toHaveCount(0);
  });

  test("Web 会话内搜索是 dialog，真实请求带当前会话范围", async ({ page }) => {
    await page.getByRole("button", { name: /产品研发群/ }).click();
    await page.getByRole("button", { name: "搜索聊天记录" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("option")).toHaveCount(0);
    const request = page.waitForRequest((r) => r.url().includes("/messages/search?"));
    await page.getByRole("combobox").fill("季度报告");
    const qs = new URL((await request).url()).searchParams;
    expect(qs.get("conversation_id")).toBeTruthy();
    await page.keyboard.press("Escape");
    await openPalette(page);
    await expect(page.getByRole("option").first()).toBeVisible();
  });

  test("手机全局搜索走独立路由，返回和结果导航不互相覆盖", async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page).toHaveURL(/\/search$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "返回", exact: true }).click();
    await expect(page).toHaveURL(/\/chat$/);
    await openPalette(page);
    await page.getByRole("combobox").fill("季度报告");
    await page.getByRole("option", { name: /季度报告写完了/ }).click();
    await expect(page).toHaveURL(/\/chat\/conv_001$/);
    await expect(page.getByRole("combobox")).toHaveCount(0);
  });

  test("手机会话内搜索从更多打开带 scope 的路由", async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.getByRole("button", { name: /产品研发群/ }).click();
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("button", { name: "搜索聊天记录", exact: true }).click();
    await expect(page).toHaveURL(/\/search\?conversation_id=.+/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("option")).toHaveCount(0);
    await page.getByRole("button", { name: "返回", exact: true }).click();
    await expect(page).toHaveURL(/\/chat$/);
  });

  test("桌面视口下面板明显宽于手机搜索页", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openPalette(page);
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();
    const wide = (await listbox.boundingBox())!.width;

    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 412, height: 915 });
    await openPalette(page);
    const listbox2 = page.getByRole("listbox");
    await expect(listbox2).toBeVisible();
    const narrow = (await listbox2.boundingBox())!.width;

    expect(wide).toBeGreaterThan(narrow * 1.5);
  });
});
