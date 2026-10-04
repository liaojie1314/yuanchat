import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  openLocalDb,
  deleteLocalDb,
  enqueueOutbox,
  listOutbox,
  markOutbox,
  settleOutbox,
  expireOutbox,
  dropOutbox,
  listMessagesDesc,
  OUTBOX_EXPIRE_MS,
  type OutboxRow,
  type LocalMessageRow,
} from "../localdb";

const USER = "outbox-test";
const CONV = "c1";
let db: IDBDatabase;

function pending(id: string, createdAt: number, convId = CONV): OutboxRow {
  return {
    clientMsgId: id,
    conversationId: convId,
    payload: { type: "message.send", client_msg_id: id, text: "hi " + id },
    createdAt,
    status: "pending",
    attempts: 0,
  };
}

function confirmed(seq: number): LocalMessageRow {
  return { id: "m" + seq, conversationId: CONV, seq, dto: { seq }, mediaKeys: [] };
}

beforeEach(async () => {
  db = (await openLocalDb(USER))!;
});

afterEach(async () => {
  db.close();
  await deleteLocalDb(USER);
});

describe("过期阈值", () => {
  it("24 小时", () => {
    expect(OUTBOX_EXPIRE_MS).toBe(24 * 3600 * 1000);
  });
});

describe("入队与顺序", () => {
  it("按 createdAt 升序列出（补发顺序）", async () => {
    await enqueueOutbox(db, pending("c", 300));
    await enqueueOutbox(db, pending("a", 100));
    await enqueueOutbox(db, pending("b", 200));
    expect((await listOutbox(db)).map((r) => r.clientMsgId)).toEqual(["a", "b", "c"]);
  });

  it("可按会话过滤", async () => {
    await enqueueOutbox(db, pending("a", 100, "c1"));
    await enqueueOutbox(db, pending("b", 200, "c2"));
    expect((await listOutbox(db, "c2")).map((r) => r.clientMsgId)).toEqual(["b"]);
  });

  it("同 clientMsgId 重复入队是覆盖，不产生两条", async () => {
    await enqueueOutbox(db, pending("a", 100));
    await enqueueOutbox(db, pending("a", 100));
    expect(await listOutbox(db)).toHaveLength(1);
  });
});

describe("状态流转", () => {
  it("markOutbox 改状态并自增 attempts", async () => {
    await enqueueOutbox(db, pending("a", 100));
    await markOutbox(db, "a", "sending");
    let row = (await listOutbox(db))[0];
    expect(row.status).toBe("sending");
    expect(row.attempts).toBe(1);

    await markOutbox(db, "a", "failed");
    row = (await listOutbox(db))[0];
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(2);
  });

  it("mark 不存在的行是 no-op", async () => {
    await expect(markOutbox(db, "ghost", "failed")).resolves.toBeUndefined();
    expect(await listOutbox(db)).toHaveLength(0);
  });
});

describe("settleOutbox —— ack 单事务出队", () => {
  it("出队与落 messages 一起完成", async () => {
    await enqueueOutbox(db, pending("a", 100));
    await settleOutbox(db, "a", confirmed(7));

    expect(await listOutbox(db)).toHaveLength(0);
    const msgs = await listMessagesDesc(db, CONV, 0, 10);
    expect(msgs.map((m) => m.seq)).toEqual([7]);
  });

  it("outbox 行不存在时仍写入 messages（ack 重复到达也要幂等）", async () => {
    await settleOutbox(db, "never-queued", confirmed(9));
    expect((await listMessagesDesc(db, CONV, 0, 10)).map((m) => m.seq)).toEqual([9]);
  });

  // spec §8 要求的事务原子性：落 messages 失败时不能只把 outbox 出队了
  it("落 messages 失败时整体回滚，消息不会两头皆空", async () => {
    await enqueueOutbox(db, pending("a", 100));
    // keyPath 取不到值的行：put 在请求构造阶段就抛 DataError
    const broken = { ...confirmed(7), id: undefined } as unknown as LocalMessageRow;

    await expect(settleOutbox(db, "a", broken)).rejects.toBeTruthy();

    // 关键断言：出队不能生效，否则这条消息彻底消失（发出去了、重启后没了）
    expect((await listOutbox(db)).map((r) => r.clientMsgId)).toEqual(["a"]);
    expect(await listMessagesDesc(db, CONV, 0, 10)).toHaveLength(0);
  });
});

describe("过期", () => {
  it("超 24h 的 pending 与 failed 标为 expired，未超的不动", async () => {
    const now = 1_000_000_000_000;
    await enqueueOutbox(db, pending("old", now - OUTBOX_EXPIRE_MS - 1));
    await enqueueOutbox(db, pending("fresh", now - 1000));
    await enqueueOutbox(db, {
      ...pending("oldFailed", now - OUTBOX_EXPIRE_MS - 1),
      status: "failed",
    });

    expect(await expireOutbox(db, now)).toBe(2);

    const byId = new Map((await listOutbox(db)).map((r) => [r.clientMsgId, r.status]));
    expect(byId.get("old")).toBe("expired");
    expect(byId.get("oldFailed")).toBe("expired");
    expect(byId.get("fresh")).toBe("pending");
  });

  it("expired 不自动删除（用户要能看到并重发或丢弃）", async () => {
    const now = 1_000_000_000_000;
    await enqueueOutbox(db, pending("old", now - OUTBOX_EXPIRE_MS - 1));
    await expireOutbox(db, now);
    expect(await listOutbox(db)).toHaveLength(1);
  });

  it("已 expired 的不重复计数", async () => {
    const now = 1_000_000_000_000;
    await enqueueOutbox(db, { ...pending("old", now - OUTBOX_EXPIRE_MS - 1), status: "expired" });
    expect(await expireOutbox(db, now)).toBe(0);
  });
});

describe("手动丢弃", () => {
  it("dropOutbox 删掉指定行", async () => {
    await enqueueOutbox(db, pending("a", 100));
    await dropOutbox(db, "a");
    expect(await listOutbox(db)).toHaveLength(0);
  });
});
