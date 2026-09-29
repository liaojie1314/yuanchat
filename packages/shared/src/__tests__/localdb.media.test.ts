import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  openLocalDb,
  deleteLocalDb,
  putMedia,
  getMedia,
  mediaBytesTotal,
  evictMediaTo,
  cacheMedia,
  readMediaBlob,
  MEDIA_QUOTA_BYTES,
  MEDIA_EVICT_TARGET,
} from "../localdb";

const USER = "media-test";
let db: IDBDatabase;

function buf(n: number): ArrayBuffer {
  return new ArrayBuffer(n);
}

beforeEach(async () => {
  db = (await openLocalDb(USER))!;
});

afterEach(async () => {
  db.close();
  await deleteLocalDb(USER);
  vi.restoreAllMocks();
});

describe("配额常量", () => {
  it("200MB 配额，淘汰到 80% 水位", () => {
    expect(MEDIA_QUOTA_BYTES).toBe(200 * 1024 * 1024);
    expect(MEDIA_EVICT_TARGET).toBe(0.8);
  });
});

describe("读写与账本", () => {
  it("写入后可读回，字节数进账本", async () => {
    await putMedia(db, "k1", buf(1000), "image/jpeg");
    const got = await getMedia(db, "k1");
    expect(got!.bytes).toBe(1000);
    expect(got!.mimeType).toBe("image/jpeg");
    expect(await mediaBytesTotal(db)).toBe(1000);
  });

  it("未命中返回 null", async () => {
    expect(await getMedia(db, "nope")).toBeNull();
    expect(await readMediaBlob(db, "nope")).toBeNull();
  });

  it("readMediaBlob 用 ArrayBuffer 重建 Blob 并带上 mimeType", async () => {
    await putMedia(db, "k1", buf(64), "audio/webm");
    const blob = await readMediaBlob(db, "k1");
    expect(blob).toBeInstanceOf(Blob);
    expect(blob!.type).toBe("audio/webm");
    expect(blob!.size).toBe(64);
  });

  // Review Focus 5：同 key 并发两次写入，账本不能重复累加
  it("同 key 重复写入是幂等覆盖，账本不重复累加", async () => {
    await putMedia(db, "same", buf(500), "image/jpeg");
    await putMedia(db, "same", buf(500), "image/jpeg");
    expect(await mediaBytesTotal(db)).toBe(500);
  });

  it("同 key 并发写入（Promise.all）账本仍收敛到单份字节数", async () => {
    await Promise.all([
      putMedia(db, "race", buf(300), "image/jpeg"),
      putMedia(db, "race", buf(300), "image/jpeg"),
    ]);
    expect(await mediaBytesTotal(db)).toBe(300);
  });

  it("同 key 换成更大的内容，账本按差值调整", async () => {
    await putMedia(db, "grow", buf(100), "image/jpeg");
    await putMedia(db, "grow", buf(400), "image/jpeg");
    expect(await mediaBytesTotal(db)).toBe(400);
  });

  it("getMedia 会刷新 lastAccessAt（LRU 依据）", async () => {
    await putMedia(db, "k1", buf(10), "image/jpeg");
    const before = (await getMedia(db, "k1"))!.lastAccessAt;
    await new Promise((r) => setTimeout(r, 5));
    await getMedia(db, "k1");
    const after = (await getMedia(db, "k1"))!.lastAccessAt;
    expect(after).toBeGreaterThan(before);
  });
});

describe("LRU 淘汰", () => {
  it("按 lastAccessAt 升序删到目标水位", async () => {
    await putMedia(db, "old", buf(100), "image/jpeg");
    await new Promise((r) => setTimeout(r, 5));
    await putMedia(db, "mid", buf(100), "image/jpeg");
    await new Promise((r) => setTimeout(r, 5));
    await putMedia(db, "new", buf(100), "image/jpeg");

    const freed = await evictMediaTo(db, 150);

    expect(freed).toBe(200);
    expect(await getMedia(db, "old")).toBeNull();
    expect(await getMedia(db, "mid")).toBeNull();
    expect(await getMedia(db, "new")).not.toBeNull();
    expect(await mediaBytesTotal(db)).toBe(100);
  });

  it("已在水位内则不删任何东西", async () => {
    await putMedia(db, "k1", buf(50), "image/jpeg");
    expect(await evictMediaTo(db, 100)).toBe(0);
    expect(await getMedia(db, "k1")).not.toBeNull();
  });

  it("刚被读过的不会先被淘汰", async () => {
    await putMedia(db, "a", buf(100), "image/jpeg");
    await new Promise((r) => setTimeout(r, 5));
    await putMedia(db, "b", buf(100), "image/jpeg");
    await new Promise((r) => setTimeout(r, 5));
    await getMedia(db, "a"); // a 变成最近访问
    await evictMediaTo(db, 100);
    expect(await getMedia(db, "a")).not.toBeNull();
    expect(await getMedia(db, "b")).toBeNull();
  });
});

describe("cacheMedia 三段降级", () => {
  it("正常路径返回 true", async () => {
    expect(await cacheMedia(db, "ok", buf(10), "image/jpeg")).toBe(true);
    expect(await getMedia(db, "ok")).not.toBeNull();
  });

  it("超配额时先主动淘汰再写，不等浏览器抛错", async () => {
    // 塞满到配额，再写一份新的：老的应被淘汰、新的应写进去
    await putMedia(db, "filler", buf(MEDIA_QUOTA_BYTES), "image/jpeg");
    expect(await cacheMedia(db, "fresh", buf(1024), "image/jpeg")).toBe(true);
    expect(await getMedia(db, "filler")).toBeNull();
    expect(await getMedia(db, "fresh")).not.toBeNull();
  });

  it("QuotaExceededError 首次抛出后淘汰重试，第二次成功则返回 true", async () => {
    let calls = 0;
    const realOpen = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementation(((...args: unknown[]) => {
      calls++;
      if (calls === 1) {
        throw new DOMException("quota", "QuotaExceededError");
      }
      return (realOpen as (...a: unknown[]) => IDBTransaction)(...args);
    }) as typeof db.transaction);

    expect(await cacheMedia(db, "retry", buf(10), "image/jpeg")).toBe(true);
  });

  it("重试后仍 QuotaExceededError 则返回 false 而不抛", async () => {
    vi.spyOn(db, "transaction").mockImplementation((() => {
      throw new DOMException("quota", "QuotaExceededError");
    }) as typeof db.transaction);

    await expect(cacheMedia(db, "hopeless", buf(10), "image/jpeg")).resolves.toBe(false);
  });

  it("非配额类错误也返回 false，不向上抛（缓存失败不能升级成功能失败）", async () => {
    vi.spyOn(db, "transaction").mockImplementation((() => {
      throw new DOMException("boom", "UnknownError");
    }) as typeof db.transaction);

    await expect(cacheMedia(db, "broken", buf(10), "image/jpeg")).resolves.toBe(false);
  });
});
