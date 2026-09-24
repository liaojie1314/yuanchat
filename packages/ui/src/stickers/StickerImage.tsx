/**
 * StickerImage 组件 — 贴纸消息渲染（裸图，无气泡背景/内边距）
 *
 * @description
 * 与 MessageImage 的关键差异：
 * - 固定展示上限尺寸（更小，符合贴纸视觉习惯），不放大小图
 * - 不接收 onOpen：贴纸天然不进图片大图查看器浏览流
 * - 无 cursor-zoom-in 光标、无点击行为
 *
 * 加载状态沿用 MessageImage 的 loading/loaded/error 三态：贴纸虽是"轻量内容"，
 * 但它是这条消息的**全部**内容，且气泡对 sticker 去掉了背景与内边距——静默失败
 * 会渲染成一片纯粹的虚无，用户连"这里本该有东西"都看不出来。
 *
 * @param sticker - 贴纸载荷（width/height 像素尺寸、对象 key）
 */
import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getDownloadUrl } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";

/** 贴纸展示盒最长边（比图片消息的 280px 更小，符合贴纸尺寸习惯） */
const STICKER_MAX_EDGE = 112;

type LoadState = "loading" | "loaded" | "error";

function displayBox(w: number, h: number): { width: number; height: number } {
  if (!w || !h) return { width: STICKER_MAX_EDGE, height: STICKER_MAX_EDGE };
  const scale = Math.min(1, STICKER_MAX_EDGE / Math.max(w, h));
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

export function StickerImage({
  sticker,
}: {
  sticker: { width: number; height: number; key?: string };
}) {
  const { t } = useTranslation();
  const box = displayBox(sticker.width, sticker.height);
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  // 点击错误占位重试：递增触发 effect 重新签名
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!sticker.key) {
      setState("error");
      return;
    }
    let alive = true;
    getDownloadUrl(sticker.key)
      .then((u) => {
        if (alive) setUrl(u);
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
    };
  }, [sticker.key, reloadTick]);

  const retry = () => {
    setUrl(null);
    setState("loading");
    setReloadTick((n) => n + 1);
  };

  // 签名失败 / 图片本身 404（对象不存在）：给一个可点击重试的占位，不留空白
  if (state === "error") {
    return (
      <button
        type="button"
        onClick={retry}
        aria-label={t("sticker.imageFailed")}
        style={box}
        className="bg-surface-container-high text-on-surface-variant flex items-center justify-center rounded-lg transition-opacity hover:opacity-80"
      >
        <ImageOff size={22} strokeWidth={1.25} />
      </button>
    );
  }

  return (
    <div style={box} className="relative">
      {/* 加载骨架：与贴纸同尺寸，避免出图时的布局跳动 */}
      {state === "loading" && (
        <div
          className="bg-surface-container-high absolute inset-0 animate-pulse rounded-lg"
          aria-hidden
        />
      )}
      {url && (
        <img
          src={url}
          alt=""
          width={box.width}
          height={box.height}
          onLoad={() => setState("loaded")}
          onError={() => setState("error")}
          className={cn(
            "block h-full w-full object-contain transition-opacity duration-150",
            state === "loaded" ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </div>
  );
}
