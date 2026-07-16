/**
 * 认证状态管理 Store — JWT 双 Token
 *
 * @description
 * 管理用户登录/注册流程，存储 Access Token（15min）和 Refresh Token（7天）。
 * 使用 Zustand persist 中间件持久化 token 到 localStorage，刷新后自动恢复登录态。
 *
 * 静默刷新（滑动会话）：expiresAt 记录 access 过期时刻，
 * api/tokenManager 在临近过期或 401 时调用此处注册的 refresh handler
 * 置换全新 token 对；refresh 也失效时自动清登录态回登录页。
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
import { apiPost, setTokenProvider } from "../api/client";
import { setRefreshHandler } from "../api/tokenManager";

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

/** POST /api/v1/auth/refresh 响应（无 user） */
interface RefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** expires_in（秒）→ 本地过期时刻（Unix ms） */
function expiryOf(expiresInSec: number): number {
  return Date.now() + expiresInSec * 1000;
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
  /** access token 过期时刻（Unix ms），静默刷新判据 */
  expiresAt: number | null;
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
      expiresAt: null,
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
          expiresAt: expiryOf(data.expires_in),
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
          expiresAt: expiryOf(data.expires_in),
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
          expiresAt: null,
          isAuthenticated: false,
        });
      },
    }),
    { name: "yuanchat-auth" },
  ),
);

// ========================================
// API 层接线（模块加载即注册，不依赖任何页面组件挂载——
// 直接刷新进 /contacts 等非聊天页时 REST 也能带上 Authorization）
// ========================================

setTokenProvider(() => useAuthStore.getState().accessToken);

setRefreshHandler({
  getExpiresAt: () => {
    const s = useAuthStore.getState();
    // 未登录或没有 refresh token 时不触发刷新
    if (!s.isAuthenticated || !s.refreshToken) return null;
    return s.expiresAt ?? null;
  },

  refresh: async () => {
    const { refreshToken } = useAuthStore.getState();
    if (!refreshToken) return null;
    try {
      const data = await apiPost<RefreshResponse>("/api/v1/auth/refresh", {
        refresh_token: refreshToken,
      });
      useAuthStore.setState({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: expiryOf(data.expires_in),
      });
      return data.access_token;
    } catch {
      // refresh 也失效：清登录态，路由守卫自动回登录页
      useAuthStore.setState({
        user: null,
        accessToken: null,
        refreshToken: null,
        expiresAt: null,
        isAuthenticated: false,
      });
      return null;
    }
  },
});
