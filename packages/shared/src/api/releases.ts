/**
 * OTA 版本分发 API 客户端
 *
 * @description
 * 对接 `GET /api/v1/updates/:platform/:arch`（更新检查，免鉴权）与
 * `GET /api/v1/updates/catalog`（下载页目录，免鉴权）。
 *
 * Android 更新检查返回平面对象（{version, notes, pub_date, url, ...}），桌面
 * 则返回含精确安装器键的 platforms 映射，由 tauri-plugin-updater 解析。
 * 两者都不带 `{code, data}` 信封；本模块只解析 Android 更新体，并对公共检查
 * 走裸 fetch。catalog 使用带信封的 apiGet。
 *
 * 无更新时服务端返 **204 No Content**，映射成 `null`。注意 204 的语义是
 * 「我确定没有更新」：Tauri updater 收到 204 不会再试下一个 endpoint，
 * 只有检查失败才会继续尝试下一个来源。
 */
import { apiGet, API_BASE } from "./client";

/** Android 平面更新体；桌面的 platforms 映射由 Tauri SDK 自行处理。 */
export interface AndroidUpdate {
  /** 新版本号（semver） */
  version: string;
  /** 更新说明，供应用内自绘卡片展示 */
  notes: string;
  /** 发布时间（RFC3339）；服务端保证非空，缺了也不参与判定 */
  pub_date?: string;
  /** 安装包预签名 URL 或已验证的官方 GitHub asset API 地址 */
  url: string;
  /**
   * 安装包 sha256（小写十六进制）。
   * Android 的完整性闸门：更新源没给就拒装；桌面 SDK 使用 minisign 签名。
   */
  sha256: string;
  /** 安装包字节数 */
  size: number;
  /** 强制更新：为 true 时应用内卡片不提供「稍后」 */
  mandatory: boolean;
}

/** 下载页目录条目：某渠道下每个平台/架构的最新已发布版本 */
export interface CatalogEntry {
  /** darwin / linux / windows / android */
  platform: string;
  /** x86_64 / aarch64 / universal / ... */
  arch: string;
  version: string;
  /** 字节数 */
  size: number;
  notes: string;
  sha256?: string;
  /** 安装包预签名下载 URL */
  url: string;
}

/**
 * 更新检查失败时抛出的错误消息。
 *
 * AndroidUpdateCard 据此把「安装包校验没过」与「下载失败」分成两种文案 ——
 * 校验失败意味着下载源可能被篡改，措辞必须比普通网络错误重。
 * 走字符串常量而非错误子类：otaUpdater 与卡片分属 app 层与 ui 层，
 * 双方只共享本模块，类 instanceof 会把依赖方向搞反。
 */
export const OTA_SHA256_MISMATCH = "ota:sha256-mismatch";

const GITHUB_REPOSITORY = "https://github.com/liaojie1314/yuanchat";
const GITHUB_API = "https://api.github.com/repos/liaojie1314/yuanchat";

/**
 * 判断是否为元聊官方仓库的 GitHub 安装包 API 地址。
 * @param url 待检查的下载地址
 * @returns 只有无额外参数的 HTTPS asset 地址通过
 */
export function isGitHubReleaseAssetUrl(url: string): boolean {
  return /^https:\/\/api\.github\.com\/repos\/liaojie1314\/yuanchat\/releases\/assets\/[1-9]\d*$/.test(
    url,
  );
}

