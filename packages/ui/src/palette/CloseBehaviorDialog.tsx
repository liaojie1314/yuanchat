/**
 * CloseBehaviorDialog — 关窗二选一弹窗（桌面端点关闭按钮且偏好为「每次询问」时）
 *
 * @description
 * 两个主动作「最小化到托盘 / 退出应用」+ 一个「记住我的选择」复选框，
 * 复选框状态由本组件自持，选择经 `onPick(behavior, remember)` 一次性回传。
 * 不用原生弹窗 —— 项目约定确认与授权一律应用内自绘。
 *
 * 无障碍要求（与 ConfirmDialog 同一套）：
 * - `role="dialog"` + `aria-modal` + `aria-labelledby` 指向标题
 * - 初始焦点落在「最小化到托盘」：破坏性较小的那个，回车不至于误退应用
 * - 焦点陷阱：Tab/Shift+Tab 只在弹窗内三个控件（两个按钮 + 复选框）间循环
 * - Esc 关闭：等价于 `onCancel`，既不最小化也不退出
 * - 关闭后焦点还原到打开弹窗之前的元素
 */
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useId, useState } from "react";
import { Button } from "../primitives/Button";

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
      // 焦点陷阱：托盘按钮 → 退出按钮 → 复选框 三点循环，防 Tab 逃出弹窗
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
  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 grid place-items-center bg-black/40"
      onMouseDown={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-surface-container-low w-[320px] rounded-lg p-5 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} className="text-title-md text-on-surface font-semibold">
          {t("desktop.closeTitle")}
        </h3>
        <p className="text-body-md text-on-surface-variant mt-2">{t("desktop.closeBody")}</p>
        <div className="mt-5 flex flex-col gap-2">
          <Button
            ref={trayRef}
            variant="primary"
            className="w-full justify-center px-4 py-2"
            onClick={() => onPick("tray", remember)}
          >
            {t("desktop.closeToTray")}
          </Button>
          <Button
            ref={quitRef}
            variant="secondary"
            className="w-full justify-center px-4 py-2"
            onClick={() => onPick("quit", remember)}
          >
            {t("desktop.closeQuit")}
          </Button>
        </div>
        <label className="text-body-sm text-on-surface-variant mt-4 flex cursor-pointer items-center gap-2">
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
  );
}
