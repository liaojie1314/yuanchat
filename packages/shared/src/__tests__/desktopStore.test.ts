/**
 * desktopStore 测试 —— 桌面端本机偏好的关窗行为。
 *
 * shared 的 vitest 环境是 node，没有 window/localStorage；zustand v5 persist
 * 取的是 window.localStorage 且在模块求值时就读一次，所以内存桩必须经
 * vi.hoisted 装在 import 之前，「持久化到 localStorage」这条断言才验得到真写入。
 */
import { it, expect, beforeEach, vi } from "vitest";

vi.hoisted(() => {
  const store = new Map<string, string>();
  const shim = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  const g = globalThis as Record<string, unknown>;
  g.localStorage = shim;
  g.window = { localStorage: shim };
});

import { useDesktopStore } from "../store/desktopStore";

beforeEach(() => {
  localStorage.clear();
  useDesktopStore.setState({ closeBehavior: "ask" });
});

it("默认是 ask —— 第一次关窗必须问，不能擅自替用户决定", () => {
  expect(useDesktopStore.getState().closeBehavior).toBe("ask");
});

it("设置后持久化到 localStorage", () => {
  useDesktopStore.getState().setCloseBehavior("tray");
  expect(useDesktopStore.getState().closeBehavior).toBe("tray");
  expect(localStorage.getItem("yuanchat-desktop")).toContain("tray");
});

it("可以改回 ask（设置页要给得出回头路，否则勾了「记住」就再也改不了）", () => {
  useDesktopStore.getState().setCloseBehavior("quit");
  useDesktopStore.getState().setCloseBehavior("ask");
  expect(useDesktopStore.getState().closeBehavior).toBe("ask");
});
