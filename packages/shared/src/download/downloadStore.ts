/**
 * 文件下载进度 store —— 应用内下载的唯一真源，三端共用。
 *
 * @description
 * 为什么不直接把预签名 URL 交给浏览器/系统下载管理器（改之前的做法）：
 * 桌面与安卓会跳出应用，Web 端在新标签页里预览，用户看不到进度也不知道文件去哪了。
 * 这里改为 `fetch` 预签名 URL、读 `Response.body` 流自己累计进度，
 * 落盘交给注入的 {@link FileSink}（平台差异收在那一层）。
 *
 * `Content-Length` 属 CORS 安全列表响应头，跨域也读得到，所以进度是**确定性**的；
 * 服务端没给的话退化为不确定态（`total === 0`），不报错。
 */
import { create } from "zustand";
import { getDownloadUrl } from "../api/files";
import { captureException } from "../observability/sentry";
import { getFileSink } from "./fileSink";
import { API_BASE } from "../api/client";
import { localDb } from "../localdb/session";
import { reqDone, txDone, STORE_META } from "../localdb/db";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** 下载阶段。`saving` 是字节已收齐、正在写盘的窗口（大文件写盘也要时间） */
export type DownloadPhase = "downloading" | "saving" | "done" | "failed" | "canceled";

/** 单条下载的进度与结果 */
export interface DownloadEntry {
  phase: DownloadPhase;
  /** 已收字节数。失败时保留，UI 才能显示「在 50% 处失败」而不是回到 0 */
  received: number;
  /** 总字节数；0 表示服务端未给 content-length，进度条走不确定态 */
  total: number;
  /** 原生绝对路径或 Web 授权文件引用；默认浏览器下载时缺省 */
  savedPath?: string;
  /** 保存时对原始下载字节计算的摘要；用于识别用户后来修改的同名文件。 */
  sha256?: string;
  /** 冷启动恢复的结果不再次弹出下载完成通知。 */
  restored?: boolean;
  /** 失败原因的 i18n key —— store 在 UI 层之外，不能自己 t() */
  errorKey?: string;
}

interface DownloadState {
  entries: Record<string, DownloadEntry>;
}

/** 三端下载进度的唯一状态源。 */
export const useDownloadStore = create<DownloadState>()(() => ({ entries: {} }));

/** messageId → AbortController，取消与「重复点击去重」共用这张表 */
const inflight = new Map<string, AbortController>();
const downloadHistory = new Map<string, DownloadEntry[]>();
let downloadGeneration = 0;
let refreshGeneration = 0;
let downloadScope: string | null = null;
const DOWNLOAD_PREFIX = `download:${JSON.stringify(API_BASE)}:`;

/** 兼容旧单条记录，过滤损坏元数据；无摘要记录稍后回到下载入口。 */
function savedCandidates(value: unknown): DownloadEntry[] {
  return (Array.isArray(value) ? value : [value]).filter(
    (entry): entry is DownloadEntry =>
      !!entry &&
      typeof entry === "object" &&
      entry.phase === "done" &&
      typeof entry.savedPath === "string" &&
      Number.isFinite(entry.received) &&
      Number.isFinite(entry.total),
  );
}

/** 目录、文件存在与内容都保持一致才复用；读取失权不能当成文件丢失。 */
async function isValidDownload(entry: DownloadEntry): Promise<boolean> {
  const sink = getFileSink();
  if (!entry.savedPath || !entry.sha256 || !/^[a-f0-9]{64}$/.test(entry.sha256) || !sink.read)
    return false;
  if (sink.isCurrentDirectory && !(await sink.isCurrentDirectory(entry.savedPath))) return false;
  if (sink.exists && !(await sink.exists(entry.savedPath))) return false;
  try {
    return bytesToHex(sha256(await sink.read(entry.savedPath, "downloads"))) === entry.sha256;
  } catch (error) {
    // 检查后也可能被删除，只在第二次确认丢失时降级为重新下载。
    if (sink.exists && !(await sink.exists(entry.savedPath))) return false;
    throw error;
  }
}

/** 目录设置变更后串行核对完成记录并刷新按钮，不搬动或删除旧文件。 */
export async function refreshDownloads(): Promise<void> {
  const generation = downloadGeneration;
  const refresh = ++refreshGeneration;
  for (const [id, candidates] of downloadHistory) {
    const current = useDownloadStore.getState().entries[id];
    if (current?.phase === "downloading" || current?.phase === "saving") continue;
    let selected: DownloadEntry | undefined;
    // 同一消息的实际保存路径按新到旧核对，切回旧目录也能复用带后缀的正确副本。
    for (const candidate of candidates) {
      try {
        if (!(await isValidDownload(candidate))) continue;
      } catch {
        // 当前目录失权时保留候选，用户点击后可看到具体权限错误。
      }
      selected = candidate;
      break;
    }
    if (
      generation !== downloadGeneration ||
      refresh !== refreshGeneration ||
      useDownloadStore.getState().entries[id] !== current
    )
      continue;
    if (selected) patch(id, { ...selected, restored: true });
    else clearDownload(id);
  }
}

