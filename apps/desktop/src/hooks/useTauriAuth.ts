import { useCallback } from "react";

/**
 * 打开 Tauri 认证窗口（桌面端专属）
 *
 * 在 Tauri 开发模式下使用完整 dev URL，生产构建使用相对路径。
 * Web 端 fallback 为普通页面跳转。
 */
export function useOpenAuthWindow() {
  return useCallback(async (route: string, title: string) => {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isDev = !!(window as any).__TAURI_DEV__;
      const url = isDev ? `http://localhost:1420${route}` : route;

      new WebviewWindow(route.replace(/\//g, ""), {
        url,
        title,
        width: 440,
        height: 720,
        center: true,
        resizable: false,
      });
    } catch (e) {
      console.error("Failed to open auth window:", e);
      window.location.href = route;
    }
  }, []);
}

/**
 * 认证成功后关闭当前窗口并通知主窗口跳转到聊天页
 */
export function useCloseAuthWindow() {
  return useCallback(async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const { emit } = await import("@tauri-apps/api/event");
      await emit("auth-success", {});
      await getCurrentWindow().close();
    } catch (e) {
      console.error("Failed to close auth window:", e);
    }
  }, []);
}
