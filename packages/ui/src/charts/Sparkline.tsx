/**
 * Sparkline — 迷你折线趋势图，内嵌于指标卡片右侧。
 *
 * 纯 SVG，无第三方依赖。折线颜色沿用 `currentColor`，
 * 由外层 className 控制（默认跟随 primary token）。
 */
import { useMemo } from "react";

/** 单个数据点：x 轴序号 + y 轴数值。 */
export interface SparklinePoint {
  /** x 轴位置（通常是日期字符串，用于 aria-label） */
  date: string;
  /** y 轴数值 */
  value: number;
}

export interface SparklineProps {
  /** 数据点序列，按升序（最旧在前）排列 */
  data: SparklinePoint[];
  /** SVG 宽度（px），默认 80 */
  width?: number;
  /** SVG 高度（px），默认 32 */
  height?: number;
  /** 描述整张图的无障碍标签 */
  "aria-label": string;
  /** 额外 className（控制颜色等） */
  className?: string;
}

const PAD = 2; // 上下留边，防止折线紧贴边框

/**
 * 把数据映射到 SVG 坐标，返回 polyline 的 points 字符串。
 * 单点时退化成一条水平中线，空数据返回空串。
 */
function toPoints(data: SparklinePoint[], w: number, h: number): string {
  if (data.length === 0) return "";
  const values = data.map((d) => d.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const rangeV = maxV - minV || 1; // 全相等时退化成水平线
  const inner = h - PAD * 2;
  return data
    .map((d, i) => {
      const x = data.length === 1 ? w / 2 : (i / (data.length - 1)) * w;
      const y = PAD + inner - ((d.value - minV) / rangeV) * inner;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/**
 * Sparkline 迷你折线图。
 *
 * @remarks 数据里**没有任何正值**时返回 null 而不画一条贴底平线 ——
 * 那样的线不表达趋势，只会让人以为图坏了。
 *
 * @example
 * ```tsx
 * <Sparkline data={pts} aria-label="近 30 天消息量" className="text-primary" />
 * ```
 */
export function Sparkline({
  data,
  width = 80,
  height = 32,
  "aria-label": ariaLabel,
  className,
}: SparklineProps) {
  const points = useMemo(() => toPoints(data, width, height), [data, width, height]);

  // 全 0 / 空数据不画：平线贴底看不出趋势，反而像渲染坏了
  const hasSignal = data.some((d) => d.value > 0);
  if (!hasSignal) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      className={className}
      style={{ display: "block" }}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
