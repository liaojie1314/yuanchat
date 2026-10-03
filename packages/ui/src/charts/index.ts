/**
 * 零依赖 SVG 图表组件库（纯 React + SVG，无第三方图表库）。
 *
 * - {@link Sparkline}：迷你折线，内嵌于指标卡片
 * - {@link LineChart}：带坐标轴的全尺寸折线图
 * - {@link DonutChart}：环形占比图
 */
export { Sparkline } from "./Sparkline";
export type { SparklineProps, SparklinePoint } from "./Sparkline";

export { LineChart } from "./LineChart";
export type { LineChartProps, LineSeries } from "./LineChart";

export { DonutChart } from "./DonutChart";
export type { DonutChartProps, DonutSlice } from "./DonutChart";

export { CHART_PALETTE, CHART_MUTED, chartColor } from "./palette";

export { useElementWidth } from "./useElementWidth";
