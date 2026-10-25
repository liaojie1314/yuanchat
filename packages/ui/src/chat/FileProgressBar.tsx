/**
 * FileProgressBar — 文件气泡下方的下载进度条。
 *
 * @description
 * 刻意放在**气泡之外**（与气泡行同级、其下方）：进度条有最小宽度诉求，放气泡内
 * 会向上贡献 min-content，再踩一次「气泡顶穿父列」那个坑（min-width:0 只解除
 * 本元素的最小尺寸，压不住子孙贡献上来的 min-content）。本行用 `w-full`，
 * 宽度由父列正推为定值 —— 412px 视口下 E2E 量真实 boundingBox 钉死这一点。
 *
 * 样式语言与桌面端更新进度条（UpdateChecker）一致，不另造一套。
 * 无进度条目或已完成时渲染 null：占一行空高度会让气泡在下载开始时跳一下（CLS）。
 * 完成瞬间经这里弹一次「已保存到 %{path}」—— 安卓的落盘目录在文件管理器里
 * 看不见，这条 toast 是用户知道文件去哪了的唯一线索（web 实现拿不到路径，不弹）。
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { showToast, useDownloadStore } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";

/** 已弹过「已保存到」的 messageId：聊天层与相册层可能同时挂载同一条，只弹一次 */
const savedToasts = new Set<string>();

/** 把字节数格式化成 1.2 MB 这样的短标签 */
function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 文件下载进度条；进度真源是 shared 的 useDownloadStore，键为 messageId */
export function FileProgressBar({ messageId }: { messageId: string }) {
  const { t } = useTranslation();
  const entry = useDownloadStore((s) => s.entries[messageId]);

  // 完成即提示落盘位置（只对拿得到绝对路径的平台：web 的 save 返回 null）
  useEffect(() => {
    if (!entry || entry.phase !== "done") {
      // 离开 done（重下同一文件 / 清掉条目）后允许下一次完成再提示
      savedToasts.delete(messageId);
      return;
    }
    if (!entry.savedPath || savedToasts.has(messageId)) return;
    savedToasts.add(messageId);
    showToast("info", t("chat.file.savedTo", { path: entry.savedPath }));
  }, [entry, messageId, t]);

  // 没有进度就什么都不渲染 —— 占一行空高度会让气泡在下载开始时跳一下（CLS）
  if (!entry) return null;
  if (entry.phase === "done" || entry.phase === "canceled") return null;

  const determinate = entry.total > 0;
  const percent = determinate ? Math.min(100, Math.round((entry.received / entry.total) * 100)) : 0;
  const failed = entry.phase === "failed";

  return (
    <div className="mt-1 w-full">
      <div
        role="progressbar"
        aria-label={t("chat.file.downloading")}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(determinate ? { "aria-valuenow": percent } : {})}
        className="bg-surface-container-highest h-1.5 overflow-hidden rounded-full"
      >
        <div
          className={cn(
            "h-full transition-all duration-200",
            failed ? "bg-error" : "bg-primary",
            !determinate && !failed && "animate-pulse",
          )}
          style={{
            // 失败态把条拉满红：半截灰条看起来像还能继续，其实已经死了
            width: determinate || failed ? `${Math.max(percent, failed ? 100 : 0)}%` : "40%",
          }}
        />
      </div>
      <p className="text-label-xs text-on-surface-variant mt-0.5">
        {failed
          ? t(entry.errorKey ?? "chat.file.downloadFailed")
          : entry.phase === "saving"
            ? t("chat.file.saving")
            : determinate
              ? `${percent}% · ${humanSize(entry.received)} / ${humanSize(entry.total)}`
              : humanSize(entry.received)}
      </p>
    </div>
  );
}
