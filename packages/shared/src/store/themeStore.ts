/**
 * 增强版主题状态管理 Store — 皮肤 + 亮暗 + 字号 + locale
 *
 * @description
 * 管理应用的完整视觉配置：皮肤 ID、亮暗模式、字号缩放、locale。
 * 通过 Zustand persist 中间件持久化到 localStorage。
 *
 * 核心方法 applyTheme() 将当前皮肤的颜色方案批量写入 CSS 自定义属性，
 * 所有组件通过 CSS 变量引用颜色，因此切换皮肤不触发组件重渲染。
 *
 * 皮肤系统基于 SkinDefinition 接口，支持动态注册新皮肤。
 *
 * @example
 * ```tsx
 * const { setSkin, toggleMode, fontScale } = useThemeStore();
 * setSkin("ocean-light");  // 切换到海洋亮色
 * toggleMode();            // 切换亮暗
 * ```
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { M3ColorScheme } from "@yuanchat/design-system/tokens";
import { lightScheme, darkScheme, type FontScale } from "@yuanchat/design-system/tokens";
import { findSkin, getDefaultSkin } from "@yuanchat/design-system/skins";
import type { SupportedLocale } from "@yuanchat/design-system/i18n";

interface ThemeState {
  skinId: string;
  mode: "light" | "dark";
  fontScale: FontScale;
  locale: SupportedLocale;

  setSkin: (skinId: string) => void;
  toggleMode: () => void;
  setFontScale: (scale: FontScale) => void;
  setLocale: (locale: SupportedLocale) => void;
  getCurrentScheme: () => M3ColorScheme;
  /** 将当前皮肤颜色写入 CSS 变量，切换暗色 class */
  applyTheme: () => void;
}

/** 检测系统亮暗偏好 */
function prefersDark(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => {
      const isDark = prefersDark();
      const defaultSkin = getDefaultSkin();

      return {
        skinId: isDark ? "yuan-dark" : defaultSkin.id,
        mode: isDark ? "dark" : "light",
        fontScale: "normal",
        locale:
          typeof navigator !== "undefined" && navigator.language?.startsWith("zh")
            ? "zh-CN"
            : "en-US",

        setSkin: (skinId: string) => {
          const skin = findSkin(skinId);
          if (skin) {
            set({ skinId, mode: skin.mode });
            get().applyTheme();
          }
        },

        toggleMode: () => {
          set((s) => ({
            mode: s.mode === "light" ? "dark" : "light",
            skinId: s.mode === "light" ? "yuan-dark" : "yuan-light",
          }));
          get().applyTheme();
        },

        setFontScale: (scale: FontScale) => {
          set({ fontScale: scale });
          document.documentElement.style.setProperty("--font-scale", String(scale));
        },

        setLocale: (locale: SupportedLocale) => {
          set({ locale });
        },

        getCurrentScheme: (): M3ColorScheme => {
          const { skinId, mode } = get();
          const skin = findSkin(skinId);
          if (skin) return skin.scheme;
          return mode === "dark" ? darkScheme : lightScheme;
        },

        applyTheme: () => {
          const scheme = get().getCurrentScheme();
          const root = document.documentElement;

          /** hex → rgb 转换，输出 "r, g, b" 格式供 CSS rgb() 使用 */
          const hexToRgb = (hex: string): string => {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `${r}, ${g}, ${b}`;
          };

          // 写入 hex 值（直接使用：background: var(--...-hex)）
          const hexKeys: Record<string, string> = {};
          // 写入 rgb 值（配合透明度：rgb(var(--...-rgb) / 0.5)）
          const rgbKeys: Record<string, string> = {};

          /** M3ColorScheme 属性名与 CSS 变量名的映射 (camelCase → kebab-case) */
          const colorProps: [string, string][] = [
            ["primary", "primary"],
            ["onPrimary", "on-primary"],
            ["primaryContainer", "primary-container"],
            ["onPrimaryContainer", "on-primary-container"],
            ["secondary", "secondary"],
            ["onSecondary", "on-secondary"],
            ["secondaryContainer", "secondary-container"],
            ["onSecondaryContainer", "on-secondary-container"],
            ["tertiary", "tertiary"],
            ["onTertiary", "on-tertiary"],
            ["error", "error"],
            ["onError", "on-error"],
            ["errorContainer", "error-container"],
            ["background", "background"],
            ["onBackground", "on-background"],
            ["surface", "surface"],
            ["onSurface", "on-surface"],
            ["surfaceVariant", "surface-variant"],
            ["onSurfaceVariant", "on-surface-variant"],
            ["surfaceBright", "surface-bright"],
            ["surfaceDim", "surface-dim"],
            ["surfaceContainer", "surface-container"],
            ["surfaceContainerLow", "surface-container-low"],
            ["surfaceContainerHigh", "surface-container-high"],
            ["outline", "outline"],
            ["outlineVariant", "outline-variant"],
          ];

          colorProps.forEach(([propName, cssName]) => {
            const cssKey = `--md-sys-color-${cssName}`;
            const hexVal = (scheme as unknown as Record<string, string>)[propName];
            if (hexVal) {
              hexKeys[cssKey] = hexVal;
              rgbKeys[`${cssKey}-rgb`] = hexToRgb(hexVal);
            }
          });

          Object.entries(hexKeys).forEach(([k, v]) => root.style.setProperty(k, v));
          Object.entries(rgbKeys).forEach(([k, v]) => root.style.setProperty(k, v));

          root.classList.toggle("dark", get().mode === "dark");
          root.style.setProperty("--font-scale", String(get().fontScale));
        },
      };
    },
    { name: "yuanchat-theme-v2" },
  ),
);
