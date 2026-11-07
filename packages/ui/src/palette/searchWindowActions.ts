/** 搜索承载入口：MainLayout 处理全局面板，原生宿主接管会话内搜索。 */
/** 宿主层的会话搜索窗口承载器；返回 true 表示已接管该会话的搜索。 */
export type SearchWindowLauncher = (conversationId: string) => boolean;

let launcher: SearchWindowLauncher | null = null;

/**
 * 注册搜索窗口承载器（桌面端主窗口专用）。
 *
 * @param fn - 承载器；传 null 撤销，由 MainLayout 按屏幕选择弹窗或手机路由
 */
export function setSearchWindowLauncher(fn: SearchWindowLauncher | null): void {
  launcher = fn;
}

/**
 * 尝试打开（或聚焦）会话搜索窗口；全局命令面板始终由主布局承载。
 *
 * @returns true 表示宿主已接管；false 表示全局搜索或宿主未注册，
 *   调用方按屏幕选择弹窗或手机路由
 */
export function launchSearchWindow(conversationId?: string): boolean {
  if (!conversationId || launcher === null) return false;
  return launcher(conversationId);
}

/** 搜索入口事件：由 MainLayout 统一选择原生窗口、手机路由或 Web 弹窗。 */
export const SEARCH_OPEN_EVENT = "yuanchat:search";

/** 请求打开全局或会话内搜索，不让聊天组件自行持有旧内嵌面板。 */
export function requestSearch(conversationId?: string): void {
  window.dispatchEvent(new CustomEvent(SEARCH_OPEN_EVENT, { detail: conversationId }));
}
