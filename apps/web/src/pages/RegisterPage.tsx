import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Input } from "@yuanchat/ui";
import { useAuthStore } from "@yuanchat/shared";
import { MessageCircle, ArrowLeft } from "lucide-react";

export function RegisterPage() {
  const navigate = useNavigate();
  const registerWithPassword = useAuthStore((s) => s.registerWithPassword);

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [captchaImg, setCaptchaImg] = useState("");
  const [captchaID, setCaptchaID] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  /** 获取验证码图片 */
  const fetchCaptcha = async () => {
    try {
      const res = await fetch("http://localhost:8080/api/v1/captcha");
      const svg = await res.text();
      setCaptchaImg(svg);
      setCaptchaID(res.headers.get("X-Captcha-ID") || "");
    } catch {
      // 后端未启动时静默失败
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      fetchCaptcha(); // 刷新验证码
      setCaptchaAnswer("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="surface-gradient relative flex min-h-screen items-center justify-center overflow-hidden">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="aurora-orb -left-20 -top-20 h-[500px] w-[500px] bg-[#7EC8E3]" />
        <div className="aurora-orb -right-32 top-1/2 h-[400px] w-[400px] bg-[#A8CFFF]" />
      </div>
      <div className="dot-grid" />

      <div className="relative w-full max-w-md p-8">
        <Link
          to="/login"
          className="text-on-surface-variant mb-6 inline-flex items-center gap-1 text-label-lg hover:text-on-surface"
        >
          <ArrowLeft size={18} /> 返回登录
        </Link>

        <div className="mb-8 text-center">
          <div className="brand-gradient glow-brand mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl text-white">
            <MessageCircle size={32} />
          </div>
          <h1 className="text-headline-md font-semibold text-on-surface">注册元聊</h1>
          <p className="text-on-surface-variant mt-1 text-body-md">创建账号，开始聊天</p>
        </div>

        <div className="glass-card space-y-4 p-6">
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
            placeholder="密码（至少8位）"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="flex gap-3">
            <Input
              placeholder="验证码答案"
              value={captchaAnswer}
              onChange={(e) => setCaptchaAnswer(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRegister()}
              error={error}
            />
            {/* CAPTCHA 图片 — 直接渲染 SVG */}
            <span
              onClick={fetchCaptcha}
              className="inline-flex shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-outline-variant bg-surface"
              dangerouslySetInnerHTML={{
                __html:
                  captchaImg ||
                  '<span class="px-4 py-3 text-label-sm text-on-surface-variant">点击刷新</span>',
              }}
            />
          </div>
          <Button className="w-full" onClick={handleRegister} disabled={loading}>
            {loading ? "注册中…" : "注 册"}
          </Button>
        </div>
      </div>
    </div>
  );
}
