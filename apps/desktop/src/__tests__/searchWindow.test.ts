/**
 * useSearchWindow 契约测试（开窗参数纯函数部分）。
 *
 * 只钉参数拼装 —— 真正的 WebviewWindow 创建属于桌面实测范畴（Tauri 窗口在
 * 浏览器/单测环境起不来）。参数拼错的后果是窗口开起来不对劲（没自绘标题栏
 * 就拖不了、尺寸跑偏、路由打错开成主界面），且只在真机上才暴露。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAuthStore, useThemeStore } from "@yuanchat/shared";
import { launchSearchWindow } from "@yuanchat/ui";
import {
  searchWindowConfig,
  SEARCH_WINDOW_LABEL,
  SEARCH_WINDOW_URL,
  SEARCH_WINDOW_SIZE,
  useSearchWindow,
} from "../hooks/useSearchWindow";

const native = vi.hoisted(() => ({
  getByLabel: vi.fn(),
  create: vi.fn(),
  setFocus: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  emitTo: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
  once: vi.fn().mockImplementation((event: string, cb: () => void) => {
    if (event === "tauri://created") cb();
    return Promise.resolve(() => {});
  }),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {
    static getByLabel = native.getByLabel;
    once = native.once;
    constructor(...args: unknown[]) {
      native.create(...args);
    }
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ emitTo: native.emitTo, listen: native.listen }));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => "linux" }));
beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: true, user: { id: "user-a", nickname: "甲" } });
  native.getByLabel.mockReset();
  native.close.mockReset().mockResolvedValue(undefined);
  native.once.mockReset().mockImplementation((event: string, cb: () => void) => {
    if (event === "tauri://created") cb();
    return Promise.resolve(() => {});
  });
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("原生搜索范围", () => {
  it("首次就绪与主窗换肤均同步当前皮肤，卸载后停止同步", async () => {
    useThemeStore.getState().setSkin("yuan-dark");
    native.getByLabel.mockResolvedValue({ setFocus: native.setFocus });
    const hook = renderHook(() => useSearchWindow(true));
    launchSearchWindow("c1");
    await waitFor(() => expect(native.setFocus).toHaveBeenCalledTimes(1));
    const ready = native.listen.mock.calls.find(([event]) => event === "search:ready")![1];
    ready({ payload: null });
    expect(native.emitTo).toHaveBeenLastCalledWith("search", "search:scope", {
      conversationId: "c1",
      skinId: "yuan-dark",
    });
    useThemeStore.getState().setSkin("ocean-light");
    expect(native.emitTo).toHaveBeenLastCalledWith("search", "search:scope", {
      conversationId: "c1",
      skinId: "ocean-light",
    });
    hook.unmount();
    native.emitTo.mockClear();
    useThemeStore.getState().setSkin("yuan-light");
    expect(native.emitTo).not.toHaveBeenCalled();
  });

  it("主窗口登出关闭独立搜索窗口，未登录期间不再开窗", async () => {
    native.getByLabel.mockResolvedValue({ setFocus: native.setFocus, close: native.close });
    const hook = renderHook(() => useSearchWindow(true));
    launchSearchWindow("old-account-conversation");
    await waitFor(() => expect(native.setFocus).toHaveBeenCalledTimes(1));
    useAuthStore.getState().clearSession();
    await waitFor(() => expect(native.close).toHaveBeenCalledTimes(1));
    launchSearchWindow("old-account-conversation");
    await Promise.resolve();
    expect(native.create).not.toHaveBeenCalled();
    expect(native.setFocus).toHaveBeenCalledTimes(1);
    hook.unmount();
  });
  it("账号切换时关闭迟到的旧窗，完成后才为新账号开窗", async () => {
    let created!: () => void;
    let closed!: () => void;
    native.once.mockImplementationOnce((_event: string, cb: () => void) => {
      created = cb;
      return Promise.resolve(() => {});
    });
    native.close.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          closed = resolve;
        }),
    );
    native.getByLabel
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ close: native.close, setFocus: native.setFocus })
      .mockResolvedValueOnce(null);
    const hook = renderHook(() => useSearchWindow(true));
    launchSearchWindow("old");
    await waitFor(() => expect(native.create).toHaveBeenCalledTimes(1));
    useAuthStore.setState({ user: { id: "user-b", nickname: "乙" } });
    launchSearchWindow("new");
    created();
    await waitFor(() => expect(native.close).toHaveBeenCalledTimes(1));
    expect(native.create).toHaveBeenCalledTimes(1);
    closed();
    await waitFor(() => expect(native.create).toHaveBeenCalledTimes(2));
    expect(native.create).toHaveBeenLastCalledWith(
      "search",
      expect.objectContaining({
        url: "/search-window?conversation_id=new",
      }),
    );
    hook.unmount();
  });
  it("同账号轮换令牌不会关闭仍在使用的搜索窗口", async () => {
    native.getByLabel.mockResolvedValue({ setFocus: native.setFocus, close: native.close });
    const hook = renderHook(() => useSearchWindow(true));
    launchSearchWindow("c1");
    await waitFor(() => expect(native.setFocus).toHaveBeenCalledTimes(1));
    useAuthStore.setState({ accessToken: "rotated", refreshToken: "rotated-refresh" });
    launchSearchWindow("c2");
    await waitFor(() => expect(native.setFocus).toHaveBeenCalledTimes(2));
    expect(native.close).not.toHaveBeenCalled();
    hook.unmount();
  });
  it("初始化监听失败要显式记录，不能留下未处理 Promise 拒绝", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    native.listen.mockRejectedValueOnce(new Error("browser has no Tauri event API"));
    const hook = renderHook(() => useSearchWindow(true));
    await waitFor(() => expect(error).toHaveBeenCalled());
    hook.unmount();
    error.mockRestore();
  });
  it("新窗口 URL 带会话范围，复用固定 search label", async () => {
    native.getByLabel.mockResolvedValue(null);
    const hook = renderHook(() => useSearchWindow(true));
    expect(launchSearchWindow("scope /中")).toBe(true);
    await waitFor(() =>
      expect(native.create).toHaveBeenCalledWith(
        "search",
        expect.objectContaining({ url: "/search-window?conversation_id=scope%20%2F%E4%B8%AD" }),
      ),
    );
    hook.unmount();
  });
  it("页面就绪时重发最新 scope，覆盖开窗期间切换会话", async () => {
    native.getByLabel.mockResolvedValue(null);
    const hook = renderHook(() => useSearchWindow(true));
    launchSearchWindow("old");
    await waitFor(() => expect(native.create).toHaveBeenCalledTimes(1));
    native.getByLabel.mockResolvedValue({ setFocus: native.setFocus });
    launchSearchWindow("new");
    await waitFor(() =>
      expect(native.listen).toHaveBeenCalledWith(
        "search:ready",
        expect.any(Function),
        expect.anything(),
      ),
    );
    const ready = native.listen.mock.calls.find(([event]) => event === "search:ready")![1];
    ready({ payload: null });
    await waitFor(() =>
      expect(native.emitTo).toHaveBeenLastCalledWith("search", "search:scope", {
        conversationId: "new",
        skinId: useThemeStore.getState().skinId,
      }),
    );
    hook.unmount();
  });
  it("快速开窗在创建确认前不会重复创建，后续范围仍为最新", async () => {
    let created!: () => void;
    native.once.mockImplementationOnce((_event: string, cb: () => void) => {
      created = cb;
      return Promise.resolve(() => {});
    });
    native.getByLabel.mockResolvedValueOnce(null).mockResolvedValue({ setFocus: native.setFocus });
    const hook = renderHook(() => useSearchWindow(true));
    launchSearchWindow("old");
    await waitFor(() => expect(native.create).toHaveBeenCalledTimes(1));
    launchSearchWindow("new");
    expect(native.create).toHaveBeenCalledTimes(1);
    created();
    await waitFor(() => expect(native.setFocus).toHaveBeenCalledTimes(1));
    expect(native.create).toHaveBeenCalledTimes(1);
    expect(native.emitTo).toHaveBeenLastCalledWith("search", "search:scope", {
      conversationId: "new",
    });
    hook.unmount();
  });
  it("全局面板不复用会话窗口，切换会话时同步新范围并聚焦", async () => {
    native.getByLabel.mockResolvedValue({ setFocus: native.setFocus });
    const hook = renderHook(() => useSearchWindow(true));
    launchSearchWindow("c1");
    await waitFor(() => expect(native.setFocus).toHaveBeenCalledTimes(1));
    expect(native.emitTo).toHaveBeenLastCalledWith("search", "search:scope", {
      conversationId: "c1",
    });
    expect(launchSearchWindow()).toBe(false);
    await Promise.resolve();
    expect(native.setFocus).toHaveBeenCalledTimes(1);
    expect(native.emitTo).toHaveBeenLastCalledWith("search", "search:scope", {
      conversationId: "c1",
    });
    launchSearchWindow("c2");
    await waitFor(() => expect(native.setFocus).toHaveBeenCalledTimes(2));
    expect(native.emitTo).toHaveBeenLastCalledWith("search", "search:scope", {
      conversationId: "c2",
    });
    expect(native.create).not.toHaveBeenCalled();
    hook.unmount();
  });
});

describe("searchWindowConfig", () => {
  it("label 固定为 search、url 打到 /search-window 路由", () => {
    expect(SEARCH_WINDOW_LABEL).toBe("search");
    const cfg = searchWindowConfig();
    expect(cfg.url).toBe(SEARCH_WINDOW_URL);
    expect(cfg.url).toBe("/search-window");
  });

  it("尺寸 880×620、居中、可缩放", () => {
    const cfg = searchWindowConfig();
    expect(cfg.width).toBe(SEARCH_WINDOW_SIZE.width);
    expect(cfg.height).toBe(SEARCH_WINDOW_SIZE.height);
    expect(cfg.width).toBe(880);
    expect(cfg.height).toBe(620);
    expect(cfg.center).toBe(true);
    expect(cfg.resizable).toBe(true);
  });

  it("Windows 高 DPI 小工作区限幅，Linux/macOS 不变", () => {
    const monitor = { scaleFactor: 2, workArea: { size: { width: 1366, height: 768 } } };
    const windows = searchWindowConfig(undefined, "windows", monitor);
    expect(windows.width).toBeLessThanOrEqual(683 - 32);
    expect(windows.height).toBeLessThanOrEqual(384 - 48);
    for (const family of ["linux", "macos"]) {
      expect(searchWindowConfig(undefined, family, monitor)).toEqual(searchWindowConfig());
    }
  });

  it("decorations 关闭：应用自绘标题栏，与主/登录/通话窗口一致", () => {
    expect(searchWindowConfig().decorations).toBe(false);
  });
});
