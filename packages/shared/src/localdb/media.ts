/**
 * 媒体缓存的本地读写。
 *
 * 本文件只提供最小读写与配额账本，LRU 淘汰与 QuotaExceededError 三段降级
 * 由同目录的配额逻辑在其上补齐（签名不变）。
 */
import { reqDone, txDone, STORE_MEDIA, STORE_META } from "./db";
import type { MediaRow } from "./types";

/** 配额账本在 meta store 里的 key */
export const META_MEDIA_BYTES = "mediaBytesTotal";

/**
 * 读配额账本。
 *
 * 账本单独记一行、**不靠遍历 media store 求和**：IDB 无聚合能力，
 * 为算个总量逐行累加几千条 blob 记录在移动端是明显的卡顿源。
 */
export async function mediaBytesTotal(db: IDBDatabase): Promise<number> {
  const tx = db.transaction(STORE_META, "readonly");
  const got = await reqDone<{ key: string; value: number } | undefined>(
    tx.objectStore(STORE_META).get(META_MEDIA_BYTES) as IDBRequest<
      { key: string; value: number } | undefined
    >,
  );
  return got === undefined ? 0 : got.value;
}

/** 在已打开的事务里调整账本（增量维护，正负皆可）。 */
export function bumpBytes(tx: IDBTransaction, delta: number): void {
  const store = tx.objectStore(STORE_META);
  const req = store.get(META_MEDIA_BYTES) as IDBRequest<{ key: string; value: number } | undefined>;
  req.onsuccess = () => {
    const cur = req.result === undefined ? 0 : req.result.value;
    const next = cur + delta;
    store.put({ key: META_MEDIA_BYTES, value: next < 0 ? 0 : next });
  };
}

/**
 * 写入一份媒体缓存。
 *
 * 同 objectKey 重复写入是**幂等覆盖**：账本按「新字节数 - 旧字节数」调整，
 * 不重复累加（两个标签页或同页两处同时渲染同一张图会真实触发这条路径）。
 */
export async function putMedia(
  db: IDBDatabase,
  objectKey: string,
  bufData: ArrayBuffer,
  mimeType: string,
): Promise<void> {
  const tx = db.transaction([STORE_MEDIA, STORE_META], "readwrite");
  const store = tx.objectStore(STORE_MEDIA);
  const prev = await reqDone<MediaRow | undefined>(
    store.get(objectKey) as IDBRequest<MediaRow | undefined>,
  );
  const prevBytes = prev === undefined ? 0 : prev.bytes;
  const row: MediaRow = {
    objectKey,
    buf: bufData,
    mimeType,
    bytes: bufData.byteLength,
    lastAccessAt: Date.now(),
  };
  store.put(row);
  bumpBytes(tx, row.bytes - prevBytes);
  await txDone(tx);
}

/** 读一份媒体缓存并刷新其访问时间（LRU 依据），未命中返回 null。 */
export async function getMedia(db: IDBDatabase, objectKey: string): Promise<MediaRow | null> {
  const tx = db.transaction(STORE_MEDIA, "readwrite");
  const store = tx.objectStore(STORE_MEDIA);
  const got = await reqDone<MediaRow | undefined>(
    store.get(objectKey) as IDBRequest<MediaRow | undefined>,
  );
  if (got === undefined) {
    await txDone(tx);
    return null;
  }
  store.put({ ...got, lastAccessAt: Date.now() });
  await txDone(tx);
  return got;
}
