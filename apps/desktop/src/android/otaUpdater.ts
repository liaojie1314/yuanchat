/**
 * Android 自动更新。
 *
 * @description
 * Tauri 的 updater 插件不支持 Android（`updater_os()` 只认 linux/macos/windows，
 * 编译期就被 `cfg(not(target_os = "android"))` 排除），这里自建一条：
 * 查端点 → 应用内自绘说明 → 下载 APK（复用下载器的进度条）→
 * **sha256 校验** → 调系统安装器。
 *
 * 为什么必须校验：install_apk 一旦发出 Intent，字节就交给系统 PackageInstaller 了，
 * 之后没有任何把关机会。服务端没给 sha256 时宁可不更新 ——
 * 不装来源不明的字节。APK 用 sha256 而非 minisign 是因为 APK 走的是
 * Android 自己的 v2 签名体系，minisign 那套只服务 Tauri updater。
 */
import { invoke } from "@tauri-apps/api/core";
import {
  checkUpdate,
  deviceUid,
  getFileSink,
  startDownloadFromUrl,
  useDownloadStore,
  OTA_SHA256_MISMATCH,
  type AndroidUpdate,
} from "@yuanchat/shared";

/** 安卓共用 android/aarch64 一条发布记录（见计划 Task 17 的端点约定） */
const OTA_PLATFORM = "android";
const OTA_ARCH = "aarch64";

/** OTA 下载在进度 store 里的键前缀；同版本重复点击天然去重 */
const MESSAGE_ID_PREFIX = "ota-";

/**
 * 用 WebCrypto 算 sha256，返回小写十六进制。
 *
 * @remarks jsdom / 旧 WebView 都实现了 `crypto.subtle`（secure context 下），
 *   Tauri WebView 满足；无需引入 hash 库。
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 检查 Android 是否有更新。
 *
 * @param currentVersion 客户端当前版本号
 * @returns 有更新返回更新体；无更新（204）返回 null
 * @remarks device 用持久化的随机 uuid，保证灰度对同一台设备判定稳定。
 */
export async function checkAndroidUpdate(currentVersion: string): Promise<AndroidUpdate | null> {
  return checkUpdate(OTA_PLATFORM, OTA_ARCH, currentVersion, deviceUid());
}

/**
 * 下载 APK → sha256 校验 → 调系统安装器。
 *
 * 流程：
 * 1. 服务端没给 sha256 → 直接拒装（下载都不开始）
 * 2. `startDownloadFromUrl("ota-<version>", update.url, …)` —— 用版本号当 messageId，
 *    进度条与文件下载共用同一套 store 与 UI
 * 3. 落盘后 `getFileSink().read!(…, "downloads")` 读回字节（校验的是**磁盘上**那份，
 *    而不是内存里刚拼出来的）
 * 4. sha256 不匹配 → 删掉已落盘文件 + 抛 {@link OTA_SHA256_MISMATCH}，永不进安装器
 * 5. 匹配 → `invoke("install_apk", { path })`，path 是 fileSink save 返回的绝对路径
 *
 * @throws Error 服务端未提供 sha256、下载失败或校验不匹配时抛出
 */
export async function downloadAndInstall(update: AndroidUpdate): Promise<void> {
  // 宁可不更新，也不装来源不明的字节：sha256 是这条链路唯一的完整性闸门，
  // 缺了它后面的一切（安装器、系统签名校验）都拦不住「内容被调包」
  if (!update.sha256) {
    throw new Error("server did not provide sha256, refuse to install");
  }

  const messageId = MESSAGE_ID_PREFIX + update.version;
  const fileName = `yuanchat-${update.version}.apk`;

  // 源 URL 已由 /updates 端点预签好，直接流式下载（进度与文件下载同一套 store）
  await startDownloadFromUrl(messageId, update.url, fileName);
  const entry = useDownloadStore.getState().entries[messageId];
  if (!entry || entry.phase !== "done" || !entry.savedPath) {
    throw new Error("apk download failed");
  }

  const sink = getFileSink();
  if (!sink.read || !sink.remove) {
    // 桌面/安卓的 fileSink 一定注入了 read/remove（Task 6 契约）；
    // 真缺了说明注入时机出了问题，此时校验链路不成立，宁可不装
    throw new Error("fileSink cannot read back downloads");
  }

  // read 传绝对路径：tauri plugin-fs 的解析是 base_dir.push(path)，
  // 绝对路径会整体替换 base，正好落在原文件上
  const onDisk = await sink.read(entry.savedPath, "downloads");
  const actual = await sha256Hex(onDisk);
  if (actual !== update.sha256.toLowerCase()) {
    // 已落盘的字节是可疑的，必须删掉 —— 留着就有被误装/误传的可能
    await sink.remove(entry.savedPath, "downloads");
    throw new Error(OTA_SHA256_MISMATCH);
  }

  await invoke("install_apk", { path: entry.savedPath });
}
