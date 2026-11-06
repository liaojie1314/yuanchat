/** 搜索快捷键的本机偏好，Web、桌面和外接键盘共用同一匹配规则。 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Ctrl/Cmd 为必需修饰键，额外允许 Shift/Alt 与一个字母或数字。 */
export interface SearchShortcut {
  key: string;
  shift: boolean;
  alt: boolean;
}

/** 默认搜索组合：Ctrl+K，macOS 使用 Cmd+K。 */
export const DEFAULT_SEARCH_SHORTCUT: SearchShortcut = { key: "k", shift: false, alt: false };

type KeyInput = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "isComposing" | "repeat"
>;

/** 读取组合键；输入法组合、长按、纯文本或仅修饰键均不作为快捷键。 */
export function shortcutFromEvent(event: KeyInput): SearchShortcut | null {
  if (
    event.isComposing ||
    event.repeat ||
    event.ctrlKey === event.metaKey ||
    !/^[a-z0-9]$/i.test(event.key)
  )
    return null;
  return { key: event.key.toLowerCase(), shift: event.shiftKey, alt: event.altKey };
}

/** 返回无效/冲突的本地化提示 key；不抢占浏览器窗口控制和编辑快捷键。 */
export function getShortcutError(
  shortcut: SearchShortcut,
): "shortcuts.invalid" | "shortcuts.reserved" | null {
  if (
    typeof shortcut?.key !== "string" ||
    !/^[a-z0-9]$/i.test(shortcut.key) ||
    typeof shortcut.shift !== "boolean" ||
    typeof shortcut.alt !== "boolean"
  )
    return "shortcuts.invalid";
  const key = shortcut.key.toLowerCase();
  // 关闭/刷新/导航/开发工具等组合在不同平台有差异，保守地保留所有修饰变体。
  if ("nwtrlqpohijacdfsvxyz".includes(key)) return "shortcuts.reserved";
  if (!shortcut.alt && !shortcut.shift && "0123456789".includes(key)) return "shortcuts.reserved";
  return null;
}

/** 精确匹配当前偏好，额外修饰键不会误触发原组合。 */
export function matchesSearchShortcut(event: KeyInput, shortcut: SearchShortcut): boolean {
  const captured = shortcutFromEvent(event);
  return (
    !!captured &&
    captured.key === shortcut.key &&
    captured.shift === shortcut.shift &&
    captured.alt === shortcut.alt
  );
}

interface ShortcutState {
  searchShortcut: SearchShortcut;
  setSearchShortcut: (shortcut: SearchShortcut) => boolean;
}

/** 持久化搜索组合；非法存储恢复默认，不把损坏偏好变成不可用的入口。 */
export const useShortcutStore = create<ShortcutState>()(
  persist(
    (set) => ({
      searchShortcut: DEFAULT_SEARCH_SHORTCUT,
      setSearchShortcut: (shortcut) => {
        if (getShortcutError(shortcut)) return false;
        set({ searchShortcut: { ...shortcut, key: shortcut.key.toLowerCase() } });
        return true;
      },
    }),
    {
      name: "yuanchat-shortcuts",
      partialize: (state) => ({ searchShortcut: state.searchShortcut }),
      merge: (persisted, current) => {
        const value = (persisted as Partial<ShortcutState> | undefined)?.searchShortcut;
        return {
          ...current,
          searchShortcut:
            value && !getShortcutError(value)
              ? { ...value, key: value.key.toLowerCase() }
              : DEFAULT_SEARCH_SHORTCUT,
        };
      },
    },
  ),
);