/** 只持久化已落盘的完成记录；默认浏览器下载没有可核验结果。 */
async function persistCompletedDownload(
  db: IDBDatabase | null,
  messageId: string,
  entry: DownloadEntry,
): Promise<void> {
  if (!entry.savedPath) return;
  const generation = downloadGeneration;
  const append = (previous: DownloadEntry[]) => [
    entry,
    ...previous.filter((old) => old.savedPath !== entry.savedPath),
  ];
  if (!db) {
    downloadHistory.set(messageId, append(downloadHistory.get(messageId) ?? []));
    return;
  }
  try {
    const tx = db.transaction(STORE_META, "readwrite");
    const store = tx.objectStore(STORE_META);
    const key = DOWNLOAD_PREFIX + messageId;
    const row = await reqDone<{ value: unknown } | undefined>(store.get(key));
    const candidates = append(savedCandidates(row?.value));
    store.put({ key, value: candidates });
    await txDone(tx);
    if (generation === downloadGeneration && db === localDb())
      downloadHistory.set(messageId, candidates);
  } catch (error) {
    // 本地库受限时仍保留本页已落盘结果，不能因此重复下载覆盖用户文件。
    captureException(error, { context: "download.persist" });
    if (generation === downloadGeneration && db === localDb())
      downloadHistory.set(messageId, append(downloadHistory.get(messageId) ?? []));
  }
}

/** 仅移除仍指向本次产物的记录，不能删掉另一窗口刚完成的新下载记录。 */
async function forgetCompletedDownload(
  db: IDBDatabase | null,
  messageId: string,
  savedPath: string,
): Promise<void> {
  if (db === localDb())
    downloadHistory.set(
      messageId,
      (downloadHistory.get(messageId) ?? []).filter((entry) => entry.savedPath !== savedPath),
    );
  if (!db) return;
  try {
    const tx = db.transaction(STORE_META, "readwrite");
    const store = tx.objectStore(STORE_META);
    const key = DOWNLOAD_PREFIX + messageId;
    const row = await reqDone<{ value: unknown } | undefined>(store.get(key));
    const candidates = savedCandidates(row?.value).filter((entry) => entry.savedPath !== savedPath);
    if (candidates.length) store.put({ key, value: candidates });
    else store.delete(key);
    await txDone(tx);
  } catch (error) {
    captureException(error, { context: "download.forget" });
  }
}

/** 登录后恢复本账号、本服务器的完成结果；只把明确不存在的文件视为丢失。 */
export async function restoreDownloads(): Promise<void> {
  const db = localDb();
  const scope = db ? `${db.name}:${API_BASE}` : null;
  if (downloadScope !== scope) resetDownloads();
  downloadScope = scope;
  if (!db) return;
  const generation = downloadGeneration;
  try {
    const rows = await reqDone<Array<{ key: string; value: unknown }>>(
      db
        .transaction(STORE_META)
        .objectStore(STORE_META)
        .getAll(IDBKeyRange.bound(DOWNLOAD_PREFIX, DOWNLOAD_PREFIX + "\uffff")),
    );
    if (generation !== downloadGeneration || db !== localDb()) return;
    for (const { key, value } of rows) {
      downloadHistory.set(key.slice(DOWNLOAD_PREFIX.length), savedCandidates(value));
    }
    await refreshDownloads();
  } catch (error) {
    captureException(error, { context: "download.restore" });
  }
}

/** 登出或切账号时终止在途下载并清空内存；不删除任何已下载文件。 */
export function resetDownloads(): void {
  downloadGeneration += 1;
  downloadScope = null;
  for (const controller of inflight.values()) controller.abort();
  inflight.clear();
  downloadHistory.clear();
  useDownloadStore.setState({ entries: {} });
}

/** 进度写入的最小间隔。不节流的话 100MB 文件每个 chunk 一次 setState 会把 React 打爆 */
const PROGRESS_THROTTLE_MS = 100;

/** 就地合并某条下载的进度字段（无条目时以 downloading 初始态起底） */
function patch(messageId: string, next: Partial<DownloadEntry>): void {
  useDownloadStore.setState((s) => {
    const prev = s.entries[messageId] ?? {
      phase: "downloading" as DownloadPhase,
      received: 0,
      total: 0,
    };
    return { entries: { ...s.entries, [messageId]: { ...prev, ...next } } };
  });
}

