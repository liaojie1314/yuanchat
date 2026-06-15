import { useCallback } from "react";

/**
 * 打开 Tauri 认证窗口（桌面端专属）
 * Web 端 fallback 为普通页面跳转
 */
export function useOpenAuthWindow() {
  return useCallback(async (route: string, title: string) => {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      new WebviewWindow(route.replace("/", ""), {
        url: route,
        title,
        width: 440,
        height: 720,
        center: true,
        resizable: false,
      });
    } catch {
      window.location.href = route;
    }
  }, []);
}

/**
 * 关闭当前认证窗口并通知主窗口
 */
export function useCloseAuthWindow() {
  return useCallback(async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const { emit } = await import("@tauri-apps/api/event");
      await emit("auth-success", {});
      await getCurrentWindow().close();
    } catch {
      /* Web fallback */
    }
  }, []);
}
