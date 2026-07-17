/**
 * SettingsScreen 组件 — 设置主界面（三端响应式）
 *
 * @description
 * 对齐 docs/design/04_SETTINGS_PAGE.md 子集，三端形态（useBreakpoint 驱动）：
 *
 * - **desktop / tablet（≥768px）**：左列 240px 分组导航（个人资料卡片 + 4 组项
 *   + 底部退出登录）｜右内容区渲染选中 view，默认选 "profile"
 * - **mobile（<768px）**：view==="index" 渲染全屏分组列表（用户卡片 + 分组行
 *   + 退出 + 版本号居中）；选中后栈式推入子页（子页自带返回箭头）
 *
 * 语言/主题切换即时生效；退出登录点击弹行内确认态（不做全局 Dialog）。
 * 挂载时对齐 i18n.language 与已持久化的 themeStore.locale。
 */
import { useEffect, useState } from "react";
import { ChevronRight, LogOut, ShieldCheck, Palette, Info, User, ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStore, useThemeStore, useBreakpoint } from "@yuanchat/shared";
import i18n from "@yuanchat/design-system/i18n";
import { cn } from "@yuanchat/shared/utils";
import { Avatar } from "./Avatar";
import { ProfileEditView } from "./ProfileEditView";
import { AccountSection, AppearanceSection, AboutSection } from "./SettingsSections";
import { APP_VERSION } from "./settingsUtils";

/** 设置内容区视图 */
type SettingsView = "index" | "profile" | "account" | "appearance" | "about";

/** 分组导航项（不含 profile：profile 单独作卡片渲染） */
const NAV_GROUPS: { view: SettingsView; icon: typeof User; labelKey: string }[] = [
  { view: "account", icon: ShieldCheck, labelKey: "settings.account" },
  { view: "appearance", icon: Palette, labelKey: "settings.appearance" },
  { view: "about", icon: Info, labelKey: "settings.about" },
];

