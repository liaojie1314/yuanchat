/**
 * LineChart — 带坐标轴和网格的折线图，用于概览页时间序列展示。
 *
 * 纯 SVG，无第三方依赖。支持多条折线（通过 series），
 * 空/单点安全，坐标轴从零起始，自适应 Y 轴刻度。
 */
import { useMemo } from "react";

/** 单条折线的数据系列。 */
export interface LineSeries {
  /** 系列标识（用于图例与 aria-label） */
  key: string;
  /** 显示标签 */
  label: string;
  /** 数据点列表，与 xLabels 等长 */
  values: number[];
  /** CSS 颜色（默认跟随父级 currentColor） */
  color?: string;
}

export interface LineChartProps {
  /** X 轴标签序列（通常是日期字符串，最旧在前） */
  xLabels: string[];
  /** 折线系列，至少一条 */
  series: LineSeries[];
  /** SVG 宽度（px），默认 400 */
  width?: number;
  /** SVG 高度（px），默认 200 */
  height?: number;
  /** 描述整张图的无障碍标签 */
  "aria-label": string;
  /** 额外 className */
  className?: string;
  /** X 轴最多显示的刻度数，默认 7 */
  maxXTicks?: number;
  /** Y 轴最多显示的刻度数，默认 4 */
  maxYTicks?: number;
}

const MARGIN = { top: 8, right: 12, bottom: 28, left: 36 };

/** 把数值对齐到「好看的」步长：1/2/5/10/20/50/100… */
function niceStep(rawStep: number): number {
  const exp = Math.floor(Math.log10(rawStep));
  const base = Math.pow(10, exp);
  const frac = rawStep / base;
  if (frac <= 1) return base;
  if (frac <= 2) return 2 * base;
  if (frac <= 5) return 5 * base;
  return 10 * base;
}

/** 计算 Y 轴上界与步长，保证从 0 开始、步长整洁。 */
function yAxis(maxVal: number, ticks: number): { max: number; step: number } {
  if (maxVal <= 0) return { max: ticks, step: 1 };
  const rawStep = maxVal / ticks;
  const step = niceStep(rawStep);
  const max = Math.ceil(maxVal / step) * step;
  return { max, step };
}

/**
 * LineChart 折线图。
 *
 * @example
 * ```tsx
 * <LineChart
 *   xLabels={dates}
 *   series={[{ key: "msg", label: "消息", values: counts, color: "var(--color-primary)" }]}
 *   aria-label="近 30 天消息量"
 * />
 * ```
 */
export function LineChart({
  xLabels,
  series,
  width = 400,
  height = 200,
  "aria-label": ariaLabel,
  className,
  maxXTicks = 7,
  maxYTicks = 4,
}: LineChartProps) {
  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const n = xLabels.length;

  const { yMax, paths, xTicks, yTicks } = useMemo(() => {
    if (n === 0) return { yMax: 1, paths: [], xTicks: [], yTicks: [] };

    const allValues = series.flatMap((s) => s.values);
    const dataMax = Math.max(0, ...allValues);
    const { max: yMax, step: yStep } = yAxis(dataMax, maxYTicks);

    // X 轴刻度（均匀抽取）
    const xStep = Math.max(1, Math.ceil(n / maxXTicks));
    const xTicks = xLabels
      .map((label, i) => ({ label, i }))
      .filter(({ i }) => i % xStep === 0 || i === n - 1);

    // Y 轴刻度
    const yTickCount = Math.round(yMax / yStep);
    const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) => i * yStep);

    // 坐标映射
    const xAt = (i: number) => (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yAt = (v: number) => innerH - (v / yMax) * innerH;

    // 折线 path
    const paths = series.map((s) => {
      const pts = s.values.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
      return {
        key: s.key,
        color: s.color,
        d: pts.length > 0 ? `M${pts.join("L")}` : "",
      };
    });

    return { yMax, paths, xTicks, yTicks };
  }, [n, xLabels, series, innerW, innerH, maxXTicks, maxYTicks]);

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
      <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
        {/* 水平网格线 */}
        {yTicks.map((v) => {
          const y = innerH - (v / yMax) * innerH;
          return (
            <line
              key={v}
              x1={0}
              y1={y}
              x2={innerW}
              y2={y}
              stroke="currentColor"
              strokeOpacity={0.1}
              strokeWidth={1}
            />
          );
        })}

        {/* Y 轴刻度标签 */}
        {yTicks.map((v) => {
          const y = innerH - (v / yMax) * innerH;
          return (
            <text
              key={v}
              x={-6}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={10}
              fill="currentColor"
              opacity={0.5}
            >
              {v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : v}
            </text>
          );
        })}

        {/* X 轴刻度标签 */}
        {xTicks.map(({ label, i }) => {
          const x = n === 1 ? innerW / 2 : (i / (n - 1)) * innerW;
          // 只显示 MM-DD
          const short = label.length === 10 ? label.slice(5) : label;
          return (
            <text
              key={i}
              x={x}
              y={innerH + 16}
              textAnchor="middle"
              fontSize={10}
              fill="currentColor"
              opacity={0.5}
            >
              {short}
            </text>
          );
        })}

        {/* 折线 */}
        {paths.map(({ key, color, d }) =>
          d ? (
            <path
              key={key}
              d={d}
              fill="none"
              stroke={color ?? "currentColor"}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null,
        )}

        {/* 坐标轴基线 */}
        <line
          x1={0}
          y1={innerH}
          x2={innerW}
          y2={innerH}
          stroke="currentColor"
          strokeOpacity={0.2}
          strokeWidth={1}
        />
        <line
          x1={0}
          y1={0}
          x2={0}
          y2={innerH}
          stroke="currentColor"
          strokeOpacity={0.2}
          strokeWidth={1}
        />
      </g>
    </svg>
  );
}
