/**
 * 桌面端入口 — 初始化 i18n、M3 主题、Sentry、MSW Mock（仅 dev），挂载 React 应用
 *
 * 与 Web 端的区别：
 * - 监听 auth-success 事件（来自注册窗口），自动跳转到聊天页
 */
// 旧 WebView 补丁必须排在所有 import 之前：依赖会在模块初始化阶段就调用
// ES2022 API（如 @noble/curves 用 Object.hasOwn），补晚了整屏空白
import "@yuanchat/shared/polyfills";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@yuanchat/design-system/i18n";
import "@yuanchat/design-system/global.css";
import { useThemeStore, initSentry } from "@yuanchat/shared";
import App from "./App";

// 初始化 M3 主题（在 React 渲染前，避免首屏闪烁）
useThemeStore.getState().applyTheme();

// Sentry 错误监控初始化（无 DSN 时静默跳过，适用于开发/未配置环境）
initSentry({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  release: __APP_VERSION__,
  environment: import.meta.env.MODE,
});

// 监听来自注册窗口的登录成功事件
// 桌面端注册在独立窗口中完成，完成后 emit "auth-success" 事件
if ("__TAURI_INTERNALS__" in window) {
  import("@tauri-apps/api/event").then(({ listen }) => {
    void listen("auth-success", () => {
      // 注册成功后，主窗口跳转到聊天页
      window.location.href = "/chat";
    });
  });
}

async function bootstrap() {
  // 开发阶段且 VITE_ENABLE_MOCK=true 时启动 MSW Mock Service Worker
  // 联调真实后端：VITE_ENABLE_MOCK=false pnpm --filter @yuanchat/desktop dev
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
