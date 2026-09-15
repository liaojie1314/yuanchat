/**
 * 设置页工具函数与常量（非组件模块）
 *
 * @description
 * 从 SettingsSections 拆出纯函数/常量，避免与组件同文件导出触发
 * react-refresh/only-export-components 告警（保证 Fast Refresh 生效）。
 */

/**
 * 构建期注入的应用版本号
 *
 * 两端 vite.config.ts 都把各自 package.json 的 version 定义成 `__APP_VERSION__`，
 * 因此这里读它而不是再手抄一份常量 —— 手抄的那份曾停在 0.1.0，跟实际发版脱节。
 * 未经 vite 处理的环境（vitest、tsx 直跑）取不到该定义，`typeof` 对未声明标识符不抛错，
 * 回退到 "dev"。
 */
declare const __APP_VERSION__: string | undefined;

/** 应用版本号，由构建期注入 */
export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

/** 手机号脱敏：138****0001 */
export function maskPhone(phone: string): string {
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
}
