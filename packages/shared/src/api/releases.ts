/**
 * OTA 版本分发 API 客户端
 *
 * @description
 * 对接 `GET /api/v1/updates/:platform/:arch`（更新检查，免鉴权）与
 * `GET /api/v1/updates/catalog`（下载页目录，免鉴权）。
 *
 * 更新检查端点的响应体是**裸的动态格式**（{version, notes, pub_date, url, ...}），
 * 不带 `{code, data}` 信封 —— 这是 tauri-plugin-updater 的硬要求（它直接解析根
 * 对象），所以本模块对 check 走裸 fetch，只有 catalog（带信封）走 apiGet。
 *
 * 无更新时服务端返 **204 No Content**，映射成 `null`。注意 204 的语义是
 * 「我确定没有更新」：Tauri updater 收到 204 不会再试下一个 endpoint，
 * 只有 5xx 才会落到 GitHub 兜底（详见 Task 1 预研第 3 节）。
 */
import { apiGet, API_BASE } from "./client";

/** 更新检查的响应体（动态格式，updater 与 Android 自建链路共用同一形状） */
export interface AndroidUpdate {
  /** 新版本号（semver） */
  version: string;
  /** 更新说明，供应用内自绘卡片展示 */
  notes: string;
  /** 发布时间（RFC3339）；服务端保证非空，缺了也不参与判定 */
  pub_date?: string;
  /** 安装包预签名下载 URL */
  url: string;
  /**
   * 安装包 sha256（小写十六进制）。
   * Android 侧它是「装不装」的唯一闸门：服务端没给就拒装；
   * 桌面侧走 minisign 签名，这个字段对它无意义但一并下发。
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
 * 检查某平台/架构是否有更新。
 *
 * @param platform darwin / linux / windows / android
 * @param arch x86_64 / aarch64 / universal / ...
 * @param version 客户端当前版本号
 * @param device 设备标识（灰度键）；缺省时服务端回落 ClientIP，稳定性弱于显式传入
 * @returns 有更新时返回动态格式更新体；无更新（204）返回 null
 * @throws Error 非 2xx（服务端自身故障）或网络错误时抛出
 */
export async function checkUpdate(
  platform: string,
  arch: string,
  version: string,
  device?: string,
): Promise<AndroidUpdate | null> {
  const qs = new URLSearchParams({ version });
  if (device) qs.set("device", device);
  const res = await fetch(`${API_BASE}/api/v1/updates/${platform}/${arch}?${qs.toString()}`);
  if (res.status === 204) return null;
  if (!res.ok) {
    throw new Error(`update check failed: HTTP ${res.status}`);
  }
  return (await res.json()) as AndroidUpdate;
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
