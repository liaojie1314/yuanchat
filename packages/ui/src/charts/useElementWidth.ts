/**
 * useElementWidth — 观测容器实际像素宽度，供 SVG 图表按容器尺寸绘制。
 *
 * @description 图表不能只靠 `w-full` 拉伸：viewBox 与容器宽高比不一致时
 * 浏览器会按 `preserveAspectRatio` letterbox，图表缩在中间一小块、
 * 两侧留大片空白。这里直接量出真实宽度再喂给 viewBox，图随容器自适应。
 *
 * ResizeObserver 不可用时（jsdom 等测试环境）退回初始宽度，不影响断言。
 */
import { useEffect, useRef, useState } from "react";

/**
 * @param fallback 观测不到时使用的宽度（px）
 * @returns 容器 ref 与当前宽度
 */
export function useElementWidth(
  fallback: number,
): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      // 只在真的变了才 setState，避免 ResizeObserver 回调抖动导致无限重渲染
      if (w > 0) setWidth((prev) => (Math.abs(prev - w) < 1 ? prev : w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width];
}
