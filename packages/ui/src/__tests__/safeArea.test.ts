/**
 * restoreSafeAreaTop 测试 —— 整页跳转后把原生安全区变量补回来
 *
 * 为什么要有这组用例：`--safe-area-top` 由安卓原生在 WindowInsets 回调里写进
 * document，而注册入口（移动端退化成整页跳转）、切服务器地址、错误边界重载
 * 都会换掉 document，变量随之丢失且不会再有 inset 回调来补发 —— 真机上的表现
 * 是网络横幅、Toast 压到系统状态栏上。这里钉住三条：空了要补、有值不许覆盖
 * （原生实测值优先）、localStorage 不可用时不许抛。
 *
 * 该函数住在 @yuanchat/shared，但测试放在 ui 包：shared 的 vitest 环境是 node，
 * 没有 document / localStorage。
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { restoreSafeAreaTop } from "@yuanchat/shared";

const KEY = "yuanchat.safeAreaTop";

beforeEach(() => {
  document.documentElement.style.removeProperty("--safe-area-top");
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty("--safe-area-top");
  localStorage.clear();
});

describe("restoreSafeAreaTop", () => {
  it("变量为空时从 localStorage 取回并补上 px 单位", () => {
    localStorage.setItem(KEY, "27.43");
    restoreSafeAreaTop();
    expect(document.documentElement.style.getPropertyValue("--safe-area-top")).toBe("27.43px");
  });

  it("变量已有值时不覆盖 —— 原生刚下发的实测值优先", () => {
    document.documentElement.style.setProperty("--safe-area-top", "30px");
    localStorage.setItem(KEY, "99");
    restoreSafeAreaTop();
    expect(document.documentElement.style.getPropertyValue("--safe-area-top")).toBe("30px");
  });

  it("没有缓存时什么都不做，交回 CSS 的 env() 兜底", () => {
    restoreSafeAreaTop();
    expect(document.documentElement.style.getPropertyValue("--safe-area-top")).toBe("");
  });

  it("localStorage 抛异常时不冒泡（隐私模式下会抛）", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("access denied");
    });
    expect(() => restoreSafeAreaTop()).not.toThrow();
    expect(document.documentElement.style.getPropertyValue("--safe-area-top")).toBe("");
  });
});
