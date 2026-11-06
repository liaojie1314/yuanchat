/**
 * 原生搜索窗口页面：URL 提供初始范围，范围事件更新已有窗，数据在 Host 自拉。
 * 选中结果先发 search:navigate 再关闭自身，主窗口执行会话/定位/状态动作。
 * 范围监听装好后发送 search:ready，补齐页面加载期间入口变更造成的事件遗漏。
 */
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SearchWindowHost } from "@yuanchat/ui";
import { useAuthStore, useThemeStore } from "@yuanchat/shared";
import type { PaletteNavigateMeta } from "@yuanchat/ui";
import {
  SEARCH_NAVIGATE_EVENT,
  SEARCH_SCOPE_EVENT,
  SEARCH_READY_EVENT,
  SEARCH_WINDOW_LABEL,
  type SearchNavigatePayload,
  type SearchScopePayload,
} from "../hooks/useSearchWindow";

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
    const auth = useAuthStore.getState();
    if (auth.isAuthenticated && auth.user?.id) {
      const payload: SearchNavigatePayload = {
        userId: auth.user.id,
        path,
        action: meta?.action,
        conversationId: meta?.conversationId,
        seek: meta?.seek,
      };
      await emit(SEARCH_NAVIGATE_EVENT, payload);
    }
  } catch {
    /* 非 Tauri 环境（浏览器 dev）没有事件桥 */
  }
  await closeSelf();
}

/** 独立搜索窗口通过宿主桥执行导航与主窗口状态动作，发送后关闭自身。 */
export function SearchWindowPage() {
  const [params] = useSearchParams();
  const [conversationId, setConversationId] = useState<string | undefined>(
    () => params.get("conversation_id") || undefined,
  );
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void listen<SearchScopePayload>(
      SEARCH_SCOPE_EVENT,
      (event) => {
        const id = event.payload?.conversationId;
        setConversationId(typeof id === "string" && id ? id : undefined);
        const skinId = event.payload?.skinId;
        if (typeof skinId === "string") useThemeStore.getState().setSkin(skinId);
      },
      { target: SEARCH_WINDOW_LABEL },
    )
      .then(async (unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        dispose = unlisten;
        // 安装监听后通知 main 重发最新范围，补齐新窗口加载期间遗漏的入口。
        await emitTo("main", SEARCH_READY_EVENT);
      })
      .catch((err) => {
        // 初始 URL 范围仍能搜索；桥失效需留下线索，不能把范围静默当全局。
        console.error("[search] 搜索范围监听失败:", err);
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);
  const onNavigate = useCallback((path: string, meta?: PaletteNavigateMeta) => {
    void navigateAndClose(path, meta);
  }, []);
  const onClose = useCallback(() => {
    void closeSelf();
  }, []);
  return (
    <SearchWindowHost conversationId={conversationId} onNavigate={onNavigate} onClose={onClose} />
  );
}
