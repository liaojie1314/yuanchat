/**
 * 系统通知抽象：平台在启动时注入实现（桌面端 Tauri notification，web 端不注册=静默）。
 * 守卫集中于此：窗口聚焦不打扰、免打扰会话跳过、正文截断 60 字。
 */
type Notifier = (title: string, body: string) => void;

let notifier: Notifier | null = null;

export function setNotifier(fn: Notifier): void {
  notifier = fn;
}

/** 测试辅助：还原未注册态 */
export function __resetNotifier(): void {
  notifier = null;
}

export function notifyIncoming(conv: { name: string; isMuted: boolean }, preview: string): void {
  if (!notifier || conv.isMuted) return;
  if (typeof document !== "undefined" && document.hasFocus()) return;
  const body = preview.length > 60 ? preview.slice(0, 60) + "…" : preview;
  notifier(conv.name, body);
}
