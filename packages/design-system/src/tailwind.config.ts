import type { Config } from "tailwindcss";

export const yuanchatPreset: Partial<Config> = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
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
        success: "#22c55e",
        warning: "#f59e0b",
        error: "#ef4444",
        info: "#3b82f6",
      },
      fontFamily: {
        sans: ['"Inter"', '"Noto Sans SC"', "system-ui", "-apple-system", "sans-serif"],
        mono: ['"JetBrains Mono"', '"Cascadia Code"', "monospace"],
      },
      borderRadius: {
        xs: "4px",
        sm: "6px",
        md: "10px",
        lg: "16px",
        xl: "24px",
        full: "9999px",
      },
      boxShadow: {
        subtle: "0 1px 3px 0 rgba(0,0,0,0.04), 0 1px 2px -1px rgba(0,0,0,0.03)",
        card: "0 2px 8px 0 rgba(0,0,0,0.06), 0 1px 3px -1px rgba(0,0,0,0.04)",
        elevated: "0 10px 30px -5px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.04)",
        modal: "0 25px 50px -12px rgba(0,0,0,0.15), 0 10px 20px -8px rgba(0,0,0,0.08)",
        glow: "0 0 20px -5px rgba(74,124,196,0.3)",
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.25s ease-out",
        "slide-left": "slideLeft 0.3s ease-out",
        "pulse-soft": "pulseSoft 2s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideLeft: {
          "0%": { opacity: "0", transform: "translateX(16px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        pulseSoft: { "0%, 100%": { opacity: "1" }, "50%": { opacity: "0.7" } },
      },
    },
  },
  plugins: [],
};
