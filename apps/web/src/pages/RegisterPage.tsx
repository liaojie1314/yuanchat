import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { Button, Input } from "@yuanchat/ui";
import { useAuthStore, API_BASE } from "@yuanchat/shared";
import { validatePassword, validatePhone, validateNickname } from "@yuanchat/shared/utils";
import { UserPlus, RefreshCw } from "lucide-react";

export function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const registerWithPassword = useAuthStore((s) => s.registerWithPassword);

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [captchaImg, setCaptchaImg] = useState("");
  const [captchaID, setCaptchaID] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [nicknameError, setNicknameError] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [captchaError, setCaptchaError] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchCaptcha = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/captcha`);
      setCaptchaImg(await res.text());
      setCaptchaID(res.headers.get("X-Captcha-ID") || "");
    } catch {
      /* 后端未启动 */
    }
  };

  useEffect(() => {
    fetchCaptcha();
  }, []);

  const clearErrors = () => {
    setNicknameError("");
    setPhoneError("");
    setPasswordError("");
    setCaptchaError("");
  };

  const handleRegister = async () => {
    clearErrors();
    let valid = true;

    const nnResult = validateNickname(nickname);
    if (!nnResult.valid) {
      // 校验工具返回 i18n key，落地文案在这里翻译
      setNicknameError(t(nnResult.errors[0]));
      valid = false;
    }

    const phResult = validatePhone(phone);
    if (!phResult.valid) {
      setPhoneError(t(phResult.errors[0]));
      valid = false;
    }

    const pwResult = validatePassword(password);
    if (!pwResult.valid) {
      setPasswordError(t(pwResult.errors[0]));
      valid = false;
    }

    if (!captchaAnswer.trim()) {
      setCaptchaError(t("auth.captchaRequired"));
      valid = false;
    }
    if (!valid) return;

    setLoading(true);
    try {
      await registerWithPassword(phone, password, captchaID, Number(captchaAnswer), nickname);
      navigate("/chat", { replace: true });
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : t("auth.registerFailed"));
      fetchCaptcha();
      setCaptchaAnswer("");
    } finally {
      setLoading(false);
    }
  };

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
          <div className="mb-7 text-center">
            <div className="brand-gradient glow-brand mx-auto mb-4 inline-flex h-16 w-16 items-center justify-center rounded-lg text-white shadow-lg">
              <UserPlus size={30} />
            </div>
            <h1 className="text-2xl font-bold text-on-surface">{t("auth.createAccount")}</h1>
            <p className="mt-1 text-sm text-on-surface-variant">
              {/* 「元聊号」在句中要标主题色，各语言词序不同，用 Trans 按标签插槽渲染 */}
              <Trans
                i18nKey="auth.registerHint"
                components={{ id: <span className="font-medium text-primary" /> }}
              />
            </p>
          </div>

          <div className="space-y-1">
            <Input
              placeholder={t("auth.nickname")}
              value={nickname}
              onChange={(e) => {
                setNickname(e.target.value);
                if (nicknameError) setNicknameError("");
              }}
              error={nicknameError}
            />
            <Input
              placeholder={t("auth.phone")}
              type="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (phoneError) setPhoneError("");
              }}
              error={phoneError}
            />
            <Input
              placeholder={t("auth.passwordPlaceholder")}
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (passwordError) setPasswordError("");
              }}
              error={passwordError}
            />

            {/* 验证码行 */}
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <Input
                  placeholder={t("auth.verificationCode")}
                  value={captchaAnswer}
                  onChange={(e) => {
                    setCaptchaAnswer(e.target.value);
                    if (captchaError) setCaptchaError("");
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleRegister()}
                  error={captchaError}
                />
              </div>
              <button
                type="button"
                onClick={fetchCaptcha}
                className="group relative mt-[1px] h-12 w-[120px] shrink-0 overflow-hidden rounded-lg border border-outline-variant bg-surface-container-low"
                title={t("auth.captchaRefresh")}
              >
                <span
                  className="block h-full w-full [&>svg]:h-full [&>svg]:w-full"
                  dangerouslySetInnerHTML={{
                    __html:
                      captchaImg ||
                      `<span class="flex h-full items-center justify-center text-xs text-on-surface-variant">${t("auth.captchaLoad")}</span>`,
                  }}
                />
                <span className="absolute inset-0 flex items-center justify-center bg-surface/80 opacity-0 transition-opacity group-hover:opacity-100">
                  <RefreshCw size={14} className="text-primary" />
                </span>
              </button>
            </div>

            <Button className="mt-1 w-full" onClick={handleRegister} disabled={loading}>
              {loading ? t("auth.registering") : t("auth.register")}
            </Button>
          </div>

          <p className="mt-6 text-center text-sm text-on-surface-variant">
            {t("auth.hasAccount")}{" "}
            <Link to="/login" replace className="font-medium text-primary hover:opacity-80">
              {t("auth.loginNow")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
