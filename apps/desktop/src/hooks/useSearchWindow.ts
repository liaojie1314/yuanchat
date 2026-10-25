/**
 * useSearchWindow — 桌面端「搜索开独立原生窗口」的主窗口侧控制器。
 *
 * @description
 * 与 useCallWindow 同一模式：MainLayout 的 Ctrl/Cmd+K 经
 * {@link setSearchWindowLauncher} 整体转成一次「开窗」。搜索窗口（label
 * `"search"`）是独立 JS 上下文 —— store 不共享，它挂载后自己拉会话/联系人
 * 数据（SearchWindowHost），选中结果经 `search:navigate` 事件桥交回主窗口
 * 落地（监听在 App.tsx，仅主窗口注册）。
 *
 * 重复开窗由 `getByLabel("search")` 去重：已有窗口时只做 setFocus。
 */
import { useEffect } from "react";
import { setSearchWindowLauncher } from "@yuanchat/ui";
import type { PaletteNavigateMeta } from "@yuanchat/ui";

/** 搜索窗口的固定 label：同时用于去重与 capabilities 授权（default.json windows） */
export const SEARCH_WINDOW_LABEL = "search";

/** 搜索窗口尺寸：880×620 —— 在原 720×560 面板之上再宽一档，独立窗口给分组结果留呼吸空间 */
export const SEARCH_WINDOW_SIZE = { width: 880, height: 620 };

/** 搜索窗口的路由：App.tsx 以 pathname 判定独立窗口形态 */
export const SEARCH_WINDOW_URL = "/search-window";

/** 跨窗口导航桥的事件名：搜索窗口 emit、主窗口 listen */
export const SEARCH_NAVIGATE_EVENT = "search:navigate";

/** `search:navigate` 的载荷：搜索窗口选中结果后交给主窗口执行 */
export interface SearchNavigatePayload extends PaletteNavigateMeta {
  /** 主窗口要跳的路由 */
  path: string;
}

/** WebviewWindow 的构造参数（结构对齐 @tauri-apps/api 的 WindowOptions 子集） */
export interface SearchWindowConfig {
  url: string;
  title: string;
  width: number;
  height: number;
  center: boolean;
  resizable: boolean;
  /** 与主窗口/登录/通话窗口一致：应用自绘标题栏，关掉系统边框 */
  decorations: boolean;
}

/**
 * 搜索窗口的构造参数。
 *
 * @remarks 独立导出纯函数是为了可单测 —— 参数拼错的后果是窗口开起来不对劲
 *   （没标题栏拖不了、尺寸跑偏），只在桌面端真机上才能复现。
 */
export function searchWindowConfig(): SearchWindowConfig {
  return {
    url: SEARCH_WINDOW_URL,
    title: "YuanChat",
    width: SEARCH_WINDOW_SIZE.width,
    height: SEARCH_WINDOW_SIZE.height,
    center: true,
    resizable: true,
    decorations: false,
  };
}

/**
 * 开（或聚焦）搜索窗口。
 *
 * @remarks url 用相对路径：Tauri 会按 dev 的 `devUrl` / 生产的 `frontendDist`
 *   各自解析，两边都无需判断环境。
 */
async function openSearchWindow(): Promise<void> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const existing = await WebviewWindow.getByLabel(SEARCH_WINDOW_LABEL);
  if (existing) {
    await existing.setFocus();
    return;
  }
  new WebviewWindow(SEARCH_WINDOW_LABEL, searchWindowConfig());
}

/**
 * 主窗口侧接线。
 *
 * @param enabled - 仅桌面端主窗口传 true；搜索/通话窗口自身与移动端传 false
 *   （否则搜索窗口里再注册承载器，Ctrl+K 会在窗口里套娃开自己）
 */
export function useSearchWindow(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    setSearchWindowLauncher(() => {
      void openSearchWindow().catch((e) => {
        // 开窗失败与「没开窗」外观完全一致 —— 快捷键按了没反应，没有任何线索。
        // 缺 capabilities 权限就是这么失败的（call 窗口实测漏
        // core:webview:allow-create-webview-window 时入口全部静默失效）。
        // 浏览器里跑桌面 SPA 时这里也会抛，属预期，故只记不弹
        console.error("[search] 搜索窗口打开失败:", e);
      });
      return true;
    });

    return () => setSearchWindowLauncher(null);
  }, [enabled]);
}
