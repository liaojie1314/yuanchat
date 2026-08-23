/**
 * 冷启动语言恢复测试
 *
 * @description
 * 复现并守住这个 bug：设置页切了语言，杀掉应用重开又变回系统语言，
 * 只有进设置页才恢复成选过的语言。
 * 根因是 i18n 初始化时读的是 navigator.language，持久化的选择要等 rehydrate
 * 才知道，而当时没人把它推给 i18n。
 *
 * 必须独立成文件：localStorage 的桩要在 themeStore 模块求值前就位（vi.hoisted），
 * 否则 zustand persist 拿不到可用 storage，整个持久化在测试里是空转的。
 */
import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  // 键名与 themeStore 的 persist name 一致；hoisted 块跑在所有 import 之前，
  // 因此不能引用文件里的常量，只能写字面量
  const cell: Record<string, string> = {
    "yuanchat-theme-v2": JSON.stringify({
      state: { skinId: "yuan-light", mode: "light", fontScale: "normal", locale: "ko-KR" },
      version: 0,
    }),
  };
  const fakeStorage = {
    getItem: (k: string) => cell[k] ?? null,
    setItem: (k: string, v: string) => {
      cell[k] = v;
    },
    removeItem: (k: string) => {
      delete cell[k];
    },
    clear: () => {
      for (const k of Object.keys(cell)) delete cell[k];
    },
    key: (i: number) => Object.keys(cell)[i] ?? null,
    get length() {
      return Object.keys(cell).length;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: fakeStorage,
  });
  // zustand persist 默认 storage 取的是 window.localStorage（不是裸 localStorage），
  // node 环境下没有 window 就会静默降级成「不持久化」，测试也就测不到东西
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: fakeStorage, matchMedia: () => ({ matches: false }) },
  });
});

// 两个 import 的先后就是真实启动顺序：i18n 先初始化（只看得到系统语言），
// 随后 store 建立并 rehydrate
import i18n from "@yuanchat/design-system/i18n";
import { useThemeStore } from "../store/themeStore";

describe("冷启动语言恢复", () => {
  it("持久化的 locale 会在 store 建立时推给 i18n", async () => {
    expect(useThemeStore.getState().locale).toBe("ko-KR");
    // changeLanguage 内部异步落地，让出一轮事件循环
    await new Promise((r) => setTimeout(r, 0));
    expect(i18n.language).toBe("ko-KR");
  });

  it("i18n 初始语言来自系统探测，与持久化值无关（证明恢复确实发生过）", () => {
    // 测试环境 navigator 缺省 → detectLocale() 落到 zh-CN，
    // 若没有恢复逻辑，上一条断言看到的就会是 zh-CN
    expect(i18n.options.lng).toBe("zh-CN");
  });
});
