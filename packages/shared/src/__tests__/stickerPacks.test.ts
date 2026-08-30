/**
 * api/stickers 商城与发布端点单元测试
 *
 * 覆盖请求拼装、信封解包与响应形状校验：
 * - GET    /sticker-packs/market            商城列表（游标透传 + next_cursor 归一）
 * - GET    /sticker-packs/:id               包详情（pack/stickers 形状损坏须抛错）
 * - POST   /sticker-packs/:id/add           添加（幂等）
 * - DELETE /sticker-packs/:id/add           移除
 * - POST   /sticker-packs                   发布（snake_case 来源体）
 * - PATCH  /sticker-packs/:id               编辑
 * - POST   /sticker-packs/:id/stickers      追加贴纸（collection/upload 两种来源）
 * - DELETE /sticker-packs/:id/stickers/:sid 移除贴纸
 * - GET    /sticker-packs/mine              我发布的
 * - DELETE /sticker-packs/:id               删除我发布的包
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listMarketPacks,
  getPackDetail,
  addStickerPack,
  removeStickerPack,
  publishStickerPack,
  updateStickerPack,
  addStickerToPack,
  removeStickerFromPack,
  listMyPacks,
  deleteStickerPack,
} from "../api/stickers";
import { ApiError } from "../api/client";

/** 桩：一次 fetch 成功信封响应（data 自动包进 {code:0,message:"ok"} 信封） */
function mockApiOnce(data: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ code: 0, message: "ok", data }),
    }),
  );
}

/** 桩：一次 fetch 失败信封响应 */
function mockApiError(code: number, message: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      status: 400,
      json: () => Promise.resolve({ code, message, data: null }),
    }),
  );
}

/** 取本次桩 fetch 的第 n 次调用参数 */
function callArgs(n = 0) {
  return (fetch as ReturnType<typeof vi.fn>).mock.calls[n];
}

/** 一个最小可用的商城列表项 */
function marketPack(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    name: "小黄脸",
    cover_url: null,
    owner_name: "阿明",
    is_official: false,
    sticker_count: 8,
    created_at: "2026-08-20T10:00:00Z",
    added: false,
    ...overrides,
  };
}

describe("listMarketPacks", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("GETs the first page without cursor and normalizes next_cursor", async () => {
    mockApiOnce({ packs: [marketPack()], next_cursor: null });

    const page = await listMarketPacks({ limit: 20 });

    expect(callArgs()[0]).toBe("http://localhost:8085/api/v1/sticker-packs/market?limit=20");
    expect(page.packs).toHaveLength(1);
    expect(page.packs[0].added).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it("passes the cursor through as a query param", async () => {
    mockApiOnce({ packs: [], next_cursor: null });

    const page = await listMarketPacks({ cursor: "2026-08-01T00:00:00Z" });

    expect(callArgs()[0]).toContain("cursor=2026-08-01T00%3A00%3A00Z");
    expect(page.packs).toEqual([]);
  });

  it("keeps a non-empty next_cursor for the next page", async () => {
    mockApiOnce({ packs: [marketPack()], next_cursor: "2026-08-19T09:00:00Z" });

    const page = await listMarketPacks();

    expect(page.nextCursor).toBe("2026-08-19T09:00:00Z");
  });

  it("rejects a malformed response instead of pretending the market is empty", async () => {
    mockApiOnce({});
    await expect(listMarketPacks()).rejects.toThrow(/not an array/);
  });
});

describe("getPackDetail", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("GETs /sticker-packs/:id and keeps the detail shape", async () => {
    mockApiOnce({
      pack: {
        id: "p1",
        name: "小黄脸",
        cover_url: null,
        is_official: false,
        owner_name: "阿明",
        is_owner: false,
        sticker_count: 1,
        created_at: "2026-08-20T10:00:00Z",
      },
      stickers: [{ id: "s1", object_key: "images/2026/08/a.png", width: 96, height: 96 }],
      added: true,
    });

    const detail = await getPackDetail("p1");

    expect(callArgs()[0]).toContain("/api/v1/sticker-packs/p1");
    expect(detail.pack.name).toBe("小黄脸");
    expect(detail.pack.is_owner).toBe(false);
    expect(detail.added).toBe(true);
    expect(detail.stickers).toHaveLength(1);
  });

  it("rejects when pack or stickers are malformed", async () => {
    mockApiOnce({});
    await expect(getPackDetail("p1")).rejects.toThrow(/pack is missing/);

    mockApiOnce({ pack: { id: "p1" }, stickers: null });
    await expect(getPackDetail("p1")).rejects.toThrow(/not an array/);
  });
});

