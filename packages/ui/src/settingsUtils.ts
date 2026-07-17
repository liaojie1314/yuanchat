/**
 * 设置页工具函数与常量（非组件模块）
 *
 * @description
 * 从 SettingsSections 拆出纯函数/常量，避免与组件同文件导出触发
 * react-refresh/only-export-components 告警（保证 Fast Refresh 生效）。
 */

/** 应用版本号（root package.json version，发版时同步） */
export const APP_VERSION = "0.1.0";

/** 手机号脱敏：138****0001 */
export function maskPhone(phone: string): string {
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
}
