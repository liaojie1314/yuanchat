/**
 * 主导航的路由清单（底栏 / 侧栏共用的数据源）
 *
 * @description
 * 单独成文件而不是留在 MainLayout.tsx 里：组件文件导出非组件会触发
 * eslint `react-refresh/only-export-components`（Fast Refresh 失效），
 * 与 settingsUtils.ts / parseLoginQr.ts 同一种拆法。
 */
import { MessageCircle, Users, Settings, Camera, Sticker } from "lucide-react";

/** 导航项：路由 + 图标 + i18n 标签 key */
export interface NavItem {
  to: string;
  icon: typeof MessageCircle;
  labelKey: string;
}

/**
 * 移动端底栏导航项（4 项均分全宽）。
 *
 * @remarks 收藏与表情商城都不进底栏：底栏只放高频入口，5 项会把每项压到 20% 宽。
 * 两者的入口统一在设置页（见 SettingsScreen），桌面侧栏另有商城入口。
 */
export const MOBILE_NAV_ITEMS: NavItem[] = [
  { to: "/chat", icon: MessageCircle, labelKey: "chat.title" },
  { to: "/contacts", icon: Users, labelKey: "contacts.title" },
  { to: "/moments", icon: Camera, labelKey: "moments.title" },
  { to: "/settings", icon: Settings, labelKey: "settings.title" },
];

/**
 * 底栏一级入口的路由清单。
 *
 * 安卓返回键（apps/desktop 的 useAndroidBack）靠它判断「已在一级入口」，
 * 从而走「再按一次退出」而不是跳回聊天页。**从底栏导航派生而非另抄一份**：
 * 先前两处各写一份，底栏换成朋友圈时清单没跟上，在朋友圈按返回会莫名跳回聊天页。
 *
 * 子页面（`/stickers`、`/moments/compose` 等）不在此列：它们各自用
 * `useBackTo` 注册拦截器，在本清单被查到之前就把返回键处理掉了。
 */
export const TAB_ROOT_PATHS: string[] = MOBILE_NAV_ITEMS.map((i) => i.to);

/**
 * 桌面/平板左侧栏导航项。
 *
 * 设置不在此列：它固定沉底（spacer 之后、主题/登出之上），
 * 这样以后新增导航项不必每次重排顺序。
 */
export const DESKTOP_NAV_ITEMS: NavItem[] = [
  { to: "/chat", icon: MessageCircle, labelKey: "chat.title" },
  { to: "/contacts", icon: Users, labelKey: "contacts.title" },
  { to: "/moments", icon: Camera, labelKey: "moments.title" },
  { to: "/stickers", icon: Sticker, labelKey: "sticker.market.title" },
];

/** 桌面侧栏沉底的设置项（与常规导航项同样式，仅位置不同） */
export const DESKTOP_SETTINGS_ITEM: NavItem = {
  to: "/settings",
  icon: Settings,
  labelKey: "settings.title",
};
