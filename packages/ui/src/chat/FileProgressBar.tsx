/**
 * FileProgressBar — 文件气泡下方的下载进度条。
 *
 * @description
 * 与气泡行同级，始终预留紧凑的 20px 内容区和 2px 间距；没有条目、完成或取消
 * 只清空内容，不移除占位，消息高度不会随下载状态变化。进度内容绝对定位，
 * 文件名较短时也不会参与父列的固有宽度计算，长状态文案不会撑宽气泡。
 * 子项用兄弟 margin 留出 2px，兼容旧 WebView 并避开 gap 任意值的插件冲突。
 *
 * 样式语言与桌面端更新进度条（UpdateChecker）一致，不另造一套。
 * 错误摘要保持单行；错误全文与保存位置复用现有弹窗，经 portal 脱离虚拟列表的 transform。
 * 完成瞬间经这里弹一次「已保存到 %{path}」—— 安卓的落盘目录在文件管理器里
 * 看不见；Web 授权目录显示目录名和文件名，默认浏览器下载不伪造位置。
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getFileSink, showToast, useDownloadStore } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { ConfirmDialog } from "../primitives/ConfirmDialog";

/** 已弹过「已保存到」的 messageId：聊天层与相册层可能同时挂载同一条，只弹一次 */
const savedToasts = new Set<string>();

/** 把字节数格式化成 1.2 MB 这样的短标签 */
function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 文件下载进度条；进度真源是 shared 的 useDownloadStore，键为 messageId */
export function FileProgressBar({
  messageId,
  location,
  onCloseLocation,
}: {
  messageId: string;
  location?: string | null;
  onCloseLocation?: () => void;
}) {
  const { t } = useTranslation();
  const entry = useDownloadStore((s) => s.entries[messageId]);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);

  // 完成即提示实际位置，Web 的本页引用必须先经句柄转换成可读目录与文件名。
  useEffect(() => {
    if (!entry || entry.phase !== "done") {
      // 离开 done（重下同一文件 / 清掉条目）后允许下一次完成再提示
      savedToasts.delete(messageId);
      return;
    }
    if (!entry.savedPath || entry.restored || savedToasts.has(messageId)) return;
    const sink = getFileSink();
    const path = sink.describe ? sink.describe(entry.savedPath) : entry.savedPath;
    if (!path) return;
    savedToasts.add(messageId);
    showToast("info", t("chat.file.savedTo", { path }));
  }, [entry, messageId, t]);

  const progress = entry && entry.phase !== "done" && entry.phase !== "canceled" ? entry : null;
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : null;
  const failed = progress?.phase === "failed";
  const errorText = t(progress?.errorKey ?? "chat.file.downloadFailed");
  const closeDetails = () => {
    setErrorDetails(null);
    onCloseLocation?.();
  };

  return (
    <>
      <div
        data-testid="file-progress-slot"
        className="relative mt-[2px] h-[20px] w-full min-w-0 shrink-0"
      >
        {progress && (
          <div className="absolute inset-0 flex min-w-0 flex-col space-y-[2px]">
            <div
              role="progressbar"
              aria-label={t("chat.file.downloading")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent ?? undefined}
              className="bg-surface-container-highest h-[4px] shrink-0 overflow-hidden rounded-full"
            >
              <div
                className={cn(
                  "h-full transition-all duration-200",
                  failed ? "bg-error" : "bg-primary",
                  percent === null && !failed && "animate-pulse",
                )}
                // 失败态拉满红条，保留原始进度的 ARIA 值；其余状态按真实字节数显示。
                style={{ width: failed ? "100%" : percent === null ? "40%" : `${percent}%` }}
              />
            </div>
            {failed ? (
              <button
                type="button"
                aria-haspopup="dialog"
                title={errorText}
                onClick={() => setErrorDetails(errorText)}
                // 扩展到 24px 点击区域，不参与布局，兼顾触控目标与固定进度槽。
                className="text-error relative flex h-[14px] w-full min-w-0 shrink-0 items-center gap-1 rounded-sm text-left text-[11px] leading-[14px] before:absolute before:inset-x-0 before:-inset-y-[5px]"
              >
                <span className="min-w-0 flex-1 truncate">{errorText}</span>
                <Info size={12} className="shrink-0" aria-hidden />
              </button>
            ) : (
              <p className="text-on-surface-variant m-0 h-[14px] shrink-0 truncate text-[11px] leading-[14px]">
                {progress.phase === "saving"
                  ? t("chat.file.saving")
                  : percent !== null
                    ? `${percent}% · ${humanSize(progress.received)} / ${humanSize(progress.total)}`
                    : humanSize(progress.received)}
              </p>
            )}
          </div>
        )}
      </div>
      {(errorDetails !== null || location) &&
        createPortal(
          <div className="break-words">
            <ConfirmDialog
              open
              title={t(
                errorDetails !== null ? "chat.file.downloadFailed" : "chat.file.viewLocation",
              )}
              message={errorDetails ?? location ?? ""}
              confirmLabel={t("common.close")}
              hideCancel={errorDetails === null}
              onConfirm={closeDetails}
              onCancel={closeDetails}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
