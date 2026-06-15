/**
 * 主题状态管理 Store
 *
 * @description
 * 使用 Zustand 管理应用的主题模式（亮色/暗色）。
 * 通过 `persist` 中间件将用户的主题选择持久化到 localStorage，
 * 页面刷新后自动恢复上次选择的主题。
 *
 * 工作原理：
 * 1. 初始化时读取系统偏好（prefers-color-scheme），若无则默认亮色
 * 2. 切换时操作 `<html>` 元素的 `dark` class，触发 Tailwind 的暗色模式
 * 3. Zustand 的 persist 中间件自动将状态序列化存入 localStorage
 *
 * 使用方式：
 * ```tsx
 * const { isDark, toggle } = useThemeStore();
 * // isDark: 当前是否为暗色模式（boolean）
 * // toggle(): 切换亮色/暗色
 * ```
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ThemeState {
  /** 当前是否为暗色模式 */
  isDark: boolean;
  /** 切换亮色/暗色模式 */
  toggle: () => void;
  /** 直接设置暗色模式状态 */
  setDark: (dark: boolean) => void;
}

/**
 * 主题 Store Hook
 *
 * @example
 * // 基础用法
 * const { isDark, toggle } = useThemeStore();
 * console.log(isDark); // false
 * toggle(); // 切换到暗色模式
 *
 * @example
 * // 在组件中使用
 * function ThemeButton() {
 *   const isDark = useThemeStore((s) => s.isDark); // 选择器写法，避免不必要的重渲染
 *   const toggle = useThemeStore((s) => s.toggle);
 *   return <button onClick={toggle}>{isDark ? '☀️' : '🌙'}</button>;
 * }
 */
export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      // 初始化：读取系统偏好，若不可用则默认亮色
      isDark:
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-color-scheme: dark)").matches,
      toggle: () =>
        set((s) => {
          const next = !s.isDark;
          // 操作 DOM class 来触发 Tailwind 暗色模式切换
          // Tailwind 的 darkMode: "class" 策略依赖此 class
          if (typeof document !== "undefined") {
            document.documentElement.classList.toggle("dark", next);
          }
          return { isDark: next };
        }),
      setDark: (dark: boolean) =>
        set(() => {
          if (typeof document !== "undefined") {
            document.documentElement.classList.toggle("dark", dark);
          }
          return { isDark: dark };
        }),
    }),
    // persist 中间件配置：自动存到 localStorage，key 为 'yuanchat-theme'
    { name: "yuanchat-theme" },
  ),
);
