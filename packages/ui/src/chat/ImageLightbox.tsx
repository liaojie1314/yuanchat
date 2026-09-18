/**
 * ImageLightbox 组件 — 图片全屏查看器（支持图集左右切换）
 *
 * @description
 * 点击图片后覆盖全屏展示原图：
 * - fixed inset-0 z-50，半透明黑底（bg-black/90）压住整个应用
 * - 图片 max-h-full max-w-full 等比铺满，不裁切
 * - 点击任意处 / 按 Esc 关闭；右上角关闭按钮提供显式入口
 * - 打开期间锁 body 滚动，关闭后恢复
 * - 传入多张时左右按钮与 ← / → 方向键翻页，右上角显示「当前/总数」；
 *   **首尾不循环**（到头即禁用，不绕回），单张时不出这两样
 *
 * 只收已签好的 URL 列表：签名与分页归调用方管，本组件不发请求，也就不会
 * 在翻到最后一张时偷偷触发「加载更多」。
 *
 * 兼容性：仅用 fixed/flex/object-contain 与 keydown 监听，Chrome 74 WebView 均可用。
 *
 * @param urls - 图集地址（本地 blob URL 或预签名下载 URL）；单图传长度 1 的数组
 * @param index - 打开时定位到第几张，越界回落到第一张；默认 0
 * @param onClose - 关闭回调（点击遮罩 / Esc / 关闭按钮触发）
 */
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useTranslation } from "react-i18next";

export function ImageLightbox({
  urls,
  index = 0,
  onClose,
}: {
  urls: string[];
  index?: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [cur, setCur] = useState(index >= 0 && index < urls.length ? index : 0);
  const multi = urls.length > 1;

  // Esc 关闭 + 方向键翻页 + 打开期间锁定 body 滚动（关闭后原样恢复）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      // 到头不绕回：上界/下界各自钳住，与左右按钮的禁用态同语义
      if (e.key === "ArrowLeft") setCur((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setCur((i) => Math.min(urls.length - 1, i + 1));
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, urls.length]);

  /** 翻页按钮：必须吞掉冒泡，否则点一下就被遮罩的"点击任意处关闭"接走 */
  const step = (e: React.MouseEvent, delta: number) => {
    e.stopPropagation();
    setCur((i) => Math.min(urls.length - 1, Math.max(0, i + delta)));
  };

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("chat.image.alt")}
      onClick={onClose}
    >
      <button
        onClick={onClose}
        aria-label={t("chat.lightbox.close")}
        className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <X size={22} />
      </button>

      {multi && (
        <span
          data-testid="lightbox-counter"
          className="text-label-md absolute top-6 left-4 rounded-lg bg-white/10 px-2 py-0.5 text-white tabular-nums"
        >
          {cur + 1}/{urls.length}
        </span>
      )}

      {multi && (
        <>
          <button
            onClick={(e) => step(e, -1)}
            disabled={cur === 0}
            aria-label={t("chat.lightbox.prev")}
            className="absolute left-2 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-25"
          >
            <ChevronLeft size={24} />
          </button>
          <button
            onClick={(e) => step(e, 1)}
            disabled={cur === urls.length - 1}
            aria-label={t("chat.lightbox.next")}
            className="absolute right-2 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-25"
          >
            <ChevronRight size={24} />
          </button>
        </>
      )}

      {/* 点击图片本身也关闭（冒泡到遮罩）：符合"点击任意处关闭"设计 */}
      <img
        src={urls[cur]}
        alt={t("chat.image.alt")}
        className="max-h-full max-w-full rounded-lg object-contain"
      />
    </div>
  );
}
