import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { usePullToRefresh } from "../util/usePullToRefresh";

/** 把 matchMedia 打成「触屏 / 非触屏」，hook 内部据此门控 */
function stubPointer(coarse: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (q: string) => ({ matches: coarse && q.includes("coarse") }) as MediaQueryList,
  });
}

/** 测试宿主：把 handlers 铺到可滚动容器上，顺带把内部状态渲染成可断言文本 */
function Harness({ onRefresh }: { onRefresh: () => Promise<unknown> }) {
  const { handlers, distance, refreshing } = usePullToRefresh(onRefresh);
  return (
    <div data-testid="scroller" {...handlers}>
      <span data-testid="distance">{distance}</span>
      <span data-testid="refreshing">{refreshing ? "yes" : "no"}</span>
      <span data-testid="bound">{Object.keys(handlers).length > 0 ? "yes" : "no"}</span>
    </div>
  );
}

/** 伪造容器滚动位置：jsdom 下 scrollTop 恒为 0，需要显式改写 */
function setScrollTop(el: HTMLElement, top: number) {
  Object.defineProperty(el, "scrollTop", { configurable: true, value: top });
}

/** 走完一次「按下 → 下拉 dy 像素 → 抬手」 */
function drag(el: HTMLElement, dy: number) {
  fireEvent.touchStart(el, { touches: [{ clientY: 100 }] });
  fireEvent.touchMove(el, { touches: [{ clientY: 100 + dy }] });
  fireEvent.touchEnd(el);
}

beforeEach(() => {
  stubPointer(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("usePullToRefresh", () => {
  it("非触屏设备返回空 handlers，桌面端鼠标滚轮不该被手势劫持", () => {
    stubPointer(false);
    render(<Harness onRefresh={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.getByTestId("bound")).toHaveTextContent("no");
  });

  it("容器已滚走（scrollTop > 0）时下拉不进手势", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<Harness onRefresh={onRefresh} />);
    const el = screen.getByTestId("scroller");
    setScrollTop(el, 120);

    drag(el, 200);

    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.getByTestId("distance")).toHaveTextContent("0");
  });

  it("未达阈值松手只回弹，不触发刷新", () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<Harness onRefresh={onRefresh} />);
    const el = screen.getByTestId("scroller");

    drag(el, 40);

    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.getByTestId("distance")).toHaveTextContent("0");
  });

  it("越过阈值松手触发刷新，完成后指示器收起", async () => {
    let resolve!: () => void;
    const onRefresh = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    render(<Harness onRefresh={onRefresh} />);
    const el = screen.getByTestId("scroller");

    drag(el, 300);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("refreshing")).toHaveTextContent("yes");

    await act(async () => {
      resolve();
    });
    expect(screen.getByTestId("refreshing")).toHaveTextContent("no");
    expect(screen.getByTestId("distance")).toHaveTextContent("0");
  });

  it("刷新中二次下拉被忽略，不叠请求", () => {
    const onRefresh = vi.fn(() => new Promise<void>(() => undefined));
    render(<Harness onRefresh={onRefresh} />);
    const el = screen.getByTestId("scroller");

    drag(el, 300);
    drag(el, 300);

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("onRefresh reject 时指示器也要收起，否则转圈永远停不下来", async () => {
    const onRefresh = vi.fn().mockRejectedValue(new Error("boom"));
    render(<Harness onRefresh={onRefresh} />);
    const el = screen.getByTestId("scroller");

    await act(async () => {
      drag(el, 300);
    });

    expect(screen.getByTestId("refreshing")).toHaveTextContent("no");
    expect(screen.getByTestId("distance")).toHaveTextContent("0");
  });

  it("下拉距离带阻尼，不是 1:1 跟手", () => {
    render(<Harness onRefresh={vi.fn().mockResolvedValue(undefined)} />);
    const el = screen.getByTestId("scroller");

    fireEvent.touchStart(el, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(el, { touches: [{ clientY: 160 }] });

    const shown = Number(screen.getByTestId("distance").textContent);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(60);
  });
});
