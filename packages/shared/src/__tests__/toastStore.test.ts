/**
 * toastStore 单元测试：show 追加 + 3s 自动消失、dismiss 立即移除。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { showToast, useToastStore } from "../store/toastStore";

describe("toastStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("show 追加并在 3s 后自动移除", () => {
    showToast("error", "boom");
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].kind).toBe("error");
    vi.advanceTimersByTime(3100);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("dismiss 立即移除", () => {
    showToast("info", "hi");
    const id = useToastStore.getState().toasts[0].id;
    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
