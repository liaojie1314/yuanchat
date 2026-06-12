import { create } from "zustand";

interface User {
  id: string;
  nickname: string;
  avatarUrl?: string | null;
  phone?: string;
  email?: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  login: (user: User, accessToken: string, refreshToken: string) => void;
  logout: () => void;
  updateUser: (partial: Partial<User>) => void;
}

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
