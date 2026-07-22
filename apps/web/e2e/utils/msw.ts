/**
 * MSW Service Worker 就绪等待工具
 *
 * @description
 * MSW 通过 Service Worker 拦截 HTTP 请求。在 E2E 测试中，
 * 必须在 SW 激活后才能进行交互，否则 API 调用不会被 mock。
 *
 * 此工具轮询 `navigator.serviceWorker.controller.state`
 * 直到其变为 `"activated"`，确保所有 mock handler 已注册。
 */

import type { Page } from "@playwright/test";

/**
 * 等待 MSW Service Worker 激活
 *
 * 轮询检查 SW 状态，超时 10 秒。
 * 应在每个测试的 beforeEach 中、页面加载后调用。
 *
 * @param page - Playwright Page 对象
 */
export async function waitForMSW(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker?.controller?.state === "activated", {
    timeout: 10000,
  });
}
