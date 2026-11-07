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
// 默认平台在装配阶段加载；更换平台与原生替身的用例仍在 resetModules 后导入。
import { applyBadge } from "../tray";

const setBadgeCount = vi.fn();
const setOverlayIcon = vi.fn();
const overlayImage = { rid: 42, close: vi.fn().mockResolvedValue(undefined) };
vi.mock("@tauri-apps/api/path", () => ({
  resolveResource: async () => "/bundled/icons/badge-dot-32.png",
}));
vi.mock("@tauri-apps/api/image", () => ({
  Image: {
    fromPath: async (path: string) => {
      if (path !== "/bundled/icons/badge-dot-32.png") throw new Error("wrong resource path");
      return overlayImage;
    },
  },
}));
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
  await expect(applyBadge(3)).resolves.toBeUndefined();
});

it("未读为 0 时清角标（传 undefined 而非 0）", async () => {
  await applyBadge(0);
  expect(setBadgeCount).toHaveBeenCalledWith(undefined);
});

it("未读大于 0 时传计数", async () => {
  await applyBadge(7);
  expect(setBadgeCount).toHaveBeenCalledWith(7);
});

it("Windows 上走 setOverlayIcon 而不是 setBadgeCount（平台不支持后者）", async () => {
  vi.doMock("@tauri-apps/plugin-os", () => ({ platform: () => "windows" }));
  vi.resetModules();
  const { applyBadge } = await import("../tray");
  await applyBadge(4);
  expect(setOverlayIcon).toHaveBeenCalledWith(overlayImage);
  expect(setBadgeCount).not.toHaveBeenCalled();
});

it("Windows 上未读为 0 时清 overlay（传 undefined）", async () => {
  vi.doMock("@tauri-apps/plugin-os", () => ({ platform: () => "windows" }));
  vi.resetModules();
  const { applyBadge } = await import("../tray");
  await applyBadge(0);
  expect(setOverlayIcon).toHaveBeenCalledWith(undefined);
});

it("未读清零后，迟到的红点资源不能重新覆盖已清除的 overlay", async () => {
  let finish!: (image: typeof overlayImage) => void;
  let entered!: () => void;
  const loading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.doMock("@tauri-apps/plugin-os", () => ({ platform: () => "windows" }));
  vi.doMock("@tauri-apps/api/image", () => ({
    Image: {
      fromPath: async () => {
        entered();
        return new Promise<typeof overlayImage>((resolve) => {
          finish = resolve;
        });
      },
    },
  }));
  vi.resetModules();
  const { applyBadge } = await import("../tray");
  const pending = applyBadge(4);
  await loading;
  await applyBadge(0);
  finish(overlayImage);
  await pending;
  expect(setOverlayIcon.mock.calls[setOverlayIcon.mock.calls.length - 1]).toEqual([undefined]);
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

it.each(["image", "menu"])("未读清零后迟到的 %s 不能把托盘文案写回旧数值", async (delay) => {
  let finish!: () => void;
  const setTooltip = vi.fn().mockResolvedValue(undefined);
  const setText = vi.fn().mockResolvedValue(undefined);
  const item = { setText };
  const get = vi.fn().mockResolvedValue(item);
  const fromPath = vi.fn().mockResolvedValue(overlayImage);
  vi.doMock("@tauri-apps/plugin-os", () => ({ platform: () => "windows" }));
  vi.doMock("@tauri-apps/api/image", () => ({ Image: { fromPath } }));
  vi.doMock("@tauri-apps/api/tray", () => ({
    TrayIcon: { new: async () => ({ setTooltip, close: async () => {} }) },
  }));
  vi.doMock("@tauri-apps/api/menu", () => ({ Menu: { new: async () => ({ get }) } }));
  vi.doMock("@tauri-apps/api/app", () => ({ defaultWindowIcon: async () => null }));
  vi.doMock("@tauri-apps/plugin-process", () => ({ exit: vi.fn() }));
  vi.resetModules();
  const { installTray } = await import("../tray");
  const { useConversationStore } = await import("@yuanchat/shared");
  const { default: i18n } = await import("i18next");
  useConversationStore.setState({ conversations: [] });
  const dispose = await installTray({ onOpenConversation: () => {} });
  try {
    await vi.waitFor(() => expect(setText).toHaveBeenCalledTimes(1));
    if (delay === "image") {
      fromPath.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = () => resolve(overlayImage);
          }),
      );
    } else {
      get.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = () => resolve(item);
          }),
      );
    }
    useConversationStore.setState({
      conversations: [
        {
          id: "c1",
          name: "未读会话",
          type: "private",
          unreadCount: 4,
          isMuted: false,
        },
      ],
    });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    useConversationStore.setState({ conversations: [] });
    await vi.waitFor(() => expect(setText).toHaveBeenCalledTimes(2));
    finish();
    // 放行的原生 Promise 链需先收尾，才能检查最终留下的 tooltip/menu 文案。
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(setOverlayIcon).toHaveBeenLastCalledWith(undefined);
    expect(setTooltip).toHaveBeenLastCalledWith(i18n.t("tray.tooltip"));
    expect(setText).toHaveBeenLastCalledWith(i18n.t("tray.noUnread"));
  } finally {
    dispose();
  }
});

