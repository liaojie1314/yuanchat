/**
 * AnnouncementDialog — 群公告全文只读弹层
 *
 * @description
 * 顶部横幅（ChatWindow）仅展示单行摘要，点击后弹出本组件展示完整公告正文，
 * `whitespace-pre-wrap` 保留换行。纯展示，无编辑能力（编辑走 ChatDetail 的
 * 管理员内联编辑，成功后由 conversation.updated 帧刷新 conv.announcement）。
 *
 * @param open - 是否显示
 * @param announcement - 公告正文（空串时上层不应打开本弹层）
 * @param onClose - 关闭回调
 */
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

export function AnnouncementDialog({
  open,
  announcement,
  onClose,
}: {
  open: boolean;
  announcement: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 grid place-items-center bg-black/40"
      onMouseDown={onClose}
    >
      <div
        className="bg-surface-container-low w-[360px] max-w-[90vw] rounded-lg p-5 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-title-md text-on-surface font-semibold">
            {t("announcement.dialogTitle")}
          </h3>
          <button
            onClick={onClose}
            className="md3-icon-btn text-on-surface-variant !h-8 !w-8 shrink-0"
            aria-label={t("common.close")}
          >
            <X size={16} />
          </button>
        </div>
        <p className="text-body-md text-on-surface max-h-[50vh] overflow-y-auto whitespace-pre-wrap">
          {announcement}
        </p>
      </div>
    </div>
  );
}
