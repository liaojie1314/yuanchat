/**
 * themeStore 测试
 *
 * @description
 * 测试主题 Store 的状态管理方法。
 * applyTheme() 需要 DOM API（document.documentElement），在 vitest node 环境下 mock。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useThemeStore } from "../store/themeStore";

/** 模拟 CSS 变量写入目标 */
let cssVars: Record<string, string> = {};
let darkClass: boolean = false;

beforeEach(() => {
  cssVars = {};
  darkClass = false;

  // 打桩 document.documentElement
  vi.stubGlobal("document", {
    documentElement: {
      style: {
        setProperty: (key: string, value: string) => {
          cssVars[key] = value;
        },
      },
      classList: {
        toggle: (_cls: string, force: boolean) => {
          darkClass = force;
        },
      },
    },
  });

  // 打桩 window.matchMedia 以驱动 prefersDark
  vi.stubGlobal("window", {
    matchMedia: () => ({ matches: false }),
  });

  // 打桩 navigator 以驱动语言探测
  vi.stubGlobal("navigator", { language: "zh-CN" });

  // 把 store 重置为默认值
  const store = useThemeStore;
  store.setState({
    skinId: "yuan-light",
    mode: "light",
    fontScale: "normal",
  });
});

describe("themeStore", () => {
  describe("initial state", () => {
    it("has default skin and light mode", () => {
      const state = useThemeStore.getState();
      expect(state.mode).toBe("light");
      expect(state.fontScale).toBe("normal");
    });
  });

  describe("setSkin", () => {
    it("changes skin and applies theme", () => {
      useThemeStore.getState().setSkin("ocean-light");
      const state = useThemeStore.getState();
      expect(state.skinId).toBe("ocean-light");
      expect(state.mode).toBe("light");
      // applyTheme 应已写入 CSS 变量
      expect(cssVars["--md-sys-color-primary"]).toBeDefined();
    });

    it("switches to ocean-dark skin", () => {
      useThemeStore.getState().setSkin("ocean-dark");
      const state = useThemeStore.getState();
      expect(state.skinId).toBe("ocean-dark");
      expect(state.mode).toBe("dark");
    });
  });

  describe("toggleMode", () => {
    it("toggles from light to dark", () => {
      useThemeStore.getState().toggleMode();
      const state = useThemeStore.getState();
      expect(state.mode).toBe("dark");
      expect(darkClass).toBe(true);
    });

    it("toggles from dark back to light", () => {
      useThemeStore.getState().toggleMode(); // light -> dark
      useThemeStore.getState().toggleMode(); // dark -> light
      const state = useThemeStore.getState();
      expect(state.mode).toBe("light");
      expect(darkClass).toBe(false);
    });
  });

  describe("setFontScale", () => {
    it("changes font scale", () => {
      useThemeStore.getState().setFontScale("large");
      expect(useThemeStore.getState().fontScale).toBe("large");
    });

    it("accepts all valid scales", () => {
      const scales = ["small", "normal", "large", "xlarge"] as const;
      for (const scale of scales) {
        useThemeStore.getState().setFontScale(scale);
        expect(useThemeStore.getState().fontScale).toBe(scale);
      }
    });
  });

  describe("setLocale", () => {
    it("changes locale to en-US", () => {
      useThemeStore.getState().setLocale("en-US");
      expect(useThemeStore.getState().locale).toBe("en-US");
    });
  });

  describe("getCurrentScheme", () => {
    it("returns the current skin's color scheme", () => {
      const scheme = useThemeStore.getState().getCurrentScheme();
      expect(scheme.primary).toBeDefined();
      expect(scheme.onPrimary).toBeDefined();
      expect(scheme.background).toBeDefined();
      expect(scheme.onBackground).toBeDefined();
    });

    it("returns different schemes for different skins", () => {
      const lightScheme = useThemeStore.getState().getCurrentScheme();
      useThemeStore.getState().setSkin("ocean-dark");
      const darkScheme = useThemeStore.getState().getCurrentScheme();
      // 不同皮肤的 primary 颜色应该不同
      expect(lightScheme.primary).not.toBe(darkScheme.primary);
    });
  });

  describe("applyTheme", () => {
    it("writes CSS custom properties to document root", () => {
      useThemeStore.getState().applyTheme();
      // 验证核心 CSS 变量已被写入
      expect(cssVars["--md-sys-color-primary"]).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(cssVars["--md-sys-color-primary-rgb"]).toMatch(/^\d+ \d+ \d+$/);
      expect(cssVars["--md-sys-color-background"]).toBeDefined();
      expect(cssVars["--md-sys-color-surface"]).toBeDefined();
    });

    it("adds dark class in dark mode", () => {
      useThemeStore.getState().toggleMode();
      expect(darkClass).toBe(true);
    });
  });
});
