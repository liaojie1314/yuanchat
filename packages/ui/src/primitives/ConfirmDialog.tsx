import { useTranslation } from "react-i18next";
import { Button } from "./Button";

/** 通用确认弹窗：danger 模式确认键红色（退群/解散/踢人等破坏性操作用） */
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
  if (!open) return null;
  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 grid place-items-center bg-black/40"
      onMouseDown={onCancel}
    >
      <div
        className="bg-surface-container-low w-[320px] rounded-lg p-5 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-title-md text-on-surface font-semibold">{title}</h3>
        <p className="text-body-md text-on-surface-variant mt-2">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" className="px-4 py-2" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant={danger ? "danger" : "primary"} className="px-4 py-2" onClick={onConfirm}>
            {confirmLabel ?? t("common.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
