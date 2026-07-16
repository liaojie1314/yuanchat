import { useEffect, useState } from "react";

/** 布局断点：手机（<768）/ 平板（768–1179）/ 桌面（≥1180） */
export type Breakpoint = "mobile" | "tablet" | "desktop";

/** 与原型一致的断点阈值：平板起点 768px，桌面（四栏含详情面板）起点 1180px */
export const BREAKPOINTS = { tablet: 768, desktop: 1180 } as const;

function resolve(width: number): Breakpoint {
  if (width >= BREAKPOINTS.desktop) return "desktop";
  if (width >= BREAKPOINTS.tablet) return "tablet";
  return "mobile";
}

/**
 * 响应式断点 Hook
 *
 * @description
 * 监听窗口宽度变化返回当前断点，驱动三端布局切换：
 * - mobile：栈式单栏（列表 ↔ 聊天 二选一 + 底部 Tab）
 * - tablet：双栏（窄导航 + 列表 + 聊天，详情为抽屉）
 * - desktop：三/四栏（导航 + 列表 + 聊天 + 详情面板）
 *
 * 采用 window resize 监听而非 matchMedia change 事件，
 * 兼容旧 Android WebView（Chrome 74）。
 *
 * @example
 * const bp = useBreakpoint();
 * if (bp === "mobile") return <StackedLayout />;
 */
export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() =>
    typeof window === "undefined" ? "desktop" : resolve(window.innerWidth),
  );

  useEffect(() => {
    const onResize = () => setBp(resolve(window.innerWidth));
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return bp;
}
