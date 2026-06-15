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
  const { mode, toggleMode } = useThemeStore();

  return (
    <div className="flex h-screen overflow-hidden bg-surface-50 dark:bg-slate-900">
      {/* 左侧品牌色导航栏 — Discord/Slack 风格 */}
      <nav className="flex flex-col items-center w-14 shrink-0 bg-brand-600 dark:bg-brand-800 py-3 gap-1">
        {/* Logo */}
        <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center mb-2">
          <MessageCircle size={20} className="text-white" />
        </div>

        {NAV_ITEMS.map(({ to, icon: Icon }) => {
          const isActive = to === "/chat"
            ? location.pathname.startsWith("/chat")
            : location.pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={`w-11 h-11 flex items-center justify-center rounded-xl transition-all duration-150 ${
                isActive
                  ? "bg-white/20 text-white"
                  : "text-white/60 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon size={22} strokeWidth={isActive ? 2.5 : 1.5} />
            </Link>
          );
        })}

        <div className="flex-1" />

        {/* 主题切换 */}
        <button
          onClick={toggleMode}
          className="w-11 h-11 flex items-center justify-center rounded-xl text-white/60 hover:bg-white/10 hover:text-white transition-all duration-150"
        >
          {mode === "dark" ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      </nav>

      {/* 主内容 */}
      <Outlet />
    </div>
  );
}
