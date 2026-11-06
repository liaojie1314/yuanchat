import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelDownload, revealDownload, startDownload, useDownloadStore } from "../downloadStore";
import { __resetFileSink, setFileSink } from "../fileSink";

// 签名接口整个 mock 掉：下载器只关心「拿到一个 URL」，不关心签名细节。
// vi.mock 必须写在顶层（会被提升到 import 之前），不能放进 beforeEach。
vi.mock("../../api/files", () => ({
  getDownloadUrl: vi.fn().mockResolvedValue("https://x/obj"),
}));

/** 造一个按节奏吐 chunk 的 ReadableStream，用来驱动进度 */
function streamOf(chunks: Uint8Array[], opts?: { failAt?: number }) {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (opts?.failAt !== undefined && i === opts.failAt) {
        controller.error(new TypeError("network error"));
        return;
      }
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[i]);
      i += 1;
    },
  });
}

function mockFetch(body: ReadableStream<Uint8Array> | null, contentLength?: string) {
  const headers = new Headers();
  if (contentLength !== undefined) headers.set("content-length", contentLength);
  return vi.fn().mockResolvedValue({ ok: true, status: 200, body, headers });
}

beforeEach(() => {
  useDownloadStore.setState({ entries: {} });
  setFileSink({
    read: async () => new Uint8Array([1]),
    save: vi.fn().mockResolvedValue("/tmp/a.pdf"),
  });
});

