/** 设置中的目录选择、取消和重新授权，存储与浏览器选择器在边界替代。 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "@yuanchat/design-system/i18n";
import { DownloadDirectorySection } from "../settings/DownloadDirectorySection";
import { __resetFileSink, setFileSink } from "@yuanchat/shared";

const control = vi.hoisted(() => ({
  native: false,
  supported: true,
  directory: null as unknown,
  error: null as unknown,
  permission: "granted",
  requests: 0,
}));
vi.mock("@yuanchat/shared", async (original) => ({
  ...(await original<typeof import("@yuanchat/shared")>()),
  useIsDesktop: () => control.native,
  supportsBrowserDownloadDirectory: () => control.supported,
  loadBrowserDownloadDirectory: async () => control.directory,
  chooseBrowserDownloadDirectory: async () => {
    if (control.error) throw control.error;
    return { name: "Saved files" };
  },
  setBrowserDownloadDirectory: async (handle: unknown) => {
    control.directory = handle;
  },
}));

beforeEach(() => {
  __resetFileSink();
  Object.assign(control, {
    native: false,
    supported: true,
    directory: null,
    error: null,
    permission: "granted",
    requests: 0,
  });
});
afterEach(() => {
  __resetFileSink();
  vi.restoreAllMocks();
});

it("桌面恢复原生目录、选择新目录并可恢复默认，取消选择保留原目录", async () => {
  control.native = true;
  const choose = vi
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ path: "/chosen/files", custom: true });
  setFileSink({
    save: vi.fn(),
    downloadDirectory: {
      get: async () => ({ path: "/downloads/default", custom: false }),
      choose,
      reset: async () => ({ path: "/downloads/default", custom: false }),
    },
  });
  render(<DownloadDirectorySection />);
  await screen.findByText("/downloads/default");
  fireEvent.click(screen.getByRole("button", { name: i18n.t("download.directoryChoose") }));
  await waitFor(() => expect(choose).toHaveBeenCalledTimes(1));
  expect(screen.getByText("/downloads/default")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: i18n.t("download.directoryChoose") }),
    ).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: i18n.t("download.directoryChoose") }));
  await screen.findByText("/chosen/files");
  fireEvent.click(screen.getByRole("button", { name: i18n.t("download.directoryResetNative") }));
  await screen.findByText("/downloads/default");
  expect(screen.queryByText("/chosen/files")).toBeNull();
});

it("选择成功后显示目录，恢复默认不再显示旧目录", async () => {
  render(<DownloadDirectorySection />);
  await screen.findByText(i18n.t("download.directoryDefault"));
  fireEvent.click(screen.getByRole("button", { name: i18n.t("download.directoryChoose") }));
  await screen.findByText("Saved files");
  fireEvent.click(screen.getByRole("button", { name: i18n.t("download.directoryReset") }));
  await screen.findByText(i18n.t("download.directoryDefault"));
  expect(screen.queryByText("Saved files")).toBeNull();
});

it("权限失效只提供重新授权按钮，点击后才请求权限", async () => {
  control.directory = {
    name: "Old files",
    queryPermission: async () => "prompt",
    requestPermission: async () => {
      control.requests += 1;
      return "granted";
    },
  };
  render(<DownloadDirectorySection />);
  await screen.findByText("Old files");
  expect(control.requests).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("download.directoryAuthorize") }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: i18n.t("download.directoryAuthorize") }),
    ).toBeNull(),
  );
  expect(control.requests).toBe(1);
});

it("取消目录选择保留已有目录且不显示失败", async () => {
  control.directory = { name: "Old files", queryPermission: async () => "granted" };
  control.error = new DOMException("canceled", "AbortError");
  render(<DownloadDirectorySection />);
  await screen.findByText("Old files");
  fireEvent.click(screen.getByRole("button", { name: i18n.t("download.directoryChoose") }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: i18n.t("download.directoryChoose") }),
    ).not.toBeDisabled(),
  );
  expect(screen.getByText("Old files")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("保存失败反馈本地化错误并允许重试", async () => {
  control.error = new Error("quota");
  render(<DownloadDirectorySection />);
  await screen.findByText(i18n.t("download.directoryDefault"));
  fireEvent.click(screen.getByRole("button", { name: i18n.t("download.directoryChoose") }));
  expect(await screen.findByRole("alert")).toHaveTextContent(i18n.t("download.directoryFailed"));
  expect(
    screen.getByRole("button", { name: i18n.t("download.directoryChoose") }),
  ).not.toBeDisabled();
});

it("不支持的浏览器与原生端明确展示各自保存方式", () => {
  control.supported = false;
  const view = render(<DownloadDirectorySection />);
  expect(screen.getByText(i18n.t("download.directoryUnsupported"))).toBeInTheDocument();
  expect(screen.queryByRole("button")).toBeNull();
  control.native = true;
  view.rerender(<DownloadDirectorySection />);
  expect(screen.getByText(i18n.t("download.directoryNative"))).toBeInTheDocument();
});
