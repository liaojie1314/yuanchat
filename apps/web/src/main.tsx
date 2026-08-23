/**
 * Web 端入口 — 初始化 i18n、M3 主题、Sentry、MSW Mock（仅 dev），挂载 React 应用
 */
// 旧 WebView 补丁必须排在所有 import 之前：依赖会在模块初始化阶段就调用
// ES2022 API（如 @noble/curves 用 Object.hasOwn），补晚了整屏空白
import "@yuanchat/shared/polyfills";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
// i18n 必须先于任何组件加载（确保 useTranslation 可用）
import "@yuanchat/design-system/i18n";
// M3 全局样式 + Tailwind
import "@yuanchat/design-system/global.css";
import { useThemeStore, initSentry } from "@yuanchat/shared";
import App from "./App";

// 初始化主题：将当前皮肤的 M3 颜色写入 CSS 变量
// 必须在 React 渲染前执行，避免首屏颜色闪烁
useThemeStore.getState().applyTheme();

// Sentry 错误监控初始化（无 DSN 时静默跳过，适用于开发/未配置环境）
initSentry({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  release: __APP_VERSION__,
  environment: import.meta.env.MODE,
});

async function bootstrap() {
  // 开发阶段且 VITE_ENABLE_MOCK=true 时启动 MSW Mock Service Worker
  // 联调真实后端：VITE_ENABLE_MOCK=false pnpm --filter @yuanchat/web dev
  // 动态 import 确保 MSW 在 production build 中被 tree-shake
  if (import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCK === "true") {
    const { startMockWorker } = await import("@yuanchat/shared/mocks/browser");
    await startMockWorker();
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
}

bootstrap();
