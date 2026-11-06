/**
 * 识别当前系统，用于在下载页高亮推荐的安装包。
 *
 * @param ua `navigator.userAgent`
 * @param uaDataPlatform `navigator.userAgentData?.platform`（新 API，优先采信）
 * @remarks `userAgentData` 在旧 WebView 里不存在，必须有 UA 回落 ——
 *   本仓的 build.target 是 es2019，面向的就是旧 WebView。
 *   **Android 必须先于 Linux 判定**：安卓的 UA 里也含 "Linux"。
 */
export type DetectedPlatform = "windows" | "darwin" | "linux" | "android" | "unknown";

export function detectPlatform(ua: string, uaDataPlatform?: string): DetectedPlatform {
  const d = (uaDataPlatform ?? "").toLowerCase();
  if (d.includes("win")) return "windows";
  if (d.includes("mac")) return "darwin";
  if (d.includes("android")) return "android";
  if (d.includes("linux")) return "linux";

  const s = ua.toLowerCase();
  if (s.includes("android")) return "android"; // 必须在 linux 之前
  if (s.includes("windows")) return "windows";
  if (s.includes("mac os") || s.includes("macintosh")) return "darwin";
  if (s.includes("linux") || s.includes("x11")) return "linux";
  return "unknown";
}

/** 能可靠识别的安装包架构；未知时不猜测，也不推荐任意一个包。 */
export type DetectedArchitecture = "x86_64" | "aarch64" | "i686" | "armv7" | "unknown";

/** 优先使用 UAData 的架构/位数，旧浏览器回落明确的 CPU 标记；Mac 的 Intel UA 不可信。 */
export function detectArchitecture(
  ua: string,
  info?: { architecture?: string; bitness?: string },
): DetectedArchitecture {
  const arch = (info?.architecture ?? "").toLowerCase();
  if (arch === "arm" && info?.bitness === "64") return "aarch64";
  if (arch === "arm" && info?.bitness === "32") return "armv7";
  if (arch === "x86" && info?.bitness === "64") return "x86_64";
  if (arch === "x86" && info?.bitness === "32") return "i686";
  if (/aarch64|arm64|armv8/i.test(ua)) return "aarch64";
  if (/armv7/i.test(ua)) return "armv7";
  if (/x86_64|amd64|Win64|WOW64|\bx64\b/i.test(ua)) return "x86_64";
  if (/i[3-6]86|Win32/i.test(ua)) return "i686";
  return "unknown";
}
