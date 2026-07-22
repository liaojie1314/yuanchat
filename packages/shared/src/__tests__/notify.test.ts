/**
 * notifyIncoming 单元测试：失焦通知、聚焦不打扰、免打扰跳过、未注册不抛错。
 * node 环境无 document：stubGlobal 注入最小实现，hasFocus 按用例切换。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setNotifier, notifyIncoming, __resetNotifier } from "../notify";

function stubFocus(focused: boolean) {
  vi.stubGlobal("document", { hasFocus: () => focused });
}

describe("notifyIncoming", () => {
  beforeEach(() => __resetNotifier());
  afterEach(() => vi.unstubAllGlobals());

  it("页面失焦且非免打扰时通知", () => {
    const fn = vi.fn();
    setNotifier(fn);
    stubFocus(false);
    notifyIncoming({ name: "Alice", isMuted: false }, "你好");
    expect(fn).toHaveBeenCalledWith("Alice", "你好");
  });

  it("聚焦时不通知", () => {
    const fn = vi.fn();
    setNotifier(fn);
    stubFocus(true);
    notifyIncoming({ name: "Alice", isMuted: false }, "你好");
    expect(fn).not.toHaveBeenCalled();
  });

  it("免打扰会话不通知；未注册 notifier 不抛错", () => {
    const fn = vi.fn();
    setNotifier(fn);
    stubFocus(false);
    notifyIncoming({ name: "群", isMuted: true }, "x");
    expect(fn).not.toHaveBeenCalled();
    __resetNotifier();
    expect(() => notifyIncoming({ name: "a", isMuted: false }, "x")).not.toThrow();
  });

  it("正文超 60 字截断", () => {
    const fn = vi.fn();
    setNotifier(fn);
    stubFocus(false);
    const long = "a".repeat(80);
    notifyIncoming({ name: "Alice", isMuted: false }, long);
    expect(fn).toHaveBeenCalledWith("Alice", "a".repeat(60) + "…");
  });
});