afterEach(() => {
  __resetFileSink();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("downloadStore", () => {
  it("查看下载时权限检查失败保留原结果且不重下载", async () => {
    const fetch = vi.fn();
    setFileSink({
      read: async () => new Uint8Array([1]),
      save: vi.fn(),
      exists: async () => {
        throw new Error("download.directoryPermissionRequired");
      },
      reveal: vi.fn(),
    });
    vi.stubGlobal("fetch", fetch);
    useDownloadStore.setState({
      entries: {
        saved: {
          phase: "done",
          received: 1,
          total: 1,
          sha256: "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",
          savedPath: "browser-download:1",
        },
      },
    });
    await expect(revealDownload("saved", "obj/a", "a.pdf")).rejects.toThrow(
      "download.directoryPermissionRequired",
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(useDownloadStore.getState().entries.saved.phase).toBe("done");
  });
  it("Web 查看保存位置返回可读名称，不重新下载或泄露内部引用", async () => {
    const fetch = vi.fn();
    setFileSink({
      read: async () => new Uint8Array([1]),
      save: vi.fn(),
      exists: async () => true,
      reveal: async () => "Downloads / a.pdf",
      revealTarget: "location",
    });
    vi.stubGlobal("fetch", fetch);
    useDownloadStore.setState({
      entries: {
        saved: {
          phase: "done",
          received: 1,
          total: 1,
          sha256: "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",
          savedPath: "browser-download:1",
        },
      },
    });
    expect(await revealDownload("saved", "obj/a", "a.pdf")).toBe("Downloads / a.pdf");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("已下载文件仍存在时打开所在位置，不重复请求下载", async () => {
    const reveal = vi.fn().mockResolvedValue(undefined);
    const fetch = vi.fn();
    setFileSink({
      read: async () => new Uint8Array([1]),
      save: vi.fn(),
      exists: async () => true,
      reveal,
    });
    vi.stubGlobal("fetch", fetch);
    useDownloadStore.setState({
      entries: {
        saved: {
          phase: "done",
          received: 1,
          total: 1,
          sha256: "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",
          savedPath: "/downloads/a.pdf",
        },
      },
    });
    await revealDownload("saved", "obj/a", "a.pdf");
    expect(reveal).toHaveBeenCalledWith("/downloads/a.pdf");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("本地文件已删除时重新下载，同一点击恢复文件和完成态", async () => {
    const reveal = vi.fn();
    const save = vi.fn().mockResolvedValue("/downloads/a.pdf");
    setFileSink({ read: async () => new Uint8Array([1]), save, exists: async () => false, reveal });
    vi.stubGlobal("fetch", mockFetch(streamOf([new Uint8Array([7, 8])]), "2"));
    useDownloadStore.setState({
      entries: {
        removed: {
          phase: "done",
          received: 1,
          total: 1,
          sha256: "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",
          savedPath: "/downloads/a.pdf",
        },
      },
    });
    await revealDownload("removed", "obj/a", "a.pdf");
    expect(reveal).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(
      new Uint8Array([7, 8]),
      "a.pdf",
      "application/octet-stream",
      "downloads",
      expect.any(AbortSignal),
    );
    expect(useDownloadStore.getState().entries.removed).toMatchObject({
      phase: "done",
      received: 2,
      savedPath: "/downloads/a.pdf",
    });
  });

  it("文件存在但系统打开失败时保留失败原因，不误判删除重新下载", async () => {
    const fetch = vi.fn();
    setFileSink({
      read: async () => new Uint8Array([1]),
      save: vi.fn(),
      exists: async () => true,
      reveal: async () => {
        throw new Error("file manager unavailable");
      },
    });
    vi.stubGlobal("fetch", fetch);
    useDownloadStore.setState({
      entries: {
        saved: {
          phase: "done",
          received: 1,
          total: 1,
          sha256: "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",
          savedPath: "/downloads/a.pdf",
        },
      },
    });
    await expect(revealDownload("saved", "obj/a", "a.pdf")).rejects.toThrow(
      "file manager unavailable",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("目录授权失效反馈重新授权，而不是泛化为网络失败", async () => {
    setFileSink({
      read: async () => new Uint8Array([1]),
      save: async () => {
        throw new Error("download.directoryPermissionRequired");
      },
    });
    vi.stubGlobal("fetch", mockFetch(streamOf([new Uint8Array([1])]), "1"));
    await startDownload("folder-denied", "obj/a", "a.pdf");
    expect(useDownloadStore.getState().entries["folder-denied"]).toMatchObject({
      phase: "failed",
      errorKey: "download.directoryPermissionRequired",
    });
  });
  it("进度单调递增，完成后 phase 为 done 且带落盘路径", async () => {
    const chunks = [new Uint8Array(40), new Uint8Array(60)];
    vi.stubGlobal("fetch", mockFetch(streamOf(chunks), "100"));

    await startDownload("m1", "obj/a", "a.pdf");

    const e = useDownloadStore.getState().entries["m1"];
    expect(e.phase).toBe("done");
    expect(e.total).toBe(100);
    expect(e.received).toBe(100);
    expect(e.savedPath).toBe("/tmp/a.pdf");
  });

  it("服务端未给 content-length 时 total 为 0（进度条走不确定态）", async () => {
    vi.stubGlobal("fetch", mockFetch(streamOf([new Uint8Array(10)])));
    await startDownload("m2", "obj/b", "b.bin");
    expect(useDownloadStore.getState().entries["m2"].total).toBe(0);
  });

  // Review Focus #2：下载途中断网 / 预签名 URL 过期
  it("流中途出错时进 failed 态并带可本地化的错误 key，不是静默卡住", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(streamOf([new Uint8Array(10), new Uint8Array(10)], { failAt: 1 }), "20"),
    );

    await startDownload("m3", "obj/c", "c.pdf");

    const e = useDownloadStore.getState().entries["m3"];
    expect(e.phase).toBe("failed");
    expect(e.errorKey).toBe("chat.file.downloadFailed");
    // 已收到的字节数要留着，UI 才能显示「在 50% 处失败」而不是回到 0
    expect(e.received).toBe(10);
  });

  it("预签名 URL 返非 2xx 时进 failed，不把错误页当文件存下来", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        body: null,
        headers: new Headers(),
      }),
    );
    await startDownload("m4", "obj/d", "d.pdf");
    expect(useDownloadStore.getState().entries["m4"].phase).toBe("failed");
  });

  it("重复点击不起第二条请求", async () => {
    const f = mockFetch(streamOf([new Uint8Array(10)]), "10");
    vi.stubGlobal("fetch", f);
    const p1 = startDownload("m5", "obj/e", "e.pdf");
    const p2 = startDownload("m5", "obj/e", "e.pdf");
    await Promise.all([p1, p2]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("取消后进 canceled 态且不落盘", async () => {
    const save = vi.fn();
    setFileSink({ read: async () => new Uint8Array([1]), save });
    // 永不结束的流，给 cancel 留出时间窗
    vi.stubGlobal("fetch", mockFetch(new ReadableStream({ pull() {} }), "999"));
    const p = startDownload("m6", "obj/f", "f.pdf");
    cancelDownload("m6");
    await p;
    expect(useDownloadStore.getState().entries["m6"].phase).toBe("canceled");
    expect(save).not.toHaveBeenCalled();
  });

  it("写盘期间取消不会被完成态覆盖，并清理本次创建的文件", async () => {
    const disk = new Map<string, Uint8Array>();
    let finish!: () => void;
    let entered!: () => void;
    const writing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    setFileSink({
      read: async () => new Uint8Array([1]),
      save: async (bytes) => {
        entered();
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        disk.set("/downloads/a.pdf", bytes);
        return "/downloads/a.pdf";
      },
      remove: async (path) => {
        disk.delete(path);
      },
    });
    vi.stubGlobal("fetch", mockFetch(streamOf([new Uint8Array([1])]), "1"));
    const pending = startDownload("saving-cancel", "obj/a", "a.pdf");
    await writing;
    cancelDownload("saving-cancel");
    finish();
    await pending;
    expect(useDownloadStore.getState().entries["saving-cancel"].phase).toBe("canceled");
    expect(disk.size).toBe(0);
  });

  it("进度更新按 100ms 节流，大量 chunk 不会每个都 setState", async () => {
    const many = Array.from({ length: 500 }, () => new Uint8Array(2));
    vi.stubGlobal("fetch", mockFetch(streamOf(many), "1000"));

    let writes = 0;
    const unsub = useDownloadStore.subscribe(() => {
      writes += 1;
    });
    await startDownload("m7", "obj/g", "g.bin");
    unsub();

    // 500 个 chunk 若每个都写一次就是 500+ 次。节流后应远小于它
    // （阈值取 50：含起始、若干节流点、saving、done 几次状态跃迁）
    expect(writes).toBeLessThan(50);
    expect(useDownloadStore.getState().entries["m7"].received).toBe(1000);
  });
});
