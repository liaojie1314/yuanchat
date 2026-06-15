/**
 * 桌面端入口 — 初始化 i18n、M3 主题，挂载 React 应用
 *
 * 与 Web 端的区别：
 * - 监听 auth-success 事件（来自注册窗口），自动跳转到聊天页
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@yuanchat/design-system/i18n";
import "@yuanchat/design-system/global.css";
import { useThemeStore } from "@yuanchat/shared";
import App from "./App";

// 初始化 M3 主题（在 React 渲染前，避免首屏闪烁）
useThemeStore.getState().applyTheme();

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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
