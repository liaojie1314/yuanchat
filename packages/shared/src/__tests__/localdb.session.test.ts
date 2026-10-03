import "fake-indexeddb/auto";
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  initLocalStore,
  localDb,
  closeLocalStore,
  purgeLocalStore,
  putMessages,
  listMessagesDesc,
  dbNameOf,
} from "../localdb";

afterEach(() => {
  closeLocalStore();
  vi.unstubAllGlobals();
});

describe("localdb/session", () => {
  it("未初始化时 localDb() 返回 null", () => {
    expect(localDb()).toBeNull();
  });

  it("初始化成功后 localDb() 返回句柄", async () => {
    expect(await initLocalStore("s1")).toBe(true);
    expect(localDb()).not.toBeNull();
    await purgeLocalStore();
  });

  it("IDB 不可用时初始化返回 false 且 localDb() 仍为 null（降级模式）", async () => {
    vi.stubGlobal("indexedDB", undefined);
    expect(await initLocalStore("s2")).toBe(false);
    expect(localDb()).toBeNull();
  });

  it("切换账号时关旧库开新库，数据不串", async () => {
    await initLocalStore("userA");
    await putMessages(localDb()!, [
      { id: "a1", conversationId: "c", seq: 1, dto: {}, mediaKeys: [] },
    ]);

    await initLocalStore("userB");
    expect(await listMessagesDesc(localDb()!, "c", 0, 10)).toHaveLength(0);

    await initLocalStore("userA");
    expect(await listMessagesDesc(localDb()!, "c", 0, 10)).toHaveLength(1);

    await purgeLocalStore();
    await initLocalStore("userB");
    await purgeLocalStore();
  });

  it("purgeLocalStore 删库并把句柄清成 null", async () => {
    await initLocalStore("s3");
    await putMessages(localDb()!, [
      { id: "x", conversationId: "c", seq: 1, dto: {}, mediaKeys: [] },
    ]);
    await purgeLocalStore();
    expect(localDb()).toBeNull();

    // 库真的没了：重开是空的
    await initLocalStore("s3");
    expect(await listMessagesDesc(localDb()!, "c", 0, 10)).toHaveLength(0);
    await purgeLocalStore();
  });

  it("未初始化时 purgeLocalStore 不抛错", async () => {
    await expect(purgeLocalStore()).resolves.toBeUndefined();
  });

  it("库名走 dbNameOf，便于外部核对", async () => {
    await initLocalStore("s4");
    expect(dbNameOf("s4")).toBe("yuanchat-l1-s4");
    await purgeLocalStore();
  });
});
