import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Input } from "@yuanchat/ui";
import { useAuthStore, API_BASE } from "@yuanchat/shared";
import { validatePassword, validatePhone, validateNickname } from "@yuanchat/shared/utils";
import { UserPlus, RefreshCw } from "lucide-react";

export function RegisterPage() {
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
      navigate("/chat", { replace: true });
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : "注册失败");
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
        <div className="rounded-3xl border border-white/60 bg-white/70 px-10 py-12 shadow-[0_8px_40px_rgba(0,0,0,0.08)] backdrop-blur-2xl">
          {/* Logo */}
          <div className="mb-7 text-center">
            <div className="brand-gradient glow-brand mx-auto mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl text-white shadow-lg">
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

            {/* 验证码行 */}
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
                className="group relative mt-[1px] h-12 w-[120px] shrink-0 overflow-hidden rounded-xl border border-outline-variant bg-surface-container-low"
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
            <Link to="/login" replace className="font-medium text-primary hover:opacity-80">
              立即登录
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
