/**
 * RefreshButton — 区块标题旁的局部刷新按钮
 *
 * @description
 * 给「不靠 WS 推送、只能主动拉」的列表用（表情市场 / 朋友圈 / 我的表情包）。
 * WS 驱动的列表不要加：那里的数据本来就是实时的，一个刷新按钮只会让用户
 * 以为「不点就看不到新消息」。
 *
 * 刷新中禁用并转圈，防连点叠请求；失败弹 toast 而不是把列表换成错误页。
 *
 * @example
 * <RefreshButton onRefresh={() => load(true)} />
 */
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { showToast } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { useTranslation } from "react-i18next";

export function RefreshButton({
  onRefresh,
  className,
}: {
  /** 刷新回调；reject 时弹 toast */
  onRefresh: () => Promise<unknown>;
  className?: string;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onRefresh();
    } catch {
      showToast("error", t("common.opFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={busy}
      aria-label={t("common.refresh")}
      className={cn("md3-icon-btn text-on-surface-variant", className)}
    >
      <RefreshCw size={17} className={cn(busy && "motion-safe:animate-spin")} />
    </button>
  );
}
