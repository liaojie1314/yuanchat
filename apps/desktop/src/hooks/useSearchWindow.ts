/**
 * useSearchWindow — 桌面端会话搜索独立原生窗口的主窗口侧控制器。
 *
 * @description
 * 与 useCallWindow 同一模式：会话内搜索经 MainLayout 与
 * {@link setSearchWindowLauncher} 转成一次开窗；全局命令面板留在主窗口。搜索窗口（label
 * `"search"`）是独立 JS 上下文 —— store 不共享，它挂载后自己拉会话/联系人
 * 数据（SearchWindowHost），选中结果经 `search:navigate` 事件桥交回主窗口
 * 落地（监听在 App.tsx，仅主窗口注册）。
 *
 * 重复开窗由 `getByLabel("search")` 去重：已有窗口先同步范围再聚焦，创建与聚焦串行执行。
 */
import { useEffect } from "react";
import {
  useAuthStore,
  useConversationStore,
  useMessageStore,
  useThemeStore,
} from "@yuanchat/shared";
import { setSearchWindowLauncher } from "@yuanchat/ui";
import type { PaletteNavigateMeta } from "@yuanchat/ui";
import { windowSizing } from "../window/windowSizing";

/** 搜索窗口的固定 label：同时用于去重与 capabilities 授权（default.json windows） */
export const SEARCH_WINDOW_LABEL = "search";

/** 搜索窗口尺寸：880×620 —— 在原 720×560 面板之上再宽一档，独立窗口给分组结果留呼吸空间 */
export const SEARCH_WINDOW_SIZE = { width: 880, height: 620 };

/** 搜索窗口的路由：App.tsx 以 pathname 判定独立窗口形态 */
export const SEARCH_WINDOW_URL = "/search-window";

/** 跨窗口导航桥的事件名：搜索窗口 emit、主窗口 listen */
export const SEARCH_NAVIGATE_EVENT = "search:navigate";

/** 已有窗口的范围更新；null 明确表示清除旧会话范围。 */
export const SEARCH_SCOPE_EVENT = "search:scope";
/** 搜索页装好范围监听后通知主窗口，补发开窗期间变化的最新范围。 */
export const SEARCH_READY_EVENT = "search:ready";
/** 范围事件的最小载荷，不把路由或脚本当作跨窗指令。 */
export interface SearchScopePayload {
  conversationId: string | null;
  /** 主窗口当前皮肤；搜索子窗用既有 setSkin 校验并应用明暗配色。 */
  skinId?: string;
}

/** `search:navigate` 的载荷：搜索窗口选中结果后交给主窗口执行 */
export interface SearchNavigatePayload extends PaletteNavigateMeta {
  /** 搜索时的账号，用于拒绝登出或换号后仍在路上的旧窗口结果。 */
  userId: string;
  /** 主窗口要跳的路由 */
  path: string;
}

