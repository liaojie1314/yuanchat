import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button, Input } from "@yuanchat/ui";
import { validatePassword, validatePhone } from "@yuanchat/shared/utils";
import { KeyRound, ArrowLeft, Check } from "lucide-react";

type Step = 1 | 2 | 3;

export function ForgotPasswordPage() {
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
      setPhoneError(result.errors[0]);
      return;
    }
    setPhoneError("");
    setLoading(true);
    try {
      await new Promise<void>((r) => setTimeout(r, 500));
      startCountdown();
      setStep(2);
    } catch {
      setPhoneError("发送失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length < 4) {
      setOtpError("请输入验证码");
      return;
    }
    setOtpError("");
    setLoading(true);
    try {
      await new Promise<void>((r) => setTimeout(r, 500));
      setStep(3);
    } catch {
      setOtpError("验证码错误，请重试");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    let valid = true;
    const result = validatePassword(newPassword);
    if (!result.valid) {
      setPasswordError(result.errors[0]);
      valid = false;
    }
    if (newPassword !== confirmPassword) {
      setConfirmError("两次密码不一致");
      valid = false;
    }
    if (!valid) return;

    setLoading(true);
    try {
      await new Promise<void>((r) => setTimeout(r, 500));
      setDone(true);
    } catch {
      setPasswordError("重置失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  const steps: Step[] = [1, 2, 3];
  const stepLabels = ["手机号", "验证码", "新密码"];

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
        <div className="rounded-3xl border border-white/60 bg-white/70 px-10 py-12 shadow-[0_8px_40px_rgba(0,0,0,0.08)] backdrop-blur-2xl">
          {/* Logo */}
          <div className="mb-6 text-center">
            <div className="brand-gradient glow-brand mx-auto mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl text-white shadow-lg">
              <KeyRound size={28} />
            </div>
            <h1 className="text-2xl font-bold text-on-surface">重置密码</h1>
          </div>

          {done ? (
            /* 成功状态 */
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
                <Check size={28} className="text-green-600" />
              </div>
              <p className="font-medium text-on-surface">密码重置成功</p>
              <p className="text-on-surface-variant mt-1 text-sm">请使用新密码登录</p>
              <Link
                to="/login"
                replace
                className="text-on-primary mt-6 block w-full rounded-xl bg-primary py-3 text-center text-sm font-semibold transition-opacity hover:opacity-90"
              >
                立即登录
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
                            ? "text-on-primary bg-primary"
                            : "text-on-surface-variant bg-surface-container",
                        ].join(" ")}
                      >
                        {step > s ? <Check size={14} /> : s}
                      </div>
                      <span className="text-on-surface-variant text-[10px]">{stepLabels[idx]}</span>
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
                  <p className="text-on-surface-variant mb-4 text-center text-sm">
                    输入绑定的手机号，发送验证码
                  </p>
                  <Input
                    placeholder="手机号"
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
                    {loading ? "发送中…" : "发送验证码"}
                  </Button>
                </div>
              )}

              {/* Step 2: OTP */}
              {step === 2 && (
                <div className="space-y-1">
                  <p className="text-on-surface-variant mb-4 text-center text-sm">
                    验证码已发送至 {phone}
                  </p>
                  <Input
                    placeholder="6 位验证码"
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
                      className="text-on-surface-variant text-xs hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {countdown > 0 ? `重新发送 (${countdown}s)` : "重新发送"}
                    </button>
                  </div>
                  <Button className="mt-1 w-full" onClick={handleVerifyOtp} disabled={loading}>
                    {loading ? "验证中…" : "下一步"}
                  </Button>
                </div>
              )}

              {/* Step 3: New password */}
              {step === 3 && (
                <div className="space-y-1">
                  <p className="text-on-surface-variant mb-4 text-center text-sm">
                    设置新密码（至少 8 位）
                  </p>
                  <Input
                    placeholder="新密码"
                    type="password"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      if (passwordError) setPasswordError("");
                    }}
                    error={passwordError}
                  />
                  <Input
                    placeholder="确认新密码"
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
                    {loading ? "提交中…" : "确认修改"}
                  </Button>
                </div>
              )}

              <p className="mt-6 text-center text-sm">
                <Link
                  to="/login"
                  replace
                  className="text-on-surface-variant inline-flex items-center gap-1.5 hover:text-primary hover:opacity-80"
                >
                  <ArrowLeft size={14} />
                  返回登录
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
