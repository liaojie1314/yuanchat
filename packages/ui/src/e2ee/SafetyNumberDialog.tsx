/**
 * SafetyNumberDialog — 安全指纹校验（Signal 风格）
 *
 * @description
 * 展示 60 位数字指纹（12 组 × 5 位）。双方**通过独立可信渠道**
 * （当面、电话等）核对一致，才能排除服务器实施中间人的可能。
 *
 * 指纹由双方身份公钥推导，与消息内容无关：
 * - 一致 → 当前拿到的对端公钥确实属于对方
 * - 不一致 → 要么对方换了设备/重装，要么存在中间人；此时不应继续发敏感内容
 *
 * 提供「重置会话」用于对方换设备后无法解密的场景（会丢失该会话的
 * 棘轮状态，历史密文仍可用旧会话解，新消息重新协商）。
 */
import { useEffect, useState } from "react";
import { X, RefreshCw, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { computeSafetyNumber, resetSession } from "@yuanchat/shared";

/** 60 位数字按 5 位分组，便于人工逐组核对 */
function groupDigits(digits: string): string[] {
  const groups: string[] = [];
  for (let i = 0; i < digits.length; i += 5) {
    groups.push(digits.slice(i, i + 5));
  }
  return groups;
}

export function SafetyNumberDialog({
  selfId,
  peerId,
  peerName,
  open,
  onClose,
}: {
  selfId: string;
  peerId: string;
  peerName: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [digits, setDigits] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resetDone, setResetDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    setResetDone(false);
    computeSafetyNumber(selfId, peerId)
      .then((n: string | null) => {
        if (n) setDigits(n);
        else setError(t("e2ee.peerNotEnabled"));
      })
      .catch(() => setError(t("common.opFailed")))
      .finally(() => setLoading(false));
  }, [open, selfId, peerId, t]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("e2ee.safetyNumber")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-surface w-full max-w-md overflow-hidden rounded-lg shadow-lg">
        <div className="border-outline-variant flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-title-md text-on-surface font-semibold">{t("e2ee.safetyNumber")}</h2>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="md3-icon-btn text-on-surface-variant"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4">
          <p className="text-body-sm text-on-surface-variant mb-4">
            {t("e2ee.safetyNumberDesc", { name: peerName })}
          </p>

          {loading && <p className="text-body-md text-on-surface-variant">{t("common.loading")}</p>}
          {error && <p className="text-body-md text-error">{error}</p>}

          {digits && (
            <div className="bg-surface-container-low grid grid-cols-3 gap-2 rounded-lg p-4 text-center">
              {groupDigits(digits).map((g, i) => (
                <span key={i} className="text-title-md text-on-surface font-mono tracking-wider">
                  {g}
                </span>
              ))}
            </div>
          )}

          {digits && (
            <div className="text-label-md text-on-surface-variant mt-4 flex items-start gap-2">
              <ShieldCheck size={16} className="text-primary mt-0.5 shrink-0" />
              <p>{t("e2ee.safetyNumberVerifyHint")}</p>
            </div>
          )}
        </div>

        <div className="border-outline-variant flex items-center justify-between gap-2 border-t px-4 py-3">
          <button
            onClick={() => {
              resetSession(selfId, peerId);
              setResetDone(true);
            }}
            className="text-label-lg text-error hover:bg-error/10 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 font-medium"
          >
            <RefreshCw size={16} />
            {resetDone ? t("e2ee.sessionReset") : t("e2ee.resetSession")}
          </button>
          <button
            onClick={onClose}
            className="text-label-lg bg-primary text-primary-on rounded-lg px-4 py-2 font-medium"
          >
            {t("common.ok")}
          </button>
        </div>
      </div>
    </div>
  );
}
