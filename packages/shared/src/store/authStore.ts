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
 * 4. sessionFromTokens() → 已签发的令牌对（扫码登录）→ 存储 token 并拉 GET /users/me 补资料
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
import { apiGet, apiPost, setTokenProvider } from "../api/client";
import { setRefreshHandler } from "../api/tokenManager";
import { updateMyProfile } from "../api/users";
import type { ProfilePatch } from "../api/users";

// ========================================
// 类型定义
// ========================================

interface User {
  id: string;
  nickname: string;
  avatarUrl?: string | null;
  phone?: string;
  email?: string;
  /** QQ 号风格短号（元聊号） */
  shortId?: number;
  /** 个性签名 */
  bio?: string | null;
  /** 0=未知 1=男 2=女 */
  gender?: 0 | 1 | 2;
}

/** 后端 user JSON（snake_case） */
interface UserDTO {
  id: string;
  nickname: string;
  avatar_url?: string | null;
  phone?: string | null;
  email?: string | null;
  short_id?: number;
  bio?: string | null;
  gender?: number;
}

/** POST /api/v1/users/login 响应 */
interface LoginResponse {
  user: UserDTO;
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** 后端 POST /api/v1/auth/refresh 响应（无 user） */
interface RefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * 已签发的令牌对
 *
 * 扫码登录由手机端确认、服务端签发，被扫端只是把令牌取回来，
 * 因此需要一个不带账号密码的登录态入口。
 */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** access 令牌寿命（秒） */
  expiresIn: number;
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
    bio: dto.bio ?? undefined,
    gender: (dto.gender === 1 || dto.gender === 2 ? dto.gender : 0) as 0 | 1 | 2,
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
  /** 只清本地登录态，不调服务端；用于服务端令牌已失效的场景（如改密后 token_version 递增） */
  clearSession: () => void;
  /** 用已经签发好的令牌对建立登录态（扫码登录换出的令牌走这里，不带用户资料） */
  sessionFromTokens: (tokens: TokenPair) => Promise<void>;
  /** 更新我的资料并同步本地 user（设置页保存用） */
  updateProfile: (patch: ProfilePatch) => Promise<void>;
}

// ========================================
// Store 定义
// ========================================

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
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
        get().clearSession();
      },

      /**
       * 清空本地登录态（纯本地，不发请求）
       *
       * 服务端已经让令牌失效的场景用它：改密会把 token_version +1，
       * 此时再调 logout 只会拿 401，本地状态却必须立刻清干净。
       */
      clearSession: () => {
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          expiresAt: null,
          isAuthenticated: false,
        });
      },

      /**
       * 用已经签发好的令牌对建立登录态
       *
       * 扫码登录的令牌由手机端确认、服务端签发，被扫端只把它取回来，
       * 因此拿不到登录接口那份 user JSON —— 令牌先落地，再用它拉一次
       * `GET /users/me` 补齐资料。资料拉取失败时不留半个登录态：
       * 清干净并把错误抛给调用方，否则界面会顶着一个没有昵称头像的空账号。
       */
      sessionFromTokens: async (tokens: TokenPair) => {
        set({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: expiryOf(tokens.expiresIn),
        });
        try {
          const dto = await apiGet<UserDTO>("/api/v1/users/me");
          set({ user: mapUser(dto), isAuthenticated: true });
        } catch (e) {
          get().clearSession();
          throw e;
        }
      },

      /** 更新我的资料并同步本地 user（设置页保存用） */
      updateProfile: async (patch) => {
        const updated = await updateMyProfile(patch);
        set((s) => ({
          user: s.user
            ? {
                ...s.user,
                nickname: updated.nickname,
                avatarUrl: updated.avatarUrl,
                bio: updated.bio,
                gender: updated.gender,
              }
            : s.user,
        }));
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
      useAuthStore.getState().clearSession();
      return null;
    }
  },
});
