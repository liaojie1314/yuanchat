import { useState, useEffect } from "react";
import { Minus, Maximize2, Minimize2, X } from "lucide-react";

/**
 * 自定义窗口操作栏 — 替代原生标题栏
 *
 * @description
 * 在 Tauri v2 桌面端替代系统原生标题栏（通过 `decorations: false` 隐藏原生装饰）。
 * 提供：
 * - **窗口拖拽**：`data-tauri-drag-region`
 * - **最小化**：`getCurrentWindow().minimize()`
 * - **最大化/还原**：`getCurrentWindow().toggleMaximize()` + 乐观切换图标
 * - **关闭**：`getCurrentWindow().close()`
 *
 * 所有 Tauri API 通过 try-catch 兜底，非 Tauri 环境无操作。
 */
export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  // 启动时检测初始状态 + 监听窗口事件同步最大化图标
  // onResized 覆盖所有场景：按钮点击 / 拖拽到顶部 / 双击标题栏 / 快捷键
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        setIsMaximized(await win.isMaximized());
        unlisten = await win.onResized(async () => {
          setIsMaximized(await win.isMaximized());
        });
      } catch {
        /* 非 Tauri 环境 */
      }
    })();

    return () => {
      unlisten?.();
    };
  }, []);

  const handleMinimize = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch {
      /* 非 Tauri 环境 */
    }
  };

  const handleToggleMaximize = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().toggleMaximize();
      // 图标由 onResized 事件统一同步，无需手动翻转
    } catch {
      /* 非 Tauri 环境 */
    }
  };

  const handleClose = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch {
      /* 非 Tauri 环境 */
    }
  };

  return (
    <div
      data-tauri-drag-region
      className="flex h-8 shrink-0 select-none items-center justify-between bg-surface-container px-2"
    >
      <span className="text-on-surface-variant pl-2 text-label-sm font-medium">元聊 YuanChat</span>

      <div className="flex items-center">
        {/* 最小化 */}
        <button
          type="button"
          onClick={handleMinimize}
          className="text-on-surface-variant inline-flex h-7 w-10 items-center justify-center rounded-md transition-colors hover:bg-surface-container-high hover:text-on-surface"
          title="最小化"
        >
          <Minus size={16} />
        </button>

        {/* 最大化 / 还原 */}
        <button
          type="button"
          onClick={handleToggleMaximize}
          className="text-on-surface-variant inline-flex h-7 w-10 items-center justify-center rounded-md transition-colors hover:bg-surface-container-high hover:text-on-surface"
          title={isMaximized ? "还原" : "最大化"}
        >
          {isMaximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>

        {/* 关闭 */}
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
