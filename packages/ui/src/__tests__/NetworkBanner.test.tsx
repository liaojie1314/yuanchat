import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { NetworkBanner } from "../layout/NetworkBanner";

const phase = vi.hoisted(() => vi.fn());
vi.mock("@yuanchat/shared", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, useNetworkStatus: () => phase() };
});

beforeEach(() => {
  phase.mockReset();
  phase.mockReturnValue("online");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("NetworkBanner", () => {
  it("offline 态常驻显示「当前无网络」", () => {
    phase.mockReturnValue("offline");
    render(<NetworkBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("No network connection");
  });

  it("connecting 态显示「连接中」", () => {
    phase.mockReturnValue("connecting");
    render(<NetworkBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("Connecting");
  });

  it("从未断过网时 online 态不渲染任何东西（不给一条无端的绿条）", () => {
    phase.mockReturnValue("online");
    render(<NetworkBanner />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("断网恢复后显示「已连接」，2 秒后自动消失", () => {
    vi.useFakeTimers();
    phase.mockReturnValue("offline");
    const { rerender } = render(<NetworkBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("No network connection");

    phase.mockReturnValue("online");
    rerender(<NetworkBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("Connected");

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("aria-live 是 polite（状态变更要播报，但不打断当前朗读）", () => {
    phase.mockReturnValue("offline");
    render(<NetworkBanner />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("贴顶时叠上安全区，不压住系统状态栏", () => {
    phase.mockReturnValue("offline");
    render(<NetworkBanner />);
    const el = screen.getByRole("status");
    expect(el.getAttribute("style") ?? "").toContain("--safe-area-top");
  });
});
