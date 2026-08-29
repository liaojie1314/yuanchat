/**
 * ForgotPasswordScreen — 忘记密码三段式改密屏
 *
 * @description
 * 手机号 → 验证码 → 新密码三步走，三步分别打后端
 * `/auth/password/otp`、`/auth/password/verify`、`/auth/password/reset`。
 * web 与桌面共用这一份实现，两端页面只做路由与端差异注入。
 *
 * 三条与后端契约绑死的交互：
 * 1. 发码成功是 204，且**手机号未注册时响应完全相同** —— 因此这里没有、也不能有
 *    任何「该号未注册」的分支，否则等于把用户枚举做成了功能。
 * 2. 验证码错误时后端不消耗验证码 —— 报错后停在第 2 步让用户原地重输，不重新发码。
 * 3. 改密成功后该用户所有设备的令牌立即失效 —— 成功即清本地登录态并回登录页。
 *
 * 票据有效期一律取后端下发的 `expires_in`，倒计时归零即退回第 1 步重走流程
 * （票据与验证码 TTL 相同，此时旧验证码同样已失效）。
 */
import { useState, useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { KeyRound, ArrowLeft, Check } from "lucide-react";
import { sendResetCode, verifyResetCode, resetPassword, useAuthStore } from "@yuanchat/shared";
import { validatePassword, validatePhone } from "@yuanchat/shared/utils";
import { Button } from "../Button";
import { Input } from "../Input";
import { mapAuthError } from "./mapAuthError";

type Step = 1 | 2 | 3;

/** 重发冷却秒数，与后端 `auth:pwd:otp:cd` 键的 60s TTL 对齐 */
const RESEND_COOLDOWN_SECONDS = 60;
/** 验证码位数，与后端下发的 6 位数字对齐 */
const OTP_LENGTH = 6;

export interface ForgotPasswordScreenProps {
  /** 窗口顶栏插槽（桌面端注入自绘标题栏；web 端不传） */
  topSlot?: ReactNode;
  /** 返回登录的导航行为（完成或放弃时调用）；不传则渲染 `<Link to="/login">` */
  onDone?: () => void;
}

/** 秒 → `m:ss`，票据剩余时间展示用 */
function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return String(minutes) + ":" + (seconds < 10 ? "0" : "") + String(seconds);
}

/**
 * 忘记密码三段式改密屏
 *
 * @param props - 见 {@link ForgotPasswordScreenProps}
 *
 * @example
 * // web：路由内直接用，返回登录走 <Link>
 * <ForgotPasswordScreen />
 * // 桌面：注入自绘标题栏与窗口级返回
 * <ForgotPasswordScreen topSlot={<TitleBar showMaximize={false} />} onDone={closeWindow} />
 */