/**
 * 开始下载一个对象并落盘。
 *
 * @param messageId 进度条挂在哪条消息下（也是去重与取消的键）
 * @param objectKey 对象键
 * @param fileName 原始文件名；会传给签名接口换取 `Content-Disposition: attachment`
 * @remarks 同一 messageId 已在下载中时**直接返回**，不起第二条请求 ——
 *   文件气泡的下载按钮很容易被连点。inflight/AbortController 必须在**同步段**
 *   就位（首个 await 之前），否则调用方紧接着的 cancelDownload 会扑空。
 */
export async function startDownload(
  messageId: string,
  objectKey: string,
  fileName: string,
): Promise<void> {
  if (inflight.has(messageId)) return;

  const ctrl = new AbortController();
  inflight.set(messageId, ctrl);
  initEntry(messageId);

  try {
    const url = await getDownloadUrl(objectKey, fileName);
    await streamToSink(messageId, url, fileName, ctrl);
  } catch (err) {
    failDownload(messageId, err, ctrl);
  } finally {
    if (inflight.get(messageId) === ctrl) inflight.delete(messageId);
  }
}

/** 打开下载结果或返回 Web 可读位置；文件丢失后重新下载，权限和系统错误交给界面提示。 */
export async function revealDownload(
  messageId: string,
  objectKey: string,
  fileName: string,
): Promise<void | string> {
  const entry = useDownloadStore.getState().entries[messageId];
  const sink = getFileSink();
  const candidates =
    entry?.phase === "done"
      ? [
          entry,
          ...(downloadHistory.get(messageId) ?? []).filter(
            (candidate) => candidate.savedPath !== entry.savedPath,
          ),
        ]
      : (downloadHistory.get(messageId) ?? []);
  if (sink.reveal) {
    for (const candidate of candidates) {
      if (!(await isValidDownload(candidate))) continue;
      try {
        const result = await sink.reveal(candidate.savedPath!);
        if (useDownloadStore.getState().entries[messageId] === entry && candidate !== entry)
          patch(messageId, { ...candidate, restored: true });
        return result;
      } catch (error) {
        // 检查到打开之间也可能被删除；仅确认文件丢失时重下，不能掩盖权限或系统错误。
        if (await isValidDownload(candidate)) throw error;
      }
    }
  }
  await startDownload(messageId, objectKey, fileName);
}

/**
 * 从给定 URL 直接流式下载并落盘 —— OTA 安装包的入口。
 *
 * @description
 * OTA 的源 URL 已由 /updates 端点**预签好**，不能再走 getDownloadUrl 换签
 * （把完整 URL 当对象键传给签名接口只会签出垃圾）。所以把消息附件那条链路的
 * 流式下载核心（进度节流、取消、老 WebView 退 blob、失败态）抽成
 * {@link streamToSink}，本入口与 startDownload 换签完后都委托进来 ——
 * 两条入口共用同一份 store 与进度 UI。
 *
 * @param messageId 进度条挂在哪个键下（OTA 用 `ota-<version>`）
 * @param url 已签名/公开的下载 URL
 * @param fileName 落盘文件名（同名避让在 fileSink 的 downloads 目录里做）
 * @param fetcher 请求实现；Android 的 GitHub 安装包使用原生 HTTP 跨过 CDN 的 CORS 限制
 * @remarks 同一 messageId 已在下载中时直接返回（与 startDownload 同一语义）；
 *   inflight/AbortController 同样在同步段就位，取消语义与 startDownload 一致。
 */
export async function startDownloadFromUrl(
  messageId: string,
  url: string,
  fileName: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (inflight.has(messageId)) return;

  const ctrl = new AbortController();
  inflight.set(messageId, ctrl);
  initEntry(messageId);

  try {
    await streamToSink(messageId, url, fileName, ctrl, fetcher);
  } catch (err) {
    failDownload(messageId, err, ctrl);
  } finally {
    if (inflight.get(messageId) === ctrl) inflight.delete(messageId);
  }
}

/** 以 downloading 起底写一条进度记录，清掉上一次的残留字段（两条入口共用） */
function initEntry(messageId: string): void {
  patch(messageId, {
    phase: "downloading",
    received: 0,
    total: 0,
    savedPath: undefined,
    sha256: undefined,
    restored: undefined,
    errorKey: undefined,
  });
}

/**
 * 下载失败的统一收尾（两条入口共用）。
 *
 * 取消（`ctrl.signal.aborted`）落 canceled；其余（断网、预签名 URL 过期、
 * 非 2xx）落 failed 并带可本地化的错误 key —— 静默卡在 60% 不动的话，
 * 用户分不清是慢还是坏了。
 */
