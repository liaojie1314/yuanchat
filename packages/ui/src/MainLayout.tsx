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

/** 左侧导航栏配置：路径、图标组件、中文标签 */
const NAV_ITEMS = [
  { to: "/chat", icon: MessageCircle, label: "消息" },
  { to: "/contacts", icon: Users, label: "通讯录" },
  { to: "/settings", icon: Settings, label: "设置" },
];

export function MainLayout() {
  // useLocation：React Router Hook，返回当前浏览器 URL 信息
  const location = useLocation();
  // 从 Zustand 主题 Store 读取暗色模式状态和切换函数
  const { isDark, toggle } = useThemeStore();

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-neutral-900">
      {/* 左侧导航栏 */}
      <nav className="flex flex-col items-center w-16 shrink-0 bg-neutral-100 dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800 py-4 gap-2">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
          // 判断当前路由是否与导航项匹配（"/chat" 也匹配 "/chat/xxx"）
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
