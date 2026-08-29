/**
 * SettingsSections — 设置页右侧内容区子视图（v0.2 重设计）
 *
 * @description
 * 从 SettingsScreen 拆出的内容区组件：
 * - AccountSection：分组卡片风信息行（图标 + 标签 + 值 + 复制）
 * - AppearanceSection：主题双卡片可视化选择 + 语言分段控件（Segmented）
 * - AboutSection：品牌 hero + 版本 + 内部链接（相关信息列表）
 */
import { useState, type ReactNode } from "react";
import {
  BadgeCheck,
  Check,
  Copy,
  Github,
  Globe,
  Info,
  Key,
  Mail,
  Moon,
  Phone,
  Sun,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useBreakpoint, useThemeStore } from "@yuanchat/shared";
import { SUPPORTED_LOCALES } from "@yuanchat/design-system/i18n";
import { cn } from "@yuanchat/shared/utils";
import { copyText } from "./copyText";
import { E2EESection } from "./E2EESection";
import { APP_VERSION, maskPhone } from "./settingsUtils";

/** 分组标题 + 副标（页面级） */
/**
 * 子页标题块
 *
 * 移动端整块不渲染：那里的标题已由 MobileHeader 的顶栏承担，再画一遍就是同屏两个标题，
 * 而描述又与上一级列表项里的说明逐字相同，属纯重复。桌面/平板没有顶栏，仍需要它。
 */
function SectionHeader({ title, desc }: { title: string; desc?: string }) {
  const bp = useBreakpoint();
  if (bp === "mobile") return null;
  return (
    <div className="mb-4">
      <h2 className="text-title-lg text-on-surface font-semibold">{title}</h2>
      {desc && <p className="text-body-sm text-on-surface-variant mt-1">{desc}</p>}
    </div>
  );
}

/** 信息卡片：合并多行为一张卡，行间加分隔线 */
function InfoCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface-container divide-outline-variant divide-y overflow-hidden rounded-lg">
      {children}
    </div>
  );
}

/** 信息卡片行：图标 + 标签 + 值 + 可选右侧动作（copy / 链接） */
function InfoRow({
  icon: Icon,
  label,
  value,
  copyable,
  action,
}: {
  icon: typeof Phone;
  label: string;
  value: string;
  copyable?: boolean;
  action?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    void copyText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">
      <span className="bg-surface-container-high text-on-surface-variant flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
        <Icon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-label-md text-on-surface-variant">{label}</p>
        <p className="text-body-md text-on-surface mt-0.5 truncate">{value}</p>
      </div>
      {copyable && (
        <button
          onClick={onCopy}
          className="md3-icon-btn text-on-surface-variant !h-8 !w-8 shrink-0"
          aria-label={copied ? t("profile.copied") : t("profile.copy")}
        >
          {copied ? <Check size={16} className="text-primary" /> : <Copy size={16} />}
        </button>
      )}
      {action}
    </div>
  );
}

/** 账号与安全：信息卡片 + 修改密码占位入口 */
export function AccountSection({
  phone,
  email,
  shortId,
  onChangePassword,
}: {
  phone?: string;
  email?: string;
  shortId?: number;
  /** 进入改密链路；不传则该入口保持禁用（宿主未提供路由时不该给出死按钮） */
  onChangePassword?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <SectionHeader title={t("settings.account")} desc={t("settings.accountDesc")} />
      {/* 端到端加密：开关 + PIN 备份/恢复 */}
      <E2EESection />
      <InfoCard>
        <InfoRow
          icon={Phone}
          label={t("settings.phone")}
          value={phone ? maskPhone(phone) : t("settings.notBound")}
        />
        <InfoRow icon={Mail} label={t("settings.email")} value={email || t("settings.notBound")} />
        {shortId !== undefined && (
          <InfoRow
            icon={BadgeCheck}
            label={t("contacts.yuanId")}
            value={String(shortId)}
            copyable
          />
        )}
        <button
          type="button"
          disabled={onChangePassword === undefined}
          onClick={onChangePassword}
          className={cn(
            "flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left",
            onChangePassword === undefined
              ? "text-on-surface-variant opacity-60"
              : "hover:bg-surface-container-high",
          )}
        >
          <span className="bg-surface-container-high flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
            <Key size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-body-md text-on-surface">{t("settings.changePassword")}</p>
            <p className="text-label-sm text-on-surface-variant mt-0.5">
              {onChangePassword === undefined
                ? t("common.comingSoon")
                : t("settings.changePasswordHint")}
            </p>
          </div>
        </button>
      </InfoCard>
    </div>
  );
}

