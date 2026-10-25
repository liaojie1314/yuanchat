/**
 * SearchWindowHost — 桌面端独立搜索窗口的承载组件（`/search-window` 整屏渲染）。
 *
 * @description
 * Tauri 每个 WebviewWindow 是独立 JS 上下文：这个窗口里的 zustand store 是空的，
 * 与主窗口互不相通。所以本组件做两件窗口内的事：
 *
 * 1. **自拉本地源**：挂载时各调一次 `loadConversations()` / `loadFriends()`，
 *   「最近会话」与联系人/群聊的本地过滤分组才有数据；拉失败静默降级 ——
 *   本地两组空着，服务端源（searchMessages）照常可用，搜索不打折。
 * 2. **自绘标题栏**：与主窗口 TitleBar 同款（h-8 / surface-container / 可拖拽
 *   region + 右上角关闭按钮）。窗口 `decorations:false`，没有这 32px 用户就没法
 *   拖动/关闭这个窗口。
 *
 * 选中结果**不走路由**：经 {@link Props.onNavigate} 交给宿主（desktop 侧
 * SearchWindowPage 注入 emit("search:navigate") + 关窗），由主窗口落地。
 * onNavigate 缺省时 CommandPalette 自己回落本地 useNavigate —— 浏览器里跑
 * 本 SPA 时窗口内导航仍然成立，只是没有跨窗口桥。
 */
import { useEffect } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useContactStore, useConversationStore } from "@yuanchat/shared";
import { CommandPalette } from "./CommandPalette";
import type { PaletteNavigateMeta } from "./CommandPalette";

interface Props {
  /**
   * 选中条目 → 交给宿主。桌面端注入「emit 给主窗口 + 关窗」；
   * 不传则 CommandPalette 回落本地 useNavigate（仅窗口内导航，无跨窗口效果）。
   */
  onNavigate?: (path: string, meta?: PaletteNavigateMeta) => void;
  /** 关闭本窗口（桌面端注入 getCurrentWindow().close()） */
  onClose: () => void;
}

export function SearchWindowHost({ onNavigate, onClose }: Props) {
  const { t } = useTranslation();

  // 独立 JS 上下文 store 为空：挂载即各拉一次本地源（各一次，不重复拉）。
  // 失败静默降级为纯服务端搜索 —— 本地分组空着不该在窗口里弹错误噪音。
  useEffect(() => {
    void useConversationStore
      .getState()
      .loadConversations()
      .catch(() => {});
    void useContactStore
      .getState()
      .loadFriends()
      .catch(() => {});
  }, []);

  return (
    <div className="bg-surface flex h-full min-h-0 flex-col overflow-hidden">
      {/* 自绘标题栏：样式对齐桌面 TitleBar（h-8 / surface-container / label-sm）。
          data-tauri-drag-region 在非 Tauri 环境只是无人认识的属性，无害。 */}
      <div
        data-tauri-drag-region
        className="bg-surface-container flex h-8 shrink-0 items-center justify-between px-2 select-none"
      >
        <span className="text-on-surface-variant text-label-sm pl-2 font-medium">
          {t("palette.windowTitle")}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("search.close")}
          className="text-on-surface-variant inline-flex h-7 w-10 items-center justify-center rounded-md transition-colors hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
        >
          <X size={16} />
        </button>
      </div>

      {/* window 形态面板：常开全出血，铺满标题栏以下的整窗 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CommandPalette variant="window" onClose={onClose} onNavigate={onNavigate} />
      </div>
    </div>
  );
}
