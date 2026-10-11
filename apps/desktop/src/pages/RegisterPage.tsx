/**
 * 注册页（桌面 / 移动 Tauri 壳）
 *
 * @description
 * 邮箱验证码注册：邮箱 → 获取验证码（60 秒冷却）→ 填码 + 密码 + 昵称 → 建号即登录。
 * 注册只收邮箱 —— 验证码通道是 SMTP，手机号拿不到码，填了也无从验证归属。
 * 交互与 Web 端注册页保持一致，这里只多出自绘标题栏与窗口级返回。
 *
 * 「获取验证码」按钮在倒计时与非倒计时两种态下宽度固定，避免文案长短不一导致布局抖动。
 */
import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { Button, Input } from "@yuanchat/ui";
import { useAuthStore, useIsDesktop, ApiError } from "@yuanchat/shared";
import { cn, validatePassword, validateNickname, validateEmail } from "@yuanchat/shared/utils";
import { useCloseAuthWindow } from "../hooks/useTauriAuth";
import { useIsMobile } from "../hooks/useIsMobile";
import { TitleBar } from "../components/TitleBar";
import { UserPlus, ArrowLeft } from "lucide-react";

/** 重发冷却秒数，与后端同邮箱 60s 冷却对齐 */
const RESEND_COOLDOWN_SECONDS = 60;
/** 验证码位数，与后端下发的 6 位数字对齐 */
const OTP_LENGTH = 6;

/**
 * 后端可以直接上屏的 i18n key 白名单
 *
 * 业务错误的 `message` 本身就是 i18n key，但 IP 限流中间件回的是一句裸英文，
 * 直接交给 `t()` 会把英文原文上屏并绕开 i18n 约束，因此只放行这里列出的 key。
 */
const PASSTHROUGH_KEYS = new Set([
  "auth.emailInvalid",
  "auth.otpCooldown",
  "auth.sendFailed",
  "auth.otpWrong",
  "auth.accountLocked",
  "auth.accountTaken",
]);

/**
 * 注册链路的接口错误 → 可交给 `t()` 的 i18n key
 *
 * @param err - `catch` 到的异常，通常是 `ApiError`
 * @param fallbackKey - 非白名单 message（含网络异常）时的兜底 key
 */
function authErrorKey(err: unknown, fallbackKey: string): string {
  if (!(err instanceof ApiError)) return fallbackKey;
  if (PASSTHROUGH_KEYS.has(err.message)) return err.message;
  // 密码强度不足时后端把命中规则的 validation.password* key 放进 message
  if (err.message.startsWith("validation.")) return err.message;
  return err.code === 429 ? "auth.rateLimited" : fallbackKey;
}