it.each(["menu", "click"])(
  "托盘 %s 唤回会话后只清除该会话未读，并同步剩余系统角标",
  async (entry) => {
    let open!: () => void;
    let click!: (event: { type: string; button: string; buttonState: string }) => void;
    vi.doMock("@tauri-apps/plugin-os", () => ({ platform: () => "linux" }));
    vi.doMock("@tauri-apps/api/window", () => ({
      getCurrentWindow: () => ({
        setBadgeCount,
        show: vi.fn(),
        unminimize: vi.fn(),
        setFocus: vi.fn(),
        setAlwaysOnTop: vi.fn(),
        center: vi.fn(),
      }),
    }));
    vi.doMock("@tauri-apps/api/menu", () => ({
      Menu: {
        new: async ({ items }: { items: Array<{ id: string; action?: () => void }> }) => {
          open = items.find((item) => item.id === "tray-open")!.action!;
          return { get: async () => undefined };
        },
      },
    }));
    vi.doMock("@tauri-apps/api/tray", () => ({
      TrayIcon: {
        new: async ({ action }: { action: typeof click }) => {
          click = action;
          return { setTooltip: async () => {}, close: async () => {} };
        },
      },
    }));
    vi.doMock("@tauri-apps/api/app", () => ({ defaultWindowIcon: async () => null }));
    vi.doMock("@tauri-apps/plugin-process", () => ({ exit: vi.fn() }));
    vi.resetModules();
    const { installTray } = await import("../tray");
    const { useConversationStore } = await import("@yuanchat/shared");
    useConversationStore.setState({
      conversations: [
        {
          id: "first",
          name: "一",
          type: "private",
          isMuted: false,
          unreadCount: 2,
          lastSeq: 8,
          myLastReadSeq: 6,
        },
        {
          id: "second",
          name: "二",
          type: "private",
          isMuted: false,
          unreadCount: 3,
          lastSeq: 3,
          myLastReadSeq: 0,
        },
      ],
    });
    const navigate = vi.fn();
    const dispose = await installTray({ onOpenConversation: navigate });
    try {
      if (entry === "menu") open();
      else click({ type: "Click", button: "Left", buttonState: "Down" });
      await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("first"));
      expect(useConversationStore.getState().conversations.map((c) => c.unreadCount)).toEqual([
        0, 3,
      ]);
      expect(useConversationStore.getState().conversations[0].myLastReadSeq).toBe(8);
      expect(setBadgeCount).toHaveBeenLastCalledWith(3);
    } finally {
      dispose();
      useConversationStore.setState({ conversations: [] });
    }
  },
);
