/** 搜索快捷键的匹配、冲突校验与本机持久化。 */
import { beforeEach, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const disk = new Map<string, string>();
  const storage = {
    getItem: (key: string) => disk.get(key) ?? null,
    setItem: (key: string, value: string) => {
      disk.set(key, value);
    },
    removeItem: (key: string) => {
      disk.delete(key);
    },
  };
  Object.assign(globalThis, { localStorage: storage, window: { localStorage: storage } });
});

import {
  DEFAULT_SEARCH_SHORTCUT,
  getShortcutError,
  matchesSearchShortcut,
  shortcutFromEvent,
  useShortcutStore,
} from "../store/shortcutStore";

const keyEvent = {
  key: "K",
  ctrlKey: true,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  isComposing: false,
  repeat: false,
};
beforeEach(() => {
  useShortcutStore.setState({ searchShortcut: DEFAULT_SEARCH_SHORTCUT });
});

it("默认快捷键同时支持 Ctrl 与 Cmd，按键大小写不影响匹配", () => {
  expect(matchesSearchShortcut(keyEvent, DEFAULT_SEARCH_SHORTCUT)).toBe(true);
  expect(
    matchesSearchShortcut({ ...keyEvent, ctrlKey: false, metaKey: true }, DEFAULT_SEARCH_SHORTCUT),
  ).toBe(true);
  expect(matchesSearchShortcut({ ...keyEvent, ctrlKey: false }, DEFAULT_SEARCH_SHORTCUT)).toBe(
    false,
  );
});
it("可设置带 Shift/Alt 的组合，输入法组合和长按不触发搜索", () => {
  const custom = { key: "k", shift: true, alt: false };
  expect(matchesSearchShortcut(keyEvent, custom)).toBe(false);
  expect(matchesSearchShortcut({ ...keyEvent, shiftKey: true }, custom)).toBe(true);
  expect(matchesSearchShortcut({ ...keyEvent, shiftKey: true, isComposing: true }, custom)).toBe(
    false,
  );
  expect(matchesSearchShortcut({ ...keyEvent, shiftKey: true, repeat: true }, custom)).toBe(false);
  expect(shortcutFromEvent({ ...keyEvent, altKey: true })).toEqual({
    key: "k",
    shift: false,
    alt: true,
  });
  expect(shortcutFromEvent({ ...keyEvent, ctrlKey: false })).toBeNull();
});
it("保留浏览器/编辑组合，拒绝冲突且不覆盖已有偏好", () => {
  expect(getShortcutError({ key: "w", shift: false, alt: false })).toBe("shortcuts.reserved");
  expect(
    useShortcutStore.getState().setSearchShortcut({ key: "v", shift: false, alt: false }),
  ).toBe(false);
  expect(useShortcutStore.getState().searchShortcut).toEqual(DEFAULT_SEARCH_SHORTCUT);
});
it("设置后重载持久化状态仍匹配自定义组合", async () => {
  const custom = { key: "k", shift: true, alt: true };
  expect(useShortcutStore.getState().setSearchShortcut(custom)).toBe(true);
  const saved = localStorage.getItem("yuanchat-shortcuts")!;
  useShortcutStore.setState({ searchShortcut: DEFAULT_SEARCH_SHORTCUT });
  localStorage.setItem("yuanchat-shortcuts", saved);
  await useShortcutStore.persist.rehydrate();
  expect(useShortcutStore.getState().searchShortcut).toEqual(custom);
});
it("无效或冲突的持久化值恢复为默认，不让搜索入口失效", async () => {
  localStorage.setItem(
    "yuanchat-shortcuts",
    JSON.stringify({ state: { searchShortcut: { key: "w" } }, version: 0 }),
  );
  await useShortcutStore.persist.rehydrate();
  expect(useShortcutStore.getState().searchShortcut).toEqual(DEFAULT_SEARCH_SHORTCUT);
});

it.each(["v", "z", "c", "x"])("不抢占带修饰键的编辑组合 %s", (key) => {
  expect(getShortcutError({ key, shift: true, alt: false })).toBe("shortcuts.reserved");
  expect(getShortcutError({ key, shift: true, alt: true })).toBe("shortcuts.reserved");
});
