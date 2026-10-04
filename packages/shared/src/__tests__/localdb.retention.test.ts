import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  openLocalDb,
  deleteLocalDb,
  putMessages,
  listMessagesDesc,
  putMedia,
  getMedia,
  mediaBytesTotal,
  dropMessages,
  dropMessagesBelowSeq,
  pruneConversation,
  RETENTION_PER_CONV,
  type LocalMessageRow,
} from "../localdb";

const USER = "retention-test";
const CONV = "c1";
let db: IDBDatabase;

function msg(seq: number, mediaKeys: string[] = []): LocalMessageRow {
  return { id: CONV + "-" + seq, conversationId: CONV, seq, dto: { seq }, mediaKeys };
}

/** 造 n 字节的 buffer */
function buf(n: number): ArrayBuffer {
  return new ArrayBuffer(n);
}

beforeEach(async () => {
  db = (await openLocalDb(USER))!;
});

afterEach(async () => {
  db.close();
  await deleteLocalDb(USER);
});

describe("保留窗口常量", () => {
  it("每会话保留 500 条", () => {
    expect(RETENTION_PER_CONV).toBe(500);
  });
});

describe("dropMessages —— 行与 blob 同生共死", () => {
  it("删消息行时连带删掉它引用的 blob 并扣减账本", async () => {
    await putMedia(db, "k1", buf(100), "image/jpeg");
    await putMessages(db, [msg(1, ["k1"])]);
    expect(await mediaBytesTotal(db)).toBe(100);

    await dropMessages(db, [CONV + "-1"]);

    expect(await listMessagesDesc(db, CONV, 0, 10)).toHaveLength(0);
    expect(await getMedia(db, "k1")).toBeNull();
    expect(await mediaBytesTotal(db)).toBe(0);
  });

  it("一条消息引用多个 key（视频的 key + thumb_key）时全删", async () => {
    await putMedia(db, "v1", buf(50), "video/mp4");
    await putMedia(db, "t1", buf(20), "image/jpeg");
    await putMessages(db, [msg(1, ["v1", "t1"])]);
    await dropMessages(db, [CONV + "-1"]);
    expect(await getMedia(db, "v1")).toBeNull();
    expect(await getMedia(db, "t1")).toBeNull();
    expect(await mediaBytesTotal(db)).toBe(0);
  });

  it("删不存在的 id 是 no-op，不抛错", async () => {
    await expect(dropMessages(db, ["ghost"])).resolves.toBeUndefined();
  });

  it("空数组不抛错", async () => {
    await expect(dropMessages(db, [])).resolves.toBeUndefined();
  });
});

describe("dropMessagesBelowSeq —— 清空聊天记录水位", () => {
  it("删掉 seq <= 水位的消息与 blob", async () => {
    await putMedia(db, "k1", buf(10), "image/jpeg");
    await putMedia(db, "k3", buf(30), "image/jpeg");
    await putMessages(db, [msg(1, ["k1"]), msg(2), msg(3, ["k3"])]);

    const n = await dropMessagesBelowSeq(db, CONV, 2);

    expect(n).toBe(2);
    expect((await listMessagesDesc(db, CONV, 0, 10)).map((m) => m.seq)).toEqual([3]);
    expect(await getMedia(db, "k1")).toBeNull();
    expect(await getMedia(db, "k3")).not.toBeNull();
    expect(await mediaBytesTotal(db)).toBe(30);
  });

  it("水位为 0 时不删任何东西", async () => {
    await putMessages(db, [msg(1), msg(2)]);
    expect(await dropMessagesBelowSeq(db, CONV, 0)).toBe(0);
    expect(await listMessagesDesc(db, CONV, 0, 10)).toHaveLength(2);
  });
});

// 这组用例要验证 500 条保留窗口的边界，必须真的写进 499/500/501 条行，
// 条数不能缩。fake-indexeddb 批量写本就慢，再叠上 coverage 插桩会更慢，
// 默认 5s 在 CI runner 上不够用（曾只在远程 Coverage gate 这一步超时），
// 故整组显式放宽超时。
describe("pruneConversation —— 保留窗口边界", () => {
  it("499 条不淘汰", async () => {
    await putMessages(
      db,
      Array.from({ length: 499 }, (_, i) => msg(i + 1)),
    );
    expect(await pruneConversation(db, CONV)).toBe(0);
  });

  it("恰好 500 条不淘汰", async () => {
    await putMessages(
      db,
      Array.from({ length: 500 }, (_, i) => msg(i + 1)),
    );
    expect(await pruneConversation(db, CONV)).toBe(0);
  });

  it("501 条淘汰最老的 1 条，留下的是最近 500 条", async () => {
    await putMessages(
      db,
      Array.from({ length: 501 }, (_, i) => msg(i + 1)),
    );
    expect(await pruneConversation(db, CONV)).toBe(1);
    const left = await listMessagesDesc(db, CONV, 0, 1000);
    expect(left).toHaveLength(500);
    expect(left[0].seq).toBe(2);
    expect(left[499].seq).toBe(501);
  });

  it("淘汰走 dropMessages，连带删 blob（撤回后不留孤儿的前提）", async () => {
    await putMedia(db, "old", buf(70), "image/jpeg");
    const rows = Array.from({ length: 501 }, (_, i) => msg(i + 1));
    rows[0] = msg(1, ["old"]);
    await putMessages(db, rows);
    await pruneConversation(db, CONV);
    expect(await getMedia(db, "old")).toBeNull();
    expect(await mediaBytesTotal(db)).toBe(0);
  });

  it("E2EE 占位行同样参与淘汰，不豁免", async () => {
    // 占位行的特征只是 dto 里没有正文，行本身与普通消息一视同仁
    const rows = Array.from({ length: 501 }, (_, i) => ({
      ...msg(i + 1),
      dto: { seq: i + 1, message_type: 7 },
    }));
    await putMessages(db, rows);
    expect(await pruneConversation(db, CONV)).toBe(1);
  });
}, 60_000);
