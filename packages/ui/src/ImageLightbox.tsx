/**
 * ImageLightbox 组件 — 图片全屏查看器
 *
 * @description
 * 点击消息气泡内的图片后覆盖全屏展示原图：
 * - fixed inset-0 z-50，半透明黑底（bg-black/90）压住整个应用
 * - 图片 max-h-full max-w-full 等比铺满，不裁切
 * - 点击任意处 / 按 Esc 关闭；右上角关闭按钮提供显式入口
 * - 打开期间锁 body 滚动，关闭后恢复
 *
 * 兼容性：仅用 fixed/flex/object-contain 与 keydown 监听，Chrome 74 WebView 均可用。
 *
 * @param url - 要展示的图片地址（本地 blob URL 或预签名下载 URL）
 * @param onClose - 关闭回调（点击遮罩 / Esc / 关闭按钮触发）
 */
import { useEffect } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

export function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const { t } = useTranslation();

  // Esc 关闭 + 打开期间锁定 body 滚动（关闭后原样恢复）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

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
        className="absolute top-4 right-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <X size={22} />
      </button>
      {/* 点击图片本身也关闭（冒泡到遮罩）：符合"点击任意处关闭" */}
      <img
        src={url}
        alt={t("chat.image.alt")}
        className="max-h-full max-w-full rounded-lg object-contain"
      />
    </div>
  );
}
