/**
 * MainLayout 组件 — 应用主布局（响应式框架）
 *
 * @description
 * 所有需要登录的页面的外层布局框架，使用 React Router 的 `<Outlet />` 渲染子路由。
 *
 * 响应式两种形态（useBreakpoint 驱动）：
 * - **桌面 / 平板**：左侧品牌渐变导航栏（64px），含头像、导航入口、
 *   主题切换与登出按钮（登出唯一入口，设置页不重复提供）
 * - **手机**：底部 Material 3 导航条（带 pill 高亮 + 未读角标），
 *   聊天视图打开时自动隐藏，让消息流占满全屏
 *
 * 导航高亮逻辑：当前路由路径匹配导航项的 `to` 时，该导航项高亮。
 * 主题切换直接操作 Zustand Store 的 `toggleMode` 方法。
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
import { MessageCircle, Users, Settings, Star, Sticker, Sun, Moon, LogOut } from "lucide-react";
import {
  useThemeStore,
  useAuthStore,
  useChatBootstrap,
  useContactStore,
  useConversationStore,
  useBreakpoint,
} from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { useTranslation } from "react-i18next";
import { type ReactNode, useState, useEffect } from "react";
import { Avatar } from "../primitives/Avatar";
import { CallHost } from "../call/CallHost";
import { SearchModal } from "./SearchModal";
import { ToastHost } from "../primitives/Toast";

/**
 * 移动端底栏导航项（4 项均分全宽）。
 *
 * @remarks 表情商城不进底栏：商城属低频入口，5 项会把每项压到 20% 宽且
 * 挤占高频导航，移动端入口改放收藏页顶部与表情面板底部（桌面侧栏无此压力）。
 */
const MOBILE_NAV_ITEMS = [
  { to: "/chat", icon: MessageCircle, labelKey: "chat.title" },
  { to: "/contacts", icon: Users, labelKey: "contacts.title" },
  { to: "/favorites", icon: Star, labelKey: "favorites.title" },
  { to: "/settings", icon: Settings, labelKey: "settings.title" },
];

/** 桌面/平板左侧栏导航项：比底栏多一个表情商城入口（/stickers 及其子路由共用高亮） */
const DESKTOP_NAV_ITEMS = [
  ...MOBILE_NAV_ITEMS,
  { to: "/stickers", icon: Sticker, labelKey: "sticker.market.title" },
];

