/**
 * E2EEIndicator — 会话头部的加密状态指示（单聊）
 *
 * @description
 * 三态：
 * - **已加密**：与该对端已建立 Double Ratchet 会话 → 实心锁，可点开指纹校验
 * - **待建立**：本端已开启 E2EE 但尚未与对方建会话（首条消息发出时建立）
 * - **不适用**：本端未开启 / 群聊 / 对方未启用 → 不渲染
 *
 * 明确不做的事：不因「看起来加密」就给用户安全承诺。只有真实存在
 * 会话状态时才显示实心锁。
 */
import { useEffect, useState } from "react";
import { Lock, ShieldQuestion } from "lucide-react";
import { useTranslation } from "react-i18next";
import { hasSession, isEnabled } from "@yuanchat/shared";

export function E2EEIndicator({
  selfId,
  peerId,
  onClick,
}: {
  selfId?: string;
  peerId?: string;
  onClick?: () => void;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<"none" | "pending" | "secured">("none");

  useEffect(() => {
    if (!selfId || !peerId || !isEnabled(selfId)) {
      setState("none");
      return;
    }
    setState(hasSession(selfId, peerId) ? "secured" : "pending");
  }, [selfId, peerId]);

  if (state === "none") return null;

  const secured = state === "secured";
  return (
    <button
      onClick={onClick}
      title={secured ? t("e2ee.securedHint") : t("e2ee.pendingHint")}
      aria-label={secured ? t("e2ee.secured") : t("e2ee.pending")}
      className="md3-icon-btn text-on-surface-variant"
    >
      {secured ? <Lock size={17} className="text-primary" /> : <ShieldQuestion size={17} />}
    </button>
  );
}
