/**
 * 安卓系统返回键的拦截栈
 *
 * @description
 * Tauri 自带的安卓返回处理只看 `WebView.canGoBack()`，而本应用的路由跳转大量使用
 * `replace`（路由守卫重定向、登录后进主界面），WebView 历史长度恒为 1，
 * 于是每次按返回键都直接退出应用 —— 表现为「系统返回键完全不可用，只能点界面上的返回」。
 *
 * 改由前端决定返回语义：原生层把返回键委托给 `window.__androidBack__`，
 * 该函数先按注册顺序**倒序**询问拦截器（后注册的在更上层，例如弹窗盖在页面之上），
 * 任一拦截器返回 true 即表示已消费本次返回；全部不处理时才交回系统退出应用。
 *
 * 拦截器必须是同步的：原生侧拿到返回值才能决定要不要 finish 掉 Activity，
 * 异步的话 Activity 已经退了。需要异步收尾的（例如关掉相机）在拦截器里 fire-and-forget。
 */

/** 拦截器：处理了本次返回返回 true，未处理返回 false */
export type BackInterceptor = () => boolean;

const interceptors: BackInterceptor[] = [];

/**
 * 注册一个返回键拦截器
 *
 * @param fn - 同步拦截器，处理了返回 true
 * @returns 注销函数，组件卸载时必须调用，否则已卸载的界面会继续吞掉返回键
 */
export function registerBackInterceptor(fn: BackInterceptor): () => void {
  interceptors.push(fn);
  return () => {
    const i = interceptors.indexOf(fn);
    if (i >= 0) interceptors.splice(i, 1);
  };
}

/**
 * 倒序执行拦截器
 *
 * @returns 是否已有拦截器消费了本次返回
 */
export function runBackInterceptors(): boolean {
  for (let i = interceptors.length - 1; i >= 0; i--) {
    if (interceptors[i]()) return true;
  }
  return false;
}