export function SettingsScreen() {
  const { t } = useTranslation();
  const bp = useBreakpoint();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const locale = useThemeStore((s) => s.locale);

  const isMobile = bp === "mobile";
  // 桌面/平板默认选中个人资料；移动端从 index 列表开始
  const [view, setView] = useState<SettingsView>("profile");
  const [confirmLogout, setConfirmLogout] = useState(false);

  // 挂载时对齐 i18n 语言与已持久化的 locale（main.tsx 初始 lng 由 detectLocale）
  useEffect(() => {
    if (locale !== i18n.language) {
      void i18n.changeLanguage(locale);
    }
  }, [locale]);

  // 移动端首屏应落在 index；断点切回桌面时确保有选中项
  useEffect(() => {
    setView(isMobile ? "index" : "profile");
  }, [isMobile]);

  /** 右内容区：按 view 渲染对应子视图 */
  const renderContent = (onBack: () => void) => {
    switch (view) {
      case "profile":
        return <ProfileEditView onBack={onBack} />;
      case "account":
        return (
          <MobileHeader show={isMobile} title={t("settings.account")} onBack={onBack}>
            <AccountSection phone={user?.phone} email={user?.email} shortId={user?.shortId} />
          </MobileHeader>
        );
      case "appearance":
        return (
          <MobileHeader show={isMobile} title={t("settings.appearance")} onBack={onBack}>
            <AppearanceSection />
          </MobileHeader>
        );
      case "about":
        return (
          <MobileHeader show={isMobile} title={t("settings.about")} onBack={onBack}>
            <AboutSection />
          </MobileHeader>
        );
      default:
        return null;
    }
  };

  const profileCard = (
    <button
      onClick={() => setView("profile")}
      className={cn(
        "hover:bg-surface-container-high flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors",
        !isMobile && view === "profile" && "bg-surface-container-high",
      )}
    >
      <Avatar name={user?.nickname ?? "?"} src={user?.avatarUrl} size="lg" presence="online" />
      <div className="min-w-0 flex-1">
        <p className="text-title-sm text-on-surface truncate font-semibold">{user?.nickname}</p>
        {user?.shortId !== undefined && (
          <p className="text-label-md text-on-surface-variant truncate">
            {t("contacts.yuanId")}: {user.shortId}
          </p>
        )}
      </div>
      {isMobile && <ChevronRight size={18} className="text-on-surface-variant shrink-0" />}
    </button>
  );

  /** 退出登录：行内两按钮确认态 */
  const logoutBlock = confirmLogout ? (
    <div className="flex flex-col gap-2 px-1">
      <p className="text-body-sm text-on-surface-variant text-center">
        {t("settings.logoutConfirm")}
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => void logout()}
          className="text-label-lg bg-error text-error-on flex-1 rounded-xl py-2.5 font-medium"
        >
          {t("common.confirm")}
        </button>
        <button
          onClick={() => setConfirmLogout(false)}
          className="text-label-lg border-outline-variant text-on-surface flex-1 rounded-xl border py-2.5 font-medium"
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
  ) : (
    <button
      onClick={() => setConfirmLogout(true)}
      className="text-error hover:bg-error/10 text-label-lg flex w-full items-center justify-center gap-2 rounded-xl py-2.5 font-medium transition-colors"
    >
      <LogOut size={18} />
      {t("settings.logout")}
    </button>
  );

  // ── 手机端：index 全屏列表 ↔ 子页栈式 ──
  if (isMobile) {
    if (view !== "index") {
      return (
        <div className="bg-surface flex min-h-0 flex-1 flex-col overflow-y-auto px-4">
          {renderContent(() => setView("index"))}
        </div>
      );
    }
    return (
      <div className="bg-surface flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        <h1 className="text-title-lg text-on-surface mb-4 px-1 font-semibold">
          {t("settings.title")}
        </h1>
        <div className="bg-surface-container-low mb-4 rounded-2xl p-1">{profileCard}</div>
        <div className="bg-surface-container-low mb-4 overflow-hidden rounded-2xl">
          {NAV_GROUPS.map((g) => (
            <GroupRow
              key={g.view}
              icon={g.icon}
              label={t(g.labelKey)}
              onClick={() => setView(g.view)}
            />
          ))}
        </div>
        <div className="mb-4">{logoutBlock}</div>
        <p className="text-label-sm text-on-surface-variant mt-auto pt-4 text-center">
          {t("settings.version")} {APP_VERSION}
        </p>
      </div>
    );
  }

  // ── 桌面 / 平板：左导航 240px + 右内容 ──
  return (
    <div className="bg-surface flex min-h-0 flex-1 overflow-hidden">
      {/* 左列分组导航 */}
      <aside className="border-outline-variant bg-surface-container-low flex w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r p-3">
        {profileCard}
        <div className="my-1 h-px w-full" />
        {NAV_GROUPS.map((g) => {
          const active = view === g.view;
          return (
            <button
              key={g.view}
              onClick={() => setView(g.view)}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                active
                  ? "bg-surface-container-high text-on-surface"
                  : "text-on-surface-variant hover:bg-surface-container-high",
              )}
            >
              <g.icon size={18} className="shrink-0" />
              <span className="text-body-md flex-1 font-medium">{t(g.labelKey)}</span>
            </button>
          );
        })}
        <div className="mt-auto pt-2">{logoutBlock}</div>
      </aside>

      {/* 右内容区 */}
      <div className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
        {renderContent(() => setView("profile"))}
      </div>
    </div>
  );
}

/** 移动端子页顶部返回头（桌面端 show=false 时仅渲染内容） */
function MobileHeader({
  show,
  title,
  onBack,
  children,
}: {
  show: boolean;
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  if (!show) return <>{children}</>;
  return (
    <div className="flex flex-col">
      <header className="-mx-4 flex h-12 items-center px-2">
        <button
          className="md3-icon-btn text-on-surface-variant"
          onClick={onBack}
          aria-label={t("chat.back")}
        >
          <ArrowLeft size={20} />
        </button>
        <span className="text-title-sm text-on-surface font-semibold">{title}</span>
      </header>
      <div className="pt-2">{children}</div>
    </div>
  );
}

/** 移动端分组行 */
function GroupRow({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof User;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="border-outline-variant hover:bg-surface-container-high flex h-14 w-full items-center gap-3 border-b px-4 text-left transition-colors last:border-b-0"
    >
      <Icon size={20} className="text-on-surface-variant shrink-0" />
      <span className="text-body-md text-on-surface flex-1">{label}</span>
      <ChevronRight size={18} className="text-on-surface-variant shrink-0" />
    </button>
  );
}