export function MainLayout({
  titleBar,
  callMode = "overlay",
}: {
  titleBar?: ReactNode;
  /**
   * 通话界面的承载方式。
   *
   * - `overlay`（默认）：本布局内挂 {@link CallHost} 浮层 —— Web / 移动端
   * - `window`：桌面端开独立原生窗口承载，本布局不挂浮层（否则主窗口与
   *   通话窗口会各建一路 `RTCPeerConnection`，同一人在房间里出现两次）
   */
  callMode?: "overlay" | "window";
}) {
  const location = useLocation();
  // 新 API: mode("light"/"dark"), toggleMode()
  const { mode, toggleMode } = useThemeStore();
  const isDark = mode === "dark";
  const { user, logout } = useAuthStore();
  const { t } = useTranslation();
  const bp = useBreakpoint();
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch((v) => !v);
      }
      if (e.key === "Escape") setShowSearch(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // 数据源接线：WS 连接挂在布局层，切页（聊天↔通讯录↔设置）不断连，
  // presence/消息帧全程可达；登出（布局卸载）时断开
  useChatBootstrap();

  const totalUnread = useConversationStore((s) =>
    s.conversations.reduce((sum, c) => sum + (c.isMuted ? 0 : c.unreadCount), 0),
  );
  const pendingRequests = useContactStore(
    (s) => s.requests.filter((r) => r.direction === "in" && r.status === 0).length,
  );
  const activeConvId = useConversationStore((s) => s.activeId);

  /** 导航项角标数：消息未读 / 通讯录待处理申请 */
  const badgeOf = (to: string) =>
    to === "/chat" ? totalUnread : to === "/contacts" ? pendingRequests : 0;

  const isActive = (to: string) =>
    to === "/chat" ? location.pathname.startsWith("/chat") : location.pathname.startsWith(to);

  // 手机端：聊天视图打开时隐藏底部导航，让消息流占满全屏
  const isMobile = bp === "mobile";
  const hideMobileNav = isMobile && location.pathname.startsWith("/chat") && !!activeConvId;

  if (isMobile) {
    return (
      <div className="bg-surface app-screen flex flex-col overflow-hidden">
        <ToastHost />
        {callMode === "overlay" ? <CallHost /> : null}
        <SearchModal show={showSearch} onClose={() => setShowSearch(false)} />
        {titleBar}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </div>

        {!hideMobileNav && (
          <nav
            /* 不写死高度：由「胶囊 36 + 间距 4 + 标签」自然撑开，配 pt-2 / pb-2 收紧留白。
               底部安全区走 env()：安卓侧 MainActivity 已按 systemBars 给 WebView 加过
               bottom padding，env() 在那里取 0，不会二次叠加（先前写死 pb-4 就是叠加出来的
               那截空白）；iOS Safari / PWA 没有原生下发，靠 env() 避开手势条。 */
            className="border-outline-variant bg-surface-container-low flex shrink-0 border-t pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)]"
            aria-label={t("chat.title")}
          >
            {MOBILE_NAV_ITEMS.map(({ to, icon: Icon, labelKey }) => {
              const active = isActive(to);
              const badge = badgeOf(to);
              return (
                <Link
                  key={to}
                  to={to}
                  className={cn(
                    "text-label-sm flex flex-1 flex-col items-center gap-1 font-medium transition-colors",
                    active ? "text-on-surface" : "text-on-surface-variant",
                  )}
                >
                  {/* 选中态胶囊用**像素**高度而非 h-9：本仓 root font-size 是 14px，
                      h-9(2.25rem) 只有 31.5px，22px 图标上下各剩 4.7px 仍贴边。
                      38px 留出 8px 呼吸量；宽度 64px 维持椭圆比例。 */}
                  <span
                    className={cn(
                      "relative flex h-[38px] min-w-[64px] items-center justify-center rounded-full transition-colors",
                      active && "bg-primary-container text-primary-on-container",
                    )}
                  >
                    <Icon size={22} strokeWidth={active ? 2.4 : 1.75} />
                    {badge > 0 && (
                      <span className="text-label-sm absolute -top-1 right-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 font-bold text-white">
                        {badge > 99 ? "99+" : badge}
                      </span>
                    )}
                  </span>
                  {t(labelKey)}
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    );
  }

  return (
    <div className="bg-surface app-screen flex overflow-hidden">
      <ToastHost />
      {callMode === "overlay" ? <CallHost /> : null}
      <SearchModal show={showSearch} onClose={() => setShowSearch(false)} />
      {/* 左侧品牌色导航栏 — 渐变背景 */}
      <nav className="nav-gradient shadow-elevation-2 z-20 flex w-16 shrink-0 flex-col items-center gap-1 py-3 text-white">
        {/* 我的头像 + 在线状态 */}
        <div className="mb-1">
          <Avatar name={user?.nickname ?? "我"} src={user?.avatarUrl} presence="online" />
        </div>
        <div className="mb-1 h-px w-8 bg-white/15" />

        {DESKTOP_NAV_ITEMS.map(({ to, icon: Icon, labelKey }) => {
          const active = isActive(to);
          const badge = badgeOf(to);
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                "text-label-sm relative flex w-14 flex-col items-center gap-1 rounded-lg py-2 transition-all duration-200",
                active
                  ? "shadow-elevation-1 bg-white/25 text-white backdrop-blur-sm"
                  : "text-white/70 hover:bg-white/15 hover:text-white",
              )}
              title={t(labelKey)}
            >
              <Icon size={24} strokeWidth={active ? 2.5 : 1.5} />
              <span className="w-full truncate px-0.5 text-center text-[10px] leading-none">
                {t(labelKey)}
              </span>
              {badge > 0 && (
                <span className="absolute top-1.5 right-3 h-2 w-2 rounded-full bg-red-500" />
              )}
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

        {/* 登出（设置页不再重复提供，桌面端唯一入口） */}
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
