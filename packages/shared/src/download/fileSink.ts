import { captureException } from "../observability/sentry";
import { loadBrowserDownloadDirectory, type BrowserDownloadDirectory } from "./browserDirectory";
import { API_BASE } from "../api/client";
import { localDb } from "../localdb/session";
import { reqDone, txDone, STORE_META } from "../localdb/db";

/** 落盘目标目录：下载产物或应用数据。 */
export type SinkDir = "downloads" | "appdata";

/** 桌面下载目录的实际路径与是否为用户自定义目录。 */
export interface DownloadDirectory {
  path: string;
  custom: boolean;
}

/** 跨平台文件落盘能力，由各平台在启动时按需注入。 */
export interface FileSink {
  /**
   * 写入字节。
   * @returns 原生绝对路径或 Web 授权文件的本页引用；浏览器默认下载返回 `null`。
   */
  save(
    bytes: Uint8Array,
    fileName: string,
    mime: string,
    dir?: SinkDir,
    signal?: AbortSignal,
  ): Promise<string | null>;
  /** 读回已落盘的字节，供发送重试使用。 */
  read?(fileName: string, dir: SinkDir): Promise<Uint8Array>;
  /** 删除已落盘的文件；downloads 接收 save 返回的路径或引用，appdata 使用副本键。 */
  remove?(fileName: string, dir: SinkDir): Promise<void>;
  /** 检查落盘文件是否仍存在；读取权限等错误应抛出，不得当成文件丢失。 */
  exists?(path: string): Promise<boolean>;
  /** 判断保存结果是否属于当前配置的下载目录；切目录后旧文件保持原位。 */
  isCurrentDirectory?(path: string): Promise<boolean>;
  /** 将保存结果转换成用户可读的位置；Web 内部引用不得直接展示。 */
  describe?(path: string): string | undefined;
  /** 桌面显示文件夹、移动端打开文件；Web 返回可读保存位置供界面展示。 */
  reveal?(path: string): Promise<void | string>;
  /** 打开操作的目标，用于区分文件夹、文件与 Web 保存位置的提示。 */
  revealTarget?: "folder" | "file" | "location";
  /** 桌面目录设置由原生层保存和授权；移动端不提供此能力。 */
  downloadDirectory?: {
    get(): Promise<DownloadDirectory>;
    choose(): Promise<DownloadDirectory | null>;
    reset(): Promise<DownloadDirectory>;
  };
}

interface BrowserSavedFile {
  directory: BrowserDownloadDirectory;
  file: FileSystemFileHandle;
  name: string;
  snapshot: Pick<File, "size" | "lastModified">;
  scope: string;
}

// 内存只是句柄缓存；磁盘记录在账号本地库中，服务器键避免不同后端串位。
const browserSavedFiles = new Map<string, BrowserSavedFile>();
const savedFileKey = (path: string) => `download-file:${JSON.stringify(API_BASE)}:${path}`;
const savedFileScope = () => `${localDb()?.name ?? "session"}:${API_BASE}`;

/** 从当前账号、服务器的本地库恢复句柄；不改动当前下载目录偏好。 */
async function loadBrowserSavedFile(path: string): Promise<BrowserSavedFile | undefined> {
  const cached = browserSavedFiles.get(path);
  if (cached?.scope === savedFileScope()) return cached;
  const db = localDb();
  if (!db) return undefined;
  const row = await reqDone<{ value: BrowserSavedFile } | undefined>(
    db.transaction(STORE_META).objectStore(STORE_META).get(savedFileKey(path)),
  );
  if (!row?.value || row.value.scope !== savedFileScope()) return undefined;
  browserSavedFiles.set(path, row.value);
  return row.value;
}

/** 只保存句柄和文件版本信息，不在本地库里再复制一份附件字节。 */
async function persistBrowserSavedFile(
  db: IDBDatabase | null,
  path: string,
  saved: BrowserSavedFile,
): Promise<void> {
  if (!db) return;
  try {
    const tx = db.transaction(STORE_META, "readwrite");
    tx.objectStore(STORE_META).put({ key: savedFileKey(path), value: saved });
    await txDone(tx);
  } catch (error) {
    captureException(error, { context: "browserFileSink.persist" });
  }
}

/** 查询既有授权；下载与查看位置均不主动唤起浏览器权限气泡。 */
async function requireDirectoryPermission(directory: BrowserDownloadDirectory): Promise<void> {
  if ((await directory.queryPermission({ mode: "readwrite" })) !== "granted") {
    throw new Error("download.directoryPermissionRequired");
  }
}

/** 只删除仍属于本次写入的产物，保留用户后来替换或修改的文件。 */
async function removeBrowserSavedFile(saved: BrowserSavedFile): Promise<void> {
  try {
    const current = await saved.directory.getFileHandle(saved.name);
    if (!(await current.isSameEntry(saved.file))) return;
    const snapshot = await current.getFile();
    if (
      snapshot.lastModified !== saved.snapshot.lastModified ||
      snapshot.size !== saved.snapshot.size
    )
      return;
    await saved.directory.removeEntry(saved.name);
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
  }
}

