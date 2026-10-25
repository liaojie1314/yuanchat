/**
 * DownloadPanel 的组件测试。
 *
 * catalog 数据走 vi.mock 的 fetchCatalog（本包单测环境没有 MSW Service Worker，
 * 那条四态链路由 shared 的 handlers + Web E2E 钉住），这里钉的是面板自身的
 * 状态机：骨架屏 → 推荐/折叠、空态兜底链接、错误重试。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CatalogEntry } from "@yuanchat/shared";

const fetchCatalog = vi.hoisted(() => vi.fn());
vi.mock("@yuanchat/shared", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, fetchCatalog };
});

import { DownloadPanel } from "../DownloadPanel";

const UA = {
  win: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
};

/** 一份覆盖四平台的 catalog 样本：Windows 命中推荐，Linux 的 .AppImage 用来钉折叠 */
const CATALOG: CatalogEntry[] = [
  {
    platform: "windows",
    arch: "x86_64",
    version: "0.8.0",
    size: 64_000_000,
    notes: "",
    url: "http://localhost:9002/releases/mock/yuanchat-setup.exe",
  },
  {
    platform: "linux",
    arch: "x86_64",
    version: "0.8.0",
    size: 78_000_000,
    notes: "",
    url: "http://localhost:9002/releases/mock/yuanchat-linux.AppImage",
  },
  {
    platform: "darwin",
    arch: "universal",
    version: "0.8.0",
    size: 82_000_000,
    notes: "",
    url: "http://localhost:9002/releases/mock/yuanchat.dmg",
  },
  {
    platform: "android",
    arch: "aarch64",
    version: "0.8.0",
    size: 42_000_000,
    notes: "",
    url: "http://localhost:9002/releases/mock/yuanchat.apk",
  },
];

beforeEach(() => {
  fetchCatalog.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DownloadPanel", () => {
  it("高亮当前系统的包，其余折叠", async () => {
    vi.stubGlobal("navigator", { ...navigator, userAgent: UA.win, userAgentData: undefined });
    fetchCatalog.mockResolvedValue(CATALOG);
    render(<DownloadPanel />);
    await waitFor(() => expect(screen.getByTestId("recommended")).toHaveTextContent(/Windows/i));
    // 其他平台默认收起
    expect(screen.queryByText(/\.AppImage/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /其他平台|Other platforms/i }));
    expect(screen.getByText(/\.AppImage/)).toBeInTheDocument();
  });

  it("加载中渲染骨架屏（固定高度，零 CLS）", () => {
    vi.stubGlobal("navigator", { ...navigator, userAgent: UA.win, userAgentData: undefined });
    // 永不 resolve 的承诺：钉住 loading 态不被竞态冲掉
    fetchCatalog.mockReturnValue(new Promise(() => {}));
    render(<DownloadPanel />);
    expect(screen.getByTestId("download-skeleton")).toBeInTheDocument();
  });

  it("catalog 为空时显示空态与 GitHub 兜底链接", async () => {
    vi.stubGlobal("navigator", { ...navigator, userAgent: UA.win, userAgentData: undefined });
    fetchCatalog.mockResolvedValue([]);
    render(<DownloadPanel />);
    await waitFor(() =>
      expect(screen.getByText(/暂无可用安装包|No installers/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: /GitHub/i })).toBeInTheDocument();
  });

  it("请求失败时显示错误与重试按钮", async () => {
    vi.stubGlobal("navigator", { ...navigator, userAgent: UA.win, userAgentData: undefined });
    fetchCatalog.mockRejectedValue(new Error("network down"));
    render(<DownloadPanel />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /重试|Retry/i })).toBeInTheDocument(),
    );
  });

  it("认不出平台时不设推荐区，其余平台直接展开", async () => {
    vi.stubGlobal("navigator", { ...navigator, userAgent: "Mozilla/5.0 (PlayStation 5)" });
    fetchCatalog.mockResolvedValue(CATALOG);
    render(<DownloadPanel />);
    await waitFor(() => expect(screen.getByText(/\.AppImage/)).toBeInTheDocument());
    expect(screen.queryByTestId("recommended")).not.toBeInTheDocument();
  });
});