/** 邮箱验证码注册页（桌面 / 移动） */
export function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const isMobile = useIsMobile();
  const closeAuthWindow = useCloseAuthWindow();
  const requestRegisterCode = useAuthStore((s) => s.requestRegisterCode);
  const registerWithPassword = useAuthStore((s) => s.registerWithPassword);

  const goToLogin = async () => {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const mainWindow = await WebviewWindow.getByLabel("main");
      if (mainWindow) {
        await mainWindow.setFocus();
        await mainWindow.center();
      }
      await getCurrentWindow().close();
    } catch {
      navigate("/login", { replace: true });
    }
  };

  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  /** 已发码的目标邮箱；非空即表示发过码，按钮从「发送」切到「重新发送」 */
  const [sentTo, setSentTo] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [nicknameError, setNicknameError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [otpError, setOtpError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);

  // 重发冷却倒计时
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const clearErrors = () => {
    setNicknameError("");
    setEmailError("");
    setOtpError("");
    setPasswordError("");
  };

  /** 发码，也是倒计时结束后「重新发送」的处理器 */
  const handleSendCode = async () => {
    const result = validateEmail(email);
    if (!result.valid) {
      // 校验工具返回 i18n key，落地文案在这里翻译
      setEmailError(t(result.errors[0]));
      return;
    }
    setEmailError("");
    setSending(true);
    try {
      await requestRegisterCode(email.trim());
      setSentTo(email.trim());
      setCountdown(RESEND_COOLDOWN_SECONDS);
    } catch (e) {
      setEmailError(t(authErrorKey(e, "auth.sendFailed")));
    } finally {
      setSending(false);
    }
  };

  const handleRegister = async () => {
    clearErrors();
    let valid = true;

    const nnResult = validateNickname(nickname);
    if (!nnResult.valid) {
      setNicknameError(t(nnResult.errors[0]));
      valid = false;
    }

    const emResult = validateEmail(email);
    if (!emResult.valid) {
      setEmailError(t(emResult.errors[0]));
      valid = false;
    }

    if (code.trim().length !== OTP_LENGTH) {
      setOtpError(t("auth.otpRequired"));
      valid = false;
    }

    const pwResult = validatePassword(password);
    if (!pwResult.valid) {
      setPasswordError(t(pwResult.errors[0]));
      valid = false;
    }

    if (!valid) return;

    setLoading(true);
    try {
      await registerWithPassword(email.trim(), code.trim(), password, nickname);
      if (isDesktop) {
        await closeAuthWindow();
      } else {
        navigate("/chat", { replace: true });
      }
    } catch (e) {
      const key = authErrorKey(e, "auth.registerFailed");
      // 报错落在对应的那一行，而不是一股脑堆到密码行
      if (key === "auth.otpWrong" || key === "auth.accountLocked") {
        setOtpError(t(key));
      } else if (key === "auth.accountTaken" || key === "auth.emailInvalid") {
        setEmailError(t(key));
      } else {
        setPasswordError(t(key));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="surface-gradient app-screen relative flex flex-col overflow-hidden">
      {/* 背景装饰 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="aurora-orb -left-20 -top-20 h-[500px] w-[500px] bg-[#7EC8E3]" />
        <div className="aurora-orb -right-32 top-1/2 h-[400px] w-[400px] bg-[#A8CFFF]" />
        <div className="aurora-orb -bottom-20 left-1/3 h-[350px] w-[350px] bg-[#B8D8F0]" />
      </div>
      <div className="dot-grid pointer-events-none fixed inset-0" />

      {isDesktop && !isMobile && <TitleBar showMaximize={false} />}

      {!isDesktop && (
        <Link
          to="/login"
          replace
          className="absolute left-6 top-6 inline-flex items-center gap-1.5 rounded-full bg-surface-container/80 px-4 py-2 text-label-lg text-on-surface-variant backdrop-blur-sm transition-all hover:bg-surface-container-high hover:text-on-surface"
        >
          <ArrowLeft size={16} /> {t("auth.backToLogin")}
        </Link>
      )}

      <div className="relative flex flex-1 flex-col overflow-y-auto">
        <div
          className={cn("relative m-auto w-full max-w-md", isMobile ? "px-6 py-8" : "px-8 py-10")}
        >
          <div className="mb-7 text-center">
            <div className="brand-gradient glow-brand mx-auto mb-4 inline-flex h-16 w-16 items-center justify-center rounded-lg text-white">
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

            {/* 邮箱 + 获取验证码 */}
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <Input
                  placeholder={t("auth.emailPlaceholder")}
                  /* 占位符里带括号说明，读屏念出来啰嗦，另给一个简名 */
                  aria-label={t("auth.email")}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailError) setEmailError("");
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleSendCode()}
                  error={emailError}
                />
              </div>
              {/* 宽度钉死 104px：两种态文案长短不同，不固定宽度就是在引入 CLS */}
              <button
                type="button"
                onClick={handleSendCode}
                disabled={sending || countdown > 0}
                className="mt-[1px] h-12 w-[104px] shrink-0 rounded-lg border border-outline-variant bg-surface-container-low px-0.5 text-sm font-medium text-primary transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:text-on-surface-variant disabled:opacity-60"
              >
                {sending
                  ? t("auth.sending")
                  : countdown > 0
                    ? t("auth.resendIn", { seconds: countdown })
                    : sentTo
                      ? t("auth.resend")
                      : t("auth.sendCode")}
              </button>
            </div>

            {/* 发码前后各一句，始终占一行且 truncate，卡片高度不变 */}
            <p className="truncate px-1 text-xs text-on-surface-variant">
              {sentTo ? t("auth.otpSentHint", { target: sentTo }) : t("auth.registerEmailHint")}
            </p>

            <Input
              placeholder={t("auth.otpPlaceholder")}
              inputMode="numeric"
              maxLength={OTP_LENGTH}
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, ""));
                if (otpError) setOtpError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && handleRegister()}
              error={otpError}
            />
            <Input
              placeholder={t("auth.passwordPlaceholder")}
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (passwordError) setPasswordError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && handleRegister()}
              error={passwordError}
            />

            <Button className="mt-1 w-full" onClick={handleRegister} disabled={loading}>
              {loading ? t("auth.registering") : t("auth.register")}
            </Button>
          </div>

          <p className="mt-6 text-center text-sm text-on-surface-variant">
            {t("auth.hasAccount")}{" "}
            {isDesktop ? (
              <button
                type="button"
                onClick={goToLogin}
                className="font-medium text-primary hover:opacity-80"
              >
                {t("auth.loginNow")}
              </button>
            ) : (
              <Link to="/login" replace className="font-medium text-primary hover:opacity-80">
                {t("auth.loginNow")}
              </Link>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
