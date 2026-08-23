import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Input } from "@yuanchat/ui";
import { validatePassword, validatePhone } from "@yuanchat/shared/utils";
import { KeyRound, ArrowLeft, Check } from "lucide-react";

type Step = 1 | 2 | 3;

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>(1);
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [otpError, setOtpError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const startCountdown = () => setCountdown(60);

  const handleSendOtp = async () => {
    const result = validatePhone(phone);
    if (!result.valid) {
      // 校验工具返回 i18n key，落地文案在这里翻译
      setPhoneError(t(result.errors[0]));
      return;
    }
    setPhoneError("");
    setLoading(true);
    try {
      await new Promise<void>((r) => setTimeout(r, 500));
      startCountdown();
      setStep(2);
    } catch {
      setPhoneError(t("auth.sendFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length < 4) {
      setOtpError(t("auth.captchaRequired"));
      return;
    }
    setOtpError("");
    setLoading(true);
    try {
      await new Promise<void>((r) => setTimeout(r, 500));
      setStep(3);
    } catch {
      setOtpError(t("auth.otpWrong"));
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    let valid = true;
    const result = validatePassword(newPassword);
    if (!result.valid) {
      setPasswordError(t(result.errors[0]));
      valid = false;
    }
    if (newPassword !== confirmPassword) {
      setConfirmError(t("auth.passwordMismatch"));
      valid = false;
    }
    if (!valid) return;

    setLoading(true);
    try {
      await new Promise<void>((r) => setTimeout(r, 500));
      setDone(true);
    } catch {
      setPasswordError(t("auth.resetFailed"));
    } finally {
      setLoading(false);
    }
  };

  const steps: Step[] = [1, 2, 3];
  const stepLabels = [t("auth.phone"), t("auth.verificationCode"), t("auth.newPassword")];

  return (
    <div className="surface-gradient relative flex min-h-[var(--app-height,100vh)] flex-col overflow-y-auto">
      {/* 背景装饰 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="aurora-orb -left-20 -top-20 h-[500px] w-[500px] bg-[#7EC8E3]" />
        <div className="aurora-orb -right-32 top-1/2 h-[400px] w-[400px] bg-[#A8CFFF]" />
        <div className="aurora-orb -bottom-20 left-1/3 h-[350px] w-[350px] bg-[#B8D8F0]" />
      </div>
      <div className="dot-grid pointer-events-none fixed inset-0" />

      <div className="relative m-auto w-full max-w-md px-5 py-8">
        {/* 磨砂玻璃卡片 */}
        <div className="rounded-lg border border-white/60 bg-white/70 px-10 py-12 shadow-[0_8px_40px_rgba(0,0,0,0.08)] backdrop-blur-2xl">
          {/* Logo */}
          <div className="mb-6 text-center">
            <div className="brand-gradient glow-brand mx-auto mb-4 inline-flex h-16 w-16 items-center justify-center rounded-lg text-white shadow-lg">
              <KeyRound size={28} />
            </div>
            <h1 className="text-2xl font-bold text-on-surface">{t("auth.resetPassword")}</h1>
          </div>

          {done ? (
            /* 成功状态 */
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
                <Check size={28} className="text-green-600" />
              </div>
              <p className="font-medium text-on-surface">{t("auth.resetSuccess")}</p>
              <p className="mt-1 text-sm text-on-surface-variant">{t("auth.resetSuccessHint")}</p>
              <Link
                to="/login"
                replace
                className="mt-6 block w-full rounded-lg bg-primary py-3 text-center text-sm font-semibold text-on-primary transition-opacity hover:opacity-90"
              >
                {t("auth.loginNow")}
              </Link>
            </div>
          ) : (
            <>
              {/* Step indicator */}
              <div className="mb-8 flex items-center justify-center">
                {steps.map((s, idx) => (
                  <div key={s} className="flex items-center">
                    <div className="flex flex-col items-center gap-1">
                      <div
                        className={[
                          "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                          step >= s
                            ? "bg-primary text-on-primary"
                            : "bg-surface-container text-on-surface-variant",
                        ].join(" ")}
                      >
                        {step > s ? <Check size={14} /> : s}
                      </div>
                      <span className="text-[10px] text-on-surface-variant">{stepLabels[idx]}</span>
                    </div>
                    {idx < steps.length - 1 && (
                      <div
                        className={[
                          "mb-4 h-0.5 w-14 transition-colors",
                          step > s ? "bg-primary" : "bg-surface-container",
                        ].join(" ")}
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* Step 1: Phone */}
              {step === 1 && (
                <div className="space-y-1">
                  <p className="mb-4 text-center text-sm text-on-surface-variant">
                    {t("auth.resetStepPhoneHint")}
                  </p>
                  <Input
                    placeholder={t("auth.phone")}
                    type="tel"
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      if (phoneError) setPhoneError("");
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
                    error={phoneError}
                  />
                  <Button className="mt-1 w-full" onClick={handleSendOtp} disabled={loading}>
                    {loading ? t("auth.sending") : t("auth.sendCode")}
                  </Button>
                </div>
              )}

              {/* Step 2: OTP */}
              {step === 2 && (
                <div className="space-y-1">
                  <p className="mb-4 text-center text-sm text-on-surface-variant">
                    {t("auth.otpSentTo", { phone })}
                  </p>
                  <Input
                    placeholder={t("auth.otpPlaceholder")}
                    type="text"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => {
                      setOtp(e.target.value.replace(/\D/g, ""));
                      if (otpError) setOtpError("");
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handleVerifyOtp()}
                    error={otpError}
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={countdown > 0}
                      onClick={startCountdown}
                      className="text-xs text-on-surface-variant hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {countdown > 0
                        ? t("auth.resendIn", { seconds: countdown })
                        : t("auth.resend")}
                    </button>
                  </div>
                  <Button className="mt-1 w-full" onClick={handleVerifyOtp} disabled={loading}>
                    {loading ? t("auth.verifying") : t("auth.next")}
                  </Button>
                </div>
              )}

              {/* Step 3: New password */}
              {step === 3 && (
                <div className="space-y-1">
                  <p className="mb-4 text-center text-sm text-on-surface-variant">
                    {t("auth.resetStepPasswordHint")}
                  </p>
                  <Input
                    placeholder={t("auth.newPassword")}
                    type="password"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      if (passwordError) setPasswordError("");
                    }}
                    error={passwordError}
                  />
                  <Input
                    placeholder={t("auth.confirmNewPassword")}
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      if (confirmError) setConfirmError("");
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handleResetPassword()}
                    error={confirmError}
                  />
                  <Button className="mt-1 w-full" onClick={handleResetPassword} disabled={loading}>
                    {loading ? t("auth.submitting") : t("auth.confirmChange")}
                  </Button>
                </div>
              )}

              <p className="mt-6 text-center text-sm">
                <Link
                  to="/login"
                  replace
                  className="inline-flex items-center gap-1.5 text-on-surface-variant hover:text-primary hover:opacity-80"
                >
                  <ArrowLeft size={14} />
                  {t("auth.backToLogin")}
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
