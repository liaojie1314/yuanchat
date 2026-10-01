import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initLocalStore, purgeLocalStore, localDb, getMedia } from "../localdb";
import {
  resolveObjectUrl,
  getDownloadUrl,
  __resetDownloadUrlCache,
  __resetObjectUrlInflight,
} from "../api/files";

const apiGet = vi.hoisted(() => vi.fn());
vi.mock("../api/client", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, apiGet };
});

/** 记录 fetch 取字节的次数 */
let fetched = 0;

beforeEach(async () => {
  fetched = 0;
  apiGet.mockReset();
  apiGet.mockImplementation(() =>
    Promise.resolve({ url: "https://minio.local/signed?n=" + Date.now(), expires_in: 900 }),
  );
  __resetDownloadUrlCache();
  __resetObjectUrlInflight();
  vi.stubGlobal("fetch", () => {
    fetched++;
    return Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(64)),
      headers: { get: () => "image/jpeg" },
    });
  });
  vi.stubGlobal("URL", {
    createObjectURL: (b: Blob) => "blob:local/" + b.size,
    revokeObjectURL: () => undefined,
  });
  await initLocalStore("media-cache-test");
});

afterEach(async () => {
  await purgeLocalStore();
  vi.unstubAllGlobals();
});

describe("resolveObjectUrl —— 本地优先", () => {
  it("首次签 URL 并写入缓存，第二次不再调 download-url", async () => {
    const first = await resolveObjectUrl("images/a.jpg");
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(fetched).toBe(1);
    expect(first).toContain("blob:local/");
    expect(await getMedia(localDb()!, "images/a.jpg")).not.toBeNull();

    const second = await resolveObjectUrl("images/a.jpg");
    expect(apiGet).toHaveBeenCalledTimes(1); // 没再签
    expect(fetched).toBe(1); // 也没再取字节
    expect(second).toContain("blob:local/");
  });

  it("同 key 并发 8 次只签 1 次 URL（in-flight 去重）", async () => {
    const urls = await Promise.all(
      Array.from({ length: 8 }, () => resolveObjectUrl("images/b.jpg")),
    );
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(fetched).toBe(1);
    expect(new Set(urls).size).toBe(1);
  });

  it("cache=false 时不写本地，清掉签名缓存后必须重新签（视频本体 / 文件走这条）", async () => {
    const a = await resolveObjectUrl("files/movie.mp4", { cache: false });
    // 第二次命中既有的预签名 URL TTL 缓存，不该重签
    await resolveObjectUrl("files/movie.mp4", { cache: false });
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(fetched).toBe(0); // 不缓存就不该去取字节
    expect(await getMedia(localDb()!, "files/movie.mp4")).toBeNull();

    // TTL 缓存清掉后只能重签 —— 证明它从不读本地库
    __resetDownloadUrlCache();
    const c = await resolveObjectUrl("files/movie.mp4", { cache: false });
    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(a).toContain("https://minio.local/signed");
    expect(c).toContain("https://minio.local/signed");
  });

  it("取字节失败时回落到预签名 URL（功能不因缓存失败退化）", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    const url = await resolveObjectUrl("images/c.jpg");
    expect(url).toContain("https://minio.local/signed");
  });

  it("写缓存失败时照常返回可用 URL", async () => {
    vi.spyOn(localDb()!, "transaction").mockImplementation((() => {
      throw new DOMException("boom", "QuotaExceededError");
    }) as IDBDatabase["transaction"]);
    const url = await resolveObjectUrl("images/d.jpg");
    expect(url).toMatch(/^(blob:local\/|https:\/\/minio\.local)/);
  });

  it("降级模式（无本地库）下行为与今天一致：每次都签 URL", async () => {
    await purgeLocalStore();
    const a = await resolveObjectUrl("images/e.jpg");
    __resetDownloadUrlCache();
    const b = await resolveObjectUrl("images/e.jpg");
    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(a).toContain("https://minio.local/signed");
    expect(b).toContain("https://minio.local/signed");
    await initLocalStore("media-cache-test");
  });
});

describe("getDownloadUrl —— 并发去重", () => {
  it("同 key 并发 8 次只发 1 个请求（§2.7 登记的重复请求债）", async () => {
    const urls = await Promise.all(Array.from({ length: 8 }, () => getDownloadUrl("images/f.jpg")));
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(new Set(urls).size).toBe(1);
  });

  it("签名失败后 in-flight 表要清掉，下一次能重试", async () => {
    apiGet.mockRejectedValueOnce(new Error("500"));
    await expect(getDownloadUrl("images/g.jpg")).rejects.toThrow();
    await expect(getDownloadUrl("images/g.jpg")).resolves.toContain("https://minio.local/signed");
    expect(apiGet).toHaveBeenCalledTimes(2);
  });
});

describe("blob URL 复用", () => {
  it("同 key 多次调用返回同一个 blob URL（虚拟滚动反复挂载不堆 blob）", async () => {
    let created = 0;
    vi.stubGlobal("URL", {
      createObjectURL: () => {
        created++;
        return "blob:local/" + created;
      },
      revokeObjectURL: () => undefined,
    });

    const a = await resolveObjectUrl("images/h.jpg");
    const b = await resolveObjectUrl("images/h.jpg");
    expect(a).toBe(b);
    expect(created).toBe(1);
  });
});
