/**
 * otaUpdater 的单元测试。
 *
 * mock 面只有两块：`@tauri-apps/api/core` 的 invoke（钉「装不装、装哪个」）
 * 与注入的 fileSink（钉「校验的来源、删没删」）。下载那段走 shared 的
 * startDownloadFromUrl，用 stub 的全局 fetch 喂一个确定的字节流。
 *
 * 最要紧的一条（Review Focus #5）：sha256 不匹配必须**不调安装器并删掉
 * 已落盘的文件** —— install_apk 一旦发出 Intent，字节就交给系统了，
 * 之后没有任何把关机会。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** invoke 的调用记录：每条用例断言「install_apk 有没有、带什么参数」 */
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { sha256Hex, downloadAndInstall } from "../android/otaUpdater";
import { setFileSink, __resetFileSink, useDownloadStore } from "@yuanchat/shared";

/** 造一个 200 响应：按顺序吐 chunk、带 content-length，驱动确定性进度 */
function okResponse(chunks: Uint8Array[]) {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[i]);
      i += 1;
    },
  });
  const headers = new Headers({
    "content-length": String(chunks.reduce((n, c) => n + c.byteLength, 0)),
    "content-type": "application/vnd.android.package-archive",
  });
  return vi.fn().mockResolvedValue({ ok: true, status: 200, body, headers });
}

beforeEach(() => {
  invoke.mockReset();
  useDownloadStore.setState({ entries: {} });
  __resetFileSink();
});

afterEach(() => {
  __resetFileSink();
  vi.unstubAllGlobals();
});

describe("otaUpdater", () => {
  it("sha256Hex 产出小写十六进制且长度 64", async () => {
    const hex = await sha256Hex(new TextEncoder().encode("hello"));
    expect(hex).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  // Review Focus #5：sha256 不匹配必须拒装并删文件
  it("sha256 不匹配时不调安装器，并删掉已落盘的 APK", async () => {
    const remove = vi.fn();
    vi.stubGlobal("fetch", okResponse([new TextEncoder().encode("tampered")]));
    setFileSink({
      save: vi.fn().mockResolvedValue("yuanchat-0.8.0.apk"),
      remove,
      read: vi.fn().mockResolvedValue(new TextEncoder().encode("tampered")),
    });

    await expect(
      downloadAndInstall({
        version: "0.8.0",
        url: "https://x/a.apk",
        sha256: "0".repeat(64), // 故意不匹配
        size: 9,
        notes: "",
        mandatory: false,
      }),
    ).rejects.toThrow(/sha256|校验/i);

    expect(invoke).not.toHaveBeenCalledWith("install_apk", expect.anything());
    expect(remove).toHaveBeenCalled();
  });

  it("sha256 匹配时才调 install_apk", async () => {
    const bytes = new TextEncoder().encode("hello");
    vi.stubGlobal("fetch", okResponse([bytes]));
    setFileSink({
      save: vi.fn().mockResolvedValue("a.apk"),
      remove: vi.fn(),
      read: vi.fn().mockResolvedValue(bytes),
    });

    await downloadAndInstall({
      version: "0.8.0",
      url: "https://x/a.apk",
      sha256: await sha256Hex(bytes),
      size: bytes.byteLength,
      notes: "",
      mandatory: false,
    });
    expect(invoke).toHaveBeenCalledWith("install_apk", { path: expect.any(String) });
  });

  it("服务端没给 sha256 时直接拒绝安装（宁可不更新，不装来源不明的字节）", async () => {
    setFileSink({ save: vi.fn().mockResolvedValue("a.apk"), remove: vi.fn(), read: vi.fn() });

    await expect(
      downloadAndInstall({
        version: "0.8.0",
        url: "https://x/a.apk",
        sha256: "",
        size: 1,
        notes: "",
        mandatory: false,
      }),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});
