/**
 * 元聊 YuanChat — 设计令牌
 */
export const colors = {
  primary: {
    50: "#f0f4fa",
    100: "#d9e3f2",
    200: "#b3c9e8",
    300: "#8cafdb",
    400: "#6695ce",
    500: "#4a7cc4",
    600: "#3b63a0",
    700: "#2d4b7c",
    800: "#1e3458",
    900: "#0f1d34",
    950: "#08101e",
  },
  neutral: {
    50: "#f8f9fa",
    100: "#f0f2f4",
    200: "#e1e4e8",
    300: "#c8ccd2",
    400: "#a1a7b0",
    500: "#7b8290",
    600: "#5f6672",
    700: "#464b54",
    800: "#2d3036",
    900: "#1a1c1f",
    950: "#0e0f11",
  },
  accent: { 400: "#f59e0b", 500: "#d97706" },
  status: {
    success: "#22c55e",
    warning: "#f59e0b",
    error: "#ef4444",
    info: "#3b82f6",
  },
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, "2xl": 32, "3xl": 48 } as const;
export const radius = { xs: 4, sm: 6, md: 10, lg: 16, xl: 24, full: 9999 } as const;
export const sidebar = { nav: 64, list: 288, detail: 360 } as const;
export const fontSize = { xs: "11px", sm: "12px", base: "14px", md: "16px", lg: "18px", xl: "22px", "2xl": "28px" } as const;
