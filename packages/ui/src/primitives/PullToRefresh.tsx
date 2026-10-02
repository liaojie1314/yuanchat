/**
 * PullToRefresh — 下拉刷新滚动容器
 *
 * @description
 * **它本身就是滚动容器**，用来替换各屏原有的那层 `overflow-y-auto` div，
 * 而不是再往外包一层。两层滚动容器叠在一起的话，外层 `scrollTop` 恒为 0 ——
 * 手势判定会误认为列表还在顶部，往下滚到一半照样触发刷新。
 * 接入时把原来那个 div 的 className / ref / onScroll 平移过来即可。
 *
 * 指示器只在下拉或刷新时才插入 DOM，静止时不占位（骨架屏约束要求 CLS 为零）。
 *
 * @example
 * <PullToRefresh ref={scrollerRef} onRefresh={load} className="flex-1 overflow-y-auto px-2">
 *   {items.map(…)}
 * </PullToRefresh>
 */
import { forwardRef, type HTMLAttributes } from "react";
import { ArrowDown, Loader2 } from "lucide-react";
import { cn } from "@yuanchat/shared/utils";
import { usePullToRefresh, PULL_THRESHOLD } from "../util/usePullToRefresh";

export type PullToRefreshProps = HTMLAttributes<HTMLDivElement> & {
  /** 刷新回调，复用本屏已有的 load 函数 */
  onRefresh: () => Promise<unknown>;
};

export const PullToRefresh = forwardRef<HTMLDivElement, PullToRefreshProps>(function PullToRefresh(
  { onRefresh, className, children, ...rest },
  ref,
) {
  const { handlers, distance, refreshing } = usePullToRefresh(onRefresh);
  const ready = distance >= PULL_THRESHOLD;

  return (
    <div
      ref={ref}
      data-testid="pull-to-refresh"
      {...rest}
      {...handlers}
      className={cn("overscroll-y-contain", className)}
    >
      {distance > 0 ? (
        <div
          data-testid="pull-indicator"
          className="text-on-surface-variant flex items-center justify-center overflow-hidden"
          style={{ height: distance }}
        >
          {refreshing ? (
            <Loader2 size={18} className="motion-safe:animate-spin" />
          ) : (
            // 越过阈值后箭头转向上，告诉用户「松手就刷」
            <ArrowDown size={18} className={cn("transition-transform", ready && "rotate-180")} />
          )}
        </div>
      ) : null}
      {children}
    </div>
  );
});
