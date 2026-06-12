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
  const { isDark, toggle } = useThemeStore();

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-neutral-900">
      {/* 左侧导航栏 */}
      <nav className="flex flex-col items-center w-16 shrink-0 bg-neutral-100 dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800 py-4 gap-2">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
          const isActive = to === "/chat"
            ? location.pathname.startsWith("/chat")
            : location.pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl text-xs transition-colors ${
                isActive
                  ? "text-primary-500 bg-primary-50 dark:bg-primary-900/30"
                  : "text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-800"
              }`}
              title={label}
            >
              <Icon size={22} strokeWidth={isActive ? 2.5 : 1.5} />
              <span className="leading-none">{label}</span>
            </Link>
          );
        })}

        <div className="flex-1" />

        {/* 主题切换 */}
        <button
          onClick={toggle}
          className="p-2 rounded-xl text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors"
          title={isDark ? "切换亮色模式" : "切换暗色模式"}
        >
          {isDark ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      </nav>

      {/* 主内容区域 */}
      <Outlet />
    </div>
  );
}
