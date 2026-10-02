/**
 * 图表统一色板。
 *
 * @description 占比图需要**相邻分段一眼能分开**，故用定性色板（不同色相）
 * 而非同一色相的明度阶 —— 明度阶在相邻段之间几乎分不出来。选取原则：
 * 色相间隔足够大、明度接近（避免某段视觉上"更重"）、避开灰黄褐这类
 * 在浅色底上发脏的颜色。第 1 色对齐 primary 蓝，保证与整体设计语言一致。
 * 「其他」这类兜底桶固定走 {@link CHART_MUTED}，不占主色板。
 */
export const CHART_PALETTE = [
  "#4A90D9", // 蓝（对齐 primary）
  "#E8833A", // 橙
  "#3FA796", // 青绿
  "#9B6BD6", // 紫
  "#D9537A", // 品红
  "#7B8B9E", // 蓝灰（第 6 项起才轮到中性色）
] as const;

/** 兜底/次要类目色（「其他」、占位、非重点系列）。 */
export const CHART_MUTED = "#9AA3AE";

/** 按索引取色，超出色板长度时回绕。 */
export function chartColor(index: number): string {
  return CHART_PALETTE[index % CHART_PALETTE.length];
}
