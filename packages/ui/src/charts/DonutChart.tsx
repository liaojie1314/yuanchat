/**
 * DonutChart — 环形占比图，用于消息类型分布等场景。
 *
 * 纯 SVG，无第三方依赖。鼠标悬停某段时该段加粗高亮、中心显示该类目
 * 占比；移出恢复总量。分段可 Tab 聚焦（键盘可达）。图例由外部渲染，
 * 颜色用 {@link donutColor} 取，保证色块与弧段一致。
 */
import { useMemo, useState } from "react";
import { CHART_MUTED, chartColor } from "./palette";

/** 单个分段。 */
export interface DonutSlice {
  /** 分段标识（唯一） */
  key: string;
  /** 显示标签 */
  label: string;
  /** 数值（非负） */
  value: number;
  /** CSS 颜色（默认从内置调色板按序取） */
  color?: string;
}

export interface DonutChartProps {
  /** 数据分段列表，超过 6 条时末尾聚合为"其他" */
  slices: DonutSlice[];
  /** SVG 尺寸（宽=高，px），默认 140 */
  size?: number;
  /** 圆环厚度（px），默认 18 */
  thickness?: number;
  /** 中心常驻标题（无 hover 时显示，通常配总量） */
  centerLabel?: string;
  /** 描述整张图的无障碍标签 */
  "aria-label": string;
  /** 额外 className */
  className?: string;
}

// 色板来自 palette.ts：定性色板 + 中性灰兜底，相邻分段一眼可分
const MUTED = CHART_MUTED;
const MAX_SLICES = 6;

/** 极坐标 → 直角坐标。 */
function polar(cx: number, cy: number, r: number, angleRad: number) {
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

/** 单个弧形 path（大弧标志由角度决定）。 */
function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const s = polar(cx, cy, r, startAngle);
  const e = polar(cx, cy, r, endAngle);
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

/**
 * DonutChart 环形图。
 *
 * @example
 * ```tsx
 * <DonutChart
 *   slices={[{ key: "text", label: "文本", value: 120 }, ...]}
 *   centerLabel="总消息"
 *   aria-label="消息类型分布"
 * />
 * ```
 */
export function DonutChart({
  slices,
  size = 140,
  thickness = 18,
  centerLabel,
  "aria-label": ariaLabel,
  className,
}: DonutChartProps) {
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - thickness) / 2;
  const [active, setActive] = useState<string | null>(null);

  const { total, paths } = useMemo(() => {
    let list = slices.filter((s) => s.value > 0);
    if (list.length > MAX_SLICES) {
      const head = list.slice(0, MAX_SLICES - 1);
      const rest = list.slice(MAX_SLICES - 1);
      const otherVal = rest.reduce((acc, s) => acc + s.value, 0);
      list = [...head, { key: "__other__", label: "其他", value: otherVal }];
    }
    const total = list.reduce((acc, s) => acc + s.value, 0);
    if (total === 0) return { total: 0, paths: [] };

    const TAU = Math.PI * 2;
    const START = -Math.PI / 2; // 从顶部开始
    const GAP = list.length > 1 ? 0.03 : 0; // 分段间隙（弧度）
    let angle = START;

    const paths = list.map((slice, i) => {
      const sweep = (slice.value / total) * TAU - GAP;
      const endAngle = angle + sweep;
      const path = arcPath(cx, cy, r, angle, endAngle);
      angle = endAngle + GAP;
      return {
        key: slice.key,
        label: slice.label,
        value: slice.value,
        color: slice.color ?? chartColor(i),
        path,
      };
    });
    return { total, paths };
  }, [slices, cx, cy, r]);

  const activePath = paths.find((p) => p.key === active);
  const centerValue = activePath
    ? `${Math.round((activePath.value / total) * 100)}%`
    : total > 0
      ? total.toLocaleString()
      : "";
  const centerText = activePath ? activePath.label : (centerLabel ?? "");

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={ariaLabel}
      className={className}
      style={{ display: "block", overflow: "visible" }}
      onMouseLeave={() => setActive(null)}
    >
      {paths.length === 0 ? (
        // 空数据：灰色满圆占位
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={MUTED}
          strokeWidth={thickness}
          opacity={0.4}
        />
      ) : (
        paths.map(({ key, path, color, label }) => {
          const on = active === key;
          return (
            <path
              key={key}
              d={path}
              fill="none"
              stroke={color}
              // hover 加粗而非改半径：改半径要重算 path，成本高且会跳动
              strokeWidth={on ? thickness + 6 : thickness}
              tabIndex={0}
              aria-label={label}
              onMouseEnter={() => setActive(key)}
              onFocus={() => setActive(key)}
              onBlur={() => setActive(null)}
              style={{ cursor: "pointer", transition: "stroke-width 120ms ease", outline: "none" }}
            />
          );
        })
      )}
      {/* 中心文字：hover 时显示该段名称与占比，否则显示总量 */}
      {(centerText || centerValue) && (
        <g pointerEvents="none">
          {centerValue && (
            <text
              x={cx}
              y={centerText ? cy - 3 : cy + 4}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={size > 120 ? 18 : 15}
              fontWeight={600}
              fill="currentColor"
            >
              {centerValue}
            </text>
          )}
          {centerText && (
            <text
              x={cx}
              y={cy + 15}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={11}
              fill="currentColor"
              opacity={0.65}
            >
              {centerText}
            </text>
          )}
        </g>
      )}
    </svg>
  );
}
