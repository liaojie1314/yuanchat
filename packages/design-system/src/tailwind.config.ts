import type { Config } from "tailwindcss";

export const yuanchatPreset: Partial<Config> = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#EEF2FF",
          100: "#E0E7FF",
          200: "#C7D2FE",
          300: "#A5B4FC",
          400: "#818CF8",
          500: "#6366F1",
          600: "#4F46E5",
          700: "#4338CA",
          800: "#3730A3",
          900: "#312E81",
        },
        surface: {
          50: "#F8FAFC",
          100: "#F1F5F9",
          200: "#E2E8F0",
          300: "#CBD5E1",
          400: "#94A3B8",
          500: "#64748B",
          600: "#475569",
          700: "#334155",
          800: "#1E293B",
          900: "#0F172A",
        },
        accent: {
          green: "#10B981",
          red: "#EF4444",
          amber: "#F59E0B",
          sky: "#0EA5E9",
        },
      },
      fontSize: {
        "display-lg": "calc(3.562rem * var(--font-scale, 1))",
        "display-md": "calc(2.812rem * var(--font-scale, 1))",
        "headline-lg": "calc(2rem * var(--font-scale, 1))",
        "headline-sm": "calc(1.5rem * var(--font-scale, 1))",
        "title-lg": "calc(1.375rem * var(--font-scale, 1))",
        "title-md": "calc(1rem * var(--font-scale, 1))",
        "body-lg": "calc(1rem * var(--font-scale, 1))",
        "body-md": "calc(0.875rem * var(--font-scale, 1))",
        "body-sm": "calc(0.75rem * var(--font-scale, 1))",
        "label-md": "calc(0.75rem * var(--font-scale, 1))",
        "label-sm": "calc(0.688rem * var(--font-scale, 1))",
      },
      fontFamily: {
        sans: ['"Inter"', '"Noto Sans SC"', "system-ui", "sans-serif"],
      },
      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "16px",
        xl: "24px",
        full: "9999px",
      },
      boxShadow: {
        "elevation-1": "0 1px 3px rgba(0,0,0,0.08)",
        "elevation-2": "0 4px 12px rgba(0,0,0,0.1)",
        "elevation-3": "0 8px 24px rgba(0,0,0,0.12)",
        "glow-brand": "0 0 20px rgba(99,102,241,0.3)",
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.25s ease-out",
      },
      keyframes: {
        fadeIn: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        slideUp: { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
      },
    },
  },
  plugins: [],
};