/** 主题双卡片：亮色 / 暗色可视化选择 */
function ThemeCards() {
  const { t } = useTranslation();
  const mode = useThemeStore((s) => s.mode);
  const toggleMode = useThemeStore((s) => s.toggleMode);
  const isDark = mode === "dark";

  return (
    <div className="grid grid-cols-2 gap-3">
      <button
        onClick={() => !isDark || toggleMode()}
        className={cn(
          "group relative overflow-hidden rounded-lg border-2 p-3 text-left transition-all",
          !isDark
            ? "border-primary shadow-elevation-1"
            : "border-outline-variant hover:border-primary/50",
        )}
      >
        {/* 亮色缩略预览 */}
        <div className="mb-2 h-20 overflow-hidden rounded-lg bg-white">
          <div className="flex h-full">
            <div className="w-1/3 bg-slate-100" />
            <div className="flex-1 p-1.5">
              <div className="mb-1 h-1.5 w-8 rounded-full bg-slate-300" />
              <div className="mb-1 h-1.5 w-full rounded-full bg-slate-200" />
              <div className="h-1.5 w-2/3 rounded-full bg-slate-200" />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-body-md text-on-surface inline-flex items-center gap-1.5 font-medium">
            <Sun size={16} />
            {t("settings.themeLight")}
          </span>
          {!isDark && (
            <span className="bg-primary text-primary-on flex h-5 w-5 items-center justify-center rounded-full">
              <Check size={13} />
            </span>
          )}
        </div>
      </button>

      <button
        onClick={() => isDark || toggleMode()}
        className={cn(
          "group relative overflow-hidden rounded-lg border-2 p-3 text-left transition-all",
          isDark
            ? "border-primary shadow-elevation-1"
            : "border-outline-variant hover:border-primary/50",
        )}
      >
        {/* 暗色缩略预览 */}
        <div className="mb-2 h-20 overflow-hidden rounded-lg bg-neutral-900">
          <div className="flex h-full">
            <div className="w-1/3 bg-neutral-800" />
            <div className="flex-1 p-1.5">
              <div className="mb-1 h-1.5 w-8 rounded-full bg-neutral-500" />
              <div className="mb-1 h-1.5 w-full rounded-full bg-neutral-700" />
              <div className="h-1.5 w-2/3 rounded-full bg-neutral-700" />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-body-md text-on-surface inline-flex items-center gap-1.5 font-medium">
            <Moon size={16} />
            {t("settings.themeDark")}
          </span>
          {isDark && (
            <span className="bg-primary text-primary-on flex h-5 w-5 items-center justify-center rounded-full">
              <Check size={13} />
            </span>
          )}
        </div>
      </button>
    </div>
  );
}

/** 语言分段控件（Segmented） */
function LanguageSegmented() {
  const locale = useThemeStore((s) => s.locale);
  // setLocale 内部已经切 i18n 语言，这里不要再补一次
  const setLocale = useThemeStore((s) => s.setLocale);
  return (
    <div className="bg-surface-container inline-flex w-full rounded-lg p-1">
      {SUPPORTED_LOCALES.map(({ code, nativeLabel }) => {
        const active = locale === code;
        return (
          <button
            key={code}
            onClick={() => setLocale(code)}
            className={cn(
              "text-label-lg flex-1 rounded-md py-2 font-medium transition-all",
              active
                ? "bg-surface shadow-elevation-1 text-on-surface"
                : "text-on-surface-variant hover:text-on-surface",
            )}
          >
            {nativeLabel}
          </button>
        );
      })}
    </div>
  );
}

/** 外观：主题双卡 + 语言分段 */
export function AppearanceSection() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <SectionHeader title={t("settings.appearance")} desc={t("settings.appearanceDesc")} />
      </div>
      <div>
        <h3 className="text-title-sm text-on-surface mb-3 font-semibold">{t("settings.theme")}</h3>
        <ThemeCards />
      </div>
      <div>
        <h3 className="text-title-sm text-on-surface mb-3 font-semibold">
          {t("settings.language")}
        </h3>
        <LanguageSegmented />
      </div>
    </div>
  );
}

/** 关于：品牌 hero + 版本 + 开发者/开源链接 */
export function AboutSection({ extra }: { extra?: ReactNode } = {}) {
  const { t } = useTranslation();
  return (
    <div>
      <SectionHeader title={t("settings.about")} desc={t("settings.aboutDesc")} />

      {/* 品牌 hero */}
      <div className="mb-6 flex flex-col items-center gap-3 py-6">
        <div className="brand-gradient shadow-elevation-2 text-headline-md flex h-20 w-20 items-center justify-center rounded-lg font-bold text-white">
          元
        </div>
        <p className="text-title-lg text-on-surface font-semibold">YuanChat</p>
        <p className="text-body-sm text-on-surface-variant">
          {t("settings.version")} {APP_VERSION}
        </p>
        <p className="text-label-md text-on-surface-variant text-center opacity-70">
          {t("settings.brandTagline")}
        </p>
      </div>

      {/* 平台特有区块（桌面端注入「检查更新」，web/admin 无） */}
      {extra}

      {/* 链接卡片 */}
      <InfoCard>
        <InfoRow
          icon={Globe}
          label={t("settings.officialSite")}
          value="yuanchat.example.com"
          copyable
        />
        <InfoRow
          icon={Github}
          label={t("settings.sourceCode")}
          value="github.com/yuanchat"
          copyable
        />
        <InfoRow
          icon={Info}
          label={t("settings.licenseLabel")}
          value={t("settings.licenseValue")}
        />
      </InfoCard>
    </div>
  );
}