/** 在主窗口执行搜索结果，状态动作不导航；会话先置活跃再定位与跳转。 */
export function applySearchNavigation(
  payload: SearchNavigatePayload,
  navigate: (path: string) => void,
): void {
  const auth = useAuthStore.getState();
  if (!auth.isAuthenticated || !auth.user?.id || payload?.userId !== auth.user.id) return;
  const { path, action, conversationId, seek } = payload;
  if (action === "toggle-theme") {
    useThemeStore.getState().toggleMode();
    return;
  }
  if (action === "logout") {
    void useAuthStore.getState().logout();
    return;
  }
  if (conversationId) useConversationStore.getState().setActive(conversationId);
  if (seek)
    void useMessageStore.getState().seekToMessage(seek.conversationId, seek.messageId, seek.seq);
  navigate(path);
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
export function searchWindowConfig(
  conversationId?: string,
  family = "linux",
  monitor?: Parameters<typeof windowSizing>[1],
): SearchWindowConfig {
  // 复用 Windows 逻辑工作区限幅，Linux/macOS 仍保持 880×620。
  const maximum = family === "windows" ? windowSizing(family, monitor).main : SEARCH_WINDOW_SIZE;
  return {
    url:
      SEARCH_WINDOW_URL +
      (conversationId ? `?conversation_id=${encodeURIComponent(conversationId)}` : ""),
    title: "YuanChat",
    width: Math.min(SEARCH_WINDOW_SIZE.width, maximum.width),
    height: Math.min(SEARCH_WINDOW_SIZE.height, maximum.height),
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
async function openSearchWindow(conversationId?: string): Promise<void> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const existing = await WebviewWindow.getByLabel(SEARCH_WINDOW_LABEL);
  if (existing) {
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo(SEARCH_WINDOW_LABEL, SEARCH_SCOPE_EVENT, {
      conversationId: conversationId ?? null,
    });
    await existing.setFocus();
    return;
  }
  const { platform } = await import("@tauri-apps/plugin-os");
  const family = platform();
  const monitor =
    family === "windows"
      ? await (await import("@tauri-apps/api/window")).currentMonitor().catch(() => null)
      : null;
  const win = new WebviewWindow(
    SEARCH_WINDOW_LABEL,
    searchWindowConfig(conversationId, family, monitor),
  );
  // 等创建确认再允许下一次开窗，快速连按也不会争用同一 label；错误交回入口日志。
  await new Promise<void>((resolve, reject) => {
    void win.once("tauri://created", () => resolve());
    void win.once("tauri://error", (event) => reject(event.payload));
  });
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

    let latestScope: string | undefined;
    let sessionRevision = 0;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    // 先装主窗口就绪监听，再创建页面，避免首次开窗就绪事件早于监听而丢失。
    let pending = import("@tauri-apps/api/event")
      .then(async ({ listen, emitTo }) => {
        // 子窗有独立的 Zustand 实例，首次就绪与主窗换肤都要显式同步。
        const syncScope = () => {
          void emitTo(SEARCH_WINDOW_LABEL, SEARCH_SCOPE_EVENT, {
            conversationId: latestScope ?? null,
            skinId: useThemeStore.getState().skinId,
          }).catch((err) => console.error("[search] 搜索窗口状态同步失败:", err));
        };
        const unlisten = await listen(SEARCH_READY_EVENT, syncScope, { target: "main" });
        if (cancelled) unlisten();
        else {
          const unsubscribeTheme = useThemeStore.subscribe((state, previous) => {
            if (latestScope && state.skinId !== previous.skinId) syncScope();
          });
          dispose = () => {
            unlisten();
            unsubscribeTheme();
          };
        }
      })
      .catch((err) => {
        // 浏览器开发环境没有事件 API；初始化也要接住拒绝，不能等首次开窗才安装 catch。
        console.error("[search] 搜索就绪监听失败:", err);
      });
    // 登出或换号先作废排队请求，再沿同一队列关闭旧窗；迟到的创建也不能留下旧数据。
    const unsubscribeAuth = useAuthStore.subscribe((state, previous) => {
      const userId = state.isAuthenticated ? state.user?.id : undefined;
      const previousId = previous.isAuthenticated ? previous.user?.id : undefined;
      if (userId === previousId) return;
      sessionRevision += 1;
      latestScope = undefined;
      pending = pending
        .then(async () => {
          const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
          const existing = await WebviewWindow.getByLabel(SEARCH_WINDOW_LABEL);
          await existing?.close();
        })
        .catch((err) => console.error("[search] 清理旧账号搜索窗口失败:", err));
    });
    setSearchWindowLauncher((conversationId) => {
      const auth = useAuthStore.getState();
      if (!auth.isAuthenticated || !auth.user?.id) return true;
      const revision = sessionRevision;
      latestScope = conversationId;
      // 同一窗口串行开/聚焦；队列执行时读取最新范围，不重放已过期的入口。
      pending = pending
        .then(() => {
          if (!cancelled && revision === sessionRevision) return openSearchWindow(latestScope);
        })
        .catch((e) => {
          // 开窗失败与「没开窗」外观完全一致 —— 快捷键按了没反应，没有任何线索。
          // 缺 capabilities 权限就是这么失败的（call 窗口实测漏
          // core:webview:allow-create-webview-window 时入口全部静默失效）。
          // 浏览器里跑桌面 SPA 时这里也会抛，属预期，故只记不弹
          console.error("[search] 搜索窗口打开失败:", e);
        });
      return true;
    });

    return () => {
      cancelled = true;
      unsubscribeAuth();
      dispose?.();
      setSearchWindowLauncher(null);
    };
  }, [enabled]);
}
