import { useEffect, useRef, useState } from "react";
import { CloudOff, Loader2, Wifi } from "lucide-react";
import { useNetworkStatus } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { useTranslation } from "react-i18next";

/** 「已连接」提示的驻留时长 */
const RESTORED_LINGER_MS = 2000;

/**
 * 全局网络状态横幅：贴顶，`MainLayout` 挂载一次。
 *
 * 三态分工：`offline` / `connecting` 常驻（问题还在，提示不该消失），
 * `online` 只在**刚从非在线态恢复**时显示「已连接」并 2 秒后自动收起 ——
 * 一直挂一条绿条属于噪音，而从未断过网的会话根本不该看到任何东西。
 *
 * 顶部偏移叠安全区：安卓沉浸式状态栏下 WebView 铺到状态栏之下，
 * 不叠 `--safe-area-top` 会压住系统时间/信号图标（该变量由原生下发，
 * web 与桌面端没有它，回退 0 即原样）。
 *
 * `role="status"` + `aria-live="polite"`：断网是状态变更，屏幕阅读器应当播报，
 * 但不该打断用户当前正在听的内容，所以是 polite 而非 assertive。
 */
export function NetworkBanner() {
  const { t } = useTranslation();
  const phase = useNetworkStatus();
  const [showRestored, setShowRestored] = useState(false);
  // 记住上一个态：只有「非在线 → 在线」才算恢复，首次挂载就在线不算
  const prevPhase = useRef(phase);

  useEffect(() => {
    const wasDown = prevPhase.current !== "online";
    prevPhase.current = phase;
    if (phase !== "online" || !wasDown) return;
    setShowRestored(true);
    const timer = setTimeout(() => setShowRestored(false), RESTORED_LINGER_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  if (phase === "online" && !showRestored) return null;

  const restored = phase === "online";
  const label = restored
    ? t("network.restored")
    : phase === "offline"
      ? t("network.offline")
      : t("network.connecting");

  return (
    <div
      role="status"
      aria-live="polite"
      // motion-safe 前缀让 prefers-reduced-motion 下不做淡入
      className={cn(
        "motion-safe:animate-fade-in pointer-events-none fixed left-1/2 z-[101] flex -translate-x-1/2",
        "items-center gap-2 rounded-lg border px-3 py-1.5 shadow-lg",
        restored
          ? "border-outline-variant bg-surface-container-high text-on-surface"
          : "border-error/30 bg-error-container text-error-on-container",
      )}
      style={{ top: "calc(var(--safe-area-top, 0px) + 0.5rem)" }}
    >
      {restored ? (
        <Wifi size={14} className="shrink-0" />
      ) : phase === "offline" ? (
        <CloudOff size={14} className="shrink-0" />
      ) : (
        <Loader2 size={14} className="shrink-0 motion-safe:animate-spin" />
      )}
      <span className="text-label-md whitespace-nowrap">{label}</span>
    </div>
  );
}
