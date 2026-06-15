/**
 * 认证状态管理 Store — JWT 双 Token
 *
 * @description
 * 管理用户登录/注册流程，存储 Access Token（15min）和 Refresh Token（7天）。
 * 使用 Zustand persist 中间件持久化 token 到 localStorage，刷新后自动恢复登录态。
 *
 * API 调用流程：
 * 1. loginWithPassword() → POST /api/v1/users/login → 存储 token
 * 2. registerWithPassword() → POST /api/v1/users/register → 存储 token
 * 3. logout() → 清空所有状态
 * 4. refreshAccessToken() → POST /api/v1/auth/refresh → 换新 access token
 *
 * @example
 * ```tsx
 * const { loginWithPassword, isAuthenticated, user } = useAuthStore();
 * await loginWithPassword("13800138000", "password123");
 * if (isAuthenticated) navigate("/chat");
 * ```
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ApiResponse } from "../types";

// ========================================
// Types
// ========================================

interface User {
  id: string;
  nickname: string;
  avatarUrl?: string | null;
  phone?: string;
  email?: string;
}

/** POST /api/v1/users/login 响应 */
interface LoginResponse {
  user: User;
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;

  /** 密码登录 */
  loginWithPassword: (account: string, password: string) => Promise<void>;
  /** 密码注册 */
  registerWithPassword: (
    phone: string,
    password: string,
    code: string,
    nickname: string,
  ) => Promise<void>;
  /** 登出 */
  logout: () => void;
}

// ========================================
// API helpers
// ========================================

/** 后端 API 地址，由各 app 的 .env 文件配置 */
interface ImportMetaEnv {
  VITE_API_BASE_URL?: string;
}
const API_BASE: string =
  typeof import.meta !== "undefined"
    ? (import.meta as { env?: ImportMetaEnv }).env?.VITE_API_BASE_URL || "http://localhost:8080"
    : "http://localhost:8080";

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: ApiResponse<T> = await res.json();
  if (json.code !== 0) {
    throw new Error(json.message || "Request failed");
  }
  return json.data;
}

// ========================================
// Store
// ========================================

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,

      /**
       * 密码登录
       * account 可以是手机号或邮箱
       */
      loginWithPassword: async (account: string, password: string) => {
        const data = await apiPost<LoginResponse>("/api/v1/users/login", {
          account,
          password,
        });
        set({
          user: data.user,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          isAuthenticated: true,
        });
      },

      /**
       * 密码注册
       * 需要手机号 + 验证码 + 密码 + 昵称
       */
      registerWithPassword: async (
        phone: string,
        password: string,
        code: string,
        nickname: string,
      ) => {
        const data = await apiPost<LoginResponse>("/api/v1/users/register", {
          phone,
          password,
          code,
          nickname,
        });
        set({
          user: data.user,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          isAuthenticated: true,
        });
      },

      logout: () =>
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
        }),
    }),
    { name: "yuanchat-auth" },
  ),
);