/** 公共更新请求统一限时，且不继承登录客户端的 JWT、Cookie 或私有头。 */
async function fetchUpdateJson(url: string, emptyStatus: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: "omit" });
    if (response.status === emptyStatus) return undefined;
    if (!response.ok) throw new Error(`update check failed: HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

/** GitHub 仅选稳定版本；按 semver 数值比较，不能用字符串把 0.9 判成高于 0.10。 */
function isNewerStableVersion(version: string, currentVersion: string): boolean {
  const current =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(
      currentVersion,
    );
  const next = version.split(".").map(Number);
  if (!current || ![...next, ...current.slice(1, 4).map(Number)].every(Number.isSafeInteger)) {
    throw new Error("invalid update version");
  }
  for (let part = 0; part < 3; part += 1) {
    const installed = Number(current[part + 1]);
    if (next[part] !== installed) return next[part] > installed;
  }
  return Boolean(current[4]);
}

/**
 * 从官方 GitHub Release 检查 Android 通用 APK，只作为自建检查失败后的后备源。
 * @param currentVersion 客户端当前版本号
 * @returns 已验证元数据的更新；没有更高的已发布版本时返回 null
 * @throws Error 网络失败，或版本、仓库、文件名、大小、SHA-256 无法验证
 */
export async function checkGitHubAndroidUpdate(
  currentVersion: string,
): Promise<AndroidUpdate | null> {
  const data = await fetchUpdateJson(`${GITHUB_API}/releases/latest`, 404);
  if (data === undefined) return null;
  if (!data || typeof data !== "object") throw new Error("invalid GitHub release");
  const release = data as Record<string, unknown>;
  if (
    typeof release.tag_name !== "string" ||
    !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release.tag_name) ||
    release.draft !== false ||
    release.prerelease !== false ||
    release.html_url !== `${GITHUB_REPOSITORY}/releases/tag/${release.tag_name}` ||
    !Array.isArray(release.assets)
  )
    throw new Error("invalid GitHub release");

  const version = release.tag_name.slice(1);
  if (!isNewerStableVersion(version, currentVersion)) return null;
  const name = `yuanchat-${release.tag_name}-app-universal-release.apk`;
  const assets = release.assets.filter((asset) => asset && asset.name === name);
  if (assets.length !== 1) throw new Error("GitHub universal APK missing or ambiguous");
  const asset = assets[0] as Record<string, unknown>;
  if (
    asset.browser_download_url !==
      `${GITHUB_REPOSITORY}/releases/download/${release.tag_name}/${name}` ||
    typeof asset.url !== "string" ||
    !isGitHubReleaseAssetUrl(asset.url) ||
    typeof asset.digest !== "string" ||
    !/^sha256:[a-fA-F0-9]{64}$/.test(asset.digest) ||
    typeof asset.size !== "number" ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0
  )
    throw new Error("invalid GitHub APK metadata");

  return {
    version,
    notes: typeof release.body === "string" ? release.body : "",
    pub_date: typeof release.published_at === "string" ? release.published_at : undefined,
    url: asset.url,
    sha256: asset.digest.slice(7).toLowerCase(),
    size: asset.size,
    mandatory: false,
  };
}

/** 生成一个随机 uuid（优先原生 randomUUID，老 WebView 没有就走 getRandomValues 手拼 v4） */
function newUuid(): string {
  if (typeof crypto !== "undefined") {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // 兜底：连 WebCrypto 都没有的极端环境退 Math.random —— 灰度键质量下降，但不至于崩
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** localStorage 里持久化设备标识的键名 */
const DEVICE_UID_KEY = "yuanchat-device-uid";

/**
 * 取设备标识（用于灰度放量：同一台设备每次检查落进同一桶）。
 *
 * 首次调用生成随机 uuid 并写 localStorage，此后原样复用。
 * 隐私模式等 localStorage 不可用的环境退化为「每次一次性 id」——
 * 灰度判定会因此不稳定，但检查本身不受影响。
 */
export function deviceUid(): string {
  try {
    const existing = localStorage.getItem(DEVICE_UID_KEY);
    if (existing) return existing;
    const uid = newUuid();
    localStorage.setItem(DEVICE_UID_KEY, uid);
    return uid;
  } catch {
    return newUuid();
  }
}

/** 返回与服务端 FNV-1a 32 位一致的灰度桶；插件兜底请求只携带桶，不泄露唯一设备标识。 */
export function deviceCohort(uid = deviceUid()): number {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(uid)) {
    hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  }
  return hash % 100;
}

/**
 * 检查 Android 某架构是否有更新，并验证平面更新体。
 *
 * @param platform android；桌面更新由 Tauri SDK 处理
 * @param arch x86_64 / aarch64 / universal / ...
 * @param version 客户端当前版本号
 * @param device 设备标识（灰度键）；缺省时服务端回落 ClientIP，稳定性弱于显式传入
 * @returns 有更新时返回平面更新体；无更新（204）返回 null
 * @throws Error 网络失败、非 2xx 或元数据缺失/损坏时抛出，供调用方重试或切换后备源
 */
export async function checkUpdate(
  platform: string,
  arch: string,
  version: string,
  device?: string,
): Promise<AndroidUpdate | null> {
  const qs = new URLSearchParams({ version });
  if (device) qs.set("device", device);
  const data = await fetchUpdateJson(
    `${API_BASE}/api/v1/updates/${platform}/${arch}?${qs.toString()}`,
    204,
  );
  if (data === undefined) return null;
  if (!data || typeof data !== "object") throw new Error("invalid server update metadata");
  const update = data as Partial<AndroidUpdate>;
  if (
    typeof update.version !== "string" ||
    !update.version.trim() ||
    typeof update.url !== "string" ||
    typeof update.sha256 !== "string" ||
    !/^[a-fA-F0-9]{64}$/.test(update.sha256) ||
    typeof update.size !== "number" ||
    !Number.isSafeInteger(update.size) ||
    update.size <= 0 ||
    typeof update.notes !== "string" ||
    typeof update.mandatory !== "boolean"
  )
    throw new Error("invalid server update metadata");
  const url = new URL(update.url);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("invalid update URL");
  // 版本高低和灰度仍由自建服务器判定；这里只拦截不可使用的响应体。
  return update as AndroidUpdate;
}

/**
 * 拉取下载页目录：某渠道下每个平台/架构的最新已发布版本。
 *
 * @param channel stable（默认）/ beta
 * @remarks 服务端把单条签名失败的条目跳过而非整页报错，空目录返回 `[]`。
 */
export async function fetchCatalog(channel?: string): Promise<CatalogEntry[]> {
  const path =
    "/api/v1/updates/catalog" + (channel ? `?channel=${encodeURIComponent(channel)}` : "");
  const dto = await apiGet<{ items: CatalogEntry[] }>(path);
  return dto.items;
}
