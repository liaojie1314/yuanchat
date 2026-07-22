/**
 * MSW Browser 初始化 — 在应用启动时条件性启用 Mock Service Worker
 *
 * @description
 * 仅在 development 模式下由 main.tsx 动态 import 加载。
 * Production build 中此文件会被 Vite tree-shake。
 *
 * 如果后端可用，可通过环境变量 VITE_ENABLE_MOCK=false 关闭 Mock。
 *
 * 使用方式（在各 app 的 main.tsx 中）：
 * ```ts
 * if (import.meta.env.DEV) {
 *   const { startMockWorker } = await import("@yuanchat/shared/mocks/browser");
 *   await startMockWorker();
 * }
 * ```
 */
import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

let started = false;

/**
 * 启动 MSW Worker
 *
 * 调用多次不会重复初始化。
 * 仅在未通过 VITE_ENABLE_MOCK=false 禁用时启动。
 */
export async function startMockWorker(): Promise<void> {
  // 通过环境变量手动关闭 Mock
  if (import.meta.env.VITE_ENABLE_MOCK === "false") return;
  if (started) return;

  const worker = setupWorker(...handlers);

  try {
    await worker.start({
      onUnhandledRequest: "bypass",
      quiet: true,
    });
    started = true;
    console.log("[MSW] Mock Service Worker started — API calls will be intercepted");
  } catch {
    console.warn("[MSW] Failed to start — running without mock");
  }
}
