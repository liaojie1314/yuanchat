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
 * 3. logout() → POST /api/v1/auth/logout → 清空所有状态
 *
 * @example
 * ```tsx
 * const { loginWithPassword, isAuthenticated, user } = useAuthStore();
 * await loginWithPassword("13800000001", "password123");
 * if (isAuthenticated) navigate("/chat");
 * ```
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { apiPost } from "../api/client";

// ========================================
// Types
// ========================================

interface User {
  id: string;
  nickname: string;
  avatarUrl?: string | null;
  phone?: string;
  email?: string;
  /** QQ 号风格短号（元聊号） */
  shortId?: number;
}

/** 后端 user JSON（snake_case） */
interface UserDTO {
  id: string;
  nickname: string;
  avatar_url?: string | null;
  phone?: string | null;
  email?: string | null;
  short_id?: number;
}

/** POST /api/v1/users/login 响应 */
interface LoginResponse {
  user: UserDTO;
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

function mapUser(dto: UserDTO): User {
  return {
    id: dto.id,
    nickname: dto.nickname,
    avatarUrl: dto.avatar_url,
    phone: dto.phone ?? undefined,
    email: dto.email ?? undefined,
    shortId: dto.short_id,
  };
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;

  /** 账号（手机号/邮箱/元聊号）+ 密码登录 */
  loginWithPassword: (account: string, password: string) => Promise<void>;
  /** 密码注册 */
  registerWithPassword: (
    phone: string,
    password: string,
    captchaID: string,
    captchaAnswer: number,
    nickname: string,
  ) => Promise<void>;
  /** 登出（异步：先调 API 再清本地状态） */
  logout: () => Promise<void>;
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
       * 账号 + 密码登录
       * account 支持手机号 / 邮箱（后端 LoginRequest.Account）
       */
      loginWithPassword: async (account: string, password: string) => {
        const data = await apiPost<LoginResponse>("/api/v1/users/login", {
          account,
          password,
        });
        set({
          user: mapUser(data.user),
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
        captchaID: string,
        captchaAnswer: number,
        nickname: string,
      ) => {
        const data = await apiPost<LoginResponse>("/api/v1/users/register", {
          phone,
          password,
          captcha_id: captchaID,
          captcha_answer: captchaAnswer,
          nickname,
        });
        set({
          user: mapUser(data.user),
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          isAuthenticated: true,
        });
      },

      /**
       * 登出
       *
       * 先调用服务端登出接口使 token 失效，
       * 无论服务端是否成功都清除本地登录态。
       */
      logout: async () => {
        try {
          await apiPost("/api/v1/auth/logout", {});
        } catch {
          // 即使服务端调用失败也清除本地状态
        }
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
        });
      },
    }),
    { name: "yuanchat-auth" },
  ),
);
