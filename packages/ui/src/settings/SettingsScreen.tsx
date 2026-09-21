/**
 * SettingsScreen 组件 — 设置主界面（三端响应式，v0.2 重设计）
 *
 * @description
 * 三端形态（useBreakpoint 驱动）：
 *
 * - **desktop / tablet（≥768px）**：左列 280px 分组导航（含用户 hero 卡片：
 *   头像 + 昵称 + 元聊号 + 状态点；4 组导航项 with icon/说明）｜右内容区
 *   最大宽 640px 居中显示所选分组内容，去掉重复退出登录（收敛在左侧栏）
 * - **mobile（<768px）**：view==="index" 渲染全屏分组列表（用户 hero + 分组行
 *   + 退出 + 版本号）；选中后栈式推入子页
 *
 * 语言/主题切换即时生效；移动端退出登录点击弹行内确认态（不做全局 Dialog）。
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  ChevronRight,
  LogOut,
  ShieldCheck,
  Palette,
  Info,
  User,
  ArrowLeft,
  Sticker,
  Star,
  Smile,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { registerBackInterceptor, useAuthStore, useBreakpoint } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { Avatar } from "../primitives/Avatar";
import { ProfileEditView } from "./ProfileEditView";
import { AccountSection, AppearanceSection, AboutSection } from "./SettingsSections";
import { APP_VERSION } from "./settingsUtils";
import { ConfirmDialog } from "../primitives/ConfirmDialog";
import { ChangePasswordDialog } from "../auth/ChangePasswordDialog";
import { UserStatusEditor } from "./UserStatusEditor";

/** 设置内容区视图 */
type SettingsView = "index" | "profile" | "account" | "appearance" | "about";

/** 设置页分组项：view 为设置页内部视图切换，route 为跳走的独立页面。 */
type SettingsNavItem =
  | { kind: "view"; view: SettingsView; icon: typeof User; labelKey: string; descKey: string }
  | { kind: "route"; to: string; icon: typeof User; labelKey: string; descKey: string };

/**
 * 设置页分组顺序（移动端列表与桌面左列共用同一数组，保证两端顺序一致）。
 *
 * 收藏与表情商城是 route 项：它们是独立路由页而非设置页内部视图，
 * 跳转带 `state.from` 供安卓返回键回到设置页。收藏自底栏移出后，
 * 这里是桌面端唯一的收藏入口 —— 两端共用一份数组正是为了不再漏掉一端。
 */
const SETTINGS_NAV: SettingsNavItem[] = [
  {
    kind: "view",
    view: "account",
    icon: ShieldCheck,
    labelKey: "settings.account",
    descKey: "settings.accountDesc",
  },
  {
    kind: "view",
    view: "appearance",
    icon: Palette,
    labelKey: "settings.appearance",
    descKey: "settings.appearanceDesc",
  },
  {
    kind: "route",
    to: "/stickers",
    icon: Sticker,
    labelKey: "settings.stickerMarket",
    descKey: "settings.stickerMarketDesc",
  },
  {
    kind: "route",
    to: "/favorites",
    icon: Star,
    labelKey: "favorites.title",
    descKey: "settings.favoritesDesc",
  },
  {
    kind: "view",
    view: "about",
    icon: Info,
    labelKey: "settings.about",
    descKey: "settings.aboutDesc",
  },
];

/** 列表 key：view 项用视图名，route 项用路由，两者不会撞 */
const navKey = (item: SettingsNavItem) => (item.kind === "view" ? item.view : item.to);