function failDownload(messageId: string, err: unknown, ctrl: AbortController): void {
  if (inflight.get(messageId) !== ctrl) return;
  if (ctrl.signal.aborted) {
    patch(messageId, { phase: "canceled" });
    return;
  }
  captureException(err, { context: "startDownload" });
  const errorKey =
    err instanceof Error &&
    ["download.directoryPermissionRequired", "download.directoryUnsupported"].includes(err.message)
      ? err.message
      : "chat.file.downloadFailed";
  patch(messageId, { phase: "failed", errorKey });
}

/**
 * 流式下载核心：fetch url、按 chunk 累计进度（100ms 节流）、收齐后经
 * fileSink 落盘并置 done。失败直接**抛给入口的 catch** 统一归类，本函数
 * 不自吞错误；唯一的内部提前返回是「read 之间发现已取消」—— 那不是失败，
 * 就地落 canceled 后安静收场。
 */
async function streamToSink(
  messageId: string,
  url: string,
  fileName: string,
  ctrl: AbortController,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const db = localDb();
  const update = (next: Partial<DownloadEntry>) => {
    if (inflight.get(messageId) === ctrl) patch(messageId, next);
  };
  const res = await fetcher(url, { signal: ctrl.signal });
  // 非 2xx 的响应体是 XML 错误页，存下来等于给用户一个坏文件
  if (!res.ok) throw new Error("http " + res.status);

  const total = Number(res.headers.get("content-length") ?? 0) || 0;
  const mime = res.headers.get("content-type") ?? "application/octet-stream";
  update({ total });

  const chunks: Uint8Array[] = [];
  let received = 0;

  if (res.body) {
    const reader = res.body.getReader();
    // 真实 fetch 会在 abort 时让 reader.read() 以 AbortError 拒绝；但流若
    // 长时间不吐 chunk（对端卡住），read() 不会自己醒。主动 cancel 一把，
    // 让挂起的 read 以 { done: true } 收尾，循环得以走到取消分支。
    const onAbort = () => {
      void reader.cancel().catch(() => {
        // cancel 失败不打紧：下方的 aborted 复查兜底
      });
    };
    ctrl.signal.addEventListener("abort", onAbort);
    // AbortSignal 对「已 abort 后才挂上的监听」不再触发 —— 取消发生在
    // await getDownloadUrl / await fetch 期间时走的就是这条路，必须补刀一次
    if (ctrl.signal.aborted) onAbort();
    try {
      let lastWrite = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        const now = Date.now();
        if (now - lastWrite >= PROGRESS_THROTTLE_MS) {
          lastWrite = now;
          update({ received });
        }
      }
    } finally {
      ctrl.signal.removeEventListener("abort", onAbort);
    }
  } else {
    // 老 WebView 没有 ReadableStream 的 body：退 blob，进度走不确定态
    const buf = new Uint8Array(await res.arrayBuffer());
    chunks.push(buf);
    received = buf.byteLength;
  }
  update({ received });

  // 取消是在 read 之间生效的，收齐后再查一次，避免「已 abort 仍落盘」
  if (ctrl.signal.aborted) {
    update({ phase: "canceled" });
    return;
  }

  update({ phase: "saving" });
  const bytes = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.byteLength;
  }
  const sink = getFileSink();
  const savedPath = await sink.save(bytes, fileName, mime, "downloads", ctrl.signal);
  const completed: DownloadEntry = {
    phase: "done",
    received,
    total,
    savedPath: savedPath ?? undefined,
    sha256: savedPath ? bytesToHex(sha256(bytes)) : undefined,
  };
  if (!ctrl.signal.aborted) await persistCompletedDownload(db, messageId, completed);
  // 写盘不能被 AbortController 中断；结束后复查取消，并只清理这次创建的产物。
  if (ctrl.signal.aborted) {
    if (savedPath && sink.remove) {
      await sink.remove(savedPath, "downloads").catch((err) => {
        captureException(err, { context: "cancelDownload.cleanup" });
      });
    }
    if (savedPath) await forgetCompletedDownload(db, messageId, savedPath);
    update({ phase: "canceled" });
    return;
  }
  update(completed);
}

/** 取消下载。已完成或不存在的条目调用无副作用 */
export function cancelDownload(messageId: string): void {
  inflight.get(messageId)?.abort();
}

/** 清掉一条进度记录（用户点掉提示、或离开会话时） */
export function clearDownload(messageId: string): void {
  useDownloadStore.setState((s) => {
    const next = { ...s.entries };
    delete next[messageId];
    return { entries: next };
  });
}
