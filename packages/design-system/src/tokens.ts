/**
 * 元聊 YuanChat — Material Design 3 设计令牌
 *
 * @description
 * 基于 Google Material Design 3 规范的设计令牌系统。
 * 使用 CSS 自定义属性实现，支持运行时动态主题切换。
 *
 * M3 颜色系统：
 * - Primary（主色）：品牌色，用于主要按钮、活跃状态
 * - Secondary（次要色）：补充色，用于滤镜、标签等
 * - Tertiary（第三色）：对比色，用于强调元素
 * - Error（错误色）：错误状态
 * - Neutral（中性色）：背景、表面、文本
 * - Neutral Variant（中性变体）：轮廓、次要文本
 *
 * @see https://m3.material.io/
 */

// ========================================
// M3 动态颜色方案
// ========================================

/** M3 色调定义 */
export interface M3TonalPalette {
  0: string;
  10: string;
  20: string;
  30: string;
  40: string;
  50: string;
  60: string;
  70: string;
  80: string;
  90: string;
  95: string;
  99: string;
  100: string;
}

/** M3 颜色方案 */
export interface M3ColorScheme {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  tertiary: string;
  onTertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;
  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;
  background: string;
  onBackground: string;
  surface: string;
  onSurface: string;
  surfaceVariant: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
  surfaceDim: string;
  surfaceBright: string;
  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  inverseSurface: string;
  inverseOnSurface: string;
  inversePrimary: string;
  shadow: string;
  scrim: string;
}

// ========================================
// M3 亮色主题（Blue-Purple）
// ========================================

/** 元聊 M3 亮色主题 — 品牌蓝，活力鲜明 */
export const lightScheme: M3ColorScheme = {
  primary: "#3366FF",
  onPrimary: "#FFFFFF",
  primaryContainer: "#DBE3FF",
  onPrimaryContainer: "#001A6B",
  secondary: "#5A5D72",
  onSecondary: "#FFFFFF",
  secondaryContainer: "#DFE1F9",
  onSecondaryContainer: "#171A2C",
  tertiary: "#6D4B8E",
  onTertiary: "#FFFFFF",
  tertiaryContainer: "#F2DAFF",
  onTertiaryContainer: "#270047",
  error: "#BA1A1A",
  onError: "#FFFFFF",
  errorContainer: "#FFDAD6",
  onErrorContainer: "#410002",
  background: "#F5F7FF",
  onBackground: "#181C2C",
  surface: "#F5F7FF",
  onSurface: "#181C2C",
  surfaceVariant: "#E1E3F0",
  onSurfaceVariant: "#444750",
  outline: "#747780",
  outlineVariant: "#C4C6D2",
  surfaceDim: "#D6D9E8",
  surfaceBright: "#F5F7FF",
  surfaceContainerLowest: "#FFFFFF",
  surfaceContainerLow: "#EFF1FC",
  surfaceContainer: "#E9EBF6",
  surfaceContainerHigh: "#E3E5F0",
  surfaceContainerHighest: "#DEE0EB",
  inverseSurface: "#2D3040",
  inverseOnSurface: "#F1F1F7",
  inversePrimary: "#B3C5FF",
  shadow: "#000000",
  scrim: "#000000",
};

// ========================================
// M3 暗色主题
// ========================================

/** 元聊 M3 暗色主题 — 深邃蓝紫，品牌色发光 */
export const darkScheme: M3ColorScheme = {
  primary: "#99B5FF",
  onPrimary: "#00298A",
  primaryContainer: "#1B3FB0",
  onPrimaryContainer: "#DBE3FF",
  secondary: "#C4C6DD",
  onSecondary: "#2D3042",
  secondaryContainer: "#434759",
  onSecondaryContainer: "#E0E2F9",
  tertiary: "#DBB8F2",
  onTertiary: "#3E135D",
  tertiaryContainer: "#562B75",
  onTertiaryContainer: "#F2DAFF",
  error: "#FFB4AB",
  onError: "#690005",
  errorContainer: "#93000A",
  onErrorContainer: "#FFDAD6",
  background: "#0F1119",
  onBackground: "#E2E2EC",
  surface: "#0F1119",
  onSurface: "#E2E2EC",
  surfaceVariant: "#444750",
  onSurfaceVariant: "#C4C6D2",
  outline: "#8E909A",
  outlineVariant: "#444750",
  surfaceDim: "#0F1119",
  surfaceBright: "#353745",
  surfaceContainerLowest: "#0A0C14",
  surfaceContainerLow: "#171A26",
  surfaceContainer: "#1B1E2A",
  surfaceContainerHigh: "#262835",
  surfaceContainerHighest: "#303340",
  inverseSurface: "#E2E2EC",
  inverseOnSurface: "#2D3040",
  inversePrimary: "#3366FF",
  shadow: "#000000",
  scrim: "#000000",
};

// ========================================
// M3 版式系统 (Typography)
// ========================================

/** 字号缩放比例 */
export const fontScale = {
  small: 0.85,
  normal: 1.0,
  large: 1.15,
  xlarge: 1.3,
} as const;

export type FontScale = keyof typeof fontScale;

/** M3 字体大小（以 normal 缩放为基础，单位 rem） */
export const typography = {
  display: { large: "3.562rem", medium: "2.812rem", small: "2.25rem" },
  headline: { large: "2rem", medium: "1.75rem", small: "1.5rem" },
  title: { large: "1.375rem", medium: "1rem", small: "0.875rem" },
  body: { large: "1rem", medium: "0.875rem", small: "0.75rem" },
  label: { large: "0.875rem", medium: "0.75rem", small: "0.688rem" },
} as const;

// ========================================
// M3 形状 (Shapes)
// ========================================

export const shapes = {
  none: "0px",
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "28px",
  full: "9999px",
} as const;

// ========================================
// M3 高度 (Elevation)
// ========================================

export const elevation = {
  0: "none",
  1: "0px 1px 2px 0px rgba(0,0,0,0.3), 0px 1px 3px 1px rgba(0,0,0,0.15)",
  2: "0px 1px 2px 0px rgba(0,0,0,0.3), 0px 2px 6px 2px rgba(0,0,0,0.15)",
  3: "0px 4px 8px 3px rgba(0,0,0,0.15), 0px 1px 3px 0px rgba(0,0,0,0.3)",
  4: "0px 6px 10px 4px rgba(0,0,0,0.15), 0px 2px 3px 0px rgba(0,0,0,0.3)",
  5: "0px 8px 12px 6px rgba(0,0,0,0.15), 0px 4px 4px 0px rgba(0,0,0,0.3)",
} as const;

// ========================================
// M3 状态层 (State Layers)
// ========================================

/** 状态层不透明度（叠加在元素上产生交互反馈） */
export const stateLayer = {
  hover: "0.08",
  focus: "0.12",
  pressed: "0.12",
  drag: "0.16",
} as const;

// ========================================
// M3 动画
// ========================================

export const motion = {
  duration: {
    short1: "50ms",
    short2: "100ms",
    short3: "150ms",
    medium1: "200ms",
    medium2: "250ms",
    medium3: "300ms",
    long1: "350ms",
    long2: "400ms",
    long3: "450ms",
  },
  easing: {
    standard: "cubic-bezier(0.2, 0, 0, 1.0)",
    emphasized: "cubic-bezier(0.2, 0, 0, 1.0)",
    decelerate: "cubic-bezier(0.05, 0.7, 0.1, 1.0)",
    accelerate: "cubic-bezier(0.3, 0.0, 0.8, 0.15)",
  },
} as const;
