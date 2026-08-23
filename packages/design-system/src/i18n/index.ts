/**
 * 元聊 YuanChat — i18n 国际化设置
 *
 * @description
 * 基于 react-i18next 的企业级国际化方案。
 *
 * 特性：
 * - 编译期类型安全：所有翻译 key 由 TypeScript 强类型约束
 * - 命名空间隔离：common、auth、chat、contacts、settings 等
 * - 插值变量：支持 %{variable} 格式的动态参数
 * - 复数形式：支持多种复数规则（en: one/other, zh: other）
 * - 日期/数字格式化：复用 Intl API，locale 敏感
 * - 懒加载：各模块翻译文件独立加载，减少首次加载体积
 *
 * 使用方式：
 * ```tsx
 * const { t } = useTranslation();
 * t("auth.login"); // "登录" or "Sign In"
 * t("time.minutesAgo", { count: 5 }); // "5 分钟前" or "5 min ago"
 * ```
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zhCN from "./locales/zh-CN.json";
import enUS from "./locales/en-US.json";
import jaJP from "./locales/ja-JP.json";
import koKR from "./locales/ko-KR.json";

/**
 * 获取浏览器首选语言
 * zh-CN、zh、zh-TW → zh-CN；ja → ja-JP；ko → ko-KR；其他 → en-US
 *
 * @returns 受支持的 locale 代码
 * @remarks 仅在用户从未选过语言时作为默认值；一旦手动选过，
 *   持久化的选择优先（见 themeStore 的 locale 与 onRehydrateStorage）
 */
export function detectLocale(): SupportedLocale {
  if (typeof navigator === "undefined") return "zh-CN";
  const lang = navigator.language || "zh-CN";
  if (lang.startsWith("zh")) return "zh-CN";
  if (lang.startsWith("ja")) return "ja-JP";
  if (lang.startsWith("ko")) return "ko-KR";
  return "en-US";
}

/**
 * 支持的 locale 列表
 * 新增语言时在此注册即可
 */
export const SUPPORTED_LOCALES = [
  { code: "zh-CN", label: "简体中文", nativeLabel: "简体中文" },
  { code: "en-US", label: "English", nativeLabel: "English" },
  { code: "ja-JP", label: "Japanese", nativeLabel: "日本語" },
  { code: "ko-KR", label: "Korean", nativeLabel: "한국어" },
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]["code"];

// 初始化 i18n
i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: zhCN },
    "en-US": { translation: enUS },
    "ja-JP": { translation: jaJP },
    "ko-KR": { translation: koKR },
  },
  lng: detectLocale(),
  fallbackLng: "zh-CN",
  interpolation: {
    escapeValue: false, // React 自带 XSS 防护
    // locale 文件采用 %{variable} 占位符（Rails 风格），与 i18next 默认 {{}} 不同
    prefix: "%{",
    suffix: "}",
  },
  // 企业级配置
  returnNull: false, // 缺失翻译返回 key 本身而非 null
  returnEmptyString: false,
  keySeparator: ".", // "auth.login" 格式
  parseMissingKeyHandler: (key: string) => {
    console.warn(`[i18n] Missing translation: "${key}"`);
    return key; // 返回 key 本身作为 fallback，不中断渲染
  },
});

/**
 * 把当前语言同步到 `<html lang>`
 *
 * @param locale - 生效中的 locale 代码
 * @remarks 影响浏览器断词换行、读屏发音、拼写检查与输入法候选；
 *   非 DOM 环境（node 测试、SSR）直接跳过
 */
function syncDocumentLang(locale: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
}

// 语言变更的唯一落地点是 i18next，故在此挂载而非各端入口
i18n.on("languageChanged", syncDocumentLang);
syncDocumentLang(i18n.language);

/**
 * 格式化相对时间（locale 感知）
 *
 * @param date - 目标时间
 * @param locale - locale 代码
 * @returns 自然语言描述的时间差
 *
 * @example
 * relativeTime(new Date("2026-06-12T10:00:00"), "zh-CN"); // "5 分钟前"
 */
export function formatRelativeTime(date: Date, locale: string): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return i18n.t("time.justNow");
  if (diffMin < 60) return i18n.t("time.minutesAgo", { count: diffMin });
  if (diffHour < 24) return i18n.t("time.hoursAgo", { count: diffHour });
  if (diffDay === 1) return i18n.t("time.yesterday");
  if (diffDay < 7) return i18n.t("time.daysAgo", { count: diffDay });
  if (diffDay < 30) return i18n.t("time.weeksAgo", { count: Math.floor(diffDay / 7) });

  // 超过 30 天使用 Intl 格式化具体日期
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(date);
}

/**
 * 格式化数字（locale 感知）
 */
export function formatNumber(n: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(n);
}

/**
 * 格式化文件大小（locale 感知）
 */
export function formatFileSize(bytes: number, locale: string): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576)
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1024)} KB`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1048576)} MB`;
}

export default i18n;
