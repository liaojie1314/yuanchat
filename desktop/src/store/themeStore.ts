import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ThemeState {
  isDark: boolean;
  toggle: () => void;
  setDark: (dark: boolean) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      isDark: window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
      toggle: () =>
        set((s) => {
          const next = !s.isDark;
          document.documentElement.classList.toggle("dark", next);
          return { isDark: next };
        }),
      setDark: (dark: boolean) =>
        set(() => {
          document.documentElement.classList.toggle("dark", dark);
          return { isDark: dark };
        }),
    }),
    { name: "yuanchat-theme" },
  ),
);
