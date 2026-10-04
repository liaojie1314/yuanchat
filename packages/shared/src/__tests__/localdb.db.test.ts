import "fake-indexeddb/auto";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  SCHEMA_VERSION,
  dbNameOf,
  openLocalDb,
  deleteLocalDb,
  STORE_CONVERSATIONS,
  STORE_MESSAGES,
  STORE_OUTBOX,
  STORE_MEDIA,
  STORE_META,
} from "../localdb";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("localdb/db", () => {
  it("库名按账号隔离", () => {
    expect(dbNameOf("u1")).toBe("yuanchat-l1-u1");
    expect(dbNameOf("u2")).not.toBe(dbNameOf("u1"));
  });

  it("开库建齐 5 个 store 与索引", async () => {
    const db = await openLocalDb("open-all");
    expect(db).not.toBeNull();
    const names = Array.from(db!.objectStoreNames);
    expect(names.sort()).toEqual(
      [STORE_CONVERSATIONS, STORE_MEDIA, STORE_MESSAGES, STORE_META, STORE_OUTBOX].sort(),
    );
    const tx = db!.transaction(STORE_MESSAGES, "readonly");
    expect(Array.from(tx.objectStore(STORE_MESSAGES).indexNames)).toContain("by_conv_seq");
    db!.close();
    await deleteLocalDb("open-all");
  });

  it("schema 版本号为 1", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  // Review Focus 1：IndexedDB 完全不可用时必须静默降级，不抛错
  it("indexedDB 缺失时返回 null 而不抛错", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(openLocalDb("no-idb")).resolves.toBeNull();
  });

  it("open 抛错时返回 null 而不抛错", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new DOMException("blocked by policy", "SecurityError");
      },
    });
    await expect(openLocalDb("policy-blocked")).resolves.toBeNull();
  });

  it("open 触发 onerror 时返回 null", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        const req: Record<string, unknown> = { error: new Error("quota 0") };
        setTimeout(() => {
          (req.onerror as (e: unknown) => void)?.({ target: req });
        }, 0);
        return req;
      },
    });
    await expect(openLocalDb("quota-zero")).resolves.toBeNull();
  });

  it("降级安装（本地版本更高）时删库重建", async () => {
    // 先用未来版本建库，再用当前版本打开：应当删库重建而不是抛 VersionError
    await new Promise<void>((resolve) => {
      const req = indexedDB.open(dbNameOf("downgrade"), SCHEMA_VERSION + 1);
      req.onupgradeneeded = () => req.result.createObjectStore("legacy");
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
    });
    const db = await openLocalDb("downgrade");
    expect(db).not.toBeNull();
    expect(Array.from(db!.objectStoreNames)).not.toContain("legacy");
    expect(Array.from(db!.objectStoreNames)).toContain(STORE_MESSAGES);
    db!.close();
    await deleteLocalDb("downgrade");
  });
});
