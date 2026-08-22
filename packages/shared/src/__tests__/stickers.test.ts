/**
 * api/stickers 单元测试
 *
 * 覆盖四个端点的请求拼装与响应映射：
 * - POST   /api/v1/stickers        收藏（object_key/width/height/content_hash）
 * - DELETE /api/v1/stickers/:id    取消收藏
 * - GET    /api/v1/stickers/mine   我的收藏（空数组 vs 结构损坏须区分）
 * - GET    /api/v1/sticker-packs   官方表情包（同上）
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { addSticker, removeSticker, listMyStickers, listStickerPacks } from "../api/stickers";

/** 桩：一次 apiGet/apiPost/apiDelete 信封响应 */
function mockApiOnce(data: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ json: () => Promise.resolve({ code: 0, message: "ok", data }) }),
  );
}

/** 取本次桩 fetch 的第 n 次调用参数 */
function callArgs(n = 0) {
  return (fetch as ReturnType<typeof vi.fn>).mock.calls[n];
}

describe("addSticker", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("POSTs snake_case body and returns the created sticker", async () => {
    mockApiOnce({ id: "s1", object_key: "images/2026/08/a.png", width: 96, height: 96 });

    const result = await addSticker("images/2026/08/a.png", 96, 96, "hash123");

    const call = callArgs();
    expect(call[0]).toContain("/api/v1/stickers");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body)).toEqual({
      object_key: "images/2026/08/a.png",
      width: 96,
      height: 96,
      content_hash: "hash123",
    });
    expect(result).toEqual({
      id: "s1",
      object_key: "images/2026/08/a.png",
      width: 96,
      height: 96,
    });
  });
});

describe("removeSticker", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("sends DELETE to /stickers/:id", async () => {
    mockApiOnce({ message: "removed" });

    await removeSticker("s1");

    const call = callArgs();
    expect(call[0]).toContain("/api/v1/stickers/s1");
    expect(call[1].method).toBe("DELETE");
  });
});

describe("listMyStickers", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("GETs /stickers/mine and unwraps the stickers array", async () => {
    mockApiOnce({ stickers: [{ id: "s1", object_key: "images/x.png", width: 10, height: 10 }] });

    const result = await listMyStickers();

    expect(callArgs()[0]).toContain("/api/v1/stickers/mine");
    expect(result).toEqual([{ id: "s1", object_key: "images/x.png", width: 10, height: 10 }]);
  });

  it("returns an empty array when the user genuinely has no favorites", async () => {
    mockApiOnce({ stickers: [], has_more: false });
    expect(await listMyStickers()).toEqual([]);
  });

  it("rejects a malformed response instead of pretending the list is empty", async () => {
    // 原用例把「字段缺失 → 空数组」写成契约：响应结构损坏时 UI 显示"你没有收藏"，
    // 与真实空列表无从区分（本仓已修的静默失败模式）。现在必须抛错，让面板走错误态+重试。
    mockApiOnce({});
    await expect(listMyStickers()).rejects.toThrow(/not an array/);

    mockApiOnce({ stickers: null });
    await expect(listMyStickers()).rejects.toThrow(/not an array/);
  });
});

describe("listStickerPacks", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("GETs /sticker-packs and keeps pack + stickers nesting", async () => {
    mockApiOnce({
      packs: [
        {
          pack: { id: "p1", name: "默认表情", is_official: true, sort: 0 },
          stickers: [{ id: "s1", object_key: "images/x.png", width: 96, height: 96 }],
        },
      ],
    });

    const result = await listStickerPacks();

    expect(callArgs()[0]).toContain("/api/v1/sticker-packs");
    expect(result).toHaveLength(1);
    expect(result[0].pack.name).toBe("默认表情");
    expect(result[0].pack.is_official).toBe(true);
    expect(result[0].stickers).toHaveLength(1);
  });

  it("returns an empty array when no pack is seeded", async () => {
    mockApiOnce({ packs: [] });
    expect(await listStickerPacks()).toEqual([]);
  });

  it("rejects a malformed response instead of pretending no pack exists", async () => {
    mockApiOnce({});
    await expect(listStickerPacks()).rejects.toThrow(/not an array/);
  });
});
