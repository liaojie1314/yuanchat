/**
 * REST API 客户端 — 统一请求封装
 *
 * @description
 * 所有 REST 调用的唯一出入口：
 * - 自动注入 `Authorization: Bearer <accessToken>`（来自 authStore）
 * - token 临近过期时先静默刷新（tokenManager 单飞行）
 * - 401 时兜底刷新并重试原请求一次，仍失败才抛错
 * - 统一解析后端 `ApiResponse` 信封，code !== 0 时抛出 ApiError
 * - 204 无响应体的端点直接得到 `undefined`，不进 JSON 解析
 * - BASE URL 由各 app 的 .env（VITE_API_BASE_URL）配置
 */
import { ensureFreshToken, forceRefresh } from "./tokenManager";
import type { ApiResponse } from "../types";
import { captureException } from "../observability/sentry";

interface ImportMetaEnv {
  VITE_API_BASE_URL?: string;
}

export const API_BASE: string =
  typeof import.meta !== "undefined"
    ? (import.meta as { env?: ImportMetaEnv }).env?.VITE_API_BASE_URL || "http://localhost:8085"
    : "http://localhost:8085";

/** 业务错误：携带后端返回的 code 与 message */
export class ApiError extends Error {
  code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

/** 由 authStore 注册的 token 读取函数（避免 api 层直接依赖 store 造成循环导入） */
let tokenProvider: () => string | null = () => null;

export function setTokenProvider(provider: () => string | null) {
  tokenProvider = provider;
}

export function getAccessToken(): string | null {
  return tokenProvider();
}

/** 刷新端点自身不参与刷新/重试逻辑，避免递归 */
const REFRESH_PATH = "/api/v1/auth/refresh";

async function doFetch<T>(path: string, init: RequestInit, token: string | null): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (token) {
    headers.Authorization = "Bearer " + token;
  }

  const res = await fetch(API_BASE + path, { ...init, headers });
  if (res.status >= 500) {
    captureException(
      new Error("HTTP " + String(res.status) + " " + String(init.method) + " " + path),
      {
        url: path,
        method: String(init.method),
        status: res.status,
      },
    );
  }
  // 204 没有响应体，解析 JSON 会抛 SyntaxError；只放行 204 是安全的：
  // 后端全部错误路径（含限流 429）都吐 { code, message } 信封，唯一的空体来源是 c.Status(204)
  if (res.status === 204) {
    return undefined as T;
  }
  const json = (await res.json()) as ApiResponse<T>;
  if (json.code !== 0) {
    throw new ApiError(json.code, json.message || "Request failed");
  }
  return json.data;
}

/**
 * 底层请求（带 token 刷新与 401 重试）。
 * 导出供需要非常规组合的调用方使用，例如 DELETE 带 body
 * （apiDelete 不支持 body）；常规场景请优先用 apiGet/apiPost 等。
 */
export async function request<T>(path: string, init: RequestInit): Promise<T> {
  // 登录/刷新等无 token 请求直接发出；刷新端点不做前置刷新（防递归）
  let token = tokenProvider();
  if (token && path !== REFRESH_PATH) {
    const fresh = await ensureFreshToken();
    if (fresh) token = fresh;
  }

  try {
    return await doFetch<T>(path, init, token);
  } catch (err) {
    // 401 兜底：主动刷新没拦住（时钟偏差/服务端提前失效），刷新后重试一次
    const is401 = err instanceof ApiError && err.code === 401;
    if (!is401 || !token || path === REFRESH_PATH) throw err;

    const renewed = await forceRefresh();
    if (!renewed) throw err;
    return doFetch<T>(path, init, renewed);
  }
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}
