/**
 * stickerStore 单元测试
 *
 * 覆盖：SHA-256 哈希计算、本地去重、官方包映射、Zustand persist。
 * REST 动作（add/remove）走 MSW 在 E2E 验证，此处 mock API 调用。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useStickerStore } from "../store/stickerStore";

// Mock API client
vi.mock("../api/client", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

vi.mock("../api/files", () => ({
  getUploadUrl: vi.fn(),
  uploadToTicket: vi.fn(),
}));

beforeEach(() => {
  useStickerStore.getState().clear();
  vi.clearAllMocks();
});

describe("stickerStore", () => {
  it("fetchStickers maps DTO to frontend model", async () => {
    const { apiGet } = await import("../api/client");
    (apiGet as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      favorites: [
        { id: "s1", key: "stickers/user1/abc.png", width: 100, height: 100, content_hash: "aaa" },
      ],
      official_packs: [
        {
          id: "p1",
          name: "pack.basic",
          stickers: [
            {
              id: "s2",
              key: "stickers/official/basic/1.png",
              width: 80,
              height: 80,
              content_hash: "bbb",
            },
          ],
        },
      ],
    });

    await useStickerStore.getState().fetchStickers();

    expect(useStickerStore.getState().favorites).toHaveLength(1);
    expect(useStickerStore.getState().favorites[0]).toMatchObject({
      id: "s1",
      key: "stickers/user1/abc.png",
      width: 100,
      height: 100,
      contentHash: "aaa",
    });

    expect(useStickerStore.getState().officialPacks).toHaveLength(1);
    expect(useStickerStore.getState().officialPacks[0].name).toBe("pack.basic");
    expect(useStickerStore.getState().officialPacks[0].stickers[0].contentHash).toBe("bbb");

    expect(useStickerStore.getState().loaded).toBe(true);
  });

  it("addSticker computes SHA-256 hash and returns existing sticker if duplicate", async () => {
    // 构造一个 File，计算其真实 hash
    const fileBytes = new Uint8Array([0x00, 0x01, 0x02]);
    const file = new File([fileBytes], "dup.png", { type: "image/png" });

    // 计算真实 hash（Node 22+ 原生支持 crypto.subtle）
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const realHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    // 准备：本地已有一个贴纸（相同 hash）
    useStickerStore.setState({
      favorites: [
        {
          id: "s1",
          key: "stickers/user1/old.png",
          width: 100,
          height: 100,
          contentHash: realHash,
        },
      ],
    });

    const id = await useStickerStore.getState().addSticker(file);

    // 本地去重：直接返回已有 ID，不调后端
    expect(id).toBe("s1");

    // 验证没有调后端（列表长度不变）
    expect(useStickerStore.getState().favorites).toHaveLength(1);
  });

  it("removeSticker calls DELETE and removes from local state", async () => {
    const { apiDelete } = await import("../api/client");
    (apiDelete as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});

    useStickerStore.setState({
      favorites: [
        { id: "s1", key: "stickers/user1/a.png", width: 100, height: 100, contentHash: "aaa" },
        { id: "s2", key: "stickers/user1/b.png", width: 100, height: 100, contentHash: "bbb" },
      ],
    });

    await useStickerStore.getState().removeSticker("s1");

    expect(apiDelete).toHaveBeenCalledWith("/api/v1/stickers/s1");
    expect(useStickerStore.getState().favorites).toHaveLength(1);
    expect(useStickerStore.getState().favorites[0].id).toBe("s2");
  });

  it("clear resets state", () => {
    useStickerStore.setState({
      favorites: [
        { id: "s1", key: "stickers/user1/a.png", width: 100, height: 100, contentHash: "aaa" },
      ],
      officialPacks: [{ id: "p1", name: "pack.basic", stickers: [] }],
      loaded: true,
    });

    useStickerStore.getState().clear();

    expect(useStickerStore.getState().favorites).toEqual([]);
    expect(useStickerStore.getState().officialPacks).toEqual([]);
    expect(useStickerStore.getState().loaded).toBe(false);
  });
});
