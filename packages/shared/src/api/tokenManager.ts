/**
 * tokenManager — access token 静默刷新协调器（无 React 依赖）
 *
 * @description
 * 双保险刷新策略：
 * - 主动：access 距过期 < 60s 时，请求发出前先刷新（ensureFreshToken）
 * - 被动：收到 401 时兜底刷新并由调用方重试原请求（forceRefresh）
 *
 * 单飞行（single-flight）：并发触发共享同一个 in-flight Promise，
 * 不会同时发出多个 /auth/refresh。
 *
 * 与 store 解耦：实际的「调接口 + 回写 token」动作由 authStore 通过
 * setRefreshHandler 注册（与 api/client 的 tokenProvider 同一模式，
 * 避免 api 层 ↔ store 循环导入）。刷新失败（refresh 也失效）由
 * handler 内部负责清登录态。
 */

/** 距过期不足该毫秒数时视为需要刷新 */
const REFRESH_AHEAD_MS = 60_000;

export interface RefreshHandler {
  /** 当前 access token 的过期时刻（Unix ms），未登录/未知返回 null */
  getExpiresAt: () => number | null;
  /** 执行刷新：成功返回新 access token 并已回写 store；失败返回 null 且已清登录态 */
  refresh: () => Promise<string | null>;
}

let handler: RefreshHandler | null = null;
let inFlight: Promise<string | null> | null = null;

/** 由 authStore（bootstrap 阶段）注册刷新实现 */
export function setRefreshHandler(h: RefreshHandler | null) {
  handler = h;
  inFlight = null;
}

/** 是否临近/已经过期（无 handler 或无过期信息时视为不需要刷新）。
 * 同步判据，供 chatSocket 在 token 新鲜时走零延迟直连路径。 */
export function needsRefresh(): boolean {
  const expiresAt = handler?.getExpiresAt() ?? null;
  if (expiresAt === null) return false;
  return Date.now() >= expiresAt - REFRESH_AHEAD_MS;
}

function runRefresh(): Promise<string | null> {
  if (!handler) return Promise.resolve(null);
  if (!inFlight) {
    inFlight = handler.refresh().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/**
 * 请求前调用：token 仍新鲜则立即返回 null（表示无需替换），
 * 临近过期则刷新并返回新 token（失败返回 null，由后续 401 流程兜底）。
 */
export function ensureFreshToken(): Promise<string | null> {
  if (!needsRefresh()) return Promise.resolve(null);
  return runRefresh();
}

/** 401 兜底：强制刷新一次（并发共享同一飞行） */
export function forceRefresh(): Promise<string | null> {
  return runRefresh();
}
