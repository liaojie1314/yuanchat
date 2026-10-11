/**
 * 外部链接打开抽象：平台在启动时注入实现（桌面/移动端 Tauri shell，web 端不注册=用 window.open）。
 *
 * 为什么要这层：Tauri 的 WebView 不支持 `window.open` 开新窗口 —— 安卓上调用它
 * 既不报错也没任何反应，于是「点文件下载」在手机端表现为彻底的死点击。
 * 交给原生 shell 打开，URL 就落到系统浏览器里，下载也由浏览器接管。
 *
 * 和 {@link setNotifier} 同一套注入模式：UI 层不直接依赖 @tauri-apps/*，
 * 否则 web 构建会把桌面端依赖一起拖进去。
 */
type UrlOpener = (url: string) => void | Promise<void>;

let opener: UrlOpener | null = null;

export function setUrlOpener(fn: UrlOpener): void {
  opener = fn;
}

/** 测试辅助：还原未注册态 */
export function __resetUrlOpener(): void {
  opener = null;
}

/**
 * 在外部打开链接（预签名下载地址、外链等）。
 *
 * 失败时抛出，由调用方提示 —— 这条链路以前整段静默，用户分不清是没点中、
 * 还是链接过期了。
 */
export async function openExternal(url: string): Promise<void> {
  if (opener) {
    await opener(url);
    return;
  }
  const win = window.open(url, "_blank", "noopener,noreferrer");
  // 浏览器拦弹窗时 open 返回 null：这也是失败，不能当成功咽下去
  if (!win) throw new Error("window.open blocked");
}