/** Web 优先写用户授权目录；未设置目录时使用浏览器默认保存方式。 */
const webSink: FileSink = {
  revealTarget: "location",
  async isCurrentDirectory(path) {
    const saved = await loadBrowserSavedFile(path);
    const current = await loadBrowserDownloadDirectory();
    return !!saved && !!current && current.isSameEntry(saved.directory);
  },
  async read(path, dir) {
    if (dir === "appdata") throw new Error("no disk sink");
    const saved = await loadBrowserSavedFile(path);
    if (!saved) throw new DOMException("missing", "NotFoundError");
    try {
      await requireDirectoryPermission(saved.directory);
      const current = await saved.directory.getFileHandle(saved.name);
      if (!(await current.isSameEntry(saved.file)))
        throw new DOMException("missing", "NotFoundError");
      return new Uint8Array(await (await current.getFile()).arrayBuffer());
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        throw Object.assign(new Error("download.directoryPermissionRequired"), { cause: error });
      }
      throw error;
    }
  },
  describe(path) {
    const saved = browserSavedFiles.get(path);
    return saved?.scope === savedFileScope()
      ? `${saved.directory.name} / ${saved.name}`
      : undefined;
  },
  async exists(path) {
    const saved = await loadBrowserSavedFile(path);
    if (!saved) return false;
    try {
      await requireDirectoryPermission(saved.directory);
      // 某些浏览器句柄会跟随改名；必须按已记录的目录与实际文件名检查原路径。
      const current = await saved.directory.getFileHandle(saved.name);
      if (!(await current.isSameEntry(saved.file))) return false;
      await current.getFile();
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") return false;
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        throw Object.assign(new Error("download.directoryPermissionRequired"), { cause: error });
      }
      throw error;
    }
  },
  async reveal(path) {
    if (!(await webSink.exists!(path))) throw new DOMException("missing", "NotFoundError");
    return webSink.describe!(path);
  },
  async remove(path, dir) {
    if (dir === "appdata") return;
    const saved = browserSavedFiles.get(path) ?? (await loadBrowserSavedFile(path));
    if (!saved) return;
    await removeBrowserSavedFile(saved);
    browserSavedFiles.delete(path);
    const db = localDb();
    if (db && saved.scope === savedFileScope()) {
      const tx = db.transaction(STORE_META, "readwrite");
      tx.objectStore(STORE_META).delete(savedFileKey(path));
      await txDone(tx);
    }
  },
  async save(bytes, fileName, mime, dir = "downloads", signal) {
    // Web 只支持读取用户授权的下载结果，发送队列仍由原有浏览器缓存管理。
    if (dir === "appdata") return null;
    const db = localDb();
    const scope = savedFileScope();
    const directory = dir === "downloads" ? await loadBrowserDownloadDirectory() : null;
    // 读取目录偏好时也可能取消，默认浏览器保存必须同样尊重取消结果。
    if (signal?.aborted) throw new DOMException("canceled", "AbortError");
    if (directory) {
      await requireDirectoryPermission(directory);
      if (!navigator.locks?.request) throw new Error("download.directoryUnsupported");
      // 同源多窗口共用锁，检查重名与创建文件必须在同一个占名窗口内完成。
      return navigator.locks
        .request("yuanchat-downloads", async () => {
          if (signal?.aborted) throw new DOMException("canceled", "AbortError");
          const taken = new Set<string>();
          let name = fileName;
          for (let attempt = 0; ; attempt += 1) {
            if (attempt >= 1000) throw new Error("no available download filename");
            try {
              await directory.getFileHandle(name);
            } catch (error) {
              if (error instanceof DOMException && error.name === "NotFoundError") break;
              // 同名子目录也要避让，不能覆盖它或把它当成未占用的文件名。
              if (!(error instanceof DOMException) || error.name !== "TypeMismatchError")
                throw error;
            }
            taken.add(name);
            name = uniqueFileName(fileName, (candidate) => taken.has(candidate));
          }
          const file = await directory.getFileHandle(name, { create: true });
          const { size, lastModified } = await file.getFile();
          const saved: BrowserSavedFile = {
            directory,
            file,
            name,
            snapshot: { size, lastModified },
            scope,
          };
          let writer: FileSystemWritableFileStream | undefined;
          const abort = () => {
            void writer?.abort().catch(() => {});
          };
          try {
            writer = await file.createWritable();
            signal?.addEventListener("abort", abort);
            if (signal?.aborted) throw new DOMException("canceled", "AbortError");
            await writer.write(bytes);
            await writer.close();
            const snapshot = await file.getFile();
            saved.snapshot = { size: snapshot.size, lastModified: snapshot.lastModified };
            if (signal?.aborted) throw new DOMException("canceled", "AbortError");
          } catch (error) {
            await writer?.abort().catch(() => {});
            // 只清理本次占名得到的产物，目录设置改变也不能误删其他目录的文件。
            await removeBrowserSavedFile(saved).catch((cleanupError) => {
              captureException(cleanupError, { context: "browserFileSink.cleanup" });
            });
            throw error;
          } finally {
            signal?.removeEventListener("abort", abort);
          }
          const reference = `browser-download:${crypto.getRandomValues(new Uint32Array(4)).join("-")}`;
          browserSavedFiles.set(reference, saved);
          await persistBrowserSavedFile(db, reference, saved);
          return reference;
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "NotAllowedError") {
            throw new Error("download.directoryPermissionRequired");
          }
          throw error;
        });
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.rel = "noopener";
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
    return null;
  },
};

let sink: FileSink | null = null;

/** 注入当前平台的文件落盘实现。 */
export function setFileSink(implementation: FileSink): void {
  sink = implementation;
}

/** 获取当前文件落盘实现；未注入时返回 Web 默认实现。 */
export function getFileSink(): FileSink {
  return sink ?? webSink;
}

/** 测试辅助：还原未注入状态。 */
export function __resetFileSink(): void {
  sink = null;
  browserSavedFiles.clear();
}

/**
 * 返回未被占用的文件名；冲突时在最后一段扩展名前追加递增序号。
 *
 * @param name 期望的文件名
 * @param taken 判断文件名是否已被占用
 */
export function uniqueFileName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;

  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${stem} (${suffix})${extension}`;
    if (!taken(candidate)) return candidate;
  }
}