export function ForgotPasswordScreen({ topSlot, onDone }: ForgotPasswordScreenProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>(1);
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [ticket, setTicket] = useState("");
  /** 票据剩余秒数；null 表示当前没有票据 */
  const [ticketSeconds, setTicketSeconds] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [otpError, setOtpError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // 重发冷却倒计时
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  // 票据倒计时：归零即丢弃票据退回第 1 步，避免用户填完密码才拿到一句笼统的失败
  useEffect(() => {
    if (ticketSeconds === null) return;
    if (ticketSeconds <= 0) {
      setTicket("");
      setTicketSeconds(null);
      setOtp("");
      setNewPassword("");
      setConfirmPassword("");
      setOtpError("");
      setPasswordError("");
      setConfirmError("");
      setStep(1);
      setPhoneError(t("auth.resetTicketExpired"));
      return;
    }
    const timer = setTimeout(() => setTicketSeconds((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(timer);
  }, [ticketSeconds, t]);

  /** 第 1 步发码，也是第 2 步「重发」的处理器（重发同样走真实发码端点） */
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
      await sendResetCode(phone);
      setCountdown(RESEND_COOLDOWN_SECONDS);
      // 重发后服务端换了新码，旧输入作废
      setOtp("");
      setOtpError("");
      setStep(2);
    } catch (e) {
      const message = t(mapAuthError(e, "auth.sendFailed"));
      if (step === 2) setOtpError(message);
      else setPhoneError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== OTP_LENGTH) {
      setOtpError(t("auth.otpRequired"));
      return;
    }
    setOtpError("");
    setLoading(true);
    try {
      const verified = await verifyResetCode(phone, otp);
      setTicket(verified.resetTicket);
      setTicketSeconds(verified.expiresIn);
      setStep(3);
    } catch (e) {
      // 验证码没被后端消耗，停在本步原地重输即可，不重新发码
      setOtpError(t(mapAuthError(e, "auth.otpWrong")));
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
      await resetPassword(ticket, newPassword);
      // 服务端已把 token_version 递增，本地令牌全部作废，继续用只会拿 401
      useAuthStore.getState().clearSession();
      setTicketSeconds(null);
      setDone(true);
    } catch (e) {
      setPasswordError(t(mapAuthError(e, "auth.resetFailed")));
    } finally {
      setLoading(false);
    }
  };

  const steps: Step[] = [1, 2, 3];
  const stepLabels = [t("auth.phone"), t("auth.verificationCode"), t("auth.newPassword")];

  return (
    <div className="surface-gradient app-screen relative flex flex-col overflow-hidden">
      {/* 背景装饰 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="aurora-orb -top-20 -left-20 h-[500px] w-[500px] bg-[#7EC8E3]" />
        <div className="aurora-orb top-1/2 -right-32 h-[400px] w-[400px] bg-[#A8CFFF]" />
        <div className="aurora-orb -bottom-20 left-1/3 h-[350px] w-[350px] bg-[#B8D8F0]" />
      </div>
      <div className="dot-grid pointer-events-none absolute inset-0" />

      {topSlot}

      <div className="relative flex flex-1 flex-col overflow-y-auto">
        <div className="relative m-auto w-full max-w-md px-5 py-8">
          {/* 磨砂玻璃卡片 */}
          <div className="rounded-lg border border-white/60 bg-white/70 px-10 py-12 shadow-[0_8px_40px_rgba(0,0,0,0.08)] backdrop-blur-2xl">
            {/* Logo */}
            <div className="mb-6 text-center">
              <div className="brand-gradient glow-brand mx-auto mb-4 inline-flex h-16 w-16 items-center justify-center rounded-lg text-white shadow-lg">
                <KeyRound size={28} />
              </div>
              <h1 className="text-on-surface text-2xl font-bold">{t("auth.resetPassword")}</h1>
            </div>

            {done ? (
              /* 成功状态 */
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
                  <Check size={28} className="text-green-600" />
                </div>
                <p className="text-on-surface font-medium">{t("auth.resetSuccess")}</p>
                <p className="text-on-surface-variant mt-1 text-sm">{t("auth.resetSuccessHint")}</p>
                {onDone ? (
                  <button
                    type="button"
                    onClick={onDone}
                    className="bg-primary text-on-primary mt-6 block w-full rounded-lg py-3 text-center text-sm font-semibold transition-opacity hover:opacity-90"
                  >
                    {t("auth.loginNow")}
                  </button>
                ) : (
                  <Link
                    to="/login"
                    replace
                    className="bg-primary text-on-primary mt-6 block w-full rounded-lg py-3 text-center text-sm font-semibold transition-opacity hover:opacity-90"
                  >
                    {t("auth.loginNow")}
                  </Link>
                )}
              </div>
            ) : (
              <>
                {/* 步骤指示器 */}
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
                        <span className="text-on-surface-variant text-[10px]">
                          {stepLabels[idx]}
                        </span>
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

                {/* 第 1 步：手机号 */}
                {step === 1 && (
                  <div className="space-y-1">
                    <p className="text-on-surface-variant mb-4 text-center text-sm">
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

                {/* 第 2 步：验证码 */}
                {step === 2 && (
                  <div className="space-y-1">
                    <p className="text-on-surface-variant mb-4 text-center text-sm">
                      {t("auth.otpSentTo", { phone })}
                    </p>
                    <Input
                      placeholder={t("auth.otpPlaceholder")}
                      type="text"
                      maxLength={OTP_LENGTH}
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
                        disabled={countdown > 0 || loading}
                        onClick={handleSendOtp}
                        className="text-on-surface-variant hover:text-primary text-xs disabled:cursor-not-allowed disabled:opacity-50"
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

                {/* 第 3 步：新密码 */}
                {step === 3 && (
                  <div className="space-y-1">
                    <p className="text-on-surface-variant mb-1 text-center text-sm">
                      {t("auth.resetStepPasswordHint")}
                    </p>
                    {ticketSeconds !== null && (
                      <p className="text-on-surface-variant mb-4 text-center text-xs">
                        {t("auth.resetTicketRemaining", { time: formatDuration(ticketSeconds) })}
                      </p>
                    )}
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
                    <Button
                      className="mt-1 w-full"
                      onClick={handleResetPassword}
                      disabled={loading}
                    >
                      {loading ? t("auth.submitting") : t("auth.confirmChange")}
                    </Button>
                  </div>
                )}

                <p className="mt-6 text-center text-sm">
                  {onDone ? (
                    <button
                      type="button"
                      onClick={onDone}
                      className="text-on-surface-variant hover:text-primary inline-flex items-center gap-1.5 hover:opacity-80"
                    >
                      <ArrowLeft size={14} />
                      {t("auth.backToLogin")}
                    </button>
                  ) : (
                    <Link
                      to="/login"
                      replace
                      className="text-on-surface-variant hover:text-primary inline-flex items-center gap-1.5 hover:opacity-80"
                    >
                      <ArrowLeft size={14} />
                      {t("auth.backToLogin")}
                    </Link>
                  )}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
