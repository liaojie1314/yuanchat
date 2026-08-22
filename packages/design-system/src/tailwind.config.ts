/**
 * 元聊 Tailwind 预设 — Material Design 3 颜色系统
 *
 * @description
 * 所有颜色值通过 CSS 自定义属性（--md-sys-color-*）引用，
 * 由 useThemeStore.applyTheme() 在运行时注入。
 * 这使得切换皮肤无需重新构建 CSS，只需修改 CSS 变量值。
 */
import type { Config } from "tailwindcss";

export const yuanchatPreset: Partial<Config> = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // M3 Primary — 主色
        primary: {
          DEFAULT: "rgb(var(--md-sys-color-primary-rgb) / <alpha-value>)",
          on: "rgb(var(--md-sys-color-on-primary-rgb) / <alpha-value>)",
          container: "rgb(var(--md-sys-color-primary-container-rgb) / <alpha-value>)",
          "on-container": "rgb(var(--md-sys-color-on-primary-container-rgb) / <alpha-value>)",
        },
        // M3 Surface — 表面
        surface: {
          DEFAULT: "rgb(var(--md-sys-color-surface-rgb) / <alpha-value>)",
          dim: "rgb(var(--md-sys-color-surface-dim-rgb) / <alpha-value>)",
          bright: "rgb(var(--md-sys-color-surface-bright-rgb) / <alpha-value>)",
          container: "rgb(var(--md-sys-color-surface-container-rgb) / <alpha-value>)",
          "container-low": "rgb(var(--md-sys-color-surface-container-low-rgb) / <alpha-value>)",
          "container-high": "rgb(var(--md-sys-color-surface-container-high-rgb) / <alpha-value>)",
          variant: "rgb(var(--md-sys-color-surface-variant-rgb) / <alpha-value>)",
          "on-variant": "rgb(var(--md-sys-color-on-surface-variant-rgb) / <alpha-value>)",
        },
        // 表面之上的文字色
        "on-surface": "rgb(var(--md-sys-color-on-surface-rgb) / <alpha-value>)",
        "on-background": "rgb(var(--md-sys-color-on-background-rgb) / <alpha-value>)",
        // M3 次要色
        secondary: {
          DEFAULT: "rgb(var(--md-sys-color-secondary-rgb) / <alpha-value>)",
          container: "rgb(var(--md-sys-color-secondary-container-rgb) / <alpha-value>)",
        },
        // M3 第三色
        tertiary: "rgb(var(--md-sys-color-tertiary-rgb) / <alpha-value>)",
        // M3 错误色
        error: {
          DEFAULT: "rgb(var(--md-sys-color-error-rgb) / <alpha-value>)",
          container: "rgb(var(--md-sys-color-error-container-rgb) / <alpha-value>)",
        },
        // M3 描边色
        outline: {
          DEFAULT: "rgb(var(--md-sys-color-outline-rgb) / <alpha-value>)",
          variant: "rgb(var(--md-sys-color-outline-variant-rgb) / <alpha-value>)",
        },
        // 背景色
        background: "rgb(var(--md-sys-color-background-rgb) / <alpha-value>)",
      },
      fontSize: {
        // 动态字号 = 基准 × font-scale CSS 变量
        "display-lg": "calc(3.562rem * var(--font-scale, 1))",
        "display-md": "calc(2.812rem * var(--font-scale, 1))",
        "display-sm": "calc(2.25rem * var(--font-scale, 1))",
        "headline-lg": "calc(2rem * var(--font-scale, 1))",
        "headline-md": "calc(1.75rem * var(--font-scale, 1))",
        "headline-sm": "calc(1.5rem * var(--font-scale, 1))",
        "title-lg": "calc(1.375rem * var(--font-scale, 1))",
        "title-md": "calc(1rem * var(--font-scale, 1))",
        "title-sm": "calc(0.875rem * var(--font-scale, 1))",
        "body-lg": "calc(1rem * var(--font-scale, 1))",
        "body-md": "calc(0.875rem * var(--font-scale, 1))",
        "body-sm": "calc(0.75rem * var(--font-scale, 1))",
        "label-lg": "calc(0.875rem * var(--font-scale, 1))",
        "label-md": "calc(0.75rem * var(--font-scale, 1))",
        "label-sm": "calc(0.688rem * var(--font-scale, 1))",
      },
      fontFamily: {
        sans: ['"Inter"', '"Noto Sans SC"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      borderRadius: {
        xs: "4px",
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "28px",
        full: "9999px",
      },
      boxShadow: {
        "elevation-1": "var(--md-elevation-1)",
        "elevation-2": "var(--md-elevation-2)",
        "elevation-3": "var(--md-elevation-3)",
        "elevation-4": "var(--md-elevation-4)",
        "elevation-5": "var(--md-elevation-5)",
      },
      animation: {
        "fade-in": "fadeIn 0.2s var(--md-easing-standard)",
        "slide-up": "slideUp 0.25s var(--md-easing-emphasized)",
        "slide-left": "slideLeft 0.3s var(--md-easing-standard)",
        "scale-in": "scaleIn 0.2s var(--md-easing-emphasized)",
      },
      keyframes: {
        fadeIn: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideLeft: {
          "0%": { opacity: "0", transform: "translateX(16px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        scaleIn: {
          "0%": { opacity: "0", transform: "scale(0.92)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
      },
    },
  },
  plugins: [],
};
