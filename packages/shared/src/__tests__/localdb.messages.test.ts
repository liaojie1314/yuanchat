import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  openLocalDb,
  deleteLocalDb,
  putMessages,
  listMessagesDesc,
  maxStoredSeq,
  advanceWatermark,
  type LocalMessageRow,
} from "../localdb";

const USER = "msg-test";
const CONV = "c1";
let db: IDBDatabase;

/** 造一行消息 */
function msg(seq: number, convId = CONV, mediaKeys: string[] = []): LocalMessageRow {
  return { id: convId + "-" + seq, conversationId: convId, seq, dto: { seq }, mediaKeys };
}

beforeEach(async () => {
  db = (await openLocalDb(USER))!;
});

afterEach(async () => {
  db.close();
  await deleteLocalDb(USER);
});

describe("advanceWatermark（纯函数）", () => {
  it("连续则推进水位", () => {
    expect(advanceWatermark(10, 11)).toEqual({ next: 11, gap: false });
  });

  it("跳号则报空洞且水位不动", () => {
    // 这条断言直接钉住「永久丢空洞」缺陷
    expect(advanceWatermark(10, 15)).toEqual({ next: 10, gap: true });
  });

  it("重复帧不动水位也不报空洞", () => {
    expect(advanceWatermark(10, 9)).toEqual({ next: 10, gap: false });
    expect(advanceWatermark(10, 10)).toEqual({ next: 10, gap: false });
  });

  it("水位为 0 时第一条 seq=1 算连续", () => {
    expect(advanceWatermark(0, 1)).toEqual({ next: 1, gap: false });
  });

  it("水位为 0 时第一条 seq>1 算空洞", () => {
    expect(advanceWatermark(0, 7)).toEqual({ next: 0, gap: true });
  });
});

describe("localdb/messages", () => {
  it("写入后按 seq 升序读出", async () => {
    await putMessages(db, [msg(3), msg(1), msg(2)]);
    const got = await listMessagesDesc(db, CONV, 0, 10);
    expect(got.map((m) => m.seq)).toEqual([1, 2, 3]);
  });

  it("beforeSeq 游标向前翻，取最近 limit 条", async () => {
    await putMessages(db, [msg(1), msg(2), msg(3), msg(4), msg(5)]);
    // beforeSeq=4 → 取 seq<4 的最近 2 条 = [2,3]，升序返回
    expect((await listMessagesDesc(db, CONV, 4, 2)).map((m) => m.seq)).toEqual([2, 3]);
  });

  it("beforeSeq<=0 表示从最新开始", async () => {
    await putMessages(db, [msg(1), msg(2), msg(3)]);
    expect((await listMessagesDesc(db, CONV, 0, 2)).map((m) => m.seq)).toEqual([2, 3]);
  });

  it("按会话隔离，不串会话", async () => {
    await putMessages(db, [msg(1, "c1"), msg(1, "c2"), msg(2, "c2")]);
    expect((await listMessagesDesc(db, "c1", 0, 10)).map((m) => m.id)).toEqual(["c1-1"]);
    expect((await listMessagesDesc(db, "c2", 0, 10)).map((m) => m.seq)).toEqual([1, 2]);
  });

  it("maxStoredSeq 取本地最大 seq，空会话为 0", async () => {
    expect(await maxStoredSeq(db, CONV)).toBe(0);
    await putMessages(db, [msg(5), msg(2)]);
    expect(await maxStoredSeq(db, CONV)).toBe(5);
  });

  it("同 id 重复写入是覆盖而非重复行", async () => {
    await putMessages(db, [msg(1)]);
    await putMessages(db, [{ ...msg(1), dto: { seq: 1, edited: true } }]);
    const got = await listMessagesDesc(db, CONV, 0, 10);
    expect(got).toHaveLength(1);
    expect((got[0].dto as { edited?: boolean }).edited).toBe(true);
  });

  it("空数组写入不抛错", async () => {
    await expect(putMessages(db, [])).resolves.toBeUndefined();
  });
});
