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
import {
  lightScheme,
  darkScheme,
  type FontScale,
} from "@yuanchat/design-system/tokens";
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
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
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

          // 批量写入 M3 颜色 CSS 变量
          const vars: Record<string, string> = {
            "--md-sys-color-primary": scheme.primary,
            "--md-sys-color-on-primary": scheme.onPrimary,
            "--md-sys-color-primary-container": scheme.primaryContainer,
            "--md-sys-color-on-primary-container": scheme.onPrimaryContainer,
            "--md-sys-color-secondary": scheme.secondary,
            "--md-sys-color-on-secondary": scheme.onSecondary,
            "--md-sys-color-secondary-container": scheme.secondaryContainer,
            "--md-sys-color-on-secondary-container": scheme.onSecondaryContainer,
            "--md-sys-color-tertiary": scheme.tertiary,
            "--md-sys-color-on-tertiary": scheme.onTertiary,
            "--md-sys-color-error": scheme.error,
            "--md-sys-color-on-error": scheme.onError,
            "--md-sys-color-error-container": scheme.errorContainer,
            "--md-sys-color-background": scheme.background,
            "--md-sys-color-on-background": scheme.onBackground,
            "--md-sys-color-surface": scheme.surface,
            "--md-sys-color-on-surface": scheme.onSurface,
            "--md-sys-color-surface-variant": scheme.surfaceVariant,
            "--md-sys-color-on-surface-variant": scheme.onSurfaceVariant,
            "--md-sys-color-outline": scheme.outline,
            "--md-sys-color-outline-variant": scheme.outlineVariant,
            "--md-sys-color-surface-container": scheme.surfaceContainer,
            "--md-sys-color-surface-container-low": scheme.surfaceContainerLow,
            "--md-sys-color-surface-container-high": scheme.surfaceContainerHigh,
          };

          Object.entries(vars).forEach(([key, val]) => root.style.setProperty(key, val));

          root.classList.toggle("dark", get().mode === "dark");
          root.style.setProperty("--font-scale", String(get().fontScale));
        },
      };
    },
    { name: "yuanchat-theme-v2" },
  ),
);
