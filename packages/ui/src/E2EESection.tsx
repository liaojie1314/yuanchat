/**
 * E2EESection — 设置 → 账号与安全 内嵌的端到端加密管理块
 *
 * @description
 * 三块功能：
 * 1. **开关**：开启时生成/上传密钥（灰度默认关）；关闭保留本地密钥
 *    （否则已收的加密历史将永久无法解密）
 * 2. **PIN 备份**：把密钥包加密上传，换设备可恢复；强调 PIN 忘记 = 备份作废
 * 3. **恢复**：新设备输入 PIN 拉回备份（含全部会话棘轮状态）
 */
import { useEffect, useState } from "react";
import { Lock, CloudUpload, CloudDownload } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useAuthStore,
  isEnabled,
  enableE2EE,
  disableE2EE,
  createBackup,
  restoreBackup,
  hasRemoteBackup,
  showToast,
  WeakPinError,
  BackupDecryptError,
  MIN_PIN_LENGTH,
} from "@yuanchat/shared";

type PinMode = "none" | "backup" | "restore";

export function E2EESection() {
  const { t } = useTranslation();
  const userId = useAuthStore((s) => s.user?.id);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [remoteBackup, setRemoteBackup] = useState(false);
  const [pinMode, setPinMode] = useState<PinMode>("none");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!userId) return;
    setEnabled(isEnabled(userId));
    void hasRemoteBackup()
      .then(setRemoteBackup)
      .catch(() => {});
  }, [userId]);

  if (!userId) return null;

  const toggle = async () => {
    setBusy(true);
    setError("");
    try {
      if (enabled) {
        disableE2EE(userId);
        setEnabled(false);
      } else {
        await enableE2EE(userId);
        setEnabled(true);
        showToast("info", t("e2ee.enabledToast"));
      }
    } catch {
      showToast("error", t("common.opFailed"));
    } finally {
      setBusy(false);
    }
  };

  const submitPin = async () => {
    setBusy(true);
    setError("");
    try {
      if (pinMode === "backup") {
        await createBackup(userId, pin);
        setRemoteBackup(true);
        showToast("info", t("e2ee.backupDone"));
        setPinMode("none");
        setPin("");
      } else if (pinMode === "restore") {
        const found = await restoreBackup(userId, pin);
        if (!found) {
          setError(t("e2ee.noBackup"));
          return;
        }
        setEnabled(isEnabled(userId));
        showToast("info", t("e2ee.restoreDone"));
        setPinMode("none");
        setPin("");
      }
    } catch (e) {
      if (e instanceof WeakPinError) {
        setError(t("e2ee.pinTooShort", { min: MIN_PIN_LENGTH }));
      } else if (e instanceof BackupDecryptError) {
        setError(t("e2ee.wrongPin"));
      } else {
        setError(t("common.opFailed"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-outline-variant bg-surface-container-low mb-6 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-body-md text-on-surface flex items-center gap-1.5 font-medium">
            <Lock size={15} className="text-primary" />
            {t("e2ee.title")}
          </p>
          <p className="text-label-md text-on-surface-variant mt-0.5">
            {enabled ? t("e2ee.enabledDesc") : t("e2ee.disabledDesc")}
          </p>
        </div>
        <button
          onClick={() => void toggle()}
          disabled={busy}
          className="text-label-lg border-outline-variant text-on-surface hover:bg-surface-container shrink-0 rounded-lg border px-3 py-2 font-medium disabled:opacity-50"
        >
          {enabled ? t("push.disable") : t("push.enable")}
        </button>
      </div>

      {/* 备份/恢复入口 */}
      <div className="border-outline-variant mt-3 flex gap-2 border-t pt-3">
        {enabled && (
          <button
            onClick={() => {
              setPinMode(pinMode === "backup" ? "none" : "backup");
              setPin("");
              setError("");
            }}
            className="text-label-lg text-primary hover:bg-primary/10 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium"
          >
            <CloudUpload size={15} />
            {remoteBackup ? t("e2ee.updateBackup") : t("e2ee.createBackup")}
          </button>
        )}
        <button
          onClick={() => {
            setPinMode(pinMode === "restore" ? "none" : "restore");
            setPin("");
            setError("");
          }}
          className="text-label-lg text-on-surface-variant hover:bg-surface-container inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium"
        >
          <CloudDownload size={15} />
          {t("e2ee.restoreBackup")}
        </button>
      </div>

      {/* PIN 输入区 */}
      {pinMode !== "none" && (
        <div className="mt-3">
          <p className="text-label-md text-on-surface-variant mb-2">
            {pinMode === "backup" ? t("e2ee.backupPinHint") : t("e2ee.restorePinHint")}
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && pin && void submitPin()}
              placeholder={t("e2ee.pinPlaceholder", { min: MIN_PIN_LENGTH })}
              className="border-outline-variant bg-surface text-body-md text-on-surface flex-1 rounded-lg border px-3 py-2 outline-none"
            />
            <button
              onClick={() => void submitPin()}
              disabled={busy || !pin}
              className="text-label-lg bg-primary text-primary-on rounded-lg px-4 py-2 font-medium disabled:opacity-50"
            >
              {t("common.confirm")}
            </button>
          </div>
          {error && <p className="text-label-md text-error mt-2">{error}</p>}
          {pinMode === "backup" && (
            <p className="text-label-sm text-on-surface-variant mt-2 opacity-80">
              {t("e2ee.pinWarning")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
