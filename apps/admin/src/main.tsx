/**
 * Admin 端入口 — 初始化 i18n、M3 主题，挂载 React 应用
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
// i18n 必须先于任何组件加载（确保 useTranslation 可用）
import "@yuanchat/design-system/i18n";
// M3 全局样式 + Tailwind
import "@yuanchat/design-system/global.css";
import { useThemeStore } from "@yuanchat/shared";
import App from "./App";

useThemeStore.getState().applyTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
