/**
 * SettingsSections — 设置页右侧内容区子视图（账号与安全 / 外观 / 关于）
 *
 * @description
 * 从 SettingsScreen 拆出的内容区组件，保持主文件精简（≤300 行）。
 * 三端共用：desktop/tablet 直接内联渲染，mobile 栈式推入时外层包返回头。
 *
 * - AccountSection：手机号脱敏、邮箱、元聊号 + 复制按钮
 * - AppearanceSection：主题开关（复制 ChatDetail 的 M3 switch 样式）+ 语言 radio
 * - AboutSection：应用信息 + 版本号
 */
import { useState } from "react";
import { Copy, Check, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "@yuanchat/shared";
import type { SupportedLocale } from "@yuanchat/design-system/i18n";
import { SUPPORTED_LOCALES } from "@yuanchat/design-system/i18n";
import i18n from "@yuanchat/design-system/i18n";
import { cn } from "@yuanchat/shared/utils";
import { copyText } from "./copyText";
import { APP_VERSION, maskPhone } from "./settingsUtils";

/** 内容区分组标题 */
function SectionTitle({ children }: { children: string }) {
  return <h2 className="text-title-md text-on-surface mb-4 font-semibold">{children}</h2>;
}

/** 只读信息行：左标签 + 右值，可选复制按钮 */
function InfoRow({ label, value, copyable }: { label: string; value: string; copyable?: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    void copyText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="border-outline-variant flex h-14 items-center justify-between border-b">
      <span className="text-body-md text-on-surface-variant">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-body-md text-on-surface">{value}</span>
        {copyable && (
          <button
            onClick={onCopy}
            className="md3-icon-btn text-on-surface-variant !h-8 !w-8"
            aria-label={copied ? t("profile.copied") : t("profile.copy")}
          >
            {copied ? <Check size={16} className="text-primary" /> : <Copy size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}

/** 账号与安全：手机号脱敏 + 邮箱 + 元聊号（可复制） */
export function AccountSection({
  phone,
  email,
  shortId,
}: {
  phone?: string;
  email?: string;
  shortId?: number;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <SectionTitle>{t("settings.account")}</SectionTitle>
      <InfoRow
        label={t("settings.phone")}
        value={phone ? maskPhone(phone) : t("settings.notBound")}
      />
      <InfoRow label={t("settings.email")} value={email || t("settings.notBound")} />
      {shortId !== undefined && (
        <InfoRow label={t("contacts.yuanId")} value={String(shortId)} copyable />
      )}
    </div>
  );
}

/** M3 风格开关（纯展示；复制自 ChatDetail 的 SettingRow switch，不 import） */
function ThemeSwitch({ checked }: { checked: boolean }) {
  return (
    <span
      role="switch"
      aria-checked={checked}
      className={cn(
        // block 必须显式声明：父按钮非 flex 时 inline span 的宽高不生效，轨道塌缩致滑块溢出
        "relative block h-6 w-11 shrink-0 rounded-full transition-colors",
        checked ? "bg-primary" : "bg-outline",
      )}
    >
      <span
        className={cn(
          "shadow-elevation-1 absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform",
          checked && "translate-x-5",
        )}
      />
    </span>
  );
}

/** 外观：主题开关 + 语言 radio 风格选择 */
export function AppearanceSection() {
  const { t } = useTranslation();
  const mode = useThemeStore((s) => s.mode);
  const toggleMode = useThemeStore((s) => s.toggleMode);
  const locale = useThemeStore((s) => s.locale);
  const setLocale = useThemeStore((s) => s.setLocale);
  const isDark = mode === "dark";

  const changeLocale = (code: SupportedLocale) => {
    void i18n.changeLanguage(code);
    setLocale(code);
  };

  return (
    <div>
      <SectionTitle>{t("settings.appearance")}</SectionTitle>

      {/* 主题行 */}
      <div className="border-outline-variant flex h-14 items-center justify-between border-b">
        <span className="text-on-surface-variant flex items-center gap-2">
          {isDark ? <Moon size={18} /> : <Sun size={18} />}
          <span className="text-body-md text-on-surface">
            {isDark ? t("settings.themeDark") : t("settings.themeLight")}
          </span>
        </span>
        <button onClick={toggleMode} aria-label={t("settings.theme")}>
          <ThemeSwitch checked={isDark} />
        </button>
      </div>

      {/* 语言行 */}
      <div className="flex items-center justify-between py-4">
        <span className="text-body-md text-on-surface">{t("settings.language")}</span>
        <div className="flex gap-2">
          {SUPPORTED_LOCALES.map(({ code, nativeLabel }) => {
            const active = locale === code;
            return (
              <button
                key={code}
                onClick={() => changeLocale(code)}
                className={cn(
                  "text-label-lg rounded-lg border px-4 py-2 font-medium transition-colors",
                  active
                    ? "border-primary bg-primary-container/60 text-primary-on-container"
                    : "border-outline-variant text-on-surface-variant hover:bg-surface-container-high",
                )}
              >
                {nativeLabel}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 关于：应用名 + 版本号 */
export function AboutSection() {
  const { t } = useTranslation();
  return (
    <div>
      <SectionTitle>{t("settings.about")}</SectionTitle>
      <div className="flex flex-col items-center gap-3 py-8">
        <div className="bg-primary text-primary-on text-title-lg grid h-16 w-16 place-items-center rounded-2xl font-bold">
          元
        </div>
        <p className="text-title-md text-on-surface font-semibold">YuanChat</p>
        <p className="text-body-sm text-on-surface-variant">
          {t("settings.version")} {APP_VERSION}
        </p>
      </div>
    </div>
  );
}
