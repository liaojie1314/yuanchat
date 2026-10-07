/**
 * useKeyboardAwareViewport 行为测试 —— 键盘弹起时的居中策略
 *
 * 为什么要有这组用例：真机上「弹起键盘页面明显闪动」的根因有两条，
 * 两条都只在「连续 resize」或「输入框本就可见」这种时序下才暴露，
 * 肉眼之外唯一能钉住的办法就是这里：
 * 1. 键盘弹起动画期间 visualViewport 会连续触发十几次 resize。每次都
 *    scrollIntoView 的话内容被反复重新居中 —— 必须防抖成只滚一次。
 * 2. 输入框本来就完整落在可见区时（居中表单靠 --app-height 收缩后就是这样），
 *    scrollIntoView 仍会拽一下布局，那一下纯属多余的跳动。
 *
 * 该 Hook 住在 @yuanchat/shared，但测试放在 ui 包：jsdom / react-dom /
 * @testing-library/react 只在 ui 包的 devDependencies 里。
 *
 * jsdom 不实现 visualViewport 与 scrollIntoView，两者都在这里装成可控替身。
 */
import { render, cleanup, act } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { useKeyboardAwareViewport } from "@yuanchat/shared";

/** 可见视口替身：只实现 Hook 真正用到的 height / offsetTop 与事件派发 */
class FakeVisualViewport {
  height = 800;
  offsetTop = 0;
  private listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, fn: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: () => void) {
    this.listeners.get(type)?.delete(fn);
  }

  /** 模拟一次视口变化：改高度并派发 resize */
  resizeTo(height: number) {
    this.height = height;
    for (const fn of this.listeners.get("resize") ?? []) fn();
  }

  /** 当前还挂着的监听器总数，用于验证卸载时解绑干净 */
  listenerCount() {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
}

let vv: FakeVisualViewport;
let scrollIntoView: ReturnType<typeof vi.fn>;
/** 受控的输入框矩形：测试按需摆成「可见」或「被键盘挡住」 */
let rect: { top: number; bottom: number };

function Harness() {
  useKeyboardAwareViewport();
  return <input data-testid="field" />;
}

/** 渲染并聚焦输入框，返回该元素 */
function renderFocused() {
  const { getByTestId } = render(<Harness />);
  const input = getByTestId("field") as HTMLInputElement;
  input.getBoundingClientRect = () => ({ top: rect.top, bottom: rect.bottom }) as DOMRect;
  input.scrollIntoView = scrollIntoView as unknown as HTMLElement["scrollIntoView"];
  act(() => {
    input.focus();
  });
  return input;
}

beforeEach(() => {
  vi.useFakeTimers();
  vv = new FakeVisualViewport();
  scrollIntoView = vi.fn();
  // 默认摆成「被键盘挡住」：底部 780 超出键盘弹起后的可见区
  rect = { top: 700, bottom: 780 };
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  // rAF 在假定时器下不会自动跑，这里同步执行即可（Hook 只用它合并同帧的 resize）
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useKeyboardAwareViewport", () => {
  it("把可见视口高度与键盘高度写进 CSS 变量", () => {
    renderFocused();
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("800px");

    act(() => vv.resizeTo(500));
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("500px");
    // 键盘高度 = 800 − 500 − 0
    expect(document.documentElement.style.getPropertyValue("--keyboard-inset")).toBe("300px");
  });

  it("键盘弹起动画期间连续 resize 只居中一次", () => {
    renderFocused();

    // 模拟键盘上滑：高度连续变化十几次
    act(() => {
      for (let h = 790; h >= 500; h -= 20) vv.resizeTo(h);
    });
    // 防抖窗口内不应该滚过
    expect(scrollIntoView).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(200));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    // 视口稳定后不再有额外滚动
    act(() => vi.advanceTimersByTime(1000));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("每次 resize 都刷新 CSS 变量，不被居中的防抖拖慢", () => {
    renderFocused();
    act(() => {
      vv.resizeTo(600);
      vv.resizeTo(500);
    });
    // 变量是即时的；此刻滚动还在防抖队列里没执行
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("500px");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("输入框本来就完整可见时不滚动", () => {
    rect = { top: 100, bottom: 160 }; // 远在可见区内
    renderFocused();

    act(() => vv.resizeTo(500));
    act(() => vi.advanceTimersByTime(200));

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("防抖期间失焦则不再滚动", () => {
    const input = renderFocused();
    act(() => vv.resizeTo(500));
    act(() => input.blur());
    act(() => vi.advanceTimersByTime(200));

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("卸载时解绑监听并清掉 CSS 变量", () => {
    const { unmount } = render(<Harness />);
    expect(vv.listenerCount()).toBeGreaterThan(0);

    unmount();
    expect(vv.listenerCount()).toBe(0);
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("");
  });
});
