/**
 * 搜索窗口承载器注册点 — 与 callActions 的 setCallLauncher 同一注入模式。
 *
 * @description
 * 单独成文件而不是留在 MainLayout.tsx：组件文件导出非组件会触发
 * eslint `react-refresh/only-export-components`，与 callActions.ts 同一种拆法。
 *
 * 桌面 app 的 Ctrl/Cmd+K 开**独立原生搜索窗口**（宿主用 setSearchWindowLauncher
 * 注入开窗实现），web / 移动端没有多窗口，保持主窗口内的浮层面板。MainLayout
 * 的快捷键监听只调 {@link launchSearchWindow}：返回 true 表示宿主已接管
 * （面板不出），false 表示回落面板 —— ui 包不判断平台，让宿主决定承载方式。
 */

/** 宿主层的搜索窗口承载器；返回 true 表示已接管（本次 Ctrl/Cmd+K 不再出面板） */
export type SearchWindowLauncher = () => boolean;

let launcher: SearchWindowLauncher | null = null;

/**
 * 注册搜索窗口承载器（桌面端主窗口专用）。
 *
 * @param fn - 承载器；传 null 撤销（回到 MainLayout 自己的面板形态）
 */
export function setSearchWindowLauncher(fn: SearchWindowLauncher | null): void {
  launcher = fn;
}

/**
 * 尝试打开（或聚焦）搜索窗口。
 *
 * @returns true 表示宿主已接管（不要再现面板）；false 表示宿主未注册
 *   （web / 移动端 / 搜索窗口自身），调用方回落面板形态
 */
export function launchSearchWindow(): boolean {
  if (launcher === null) return false;
  return launcher();
}
