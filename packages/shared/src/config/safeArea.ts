/** 原生下发的顶部安全区高度（CSS px 数值字符串）在 localStorage 里的键 */
const SAFE_AREA_TOP_KEY = "yuanchat.safeAreaTop";

/**
 * 整页跳转后把 `--safe-area-top` 补回来（仅安卓需要，其它端是空操作）。
 *
 * @description
 * 安卓侧 `MainActivity` 在 WindowInsets 回调里量出状态栏高度，写进
 * `--safe-area-top` 供 `.app-screen` 与各浮层留边。但这个变量挂在 document 上，
 * **整页跳转会把它一起带走**，而此时不会再有新的 inset 回调去补发 ——
 * 于是浮层（如网络横幅、Toast）就压到系统状态栏上去了。
 *
 * 会整页跳转的真实路径有三条：注册/忘记密码入口（移动端没有多窗口，
 * `useOpenAuthWindow` 退化成 `location.href`）、切换服务器地址、错误边界重载。
 *
 * 原生每次下发都顺手把值存进 localStorage，这里在首帧之前取回来。已经有值时
 * 不覆盖 —— 原生那一份才是当下实测的，本函数只负责「空了补上」。
 *
 * @example
 * // main.tsx，必须在 React 渲染之前调用，否则首帧会闪一下错位
 * restoreSafeAreaTop();
 */
export function restoreSafeAreaTop(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (root.style.getPropertyValue("--safe-area-top")) return;
  try {
    const cached = localStorage.getItem(SAFE_AREA_TOP_KEY);
    if (cached) root.style.setProperty("--safe-area-top", cached + "px");
  } catch {
    // 隐私模式下 localStorage 会抛，退回 CSS 里的 env(safe-area-inset-top) 兜底
  }
}
