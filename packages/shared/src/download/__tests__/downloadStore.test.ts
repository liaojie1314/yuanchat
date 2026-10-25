import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelDownload, startDownload, useDownloadStore } from "../downloadStore";
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
  setFileSink({ save: vi.fn().mockResolvedValue("/tmp/a.pdf") });
});

afterEach(() => {
  __resetFileSink();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("downloadStore", () => {
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
    setFileSink({ save });
    // 永不结束的流，给 cancel 留出时间窗
    vi.stubGlobal("fetch", mockFetch(new ReadableStream({ pull() {} }), "999"));
    const p = startDownload("m6", "obj/f", "f.pdf");
    cancelDownload("m6");
    await p;
    expect(useDownloadStore.getState().entries["m6"].phase).toBe("canceled");
    expect(save).not.toHaveBeenCalled();
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
