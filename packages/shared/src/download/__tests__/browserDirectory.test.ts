import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import {
  chooseBrowserDownloadDirectory,
  loadBrowserDownloadDirectory,
  setBrowserDownloadDirectory,
  supportsBrowserDownloadDirectory,
  type BrowserDownloadDirectory,
} from "../browserDirectory";

const previous = { kind: "directory", name: "Previous" } as BrowserDownloadDirectory;
const selected = { kind: "directory", name: "Selected" } as BrowserDownloadDirectory;

/** 只替代系统选择器；偏好仍经真实 IndexedDB 事务读写。 */
function picker(choose: () => Promise<BrowserDownloadDirectory>) {
  vi.stubGlobal("window", { isSecureContext: true, showDirectoryPicker: choose });
  vi.stubGlobal("navigator", { locks: { request: () => {} } });
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await setBrowserDownloadDirectory(null);
});

it("目录选择立即调用用户授权，提交后刷新仍能读到偏好", async () => {
  const choose = vi.fn().mockResolvedValue(selected);
  picker(choose);
  const result = chooseBrowserDownloadDirectory();
  expect(choose).toHaveBeenCalledWith({ id: "yuanchat-downloads", mode: "readwrite" });
  await result;
  expect((await loadBrowserDownloadDirectory())?.name).toBe("Selected");
  await setBrowserDownloadDirectory(null);
  expect(await loadBrowserDownloadDirectory()).toBeNull();
});

it("取消选择保留已授权目录", async () => {
  await setBrowserDownloadDirectory(previous);
  picker(async () => {
    throw new DOMException("canceled", "AbortError");
  });
  await expect(chooseBrowserDownloadDirectory()).rejects.toMatchObject({ name: "AbortError" });
  expect((await loadBrowserDownloadDirectory())?.name).toBe("Previous");
});

it("偏好写入失败明确拒绝并保留旧目录", async () => {
  await setBrowserDownloadDirectory(previous);
  picker(async () => selected);
  const open = vi.spyOn(indexedDB, "open").mockImplementation(() => {
    throw new DOMException("unavailable", "SecurityError");
  });
  await expect(chooseBrowserDownloadDirectory()).rejects.toMatchObject({ name: "SecurityError" });
  open.mockRestore();
  expect((await loadBrowserDownloadDirectory())?.name).toBe("Previous");
});

it("不安全上下文及没有目录 API 的浏览器不提供授权功能", () => {
  picker(async () => selected);
  expect(supportsBrowserDownloadDirectory()).toBe(true);
  vi.stubGlobal("window", { isSecureContext: false, showDirectoryPicker: () => {} });
  expect(supportsBrowserDownloadDirectory()).toBe(false);
  vi.stubGlobal("window", { isSecureContext: true });
  expect(supportsBrowserDownloadDirectory()).toBe(false);
});
