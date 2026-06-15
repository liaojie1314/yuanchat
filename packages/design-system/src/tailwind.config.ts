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
          DEFAULT: "rgb(var(--md-sys-color-primary) / <alpha-value>)",
          on: "rgb(var(--md-sys-color-on-primary) / <alpha-value>)",
          container: "rgb(var(--md-sys-color-primary-container) / <alpha-value>)",
          "on-container": "rgb(var(--md-sys-color-on-primary-container) / <alpha-value>)",
        },
        // M3 Surface — 表面
        surface: {
          DEFAULT: "rgb(var(--md-sys-color-surface) / <alpha-value>)",
          dim: "rgb(var(--md-sys-color-surface-dim) / <alpha-value>)",
          bright: "rgb(var(--md-sys-color-surface-bright) / <alpha-value>)",
          container: "rgb(var(--md-sys-color-surface-container) / <alpha-value>)",
          "container-low": "rgb(var(--md-sys-color-surface-container-low) / <alpha-value>)",
          "container-high": "rgb(var(--md-sys-color-surface-container-high) / <alpha-value>)",
          variant: "rgb(var(--md-sys-color-surface-variant) / <alpha-value>)",
          "on-variant": "rgb(var(--md-sys-color-on-surface-variant) / <alpha-value>)",
        },
        // On-surface text
        "on-surface": "rgb(var(--md-sys-color-on-surface) / <alpha-value>)",
        "on-background": "rgb(var(--md-sys-color-on-background) / <alpha-value>)",
        // M3 Secondary
        secondary: {
          DEFAULT: "rgb(var(--md-sys-color-secondary) / <alpha-value>)",
          container: "rgb(var(--md-sys-color-secondary-container) / <alpha-value>)",
        },
        // M3 Tertiary
        tertiary: "rgb(var(--md-sys-color-tertiary) / <alpha-value>)",
        // M3 Error
        error: {
          DEFAULT: "rgb(var(--md-sys-color-error) / <alpha-value>)",
          container: "rgb(var(--md-sys-color-error-container) / <alpha-value>)",
        },
        // M3 Outline
        outline: {
          DEFAULT: "rgb(var(--md-sys-color-outline) / <alpha-value>)",
          variant: "rgb(var(--md-sys-color-outline-variant) / <alpha-value>)",
        },
        // Background
        background: "rgb(var(--md-sys-color-background) / <alpha-value>)",
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
        slideUp: { "0%": { opacity: "0", transform: "translateY(12px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        slideLeft: { "0%": { opacity: "0", transform: "translateX(16px)" }, "100%": { opacity: "1", transform: "translateX(0)" } },
        scaleIn: { "0%": { opacity: "0", transform: "scale(0.92)" }, "100%": { opacity: "1", transform: "scale(1)" } },
      },
    },
  },
  plugins: [],
};
