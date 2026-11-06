/**
 * DownloadPanel 的组件测试。
 *
 * catalog 数据走 vi.mock 的 fetchCatalog（本包单测环境没有 MSW Service Worker，
 * 那条四态链路由 shared 的 handlers + Web E2E 钉住），这里钉的是面板自身的
 * 状态机：骨架屏 → 推荐/折叠、空态兜底链接、错误重试。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { CatalogEntry } from "@yuanchat/shared";

const fetchCatalog = vi.hoisted(() => vi.fn());
vi.mock("@yuanchat/shared", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, fetchCatalog };
});

import { DownloadPanel } from "../DownloadPanel";
import i18n from "@yuanchat/design-system/i18n";

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
  it("Linux x86_64 不推荐目录里排在前面的 ARM 包", async () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
      userAgentData: undefined,
    });
    fetchCatalog.mockResolvedValue([
      { ...CATALOG[1], arch: "aarch64", url: "https://example.test/arm.AppImage" },
      ...CATALOG,
    ]);
    render(<DownloadPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("recommended")).toHaveAttribute("href", CATALOG[1].url),
    );
  });

  it("无法可靠识别 Mac 架构时优先推荐 universal，不猜测 Apple Silicon 或 Intel", async () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      userAgentData: undefined,
    });
    fetchCatalog.mockResolvedValue([
      { ...CATALOG[2], arch: "aarch64", url: "https://example.test/arm.dmg" },
      ...CATALOG,
    ]);
    render(<DownloadPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("recommended")).toHaveAttribute("href", CATALOG[2].url),
    );
  });

  it("UA 被简化时采信 UAData 的真实架构，而不是把 ARM Windows 当 x64", async () => {
    vi.stubGlobal("navigator", {
      userAgent: UA.win,
      userAgentData: {
        platform: "Windows",
        getHighEntropyValues: async () => ({ architecture: "arm", bitness: "64" }),
      },
    });
    fetchCatalog.mockResolvedValue([
      ...CATALOG,
      { ...CATALOG[0], arch: "aarch64", url: "https://example.test/arm.exe" },
    ]);
    render(<DownloadPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("recommended")).toHaveAttribute(
        "href",
        "https://example.test/arm.exe",
      ),
    );
  });

  it("只有系统但架构未知时展开全部安装包，不高亮不确定的包", async () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (X11; Linux)", userAgentData: undefined });
    fetchCatalog.mockResolvedValue(CATALOG);
    render(<DownloadPanel />);
    await waitFor(() => expect(screen.getByText(/\.AppImage/)).toBeInTheDocument());
    expect(screen.queryByTestId("recommended")).not.toBeInTheDocument();
  });
  it("高亮当前系统的包，其他平台直接展示而不是折叠", async () => {
    vi.stubGlobal("navigator", { ...navigator, userAgent: UA.win, userAgentData: undefined });
    fetchCatalog.mockResolvedValue(CATALOG);
    render(<DownloadPanel />);
    await waitFor(() => expect(screen.getByTestId("recommended")).toHaveTextContent(/Windows/i));
    expect(screen.getByText(/\.AppImage/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /其他平台|Other platforms/i })).toBeNull();
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

it("只有 Linux 包时仍列出 Windows、macOS、Android，不把无包平台隐藏", async () => {
  vi.stubGlobal("navigator", {
    userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    userAgentData: undefined,
  });
  fetchCatalog.mockResolvedValue([CATALOG[1]]);
  render(<DownloadPanel />);
  await screen.findByTestId("recommended");
  expect(screen.getByText("Windows")).toBeInTheDocument();
  expect(screen.getByText("macOS")).toBeInTheDocument();
  expect(screen.getByText("Android")).toBeInTheDocument();
});

it("当前系统与其他平台有可见标题，同系统的其他架构不混入其他平台", async () => {
  vi.stubGlobal("navigator", {
    userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    userAgentData: undefined,
  });
  fetchCatalog.mockResolvedValue([
    { ...CATALOG[1], arch: "aarch64", url: "https://example.test/arm.AppImage" },
    ...CATALOG,
  ]);
  render(<DownloadPanel />);
  await screen.findByRole("heading", { name: i18n.t("download.currentPlatform") });
  expect(screen.getByRole("heading", { name: i18n.t("download.other") })).toBeVisible();
  const current = screen.getByRole("region", { name: i18n.t("download.currentPlatform") });
  const other = screen.getByRole("region", { name: i18n.t("download.other") });
  expect(within(current).getAllByRole("link", { name: /Linux/i })).toHaveLength(2);
  expect(within(other).queryByRole("link", { name: /Linux/i })).toBeNull();
  expect(within(other).getByRole("link", { name: /Windows/i })).toBeVisible();
});

it("当前系统尚无安装包时仍保留当前系统分组，不把它归到其他平台", async () => {
  vi.stubGlobal("navigator", { userAgent: UA.win, userAgentData: undefined });
  fetchCatalog.mockResolvedValue([CATALOG[1]]);
  render(<DownloadPanel />);
  await screen.findByRole("heading", { name: i18n.t("download.currentPlatform") });
  const current = screen.getByRole("region", { name: i18n.t("download.currentPlatform") });
  const other = screen.getByRole("region", { name: i18n.t("download.other") });
  expect(within(current).getByText("Windows")).toBeVisible();
  expect(within(current).getByText(i18n.t("download.unavailable"))).toBeVisible();
  expect(within(other).queryByText("Windows")).toBeNull();
});
