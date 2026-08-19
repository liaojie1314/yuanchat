import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { listMyStickers, addSticker, removeSticker, listStickerPacks } from "../api/stickers";
import { hashBlob } from "../api/files";
import { authStore } from "../store/authStore";

describe("Stickers API", () => {
  beforeAll(async () => {
    // 集成测试需要真实 token，从环境变量或跳过
    const token = process.env.TEST_TOKEN;
    if (!token) {
      console.warn("No TEST_TOKEN, skipping sticker integration tests");
      return;
    }
    authStore.getState().login({
      token,
      userId: "test-user",
      nickname: "Test",
      avatar: null,
    });
  });

  afterAll(() => {
    if (process.env.TEST_TOKEN) {
      authStore.getState().logout();
    }
  });

  it("should list my stickers (empty initially)", async () => {
    if (!process.env.TEST_TOKEN) return;
    const list = await listMyStickers();
    expect(Array.isArray(list)).toBe(true);
  });

  it("should list official sticker packs", async () => {
    if (!process.env.TEST_TOKEN) return;
    const packs = await listStickerPacks();
    expect(Array.isArray(packs)).toBe(true);
  });

  it("should add and remove a sticker", async () => {
    if (!process.env.TEST_TOKEN) return;
    // 创建测试用 Blob（1x1 透明 PNG）
    const blob = new Blob(
      [
        new Uint8Array([
          137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8,
          6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0,
          1, 13, 10, 46, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
        ]),
      ],
      { type: "image/png" },
    );
    const hash = await hashBlob(blob);
    const added = await addSticker({
      object_key: "test-sticker.png",
      width: 120,
      height: 120,
      content_hash: hash,
    });
    expect(added.id).toBeTruthy();
    await removeSticker(added.id);
  });
});
