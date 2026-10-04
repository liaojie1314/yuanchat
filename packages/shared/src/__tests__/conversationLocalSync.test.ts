import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  initLocalStore,
  purgeLocalStore,
  localDb,
  putMessages,
  putMedia,
  getMedia,
  listMessagesDesc,
  getConversation,
} from "../localdb";
import {
  persistConversationList,
  hydrateConversationList,
  persistConversationPatch,
  forgetConversation,
} from "../store/conversationLocalSync";
import type { Conversation } from "../store/conversationStore";

function conv(id: string, name = "会话"): Conversation {
  return { id, name, type: "group", unreadCount: 0, isMuted: false };
}

beforeEach(async () => {
  await initLocalStore("conv-sync-test");
});

afterEach(async () => {
  await purgeLocalStore();
});

describe("列表落盘与水合", () => {
  it("落盘后水合回同一批会话", async () => {
    await persistConversationList([conv("a"), conv("b")]);
    expect((await hydrateConversationList()).map((c) => c.id).sort()).toEqual(["a", "b"]);
  });

  it("水合保留服务端 DTO 的全部字段", async () => {
    await persistConversationList([{ ...conv("a"), name: "特定名字", unreadCount: 7 }]);
    const got = (await hydrateConversationList())[0];
    expect(got.name).toBe("特定名字");
    expect(got.unreadCount).toBe(7);
  });

  it("降级模式下落盘与水合都不抛错", async () => {
    await purgeLocalStore();
    await expect(persistConversationList([conv("a")])).resolves.toBeUndefined();
    await expect(hydrateConversationList()).resolves.toEqual([]);
    await initLocalStore("conv-sync-test");
  });

  it("空列表落盘会清空本地（服务端确实回了零会话）", async () => {
    await persistConversationList([conv("a")]);
    await persistConversationList([]);
    expect(await hydrateConversationList()).toEqual([]);
  });
});

// 僵尸会话必须连消息与 blob 一起清掉
describe("僵尸会话清理", () => {
  it("新列表里没有的会话被删掉", async () => {
    await persistConversationList([conv("a"), conv("gone")]);
    await persistConversationList([conv("a")]);
    expect((await hydrateConversationList()).map((c) => c.id)).toEqual(["a"]);
  });

  it("被删会话的本地消息与 blob 一并清掉（否则被踢出群后断网仍能翻历史）", async () => {
    await persistConversationList([conv("kicked")]);
    await putMedia(localDb()!, "grp-img", new ArrayBuffer(100), "image/jpeg");
    await putMessages(localDb()!, [
      { id: "m1", conversationId: "kicked", seq: 1, dto: {}, mediaKeys: ["grp-img"] },
    ]);

    await persistConversationList([]); // 服务端已不含该会话

    expect(await listMessagesDesc(localDb()!, "kicked", 0, 10)).toHaveLength(0);
    expect(await getMedia(localDb()!, "grp-img")).toBeNull();
  });

  it("仍在列表里的会话，其消息不受影响", async () => {
    await persistConversationList([conv("keep"), conv("drop")]);
    await putMessages(localDb()!, [
      { id: "k1", conversationId: "keep", seq: 1, dto: {}, mediaKeys: [] },
      { id: "d1", conversationId: "drop", seq: 1, dto: {}, mediaKeys: [] },
    ]);

    await persistConversationList([conv("keep")]);

    expect(await listMessagesDesc(localDb()!, "keep", 0, 10)).toHaveLength(1);
    expect(await listMessagesDesc(localDb()!, "drop", 0, 10)).toHaveLength(0);
  });

  it("水位不因整表替换而丢失（同一会话再次落盘保留 maxSeq）", async () => {
    await persistConversationList([conv("a")]);
    const before = (await getConversation(localDb()!, "a"))!;
    await persistConversationList([conv("a")]);
    expect(before.maxSeq).toBe(0);

    // 模拟消息到达推进水位后，服务端列表再刷一遍
    await persistConversationPatch("a", conv("a"));
    await new Promise((r) => setTimeout(r, 10));
    const db = localDb()!;
    const tx = db.transaction("conversations", "readwrite");
    const store = tx.objectStore("conversations");
    const cur = await new Promise<Record<string, unknown>>((res) => {
      const r = store.get("a");
      r.onsuccess = () => res(r.result as Record<string, unknown>);
    });
    store.put({ ...cur, maxSeq: 42 });
    await new Promise<void>((res) => {
      tx.oncomplete = () => res();
    });

    await persistConversationList([conv("a")]);

    expect((await getConversation(localDb()!, "a"))!.maxSeq).toBe(42);
  });
});

describe("局部更新与显式遗忘", () => {
  it("persistConversationPatch 更新单条且不抛错", async () => {
    await persistConversationList([conv("a")]);
    persistConversationPatch("a", { ...conv("a"), name: "改名后" });
    await new Promise((r) => setTimeout(r, 10));
    expect((await hydrateConversationList())[0].name).toBe("改名后");
  });

  it("forgetConversation 删会话与其消息（主动退群/解散走它）", async () => {
    await persistConversationList([conv("a")]);
    await putMessages(localDb()!, [
      { id: "m1", conversationId: "a", seq: 1, dto: {}, mediaKeys: [] },
    ]);
    await forgetConversation("a");
    expect(await hydrateConversationList()).toEqual([]);
    expect(await listMessagesDesc(localDb()!, "a", 0, 10)).toHaveLength(0);
  });
});
