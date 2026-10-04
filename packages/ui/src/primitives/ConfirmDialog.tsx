import { useTranslation } from "react-i18next";
import { useEffect, useRef, useId } from "react";
import { Button } from "./Button";

/**
 * ConfirmDialog — 通用二次确认弹窗
 *
 * @description
 * 无障碍要求：
 * - `role="dialog"` + `aria-modal` + `aria-labelledby` 指向标题
 * - 初始焦点落在"取消"键：危险操作不应让确认键预获焦，回车即意外触发
 * - 焦点陷阱：Tab/Shift+Tab 只在弹窗两个按钮间循环，遮挡层后的内容不可达
 * - Esc 关闭：与仓内所有浮层保持一致
 * - 关闭后焦点还原到打开弹窗之前的元素，避免焦点丢失
 *
 * @param open         是否显示
 * @param title        弹窗标题（同时作 aria-labelledby 锚点）
 * @param message      描述性正文
 * @param confirmLabel 确认按钮文案，省略时显示 "Confirm"
 * @param danger       危险模式：确认按钮用 `danger` 变体
 * @param onConfirm    用户点击确认的回调
 * @param onCancel     用户取消（点背景/Esc/取消键）的回调
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // 打开前的焦点主，关闭后还原
  const previousFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    // 记录焦点来源
    previousFocusRef.current = document.activeElement;
    // 初始焦点：取消键，防止回车误触危险操作
    cancelRef.current?.focus();
    return () => {
      // 弹窗关闭时焦点还原
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
      // 焦点陷阱：只在两个按钮间循环，防止 Tab 逃出弹窗到背后内容
      if (e.key === "Tab") {
        const cancel = cancelRef.current;
        const confirm = confirmRef.current;
        if (!cancel || !confirm) return;
        if (e.shiftKey) {
          if (document.activeElement === cancel) {
            e.preventDefault();
            confirm.focus();
          }
        } else {
          if (document.activeElement === confirm) {
            e.preventDefault();
            cancel.focus();
          }
        }
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
          {title}
        </h3>
        <p className="text-body-md text-on-surface-variant mt-2">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button ref={cancelRef} variant="ghost" className="px-4 py-2" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            ref={confirmRef}
            variant={danger ? "danger" : "primary"}
            className="px-4 py-2"
            onClick={onConfirm}
          >
            {confirmLabel ?? t("common.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
