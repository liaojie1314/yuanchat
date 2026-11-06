/**
 * CloseBehaviorDialog — 关窗二选一弹窗（桌面端点关闭按钮且偏好为「每次询问」时）
 *
 * @description
 * 刻意保持简单：标题 + 一句说明 + 两个并排选项按钮 + 一行「记住我的选择」。
 * 推荐侧（最小化到托盘）用 primary-container 高亮，退出侧保持中性，
 * 扫一眼就知道默认该选哪个。不用原生弹窗 —— 项目约定确认与授权一律应用内自绘。
 *
 * 无障碍要求（与 ConfirmDialog 同一套）：
 * - `role="dialog"` + `aria-modal` + `aria-labelledby` 指向标题；
 *   右上角关闭按钮带 `aria-label`
 * - 初始焦点落在「最小化到托盘」：破坏性较小的那个，回车不至于误退应用
 * - 焦点陷阱：Tab/Shift+Tab 只在弹窗内三个控件（两个选项 + 关闭 + 复选框）间循环
 * - Esc 关闭：等价于 `onCancel`，既不最小化也不退出
 * - 关闭后焦点还原到打开弹窗之前的元素
 */
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useId, useState } from "react";
import { Minimize2, Power, X, Check } from "lucide-react";
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
  /** 用户取消（点背景/Esc/右上角关闭）：既不最小化也不退出 */
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  // 复选框状态自持：勾不勾是本次的选择，不预先替用户记住
  const [remember, setRemember] = useState(false);
  const trayRef = useRef<HTMLButtonElement>(null);
  const quitRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const rememberRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // 打开前的焦点主，关闭后还原
  const previousFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) {
      setRemember(false);
      return;
    }
    previousFocusRef.current = document.activeElement;
    // 初始焦点落在弹窗容器上，**不预选任何选项** —— 高亮「最小化到托盘」
    // 会被读成默认已选中；容器持有焦点保住 Tab 陷阱与 Esc，视觉上两案平等
    panelRef.current?.focus();
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
      // 焦点陷阱：托盘 → 退出 → 右上角关闭 → 复选框，循环防 Tab 逃出弹窗
      if (e.key === "Tab") {
        e.preventDefault();
        const order = [trayRef.current, quitRef.current, closeRef.current, rememberRef.current];
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

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-[2px]"
      onMouseDown={onCancel}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="bg-surface-container-low w-[340px] rounded-lg p-5 shadow-xl outline-none"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 id={titleId} className="text-title-md text-on-surface font-semibold">
              {t("desktop.closeTitle")}
            </h3>
            <p className="text-body-sm text-on-surface-variant mt-1">{t("desktop.closeBody")}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label={t("common.close")}
            className="text-on-surface-variant hover:bg-surface-container-high focus-visible:ring-primary -mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent focus-visible:outline-none"
            onClick={onCancel}
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <button
            ref={trayRef}
            type="button"
            className={cn(
              "text-label-lg text-primary-on-container bg-primary-container hover:bg-primary-container/80 border-primary/50 focus-visible:ring-primary flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent focus-visible:outline-none",
            )}
            onClick={() => onPick("tray", remember)}
          >
            <Minimize2 size={17} />
            {t("desktop.closeToTray")}
          </button>
          <button
            ref={quitRef}
            type="button"
            className="text-label-lg text-on-surface bg-surface-container-high hover:bg-surface-container-highest focus-visible:ring-primary flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent focus-visible:outline-none"
            onClick={() => onPick("quit", remember)}
          >
            <Power size={17} className="text-on-surface-variant" />
            {t("desktop.closeQuit")}
          </button>
        </div>

        <label className="text-body-sm text-on-surface-variant mt-4 flex cursor-pointer items-center justify-center gap-2">
          {/* 原生 input 只保语义与键盘，视觉用自绘方块：accent 样式各平台不一，露出来就是丑的 */}
          <input
            ref={rememberRef}
            type="checkbox"
            className="peer sr-only"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span
            aria-hidden
            className={cn(
              "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border transition-colors duration-150",
              "peer-focus-visible:ring-primary peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-transparent peer-focus-visible:outline-none",
              remember ? "border-primary bg-primary text-primary-on" : "border-outline-variant",
            )}
          >
            {remember && <Check size={12} strokeWidth={3.5} />}
          </span>
          {t("desktop.rememberChoice")}
        </label>
      </div>
    </div>
  );
}
