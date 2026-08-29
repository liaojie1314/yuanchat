import { AlertCircle, Info } from "lucide-react";
import { useToastStore } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";

/**
 * 全局 toast 浮层：顶部居中堆叠，MainLayout 挂载一次
 *
 * 顶部偏移要叠上安全区：安卓沉浸式状态栏下 WebView 铺到状态栏之下，
 * 只写 top-4 会让浮层压在系统时间/信号图标上（--safe-area-top 由原生下发，
 * web 与桌面端没有该变量，回退 0 即原样）。
 *
 * 文案强制单行 + 省略号：toast 是一次性提示，换行会把浮层撑成一大块挡住内容，
 * 也会让多条堆叠时高度参差。真正需要长文的场景应当用对话框而不是 toast。
 */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed left-1/2 z-[100] flex max-w-[90vw] -translate-x-1/2 flex-col items-center gap-2"
      style={{ top: "calc(var(--safe-area-top, 0px) + 1rem)" }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            "bg-surface-container-high border-outline-variant animate-fade-in flex max-w-full items-center gap-2 rounded-lg border px-4 py-2.5 shadow-lg",
            t.kind === "error" ? "text-error" : "text-on-surface",
          )}
        >
          {t.kind === "error" ? (
            <AlertCircle size={16} className="shrink-0" />
          ) : (
            <Info size={16} className="shrink-0" />
          )}
          <span className="text-body-md truncate">{t.text}</span>
        </div>
      ))}
    </div>
  );
}
