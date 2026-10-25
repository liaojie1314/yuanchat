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
