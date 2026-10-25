/**
 * SearchWindowPage — 桌面端独立搜索窗口的页面（路由 `/search-window`）。
 *
 * @description
 * 不套 MainLayout：搜索窗口是独立 JS 上下文，数据自己在 SearchWindowHost 里拉
 * （会话/联系人 REST 各一次），WS 与全局 WS 仍在主窗口。选中结果经
 * {@link navigateAndClose} 交给主窗口：
 *
 * 1. `emit("search:navigate", { path, conversationId?, seek? })` —— 主窗口
 *    （App.tsx 仅 main label 注册监听）先 `setActive` 再 navigate 再按需定位消息；
 * 2. **关掉自己**。两步串行 await，且 emit 失败**不阻断**关窗 —— 选完留一个
 *    死窗口是实测踩过的坑（「主窗口跳了、搜索窗口还在」），这里把「必关窗」
 *    钉进单测（apps/desktop/src/__tests__/searchWindowPage.test.tsx）。
 *
 * 非 Tauri 环境（浏览器里跑本 SPA 做开发）：emit/close 都会抛，吞掉后窗口
 * 就是普通页面 —— 窗口内导航由 CommandPalette 回落 useNavigate 兜底。
 */
import { useCallback } from "react";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SearchWindowHost } from "@yuanchat/ui";
import type { PaletteNavigateMeta } from "@yuanchat/ui";
import { SEARCH_NAVIGATE_EVENT, type SearchNavigatePayload } from "../hooks/useSearchWindow";

/** 关闭当前窗口；非 Tauri 环境（浏览器 dev）静默忽略 */
async function closeSelf(): Promise<void> {
  try {
    await getCurrentWindow().close();
  } catch {
    /* 非 Tauri 环境 */
  }
}

/**
 * 选中结果出窗：先发事件再关窗。
 *
 * @remarks emit 先 await 再 close：close 一旦执行本 JS 上下文随时可能被拆，
 * 事件必须先出去。emit 抛错（非 Tauri / 无监听方）也继续关窗 —— 导航没落地
 * 顶多白选一次，窗口残留则是每选必踩。Tauri API 用静态导入：本页是 desktop
 * 专属路由，动态 import 只会平添微任务时序（双关窗竞态实测踩过）。
 */
async function navigateAndClose(path: string, meta?: PaletteNavigateMeta): Promise<void> {
  try {
    const payload: SearchNavigatePayload = {
      path,
      conversationId: meta?.conversationId,
      seek: meta?.seek,
    };
    await emit(SEARCH_NAVIGATE_EVENT, payload);
  } catch {
    /* 非 Tauri 环境（浏览器 dev）没有事件桥 */
  }
  await closeSelf();
}

export function SearchWindowPage() {
  const onNavigate = useCallback((path: string, meta?: PaletteNavigateMeta) => {
    void navigateAndClose(path, meta);
  }, []);
  const onClose = useCallback(() => {
    void closeSelf();
  }, []);
  return <SearchWindowHost onNavigate={onNavigate} onClose={onClose} />;
}
