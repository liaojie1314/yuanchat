import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { RefreshButton } from "../primitives/RefreshButton";

describe("RefreshButton", () => {
  it("点击触发刷新，aria-label 走 i18n", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<RefreshButton onRefresh={onRefresh} />);
    const btn = screen.getByRole("button", { name: "Refresh" });

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("刷新中禁用，连点不叠请求", () => {
    const onRefresh = vi.fn(() => new Promise<void>(() => undefined));
    render(<RefreshButton onRefresh={onRefresh} />);
    const btn = screen.getByRole("button", { name: "Refresh" });

    fireEvent.click(btn);
    fireEvent.click(btn);

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(btn).toBeDisabled();
  });

  it("失败后恢复可点，不会卡在禁用态", async () => {
    const onRefresh = vi.fn().mockRejectedValue(new Error("boom"));
    render(<RefreshButton onRefresh={onRefresh} />);
    const btn = screen.getByRole("button", { name: "Refresh" });

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(btn).not.toBeDisabled();
  });
});
