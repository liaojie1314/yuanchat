/**
 * fileSink 的 Tauri 实现（桌面 + 安卓共用）。
 *
 * @description
 * 落盘位置：下载产物进系统/应用的 Download 目录，outbox 副本进 AppLocalData
 * 的 `outbox/` 子目录（清理策略不同：下载不清，outbox 发完即清）。
 * 安卓上 `BaseDirectory.Download` 解析到应用私有的 external files 目录，
 * **无需任何权限**（Task 1 研究文档第 1 节）；代价是文件管理器里看不见，
 * 所以 `save()` 必须把绝对路径如实返回 —— 「打开」按钮是安卓用户触达文件的
 * 唯一途径，返回文件名等于打不开。
 *
 * 绝对路径的来源：plugin-fs 的 `writeFile` 只认相对 baseDir 的路径、不回地址，
 * 所以这里用 `@tauri-apps/api/path` 的 `downloadDir()` / `appLocalDataDir()`
 * 拿到基目录，再 `join` 出与 Rust 侧 `ensure_app_owned` 对得上的绝对路径。
 */
import {
  BaseDirectory,
  exists,
  mkdir,
  open,
  readFile,
  remove,
  writeFile,
} from "@tauri-apps/plugin-fs";
import {
  appLocalDataDir,
  dirname,
  downloadDir,
  isAbsolute,
  join,
  normalize,
} from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import {
  captureException,
  setFileSink,
  uniqueFileName,
  type DownloadDirectory,
  type SinkDir,
} from "@yuanchat/shared";

/** 两个落盘目标的目录映射：baseDir 是 plugin-fs 的枚举，sub 是基目录下的子路径 */
const DIRS: Record<SinkDir, { base: BaseDirectory; sub: string }> = {
  downloads: { base: BaseDirectory.Download, sub: "" },
  appdata: { base: BaseDirectory.AppLocalData, sub: "outbox" },
};

/** 相对 baseDir 的写入路径（子目录拼在文件名前） */
function pathOf(dir: SinkDir, fileName: string): string {
  const { sub } = DIRS[dir];
  return sub ? `${sub}/${fileName}` : fileName;
}

/**
 * 在 app 入口调用一次，把 Tauri 实现装进 shared 的注入点。
 *
 * 未注入（web / 单测环境）时 shared 自动回落 `<a download>` 实现，
 * 三端共用同一份 downloadStore。
 */
export function installFileSink(): void {
  const mobile = ["android", "ios"].includes(platform());
  const downloadDirectory = mobile
    ? undefined
    : {
        get: () => invoke<DownloadDirectory>("get_download_directory"),
        choose: () => invoke<DownloadDirectory | null>("choose_download_directory"),
        reset: () => invoke<DownloadDirectory>("reset_download_directory"),
      };
  setFileSink({
    downloadDirectory,
    async isCurrentDirectory(path) {
      const directory = downloadDirectory
        ? (await downloadDirectory.get()).path
        : await downloadDir();
      return (await normalize(await dirname(path))) === (await normalize(directory));
    },
    revealTarget: mobile ? "file" : "folder",
    async exists(path) {
      // 重启后先恢复原生层保存的目录授权，旧下载即使不在当前目录也能检查。
      await downloadDirectory?.get();
      return exists(path);
    },
    async save(bytes, fileName, _mime, dir = "downloads") {
      if (!fileName || /[/\\\0]/.test(fileName) || fileName === "." || fileName === "..") {
        throw new Error("invalid download filename");
      }
      const { base, sub } = DIRS[dir];
      // 固定本次落盘目标；用户在下载期间改目录不会改变这份文件的返回路径。
      const directory = dir === "downloads" ? await downloadDirectory?.get() : undefined;
      const options = directory?.custom ? undefined : { baseDir: base };
      if (sub) {
        // writeFile 不会建父目录，outbox 首次落盘前必须先 mkdir
        await mkdir(sub, { baseDir: base, recursive: true });
      }

      // createNew 在文件系统中原子占名，跨窗口同时下载也不能覆盖彼此。
      // 重名太多时明确失败，绝不为了结束探测而覆盖用户已有文件。
      let finalName = fileName;
      if (dir === "downloads") {
        const taken = new Set<string>();
        let saved = false;
        for (let i = 0; i < 1000; i += 1) {
          const target = directory?.custom ? await join(directory.path, finalName) : finalName;
          let handle;
          try {
            handle = await open(target, { ...options, write: true, createNew: true });
          } catch (err) {
            // 只重试名字冲突；权限、磁盘等错误保持原样交给下载器显示失败态。
            if (!(await exists(target, options))) throw err;
            taken.add(finalName);
            finalName = uniqueFileName(fileName, (n) => taken.has(n));
            continue;
          }
          try {
            try {
              let offset = 0;
              // 原生 write 可能短写，必须写完全部字节才算成功；空文件仍是合法下载。
              do {
                const n = await handle.write(bytes.subarray(offset));
                if (bytes.byteLength === 0) break;
                if (!Number.isInteger(n) || n <= 0 || n > bytes.byteLength - offset) {
                  throw new Error("invalid file write length");
                }
                offset += n;
              } while (offset < bytes.byteLength);
            } finally {
              await handle.close();
            }
          } catch (err) {
            // 只删本次原子占名得到的产物，不能碰其他窗口或用户已有文件。
            await remove(target, options).catch((cleanupError) => {
              captureException(cleanupError, { context: "fileSink.cleanup" });
            });
            throw err;
          }
          saved = true;
          break;
        }
        if (!saved) throw new Error("no available download filename");
      } else {
        await writeFile(pathOf(dir, finalName), bytes, { baseDir: base });
      }

      // 绝对路径要用 path 插件拼：baseDir 在不同平台解析到不同位置，
      // 前端无从得知，拼错就打不开（ensure_app_owned 会拒绝）
      const baseAbs =
        dir === "downloads" ? (directory?.path ?? (await downloadDir())) : await appLocalDataDir();
      return sub ? await join(baseAbs, sub, finalName) : await join(baseAbs, finalName);
    },

    async read(fileName, dir) {
      const { base } = DIRS[dir];
      if (dir === "downloads" && downloadDirectory) {
        const directory = await downloadDirectory.get();
        return readFile(
          (await isAbsolute(fileName)) ? fileName : await join(directory.path, fileName),
        );
      }
      return readFile(pathOf(dir, fileName), { baseDir: base });
    },

    async remove(fileName, dir) {
      const { base } = DIRS[dir];
      if (dir === "downloads" && downloadDirectory) {
        const directory = await downloadDirectory.get();
        await remove(
          (await isAbsolute(fileName)) ? fileName : await join(directory.path, fileName),
        );
        return;
      }
      await remove(pathOf(dir, fileName), { baseDir: base });
    },

    async reveal(path) {
      // 交 Rust 侧转一手：安卓的私有目录 file:// URI 不能跨应用传，
      // 必须经 FileProvider 换 content:// 并授读权限；桌面端卡目录后打开所在文件夹
      await invoke("open_local_file", { path });
    },
  });
}
