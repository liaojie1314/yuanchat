import { useEffect, useRef, useState } from "react";
import { CloudOff, Loader2, Wifi } from "lucide-react";
import { useNetworkStatus, consumeNetworkLost } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { useTranslation } from "react-i18next";

/** 「已连接」提示的驻留时长 */
const RESTORED_LINGER_MS = 2000;

/**
 * 全局网络状态横幅：贴顶，`MainLayout` 挂载一次。
 *
 * 三态分工：`offline` / `connecting` 常驻（问题还在，提示不该消失），
 * `online` 只在**真的从断网恢复**时显示「已连接」并 2 秒后自动收起。
 *
 * 「真的断过」由 {@link consumeNetworkLost} 判定，而不是比对本进程内的
 * 前后两态 —— 后者会把两种正常场景误报成恢复：登录页（WS 尚未建立
 * 即 `connecting`）和每次硬刷新（整页重载重建 WS）。两者用户都没经历过
 * 断网，弹「已连接」纯属噪音。
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
  const prevPhase = useRef(phase);

  useEffect(() => {
    const recovered = prevPhase.current !== "online" && phase === "online";
    prevPhase.current = phase;
    if (!recovered) return;
    // 消费标记：没有「断过网」记录就说明这次跃迁只是首次连接或页面重载
    if (!consumeNetworkLost()) return;
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
