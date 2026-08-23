/**
 * PushToggle — 浏览器通知开关（Web 端设置 → 关于 内嵌）
 *
 * @description
 * 仅 Web 端可用：桌面端有原生通知，Tauri WebView 无 Push API。
 * 后端未配置 VAPID 时整块隐藏（fetchPushConfig().enabled=false）。
 */
import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  isPushSupported,
  pushPermission,
  fetchPushConfig,
  subscribePush,
  unsubscribePush,
  isPushSubscribed,
} from "@yuanchat/shared";

export function PushToggle() {
  const { t } = useTranslation();
  const [available, setAvailable] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isPushSupported()) return;
    void (async () => {
      const cfg = await fetchPushConfig();
      if (!cfg.enabled) return;
      setAvailable(true);
      setSubscribed(await isPushSubscribed());
    })();
  }, []);

  // 环境不支持 / 后端未配置：不渲染（避免给用户一个点不动的开关）
  if (!available) return null;

  const denied = pushPermission() === "denied";

  const toggle = async () => {
    setBusy(true);
    setError("");
    try {
      if (subscribed) {
        await unsubscribePush();
        setSubscribed(false);
      } else {
        const ok = await subscribePush();
        setSubscribed(ok);
        if (!ok) setError(t(denied ? "push.denied" : "push.failed"));
      }
    } catch {
      setError(t("push.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-6 rounded-lg border border-outline-variant bg-surface-container-low p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-body-md font-medium text-on-surface">{t("push.title")}</p>
          <p className="mt-0.5 text-label-md text-on-surface-variant">
            {error || (denied ? t("push.denied") : subscribed ? t("push.enabled") : t("push.desc"))}
          </p>
        </div>
        <button
          onClick={() => void toggle()}
          disabled={busy || denied}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-outline-variant px-3 py-2 text-label-lg font-medium text-on-surface hover:bg-surface-container disabled:opacity-50"
        >
          {subscribed ? <BellOff size={16} /> : <Bell size={16} />}
          {subscribed ? t("push.disable") : t("push.enable")}
        </button>
      </div>
    </div>
  );
}
