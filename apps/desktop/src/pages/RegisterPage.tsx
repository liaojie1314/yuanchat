import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Input } from "@yuanchat/ui";
import { useAuthStore, useIsDesktop, API_BASE } from "@yuanchat/shared";
import { validatePassword, validatePhone, validateNickname } from "@yuanchat/shared/utils";
import { useCloseAuthWindow } from "../hooks/useTauriAuth";
import { useIsMobile } from "../hooks/useIsMobile";
import { TitleBar } from "../components/TitleBar";
import { UserPlus, ArrowLeft, RefreshCw } from "lucide-react";

export function RegisterPage() {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const isMobile = useIsMobile();
  const closeAuthWindow = useCloseAuthWindow();
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
      /* backend not running */
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
      setNicknameError(nnResult.errors[0]);
      valid = false;
    }
    const phResult = validatePhone(phone);
    if (!phResult.valid) {
      setPhoneError(phResult.errors[0]);
      valid = false;
    }
    const pwResult = validatePassword(password);
    if (!pwResult.valid) {
      setPasswordError(pwResult.errors[0]);
      valid = false;
    }
    if (!captchaAnswer.trim()) {
      setCaptchaError("请输入验证码");
      valid = false;
    }
    if (!valid) return;

    setLoading(true);
    try {
      await registerWithPassword(phone, password, captchaID, Number(captchaAnswer), nickname);
      if (isDesktop) {
        await closeAuthWindow();
      } else {
        navigate("/chat", { replace: true });
      }
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : "注册失败");
      fetchCaptcha();
      setCaptchaAnswer("");
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
          className="text-on-surface-variant absolute left-6 top-6 inline-flex items-center gap-1.5 rounded-full bg-surface-container/80 px-4 py-2 text-label-lg backdrop-blur-sm transition-all hover:bg-surface-container-high hover:text-on-surface"
        >
          <ArrowLeft size={16} /> 返回登录
        </Link>
      )}

      <div className="relative flex flex-1 flex-col overflow-y-auto">
        <div className="relative m-auto w-full max-w-md px-8 py-10">
          <div className="mb-7 text-center">
            <div className="brand-gradient glow-brand mx-auto mb-4 inline-flex h-16 w-16 items-center justify-center rounded-lg text-white">
              <UserPlus size={30} />
            </div>
            <h1 className="text-2xl font-bold text-on-surface">创建账号</h1>
            <p className="text-on-surface-variant mt-1 text-sm">
              注册后获得专属 <span className="font-medium text-primary">元聊号</span>
            </p>
          </div>

          <div className="space-y-1">
            <Input
              placeholder="昵称"
              value={nickname}
              onChange={(e) => {
                setNickname(e.target.value);
                if (nicknameError) setNicknameError("");
              }}
              error={nicknameError}
            />
            <Input
              placeholder="手机号"
              type="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (phoneError) setPhoneError("");
              }}
              error={phoneError}
            />
            <Input
              placeholder="密码（至少 8 位）"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (passwordError) setPasswordError("");
              }}
              error={passwordError}
            />

            <div className="flex items-start gap-2">
              <div className="flex-1">
                <Input
                  placeholder="验证码"
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
                title="点击刷新验证码"
              >
                <span
                  className="block h-full w-full [&>svg]:h-full [&>svg]:w-full"
                  dangerouslySetInnerHTML={{
                    __html:
                      captchaImg ||
                      '<span class="flex h-full items-center justify-center text-xs text-on-surface-variant">点击获取</span>',
                  }}
                />
                <span className="absolute inset-0 flex items-center justify-center bg-surface/80 opacity-0 transition-opacity group-hover:opacity-100">
                  <RefreshCw size={14} className="text-primary" />
                </span>
              </button>
            </div>

            <Button className="mt-1 w-full" onClick={handleRegister} disabled={loading}>
              {loading ? "注册中…" : "注 册"}
            </Button>
          </div>

          <p className="text-on-surface-variant mt-6 text-center text-sm">
            已有账号？{" "}
            {isDesktop ? (
              <button
                type="button"
                onClick={goToLogin}
                className="font-medium text-primary hover:opacity-80"
              >
                立即登录
              </button>
            ) : (
              <Link to="/login" replace className="font-medium text-primary hover:opacity-80">
                立即登录
              </Link>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
