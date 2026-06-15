/**
 * 认证状态管理 Store
 *
 * @description
 * 管理用户登录状态和 JWT Token 的生命周期。
 * 登录成功后存储用户信息和两个 Token（Access + Refresh），
 * 登出时清空所有状态。
 *
 * 当前为骨架实现，后续接入后端 API 时完善。
 *
 * Token 说明：
 * - accessToken（短期，15分钟）：每次 API 请求携带，用于鉴权
 * - refreshToken（长期，7天）：用于换取新的 accessToken
 *
 * @see server/internal/handler/user.go 后端登录接口
 */
import { create } from "zustand";

/** 用户基础信息 */
interface User {
  id: string;
  nickname: string;
  avatarUrl?: string | null;
  phone?: string;
  email?: string;
}

interface AuthState {
  /** 当前登录用户信息，null 表示未登录 */
  user: User | null;
  /** 短期访问令牌（JWT Access Token） */
  accessToken: string | null;
  /** 长期刷新令牌（JWT Refresh Token） */
  refreshToken: string | null;
  /** 是否已通过认证（快捷判断） */
  isAuthenticated: boolean;
  /** 登录成功后的状态更新 */
  login: (user: User, accessToken: string, refreshToken: string) => void;
  /** 登出，清空所有认证状态 */
  logout: () => void;
  /** 更新当前用户的部分资料 */
  updateUser: (partial: Partial<User>) => void;
}

/**
 * 认证 Store Hook
 *
 * @example
 * // 登录
 * const login = useAuthStore((s) => s.login);
 * login(user, accessToken, refreshToken);
 *
 * @example
 * // 在路由守卫中检查登录状态
 * const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
 * if (!isAuthenticated) return <Navigate to="/login" />;
 */
export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,

  login: (user, accessToken, refreshToken) =>
    set({ user, accessToken, refreshToken, isAuthenticated: true }),

  logout: () =>
    set({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
    }),

  updateUser: (partial) =>
    set((s) => ({
      user: s.user ? { ...s.user, ...partial } : null,
    })),
}));
