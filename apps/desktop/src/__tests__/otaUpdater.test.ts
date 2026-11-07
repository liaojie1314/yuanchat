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
const nativeFetch = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: nativeFetch }));

import { sha256Hex, downloadAndInstall } from "../android/otaUpdater";
import { setFileSink, __resetFileSink, useDownloadStore, cancelDownload } from "@yuanchat/shared";

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
  nativeFetch.mockReset();
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

  it("GitHub APK 使用原生流式下载，凭据不从自建服务器传播", async () => {
    const bytes = new TextEncoder().encode("hello");
    const browserFetch = vi.fn().mockRejectedValue(new Error("CORS blocked"));
    vi.stubGlobal("fetch", browserFetch);
    nativeFetch.mockImplementation(okResponse([bytes]));
    setFileSink({
      save: vi.fn().mockResolvedValue("a.apk"),
      remove: vi.fn(),
      read: vi.fn().mockResolvedValue(bytes),
    });
    await downloadAndInstall({
      version: "0.9.0",
      notes: "",
      size: 5,
      mandatory: false,
      url: "https://api.github.com/repos/liaojie1314/yuanchat/releases/assets/123",
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    });
    expect(browserFetch).not.toHaveBeenCalled();
    expect(nativeFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/liaojie1314/yuanchat/releases/assets/123",
      {
        signal: expect.any(AbortSignal),
        credentials: "omit",
        headers: { Accept: "application/octet-stream" },
        connectTimeout: 10_000,
        maxRedirections: 3,
      },
    );
    expect(invoke).toHaveBeenCalledWith("install_apk", { path: "a.apk" });
  });

  it("读回 APK 大小与元数据不符时删除且拒绝安装，即使摘要匹配", async () => {
    const bytes = new TextEncoder().encode("hello");
    const remove = vi.fn();
    vi.stubGlobal("fetch", okResponse([bytes]));
    setFileSink({
      save: vi.fn().mockResolvedValue("a.apk"),
      remove,
      read: vi.fn().mockResolvedValue(bytes),
    });
    await expect(
      downloadAndInstall({
        version: "0.9.0",
        notes: "",
        size: 10,
        mandatory: false,
        url: "https://x/a.apk",
        sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      }),
    ).rejects.toThrow(/sha256|校验/i);
    expect(remove).toHaveBeenCalledWith("a.apk", "downloads");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("原生下载取消时不写盘也不启动安装器", async () => {
    const body = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) });
    nativeFetch.mockResolvedValue({
      ok: true,
      body,
      headers: new Headers({ "content-length": "5" }),
    });
    const save = vi.fn();
    setFileSink({ save, read: vi.fn(), remove: vi.fn() });
    const downloading = downloadAndInstall({
      version: "0.9.0",
      notes: "",
      size: 5,
      mandatory: false,
      url: "https://api.github.com/repos/liaojie1314/yuanchat/releases/assets/123",
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    });
    await vi.waitFor(() => expect(nativeFetch).toHaveBeenCalledOnce());
    cancelDownload("ota-0.9.0");
    await expect(downloading).rejects.toThrow("apk download failed");
    expect(useDownloadStore.getState().entries["ota-0.9.0"].phase).toBe("canceled");
    expect(save).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("原生下载的内存字节正确但磁盘字节被改动时删除 APK 并拒装", async () => {
    nativeFetch.mockImplementation(okResponse([new TextEncoder().encode("hello")]));
    const remove = vi.fn();
    setFileSink({
      save: vi.fn().mockResolvedValue("a.apk"),
      remove,
      read: vi.fn().mockResolvedValue(new TextEncoder().encode("jello")),
    });
    await expect(
      downloadAndInstall({
        version: "0.9.0",
        notes: "",
        size: 5,
        mandatory: false,
        url: "https://api.github.com/repos/liaojie1314/yuanchat/releases/assets/123",
        sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      }),
    ).rejects.toThrow(/sha256/);
    expect(remove).toHaveBeenCalledWith("a.apk", "downloads");
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    { sha256: "not-a-digest", size: 5 },
    { sha256: "a".repeat(64), size: 0 },
    { sha256: "a".repeat(64), size: -1 },
  ])("安装元数据无效时下载都不开始：%o", async (metadata) => {
    const browserFetch = vi.fn();
    vi.stubGlobal("fetch", browserFetch);
    await expect(
      downloadAndInstall({
        version: "0.9.0",
        notes: "",
        mandatory: false,
        url: "https://x/a.apk",
        ...metadata,
      }),
    ).rejects.toThrow();
    expect(browserFetch).not.toHaveBeenCalled();
    expect(nativeFetch).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
