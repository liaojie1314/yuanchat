/**
 * tray 模块契约测试。
 *
 * 全程 mock `@tauri-apps/api/window` 与 `@tauri-apps/plugin-os`：
 * 这里钉的是「角标 API 的调用形状」与「平台分支选对没」，不是真实托盘 ——
 * 托盘行为属于两端实测范畴（计划 Task 21）。
 *
 * 最要紧的一条（Review Focus #4）：setBadgeCount 在不支持的平台会抛
 * （Linux 未装 .desktop 时走 Unity LauncherEntry DBus 失败），角标是增强，
 * 失败了应用必须照常用 —— applyBadge 不许向外传播异常。
 */
import { it, expect, vi, beforeEach } from "vitest";

const setBadgeCount = vi.fn();
const setOverlayIcon = vi.fn();
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setBadgeCount,
    setOverlayIcon,
    show: vi.fn(),
    setFocus: vi.fn(),
    unminimize: vi.fn(),
  }),
}));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => "linux" }));

beforeEach(() => vi.clearAllMocks());

// Review Focus #4：不支持的平台会抛，角标是增强，失败了应用必须照常用
it("setBadgeCount 抛错时不向外传播", async () => {
  setBadgeCount.mockRejectedValueOnce(new Error("Unity LauncherEntry unavailable"));
  const { applyBadge } = await import("../tray");
  await expect(applyBadge(3)).resolves.toBeUndefined();
});

it("未读为 0 时清角标（传 undefined 而非 0）", async () => {
  const { applyBadge } = await import("../tray");
  await applyBadge(0);
  expect(setBadgeCount).toHaveBeenCalledWith(undefined);
});

it("未读大于 0 时传计数", async () => {
  const { applyBadge } = await import("../tray");
  await applyBadge(7);
  expect(setBadgeCount).toHaveBeenCalledWith(7);
});

it("Windows 上走 setOverlayIcon 而不是 setBadgeCount（平台不支持后者）", async () => {
  vi.doMock("@tauri-apps/plugin-os", () => ({ platform: () => "windows" }));
  vi.resetModules();
  const { applyBadge } = await import("../tray");
  await applyBadge(4);
  expect(setOverlayIcon).toHaveBeenCalled();
  expect(setBadgeCount).not.toHaveBeenCalled();
});

it("Windows 上未读为 0 时清 overlay（传 undefined）", async () => {
  vi.doMock("@tauri-apps/plugin-os", () => ({ platform: () => "windows" }));
  vi.resetModules();
  const { applyBadge } = await import("../tray");
  await applyBadge(0);
  expect(setOverlayIcon).toHaveBeenCalledWith(undefined);
});

// StrictMode 双跑 effect 时创建/卸载挤在一起：若各实例共用一个托盘 id，
// 前一轮卸载（按 id 移除）与后一轮创建在 DBus 上乱序，会把新托盘一并删掉。
// 钉两件事：并发安装拿到的是互不相同的 id；卸载只关自己那个 id。
it("并发 installTray 各得唯一 id，卸载只关自己的", async () => {
  const created: string[] = [];
  const closed: string[] = [];
  vi.doMock("@tauri-apps/api/tray", () => ({
    TrayIcon: {
      new: async ({ id }: { id: string }) => {
        created.push(id);
        return {
          setTooltip: vi.fn().mockResolvedValue(undefined),
          close: async () => {
            closed.push(id);
          },
        };
      },
    },
  }));
  vi.doMock("@tauri-apps/api/menu", () => ({
    Menu: {
      new: async () => ({
        get: async () => undefined,
      }),
    },
  }));
  vi.doMock("@tauri-apps/api/app", () => ({
    defaultWindowIcon: async () => null,
  }));
  vi.doMock("@tauri-apps/plugin-process", () => ({
    exit: vi.fn(),
  }));
  vi.resetModules();
  const { installTray } = await import("../tray");
  const noop = () => {};

  // 两个安装背靠背并发发起（StrictMode 的挂载节奏）
  const [d1, d2] = await Promise.all([
    installTray({ onOpenConversation: noop }),
    installTray({ onOpenConversation: noop }),
  ]);
  expect(created).toHaveLength(2);
  expect(new Set(created).size).toBe(2);

  // 各自的卸载只关各自的 id，互不波及
  d1();
  d2();
  await new Promise((r) => setTimeout(r, 0));
  expect(closed.sort()).toEqual([...created].sort());
});
