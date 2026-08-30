/**
 * StickerPackCover 组件 — 表情包封面（商城卡片 / 详情页共用）
 *
 * @description
 * 固定宽高比（正方形）容器 + 加载骨架，图片加载完成前占位不塌陷（CLS=0）：
 * - 有 cover_url：渐入显示，onError 回退占位图标
 * - 无 cover_url（早期官方包没有封面）：直接渲染占位图标
 *
 * @param coverUrl - 封面公共 URL（可 null：占位回退）
 * @param rounded - 圆角风格；默认 rounded-lg，详情页大图可用 none
 */
import { useEffect, useState } from "react";
import { Sticker } from "lucide-react";
import { cn } from "@yuanchat/shared/utils";

export function StickerPackCover({
  coverUrl,
  className,
}: {
  coverUrl?: string | null;
  className?: string;
}) {
  const [state, setState] = useState<"loading" | "loaded" | "error">(
    coverUrl ? "loading" : "error",
  );

  // coverUrl 变化（编辑换封面 / 列表复用组件）时重置回加载态
  useEffect(() => {
    setState(coverUrl ? "loading" : "error");
  }, [coverUrl]);

  return (
    <div
      className={cn(
        "bg-surface-container-high relative aspect-square w-full overflow-hidden rounded-lg",
        className,
      )}
    >
      {state !== "loaded" && (
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center",
            state === "loading" && "animate-pulse",
          )}
          aria-hidden
        >
          <Sticker size={28} strokeWidth={1.25} className="text-on-surface-variant opacity-40" />
        </div>
      )}
      {coverUrl && state !== "error" && (
        <img
          src={coverUrl}
          alt=""
          width={256}
          height={256}
          onLoad={() => setState("loaded")}
          onError={() => setState("error")}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-150",
            state === "loaded" ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </div>
  );
}
