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
import { MessageCircle, Users, Settings, Sun, Moon } from "lucide-react";
import { useThemeStore } from "@yuanchat/shared";

const NAV_ITEMS = [
  { to: "/chat", icon: MessageCircle, label: "消息" },
  { to: "/contacts", icon: Users, label: "通讯录" },
  { to: "/settings", icon: Settings, label: "设置" },
];

export function MainLayout() {
  const location = useLocation();
  // 新 API: mode("light"/"dark"), toggleMode()
  const { mode, toggleMode } = useThemeStore();
  const isDark = mode === "dark";

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      {/* 导航栏 — 使用 primary-container 背景，突出品牌色 */}
      <nav className="flex flex-col items-center w-16 shrink-0 py-4 gap-1"
        style={{ background: `linear-gradient(180deg, rgb(var(--md-sys-color-primary-container)) 0%, rgb(var(--md-sys-color-surface-container-low)) 100%)` }}>
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
          const isActive = to === "/chat"
            ? location.pathname.startsWith("/chat")
            : location.pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={`flex flex-col items-center gap-1 px-2 py-2 rounded-2xl text-label-sm transition-all duration-200 ${
                isActive
                  ? "bg-primary text-primary-on shadow-elevation-2"
                  : "text-on-surface-variant hover:bg-surface-container-high"
              }`}
              title={label}
            >
              <Icon size={24} strokeWidth={isActive ? 2.5 : 1.5} />
              <span className="leading-none">{label}</span>
            </Link>
          );
        })}

        <div className="flex-1" />

        <button
          onClick={toggleMode}
          className="md3-icon-btn text-on-surface-variant"
          title={isDark ? "切换亮色模式" : "切换暗色模式"}
        >
          {isDark ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      </nav>

      <Outlet />
    </div>
  );
}
