import { Minus, X } from "lucide-react";

/**
 * 自定义窗口操作栏 — 替代原生标题栏
 *
 * @description
 * 在 Tauri v2 桌面端替代系统原生标题栏（通过 `decorations: false` 隐藏原生装饰）。
 * 提供三个核心能力：
 * - **窗口拖拽**：通过 `data-tauri-drag-region` 属性标记整个 bar 为拖拽区域
 * - **最小化**：调用 `getCurrentWindow().minimize()` 最小化当前窗口
 * - **关闭**：调用 `getCurrentWindow().close()` 关闭当前窗口（hover 时变红提示）
 *
 * 所有 Tauri API 调用通过 try-catch 兜底，在非 Tauri 环境（Web 端）点击按钮无操作。
 *
 * @example
 * ```tsx
 * // 直接放在页面顶部
 * <div className="flex h-screen flex-col">
 *   <TitleBar />
 *   <div className="flex-1">页面内容</div>
 * </div>
 *
 * // 或通过 MainLayout 的 titleBar 属性传递（已认证页面）
 * <MainLayout titleBar={<TitleBar />} />
 * ```
 */
export function TitleBar() {
  const handleMinimize = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch {
      /* 非 Tauri 环境，无操作 */
    }
  };

  const handleClose = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch {
      /* 非 Tauri 环境，无操作 */
    }
  };

  return (
    <div
      data-tauri-drag-region
      className="flex h-8 shrink-0 select-none items-center justify-between bg-surface-container px-2"
    >
      <span className="text-on-surface-variant pl-2 text-label-sm font-medium">元聊 YuanChat</span>

      <div className="flex items-center">
        <button
          type="button"
          onClick={handleMinimize}
          className="text-on-surface-variant inline-flex h-7 w-10 items-center justify-center rounded-md transition-colors hover:bg-surface-container-high hover:text-on-surface"
          title="最小化"
        >
          <Minus size={16} />
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="text-on-surface-variant inline-flex h-7 w-10 items-center justify-center rounded-md transition-colors hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
          title="关闭"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
