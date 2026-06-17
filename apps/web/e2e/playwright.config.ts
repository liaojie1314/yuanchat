/**
 * Playwright E2E 测试配置
 *
 * @description
 * - 自动启动 Vite dev server（MSW mock 模式），测试结束后关闭
 * - 本地开发时可复用已运行的 dev server（CI 中总是启动新实例）
 * - 仅配置 chromium 项目，后续可扩展 Firefox/WebKit
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30000,

  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  // 自动启动 Vite dev server（使用 .env.development，MSW mock 开启）
  webServer: {
    command: "pnpm --filter @yuanchat/web dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