export function SettingsScreen({ aboutExtra }: { aboutExtra?: ReactNode } = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const bp = useBreakpoint();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const isMobile = bp === "mobile";
  // 桌面/平板默认选中个人资料；移动端从 index 列表开始
  const [view, setView] = useState<SettingsView>("profile");
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  /** 分组行点击：内部视图切 view，独立页面带来源跳走 */
  const onNavClick = (item: SettingsNavItem) => {
    if (item.kind === "route") navigate(item.to, { state: { from: "/settings" } });
    else setView(item.view);
  };

  // 安卓返回键：手机端子页是组件内部状态而非路由，不拦截的话按返回会被当成
  // 「已在 /settings 根页面」而走退出应用流程，用户预期是先退回设置列表。
  // 改密弹窗开着时先关弹窗，再退子页。
  useEffect(() => {
    if (!isMobile) return;
    return registerBackInterceptor(() => {
      if (changePwdOpen) {
        setChangePwdOpen(false);
        return true;
      }
      if (confirmLogout) {
        setConfirmLogout(false);
        return true;
      }
      if (view !== "index") {
        setView("index");
        return true;
      }
      return false;
    });
  }, [isMobile, changePwdOpen, confirmLogout, view]);

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
            <AccountSection
              phone={user?.phone}
              email={user?.email}
              shortId={user?.shortId}
              onChangePassword={() => setChangePwdOpen(true)}
            />
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
            <AboutSection extra={aboutExtra} />
          </MobileHeader>
        );
      default:
        return null;
    }
  };

  /** Hero 用户卡片：头像 + 昵称 + 元聊号；桌面端点击进 profile，移动端进 profile 子页 */
  const heroCard = (
    <button
      onClick={() => setView("profile")}
      className={cn(
        "group relative flex w-full items-center gap-4 overflow-hidden rounded-lg p-4 text-left transition-all",
        !isMobile && view === "profile"
          ? "bg-primary-container/40"
          : "bg-surface-container hover:bg-surface-container-high",
      )}
    >
      {/* 装饰渐变环，仅桌面端右上角 */}
      {!isMobile && (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-8 -right-8 h-24 w-24 rounded-full opacity-30 blur-2xl"
          style={{
            background:
              "radial-gradient(circle, rgb(var(--md-sys-color-primary-rgb) / 60%), transparent)",
          }}
        />
      )}
      <Avatar
        name={user?.nickname ?? "?"}
        src={user?.avatarUrl}
        size="lg"
        presence="online"
        statusEmoji={user?.statusEmoji}
      />
      <div className="min-w-0 flex-1">
        <p className="text-title-md text-on-surface truncate font-semibold">
          {user?.nickname ?? t("settings.profile")}
        </p>
        {user?.shortId !== undefined && (
          <p className="text-label-md text-on-surface-variant mt-0.5 truncate">
            {t("contacts.yuanId")} · {user.shortId}
          </p>
        )}
        {user?.bio && (
          <p className="text-label-md text-on-surface-variant mt-1 truncate opacity-80">
            {user.bio}
          </p>
        )}
      </div>
      <ChevronRight size={18} className="text-on-surface-variant shrink-0" />
    </button>
  );

  /**
   * 个人状态入口（hero 卡片下方独立一行）。
   *
   * 不并进 SETTINGS_NAV：那是「分组导航」，点进去是一屏内容；这行是就地改一个值，
   * 而且要把当前状态直接显示出来（未设置时显示占位），语义与视觉都是另一档。
   */
  const statusRow = (
    <button
      onClick={() => setStatusOpen(true)}
      className="bg-surface-container hover:bg-surface-container-high flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors"
    >
      <span className="bg-primary-container/60 text-primary-on-container flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
        {user?.statusEmoji ? (
          <span className="text-[17px] leading-none">{user.statusEmoji}</span>
        ) : (
          <Smile size={18} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <span className="text-body-md text-on-surface block font-medium">
          {t("settings.userStatus")}
        </span>
        <span className="text-label-sm text-on-surface-variant block truncate">
          {user?.statusText || user?.statusEmoji || t("settings.userStatusUnset")}
        </span>
      </div>
      <ChevronRight size={18} className="text-on-surface-variant shrink-0" />
    </button>
  );

  /**
   * 退出登录入口（仅移动端渲染；桌面端走左侧导航栏）
   *
   * 确认走 ConfirmDialog 而不是行内展开两个按钮：退出是破坏性动作，
   * 与全局其他破坏性操作（删好友、清空记录）保持同一种确认形态，
   * 也避免行内展开把下方内容顶动。
   */
  const logoutBlock = (
    <button
      onClick={() => setConfirmLogout(true)}
      className="text-error hover:bg-error/10 text-label-lg flex w-full items-center justify-center gap-2 rounded-lg py-2.5 font-medium transition-colors"
    >
      <LogOut size={18} />
      {t("settings.logout")}
    </button>
  );

  const logoutDialog = (
    <ConfirmDialog
      open={confirmLogout}
      title={t("settings.logout")}
      message={t("settings.logoutConfirm")}
      confirmLabel={t("common.confirm")}
      danger
      onConfirm={() => {
        setConfirmLogout(false);
        void logout();
      }}
      onCancel={() => setConfirmLogout(false)}
    />
  );

  // ── 手机端：index 全屏列表 ↔ 子页栈式 ──
  if (isMobile) {
    if (view !== "index") {
      return (
        <div className="bg-surface flex min-h-0 flex-1 flex-col overflow-y-auto px-4">
          {renderContent(() => setView("index"))}
          {/* 改密入口在「账号与安全」子页里，弹窗必须同屏挂载，
              否则点了没反应、退回列表才看到 */}
          <ChangePasswordDialog open={changePwdOpen} onClose={() => setChangePwdOpen(false)} />
        </div>
      );
    }
    return (
      <div className="bg-surface flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        <h1 className="text-title-lg text-on-surface mb-4 px-1 font-semibold">
          {t("settings.title")}
        </h1>
        <div className="mb-3">{heroCard}</div>
        <div className="mb-4">{statusRow}</div>
        <div className="mb-4 flex flex-col gap-1">
          {SETTINGS_NAV.map((item) => (
            <MobileNavRow
              key={navKey(item)}
              icon={item.icon}
              label={t(item.labelKey)}
              desc={t(item.descKey)}
              onClick={() => onNavClick(item)}
            />
          ))}
        </div>
        <div className="mb-4">{logoutBlock}</div>
        <p className="text-label-sm text-on-surface-variant mt-auto pt-4 text-center">
          {t("settings.version")} {APP_VERSION}
        </p>
        {logoutDialog}
        <ChangePasswordDialog open={changePwdOpen} onClose={() => setChangePwdOpen(false)} />
        <UserStatusEditor open={statusOpen} onClose={() => setStatusOpen(false)} />
      </div>
    );
  }

  // ── 桌面 / 平板：左导航 280px + 右内容居中卡片 ──
  return (
    <div className="bg-surface flex min-h-0 flex-1 overflow-hidden">
      {/* 左列分组导航 */}
      <aside className="border-outline-variant bg-surface-container-lowest flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r p-4">
        {heroCard}
        {statusRow}
        <div className="mt-2 flex flex-col gap-1">
          {SETTINGS_NAV.map((item) => {
            // route 项是跳走的独立页面，永不在左列高亮
            const active = item.kind === "view" && view === item.view;
            return (
              <button
                key={navKey(item)}
                onClick={() => onNavClick(item)}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                  active
                    ? "bg-primary-container/60 text-primary-on-container"
                    : "text-on-surface hover:bg-surface-container",
                )}
              >
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                    active
                      ? "bg-primary text-primary-on"
                      : "bg-surface-container-high text-on-surface-variant group-hover:bg-surface-container-highest",
                  )}
                >
                  <item.icon size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="text-body-md block font-medium">{t(item.labelKey)}</span>
                  <span className="text-label-sm text-on-surface-variant block truncate">
                    {t(item.descKey)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* 右内容区：居中卡片，最大宽 640 */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-8 py-8">{renderContent(() => setView("profile"))}</div>
      </div>
      <UserStatusEditor open={statusOpen} onClose={() => setStatusOpen(false)} />
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

/** 移动端分组行：图标 + 主标 + 副标 + 右箭头 */
function MobileNavRow({
  icon: Icon,
  label,
  desc,
  onClick,
}: {
  icon: typeof User;
  label: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="bg-surface-container hover:bg-surface-container-high flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors"
    >
      <span className="bg-primary-container/60 text-primary-on-container flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
        <Icon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <span className="text-body-lg text-on-surface block truncate font-medium">{label}</span>
        <span className="text-label-sm text-on-surface-variant block truncate">{desc}</span>
      </div>
      <ChevronRight size={18} className="text-on-surface-variant shrink-0" />
    </button>
  );
}
