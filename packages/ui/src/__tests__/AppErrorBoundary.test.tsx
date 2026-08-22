import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppErrorBoundary } from "../AppErrorBoundary";

const mockCaptureException = vi.fn();
vi.mock("@yuanchat/shared", () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

const ThrowingChild = () => {
  throw new Error("render error");
};

describe("AppErrorBoundary", () => {
  beforeEach(() => {
    mockCaptureException.mockClear();
    // 屏蔽 React 对预期内边界错误打出的 console.error
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("captures exception when child throws", () => {
    render(
      <AppErrorBoundary>
        <ThrowingChild />
      </AppErrorBoundary>,
    );
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ componentStack: expect.anything() }),
    );
  });

  it("renders fallback UI on error", () => {
    render(
      <AppErrorBoundary>
        <ThrowingChild />
      </AppErrorBoundary>,
    );
    expect(screen.getByText(/出错了，点击刷新/)).toBeTruthy();
  });

  it("renders custom fallback when provided", () => {
    render(
      <AppErrorBoundary fallback={<div>custom fallback</div>}>
        <ThrowingChild />
      </AppErrorBoundary>,
    );
    expect(screen.getByText("custom fallback")).toBeTruthy();
  });
});
