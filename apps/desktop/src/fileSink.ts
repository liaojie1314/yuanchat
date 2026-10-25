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
import { BaseDirectory, exists, mkdir, readFile, remove, writeFile } from "@tauri-apps/plugin-fs";
import { appLocalDataDir, downloadDir, join } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { setFileSink, uniqueFileName, type SinkDir } from "@yuanchat/shared";

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
  setFileSink({
    async save(bytes, fileName, _mime, dir = "downloads") {
      const { base, sub } = DIRS[dir];
      if (sub) {
        // writeFile 不会建父目录，outbox 首次落盘前必须先 mkdir
        await mkdir(sub, { baseDir: base, recursive: true });
      }

      // 同名避让只在 downloads 做：静默覆盖用户已有的下载是不可逆的，
      // 后缀前递增（a.pdf → a (2).pdf）。outbox 的键自带 clientMsgId，天然不冲突
      let finalName = fileName;
      if (dir === "downloads") {
        const taken = new Set<string>();
        // 线性探测上限 100：同名文件真超过 100 个的话宁可覆盖也不死循环
        for (let i = 0; i < 100; i += 1) {
          taken.add(finalName);
          if (!(await exists(finalName, { baseDir: base }))) break;
          finalName = uniqueFileName(fileName, (n) => taken.has(n));
        }
      }

      await writeFile(pathOf(dir, finalName), bytes, { baseDir: base });

      // 绝对路径要用 path 插件拼：baseDir 在不同平台解析到不同位置，
      // 前端无从得知，拼错就打不开（ensure_app_owned 会拒绝）
      const baseAbs = dir === "downloads" ? await downloadDir() : await appLocalDataDir();
      return sub ? await join(baseAbs, sub, finalName) : await join(baseAbs, finalName);
    },

    async read(fileName, dir) {
      const { base } = DIRS[dir];
      return readFile(pathOf(dir, fileName), { baseDir: base });
    },

    async remove(fileName, dir) {
      const { base } = DIRS[dir];
      await remove(pathOf(dir, fileName), { baseDir: base });
    },

    async reveal(path) {
      // 交 Rust 侧转一手：安卓的私有目录 file:// URI 不能跨应用传，
      // 必须经 FileProvider 换 content:// 并授读权限；桌面端卡目录后交给系统默认应用
      await invoke("open_local_file", { path });
    },
  });
}
