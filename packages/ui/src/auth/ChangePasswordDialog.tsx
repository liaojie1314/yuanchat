/**
 * 登录态改密弹窗
 *
 * @description
 * 凭当前密码改密，不走短信验证码 —— 与忘记密码那条三段式链路是两个入口：
 * 那条用短信证明手机号归属（登不进来时用），这条用当前密码证明本人在场。
 *
 * 改密成功后服务端递增 token_version，**包括当前设备在内**所有既有令牌立即失效，
 * 因此收尾必须清掉本地登录态回登录页，不能停在原页面继续用旧令牌请求。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { changePassword, useAuthStore } from "@yuanchat/shared";
import { validatePassword } from "@yuanchat/shared/utils";
import { Button } from "../primitives/Button";
import { Input } from "../primitives/Input";
import { mapAuthError } from "./mapAuthError";

export interface ChangePasswordDialogProps {
  /** 是否打开 */
  open: boolean;
  /** 关闭弹窗（取消或改密成功后由调用方决定后续跳转） */
  onClose: () => void;
}

/**
 * 改密弹窗
 *
 * @param props - 见 {@link ChangePasswordDialogProps}
 */
export function ChangePasswordDialog({ open, onClose }: ChangePasswordDialogProps) {
  const { t } = useTranslation();
  const clearSession = useAuthStore((s) => s.clearSession);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  function reset() {
    setOldPassword("");
    setNewPassword("");
    setConfirm("");
    setError("");
  }

  async function handleSubmit() {
    setError("");
    // 复杂度先在本地过一遍，省掉一次注定失败的请求；服务端仍会独立校验
    const check = validatePassword(newPassword);
    if (!check.valid) {
      setError(t(check.errors[0]));
      return;
    }
    if (newPassword !== confirm) {
      setError(t("auth.passwordMismatch"));
      return;
    }

    setLoading(true);
    try {
      await changePassword(oldPassword, newPassword);
      reset();
      onClose();
      // 令牌已被服务端吊销，留在原页面只会连续拿到 401
      clearSession();
    } catch (e) {
      setError(t(mapAuthError(e, "auth.changePasswordFailed")));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="bg-scrim/40 absolute inset-0"
        onClick={() => {
          reset();
          onClose();
        }}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.changePassword")}
        className="bg-surface-container-high shadow-elevation-3 relative w-full max-w-sm rounded-lg p-5"
      >
        <h2 className="text-title-md text-on-surface mb-4 font-semibold">
          {t("settings.changePassword")}
        </h2>

        <div className="flex flex-col gap-3">
          <Input
            type="password"
            placeholder={t("auth.oldPassword")}
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
          />
          <Input
            type="password"
            placeholder={t("auth.newPassword")}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <Input
            type="password"
            placeholder={t("auth.confirmNewPassword")}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        {error !== "" && (
          <p role="alert" className="text-error mt-3 text-sm">
            {error}
          </p>
        )}

        <p className="text-on-surface-variant mt-3 text-xs">{t("settings.changePasswordHint")}</p>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="text-label-lg border-outline-variant text-on-surface flex-1 rounded-lg border py-2.5 font-medium"
          >
            {t("common.cancel")}
          </button>
          <Button
            className="flex-1"
            disabled={loading || oldPassword === "" || newPassword === "" || confirm === ""}
            onClick={() => void handleSubmit()}
          >
            {loading ? t("auth.submitting") : t("common.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
