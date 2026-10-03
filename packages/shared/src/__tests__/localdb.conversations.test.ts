import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  openLocalDb,
  deleteLocalDb,
  putConversations,
  replaceConversations,
  listConversations,
  getConversation,
  patchConversation,
  deleteConversations,
  type LocalConversationRow,
} from "../localdb";

const USER = "conv-test";
let db: IDBDatabase;

/** 造一行会话投影 */
function row(id: string, updatedAt: number, maxSeq = 0): LocalConversationRow {
  return { id, dto: { id, name: "会话" + id }, maxSeq, clearedBeforeSeq: 0, updatedAt };
}

beforeEach(async () => {
  db = (await openLocalDb(USER))!;
});

afterEach(async () => {
  db.close();
  await deleteLocalDb(USER);
});

describe("localdb/conversations", () => {
  it("批量写入后按 updatedAt 降序读出", async () => {
    await putConversations(db, [row("a", 100), row("b", 300), row("c", 200)]);
    const got = await listConversations(db);
    expect(got.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("按 id 单读，不存在返回 null", async () => {
    await putConversations(db, [row("a", 1)]);
    expect((await getConversation(db, "a"))!.id).toBe("a");
    expect(await getConversation(db, "missing")).toBeNull();
  });

  it("整表替换会清掉不在新列表里的旧会话", async () => {
    await putConversations(db, [row("a", 1), row("b", 2)]);
    await replaceConversations(db, [row("b", 5), row("c", 6)]);
    const got = await listConversations(db);
    expect(got.map((r) => r.id).sort()).toEqual(["b", "c"]);
  });

  it("patch 只改给定字段，其余保留", async () => {
    await putConversations(db, [row("a", 1, 10)]);
    await patchConversation(db, "a", { maxSeq: 42 });
    const got = (await getConversation(db, "a"))!;
    expect(got.maxSeq).toBe(42);
    expect(got.updatedAt).toBe(1);
    expect(got.clearedBeforeSeq).toBe(0);
  });

  it("patch 不存在的行是 no-op，不创建幽灵行", async () => {
    await patchConversation(db, "ghost", { maxSeq: 9 });
    expect(await getConversation(db, "ghost")).toBeNull();
    expect(await listConversations(db)).toHaveLength(0);
  });

  it("批量删除", async () => {
    await putConversations(db, [row("a", 1), row("b", 2), row("c", 3)]);
    await deleteConversations(db, ["a", "c"]);
    expect((await listConversations(db)).map((r) => r.id)).toEqual(["b"]);
  });

  it("空数组写入不抛错", async () => {
    await expect(putConversations(db, [])).resolves.toBeUndefined();
    await expect(deleteConversations(db, [])).resolves.toBeUndefined();
  });
});
