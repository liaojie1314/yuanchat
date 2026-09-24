/**
 * AdminLayout — 左侧导航 + 内容区（桌面优先，管理后台不做移动端适配）
 */
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  MessagesSquare,
  ShieldAlert,
  Flag,
  Sticker,
  ScrollText,
  LogOut,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";

const NAV = [
  { to: "/overview", icon: LayoutDashboard, labelKey: "admin.nav.overview" },
  { to: "/users", icon: Users, labelKey: "admin.nav.users" },
  { to: "/conversations", icon: MessagesSquare, labelKey: "admin.nav.conversations" },
  { to: "/messages", icon: ShieldAlert, labelKey: "admin.nav.messages" },
  { to: "/moderation", icon: Flag, labelKey: "admin.nav.moderation" },
  { to: "/sticker-packs", icon: Sticker, labelKey: "admin.nav.stickerPacks" },
  { to: "/audit-logs", icon: ScrollText, labelKey: "admin.nav.auditLogs" },
];

export function AdminLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-56 shrink-0 flex-col border-r border-outline-variant bg-surface-container-low">
        <div className="flex items-center gap-2 border-b border-outline-variant px-4 py-4">
          <div className="brand-gradient flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white">
            元
          </div>
          <span className="text-title-sm font-semibold text-on-surface">{t("admin.title")}</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {NAV.map(({ to, icon: Icon, labelKey }) => {
            const active = location.pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-label-lg font-medium transition-colors",
                  active
                    ? "bg-primary-container text-primary-on-container"
                    : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface",
                )}
              >
                <Icon size={18} />
                {t(labelKey)}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center justify-between border-t border-outline-variant px-4 py-3">
          <span className="truncate text-label-md text-on-surface-variant">{user?.nickname}</span>
          <button
            onClick={() => {
              logout();
              navigate("/login", { replace: true });
            }}
            aria-label={t("settings.logout")}
            className="rounded-lg p-1.5 text-on-surface-variant transition-colors hover:text-error"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto bg-surface p-6">
        <Outlet />
      </main>
    </div>
  );
}
