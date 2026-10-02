/**
 * DonutChart — 环形占比图，用于消息类型分布等场景。
 *
 * 纯 SVG，无第三方依赖。支持 2-6 个分段，超出部分聚合进 "其他"。
 * 空数据退化成灰色满圆占位，单条数据仍正常渲染。
 */
import { useMemo } from "react";

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
  /** SVG 尺寸（宽=高，px），默认 120 */
  size?: number;
  /** 圆环厚度（px），默认 18 */
  thickness?: number;
  /** 描述整张图的无障碍标签 */
  "aria-label": string;
  /** 额外 className */
  className?: string;
}

// 与 primary token 调色板协调的分类色组（最多 6 色）
const PALETTE = [
  "var(--color-primary, #5B9BD5)",
  "var(--color-secondary, #72A98F)",
  "var(--color-tertiary, #C08B5C)",
  "#E07070",
  "#8B72C8",
  "#C8B45A",
];
const MUTED = "var(--color-outline-variant, #C2C8D3)";
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
 *   aria-label="消息类型分布"
 * />
 * ```
 */
export function DonutChart({
  slices,
  size = 120,
  thickness = 18,
  "aria-label": ariaLabel,
  className,
}: DonutChartProps) {
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - thickness) / 2;

  const paths = useMemo(() => {
    // 聚合超出上限的分段
    let items = slices.filter((s) => s.value > 0);
    if (items.length > MAX_SLICES) {
      const head = items.slice(0, MAX_SLICES - 1);
      const rest = items.slice(MAX_SLICES - 1);
      const otherVal = rest.reduce((acc, s) => acc + s.value, 0);
      items = [...head, { key: "__other__", label: "其他", value: otherVal }];
    }

    if (items.length === 0) return [];

    const total = items.reduce((acc, s) => acc + s.value, 0);
    if (total === 0) return [];

    const TAU = Math.PI * 2;
    const START = -Math.PI / 2; // 从顶部开始
    let angle = START;
    const GAP = items.length > 1 ? 0.025 : 0; // 分段间隙（弧度）

    return items.map((slice, i) => {
      const sweep = (slice.value / total) * TAU - GAP;
      const endAngle = angle + sweep;
      const path = arcPath(cx, cy, r, angle, endAngle);
      const midAngle = angle + sweep / 2;
      const color = slice.color ?? PALETTE[i % PALETTE.length];
      angle = endAngle + GAP;
      return { key: slice.key, path, color, midAngle, label: slice.label, value: slice.value };
    });
  }, [slices, cx, cy, r]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={ariaLabel}
      className={className}
      style={{ display: "block" }}
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
        paths.map(({ key, path, color }) => (
          <path
            key={key}
            d={path}
            fill="none"
            stroke={color}
            strokeWidth={thickness}
            strokeLinecap="round"
          />
        ))
      )}
    </svg>
  );
}