describe("add / remove pack", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("POSTs to /sticker-packs/:id/add", async () => {
    mockApiOnce({ message: "added" });
    await addStickerPack("p1");
    const call = callArgs();
    expect(call[0]).toContain("/api/v1/sticker-packs/p1/add");
    expect(call[1].method).toBe("POST");
  });

  it("DELETEs /sticker-packs/:id/add to remove", async () => {
    mockApiOnce({ message: "removed" });
    await removeStickerPack("p1");
    const call = callArgs();
    expect(call[0]).toContain("/api/v1/sticker-packs/p1/add");
    expect(call[1].method).toBe("DELETE");
  });
});

describe("publishStickerPack", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("POSTs snake_case sources and returns the pack detail", async () => {
    mockApiOnce({
      pack: { id: "p9", name: "新包", is_owner: true },
      stickers: [],
      added: false,
    });

    const detail = await publishStickerPack({
      name: "新包",
      cover_object_key: "sticker-covers/2026/08/x.png",
      sticker_sources: [
        { source: "collection", sticker_id: "s1" },
        {
          source: "upload",
          object_key: "images/2026/08/b.png",
          width: 96,
          height: 96,
          content_hash: "a".repeat(64),
        },
      ],
    });

    const call = callArgs();
    expect(call[0]).toContain("/api/v1/sticker-packs");
    expect(call[1].method).toBe("POST");
    const body = JSON.parse(call[1].body);
    expect(body.name).toBe("新包");
    expect(body.sticker_sources[0]).toEqual({ source: "collection", sticker_id: "s1" });
    expect(body.sticker_sources[1].source).toBe("upload");
    expect(detail.pack.id).toBe("p9");
  });

  it("surfaces the publish limit error from the 400 envelope", async () => {
    mockApiError(400, "publish limit exceeded");
    const err = await publishStickerPack({ name: "x", sticker_sources: [] }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe(400);
    expect((err as ApiError).message).toMatch(/publish limit/);
  });
});

describe("updateStickerPack / addStickerToPack / removeStickerFromPack", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("PATCHes only the given fields", async () => {
    mockApiOnce({ pack: { id: "p1", name: "改名" }, stickers: [], added: false });

    await updateStickerPack("p1", { name: "改名" });

    const call = callArgs();
    expect(call[0]).toContain("/api/v1/sticker-packs/p1");
    expect(call[1].method).toBe("PATCH");
    expect(JSON.parse(call[1].body)).toEqual({ name: "改名" });
  });

  it("POSTs a collection source when appending a favorite sticker", async () => {
    mockApiOnce({ message: "added" });

    await addStickerToPack("p1", { source: "collection", sticker_id: "s2" });

    const call = callArgs();
    expect(call[0]).toContain("/api/v1/sticker-packs/p1/stickers");
    expect(JSON.parse(call[1].body)).toEqual({ source: "collection", sticker_id: "s2" });
  });

  it("DELETEs the pack sticker by id", async () => {
    mockApiOnce({ message: "removed" });

    await removeStickerFromPack("p1", "s2");

    expect(callArgs()[0]).toContain("/api/v1/sticker-packs/p1/stickers/s2");
  });
});

describe("listMyPacks / deleteStickerPack", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("GETs /sticker-packs/mine and unwraps the packs array", async () => {
    mockApiOnce({ packs: [marketPack({ is_owner: true })] });

    const packs = await listMyPacks();

    expect(callArgs()[0]).toContain("/api/v1/sticker-packs/mine");
    expect(packs).toHaveLength(1);
    expect(packs[0].is_owner).toBe(true);
  });

  it("rejects a malformed mine response", async () => {
    mockApiOnce({});
    await expect(listMyPacks()).rejects.toThrow(/not an array/);
  });

  it("DELETEs /sticker-packs/:id to delete a published pack", async () => {
    mockApiOnce({ message: "deleted" });

    await deleteStickerPack("p1");

    const call = callArgs();
    expect(call[0]).toContain("/api/v1/sticker-packs/p1");
    expect(call[1].method).toBe("DELETE");
  });
});
