import { useCallback } from "react";

/**
 * 桌面端认证窗口管理
 *
 * 在 Tauri 开发模式下使用完整 dev URL，生产构建使用相对路径。
 * 如果窗口已存在则置顶居中，否则创建新窗口。
 * Web 端 fallback 为普通页面跳转。
 */
export function useOpenAuthWindow() {
  return useCallback(async (route: string, title: string) => {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const label = route.replace(/\//g, "");

      // 检查窗口是否已存在，存在则置顶居中
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) {
        await existing.setFocus();
        await existing.center();
        return;
      }

      // 窗口不存在，创建新窗口
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isDev = !!(window as any).__TAURI_DEV__;
      const url = isDev ? `http://localhost:1420${route}` : route;

      new WebviewWindow(label, {
        url,
        title,
        width: 540,
        height: 760,
        center: true,
        resizable: false,
        decorations: false,
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
