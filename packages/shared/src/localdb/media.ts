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

/** 媒体缓存全局配额（200MB）。 */
export const MEDIA_QUOTA_BYTES = 200 * 1024 * 1024;

/** 触发淘汰时删到配额的这个比例（留出余量，避免刚淘汰完又立刻超限）。 */
export const MEDIA_EVICT_TARGET = 0.8;

/**
 * 按 lastAccessAt 升序（最久未访问优先）淘汰到 targetBytes 以下，返回释放字节数。
 *
 * 用游标逐条删而不是先 getAll：getAll 会把所有 blob 的字节一起读进内存，
 * 200MB 配额下等于瞬间吃掉 200MB 堆。
 */
export async function evictMediaTo(db: IDBDatabase, targetBytes: number): Promise<number> {
  const total = await mediaBytesTotal(db);
  if (total <= targetBytes) return 0;

  const tx = db.transaction([STORE_MEDIA, STORE_META], "readwrite");
  const idx = tx.objectStore(STORE_MEDIA).index("by_access");
  let freed = 0;
  await new Promise<void>((resolve, reject) => {
    const req = idx.openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (cur === null || total - freed <= targetBytes) {
        resolve();
        return;
      }
      freed += (cur.value as MediaRow).bytes;
      cur.delete();
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
  if (freed > 0) bumpBytes(tx, -freed);
  await txDone(tx);
  return freed;
}

/**
 * 对外的媒体写入入口，带三段降级。返回是否最终缓存成功。
 *
 * **缓存失败绝不能升级成功能失败** —— 拿不到本地副本时调用方照常走网络，
 * 用户看不出区别。因此本函数吞掉所有异常、只用返回值表达结果。
 *
 * 超配额时**先主动淘汰再写**，不等浏览器抛 QuotaExceededError：浏览器给单
 * origin 的配额可能远小于 200MB，主动控制比被动接错更可预测。
 */
export async function cacheMedia(
  db: IDBDatabase,
  objectKey: string,
  bufData: ArrayBuffer,
  mimeType: string,
): Promise<boolean> {
  const target = Math.floor(MEDIA_QUOTA_BYTES * MEDIA_EVICT_TARGET);
  try {
    const total = await mediaBytesTotal(db);
    if (total + bufData.byteLength > MEDIA_QUOTA_BYTES) {
      await evictMediaTo(db, Math.max(0, target - bufData.byteLength));
    }
    await putMedia(db, objectKey, bufData, mimeType);
    return true;
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    if (name !== "QuotaExceededError") return false;
    // 第二段：淘汰后重试一次
    try {
      await evictMediaTo(db, target);
      await putMedia(db, objectKey, bufData, mimeType);
      return true;
    } catch {
      // 第三段：放弃缓存，调用方走网络
      return false;
    }
  }
}

/** 读出媒体并重建 Blob（IDB 里存的是 ArrayBuffer），未命中返回 null。 */
export async function readMediaBlob(db: IDBDatabase, objectKey: string): Promise<Blob | null> {
  const row = await getMedia(db, objectKey);
  if (row === null) return null;
  return new Blob([row.buf], { type: row.mimeType });
}
