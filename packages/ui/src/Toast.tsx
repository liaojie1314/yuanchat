import { AlertCircle, Info } from "lucide-react";
import { useToastStore } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";

/** 全局 toast 浮层：顶部居中堆叠，MainLayout 挂载一次 */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed top-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            "bg-surface-container-high border-outline-variant animate-fade-in flex items-center gap-2 rounded-lg border px-4 py-2.5 shadow-lg",
            t.kind === "error" ? "text-error" : "text-on-surface",
          )}
        >
          {t.kind === "error" ? <AlertCircle size={16} /> : <Info size={16} />}
          <span className="text-body-md">{t.text}</span>
        </div>
      ))}
    </div>
  );
}
