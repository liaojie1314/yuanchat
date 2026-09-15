/**
 * StickerThumb 组件 — 贴纸缩略图（收藏列表 / 官方包 / 商城详情共用）
 *
 * @description
 * 按需换取预签名下载 URL 并渲染贴纸原图：
 * - 换取中渲染为空白占位（父容器负责格子尺寸，无布局跳动）
 * - 签名失败或对象不存在（如 seed 未成功上传时留下的行）走 error 分支显示破图图标，
 *   而不是渲染成一个可点击的空白格——空白格会被点击并发出一条双端永久不可见的贴纸消息
 *
 * @param objectKey - 贴纸对象键（images/ 前缀）
 */
import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { getDownloadUrl } from "@yuanchat/shared";

export function StickerThumb({ objectKey }: { objectKey: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    getDownloadUrl(objectKey)
      .then((u) => {
        if (alive) setUrl(u);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [objectKey]);

  if (failed) {
    return (
      <ImageOff size={18} strokeWidth={1.25} className="text-on-surface-variant" aria-hidden />
    );
  }
  return url ? (
    <img
      src={url}
      alt=""
      onError={() => setFailed(true)}
      className="h-full w-full object-contain"
    />
  ) : null;
}
