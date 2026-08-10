/**
 * StickerImage 组件 — 贴纸消息渲染（裸图，无气泡背景/内边距）
 *
 * @description
 * 与 MessageImage 的关键差异：
 * - 固定展示上限尺寸（更小，符合贴纸视觉习惯），不放大小图
 * - 不接收 onOpen：贴纸天然不进图片大图查看器浏览流
 * - 无 cursor-zoom-in 光标、无点击行为
 *
 * @param sticker - 贴纸载荷（width/height 像素尺寸、对象 key）
 */
import { useEffect, useState } from "react";
import { getDownloadUrl } from "@yuanchat/shared";

/** 贴纸展示盒最长边（比图片消息的 280px 更小，符合贴纸尺寸习惯） */
const STICKER_MAX_EDGE = 112;

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
  const box = displayBox(sticker.width, sticker.height);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!sticker.key) return;
    let alive = true;
    getDownloadUrl(sticker.key)
      .then((u) => {
        if (alive) setUrl(u);
      })
      .catch(() => {
        /* 签名失败：保持占位，静默——贴纸非核心内容，不打扰用户 */
      });
    return () => {
      alive = false;
    };
  }, [sticker.key]);

  return (
    <div style={box} className="relative">
      {url && (
        <img
          src={url}
          alt=""
          width={box.width}
          height={box.height}
          className="block h-full w-full object-contain"
        />
      )}
    </div>
  );
}
