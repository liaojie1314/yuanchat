import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Input } from "@yuanchat/ui";
import { useAuthStore, useIsDesktop } from "@yuanchat/shared";
import { UserPlus, ArrowLeft, RefreshCw } from "lucide-react";

export function RegisterPage() {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const registerWithPassword = useAuthStore((s) => s.registerWithPassword);

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [captchaImg, setCaptchaImg] = useState("");
  const [captchaID, setCaptchaID] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchCaptcha = async () => {
    try {
      const res = await fetch("http://localhost:8080/api/v1/captcha");
      setCaptchaImg(await res.text());
      setCaptchaID(res.headers.get("X-Captcha-ID") || "");
    } catch {
      /* backend not running */
    }
  };

  useEffect(() => {
    fetchCaptcha();
  }, []);

  const handleRegister = async () => {
    if (!phone || !password || !nickname) return;
    if (!captchaAnswer) {
      setError("请输入验证码");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await registerWithPassword(phone, password, captchaID, Number(captchaAnswer), nickname);
      navigate("/chat", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "注册失败");
      fetchCaptcha();
      setCaptchaAnswer("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="surface-gradient relative flex min-h-screen items-center justify-center overflow-y-auto py-8">
      {/* 背景装饰 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="aurora-orb -left-20 -top-20 h-[500px] w-[500px] bg-[#7EC8E3]" />
        <div className="aurora-orb -right-32 top-1/2 h-[400px] w-[400px] bg-[#A8CFFF]" />
        <div className="aurora-orb -bottom-20 left-1/3 h-[350px] w-[350px] bg-[#B8D8F0]" />
      </div>
      <div className="dot-grid pointer-events-none fixed inset-0" />

      {/* 返回按钮 — 桌面端（无浏览器导航）不显示 */}
      {!isDesktop && (
        <Link
          to="/login"
          className="text-on-surface-variant absolute left-6 top-6 inline-flex items-center gap-1.5 rounded-full bg-surface-container/80 px-4 py-2 text-label-lg backdrop-blur-sm transition-all hover:bg-surface-container-high hover:text-on-surface"
        >
          <ArrowLeft size={16} /> 返回登录
        </Link>
      )}

      <div className="relative w-full max-w-md px-8 py-12">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="brand-gradient glow-brand mx-auto mb-5 inline-flex h-20 w-20 items-center justify-center rounded-2xl text-white">
            <UserPlus size={38} />
          </div>
          <h1 className="text-headline-lg font-semibold text-on-surface">创建账号</h1>
          <p className="text-on-surface-variant mt-2 text-body-lg">
            注册后将获得专属 <span className="font-medium text-primary">元聊号</span>
          </p>
        </div>

        <div className="glass-card space-y-5 p-6">
          <Input
            placeholder="昵称"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
          <Input
            placeholder="手机号"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Input
            placeholder="密码（至少 8 位）"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {/* 验证码 */}
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <Input
                placeholder="验证码答案"
                value={captchaAnswer}
                onChange={(e) => setCaptchaAnswer(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRegister()}
                error={error}
              />
            </div>
            <button
              type="button"
              onClick={fetchCaptcha}
              className="group relative h-12 w-[140px] shrink-0 overflow-hidden rounded-xl border border-outline-variant bg-surface-container-low"
              title="点击刷新验证码"
            >
              <span
                className="block h-full w-full [&>svg]:h-full [&>svg]:w-full"
                dangerouslySetInnerHTML={{
                  __html:
                    captchaImg ||
                    '<span class="flex h-full items-center justify-center text-label-sm text-on-surface-variant">点击获取</span>',
                }}
              />
              <span className="absolute inset-0 flex items-center justify-center bg-surface/80 opacity-0 transition-opacity group-hover:opacity-100">
                <RefreshCw size={16} className="text-primary" />
              </span>
            </button>
          </div>
          {!error && captchaImg && (
            <p className="text-on-surface-variant -mt-3 text-label-sm">点击右侧图片刷新验证码</p>
          )}

          <Button className="w-full" onClick={handleRegister} disabled={loading}>
            {loading ? "注册中…" : "注 册"}
          </Button>
        </div>

        <p className="text-on-surface-variant mt-6 text-center text-label-md">
          已有账号？{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            立即登录
          </Link>
        </p>
      </div>
    </div>
  );
}
