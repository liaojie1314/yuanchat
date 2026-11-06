/** Web 下载目录由用户授权，并在本机持久化；与登出时清理的消息缓存分开。 */
import { reqDone, txDone } from "../localdb/db";

/** 浏览器目录句柄的权限接口；不会获得或保存用户磁盘的绝对路径。 */
export interface BrowserDownloadDirectory extends FileSystemDirectoryHandle {
  /** 查询已有授权，下载时不得自动弹出权限请求。 */
  queryPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  /** 用户点击重新授权后请求权限。 */
  requestPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
}

type DirectoryWindow = Window & {
  showDirectoryPicker?: (options: {
    id: string;
    mode: "readwrite";
  }) => Promise<BrowserDownloadDirectory>;
};

/** 检测安全上下文中的目录选择、持久化与跨窗口占名能力，旧浏览器继续使用浏览器下载。 */
export function supportsBrowserDownloadDirectory(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext === true &&
    typeof (window as DirectoryWindow).showDirectoryPicker === "function" &&
    typeof indexedDB !== "undefined" &&
    typeof navigator.locks?.request === "function"
  );
}

/** 单独保存目录偏好，复用现有 IDB Promise 包装，不触碰账号历史库。 */
async function directoryDb(): Promise<IDBDatabase> {
  const request = indexedDB.open("yuanchat-download-preferences", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("settings");
  return reqDone(request);
}

/** 读取结构化克隆的目录句柄；没有目录偏好时返回 null。 */
export async function loadBrowserDownloadDirectory(): Promise<BrowserDownloadDirectory | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await directoryDb();
  try {
    return (
      (await reqDone<BrowserDownloadDirectory | undefined>(
        db.transaction("settings").objectStore("settings").get("download-directory"),
      )) ?? null
    );
  } finally {
    db.close();
  }
}

/** 保存目录授权；传 null 只恢复浏览器默认保存方式，不删除下载文件。 */
export async function setBrowserDownloadDirectory(
  directory: BrowserDownloadDirectory | null,
): Promise<void> {
  const db = await directoryDb();
  try {
    const transaction = db.transaction("settings", "readwrite");
    transaction.objectStore("settings").put(directory, "download-directory");
    await txDone(transaction);
  } finally {
    db.close();
  }
}

/** 在用户点击事件中选择并持久化目录，取消或持久化失败时保留原偏好。 */
export async function chooseBrowserDownloadDirectory(): Promise<BrowserDownloadDirectory> {
  if (!supportsBrowserDownloadDirectory()) throw new Error("download.directoryUnsupported");
  const directory = await (window as DirectoryWindow).showDirectoryPicker!({
    id: "yuanchat-downloads",
    mode: "readwrite",
  });
  await setBrowserDownloadDirectory(directory);
  return directory;
}
