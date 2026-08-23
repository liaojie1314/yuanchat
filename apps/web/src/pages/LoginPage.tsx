import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Input } from "@yuanchat/ui";
import { useAuthStore } from "@yuanchat/shared";
import { validatePassword, validateYuanchatId } from "@yuanchat/shared/utils";
import { MessageCircle, QrCode } from "lucide-react";

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [yuanchatId, setYuanchatId] = useState("");
  const [password, setPassword] = useState("");
  const [yuanchatIdError, setYuanchatIdError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [loading, setLoading] = useState(false);
  const loginWithPassword = useAuthStore((s) => s.loginWithPassword);

  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  const clearErrors = () => {
    setYuanchatIdError("");
    setPasswordError("");
  };

  const handleLogin = async () => {
    clearErrors();
    let valid = true;

    if (!yuanchatId.trim()) {
      setYuanchatIdError(t("auth.yuanchatIdRequired"));
      valid = false;
    } else {
      const idResult = validateYuanchatId(yuanchatId);
      if (!idResult.valid) {
        // 校验工具返回 i18n key，落地文案在这里翻译
        setYuanchatIdError(t(idResult.errors[0]));
        valid = false;
      }
    }
    const pwResult = validatePassword(password);
    if (!pwResult.valid) {
      setPasswordError(t(pwResult.errors[0]));
      valid = false;
    }
    if (!valid) return;

    setLoading(true);
    try {
      await loginWithPassword(yuanchatId, password);
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : t("auth.loginFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="surface-gradient relative flex min-h-[var(--app-height,100vh)] flex-col overflow-y-auto">
      <div ref={glowRef} className="cursor-glow" style={{ left: mousePos.x, top: mousePos.y }} />

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="aurora-orb -left-20 -top-20 h-[500px] w-[500px] bg-[#7EC8E3]" />
        <div className="aurora-orb -right-32 top-1/2 h-[400px] w-[400px] bg-[#A8CFFF]" />
        <div className="aurora-orb -bottom-20 left-1/3 h-[350px] w-[350px] bg-[#B8D8F0]" />
      </div>
      <div className="dot-grid" />
      <div className="light-sweep" />

      <div className="relative m-auto w-full max-w-md px-5 py-8">
        {/* 磨砂玻璃卡片 */}
        <div className="rounded-lg border border-white/60 bg-white/70 px-10 py-12 shadow-[0_8px_40px_rgba(0,0,0,0.08)] backdrop-blur-2xl">
          {/* Logo */}
          <div className="mb-8 text-center">
            <div className="brand-gradient glow-brand mb-4 inline-flex h-16 w-16 items-center justify-center rounded-lg text-white shadow-lg">
              <MessageCircle size={30} />
            </div>
            <h1 className="text-2xl font-bold text-on-surface">{t("auth.brandName")}</h1>
            <p className="mt-1 text-sm text-on-surface-variant">{t("auth.brandTagline")}</p>
          </div>

          <div className="space-y-1">
            <Input
              placeholder={t("auth.yuanchatId")}
              type="text"
              value={yuanchatId}
              onChange={(e) => {
                setYuanchatId(e.target.value);
                if (yuanchatIdError) setYuanchatIdError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              error={yuanchatIdError}
            />
            <Input
              placeholder={t("auth.password")}
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (passwordError) setPasswordError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              error={passwordError}
            />
            <Button className="mt-1 w-full" onClick={handleLogin} disabled={loading}>
              {loading ? t("auth.loggingIn") : t("auth.login")}
            </Button>
          </div>

          {/* 辅助链接行 */}
          <div className="mt-4 flex items-center justify-between text-sm">
            <Link to="/forgot-password" className="text-on-surface-variant hover:text-primary">
              {t("auth.forgotPassword")}
            </Link>
            <button
              type="button"
              onClick={() => navigate("/qr-login")}
              className="inline-flex items-center gap-1.5 text-on-surface-variant hover:text-primary"
            >
              <QrCode size={14} />
              {t("auth.qrLogin")}
            </button>
          </div>

          <p className="mt-4 text-center text-sm text-on-surface-variant">
            {t("auth.noAccount")}{" "}
            <Link to="/register" replace className="cursor-pointer font-medium text-primary">
              {t("auth.registerNow")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
