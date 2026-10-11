/**
 * openExternal 单测
 *
 * 为什么要守这条：Tauri WebView 里 window.open 不开窗也不报错，
 * 「点下载毫无反应」就是这么来的。注册了原生实现必须走原生，
 * 没注册才回落 window.open，而被拦下的 window.open（返回 null）要当失败抛出 ——
 * 吞掉它就又回到死点击。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setUrlOpener, openExternal, __resetUrlOpener } from "../openExternal";

/** node 环境无 window：按本包惯例 stubGlobal 注入最小实现 */
function stubWindowOpen(ret: Window | null) {
  const open = vi.fn(() => ret);
  vi.stubGlobal("window", { open });
  return open;
}

describe("openExternal", () => {
  beforeEach(() => __resetUrlOpener());
  afterEach(() => {
    __resetUrlOpener();
    vi.unstubAllGlobals();
  });

  it("注册了原生实现就交给它，不碰 window.open", async () => {
    const native = vi.fn();
    const winOpen = stubWindowOpen({} as Window);
    setUrlOpener(native);

    await openExternal("https://example.com/a.pdf");

    expect(native).toHaveBeenCalledWith("https://example.com/a.pdf");
    expect(winOpen).not.toHaveBeenCalled();
  });

  it("未注册时回落 window.open（web 端即此路径）", async () => {
    const winOpen = stubWindowOpen({} as Window);

    await openExternal("https://example.com/a.pdf");

    expect(winOpen).toHaveBeenCalledWith(
      "https://example.com/a.pdf",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("window.open 被拦（返回 null）算失败，必须抛给调用方提示", async () => {
    stubWindowOpen(null);
    await expect(openExternal("https://example.com/a.pdf")).rejects.toThrow("blocked");
  });

  it("原生实现失败照样抛出，不静默", async () => {
    setUrlOpener(() => Promise.reject(new Error("no activity found")));
    await expect(openExternal("https://example.com/a.pdf")).rejects.toThrow("no activity found");
  });
});
