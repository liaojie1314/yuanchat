/**
 * CloseBehaviorDialog — 关窗二选一弹窗（桌面端点关闭按钮且偏好为「每次询问」时）
 *
 * @description
 * 视觉走「品牌渐变头部 + 双选项卡片」：两张卡片各自带图标与后果提示，
 * 推荐侧（最小化到托盘）用 primary-container 高亮，退出侧保持中性 ——
 * 用户扫一眼就知道默认该选哪个、选另一个会发生什么，不必读完整句子。
 * 复选框状态由本组件自持，选择经 `onPick(behavior, remember)` 一次性回传。
 * 不用原生弹窗 —— 项目约定确认与授权一律应用内自绘。
 *
 * 无障碍要求（与 ConfirmDialog 同一套）：
 * - `role="dialog"` + `aria-modal` + `aria-labelledby` 指向标题
 * - 初始焦点落在「最小化到托盘」：破坏性较小的那个，回车不至于误退应用
 * - 焦点陷阱：Tab/Shift+Tab 只在弹窗内三个控件（两张卡片 + 复选框）间循环
 * - Esc 关闭：等价于 `onCancel`，既不最小化也不退出
 * - 关闭后焦点还原到打开弹窗之前的元素
 */
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useId, useState } from "react";
import { Minimize2, Power, X } from "lucide-react";
import { cn } from "@yuanchat/shared/utils";

export function CloseBehaviorDialog({
  open,
  onPick,
  onCancel,
}: {
  /** 是否显示 */
  open: boolean;
  /** 用户选定动作；`remember` 为 true 时调用方应把选择写进 desktopStore */
  onPick: (behavior: "tray" | "quit", remember: boolean) => void;
  /** 用户取消（点背景/Esc）：既不最小化也不退出 */
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  // 复选框状态自持：勾不勾是本次的选择，不预先替用户记住
  const [remember, setRemember] = useState(false);
  const trayRef = useRef<HTMLButtonElement>(null);
  const quitRef = useRef<HTMLButtonElement>(null);
  const rememberRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  // 打开前的焦点主，关闭后还原
  const previousFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) {
      setRemember(false);
      return;
    }
    previousFocusRef.current = document.activeElement;
    // 默认焦点落在破坏性较小的一侧
    trayRef.current?.focus();
    return () => {
      (previousFocusRef.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
        return;
      }
      // 焦点陷阱：托盘卡片 → 退出卡片 → 复选框 三点循环，防 Tab 逃出弹窗
      if (e.key === "Tab") {
        e.preventDefault();
        const order = [trayRef.current, quitRef.current, rememberRef.current];
        const idx = order.indexOf(document.activeElement as HTMLButtonElement | null);
        const next = e.shiftKey
          ? order[(idx - 1 + order.length) % order.length]
          : order[(idx + 1) % order.length];
        next?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  /** 双选项卡片的公共骨架：图标 + 标签 + 后果提示，竖排居中 */
  const cardClass = cn(
    "flex flex-col items-center gap-1 rounded-lg px-3 py-4 transition-colors duration-200",
    // ring 约定与 Button 相同：只挂 focus-visible，旧 WebView 不认时原生 outline 兜底
    "focus-visible:ring-primary focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent focus-visible:outline-none",
  );

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 grid place-items-center bg-black/40"
      onMouseDown={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-surface-container-low w-[360px] rounded-lg p-6 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center text-center">
          <div className="brand-gradient flex h-10 w-10 items-center justify-center rounded-lg text-white">
            <X size={20} strokeWidth={2.2} />
          </div>
          <h3 id={titleId} className="text-title-md text-on-surface mt-3 font-semibold">
            {t("desktop.closeTitle")}
          </h3>
          <p className="text-body-sm text-on-surface-variant mt-1">{t("desktop.closeBody")}</p>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <button
            ref={trayRef}
            type="button"
            className={cn(
              cardClass,
              // 推荐侧：primary-container 高亮，hover 抬浓度
              "bg-primary-container text-on-primary-container border-primary/50 hover:bg-primary-container/80 border",
            )}
            onClick={() => onPick("tray", remember)}
          >
            <Minimize2 size={22} className="text-primary" />
            <span className="text-label-lg font-medium">{t("desktop.closeToTray")}</span>
            <span className="text-label-xs opacity-80">{t("desktop.closeToTrayHint")}</span>
          </button>
          <button
            ref={quitRef}
            type="button"
            className={cn(
              cardClass,
              "bg-surface-container-high text-on-surface hover:bg-surface-container-highest border border-transparent",
            )}
            onClick={() => onPick("quit", remember)}
          >
            <Power size={22} className="text-on-surface-variant" />
            <span className="text-label-lg font-medium">{t("desktop.closeQuit")}</span>
            <span className="text-label-xs text-on-surface-variant">
              {t("desktop.closeQuitHint")}
            </span>
          </button>
        </div>

        <div className="border-outline-variant mt-4 flex items-center justify-center border-t pt-3">
          <label className="text-body-sm text-on-surface-variant flex cursor-pointer items-center gap-2">
            <input
              ref={rememberRef}
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="accent-primary h-4 w-4"
            />
            {t("desktop.rememberChoice")}
          </label>
        </div>
      </div>
    </div>
  );
}
