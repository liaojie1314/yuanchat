/**
 * MainLayout 组件 — 应用主布局（三栏结构）
 *
 * @description
 * 所有需要登录的页面的外层布局框架，使用 React Router 的 `<Outlet />` 渲染子路由。
 * 包含左侧导航栏（64px 宽）：
 * - 3 个导航入口：消息（/chat）、通讯录（/contacts）、设置（/settings）
 * - 底部主题切换按钮（亮色 ↔ 暗色）
 *
 * 导航高亮逻辑：当前路由路径匹配导航项的 `to` 时，该导航项高亮。
 * 主题切换直接操作 Zustand Store 的 `toggle` 方法。
 *
 * 此组件作为 React Router 的 Layout Route 使用：
 * ```tsx
 * <Route element={<MainLayout />}>
 *   <Route path="/chat" element={<ChatPage />} />
 * </Route>
 * ```
 *
 * @example
 * <MainLayout />
 */
import { Link, useLocation, Outlet } from "react-router-dom";
import { MessageCircle, Users, Settings, Sun, Moon, LogOut } from "lucide-react";
import { useThemeStore, useAuthStore } from "@yuanchat/shared";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";

const NAV_ITEMS = [
  { to: "/chat", icon: MessageCircle, label: "消息" },
  { to: "/contacts", icon: Users, label: "通讯录" },
  { to: "/settings", icon: Settings, label: "设置" },
];

export function MainLayout({ titleBar }: { titleBar?: ReactNode }) {
  const location = useLocation();
  // 新 API: mode("light"/"dark"), toggleMode()
  const { mode, toggleMode } = useThemeStore();
  const isDark = mode === "dark";
  const { logout } = useAuthStore();
  const { t } = useTranslation();

  return (
    <div className="bg-surface app-screen flex overflow-hidden">
      {/* 左侧品牌色导航栏 — 渐变背景 */}
      <nav className="nav-gradient shadow-elevation-2 flex w-16 shrink-0 flex-col items-center gap-1 py-4 text-white">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
          const isActive =
            to === "/chat"
              ? location.pathname.startsWith("/chat")
              : location.pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={`text-label-sm flex w-14 flex-col items-center gap-1 rounded-2xl py-2 transition-all duration-200 ${
                isActive
                  ? "shadow-elevation-1 bg-white/25 text-white backdrop-blur-sm"
                  : "text-white/70 hover:bg-white/15 hover:text-white"
              }`}
              title={label}
            >
              <Icon size={24} strokeWidth={isActive ? 2.5 : 1.5} />
              <span className="leading-none">{label}</span>
            </Link>
          );
        })}

        <div className="flex-1" />

        {/* 主题切换 — M3 图标按钮 */}
        <button
          onClick={toggleMode}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white/70 transition-all duration-200 hover:bg-white/15 hover:text-white"
          title={isDark ? "切换亮色模式" : "切换暗色模式"}
        >
          {isDark ? <Sun size={20} /> : <Moon size={20} />}
        </button>

        {/* 登出 */}
        <button
          onClick={logout}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white/70 transition-all duration-200 hover:bg-white/15 hover:text-white"
          title={t("settings.logout")}
        >
          <LogOut size={20} />
        </button>
      </nav>

      <div className="flex flex-1 flex-col overflow-hidden">
        {titleBar}
        <div className="flex flex-1 flex-col overflow-hidden">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
