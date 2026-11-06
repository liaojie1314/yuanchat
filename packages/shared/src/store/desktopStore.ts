/**
 * 桌面端本机偏好（不上云，换台机器重新问一次）。
 *
 * @description
 * 目前只有「点关闭按钮怎么办」一项。用 persist 与 themeStore / authStore
 * 同一套范式。默认 `ask`：第一次关窗必须问，不能擅自替用户决定 ——
 * 直接最小化到托盘会让人以为应用没关掉，直接退出会让人丢消息。
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** 关闭按钮的行为。`ask` 表示弹窗询问（默认） */
export type CloseBehavior = "ask" | "tray" | "quit";

interface DesktopState {
  /** 关闭按钮当前生效的行为 */
  closeBehavior: CloseBehavior;
  /** 设置关闭按钮的行为（设置页的三选开关也走这里，给得出回头路） */
  setCloseBehavior: (b: CloseBehavior) => void;
}

export const useDesktopStore = create<DesktopState>()(
  persist(
    (set) => ({
      closeBehavior: "ask",
      setCloseBehavior: (b) => set({ closeBehavior: b }),
    }),
    // 桌面偏好只存本机，key 独立于主题/认证等其它 persist 存储
    { name: "yuanchat-desktop" },
  ),
);
