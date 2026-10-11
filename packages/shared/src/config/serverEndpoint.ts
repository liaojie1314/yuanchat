/**
 * 服务器地址解析与运行时切换
 *
 * @description
 * 同一个安装包要能在「正式服」与「本地开发服」之间切换，否则每换一次地址都得重新打包 ——
 * 桌面端和安卓端尤其麻烦。地址按以下优先级解析：
 *
 * 1. 本地存储里的用户自定义地址（设置页写入）
 * 2. 构建期注入的 `VITE_API_BASE_URL` / `VITE_WS_URL`（各 app 的 `.env.*`）
 * 3. 本机开发默认值 `http://localhost:8085` / `ws://localhost:8086`
 *
 * **切换后必须重载页面**：`API_BASE` 与 WS 基址都是模块级常量，在模块首次求值时固化，
 * 改完存储不重载的话旧连接与旧 baseURL 还在用。`applyServerEndpoint` 已包含重载。
 *
 * **桌面/移动端受 CSP 限制**：Tauri 的 `connect-src` 白名单是构建期写死的
 * （见 `apps/desktop/src-tauri/tauri.conf.json`），只能切到白名单内的地址。
 * 目前白名单含本机开发地址与正式服地址，切到第三个地址需要改 CSP 重新打包。
 */

/** 本地存储键名 */
const STORAGE_KEY = "yuanchat.server-endpoint";

/** 一组服务器地址 */
export interface ServerEndpoint {
  /** REST API 基址，如 `https://api.yuanyuan.blog`，结尾不带 `/` */
  apiBaseUrl: string;
  /** WebSocket 基址，如 `wss://ws.yuanyuan.blog`，结尾不带 `/` */
  wsUrl: string;
}

interface ImportMetaEnv {
  VITE_API_BASE_URL?: string;
  VITE_WS_URL?: string;
}

/** 读取构建期注入的 env（SSR / 测试环境下 import.meta 可能不存在） */
function buildTimeEnv(): ImportMetaEnv {
  if (typeof import.meta === "undefined") return {};
  return (import.meta as { env?: ImportMetaEnv }).env ?? {};
}

/** 去掉结尾斜杠，避免拼接出 `//api/v1` 这种双斜杠路径 */
function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * 构建期默认地址（不含本地覆盖）。
 * 设置页用它显示「默认值」，以及判断当前是否处于覆盖状态。
 */
export function getDefaultServerEndpoint(): ServerEndpoint {
  const env = buildTimeEnv();
  return {
    apiBaseUrl: trimTrailingSlash(env.VITE_API_BASE_URL || "http://localhost:8085"),
    wsUrl: trimTrailingSlash(env.VITE_WS_URL || "ws://localhost:8086"),
  };
}

/**
 * 读取用户自定义地址；没设过或存储不可用时返回 null。
 *
 * 隐私模式 / WebView 禁用存储时 localStorage 访问会直接抛异常，
 * 这里吞掉并回落默认值 —— 地址读不出来不该让整个应用起不来。
 */
export function getServerEndpointOverride(): ServerEndpoint | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ServerEndpoint>;
    if (!parsed.apiBaseUrl || !parsed.wsUrl) return null;
    return {
      apiBaseUrl: trimTrailingSlash(parsed.apiBaseUrl),
      wsUrl: trimTrailingSlash(parsed.wsUrl),
    };
  } catch {
    return null;
  }
}

/** 当前生效的地址：自定义优先，否则用构建期默认值 */
export function getServerEndpoint(): ServerEndpoint {
  return getServerEndpointOverride() ?? getDefaultServerEndpoint();
}

/** 当前生效的 REST 基址 */
export function resolveApiBase(): string {
  return getServerEndpoint().apiBaseUrl;
}

/** 当前生效的 WebSocket 基址 */
export function resolveWsBase(): string {
  return getServerEndpoint().wsUrl;
}

/**
 * 写入自定义地址；传 null 表示清除覆盖、恢复构建期默认值。
 *
 * 只落存储、不重载页面，便于单元测试与「保存后再确认」的交互；
 * 要立即生效请用 {@link applyServerEndpoint}。
 */
export function setServerEndpointOverride(endpoint: ServerEndpoint | null): void {
  try {
    if (endpoint === null) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        apiBaseUrl: trimTrailingSlash(endpoint.apiBaseUrl),
        wsUrl: trimTrailingSlash(endpoint.wsUrl),
      }),
    );
  } catch {
    // 存储不可用时静默失败：调用方已通过 UI 提示用户，这里再抛只会白屏
  }
}

/**
 * 写入地址并重载应用使其生效。
 *
 * 重载是必需的而非偷懒：REST 基址与 WS 基址在模块加载时固化，
 * 且切服后旧 token、旧会话缓存、已建立的 WS 连接全都属于上一台服务器，
 * 整页重启是唯一能保证状态不串台的做法。
 */
export function applyServerEndpoint(endpoint: ServerEndpoint | null): void {
  setServerEndpointOverride(endpoint);
  if (typeof location !== "undefined") {
    location.reload();
  }
}
