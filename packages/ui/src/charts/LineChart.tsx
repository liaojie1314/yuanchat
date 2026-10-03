/**
 * LineChart — 带坐标轴和网格的折线图，用于概览页时间序列展示。
 *
 * 纯 SVG，无第三方依赖。宽度由容器实测（`useElementWidth`），
 * 不靠 viewBox 拉伸 —— 否则宽高比不一致时会被 letterbox 缩成中间一小块。
 */
import { useMemo } from "react";
import { useElementWidth } from "./useElementWidth";

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
  /** 容器不可测量时的回退宽度（px），默认 640 */
  fallbackWidth?: number;
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
  /** 是否显示图例（多条系列时建议开） */
  showLegend?: boolean;
}

const MARGIN = { top: 12, right: 16, bottom: 28, left: 40 };
/** 相邻刻度标签的最小像素间距，低于此值就抽稀刻度 */
const MIN_TICK_GAP = 48;

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
 * 按最小像素间距抽稀 X 轴刻度，并且**末尾刻度优先保留**。
 *
 * @remarks 早先的实现是「每 step 个取一个，再追加末尾」，
 * 于是末尾与前一个抽稀点挨得极近，标签直接叠印（如 `10-0202`）。
 * 这里改成从右往左按 `MIN_TICK_GAP` 选点：末尾必留，其余只在与
 * 已选点间距足够时才保留。
 */
function pickXTicks(n: number, innerW: number, maxTicks: number): number[] {
  if (n <= 1) return n === 1 ? [0] : [];
  const gap = Math.max(innerW / (maxTicks - 1), MIN_TICK_GAP);
  const picked: number[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const last = picked[picked.length - 1];
    if (last === undefined || Math.abs(((last - i) / (n - 1)) * innerW) >= gap) {
      picked.push(i);
    }
  }
  return picked.reverse();
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
  fallbackWidth = 640,
  height = 200,
  "aria-label": ariaLabel,
  className,
  maxXTicks = 7,
  maxYTicks = 4,
  showLegend = false,
}: LineChartProps) {
  const [containerRef, width] = useElementWidth(fallbackWidth);
  const innerW = Math.max(width - MARGIN.left - MARGIN.right, 40);
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const n = xLabels.length;

  const { yMax, paths, xTickIdx, yTicks } = useMemo(() => {
    if (n === 0) return { yMax: 1, paths: [], xTickIdx: [], yTicks: [] };

    const allValues = series.flatMap((s) => s.values);
    const dataMax = Math.max(0, ...allValues);
    const { max: yMax, step: yStep } = yAxis(dataMax, maxYTicks);

    const yTickCount = Math.round(yMax / yStep);
    const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) => i * yStep);

    const xAt = (i: number) => (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yAt = (v: number) => innerH - (v / yMax) * innerH;

    const paths = series.map((s) => {
      const pts = s.values.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
      return {
        key: s.key,
        color: s.color,
        d: pts.length > 0 ? `M${pts.join("L")}` : "",
      };
    });

    return { yMax, paths, xTickIdx: pickXTicks(n, innerW, maxXTicks), yTicks };
  }, [n, series, innerW, innerH, maxXTicks, maxYTicks]);

  const xAt = (i: number) => (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => innerH - (v / yMax) * innerH;

  // 数值紧凑格式：1000 → 1k，避免 Y 轴标签占宽
  const fmtTick = (v: number) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : String(v));

  return (
    <div ref={containerRef} className={className}>
      {showLegend && series.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
          {series.map((s) => (
            <span key={s.key} className="text-label-sm flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-4 rounded-full"
                style={{ background: s.color ?? "currentColor" }}
              />
              <span className="text-on-surface-variant">{s.label}</span>
            </span>
          ))}
        </div>
      )}
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        style={{ display: "block" }}
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {/* 水平网格线 */}
          {yTicks.map((v) => (
            <line
              key={`g${v}`}
              x1={0}
              y1={yAt(v)}
              x2={innerW}
              y2={yAt(v)}
              stroke="currentColor"
              strokeOpacity={0.12}
              strokeWidth={1}
            />
          ))}

          {/* Y 轴刻度标签 */}
          {yTicks.map((v) => (
            <text
              key={`yt${v}`}
              x={-8}
              y={yAt(v)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={11}
              fill="currentColor"
              opacity={0.55}
            >
              {fmtTick(v)}
            </text>
          ))}

          {/* X 轴刻度标签（已按最小间距抽稀，不会重叠） */}
          {xTickIdx.map((i) => (
            <text
              key={`xt${i}`}
              x={xAt(i)}
              y={innerH + 17}
              textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
              fontSize={11}
              fill="currentColor"
              opacity={0.55}
            >
              {xLabels[i].length === 10 ? xLabels[i].slice(5) : xLabels[i]}
            </text>
          ))}

          {/* 折线 */}
          {paths.map(({ key, color, d }) =>
            d ? (
              <path
                key={key}
                d={d}
                fill="none"
                stroke={color ?? "currentColor"}
                strokeWidth={1.75}
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
            strokeOpacity={0.25}
            strokeWidth={1}
          />
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={innerH}
            stroke="currentColor"
            strokeOpacity={0.25}
            strokeWidth={1}
          />
        </g>
      </svg>
    </div>
  );
}
