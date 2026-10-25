/**
 * useSearchWindow 契约测试（开窗参数纯函数部分）。
 *
 * 只钉参数拼装 —— 真正的 WebviewWindow 创建属于桌面实测范畴（Tauri 窗口在
 * 浏览器/单测环境起不来）。参数拼错的后果是窗口开起来不对劲（没自绘标题栏
 * 就拖不了、尺寸跑偏、路由打错开成主界面），且只在真机上才暴露。
 */
import { describe, it, expect } from "vitest";
import {
  searchWindowConfig,
  SEARCH_WINDOW_LABEL,
  SEARCH_WINDOW_URL,
  SEARCH_WINDOW_SIZE,
} from "../hooks/useSearchWindow";

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

  it("decorations 关闭：应用自绘标题栏，与主/登录/通话窗口一致", () => {
    expect(searchWindowConfig().decorations).toBe(false);
  });
});
