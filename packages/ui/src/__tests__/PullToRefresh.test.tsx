import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PullToRefresh } from "../primitives/PullToRefresh";

function stubPointer(coarse: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (q: string) => ({ matches: coarse && q.includes("coarse") }) as MediaQueryList,
  });
}

beforeEach(() => {
  stubPointer(true);
});

describe("PullToRefresh", () => {
  it("原样渲染子节点，调用方的 className 要合并进来", () => {
    render(
      <PullToRefresh onRefresh={vi.fn().mockResolvedValue(undefined)} className="flex-1 px-2">
        <span>列表内容</span>
      </PullToRefresh>,
    );
    expect(screen.getByText("列表内容")).toBeInTheDocument();
    const box = screen.getByTestId("pull-to-refresh");
    expect(box.className).toContain("flex-1");
    expect(box.className).toContain("px-2");
  });

  it("必须带 overscroll-y-contain，否则安卓上被浏览器自带下拉接管", () => {
    render(
      <PullToRefresh onRefresh={vi.fn().mockResolvedValue(undefined)}>
        <span>列表内容</span>
      </PullToRefresh>,
    );
    expect(screen.getByTestId("pull-to-refresh").className).toContain("overscroll-y-contain");
  });

  it("下拉过程中显示指示器，未下拉时不占位（CLS 为零）", () => {
    render(
      <PullToRefresh onRefresh={vi.fn(() => new Promise<void>(() => undefined))}>
        <span>列表内容</span>
      </PullToRefresh>,
    );
    const box = screen.getByTestId("pull-to-refresh");
    expect(screen.queryByTestId("pull-indicator")).toBeNull();

    fireEvent.touchStart(box, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(box, { touches: [{ clientY: 400 }] });

    expect(screen.getByTestId("pull-indicator")).toBeInTheDocument();
  });

  it("非触屏设备不挂手势，指示器永不出现", () => {
    stubPointer(false);
    render(
      <PullToRefresh onRefresh={vi.fn().mockResolvedValue(undefined)}>
        <span>列表内容</span>
      </PullToRefresh>,
    );
    const box = screen.getByTestId("pull-to-refresh");
    fireEvent.touchStart(box, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(box, { touches: [{ clientY: 400 }] });
    expect(screen.queryByTestId("pull-indicator")).toBeNull();
  });
});
