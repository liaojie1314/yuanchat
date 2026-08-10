/**
 * api/stickers 单元测试：桩 fetch，断言请求方法/路径/请求体与响应映射
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { addSticker, removeSticker, listMyStickers, listStickerPacks } from "../api/stickers";

/** 桩：一次 apiGet/apiPost/apiDelete 信封响应（照 filesApi.test.ts 的 mockApiOnce 惯例） */
function mockApiOnce(data: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ json: () => Promise.resolve({ code: 0, message: "ok", data }) }),
  );
}

describe("stickers api", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("addSticker posts object_key/width/height/content_hash", async () => {
    mockApiOnce({ id: "s1", object_key: "images/2026/08/a.png", width: 96, height: 96 });
    const result = await addSticker("images/2026/08/a.png", 96, 96, "hash123");

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/stickers");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body)).toEqual({
      object_key: "images/2026/08/a.png",
      width: 96,
      height: 96,
      content_hash: "hash123",
    });
    expect(result).toEqual({ id: "s1", object_key: "images/2026/08/a.png", width: 96, height: 96 });
  });

  it("removeSticker sends DELETE to /stickers/:id", async () => {
    mockApiOnce({ message: "removed" });
    await removeSticker("s1");
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/stickers/s1");
    expect(call[1].method).toBe("DELETE");
  });

  it("listMyStickers maps stickers array", async () => {
    mockApiOnce({ stickers: [{ id: "s1", object_key: "images/x.png", width: 10, height: 10 }] });
    const result = await listMyStickers();
    expect(result).toEqual([{ id: "s1", object_key: "images/x.png", width: 10, height: 10 }]);
  });

  it("listStickerPacks maps packs array", async () => {
    mockApiOnce({
      packs: [
        {
          pack: { id: "p1", name: "默认表情", is_official: true, sort: 0 },
          stickers: [{ id: "s1", object_key: "images/x.png", width: 96, height: 96 }],
        },
      ],
    });
    const result = await listStickerPacks();
    expect(result).toHaveLength(1);
    expect(result[0].pack.name).toBe("默认表情");
    expect(result[0].stickers).toHaveLength(1);
  });
});
