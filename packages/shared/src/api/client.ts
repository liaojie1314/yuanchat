/**
 * REST API 客户端 — 统一请求封装
 *
 * @description
 * 所有 REST 调用的唯一出入口：
 * - 自动注入 `Authorization: Bearer <accessToken>`（来自 authStore）
 * - 统一解析后端 `ApiResponse` 信封，code !== 0 时抛出 ApiError
 * - BASE URL 由各 app 的 .env（VITE_API_BASE_URL）配置
 */
import type { ApiResponse } from "../types";

interface ImportMetaEnv {
  VITE_API_BASE_URL?: string;
}

export const API_BASE: string =
  typeof import.meta !== "undefined"
    ? (import.meta as { env?: ImportMetaEnv }).env?.VITE_API_BASE_URL || "http://localhost:8080"
    : "http://localhost:8080";

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

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const token = tokenProvider();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (token) {
    headers.Authorization = "Bearer " + token;
  }

  const res = await fetch(API_BASE + path, { ...init, headers });
  const json = (await res.json()) as ApiResponse<T>;
  if (json.code !== 0) {
    throw new ApiError(json.code, json.message || "Request failed");
  }
  return json.data;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}
