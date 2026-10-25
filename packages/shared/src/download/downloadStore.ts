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

/** 下载阶段。`saving` 是字节已收齐、正在写盘的窗口（大文件写盘也要时间） */
export type DownloadPhase = "downloading" | "saving" | "done" | "failed" | "canceled";

/** 单条下载的进度与结果 */
export interface DownloadEntry {
  phase: DownloadPhase;
  /** 已收字节数。失败时保留，UI 才能显示「在 50% 处失败」而不是回到 0 */
  received: number;
  /** 总字节数；0 表示服务端未给 content-length，进度条走不确定态 */
  total: number;
  /** 落盘位置描述；web 实现返回 null，此处即为 undefined */
  savedPath?: string;
  /** 失败原因的 i18n key —— store 在 UI 层之外，不能自己 t() */
  errorKey?: string;
}

interface DownloadState {
  entries: Record<string, DownloadEntry>;
}

export const useDownloadStore = create<DownloadState>()(() => ({ entries: {} }));

/** messageId → AbortController，取消与「重复点击去重」共用这张表 */
const inflight = new Map<string, AbortController>();

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
 *   文件气泡的下载按钮很容易被连点。
 */
export async function startDownload(
  messageId: string,
  objectKey: string,
  fileName: string,
): Promise<void> {
  if (inflight.has(messageId)) return;

  const ctrl = new AbortController();
  inflight.set(messageId, ctrl);
  patch(messageId, {
    phase: "downloading",
    received: 0,
    total: 0,
    savedPath: undefined,
    errorKey: undefined,
  });

  try {
    const url = await getDownloadUrl(objectKey, fileName);
    const res = await fetch(url, { signal: ctrl.signal });
    // 非 2xx 的响应体是 XML 错误页，存下来等于给用户一个坏文件
    if (!res.ok) throw new Error("http " + res.status);

    const total = Number(res.headers.get("content-length") ?? 0) || 0;
    const mime = res.headers.get("content-type") ?? "application/octet-stream";
    patch(messageId, { total });

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
            patch(messageId, { received });
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
    patch(messageId, { received });

    // 取消是在 read 之间生效的，收齐后再查一次，避免「已 abort 仍落盘」
    if (ctrl.signal.aborted) {
      patch(messageId, { phase: "canceled" });
      return;
    }

    patch(messageId, { phase: "saving" });
    const bytes = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.byteLength;
    }
    const savedPath = await getFileSink().save(bytes, fileName, mime);
    patch(messageId, { phase: "done", savedPath: savedPath ?? undefined });
  } catch (err) {
    if (ctrl.signal.aborted) {
      patch(messageId, { phase: "canceled" });
      return;
    }
    // 断网与预签名 URL 过期都落在这里。必须给出明确的失败态 ——
    // 静默卡在 60% 不动的话，用户分不清是慢还是坏了
    captureException(err, { context: "startDownload" });
    patch(messageId, { phase: "failed", errorKey: "chat.file.downloadFailed" });
  } finally {
    inflight.delete(messageId);
  }
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
