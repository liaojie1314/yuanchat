/** @yuanchat/design-system — M3 设计系统入口 */
export { lightScheme, darkScheme, typography, shapes, elevation, motion } from "./tokens";
export type { M3ColorScheme, FontScale } from "./tokens";
export { builtInSkins, registerSkin, findSkin, getDefaultSkin } from "./skins";
export type { SkinDefinition } from "./skins";
export {
  default as i18n,
  formatRelativeTime,
  formatNumber,
  formatFileSize,
  SUPPORTED_LOCALES,
} from "./i18n";
export type { SupportedLocale } from "./i18n";
