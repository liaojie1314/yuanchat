/**
 * VideoPlaybackOverlay 组件 — 视频全屏播放层（消息气泡与媒体相册共用）
 *
 * @description
 * 与 {@link ImageLightbox} 同构的全屏浮层：
 * - fixed inset-0 z-50，半透明黑底（bg-black/90）压住整个应用
 * - 点击遮罩 / 按 Esc / 右上角按钮关闭；安卓系统返回键同样关闭（拦截器）
 * - 打开期间锁 body 滚动，关闭后恢复
 * - 点视频本体**不**关闭：原生控件（进度条/音量）都在视频上，冒泡关闭等于没法操作
 *
 * 与 ImageLightbox 的唯一结构差异是 createPortal 到 body：气泡侧的调用点位于
 * 虚拟滚动行内，那一层带 `transform: translateY(...)`，会成为 fixed 定位的包含块——
 * 不出去就会缩到气泡那一小块区域里（同 MessageBubble 的右键菜单）。
 *
 * 兼容性：只用 fixed/flex 与 keydown 监听，`<video controls>` 在 Chrome 74 WebView 可用。
 *
 * @param url - 视频地址（本地 blob URL 或预签名下载 URL）
 * @param onClose - 关闭回调（遮罩 / Esc / 关闭按钮 / 系统返回键触发）
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerBackInterceptor } from "@yuanchat/shared";

export function VideoPlaybackOverlay({ url, onClose }: { url: string; onClose: () => void }) {
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

  // 安卓系统返回键：本层是最上层浮层，故必须先于相册/会话消费返回
  // （拦截器倒序执行，后注册者优先，本组件恰好挂载最晚）
  useEffect(() => {
    return registerBackInterceptor(() => {
      onClose();
      return true;
    });
  }, [onClose]);

  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("media.videoPlay")}
      onClick={onClose}
    >
      <button
        onClick={onClose}
        aria-label={t("chat.lightbox.close")}
        className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <X size={22} />
      </button>
      {/* 用户上传的视频没有字幕轨，故不提供 <track>；原生控件已含播放/进度/音量 */}
      <video
        src={url}
        controls
        autoPlay
        playsInline
        preload="metadata"
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-lg"
      />
    </div>,
    document.body,
  );
}
